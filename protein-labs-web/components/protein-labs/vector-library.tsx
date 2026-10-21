"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, Check, CircleAlert, Database, Download, FileInput, FolderOpen, FolderPlus, Globe, Hash, LoaderCircle, PanelLeft, Search, Star, Trash2, Upload, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JsonObject, ProteinRecord } from "@/lib/protein-labs-api";
import { fileToBase64, proteinLabsApi } from "@/lib/protein-labs-api";
import {
  GIVE_UP_AFTER_MS,
  IMPORT_EXTENSIONS,
  SLOW_AFTER_MS,
  classifySourceError,
  filterBySize,
  idleSource,
  importEncoding,
  minimumQueryLength,
  sizeCounts,
  sourceStatusText,
  toggleFilter,
  type Filters,
  type MapFeature,
  type SourceState,
} from "@/lib/vector-library";
import {
  ALL_SCOPE,
  SMART_VIEWS,
  SORT_OPTIONS,
  addTags,
  clickSelect,
  copyName,
  defaultResolution,
  importableFiles,
  moveFocus,
  moveItem,
  pruneSelection,
  sameScope,
  type ColorLabel,
  type ImportResolution,
  type MoveKey,
  type OrganizedVector,
  type Scope,
  type SortKey,
  type SortOrder,
} from "@/lib/vector-library-organize";
import { createLibraryBackend, type ImportFile, type LibraryPage } from "@/lib/vector-library-backend";
import {
  BulkBar, EMPTY_ICONS, EmptyState, LibrarySidebar, MENU_ICONS, MenuButton, ResultSkeletons, ResultsToolbar, TableHeader, ToastStack, VECTOR_DRAG_TYPE, VectorCard, VectorRow,
  type ItemHandlers, type MenuEntry, type Toast,
} from "@/components/protein-labs/vector-library-parts";
import { ExternalPreview, LocalPreview, QuickLook, TagEditor, type ExternalResult, type SourceDescriptor } from "@/components/protein-labs/vector-library-preview";
import { ImportReview, filesFromDrop, type ReviewState } from "@/components/protein-labs/vector-library-import";

type Prefs = { layout: "grid" | "list"; sort: SortKey; order: SortOrder };
// A vector is renamed in one place at a time: its card or row, or the preview title.
type Renaming = { kind: "vector"; id: string; in: "item" | "preview" } | { kind: "collection"; id: string } | null;
type Status = { status: "loading" | "ready" | "error"; error: string };

const PREFS_KEY = "protein-labs-vector-library-prefs";
const UNDO_MS = 8000;
const DEFAULT_PREFS: Prefs = { layout: "grid", sort: "name", order: "asc" };

function readPrefs(): Prefs {
  try {
    const value = JSON.parse(localStorage.getItem(PREFS_KEY) ?? "{}") as Partial<Prefs>;
    return {
      layout: value.layout === "list" ? "list" : "grid",
      sort: SORT_OPTIONS.some((option) => option.id === value.sort) ? value.sort! : DEFAULT_PREFS.sort,
      order: value.order === "desc" ? "desc" : "asc",
    };
  } catch { return DEFAULT_PREFS; }
}

/**
 * The vector library: the user's whole collection of backbones, organised
 * into smart views, collections and tags, searched together with the public
 * backbone sources, with a preview and management of the chosen vector.
 *
 * As a page it is reachable from anywhere in the app and puts a vector into
 * any project. As a dialog inside Expression vector design it loads straight
 * into the open project.
 */
export function VectorLibrary({
  mode,
  proteins = [],
  projectId,
  onLoaded,
  onOpenProject,
  onClose,
}: {
  mode: "page" | "dialog";
  proteins?: ProteinRecord[];
  projectId?: string;
  onLoaded?: (vector: JsonObject, note: string) => Promise<void> | void;
  onOpenProject?: (proteinId: string) => void;
  onClose?: () => void;
}) {
  const backend = useMemo(() => createLibraryBackend(), []);
  const [prefs, setPrefs] = useState<Prefs>(DEFAULT_PREFS);
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [sizes, setSizes] = useState<string[]>([]);
  const [scope, setScope] = useState<Scope>(ALL_SCOPE);
  const [page, setPage] = useState<LibraryPage | null>(null);
  const [status, setStatus] = useState<Status>({ status: "loading", error: "" });
  const [reload, setReload] = useState(0);
  const [details, setDetails] = useState<Record<string, OrganizedVector | "error">>({});
  const [selected, setSelected] = useState<string[]>([]);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [focusId, setFocusId] = useState<string | null>(null);
  const [externalPick, setExternalPick] = useState<{ source: string; result: ExternalResult } | null>(null);
  const [renaming, setRenaming] = useState<Renaming>(null);
  const [quickLook, setQuickLook] = useState<string | null>(null);
  const [toasts, setToasts] = useState<Toast[]>([]);
  const [review, setReview] = useState<ReviewState | null>(null);
  const [pendingFiles, setPendingFiles] = useState<ImportFile[]>([]);
  const [resolutions, setResolutions] = useState<Record<string, ImportResolution>>({});
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [bulkTagOpen, setBulkTagOpen] = useState(false);
  const [sources, setSources] = useState<SourceDescriptor[]>([]);
  const [sourcesFailed, setSourcesFailed] = useState(false);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [sourceStates, setSourceStates] = useState<Record<string, SourceState>>({});
  const [external, setExternal] = useState<Record<string, ExternalResult[]>>({});
  const [snapgeneSets, setSnapgeneSets] = useState<{ id: string; name: string }[]>([]);
  const [snapgeneSet, setSnapgeneSet] = useState("");
  const [target, setTarget] = useState(projectId ?? "");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ text: string; proteinId?: string } | null>(null);
  const [failure, setFailure] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const folderRef = useRef<HTMLInputElement>(null);
  const resultsRef = useRef<HTMLDivElement>(null);
  const tagInputRef = useRef<HTMLInputElement>(null);
  const searchGeneration = useRef(0);
  const toastSeq = useRef(0);
  const pendingDeletes = useRef(new Map<number, { ids: string[]; timer: ReturnType<typeof setTimeout> }>());

  const targetId = projectId ?? (target || proteins[0]?.id || "");
  const targetName = proteins.find((protein) => protein.id === targetId)?.name ?? "this project";
  const scoped = useMemo(() => page?.vectors ?? [], [page]);
  const shown = useMemo(() => filterBySize(scoped, sizes), [scoped, sizes]);
  const shownIds = useMemo(() => shown.map((vector) => vector.id), [shown]);
  const sizeOptions = useMemo(() => sizeCounts(scoped), [scoped]);
  const collections = useMemo(() => page?.collections ?? [], [page]);
  const externalSources = sources.filter((source) => source.id !== "file");
  const focused = shown.find((vector) => vector.id === focusId) ?? null;
  const selectedVectors = shown.filter((vector) => selected.includes(vector.id));
  const quickVector = shown.find((vector) => vector.id === quickLook) ?? null;
  const scopeCollection = scope.kind === "collection" ? collections.find((collection) => collection.id === scope.id) : undefined;
  const filterCount = Object.values(filters).reduce((sum, values) => sum + (values?.length ?? 0), 0) + sizes.length;

  useEffect(() => { setPrefs(readPrefs()); }, []);
  const updatePrefs = (next: Partial<Prefs>) => setPrefs((current) => {
    const value = { ...current, ...next };
    try { localStorage.setItem(PREFS_KEY, JSON.stringify(value)); } catch { /* preferences are a convenience */ }
    return value;
  });

  // Typing settles before the catalogue and the remote sources are asked.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 220);
    return () => clearTimeout(timer);
  }, [query]);

  // The library, narrowed by the sidebar scope, the search and the facets.
  useEffect(() => {
    let active = true;
    setStatus((current) => ({ ...current, status: current.status === "error" ? "loading" : current.status }));
    backend.search({ query: debounced, filters, scope, sort: prefs.sort, order: prefs.order })
      .then((value) => {
        if (!active) return;
        setPage(value);
        setStatus({ status: "ready", error: "" });
        const ids = value.vectors.map((vector) => vector.id);
        setSelected((current) => pruneSelection(ids, current));
        setFocusId((current) => current && ids.includes(current) ? current : ids[0] ?? null);
      })
      .catch((reason: unknown) => { if (active) setStatus({ status: "error", error: message(reason) }); });
    return () => { active = false; };
  }, [backend, debounced, filters, scope, prefs.sort, prefs.order, reload]);

  // Card thumbnails need features, which only the full record carries.
  // Fetch a few at a time, in screen order, and keep them.
  const detailsRef = useRef(details);
  detailsRef.current = details;
  useEffect(() => {
    let active = true;
    const wanted = shown.filter((vector) => !vector.mapFeatures && detailsRef.current[vector.id] === undefined).slice(0, 120).map((vector) => vector.id);
    if (focusId && !detailsRef.current[focusId] && !wanted.includes(focusId)) wanted.unshift(focusId);
    if (!wanted.length) return;
    let next = 0;
    const worker = async () => {
      while (active && next < wanted.length) {
        const id = wanted[next++];
        try {
          const value = await backend.detail(id);
          if (active) setDetails((current) => ({ ...current, [id]: value }));
        } catch {
          if (active) setDetails((current) => ({ ...current, [id]: "error" }));
        }
      }
    };
    void Promise.all([worker(), worker(), worker(), worker()]);
    return () => { active = false; };
  }, [backend, shown, focusId]);

  useEffect(() => {
    proteinLabsApi.vectorSources()
      .then((value) => {
        const list = value.sources as unknown as SourceDescriptor[];
        setSources(list);
        setEnabled(Object.fromEntries(list.map((source) => [source.id, true])));
      })
      .catch(() => setSourcesFailed(true));
  }, []);

  // SnapGene groups its plasmids into sets; search the expression set by default.
  useEffect(() => {
    if (!sources.some((source) => source.id === "snapgene")) return;
    let active = true;
    proteinLabsApi.vectorSourceSets("snapgene")
      .then((value) => {
        if (!active) return;
        const list = value.sets as { id: string; name: string }[];
        setSnapgeneSets(list);
        setSnapgeneSet((current) => current || list.find((entry) => entry.id.includes("pet"))?.id || list[0]?.id || "");
      })
      .catch((reason: unknown) => { if (active) setSourceStates((current) => ({ ...current, snapgene: { status: classifySourceError(message(reason)), count: 0, message: message(reason) } })); });
    return () => { active = false; };
  }, [sources]);

  // Every enabled remote source is searched in parallel and reports its own
  // status, so one slow or offline service never hides the others.
  useEffect(() => {
    const generation = ++searchGeneration.current;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const term = debounced.trim();
    const kick = setTimeout(() => {
      for (const source of externalSources) {
        const id = source.id;
        if (!enabled[id]) { setSourceStates((current) => ({ ...current, [id]: idleSource })); setExternal((current) => ({ ...current, [id]: [] })); continue; }
        if (term.length < minimumQueryLength(id)) {
          setSourceStates((current) => ({ ...current, [id]: { status: term ? "waiting" : "idle", count: 0, message: "" } }));
          setExternal((current) => ({ ...current, [id]: [] }));
          continue;
        }
        if (id === "snapgene" && !snapgeneSet) continue;
        setSourceStates((current) => ({ ...current, [id]: { status: "searching", count: 0, message: "" } }));
        timers.push(setTimeout(() => {
          if (generation === searchGeneration.current) setSourceStates((current) => current[id]?.status === "searching" ? { ...current, [id]: { status: "slow", count: 0, message: "" } } : current);
        }, SLOW_AFTER_MS));
        const giveUp = new Promise<never>((_, reject) => timers.push(setTimeout(() => reject(new Error(`${source.name} timed out after ${GIVE_UP_AFTER_MS / 1000} s`)), GIVE_UP_AFTER_MS)));
        Promise.race([proteinLabsApi.searchVectorSources(id, term, id === "snapgene" ? snapgeneSet : "", 15), giveUp])
          .then((value) => {
            if (generation !== searchGeneration.current) return;
            const results = value.results as unknown as ExternalResult[];
            setExternal((current) => ({ ...current, [id]: results }));
            setSourceStates((current) => ({ ...current, [id]: { status: "done", count: results.length, message: "" } }));
          })
          .catch((reason: unknown) => {
            if (generation !== searchGeneration.current) return;
            setExternal((current) => ({ ...current, [id]: [] }));
            setSourceStates((current) => ({ ...current, [id]: { status: classifySourceError(message(reason)), count: 0, message: message(reason) } }));
          });
      }
    }, 0);
    return () => { clearTimeout(kick); timers.forEach(clearTimeout); };
    // externalSources is derived from `sources`.
  }, [debounced, enabled, sources, snapgeneSet]); // eslint-disable-line react-hooks/exhaustive-deps

  // A delete still waiting for its undo window is made permanent on the way out.
  useEffect(() => {
    const pending = pendingDeletes.current;
    return () => { for (const { ids, timer } of pending.values()) { clearTimeout(timer); void backend.purge(ids); } pending.clear(); };
  }, [backend]);

  // ---------------------------------------------------------------------------
  // Feedback
  // ---------------------------------------------------------------------------

  const dismissToast = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const toast = useCallback((text: string, options: { undo?: () => void; tone?: "info" | "error"; life?: number } = {}) => {
    const id = ++toastSeq.current;
    const life = options.life ?? (options.undo ? UNDO_MS : 4200);
    setToasts((current) => [...current.slice(-2), { id, text, undo: options.undo, tone: options.tone, life }]);
    setTimeout(() => dismissToast(id), life);
    return id;
  }, [dismissToast]);

  const fail = useCallback((reason: unknown) => { toast(message(reason), { tone: "error", life: 7000 }); }, [toast]);
  const refresh = () => setReload((value) => value + 1);
  const forgetDetails = (ids: string[]) => setDetails((current) => { const next = { ...current }; for (const id of ids) delete next[id]; return next; });

  // ---------------------------------------------------------------------------
  // Actions
  // ---------------------------------------------------------------------------

  async function loadVector(vector: OrganizedVector) {
    if (!targetId) { setFailure("Create a project first, then add a vector to it."); return; }
    setBusy(`use:${vector.id}`); setFailure(""); setNotice(null);
    try {
      const copy = await proteinLabsApi.copyLibraryVector(targetId, vector.id);
      if (onLoaded) await onLoaded(copy, `${vector.name} loaded from the vector library with ${vector.featureCount} annotations.`);
      else setNotice({ text: `${vector.name} was added to ${targetName}.`, proteinId: targetId });
      refresh();
    } catch (reason) { setFailure(message(reason)); }
    finally { setBusy(""); }
  }

  async function loadExternal(sourceId: string, result: ExternalResult) {
    if (!targetId) { setFailure("Create a project first, then add a vector to it."); return; }
    setBusy(`use:${sourceId}:${result.id}`); setFailure(""); setNotice(null);
    try {
      const vector = await proteinLabsApi.loadVectorFromSource(targetId, sourceId, result.id, result.set || (sourceId === "snapgene" ? snapgeneSet : ""));
      const added = Number((vector.annotationReport as JsonObject | undefined)?.added ?? 0);
      const features = Array.isArray(vector.features) ? vector.features.length : 0;
      const note = added ? `${result.name} loaded and annotated locally with ${added} features.` : `${result.name} loaded with ${features} curated annotations.`;
      if (onLoaded) await onLoaded(vector, note);
      else setNotice({ text: `${note} It is now in ${targetName}.`, proteinId: targetId });
      refresh();
    } catch (reason) { setFailure(message(reason)); }
    finally { setBusy(""); }
  }

  async function setFavorite(vectors: OrganizedVector[], favorite?: boolean) {
    if (!vectors.length) return;
    const value = favorite ?? !vectors.every((vector) => vector.favorite);
    try {
      await backend.update(vectors.map((vector) => vector.id), { favorite: value });
      if (vectors.length > 1) toast(`${value ? "Added" : "Removed"} ${vectors.length} vectors ${value ? "to" : "from"} favourites.`);
      refresh();
    } catch (reason) { fail(reason); }
  }

  async function renameVector(vector: OrganizedVector, name: string) {
    setRenaming(null);
    if (vector.isStandard) { fail(new Error(`${vector.name} is in the standard catalogue, so its name is read-only.`)); return; }
    try { await backend.update([vector.id], { name }); forgetDetails([vector.id]); refresh(); }
    catch (reason) { fail(reason); }
  }

  async function setColor(vectors: OrganizedVector[], color: ColorLabel | null) {
    try { await backend.update(vectors.map((vector) => vector.id), { color }); refresh(); }
    catch (reason) { fail(reason); }
  }

  async function setTags(vector: OrganizedVector, tags: string[]) {
    try { await backend.update([vector.id], { tags }); refresh(); }
    catch (reason) { fail(reason); }
  }

  async function tagMany(vectors: OrganizedVector[], tags: string[], add: boolean) {
    if (!vectors.length || !tags.length) return;
    try {
      await backend.tag(vectors.map((vector) => vector.id), tags, add);
      toast(`${add ? "Tagged" : "Untagged"} ${vectors.length === 1 ? vectors[0].name : `${vectors.length} vectors`} ${add ? "with" : "from"} ${tags.map((tag) => `#${tag}`).join(", ")}.`);
      refresh();
    } catch (reason) { fail(reason); }
  }

  async function saveNotes(vector: OrganizedVector, notes: string) {
    try { await backend.update([vector.id], { notes }); refresh(); }
    catch (reason) { fail(reason); }
  }

  async function addToCollection(ids: string[], collectionId: string) {
    const collection = collections.find((entry) => entry.id === collectionId);
    try {
      await backend.setCollection(ids, collectionId, true);
      toast(`Added ${ids.length === 1 ? (shown.find((vector) => vector.id === ids[0])?.name ?? "1 vector") : `${ids.length} vectors`} to ${collection?.name ?? "the collection"}.`);
      refresh();
    } catch (reason) { fail(reason); }
  }

  async function removeFromCollection(ids: string[], collectionId: string) {
    const collection = collections.find((entry) => entry.id === collectionId);
    try {
      await backend.setCollection(ids, collectionId, false);
      toast(`Removed ${ids.length === 1 ? "1 vector" : `${ids.length} vectors`} from ${collection?.name ?? "the collection"}.`, { undo: () => { void backend.setCollection(ids, collectionId, true).then(refresh); } });
      refresh();
    } catch (reason) { fail(reason); }
  }

  async function createCollection(withIds: string[] = []) {
    try {
      const collection = await backend.createCollection("New collection");
      if (withIds.length) await backend.setCollection(withIds, collection.id, true);
      setRenaming({ kind: "collection", id: collection.id });
      setSidebarOpen(true);
      refresh();
    } catch (reason) { fail(reason); }
  }

  async function renameCollection(id: string, name: string) {
    setRenaming(null);
    try { await backend.renameCollection(id, name); refresh(); }
    catch (reason) { fail(reason); }
  }

  async function deleteCollectionNamed(id: string, name: string) {
    try {
      await backend.deleteCollection(id);
      if (scope.kind === "collection" && scope.id === id) setScope(ALL_SCOPE);
      toast(`Deleted the collection ${name}. Its vectors are still in the library.`);
      refresh();
    } catch (reason) { fail(reason); }
  }

  async function reorderCollections(from: number, to: number) {
    if (to < 0 || to >= collections.length) return;
    try { await backend.reorderCollections(moveItem(collections.map((collection) => collection.id), from, to)); refresh(); }
    catch (reason) { fail(reason); }
  }

  async function duplicateVector(vector: OrganizedVector) {
    try {
      const id = await backend.duplicate(vector.id);
      await backend.update([id], { name: copyName(vector.name, shown.map((entry) => entry.name)) });
      setSelected([id]); setFocusId(id); setAnchor(id);
      setRenaming({ kind: "vector", id, in: "item" });
      toast(`Duplicated ${vector.name}.`);
      refresh();
    } catch (reason) { fail(reason); }
  }

  async function deleteVectors(vectors: OrganizedVector[]) {
    const removable = vectors.filter((vector) => !vector.isStandard);
    const kept = vectors.length - removable.length;
    if (!removable.length) { fail(new Error(kept === 1 ? `${vectors[0].name} is part of the standard catalogue and cannot be deleted.` : "Standard catalogue vectors cannot be deleted.")); return; }
    const ids = removable.map((vector) => vector.id);
    try {
      await backend.remove(ids);
      const label = removable.length === 1 ? removable[0].name : `${removable.length} vectors`;
      const toastId = toast(`Deleted ${label}.${kept ? ` ${kept} standard vector${kept === 1 ? " was" : "s were"} kept.` : ""}`, {
        undo: () => {
          const pending = pendingDeletes.current.get(toastId);
          if (pending) { clearTimeout(pending.timer); pendingDeletes.current.delete(toastId); }
          void backend.restore(ids).then(() => { setSelected(ids); refresh(); });
        },
      });
      pendingDeletes.current.set(toastId, {
        ids,
        timer: setTimeout(() => {
          pendingDeletes.current.delete(toastId);
          void backend.purge(ids).then(() => { forgetDetails(ids); refresh(); }).catch(fail);
        }, UNDO_MS),
      });
      // Move on to the neighbour, like a file manager.
      const remaining = shownIds.filter((id) => !ids.includes(id));
      const firstIndex = Math.min(...ids.map((id) => shownIds.indexOf(id)));
      const next = remaining[Math.min(firstIndex, remaining.length - 1)] ?? null;
      setSelected(next ? [next] : []); setFocusId(next); setAnchor(next);
      refresh();
    } catch (reason) { fail(reason); }
  }

  async function exportVectors(vectors: OrganizedVector[]) {
    if (!vectors.length) return;
    setBusy(vectors.length === 1 ? `dl:${vectors[0].id}` : "export");
    try {
      const { filename, blob } = await backend.exportGenBank(vectors.map((vector) => vector.id));
      const url = URL.createObjectURL(blob);
      const anchorElement = document.createElement("a");
      anchorElement.href = url; anchorElement.download = filename;
      document.body.appendChild(anchorElement); anchorElement.click(); anchorElement.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      toast(`${filename} downloaded.`);
    } catch (reason) { fail(new Error(`GenBank export failed: ${message(reason)}`)); }
    finally { setBusy(""); }
  }

  // ---------------------------------------------------------------------------
  // Import
  // ---------------------------------------------------------------------------

  async function importIntoProject(files: File[]) {
    const file = files[0];
    if (!file || !projectId) return;
    if (!importEncoding(file.name)) { setFailure(`${file.name} is not a sequence file. Drop GenBank (.gb, .gbk), FASTA (.fa, .fasta) or SnapGene (.dna) files.`); return; }
    setBusy(`import:${file.name}`); setFailure(""); setNotice(null);
    try {
      const content = importEncoding(file.name) === "base64" ? await fileToBase64(file) : await file.text();
      const vector = await proteinLabsApi.importVector(projectId, file.name, content);
      const features = Array.isArray(vector.features) ? vector.features.length : 0;
      await onLoaded?.(vector, `${file.name} imported with ${features} annotations.`);
    } catch (reason) { setFailure(`${file.name} could not be imported: ${message(reason)}`); }
    finally { setBusy(""); }
  }

  async function startImport(entries: { file: File; path: string }[]) {
    if (!entries.length) return;
    if (projectId) { await importIntoProject(entries.map((entry) => entry.file)); return; }
    const { accepted, ignored } = importableFiles(entries.map((entry) => ({ ...entry, name: entry.path })), (name) => Boolean(importEncoding(name)));
    if (!accepted.length) { fail(new Error(`${ignored.length === 1 ? ignored[0].path : `None of the ${ignored.length} files`} ${ignored.length === 1 ? "is not a sequence file" : "are sequence files"}. Use GenBank (.gb, .gbk), FASTA (.fa, .fasta) or SnapGene (.dna).`)); return; }
    setReview({ stage: "reading", count: accepted.length });
    setResolutions({});
    try {
      const seen = new Set<string>();
      const files: ImportFile[] = [];
      for (const entry of accepted) {
        let key = entry.path;
        for (let index = 2; seen.has(key); index += 1) key = `${entry.path} (${index})`;
        seen.add(key);
        const content = importEncoding(entry.file.name) === "base64" ? await fileToBase64(entry.file) : await entry.file.text();
        files.push({ filename: key, path: entry.path, content });
      }
      const rows = await backend.previewImport(files);
      setPendingFiles(files);
      setReview({ stage: "review", rows, ignored: ignored.map((entry) => entry.path) });
    } catch (reason) { setReview(null); fail(reason); }
  }

  async function commitImport() {
    if (review?.stage !== "review") return;
    setReview({ ...review, stage: "importing" });
    const decided = Object.fromEntries(review.rows.map((row) => [row.filename, resolutions[row.filename] ?? defaultResolution(row)]));
    try {
      const outcomes = await backend.commitImport(pendingFiles, decided);
      const added = outcomes.filter((outcome) => outcome.status === "added");
      const merged = outcomes.filter((outcome) => outcome.status === "merged");
      const failed = outcomes.filter((outcome) => outcome.status === "failed");
      setReview(null); setPendingFiles([]);
      const parts = [
        added.length ? `Imported ${added.length === 1 ? added[0].name : `${added.length} vectors`}.` : "",
        merged.length ? `${merged.length} merged into existing records.` : "",
        failed.length ? `${failed.length} could not be imported: ${failed.map((outcome) => `${outcome.filename} (${outcome.message})`).join("; ")}` : "",
      ].filter(Boolean);
      toast(parts.join(" ") || "Nothing was imported.", { tone: failed.length && !added.length ? "error" : "info", life: failed.length ? 9000 : 5000 });
      const ids = [...added, ...merged].map((outcome) => outcome.id).filter((id): id is string => Boolean(id));
      if (ids.length) {
        if (!sameScope(scope, ALL_SCOPE) && !sameScope(scope, { kind: "view", view: "imports" })) setScope({ kind: "view", view: "imports" });
        setSelected(ids); setFocusId(ids[0]); setAnchor(ids[0]);
      }
      refresh();
    } catch (reason) { setReview({ ...review, stage: "review" }); fail(reason); }
  }

  const dropHandlers = {
    onDragEnter: (event: React.DragEvent) => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); dragDepth.current += 1; setDragging(true); },
    onDragOver: (event: React.DragEvent) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } },
    onDragLeave: (event: React.DragEvent) => { if (!event.dataTransfer.types.includes("Files")) return; dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDrop: (event: React.DragEvent) => {
      if (!event.dataTransfer.types.includes("Files")) return;
      event.preventDefault(); dragDepth.current = 0; setDragging(false);
      void filesFromDrop(event.dataTransfer).then(startImport).catch(fail);
    },
  };

  // ---------------------------------------------------------------------------
  // Selection, menus and keyboard
  // ---------------------------------------------------------------------------

  function focusItem(id: string | null) {
    if (!id) return;
    requestAnimationFrame(() => {
      const element = document.getElementById(`vl-item-${id}`);
      element?.scrollIntoView({ block: "nearest" });
      element?.focus({ preventScroll: true });
    });
  }

  function pick(vector: OrganizedVector, modifiers: { shift?: boolean; toggle?: boolean }) {
    const next = clickSelect(shownIds, selected, anchor, vector.id, modifiers);
    setSelected(next.selected); setAnchor(next.anchor); setFocusId(vector.id); setExternalPick(null);
  }

  /** What a menu or shortcut acts on: the whole selection if the vector is part of it. */
  const targetsFor = (vector: OrganizedVector) => selected.includes(vector.id) && selected.length > 1 ? selectedVectors : [vector];

  function menuFor(vector: OrganizedVector): MenuEntry[] {
    const targets = targetsFor(vector);
    const many = targets.length > 1;
    const ids = targets.map((entry) => entry.id);
    const allFavorite = targets.every((entry) => entry.favorite);
    const colors = new Set(targets.map((entry) => entry.color));
    const tagNames = (page?.tags ?? []).map((tag) => tag.name);
    const editable = targets.some((entry) => !entry.isStandard);
    return [
      ...(many ? [{ kind: "label", label: `${targets.length} vectors` } as MenuEntry] : []),
      ...(!many ? [
        { kind: "item", label: mode === "dialog" ? "Load into this project" : "Use in project", icon: MENU_ICONS.open, shortcut: "Enter", disabled: !targetId, onSelect: () => void loadVector(vector) },
        { kind: "item", label: "Quick look", icon: MENU_ICONS.look, shortcut: "Space", onSelect: () => setQuickLook(vector.id) },
        { kind: "item", label: "Rename", icon: MENU_ICONS.rename, shortcut: "F2", disabled: vector.isStandard, onSelect: () => setRenaming({ kind: "vector", id: vector.id, in: "item" }) },
        { kind: "separator" },
      ] as MenuEntry[] : []),
      { kind: "item", label: allFavorite ? "Remove from favourites" : "Add to favourites", icon: MENU_ICONS.star, shortcut: "F", onSelect: () => void setFavorite(targets, !allFavorite) },
      { kind: "colors", value: colors.size === 1 ? [...colors][0] : "mixed", onSelect: (color) => void setColor(targets, color) },
      { kind: "sub", label: "Add to collection", icon: MENU_ICONS.collection, entries: [
        ...collections.map((collection): MenuEntry => ({ kind: "item", label: collection.name, icon: targets.every((entry) => entry.collectionIds.includes(collection.id)) ? MENU_ICONS.check : MENU_ICONS.collection, onSelect: () => void addToCollection(ids, collection.id) })),
        ...(collections.length ? [{ kind: "separator" } as MenuEntry] : []),
        { kind: "item", label: "New collection…", icon: MENU_ICONS.newCollection, onSelect: () => void createCollection(ids) },
      ] },
      ...(scopeCollection ? [{ kind: "item", label: `Remove from ${scopeCollection.name}`, icon: MENU_ICONS.remove, onSelect: () => void removeFromCollection(ids, scopeCollection.id) } as MenuEntry] : []),
      many
        ? { kind: "sub", label: "Tag", icon: MENU_ICONS.tag, entries: [
            ...tagNames.slice(0, 12).map((tag): MenuEntry => ({ kind: "item", label: `#${tag}`, onSelect: () => void tagMany(targets, [tag], true) })),
            ...(tagNames.length ? [{ kind: "separator" } as MenuEntry] : []),
            { kind: "item", label: "Tag or untag…", icon: MENU_ICONS.tag, onSelect: () => setBulkTagOpen(true) },
          ] }
        : { kind: "item", label: "Edit tags", icon: MENU_ICONS.tag, onSelect: () => { setFocusId(vector.id); requestAnimationFrame(() => tagInputRef.current?.focus()); } },
      { kind: "separator" },
      ...(!many ? [{ kind: "item", label: "Duplicate", icon: MENU_ICONS.copy, shortcut: "Ctrl+D", onSelect: () => void duplicateVector(vector) } as MenuEntry] : []),
      { kind: "item", label: many ? `Export ${targets.length} as GenBank` : "Export GenBank", icon: MENU_ICONS.download, onSelect: () => void exportVectors(targets) },
      { kind: "separator" },
      { kind: "item", label: many ? `Delete ${targets.filter((entry) => !entry.isStandard).length} vectors` : "Delete", icon: MENU_ICONS.trash, shortcut: "Del", danger: true, disabled: !editable, onSelect: () => void deleteVectors(targets) },
    ];
  }

  const handlers: ItemHandlers = {
    onClick: (event, vector) => pick(vector, { shift: event.shiftKey, toggle: event.ctrlKey || event.metaKey }),
    onCheck: (event, vector) => pick(vector, { shift: event.shiftKey, toggle: true }),
    onOpen: (vector) => void loadVector(vector),
    onFavorite: (vector) => void setFavorite([vector]),
    onDragStart: (event, vector) => {
      const ids = selected.includes(vector.id) ? selected : [vector.id];
      event.dataTransfer.setData(VECTOR_DRAG_TYPE, JSON.stringify(ids));
      event.dataTransfer.setData("text/plain", ids.map((id) => shown.find((entry) => entry.id === id)?.name ?? id).join("\n"));
      event.dataTransfer.effectAllowed = "copy";
    },
    onRename: (vector, name) => void renameVector(vector, name),
    onCancelRename: () => setRenaming(null),
    menu: menuFor,
    onMenuOpen: (vector) => { if (!selected.includes(vector.id)) pick(vector, {}); },
  };

  const focusSearch = useCallback(() => { searchRef.current?.focus(); searchRef.current?.select(); }, []);

  // The search shortcut also works when nothing inside the library has focus.
  useEffect(() => {
    const onWindowKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented) return;
      const editing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName));
      if ((event.key === "/" && !editing) || (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey))) { event.preventDefault(); focusSearch(); }
    };
    window.addEventListener("keydown", onWindowKey);
    return () => window.removeEventListener("keydown", onWindowKey);
  }, [focusSearch]);

  function gridColumns() {
    if (prefs.layout === "list") return 1;
    const grid = resultsRef.current?.querySelector(".vl-grid");
    if (!grid) return 1;
    return Math.max(1, getComputedStyle(grid).gridTemplateColumns.split(" ").filter(Boolean).length);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    if (event.defaultPrevented) return;
    const target = event.target as HTMLElement;
    const inSearch = target === searchRef.current;
    const typing = !inSearch && (target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(target.tagName));
    const inMenu = Boolean(target.closest("[role=menu]"));
    if (typing || inMenu || review) return;
    const mod = event.ctrlKey || event.metaKey;

    if (event.key === "Escape") {
      if (quickLook) { setQuickLook(null); event.preventDefault(); return; }
      if (bulkTagOpen) { setBulkTagOpen(false); event.preventDefault(); return; }
      if (selected.length > 1) { setSelected(focusId ? [focusId] : []); event.preventDefault(); return; }
      if (query) { setQuery(""); event.preventDefault(); return; }
      if (sidebarOpen) { setSidebarOpen(false); event.preventDefault(); return; }
      if (mode === "dialog") { onClose?.(); event.preventDefault(); }
      return;
    }

    const moves: MoveKey[] = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Home", "End", "PageUp", "PageDown"];
    if (moves.includes(event.key as MoveKey)) {
      // From the search box only Down leaves for the results; the others edit the text.
      if (inSearch && event.key !== "ArrowDown") return;
      if (target.tagName === "SELECT") return;
      if (!shownIds.length) return;
      event.preventDefault();
      const index = focusId ? shownIds.indexOf(focusId) : -1;
      const next = shownIds[moveFocus(inSearch ? -1 : index, event.key as MoveKey, gridColumns(), shownIds.length)];
      const vector = shown.find((entry) => entry.id === next);
      if (!vector) return;
      if (event.shiftKey) {
        const result = clickSelect(shownIds, selected, anchor ?? focusId, next, { shift: true });
        setSelected(result.selected); setAnchor(result.anchor); setFocusId(next); setExternalPick(null);
      } else pick(vector, {});
      focusItem(next);
      return;
    }
    if (inSearch) {
      if (event.key === "Enter" && focused) { event.preventDefault(); void loadVector(focused); }
      return;
    }
    // Shortcuts below act on the results, not on buttons elsewhere in the library.
    const onResults = Boolean(target.closest(".vl-results-body")) || target === event.currentTarget;
    if (!onResults && !(mod && event.key.toLowerCase() === "a")) return;

    if (mod && event.key.toLowerCase() === "a") {
      if (!onResults && target.closest(".vl-sidebar, .vl-preview")) return;
      event.preventDefault(); setSelected(shownIds); setAnchor(shownIds[0] ?? null); return;
    }
    if (mod && event.key.toLowerCase() === "d" && focused) { event.preventDefault(); void duplicateVector(focused); return; }
    if (event.key === " " && focused) { event.preventDefault(); setQuickLook((current) => current ? null : focused.id); return; }
    if (event.key === "Enter" && focused) { event.preventDefault(); void loadVector(focused); return; }
    if (event.key === "F2" && focused && !focused.isStandard) { event.preventDefault(); setRenaming({ kind: "vector", id: focused.id, in: "item" }); return; }
    if (!mod && event.key.toLowerCase() === "f" && focused) { event.preventDefault(); void setFavorite(targetsFor(focused)); return; }
    if ((event.key === "Delete" || event.key === "Backspace") && focused) { event.preventDefault(); void deleteVectors(targetsFor(focused)); return; }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  const scopeTitle = scope.kind === "view" ? SMART_VIEWS.find((view) => view.id === scope.view)?.label ?? "All vectors"
    : scope.kind === "collection" ? scopeCollection?.name ?? "Collection"
    : `#${scope.name}`;
  const searching = Boolean(debounced.trim()) || filterCount > 0;
  const externalHits = externalSources.filter((source) => (external[source.id] ?? []).length);
  const allSelected = shownIds.length > 0 && shownIds.every((id) => selected.includes(id));
  const checking = selected.length > 1;
  const featuresFor = (vector: OrganizedVector): MapFeature[] | "loading" | "error" => {
    if (vector.mapFeatures) return vector.mapFeatures;
    const detail = details[vector.id];
    return detail === undefined ? "loading" : detail === "error" ? "error" : detail.features ?? [];
  };

  function emptyState() {
    if (searching) return <EmptyState icon={EMPTY_ICONS.search} title={`No vector in ${scopeTitle} matches`} body={filterCount ? "Remove a filter, search all vectors, or check the public collections below." : "Try another name or feature, or check the public collections below."} action={<div className="vl-empty-actions">{filterCount > 0 && <Button size="sm" variant="outline" onClick={() => { setFilters({}); setSizes([]); }}>Clear filters</Button>}{!sameScope(scope, ALL_SCOPE) && <Button size="sm" variant="outline" onClick={() => setScope(ALL_SCOPE)}>Search all vectors</Button>}</div>}/>;
    if (scope.kind === "collection") return <EmptyState icon={EMPTY_ICONS.folder} title={`${scopeTitle} is empty`} body="Drag vectors onto this collection in the sidebar, or right-click a vector and choose Add to collection." action={<Button size="sm" variant="outline" onClick={() => setScope(ALL_SCOPE)}>Browse all vectors</Button>}/>;
    if (scope.kind === "tag") return <EmptyState icon={EMPTY_ICONS.tag} title={`Nothing is tagged ${scopeTitle}`} body="Add tags from a vector's preview or from the bulk bar."/>;
    switch (scope.view) {
      case "favorites": return <EmptyState icon={EMPTY_ICONS.star} title="No favourites yet" body="Press F or click the star on a vector to keep it here."/>;
      case "recent": return <EmptyState icon={EMPTY_ICONS.clock} title="Nothing used recently" body="Vectors you use in a project in the next 30 days appear here."/>;
      case "imports": return <EmptyState icon={EMPTY_ICONS.upload} title="You have not imported any vectors" body="Drop GenBank, FASTA or SnapGene files, or a whole folder, anywhere on the library." action={<Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload/> Import files</Button>}/>;
      case "unsorted": return <EmptyState icon={EMPTY_ICONS.inbox} title="Everything is sorted" body="Every vector is in a collection or has a tag."/>;
      default: return <EmptyState icon={EMPTY_ICONS.library} title="The library is empty" body="Import a vector file, or load one from the public collections." action={<Button size="sm" variant="outline" onClick={() => fileRef.current?.click()}><Upload/> Import files</Button>}/>;
    }
  }

  return <main className={`vlib vlib-${mode} ${sidebarOpen ? "sidebar-open" : ""}`} onKeyDown={onKeyDown} {...dropHandlers} aria-label="Vector library">
    <header className="vl-header">
      <div>
        <span className="eyebrow">VECTOR LIBRARY</span>
        <h1>{mode === "dialog" ? "Load a vector backbone" : "Vector library"}</h1>
        <p>{mode === "dialog" ? "Pick a backbone from your library or the public collections and load it into this project." : "Your backbones and the standard catalogue, organised into collections and tags, with the public collections one search away."}</p>
      </div>
      <div className="vl-header-actions">
        <input ref={fileRef} type="file" hidden multiple={!projectId} accept={IMPORT_EXTENSIONS.join(",")} onChange={(event) => { void startImport([...(event.target.files ?? [])].map((file) => ({ file, path: file.name }))); event.target.value = ""; }}/>
        <input ref={folderRef} type="file" hidden multiple {...{ webkitdirectory: "", directory: "" }} onChange={(event) => { void startImport([...(event.target.files ?? [])].map((file) => ({ file, path: file.webkitRelativePath || file.name }))); event.target.value = ""; }}/>
        {!projectId && <Button variant="outline" size="sm" onClick={() => folderRef.current?.click()}><FolderOpen/> Import folder</Button>}
        <Button variant="outline" size="sm" disabled={busy.startsWith("import:")} onClick={() => fileRef.current?.click()}>{busy.startsWith("import:") ? <LoaderCircle className="spin"/> : <Upload/>} {projectId ? "Import file" : "Import files"}</Button>
        {mode === "dialog" && <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close the vector library"><X/></Button>}
      </div>
    </header>

    <div className="vl-searchbar">
      <div className="vl-searchrow">
        <Button variant="outline" size="icon-sm" className="vl-sidebar-toggle" aria-expanded={sidebarOpen} aria-label="Show collections, tags and filters" title="Collections, tags and filters" onClick={() => setSidebarOpen((value) => !value)}><PanelLeft/></Button>
        <label className="vl-query">
          <Search/>
          <input ref={searchRef} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder={sameScope(scope, ALL_SCOPE) ? "Search by name, promoter, tag, marker or accession, e.g. pET28, His TEV, CMV" : `Search in ${scopeTitle}`} aria-label="Search vectors"/>
          {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X/></button>}
          <kbd>/</kbd>
        </label>
      </div>
      <div className="vl-sources" role="group" aria-label="Sources searched">
        <span className={`vl-source status-${status.status === "error" ? "offline" : status.status === "loading" ? "searching" : "done"}`} title="Your library is always searched">
          <Database/><strong>Library</strong><small>{status.status === "loading" ? "Loading…" : status.status === "error" ? "Engine offline" : `${shown.length} of ${page?.viewCounts.all ?? 0}`}</small>
        </span>
        {externalSources.map((source) => {
          const state = sourceStates[source.id] ?? idleSource;
          return <span key={source.id} className={`vl-source status-${enabled[source.id] ? state.status : "off"}`} title={state.message || source.summary}>
            <button role="switch" aria-checked={Boolean(enabled[source.id])} onClick={() => setEnabled((current) => ({ ...current, [source.id]: !current[source.id] }))}>
              {state.status === "offline" ? <WifiOff/> : state.status === "searching" || state.status === "slow" ? <LoaderCircle className="spin"/> : <Globe/>}
              <strong>{source.name}</strong>
              <small>{enabled[source.id] ? sourceStatusText(state, source.id) : "Off"}</small>
            </button>
            {source.id === "snapgene" && enabled.snapgene && snapgeneSets.length > 0 && <select value={snapgeneSet} onChange={(event) => setSnapgeneSet(event.target.value)} aria-label="SnapGene plasmid set">
              {snapgeneSets.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
            </select>}
          </span>;
        })}
        {sourcesFailed && <span className="vl-source status-offline"><WifiOff/><strong>Public collections</strong><small>Unavailable</small></span>}
      </div>
    </div>

    {(notice || failure) && <div className={`vl-banner ${failure ? "failure" : ""}`} role="status">
      {failure ? <CircleAlert/> : <Check/>}
      <span>{failure || notice?.text}</span>
      {!failure && notice?.proteinId && onOpenProject && <Button size="sm" variant="outline" onClick={() => onOpenProject(notice.proteinId!)}>Open in Expression vector design <ArrowRight/></Button>}
      <button onClick={() => { setFailure(""); setNotice(null); }} aria-label="Dismiss"><X/></button>
    </div>}

    <div className="vl-body">
      <div className="vl-sidebar-shell">
        <LibrarySidebar
          scope={scope}
          onScope={(next) => { setScope(next); setSidebarOpen(false); }}
          viewCounts={page?.viewCounts ?? null}
          collections={collections}
          tags={page?.tags ?? []}
          facets={page?.facets ?? {}}
          filters={filters}
          sizes={sizes}
          sizeOptions={sizeOptions}
          renamingCollection={renaming?.kind === "collection" ? renaming.id : null}
          onToggleFilter={(key, value) => setFilters((current) => toggleFilter(current, key, value))}
          onToggleSize={(value) => setSizes((current) => current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value])}
          onClearFilters={() => { setFilters({}); setSizes([]); }}
          onCreateCollection={() => void createCollection()}
          onRenameCollection={(id, name) => void renameCollection(id, name)}
          onStartRename={(id) => setRenaming({ kind: "collection", id })}
          onCancelRename={() => setRenaming(null)}
          onDeleteCollection={(collection) => void deleteCollectionNamed(collection.id, collection.name)}
          onReorder={(from, to) => void reorderCollections(from, to)}
          onDropVectors={(collectionId, ids) => void addToCollection(ids, collectionId)}
        />
        {backend.kind === "local" && <p className="vl-side-footnote">Collections, tags, labels and notes are kept on this computer.</p>}
      </div>
      {sidebarOpen && <div className="vl-sidebar-scrim" onClick={() => setSidebarOpen(false)} aria-hidden="true"/>}

      <section className="vl-results" aria-label="Results" ref={resultsRef}>
        <div className="vl-results-head">
          <span className="vl-scope-title">
            <h2>{scopeTitle}</h2>
            <small>{status.status === "ready" ? `${shown.length} vector${shown.length === 1 ? "" : "s"}${searching ? " match" : ""}` : status.status === "loading" ? "Loading…" : ""}</small>
          </span>
          <ResultsToolbar
            layout={prefs.layout}
            onLayout={(layout) => updatePrefs({ layout })}
            sort={prefs.sort}
            order={prefs.order}
            onSort={(sort) => updatePrefs({ sort, order: SORT_OPTIONS.find((option) => option.id === sort)?.defaultOrder ?? "asc" })}
            onOrder={() => updatePrefs({ order: prefs.order === "asc" ? "desc" : "asc" })}
          />
        </div>

        {selected.length > 1 && <BulkBar count={selected.length} total={shown.length} onClear={() => setSelected(focusId ? [focusId] : [])} onSelectAll={() => setSelected(shownIds)}>
          <MenuButton icon={<FolderPlus/>} label="Add to collection" entries={() => [
            ...collections.map((collection): MenuEntry => ({ kind: "item", label: collection.name, icon: MENU_ICONS.collection, onSelect: () => void addToCollection(selected, collection.id) })),
            ...(collections.length ? [{ kind: "separator" } as MenuEntry] : []),
            { kind: "item", label: "New collection…", icon: MENU_ICONS.newCollection, onSelect: () => void createCollection(selected) },
          ]}/>
          {scopeCollection && <Button variant="outline" size="sm" onClick={() => void removeFromCollection(selected, scopeCollection.id)}><X/> Remove from {scopeCollection.name}</Button>}
          <span className="vl-bulk-tag">
            <Button variant="outline" size="sm" aria-expanded={bulkTagOpen} onClick={() => setBulkTagOpen((value) => !value)}><Hash/> Tag</Button>
            {bulkTagOpen && <BulkTagPopover vectors={selectedVectors} suggestions={(page?.tags ?? []).map((tag) => tag.name)} onAdd={(tags) => void tagMany(selectedVectors, tags, true)} onRemove={(tags) => void tagMany(selectedVectors, tags, false)} onClose={() => setBulkTagOpen(false)}/>}
          </span>
          <Button variant="outline" size="sm" onClick={() => void setFavorite(selectedVectors)}><Star/> {selectedVectors.every((vector) => vector.favorite) ? "Unfavourite" : "Favourite"}</Button>
          <Button variant="outline" size="sm" disabled={busy === "export"} onClick={() => void exportVectors(selectedVectors)}>{busy === "export" ? <LoaderCircle className="spin"/> : <Download/>} Export</Button>
          <Button variant="outline" size="sm" className="vl-danger" disabled={selectedVectors.every((vector) => vector.isStandard)} onClick={() => void deleteVectors(selectedVectors)}><Trash2/> Delete</Button>
        </BulkBar>}

        <div className={`vl-results-body ${status.status === "loading" && page ? "refreshing" : ""}`} role="listbox" aria-multiselectable="true" aria-label={`${scopeTitle} vectors`} aria-activedescendant={undefined} tabIndex={shown.length ? -1 : 0}>
          {status.status === "error" && <EmptyState icon={<CircleAlert/>} title="The vector library is unavailable" body={`${status.error}. Start the local engine and the library loads here.`} action={<Button size="sm" variant="outline" onClick={refresh}>Retry</Button>}/>}
          {status.status === "loading" && !page && <ResultSkeletons layout={prefs.layout}/>}
          {status.status !== "error" && page && !shown.length && emptyState()}
          {page && shown.length > 0 && (prefs.layout === "grid"
            ? <div className="vl-grid">
                {shown.map((vector) => <VectorCard key={vector.id} vector={vector} features={featuresFor(vector)} selected={selected.includes(vector.id)} focused={vector.id === (focusId ?? shownIds[0])} renaming={renaming?.kind === "vector" && renaming.in === "item" && renaming.id === vector.id} checking={checking} handlers={handlers}/>)}
              </div>
            : <div className={`vl-table ${checking ? "checking" : ""}`}>
                <TableHeader sort={prefs.sort} order={prefs.order} onSort={(sort) => updatePrefs(sort === prefs.sort ? { order: prefs.order === "asc" ? "desc" : "asc" } : { sort, order: SORT_OPTIONS.find((option) => option.id === sort)?.defaultOrder ?? "asc" })} allSelected={allSelected} someSelected={selected.length > 0} onSelectAll={() => setSelected(allSelected ? [] : shownIds)}/>
                {shown.map((vector) => <VectorRow key={vector.id} vector={vector} selected={selected.includes(vector.id)} focused={vector.id === (focusId ?? shownIds[0])} renaming={renaming?.kind === "vector" && renaming.in === "item" && renaming.id === vector.id} handlers={handlers}/>)}
              </div>)}

          {externalSources.length > 0 && debounced.trim() && <div className="vl-public">
            <div className="vl-section-head">
              <strong>Public collections</strong>
              <small>Annotated locally when loaded</small>
            </div>
            {externalSources.filter((source) => enabled[source.id] && ["offline", "error", "slow"].includes(sourceStates[source.id]?.status ?? "")).map((source) => {
              const state = sourceStates[source.id];
              return <div key={source.id} className={`vl-source-note status-${state.status}`}>
                {state.status === "slow" ? <LoaderCircle className="spin"/> : <WifiOff/>}
                <span><strong>{source.name}: {sourceStatusText(state, source.id)}</strong><small>{state.status === "slow" ? "Remote services can take a while. Library results above are already complete." : state.message}</small></span>
              </div>;
            })}
            {externalHits.map((source) => <div key={source.id} className="vl-external-group">
              <span className="vl-external-head"><Globe/> {source.name}<small>{(external[source.id] ?? []).length} shown</small></span>
              <div className="vl-list" role="group" aria-label={`${source.name} results`}>
                {(external[source.id] ?? []).map((result) => <button
                  key={`${source.id}-${result.id}-${result.name}`}
                  aria-pressed={externalPick?.source === source.id && externalPick.result.id === result.id}
                  className="vl-row external"
                  onClick={() => setExternalPick({ source: source.id, result })}
                  onDoubleClick={() => void loadExternal(source.id, result)}
                >
                  <span className="vl-row-size">{result.lengthBp ? (result.lengthBp / 1000).toFixed(1) : "–"}<small>kb</small></span>
                  <span className="vl-row-main"><strong>{result.name}</strong><small>{result.description || result.id}</small></span>
                  <span className="vl-row-meta"><em>{source.name}</em></span>
                </button>)}
              </div>
            </div>)}
            {!externalHits.length && externalSources.every((source) => !enabled[source.id] || ["done", "idle", "waiting"].includes(sourceStates[source.id]?.status ?? "idle")) && <p className="vl-public-empty">No public-collection matches for “{debounced.trim()}”.</p>}
          </div>}
        </div>
      </section>

      <aside className="vl-preview" aria-label="Preview">
        {externalPick
          ? <ExternalPreview
              source={externalSources.find((source) => source.id === externalPick.source)}
              result={externalPick.result}
              busy={busy === `use:${externalPick.source}:${externalPick.result.id}`}
              mode={mode}
              proteins={proteins}
              projectId={projectId}
              targetId={targetId}
              onTarget={setTarget}
              onUse={() => void loadExternal(externalPick.source, externalPick.result)}
            />
          : selected.length > 1
          ? <SelectionSummary vectors={selectedVectors}/>
          : focused
          ? <LocalPreview
              key={focused.id}
              vector={focused}
              detail={details[focused.id]}
              busy={busy}
              mode={mode}
              proteins={proteins}
              projectId={projectId}
              targetId={targetId}
              collections={collections}
              tagSuggestions={(page?.tags ?? []).map((tag) => tag.name)}
              renaming={renaming?.kind === "vector" && renaming.in === "preview" && renaming.id === focused.id}
              tagInputRef={tagInputRef}
              onTarget={setTarget}
              onUse={() => void loadVector(focused)}
              onFavorite={() => void setFavorite([focused])}
              onDownload={() => void exportVectors([focused])}
              onRename={(name) => void renameVector(focused, name)}
              onStartRename={() => setRenaming({ kind: "vector", id: focused.id, in: "preview" })}
              onCancelRename={() => setRenaming(null)}
              onColor={(color) => void setColor([focused], color)}
              onTags={(tags) => void setTags(focused, tags)}
              onNotes={(notes) => void saveNotes(focused, notes)}
              onRemoveFromCollection={(collectionId) => void removeFromCollection([focused.id], collectionId)}
              menu={() => menuFor(focused)}
            />
          : <div className="vl-preview-empty"><Database/><strong>Select a vector to preview it</strong><small>Arrow keys move, Space opens a quick look, Enter uses the vector.</small></div>}
      </aside>
    </div>

    {quickVector && <QuickLook vector={quickVector} detail={details[quickVector.id]} mode={mode} onClose={() => { setQuickLook(null); focusItem(quickVector.id); }} onUse={() => { setQuickLook(null); void loadVector(quickVector); }}/>}

    {review && <ImportReview
      state={review}
      resolutions={resolutions}
      onResolve={(filename, resolution) => setResolutions((current) => ({ ...current, [filename]: resolution }))}
      onResolveAll={(resolution) => setResolutions((current) => ({ ...current, ...Object.fromEntries((review.stage === "reading" ? [] : review.rows).filter((row) => row.status === "duplicate").map((row) => [row.filename, resolution === "merge" && row.duplicateOf?.isStandard ? "skip" : resolution])) }))}
      onCancel={() => { setReview(null); setPendingFiles([]); }}
      onCommit={() => void commitImport()}
    />}

    <ToastStack toasts={toasts} onDismiss={dismissToast}/>

    {dragging && <div className="vl-drop" aria-hidden="true">
      <FileInput/>
      <strong>Drop to import into {projectId ? "this project" : "the library"}</strong>
      <small>{projectId ? "GenBank (.gb, .gbk), FASTA (.fa, .fasta) or SnapGene (.dna)" : "Files or whole folders: GenBank (.gb, .gbk), FASTA (.fa, .fasta) or SnapGene (.dna). You review duplicates before anything is added."}</small>
    </div>}
  </main>;
}

/** The preview column while several vectors are selected. */
function SelectionSummary({ vectors }: { vectors: OrganizedVector[] }) {
  const total = vectors.reduce((sum, vector) => sum + vector.lengthBp, 0);
  const standard = vectors.filter((vector) => vector.isStandard).length;
  return <div className="vl-selection-summary">
    <span className="vl-selection-stack" aria-hidden="true">{vectors.slice(0, 3).map((vector, index) => <i key={vector.id} style={{ "--n": index } as React.CSSProperties}/>)}</span>
    <strong>{vectors.length} vectors selected</strong>
    <small>{(total / 1000).toFixed(1)} kb in total{standard ? ` · ${standard} from the standard catalogue (read-only)` : ""}</small>
    <ul>{vectors.slice(0, 8).map((vector) => <li key={vector.id}>{vector.name}</li>)}{vectors.length > 8 && <li>and {vectors.length - 8} more</li>}</ul>
    <small className="vl-selection-hint">Use the bar above the results, or right-click, to act on all of them. <kbd>Esc</kbd> clears the selection.</small>
  </div>;
}

function BulkTagPopover({ vectors, suggestions, onAdd, onRemove, onClose }: { vectors: OrganizedVector[]; suggestions: string[]; onAdd: (tags: string[]) => void; onRemove: (tags: string[]) => void; onClose: () => void }) {
  const inputRef = useRef<HTMLInputElement>(null);
  useEffect(() => { inputRef.current?.focus(); }, []);
  const present = addTags([], vectors.flatMap((vector) => vector.tags));
  return <div className="vl-popover" role="dialog" aria-label={`Tag ${vectors.length} vectors`} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); onClose(); } }}>
    <header><strong>Tag {vectors.length} vectors</strong><button onClick={onClose} aria-label="Close"><X/></button></header>
    <TagEditor tags={[]} suggestions={suggestions} inputRef={inputRef} onChange={(tags) => onAdd(tags)}/>
    {present.length > 0 && <div className="vl-popover-section"><small>On the selection. Click to remove from all:</small><div>{present.map((tag) => <button key={tag} className="vl-tag-pill removable" onClick={() => onRemove([tag])}><Hash/>{tag}<X/></button>)}</div></div>}
    {suggestions.filter((tag) => !present.some((entry) => entry.toLowerCase() === tag.toLowerCase())).length > 0 && <div className="vl-popover-section"><small>Add an existing tag:</small><div>{suggestions.filter((tag) => !present.some((entry) => entry.toLowerCase() === tag.toLowerCase())).slice(0, 12).map((tag) => <button key={tag} className="vl-tag-pill" onClick={() => onAdd([tag])}><Hash/>{tag}</button>)}</div></div>}
  </div>;
}

function message(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
