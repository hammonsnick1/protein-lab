// Where the vector library reads and writes. The screens talk to one
// interface; this module decides how each call reaches the engine.
//
// The engine's organisation endpoints (collections, tags, colour, notes,
// soft delete, duplicate-aware multi-file import) arrive with HOM-153. Until
// they do, `localBackend` keeps that organisation in this browser's storage
// on top of the engine's existing search, favourite, import, export and
// delete routes, so the library is fully usable today.

import { ENGINE_UNREACHABLE_MESSAGE, proteinLabsApi, type JsonObject } from "./protein-labs-api.ts";
import { librarySearchParams, type FacetCounts, type Filters, type LibraryVector } from "./vector-library.ts";
import {
  EMPTY_ORGANIZER,
  addTags,
  applyOrganizer,
  collectionList,
  deleteCollection,
  facetCountsFor,
  forgetVectors,
  inScope,
  parseOrganizer,
  removeTags,
  setMembership,
  sortVectors,
  tagCounts,
  uniqueName,
  viewCounts,
  type Collection,
  type ColorLabel,
  type ImportPreviewRow,
  type ImportResolution,
  type OrganizedVector,
  type OrganizerState,
  type Scope,
  type SmartView,
  type SortKey,
  type SortOrder,
} from "./vector-library-organize.ts";

export type LibraryQuery = { query: string; filters: Filters; scope: Scope; sort: SortKey; order: SortOrder };

export type LibraryPage = {
  vectors: OrganizedVector[];
  facets: FacetCounts;
  tags: { name: string; count: number }[];
  collections: Collection[];
  viewCounts: Record<SmartView, number>;
};

export type VectorPatch = { name?: string; notes?: string; color?: ColorLabel | null; tags?: string[]; favorite?: boolean };

export type ImportFile = { filename: string; path: string; content: string };

export type ImportOutcome = { filename: string; status: "added" | "merged" | "skipped" | "failed"; id?: string; name?: string; message?: string };

export interface VectorLibraryBackend {
  /** "local" while organisation lives in this browser; "engine" once HOM-153 ships. */
  readonly kind: "engine" | "local";
  search(query: LibraryQuery): Promise<LibraryPage>;
  detail(id: string): Promise<OrganizedVector>;
  update(ids: string[], patch: VectorPatch): Promise<void>;
  tag(ids: string[], tags: string[], add: boolean): Promise<void>;
  setCollection(ids: string[], collectionId: string, member: boolean): Promise<void>;
  duplicate(id: string): Promise<string>;
  /** Hide now; `purge` makes it permanent once the undo window has passed. */
  remove(ids: string[]): Promise<void>;
  restore(ids: string[]): Promise<void>;
  purge(ids: string[]): Promise<void>;
  createCollection(name: string): Promise<Collection>;
  renameCollection(id: string, name: string): Promise<void>;
  deleteCollection(id: string): Promise<void>;
  reorderCollections(ids: string[]): Promise<void>;
  exportGenBank(ids: string[]): Promise<{ filename: string; blob: Blob }>;
  previewImport(files: ImportFile[]): Promise<ImportPreviewRow[]>;
  commitImport(files: ImportFile[], resolutions: Record<string, ImportResolution>): Promise<ImportOutcome[]>;
}

const STORAGE_KEY = "protein-labs-vector-library-organizer";

function stem(filename: string): string {
  const base = filename.split("/").pop() ?? filename;
  return base.replace(/\.[^.]+$/, "");
}

function loadState(): OrganizerState {
  try { return parseOrganizer(globalThis.localStorage?.getItem(STORAGE_KEY) ?? null); }
  catch { return EMPTY_ORGANIZER; }
}

/** The organisation layer kept in this browser, over the engine's current routes. */
export function createLocalBackend(): VectorLibraryBackend {
  let state = loadState();
  // Removed vectors stay hidden until the undo window closes and they are purged.
  const hidden = new Set<string>();
  const save = (next: OrganizerState) => {
    state = next;
    try { globalThis.localStorage?.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage full or disabled: keep it for this session */ }
  };
  const everything = async () => {
    const value = await proteinLabsApi.searchVectorLibrary(librarySearchParams({ query: "", filters: {} }));
    return (value.vectors as unknown as LibraryVector[]).filter((vector) => !hidden.has(vector.id));
  };
  const readOnly = (vector: LibraryVector) => vector.isStandard;

  return {
    kind: "local",

    async search({ query, filters, scope, sort, order }) {
      const [all, matched] = await Promise.all([
        everything(),
        query.trim() || Object.keys(filters).length
          ? proteinLabsApi.searchVectorLibrary(librarySearchParams({ query, filters })).then((value) => value.vectors as unknown as LibraryVector[])
          : null,
      ]);
      const organizedAll = applyOrganizer(all, state);
      const matchedIds = matched ? new Set(matched.map((vector) => vector.id)) : null;
      const scoped = organizedAll.filter((vector) => inScope(vector, scope) && (!matchedIds || matchedIds.has(vector.id)));
      return {
        vectors: sortVectors(scoped, sort, order),
        facets: facetCountsFor(scoped),
        tags: tagCounts(organizedAll),
        collections: collectionList(state, organizedAll),
        viewCounts: viewCounts(organizedAll),
      };
    },

    async detail(id) {
      const vector = await proteinLabsApi.getLibraryVector(id) as unknown as LibraryVector;
      return applyOrganizer([vector], state)[0];
    },

    async update(ids, patch) {
      if (patch.favorite !== undefined) await Promise.all(ids.map((id) => proteinLabsApi.setLibraryFavorite(id, patch.favorite!)));
      let next = state;
      for (const id of ids) {
        if (patch.name !== undefined) next = { ...next, names: { ...next.names, [id]: patch.name.trim() } };
        if (patch.notes !== undefined) next = { ...next, notes: { ...next.notes, [id]: patch.notes } };
        if (patch.tags !== undefined) next = { ...next, tags: { ...next.tags, [id]: addTags([], patch.tags) } };
        if (patch.color !== undefined) {
          const colors = { ...next.colors };
          if (patch.color) colors[id] = patch.color; else delete colors[id];
          next = { ...next, colors };
        }
      }
      save(next);
    },

    async tag(ids, tags, add) {
      const next = { ...state.tags };
      for (const id of ids) next[id] = add ? addTags(next[id] ?? [], tags) : removeTags(next[id] ?? [], tags);
      save({ ...state, tags: next });
    },

    async setCollection(ids, collectionId, member) {
      save(setMembership(state, ids, collectionId, member));
    },

    async duplicate() {
      // The engine keeps one record per sequence until HOM-153 adds duplicate.
      throw new Error("Duplicating a vector needs the library engine update (HOM-153). Use it in a project and save a copy from there for now.");
    },

    async remove(ids) {
      const all = await everything();
      const blocked = all.filter((vector) => ids.includes(vector.id) && readOnly(vector));
      if (blocked.length) throw new Error(`${blocked.map((vector) => vector.name).join(", ")} ${blocked.length === 1 ? "is" : "are"} part of the standard catalogue and cannot be deleted.`);
      for (const id of ids) hidden.add(id);
    },

    async restore(ids) {
      for (const id of ids) hidden.delete(id);
    },

    async purge(ids) {
      const done: string[] = [];
      try {
        for (const id of ids) { await proteinLabsApi.deleteLibraryVector(id); done.push(id); }
      } finally {
        for (const id of ids) hidden.delete(id);
        save(forgetVectors(state, done));
      }
    },

    async createCollection(name) {
      const collection = { id: `c-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`, name: uniqueName(name.trim() || "New collection", state.collections.map((entry) => entry.name)) };
      save({ ...state, collections: [...state.collections, collection] });
      return { ...collection, position: state.collections.length - 1, count: 0 };
    },

    async renameCollection(id, name) {
      const taken = state.collections.filter((entry) => entry.id !== id).map((entry) => entry.name);
      if (taken.some((entry) => entry.toLowerCase() === name.trim().toLowerCase())) throw new Error(`There is already a collection called ${name.trim()}.`);
      save({ ...state, collections: state.collections.map((entry) => entry.id === id ? { ...entry, name: name.trim() } : entry) });
    },

    async deleteCollection(id) {
      save(deleteCollection(state, id));
    },

    async reorderCollections(ids) {
      const byId = new Map(state.collections.map((entry) => [entry.id, entry]));
      const ordered = ids.map((id) => byId.get(id)).filter((entry): entry is { id: string; name: string } => Boolean(entry));
      save({ ...state, collections: [...ordered, ...state.collections.filter((entry) => !ids.includes(entry.id))] });
    },

    async exportGenBank(ids) {
      // One multi-record GenBank file; the engine's bulk export will return a zip.
      const files = await Promise.all(ids.map((id) => proteinLabsApi.exportLibraryVector(id, "genbank")));
      const content = files.map((file) => file.content.trimEnd()).join("\n");
      const filename = files.length === 1 ? files[0].filename : `vector-library-${files.length}-vectors.gb`;
      return { filename, blob: new Blob([content.endsWith("\n") ? content : `${content}\n`], { type: "chemical/seq-na-genbank" }) };
    },

    async previewImport(files) {
      const all = applyOrganizer(await everything(), state);
      return files.map((file): ImportPreviewRow => {
        if (!file.content.trim()) return { filename: file.filename, status: "error", error: "The file is empty." };
        const name = stem(file.filename);
        const twin = all.find((vector) => vector.name.toLowerCase() === name.toLowerCase());
        return twin
          ? { filename: file.filename, status: "duplicate", name, duplicateOf: { id: twin.id, name: twin.name, isStandard: twin.isStandard } }
          : { filename: file.filename, status: "new", name };
      });
    },

    async commitImport(files, resolutions) {
      const outcomes: ImportOutcome[] = [];
      let imported = state.imported;
      for (const file of files) {
        const resolution = resolutions[file.filename] ?? "import";
        if (resolution === "skip") { outcomes.push({ filename: file.filename, status: "skipped" }); continue; }
        try {
          const vector = await proteinLabsApi.importLibraryVector(file.filename, file.content) as JsonObject & { duplicate?: boolean };
          const id = String(vector.id);
          if (vector.duplicate) outcomes.push({ filename: file.filename, status: "merged", id, name: String(vector.name), message: `Same sequence as ${String(vector.name)}, so the existing record was kept.` });
          else { outcomes.push({ filename: file.filename, status: "added", id, name: String(vector.name) }); imported = [...imported, id]; }
        } catch (reason) {
          outcomes.push({ filename: file.filename, status: "failed", message: reason instanceof Error ? reason.message : String(reason) });
        }
      }
      save({ ...state, imported });
      return outcomes;
    },
  };
}

// ---------------------------------------------------------------------------
// The engine's own organisation routes (HOM-153 api-contract)
// ---------------------------------------------------------------------------

const SMART_VIEW_IDS: SmartView[] = ["all", "favorites", "recent", "imports", "standard", "unsorted"];

/** One engine vector summary as the screens use it. */
export function fromEngineVector(raw: JsonObject): OrganizedVector {
  const vector = raw as unknown as LibraryVector & { createdAt?: string; collectionIds?: string[]; tags?: string[]; color?: string | null; colorLabel?: string | null; mapFeatures?: OrganizedVector["mapFeatures"]; lastUsedAt?: string | null };
  const origin = vector.origin === "standard" || vector.origin === "import" || vector.origin === "project" ? vector.origin : vector.isStandard ? "standard" : "import";
  const color = vector.colorLabel ?? vector.color ?? null;
  return {
    ...vector,
    lastUsedAt: vector.lastUsedAt ?? undefined,
    provenance: origin,
    collectionIds: vector.collectionIds ?? [],
    tags: vector.tags ?? [],
    color: COLOR_IDS.has(color ?? "") ? color as ColorLabel : null,
  };
}

const COLOR_IDS = new Set<string>(["red", "amber", "green", "blue", "violet", "grey"]);

export function fromEngineCollection(raw: JsonObject): Collection {
  return { id: String(raw.id), name: String(raw.name), position: Number(raw.position ?? 0), count: Number(raw.vectorCount ?? 0) };
}

/** The engine's query string for one library page. */
export function engineSearchParams({ query, filters, scope, sort, order }: LibraryQuery): string {
  const params = new URLSearchParams(librarySearchParams({ query, filters }));
  params.set("view", scope.kind === "view" ? scope.view : "all");
  if (scope.kind === "collection") params.set("collection", scope.id);
  if (scope.kind === "tag") params.append("tag", scope.name);
  params.set("sort", sort);
  params.set("order", order);
  return params.toString();
}

/** What a committed import file turned into, from the engine's per-file result. */
export function fromEngineImportResult(raw: JsonObject): ImportOutcome {
  const filename = String(raw.filename);
  const vector = (raw.vector ?? null) as JsonObject | null;
  const id = vector ? String(vector.id) : undefined;
  const name = vector ? String(vector.name) : undefined;
  if (raw.status === "error") return { filename, status: "failed", message: String(raw.error ?? "The file could not be read.") };
  if (raw.resolution === "skipped" || !vector) return { filename, status: "skipped" };
  if (raw.resolution === "merged") return { filename, status: "merged", id, name, message: `Kept the existing ${name}.` };
  return { filename, status: "added", id, name };
}

function firstLine(text: string): string {
  return text.split("\n")[0].trim();
}

export function createEngineBackend(): VectorLibraryBackend {
  const api = proteinLabsApi;
  const bulk = (ids: string[], action: string, extra: JsonObject = {}) => api.bulkLibraryAction({ ids, action, ...extra });
  return {
    kind: "engine",

    async search(query) {
      const [page, collections] = await Promise.all([
        api.searchVectorLibrary(engineSearchParams(query)) as Promise<{ vectors: JsonObject[]; facets: FacetCounts; tags?: { name: string; count: number }[]; viewCounts?: Partial<Record<SmartView, number>> }>,
        api.libraryCollections(),
      ]);
      const counts = Object.fromEntries(SMART_VIEW_IDS.map((view) => [view, Number(page.viewCounts?.[view] ?? 0)])) as Record<SmartView, number>;
      return {
        vectors: page.vectors.map(fromEngineVector),
        facets: page.facets ?? {},
        tags: page.tags ?? [],
        collections: collections.collections.map(fromEngineCollection).sort((a, b) => a.position - b.position),
        viewCounts: counts,
      };
    },

    async detail(id) {
      return fromEngineVector(await api.getLibraryVector(id));
    },

    async update(ids, patch) {
      const fields: JsonObject = {};
      if (patch.name !== undefined) fields.name = patch.name.trim();
      if (patch.notes !== undefined) fields.notes = patch.notes;
      if (patch.color !== undefined) fields.colorLabel = patch.color;
      if (patch.tags !== undefined) fields.tags = addTags([], patch.tags);
      if (patch.favorite !== undefined) fields.favorite = patch.favorite;
      if (ids.length > 1 && Object.keys(fields).length === 1 && patch.favorite !== undefined) {
        await bulk(ids, patch.favorite ? "favorite" : "unfavorite", { favorite: patch.favorite });
        return;
      }
      for (const id of ids) {
        try { await api.updateLibraryVector(id, fields); }
        catch (reason) {
          if (reason instanceof Error && reason.message === "read_only") throw new Error("Standard catalogue vectors keep their name. Duplicate it to get a copy you can rename.");
          throw reason;
        }
      }
    },

    async tag(ids, tags, add) {
      await bulk(ids, add ? "tag" : "untag", { tags: addTags([], tags) });
    },

    async setCollection(ids, collectionId, member) {
      await bulk(ids, member ? "addToCollection" : "removeFromCollection", { collectionId });
    },

    async duplicate(id) {
      return String((await api.duplicateLibraryVector(id)).id);
    },

    async remove(ids) {
      const result = await bulk(ids, "delete");
      if (result.skipped.length && !result.updated.length) throw new Error(ids.length === 1 ? "Standard catalogue vectors cannot be deleted." : "Standard catalogue vectors cannot be deleted, so nothing was removed.");
    },

    async restore(ids) {
      await bulk(ids, "restore");
    },

    async purge() {
      // The engine keeps deleted records out of every list; nothing more to do here.
    },

    async createCollection(name) {
      return fromEngineCollection((await api.createLibraryCollection(name.trim() || "New collection")).collection);
    },

    async renameCollection(id, name) {
      await api.updateLibraryCollection(id, { name: name.trim() });
    },

    async deleteCollection(id) {
      await api.deleteLibraryCollection(id);
    },

    async reorderCollections(ids) {
      await api.reorderLibraryCollections(ids);
    },

    async exportGenBank(ids) {
      const files = await Promise.all(ids.map((id) => api.exportLibraryVector(id, "genbank")));
      const content = files.map((file) => file.content.trimEnd()).join("\n");
      const filename = files.length === 1 ? files[0].filename : `vector-library-${files.length}-vectors.gb`;
      return { filename, blob: new Blob([content.endsWith("\n") ? content : `${content}\n`], { type: "chemical/seq-na-genbank" }) };
    },

    async previewImport(files) {
      const { files: rows } = await api.previewLibraryImport(files.map(({ filename, content }) => ({ filename, content })));
      return rows.map((row): ImportPreviewRow => {
        const twin = (row.duplicateOf ?? null) as JsonObject | null;
        return {
          filename: String(row.filename),
          status: row.status === "duplicate" ? "duplicate" : row.status === "error" ? "error" : "new",
          name: row.name ? String(row.name) : undefined,
          lengthBp: row.lengthBp === undefined ? undefined : Number(row.lengthBp),
          duplicateOf: twin ? { id: String(twin.id), name: String(twin.name), isStandard: Boolean(twin.isStandard) } : undefined,
          error: row.error ? firstLine(String(row.error)) : undefined,
        };
      });
    },

    async commitImport(files, resolutions) {
      // Skipped files are not sent: the engine imports any new file it is given.
      const chosen = files.filter((file) => (resolutions[file.filename] ?? "import") !== "skip");
      const skipped = files.filter((file) => !chosen.includes(file)).map((file): ImportOutcome => ({ filename: file.filename, status: "skipped" }));
      if (!chosen.length) return skipped;
      const { files: results } = await api.commitLibraryImport(chosen.map((file) => ({
        filename: file.filename,
        content: file.content,
        resolution: resolutions[file.filename] === "keepBoth" || resolutions[file.filename] === "merge" ? resolutions[file.filename] : "keepBoth",
      })));
      return [...results.map(fromEngineImportResult), ...skipped];
    },
  };
}

/**
 * The engine's routes when it has them (HOM-153), otherwise the browser-kept
 * organisation. Decided once, on the first call.
 */
export function createLibraryBackend(): VectorLibraryBackend {
  let chosen: VectorLibraryBackend | null = null;
  let deciding: Promise<VectorLibraryBackend> | null = null;
  const pick = () => deciding ??= proteinLabsApi.libraryCollections()
    .then(() => createEngineBackend(), (reason: unknown) => {
      // Unreachable engine: let the call fail now and decide again next time.
      if (reason instanceof Error && reason.message === ENGINE_UNREACHABLE_MESSAGE) { deciding = null; throw reason; }
      return createLocalBackend();
    })
    .then((backend) => (chosen = backend));
  const forward = <K extends Exclude<keyof VectorLibraryBackend, "kind">>(key: K) =>
    (async (...args: unknown[]) => ((await pick())[key] as (...inner: unknown[]) => unknown)(...args)) as VectorLibraryBackend[K];
  return {
    get kind() { return chosen?.kind ?? "engine"; },
    search: forward("search"),
    detail: forward("detail"),
    update: forward("update"),
    tag: forward("tag"),
    setCollection: forward("setCollection"),
    duplicate: forward("duplicate"),
    remove: forward("remove"),
    restore: forward("restore"),
    purge: forward("purge"),
    createCollection: forward("createCollection"),
    renameCollection: forward("renameCollection"),
    deleteCollection: forward("deleteCollection"),
    reorderCollections: forward("reorderCollections"),
    exportGenBank: forward("exportGenBank"),
    previewImport: forward("previewImport"),
    commitImport: forward("commitImport"),
  };
}
