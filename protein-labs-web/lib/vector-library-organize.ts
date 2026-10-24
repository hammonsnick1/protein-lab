// Pure helpers for organising the vector library: smart views, collections,
// tags, colour labels, sorting, multi-select, keyboard movement through the
// grid, and the per-file decisions of an import review.
// Nothing here touches React or the network so it can be unit tested.

import type { FacetCounts, FacetKey, LibraryVector, MapFeature } from "./vector-library.ts";

export type SmartView = "all" | "favorites" | "recent" | "imports" | "standard" | "unsorted";

export const SMART_VIEWS: { id: SmartView; label: string; hint: string }[] = [
  { id: "all", label: "All vectors", hint: "Everything in the library" },
  { id: "favorites", label: "Favourites", hint: "Vectors you starred" },
  { id: "recent", label: "Recent", hint: "Used in a project in the last 30 days" },
  { id: "imports", label: "My imports", hint: "Files you imported or vectors saved from a project" },
  { id: "standard", label: "Standard catalogue", hint: "Bundled expression vectors, read-only" },
  { id: "unsorted", label: "Unsorted", hint: "Vectors in no collection and with no tags" },
];

/** What the sidebar has selected: a smart view, a user collection, or a tag. */
export type Scope = { kind: "view"; view: SmartView } | { kind: "collection"; id: string } | { kind: "tag"; name: string };

export const ALL_SCOPE: Scope = { kind: "view", view: "all" };

export function sameScope(a: Scope, b: Scope): boolean {
  if (a.kind !== b.kind) return false;
  if (a.kind === "view" && b.kind === "view") return a.view === b.view;
  if (a.kind === "collection" && b.kind === "collection") return a.id === b.id;
  return a.kind === "tag" && b.kind === "tag" && a.name === b.name;
}

export type ColorLabel = "red" | "amber" | "green" | "blue" | "violet" | "grey";

// Each label differs in lightness as well as hue, and carries a name, so it
// still reads in greyscale and to colour-blind users.
export const COLOR_LABELS: { id: ColorLabel; label: string; swatch: string }[] = [
  { id: "red", label: "Red", swatch: "#d2453a" },
  { id: "amber", label: "Amber", swatch: "#e6a817" },
  { id: "green", label: "Green", swatch: "#2f9461" },
  { id: "blue", label: "Blue", swatch: "#2f6fd0" },
  { id: "violet", label: "Violet", swatch: "#7b4fc4" },
  { id: "grey", label: "Grey", swatch: "#8a8f94" },
];

export function colorSwatch(color: string | null | undefined): string | undefined {
  return COLOR_LABELS.find((entry) => entry.id === color)?.swatch;
}

export type VectorOrigin = "standard" | "import" | "project";

/** A library vector with the organisation the user has layered on top. */
export type OrganizedVector = LibraryVector & {
  createdAt?: string;
  provenance: VectorOrigin;
  collectionIds: string[];
  tags: string[];
  color: ColorLabel | null;
  mapFeatures?: MapFeature[];
};

export type Collection = { id: string; name: string; position: number; count: number };

export type SortKey = "name" | "size" | "created" | "lastUsed";
export type SortOrder = "asc" | "desc";

export const SORT_OPTIONS: { id: SortKey; label: string; defaultOrder: SortOrder }[] = [
  { id: "name", label: "Name", defaultOrder: "asc" },
  { id: "size", label: "Size", defaultOrder: "asc" },
  { id: "created", label: "Date added", defaultOrder: "desc" },
  { id: "lastUsed", label: "Last used", defaultOrder: "desc" },
];

const collator = new Intl.Collator("en", { numeric: true, sensitivity: "base" });

function time(value: string | undefined | null): number {
  const parsed = value ? Date.parse(value) : NaN;
  return Number.isNaN(parsed) ? -Infinity : parsed;
}

/**
 * Sort with the name as the tie-break, so the order is stable between reloads.
 * Never-used vectors sort last under "Last used" in both directions.
 */
export function sortVectors<T extends Pick<OrganizedVector, "name" | "lengthBp" | "createdAt" | "lastUsedAt">>(vectors: T[], key: SortKey, order: SortOrder): T[] {
  const sign = order === "asc" ? 1 : -1;
  const byName = (a: T, b: T) => collator.compare(a.name, b.name);
  return [...vectors].sort((a, b) => {
    let primary = 0;
    if (key === "name") primary = byName(a, b) * sign;
    else if (key === "size") primary = (a.lengthBp - b.lengthBp) * sign;
    else {
      const ta = time(key === "created" ? a.createdAt : a.lastUsedAt);
      const tb = time(key === "created" ? b.createdAt : b.lastUsedAt);
      if (ta === tb) primary = 0;
      else if (ta === -Infinity) primary = 1;
      else if (tb === -Infinity) primary = -1;
      else primary = (ta - tb) * sign;
    }
    return primary || byName(a, b);
  });
}

export const RECENT_DAYS = 30;

export function isRecent(vector: Pick<LibraryVector, "lastUsedAt">, now = Date.now()): boolean {
  const used = time(vector.lastUsedAt);
  return used !== -Infinity && now - used <= RECENT_DAYS * 86_400_000;
}

export function inView(vector: OrganizedVector, view: SmartView, now = Date.now()): boolean {
  switch (view) {
    case "all": return true;
    case "favorites": return vector.favorite;
    case "recent": return isRecent(vector, now);
    case "imports": return vector.provenance !== "standard";
    case "standard": return vector.provenance === "standard";
    case "unsorted": return vector.provenance !== "standard" && vector.collectionIds.length === 0 && vector.tags.length === 0;
  }
}

export function inScope(vector: OrganizedVector, scope: Scope, now = Date.now()): boolean {
  if (scope.kind === "view") return inView(vector, scope.view, now);
  if (scope.kind === "collection") return vector.collectionIds.includes(scope.id);
  return vector.tags.some((tag) => tag.toLowerCase() === scope.name.toLowerCase());
}

export function viewCounts(vectors: OrganizedVector[], now = Date.now()): Record<SmartView, number> {
  const counts = Object.fromEntries(SMART_VIEWS.map((view) => [view.id, 0])) as Record<SmartView, number>;
  for (const vector of vectors) for (const view of SMART_VIEWS) if (inView(vector, view.id, now)) counts[view.id] += 1;
  return counts;
}

/** Tags with how many vectors carry each, most used first. */
export function tagCounts(vectors: Pick<OrganizedVector, "tags">[]): { name: string; count: number }[] {
  const counts = new Map<string, { name: string; count: number }>();
  for (const vector of vectors) {
    for (const tag of new Set(vector.tags.map((entry) => entry.toLowerCase()))) {
      const display = vector.tags.find((entry) => entry.toLowerCase() === tag) ?? tag;
      const current = counts.get(tag);
      if (current) current.count += 1; else counts.set(tag, { name: display, count: 1 });
    }
  }
  return [...counts.values()].sort((a, b) => b.count - a.count || collator.compare(a.name, b.name));
}

const FACET_FIELDS: Record<FacetKey, (vector: LibraryVector) => string[]> = {
  host: (vector) => vector.host,
  promoter: (vector) => vector.promoter,
  nTag: (vector) => vector.nTags,
  cTag: (vector) => vector.cTags,
  proteaseSite: (vector) => vector.proteaseSites,
  selectionMarker: (vector) => [vector.selectionMarker],
  copyNumber: (vector) => [vector.copyNumber],
  supplier: (vector) => [vector.supplier],
  origin: (vector) => [vector.origin],
  inducer: (vector) => vector.inducer,
};

/** Facet counts over the vectors on screen, so they follow the selected view, collection or tag. */
export function facetCountsFor(vectors: LibraryVector[]): FacetCounts {
  const facets: FacetCounts = {};
  for (const [key, read] of Object.entries(FACET_FIELDS) as [FacetKey, (vector: LibraryVector) => string[]][]) {
    const counts = new Map<string, number>();
    for (const vector of vectors) for (const value of new Set(read(vector).filter(Boolean))) counts.set(value, (counts.get(value) ?? 0) + 1);
    if (counts.size) facets[key] = [...counts].map(([value, count]) => ({ value, count })).sort((a, b) => b.count - a.count || collator.compare(a.value, b.value));
  }
  return facets;
}

/** Tidy a typed tag: trimmed, single spaces, no leading "#", at most 40 characters. */
export function normalizeTag(value: string): string {
  return value.trim().replace(/^#+/, "").replace(/\s+/g, " ").trim().slice(0, 40);
}

/** Add tags case-insensitively, keeping the first spelling the user chose. */
export function addTags(current: string[], added: string[]): string[] {
  const next = [...current];
  for (const raw of added) {
    const tag = normalizeTag(raw);
    if (tag && !next.some((entry) => entry.toLowerCase() === tag.toLowerCase())) next.push(tag);
  }
  return next;
}

export function removeTags(current: string[], removed: string[]): string[] {
  const lower = new Set(removed.map((tag) => tag.toLowerCase()));
  return current.filter((tag) => !lower.has(tag.toLowerCase()));
}

/** Move one item of a list to a new index, as a drag in the sidebar does. */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(Math.max(0, Math.min(next.length, to)), 0, item);
  return next;
}

/** A name for a new collection or copy that does not clash with the existing ones. */
export function uniqueName(base: string, taken: string[]): string {
  const lower = new Set(taken.map((name) => name.toLowerCase()));
  if (!lower.has(base.toLowerCase())) return base;
  for (let index = 2; ; index += 1) {
    const candidate = `${base} ${index}`;
    if (!lower.has(candidate.toLowerCase())) return candidate;
  }
}

export function copyName(name: string, taken: string[]): string {
  return uniqueName(`${name.replace(/ copy( \d+)?$/, "")} copy`, taken);
}

// ---------------------------------------------------------------------------
// Selection
// ---------------------------------------------------------------------------

export type ClickModifiers = { shift?: boolean; toggle?: boolean };

/**
 * Selection after a click, like a file manager: a plain click selects one,
 * Ctrl/Cmd (or the checkbox) toggles one, Shift selects the range from the anchor.
 */
export function clickSelect(order: string[], selected: string[], anchor: string | null, id: string, { shift, toggle }: ClickModifiers): { selected: string[]; anchor: string } {
  if (shift && anchor && order.includes(anchor)) {
    const from = order.indexOf(anchor);
    const to = order.indexOf(id);
    const range = order.slice(Math.min(from, to), Math.max(from, to) + 1);
    const base = toggle ? selected.filter((entry) => !range.includes(entry)) : [];
    return { selected: [...base, ...range], anchor };
  }
  if (toggle) return { selected: selected.includes(id) ? selected.filter((entry) => entry !== id) : [...selected, id], anchor: id };
  return { selected: [id], anchor: id };
}

/** Keep only the selected ids that are still on screen, in screen order. */
export function pruneSelection(order: string[], selected: string[]): string[] {
  const set = new Set(selected);
  return order.filter((id) => set.has(id));
}

export type MoveKey = "ArrowUp" | "ArrowDown" | "ArrowLeft" | "ArrowRight" | "Home" | "End" | "PageUp" | "PageDown";

/** The index the focus moves to in a grid of `columns` (1 for the list view). */
export function moveFocus(index: number, key: MoveKey, columns: number, count: number, pageRows = 4): number {
  if (count <= 0) return -1;
  if (index < 0) return key === "End" ? count - 1 : 0;
  const cols = Math.max(1, columns);
  const clamp = (value: number) => Math.max(0, Math.min(count - 1, value));
  switch (key) {
    case "ArrowLeft": return cols === 1 ? index : clamp(index - 1);
    case "ArrowRight": return cols === 1 ? index : clamp(index + 1);
    case "ArrowUp": return index - cols >= 0 ? index - cols : index;
    case "ArrowDown": return index + cols < count ? index + cols : (Math.floor(index / cols) < Math.floor((count - 1) / cols) ? count - 1 : index);
    case "Home": return 0;
    case "End": return count - 1;
    case "PageUp": return clamp(index - cols * pageRows);
    case "PageDown": return clamp(index + cols * pageRows);
  }
}

// ---------------------------------------------------------------------------
// Import review
// ---------------------------------------------------------------------------

export type ImportResolution = "skip" | "keepBoth" | "merge" | "import";

export type ImportPreviewRow = {
  filename: string;
  status: "new" | "duplicate" | "error";
  name?: string;
  lengthBp?: number;
  featureCount?: number;
  duplicateOf?: { id: string; name: string; isStandard?: boolean } | null;
  error?: string;
};

/** What the review sheet proposes before the user changes anything. */
export function defaultResolution(row: ImportPreviewRow): ImportResolution {
  if (row.status === "error") return "skip";
  if (row.status === "duplicate") return "skip";
  return "import";
}

export function resolutionChoices(row: ImportPreviewRow): ImportResolution[] {
  if (row.status === "error") return ["skip"];
  if (row.status === "new") return ["import", "skip"];
  // A standard vector is read-only, so nothing can be merged into it.
  return row.duplicateOf?.isStandard ? ["skip", "keepBoth"] : ["skip", "keepBoth", "merge"];
}

export const RESOLUTION_LABEL: Record<ImportResolution, string> = {
  import: "Import",
  skip: "Skip",
  keepBoth: "Keep both",
  merge: "Merge",
};

export function importSummary(rows: ImportPreviewRow[], resolutions: Record<string, ImportResolution>): string {
  const count = (resolution: ImportResolution) => rows.filter((row) => (resolutions[row.filename] ?? defaultResolution(row)) === resolution).length;
  const written = count("import") + count("keepBoth");
  const merged = count("merge");
  const skipped = count("skip");
  const parts = [
    written ? `${written} to add` : "",
    merged ? `${merged} to merge` : "",
    skipped ? `${skipped} skipped` : "",
  ].filter(Boolean);
  return parts.join(" · ") || "Nothing to import";
}

/** Folders arrive as nested paths; the library only takes sequence files. */
export function importableFiles<T extends { name: string }>(files: T[], accepts: (name: string) => boolean): { accepted: T[]; ignored: T[] } {
  const accepted: T[] = [];
  const ignored: T[] = [];
  for (const file of files) {
    const base = file.name.split("/").pop() ?? file.name;
    if (base.startsWith(".")) continue;
    (accepts(base) ? accepted : ignored).push(file);
  }
  return { accepted, ignored };
}

// ---------------------------------------------------------------------------
// Local organisation store (until the engine stores it, HOM-153)
// ---------------------------------------------------------------------------

/**
 * Organisation the UI keeps for itself while the engine endpoints from HOM-153
 * are not available: collections, tags, colour, notes, names, and which
 * vectors this workspace imported. Keyed by library vector id.
 */
export type OrganizerState = {
  version: 1;
  collections: { id: string; name: string }[];
  members: Record<string, string[]>;
  tags: Record<string, string[]>;
  colors: Record<string, ColorLabel>;
  notes: Record<string, string>;
  names: Record<string, string>;
  imported: string[];
};

export const EMPTY_ORGANIZER: OrganizerState = { version: 1, collections: [], members: {}, tags: {}, colors: {}, notes: {}, names: {}, imported: [] };

export function parseOrganizer(raw: string | null): OrganizerState {
  if (!raw) return EMPTY_ORGANIZER;
  try {
    const value = JSON.parse(raw) as Partial<OrganizerState>;
    if (value?.version !== 1) return EMPTY_ORGANIZER;
    return {
      ...EMPTY_ORGANIZER,
      ...value,
      collections: Array.isArray(value.collections) ? value.collections.filter((entry) => entry && typeof entry.id === "string" && typeof entry.name === "string") : [],
      imported: Array.isArray(value.imported) ? value.imported : [],
    };
  } catch {
    return EMPTY_ORGANIZER;
  }
}

function latestUse(uses: { lastUsedAt?: string; firstUsedAt?: string }[]): string | undefined {
  let best: string | undefined;
  for (const use of uses) {
    const when = use.lastUsedAt ?? use.firstUsedAt;
    if (when && time(when) > time(best)) best = when;
  }
  return best;
}

/** Layer the local organisation over the engine's summaries. */
export function applyOrganizer(vectors: (LibraryVector & { createdAt?: string })[], state: OrganizerState): OrganizedVector[] {
  const known = new Set(state.collections.map((collection) => collection.id));
  return vectors.map((vector) => ({
    ...vector,
    name: (!vector.isStandard && state.names[vector.id]) || vector.name,
    notes: state.notes[vector.id] ?? vector.notes ?? "",
    lastUsedAt: vector.lastUsedAt ?? latestUse(vector.projects ?? []),
    provenance: vector.isStandard ? "standard" : state.imported.includes(vector.id) || !vector.projectCount ? "import" : "project",
    collectionIds: (state.members[vector.id] ?? []).filter((id) => known.has(id)),
    tags: state.tags[vector.id] ?? [],
    color: state.colors[vector.id] ?? null,
  }));
}

export function collectionList(state: OrganizerState, vectors: Pick<OrganizedVector, "collectionIds">[]): Collection[] {
  return state.collections.map((collection, position) => ({
    ...collection,
    position,
    count: vectors.filter((vector) => vector.collectionIds.includes(collection.id)).length,
  }));
}

export function setMembership(state: OrganizerState, ids: string[], collectionId: string, member: boolean): OrganizerState {
  const members = { ...state.members };
  for (const id of ids) {
    const current = members[id] ?? [];
    members[id] = member ? (current.includes(collectionId) ? current : [...current, collectionId]) : current.filter((entry) => entry !== collectionId);
  }
  return { ...state, members };
}

export function deleteCollection(state: OrganizerState, collectionId: string): OrganizerState {
  const members = Object.fromEntries(Object.entries(state.members).map(([id, list]) => [id, list.filter((entry) => entry !== collectionId)]));
  return { ...state, collections: state.collections.filter((collection) => collection.id !== collectionId), members };
}

/** Forget everything kept for vectors that no longer exist. */
export function forgetVectors(state: OrganizerState, ids: string[]): OrganizerState {
  const drop = new Set(ids);
  const keep = <V>(record: Record<string, V>) => Object.fromEntries(Object.entries(record).filter(([id]) => !drop.has(id)));
  return { ...state, members: keep(state.members), tags: keep(state.tags), colors: keep(state.colors), notes: keep(state.notes), names: keep(state.names), imported: state.imported.filter((id) => !drop.has(id)) };
}
