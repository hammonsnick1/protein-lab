"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CircleAlert, Clock, Database, Download, ExternalLink, FileInput, Globe, LoaderCircle, Search, Star, Upload, WifiOff, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JsonObject, ProteinRecord } from "@/lib/protein-labs-api";
import { fileToBase64, proteinLabsApi } from "@/lib/protein-labs-api";
import {
  FACETS,
  GIVE_UP_AFTER_MS,
  IMPORT_EXTENSIONS,
  KIND_STYLE,
  SIZE_BUCKETS,
  SLOW_AFTER_MS,
  activeFilterCount,
  arcPath,
  assignRings,
  classifySourceError,
  facetOptions,
  featureKind,
  filterBySize,
  formatBp,
  idleSource,
  importEncoding,
  keyFeatures,
  librarySearchParams,
  minimumQueryLength,
  sizeCounts,
  sourceStatusText,
  toggleFilter,
  vectorTagline,
  type FacetCounts,
  type FacetKey,
  type Filters,
  type LibraryVector,
  type MapFeature,
  type SourceState,
} from "@/lib/vector-library";

type SourceDescriptor = { id: string; name: string; summary: string; needsSet: boolean; annotated: boolean; attribution: string };
type ExternalResult = { id: string; name: string; description: string; lengthBp: number | null; set: string };
type Selection = { kind: "local"; id: string } | { kind: "external"; source: string; result: ExternalResult } | null;
type LocalState = { status: "loading" | "ready" | "error"; vectors: LibraryVector[]; total: number; facets: FacetCounts; error: string };

/**
 * The vector library: one search over the local catalogue and the external
 * backbone sources, narrowed by facets, with a preview of the chosen vector.
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
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [sizes, setSizes] = useState<string[]>([]);
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [local, setLocal] = useState<LocalState>({ status: "loading", vectors: [], total: 0, facets: {}, error: "" });
  const [reload, setReload] = useState(0);
  const [recent, setRecent] = useState<LibraryVector[]>([]);
  const [favorites, setFavorites] = useState<LibraryVector[]>([]);
  const [sources, setSources] = useState<SourceDescriptor[]>([]);
  const [sourcesFailed, setSourcesFailed] = useState(false);
  const [enabled, setEnabled] = useState<Record<string, boolean>>({});
  const [sourceStates, setSourceStates] = useState<Record<string, SourceState>>({});
  const [external, setExternal] = useState<Record<string, ExternalResult[]>>({});
  const [snapgeneSets, setSnapgeneSets] = useState<{ id: string; name: string }[]>([]);
  const [snapgeneSet, setSnapgeneSet] = useState("");
  const [selection, setSelection] = useState<Selection>(null);
  const [details, setDetails] = useState<Record<string, LibraryVector | "error">>({});
  const [target, setTarget] = useState(projectId ?? "");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState<{ text: string; proteinId?: string } | null>(null);
  const [failure, setFailure] = useState("");
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  const searchRef = useRef<HTMLInputElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const searchGeneration = useRef(0);

  const targetId = projectId ?? (target || proteins[0]?.id || "");
  const targetName = proteins.find((protein) => protein.id === targetId)?.name ?? "this project";
  const browsing = !debounced.trim() && !activeFilterCount(filters, sizes) && !favoritesOnly;
  const shown = useMemo(() => filterBySize(local.vectors, sizes), [local.vectors, sizes]);
  const sizeOptions = useMemo(() => sizeCounts(local.vectors), [local.vectors]);
  const externalSources = sources.filter((source) => source.id !== "file");
  const selectedLocal = selection?.kind === "local"
    ? (details[selection.id] && details[selection.id] !== "error" ? details[selection.id] as LibraryVector : [...shown, ...recent, ...favorites].find((vector) => vector.id === selection.id) ?? null)
    : null;

  // Typing settles before the catalogue and the remote sources are asked.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 220);
    return () => clearTimeout(timer);
  }, [query]);

  // Local catalogue: server-side text and facet search with counts.
  useEffect(() => {
    let active = true;
    const params = librarySearchParams({ query: debounced, filters, favorite: favoritesOnly ? true : undefined });
    proteinLabsApi.searchVectorLibrary(params)
      .then((value) => {
        if (!active) return;
        const vectors = value.vectors as unknown as LibraryVector[];
        setLocal({ status: "ready", vectors, total: value.total, facets: value.facets as FacetCounts, error: "" });
        // Keep the preview on something the researcher can see in the list.
        setSelection((current) => current && (current.kind === "external" || vectors.some((vector) => vector.id === current.id))
          ? current
          : vectors[0] ? { kind: "local", id: vectors[0].id } : null);
      })
      .catch((reason: unknown) => { if (active) setLocal((current) => ({ ...current, status: "error", error: message(reason) })); });
    return () => { active = false; };
  }, [debounced, filters, favoritesOnly, reload]);

  // Recent and favourite vectors stay pinned above the results.
  useEffect(() => {
    let active = true;
    Promise.all([
      proteinLabsApi.recentLibraryVectors(8),
      proteinLabsApi.searchVectorLibrary(librarySearchParams({ query: "", filters: {}, favorite: true, limit: 20 })),
    ])
      .then(([recentValue, favoriteValue]) => {
        if (!active) return;
        setRecent(recentValue.vectors as unknown as LibraryVector[]);
        setFavorites(favoriteValue.vectors as unknown as LibraryVector[]);
      })
      .catch(() => { /* The main search reports an unreachable engine. */ });
    return () => { active = false; };
  }, [reload]);

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

  // The preview needs features and sequence, which only the full record has.
  const selectedId = selection?.kind === "local" ? selection.id : "";
  useEffect(() => {
    if (!selectedId || details[selectedId]) return;
    let active = true;
    proteinLabsApi.getLibraryVector(selectedId)
      .then((value) => { if (active) setDetails((current) => ({ ...current, [selectedId]: value as unknown as LibraryVector })); })
      .catch(() => { if (active) setDetails((current) => ({ ...current, [selectedId]: "error" })); });
    return () => { active = false; };
  }, [selectedId, details]);

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

  // Arrows walk the results, Enter uses the vector, Escape clears then closes.
  function onKeyDown(event: React.KeyboardEvent) {
    const typing = event.target instanceof HTMLInputElement || event.target instanceof HTMLSelectElement;
    if (event.key === "Escape") {
      if (query) { setQuery(""); event.preventDefault(); return; }
      if (mode === "dialog") { onClose?.(); event.preventDefault(); }
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      if (event.target instanceof HTMLSelectElement) return;
      const ids = shown.map((vector) => vector.id);
      if (!ids.length) return;
      event.preventDefault();
      const index = selection?.kind === "local" ? ids.indexOf(selection.id) : -1;
      const next = event.key === "ArrowDown" ? Math.min(ids.length - 1, index + 1) : Math.max(0, index - 1);
      setSelection({ kind: "local", id: ids[next] });
      document.getElementById(`vl-row-${ids[next]}`)?.scrollIntoView({ block: "nearest" });
      return;
    }
    if (event.key === "Enter" && !typing && selection) { event.preventDefault(); void addSelection(); }
  }

  async function addLocal(vector: LibraryVector) {
    if (!targetId) { setFailure("Create a project first, then add a vector to it."); return; }
    setBusy(`use:${vector.id}`); setFailure(""); setNotice(null);
    try {
      const copy = await proteinLabsApi.copyLibraryVector(targetId, vector.id);
      if (onLoaded) await onLoaded(copy, `${vector.name} loaded from the vector library with ${vector.featureCount} annotations.`);
      else setNotice({ text: `${vector.name} was added to ${targetName}.`, proteinId: targetId });
      setReload((value) => value + 1);
    } catch (reason) { setFailure(message(reason)); }
    finally { setBusy(""); }
  }

  async function addExternal(sourceId: string, result: ExternalResult) {
    if (!targetId) { setFailure("Create a project first, then add a vector to it."); return; }
    setBusy(`use:${sourceId}:${result.id}`); setFailure(""); setNotice(null);
    try {
      const vector = await proteinLabsApi.loadVectorFromSource(targetId, sourceId, result.id, result.set || (sourceId === "snapgene" ? snapgeneSet : ""));
      const added = Number((vector.annotationReport as JsonObject | undefined)?.added ?? 0);
      const features = Array.isArray(vector.features) ? vector.features.length : 0;
      const note = added ? `${result.name} loaded and annotated locally with ${added} features.` : `${result.name} loaded with ${features} curated annotations.`;
      if (onLoaded) await onLoaded(vector, note);
      else setNotice({ text: `${note} It is now in ${targetName}.`, proteinId: targetId });
      setReload((value) => value + 1);
    } catch (reason) { setFailure(message(reason)); }
    finally { setBusy(""); }
  }

  async function addSelection() {
    if (selection?.kind === "local" && selectedLocal) await addLocal(selectedLocal);
    if (selection?.kind === "external") await addExternal(selection.source, selection.result);
  }

  async function toggleFavorite(vector: LibraryVector) {
    setBusy(`fav:${vector.id}`); setFailure("");
    try {
      const updated = await proteinLabsApi.setLibraryFavorite(vector.id, !vector.favorite) as unknown as LibraryVector;
      setDetails((current) => current[vector.id] && current[vector.id] !== "error" ? { ...current, [vector.id]: { ...(current[vector.id] as LibraryVector), favorite: updated.favorite } } : current);
      setReload((value) => value + 1);
    } catch (reason) { setFailure(message(reason)); }
    finally { setBusy(""); }
  }

  async function downloadGenBank(vector: LibraryVector) {
    setBusy(`dl:${vector.id}`); setFailure("");
    try {
      const file = await proteinLabsApi.exportLibraryVector(vector.id, "genbank");
      const url = URL.createObjectURL(new Blob([file.content], { type: "chemical/seq-na-genbank" }));
      const anchor = document.createElement("a");
      anchor.href = url; anchor.download = file.filename || `${vector.name}.gb`;
      document.body.appendChild(anchor); anchor.click(); anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      setNotice({ text: `${file.filename || `${vector.name}.gb`} downloaded.` });
    } catch (reason) { setFailure(`GenBank download failed: ${message(reason)}`); }
    finally { setBusy(""); }
  }

  async function importFiles(files: File[]) {
    if (!files.length) return;
    setFailure(""); setNotice(null);
    const rejected = files.filter((file) => !importEncoding(file.name));
    if (rejected.length) { setFailure(`${rejected.map((file) => file.name).join(", ")} is not a sequence file. Drop GenBank (.gb, .gbk), FASTA (.fa, .fasta) or SnapGene (.dna) files.`); return; }
    const imported: string[] = [];
    for (const file of files) {
      setBusy(`import:${file.name}`);
      try {
        const content = importEncoding(file.name) === "base64" ? await fileToBase64(file) : await file.text();
        if (projectId) {
          const vector = await proteinLabsApi.importVector(projectId, file.name, content);
          const features = Array.isArray(vector.features) ? vector.features.length : 0;
          await onLoaded?.(vector, `${file.name} imported with ${features} annotations.`);
          return;
        }
        const vector = await proteinLabsApi.importLibraryVector(file.name, content);
        imported.push(vector.duplicate ? `${String(vector.name)} (already in the library)` : String(vector.name));
        setSelection({ kind: "local", id: String(vector.id) });
      } catch (reason) { setFailure(`${file.name} could not be imported: ${message(reason)}`); }
      finally { setBusy(""); }
    }
    if (imported.length) { setNotice({ text: `Imported ${imported.join(", ")}.` }); setReload((value) => value + 1); }
  }

  const dropHandlers = {
    onDragEnter: (event: React.DragEvent) => { if (!event.dataTransfer.types.includes("Files")) return; event.preventDefault(); dragDepth.current += 1; setDragging(true); },
    onDragOver: (event: React.DragEvent) => { if (event.dataTransfer.types.includes("Files")) { event.preventDefault(); event.dataTransfer.dropEffect = "copy"; } },
    onDragLeave: () => { dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); },
    onDrop: (event: React.DragEvent) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); void importFiles([...event.dataTransfer.files]); },
  };

  const externalHits = externalSources.filter((source) => (external[source.id] ?? []).length);
  const standardCount = local.vectors.filter((vector) => vector.isStandard).length;

  return <main className={`vlib vlib-${mode}`} onKeyDown={onKeyDown} {...dropHandlers} aria-label="Vector library">
    <header className="vl-header">
      <div>
        <span className="eyebrow">VECTOR LIBRARY</span>
        <h1>{mode === "dialog" ? "Load a vector backbone" : "Find a backbone"}</h1>
        <p>{mode === "dialog" ? "Search the library and the public collections, then load the backbone into this project." : "Standard expression vectors, your saved constructs, and the public collections in one search."}</p>
      </div>
      <div className="vl-header-actions">
        <input ref={fileRef} type="file" hidden multiple accept={IMPORT_EXTENSIONS.join(",")} onChange={(event) => { void importFiles([...(event.target.files ?? [])]); event.target.value = ""; }}/>
        <Button variant="outline" size="sm" disabled={busy.startsWith("import:")} onClick={() => fileRef.current?.click()}>{busy.startsWith("import:") ? <LoaderCircle className="spin"/> : <Upload/>} Import file</Button>
        {mode === "dialog" && <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close the vector library"><X/></Button>}
      </div>
    </header>

    <div className="vl-searchbar">
      <label className="vl-query">
        <Search/>
        <input ref={searchRef} autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, promoter, tag, marker or accession — e.g. pET28, His TEV, CMV" aria-label="Search vectors"/>
        {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X/></button>}
        <kbd>/</kbd>
      </label>
      <div className="vl-sources" role="group" aria-label="Sources searched">
        <span className={`vl-source status-${local.status === "error" ? "offline" : local.status === "loading" ? "searching" : "done"}`} title="The local catalogue is always searched">
          <Database/><strong>Library</strong><small>{local.status === "loading" ? "Loading…" : local.status === "error" ? "Engine offline" : `${shown.length} of ${local.total}`}</small>
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
      {failure ? <CircleAlert/> : <Star/>}
      <span>{failure || notice?.text}</span>
      {!failure && notice?.proteinId && onOpenProject && <Button size="sm" variant="outline" onClick={() => onOpenProject(notice.proteinId!)}>Open in Expression vector design <ArrowRight/></Button>}
      <button onClick={() => { setFailure(""); setNotice(null); }} aria-label="Dismiss"><X/></button>
    </div>}

    <div className="vl-body">
      <aside className="vl-facets" aria-label="Filters">
        <div className="vl-facets-head">
          <strong>Filters</strong>
          {activeFilterCount(filters, sizes) + (favoritesOnly ? 1 : 0) > 0 && <button onClick={() => { setFilters({}); setSizes([]); setFavoritesOnly(false); }}>Clear {activeFilterCount(filters, sizes) + (favoritesOnly ? 1 : 0)}</button>}
        </div>
        <label className="vl-facet-option vl-favorites-only">
          <input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)}/>
          <Star/> <span>Favourites only</span><em>{favorites.length}</em>
        </label>
        {FACETS.map(({ key, label }) => <FacetGroup key={key} label={label} options={facetOptions(local.facets[key], filters[key])} selected={filters[key] ?? []} onToggle={(value) => setFilters((current) => toggleFilter(current, key as FacetKey, value))}/>)}
        <FacetGroup label="Size" options={sizeOptions.filter((option) => option.count || sizes.includes(option.value))} selected={sizes} labelFor={(value) => SIZE_BUCKETS.find((bucket) => bucket.id === value)?.label ?? value} onToggle={(value) => setSizes((current) => current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value])}/>
      </aside>

      <section className="vl-results" aria-label="Results">
        {browsing && (favorites.length > 0 || recent.length > 0) && <div className="vl-pinned">
          {favorites.length > 0 && <PinnedStrip icon={<Star/>} title="Favourites" vectors={favorites} selection={selection} onSelect={(id) => setSelection({ kind: "local", id })}/>}
          {recent.length > 0 && <PinnedStrip icon={<Clock/>} title="Recently used" vectors={recent} selection={selection} onSelect={(id) => setSelection({ kind: "local", id })}/>}
        </div>}

        <div className="vl-section-head">
          <strong>In your library</strong>
          <small>{local.status === "ready" ? `${shown.length} vector${shown.length === 1 ? "" : "s"}${browsing ? ` · ${standardCount} standard` : ""}` : ""}</small>
        </div>
        {local.status === "loading" && !local.vectors.length && <div className="vl-empty"><LoaderCircle className="spin"/><span><strong>Loading the vector library…</strong></span></div>}
        {local.status === "error" && <div className="vl-empty failure"><CircleAlert/><span><strong>The vector library is unavailable</strong><small>{local.error}. Start the local engine and the catalogue loads here.</small></span><Button size="sm" variant="outline" onClick={() => setReload((value) => value + 1)}>Retry</Button></div>}
        {local.status === "ready" && !shown.length && <div className="vl-empty"><Search/><span><strong>No library vector matches</strong><small>{activeFilterCount(filters, sizes) || favoritesOnly ? "Remove a filter, or check the public collections below." : "Try another name, or check the public collections below."}</small></span></div>}
        <div className="vl-list" role="listbox" aria-label="Library vectors">
          {shown.map((vector) => <button
            key={vector.id}
            id={`vl-row-${vector.id}`}
            role="option"
            aria-selected={selection?.kind === "local" && selection.id === vector.id}
            className="vl-row"
            onClick={() => setSelection({ kind: "local", id: vector.id })}
            onDoubleClick={() => void addLocal(vector)}
          >
            <span className="vl-row-size">{(vector.lengthBp / 1000).toFixed(1)}<small>kb</small></span>
            <span className="vl-row-main">
              <strong>{vector.name}{vector.favorite && <Star className="vl-star"/>}</strong>
              <small>{[vector.promoter.join(", "), vectorTagline(vector), vector.selectionMarker].filter(Boolean).join(" · ") || vector.insertName || "No annotations recorded"}</small>
            </span>
            <span className="vl-row-meta">
              <small>{vector.host.join(", ") || "Host not recorded"}</small>
              <em className={vector.isStandard ? "standard" : ""}>{vector.isStandard ? "Standard" : vector.projectCount ? `${vector.projectCount} project${vector.projectCount === 1 ? "" : "s"}` : "Saved"}</em>
            </span>
          </button>)}
        </div>

        {externalSources.length > 0 && <>
          <div className="vl-section-head">
            <strong>Public collections</strong>
            <small>{debounced.trim() ? "Annotated locally when loaded" : "Type a name to search Addgene, NCBI and SnapGene"}</small>
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
            <div className="vl-list" role="listbox" aria-label={`${source.name} results`}>
              {(external[source.id] ?? []).map((result) => <button
                key={`${source.id}-${result.id}-${result.name}`}
                role="option"
                aria-selected={selection?.kind === "external" && selection.source === source.id && selection.result.id === result.id}
                className="vl-row external"
                onClick={() => setSelection({ kind: "external", source: source.id, result })}
                onDoubleClick={() => void addExternal(source.id, result)}
              >
                <span className="vl-row-size">{result.lengthBp ? (result.lengthBp / 1000).toFixed(1) : "–"}<small>kb</small></span>
                <span className="vl-row-main"><strong>{result.name}</strong><small>{result.description || result.id}</small></span>
                <span className="vl-row-meta"><em>{source.name}</em></span>
              </button>)}
            </div>
          </div>)}
        </>}
      </section>

      <aside className="vl-preview" aria-label="Preview">
        {selection?.kind === "local" && selectedLocal
          ? <LocalPreview
              vector={selectedLocal}
              detail={details[selectedLocal.id]}
              busy={busy}
              mode={mode}
              proteins={proteins}
              projectId={projectId}
              targetId={targetId}
              onTarget={setTarget}
              onUse={() => void addLocal(selectedLocal)}
              onFavorite={() => void toggleFavorite(selectedLocal)}
              onDownload={() => void downloadGenBank(selectedLocal)}
            />
          : selection?.kind === "external"
          ? <ExternalPreview
              source={externalSources.find((source) => source.id === selection.source)}
              result={selection.result}
              busy={busy === `use:${selection.source}:${selection.result.id}`}
              mode={mode}
              proteins={proteins}
              projectId={projectId}
              targetId={targetId}
              onTarget={setTarget}
              onUse={() => void addExternal(selection.source, selection.result)}
            />
          : <div className="vl-preview-empty"><Database/><strong>Select a vector to preview it</strong><small>Use ↑ ↓ to move through the results and Enter to use one.</small></div>}
      </aside>
    </div>

    {dragging && <div className="vl-drop" aria-hidden="true">
      <FileInput/>
      <strong>Drop to import into {projectId ? "this project" : "the library"}</strong>
      <small>GenBank (.gb, .gbk), FASTA (.fa, .fasta) or SnapGene (.dna)</small>
    </div>}
  </main>;
}

function FacetGroup({ label, options, selected, onToggle, labelFor = (value) => value }: { label: string; options: { value: string; count: number }[]; selected: string[]; onToggle: (value: string) => void; labelFor?: (value: string) => string }) {
  const [expanded, setExpanded] = useState(false);
  if (!options.length) return null;
  const visible = expanded ? options : options.slice(0, 5);
  return <fieldset className="vl-facet">
    <legend>{label}</legend>
    {visible.map((option) => <label key={option.value} className={`vl-facet-option ${option.count === 0 ? "empty" : ""}`}>
      <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)}/>
      <span title={labelFor(option.value)}>{labelFor(option.value)}</span>
      <em>{option.count}</em>
    </label>)}
    {options.length > 5 && <button className="vl-facet-more" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer" : `Show ${options.length - 5} more`}</button>}
  </fieldset>;
}

function PinnedStrip({ icon, title, vectors, selection, onSelect }: { icon: React.ReactNode; title: string; vectors: LibraryVector[]; selection: Selection; onSelect: (id: string) => void }) {
  return <div className="vl-pinned-strip">
    <span className="vl-pinned-title">{icon}{title}</span>
    <div>
      {vectors.map((vector) => <button key={vector.id} className={selection?.kind === "local" && selection.id === vector.id ? "selected" : ""} onClick={() => onSelect(vector.id)}>
        <strong>{vector.name}</strong>
        <small>{formatBp(vector.lengthBp)}{vector.lastUsedAt ? ` · ${relativeDay(vector.lastUsedAt)}` : ""}</small>
      </button>)}
    </div>
  </div>;
}

function TargetPicker({ proteins, projectId, targetId, onTarget }: { proteins: ProteinRecord[]; projectId?: string; targetId: string; onTarget: (id: string) => void }) {
  if (projectId) return null;
  if (!proteins.length) return <small className="vl-target-empty">Create a project to put this vector to use.</small>;
  return <label className="vl-target">Project
    <select value={targetId} onChange={(event) => onTarget(event.target.value)}>
      {proteins.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>)}
    </select>
  </label>;
}

function LocalPreview({ vector, detail, busy, mode, proteins, projectId, targetId, onTarget, onUse, onFavorite, onDownload }: {
  vector: LibraryVector;
  detail: LibraryVector | "error" | undefined;
  busy: string;
  mode: "page" | "dialog";
  proteins: ProteinRecord[];
  projectId?: string;
  targetId: string;
  onTarget: (id: string) => void;
  onUse: () => void;
  onFavorite: () => void;
  onDownload: () => void;
}) {
  const features = detail && detail !== "error" ? detail.features ?? [] : [];
  const key = keyFeatures(features, 7);
  const facts: [string, string][] = [
    ["Host", vector.host.join(", ")],
    ["Promoter", [vector.promoter.join(", "), vector.inducer.length ? `(${vector.inducer.join(", ")})` : ""].filter(Boolean).join(" ")],
    ["Tags", vectorTagline(vector)],
    ["Marker", vector.selectionMarker],
    ["Origin", vector.origin],
    ["Copy number", vector.copyNumber],
    ["Supplier", vector.supplier],
  ];
  return <article className="vl-card">
    <header>
      <span>
        <strong>{vector.name}</strong>
        <small>{formatBp(vector.lengthBp)} · {vector.circular ? "circular" : "linear"} · {vector.featureCount} features</small>
      </span>
      <Button variant="ghost" size="icon-sm" aria-pressed={vector.favorite} aria-label={vector.favorite ? "Remove from favourites" : "Add to favourites"} title={vector.favorite ? "Remove from favourites" : "Add to favourites"} disabled={busy === `fav:${vector.id}`} onClick={onFavorite}>
        <Star className={vector.favorite ? "vl-star filled" : "vl-star"}/>
      </Button>
    </header>

    <div className="vl-card-map">
      {detail === undefined
        ? <div className="vl-map-placeholder"><LoaderCircle className="spin"/><small>Drawing the map…</small></div>
        : detail === "error"
        ? <div className="vl-map-placeholder"><CircleAlert/><small>The map could not be loaded.</small></div>
        : <MiniMap name={vector.name} lengthBp={vector.lengthBp} features={features}/>}
    </div>

    {key.length > 0 && <ul className="vl-key-features" aria-label="Key features">
      {key.map((feature) => <li key={`${feature.name}-${feature.start}`}>
        <i style={{ background: KIND_STYLE[feature.kind].color }}/>
        <span>{feature.name}</span>
        <small>{KIND_STYLE[feature.kind].label} · {(feature.start + 1).toLocaleString("en-US")}–{feature.end.toLocaleString("en-US")}</small>
      </li>)}
    </ul>}

    <dl className="vl-facts">
      {facts.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      {vector.insertName && <div><dt>Insert</dt><dd>{vector.insertName}</dd></div>}
      {vector.projects.length > 0 && <div><dt>Used in</dt><dd>{vector.projects.map((use) => use.proteinName).join(", ")}</dd></div>}
    </dl>

    <div className="vl-provenance">
      <strong>Source and licence</strong>
      {vector.sourceUrl ? <a href={vector.sourceUrl} target="_blank" rel="noreferrer">{shortUrl(vector.sourceUrl)} <ExternalLink/></a> : <small>{vector.isStandard ? "Source not recorded" : "Saved from a project in this workspace"}</small>}
      {vector.license && <small>{vector.license}{vector.licenseUrl && <> <a href={vector.licenseUrl} target="_blank" rel="noreferrer">Terms <ExternalLink/></a></>}</small>}
    </div>

    <footer>
      <TargetPicker proteins={proteins} projectId={projectId} targetId={targetId} onTarget={onTarget}/>
      <div>
        <Button variant="outline" size="sm" disabled={busy === `dl:${vector.id}`} onClick={onDownload}>{busy === `dl:${vector.id}` ? <LoaderCircle className="spin"/> : <Download/>} GenBank</Button>
        <Button size="sm" disabled={!targetId || Boolean(busy)} onClick={onUse}>{busy === `use:${vector.id}` ? <LoaderCircle className="spin"/> : <ArrowRight/>} {mode === "dialog" ? "Load into this project" : "Use in project"}</Button>
      </div>
    </footer>
  </article>;
}

function ExternalPreview({ source, result, busy, mode, proteins, projectId, targetId, onTarget, onUse }: {
  source: SourceDescriptor | undefined;
  result: ExternalResult;
  busy: boolean;
  mode: "page" | "dialog";
  proteins: ProteinRecord[];
  projectId?: string;
  targetId: string;
  onTarget: (id: string) => void;
  onUse: () => void;
}) {
  return <article className="vl-card">
    <header>
      <span>
        <strong>{result.name}</strong>
        <small>{result.lengthBp ? formatBp(result.lengthBp) : "Size shown after loading"} · {source?.name ?? "External source"}</small>
      </span>
    </header>
    <div className="vl-card-map">
      <div className="vl-map-placeholder"><Globe/><small>{source?.annotated ? "Curated annotations arrive when it is loaded." : "Protein Lab annotates the sequence after download."}</small></div>
    </div>
    {result.description && <p className="vl-external-description">{result.description}</p>}
    <dl className="vl-facts">
      <div><dt>Identifier</dt><dd>{result.id}</dd></div>
      {result.set && <div><dt>Set</dt><dd>{result.set}</dd></div>}
    </dl>
    {source?.attribution && <div className="vl-provenance"><strong>Source and licence</strong><small>{source.attribution}</small></div>}
    <footer>
      <TargetPicker proteins={proteins} projectId={projectId} targetId={targetId} onTarget={onTarget}/>
      <div>
        <Button size="sm" disabled={!targetId || busy} onClick={onUse}>{busy ? <LoaderCircle className="spin"/> : <Download/>} {mode === "dialog" ? "Load into this project" : "Use in project"}</Button>
      </div>
    </footer>
    <small className="vl-card-hint">Loading it saves a copy in the library, where it can be favourited and downloaded.</small>
  </article>;
}

/** A small circular map: backbone, features by kind on up to three rings, name and size in the middle. */
function MiniMap({ name, lengthBp, features }: { name: string; lengthBp: number; features: MapFeature[] }) {
  const size = 220;
  const centre = size / 2;
  const radius = 78;
  const drawable = features.filter((feature) => feature.end !== feature.start);
  const rings = assignRings(drawable, lengthBp, 3);
  return <svg className="vl-minimap" viewBox={`0 0 ${size} ${size}`} role="img" aria-label={`Map of ${name}, ${formatBp(lengthBp)}, ${drawable.length} features`}>
    <circle cx={centre} cy={centre} r={radius} className="vl-minimap-backbone"/>
    {[0, 0.25, 0.5, 0.75].map((fraction) => {
      const angle = fraction * 2 * Math.PI;
      return <line key={fraction} className="vl-minimap-tick" x1={centre + (radius - 4) * Math.sin(angle)} y1={centre - (radius - 4) * Math.cos(angle)} x2={centre + (radius + 4) * Math.sin(angle)} y2={centre - (radius + 4) * Math.cos(angle)}/>;
    })}
    {drawable.map((feature, index) => {
      const kind = featureKind(feature);
      const style = KIND_STYLE[kind];
      const ringRadius = radius + 10 + rings[index] * 10;
      return <path key={`${feature.name}-${feature.start}-${index}`} d={arcPath(centre, centre, ringRadius, feature.start, feature.end, lengthBp)} stroke={style.color} strokeDasharray={style.dash} className="vl-minimap-feature">
        <title>{`${feature.name} · ${style.label} · ${(feature.start + 1).toLocaleString("en-US")}–${feature.end.toLocaleString("en-US")}`}</title>
      </path>;
    })}
    <text x={centre} y={centre - 4} className="vl-minimap-name">{name.length > 18 ? `${name.slice(0, 17)}…` : name}</text>
    <text x={centre} y={centre + 13} className="vl-minimap-size">{formatBp(lengthBp)}</text>
  </svg>;
}

function shortUrl(url: string) {
  try { const parsed = new URL(url); return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.length > 1 ? parsed.pathname : ""}`; }
  catch { return url; }
}

function relativeDay(iso: string) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  return days <= 0 ? "today" : days === 1 ? "yesterday" : `${days} days ago`;
}

function message(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
