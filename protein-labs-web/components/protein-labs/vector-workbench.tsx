"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { FormEvent } from "react";
import { ArrowLeft, ArrowLeftRight, Check, CircleAlert, Columns2, Copy, Database, Disc3, Dna, Download, Eye, EyeOff, FileInput, FolderOpen, Library, LoaderCircle, Map as MapIcon, Plus, Redo2, RefreshCw, Save, Scissors, Search, Trash2, Undo2, WandSparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { JsonObject, ProteinRecord } from "@/lib/protein-labs-api";
import { fileToBase64, proteinLabsApi } from "@/lib/protein-labs-api";
import type { CutSite, SeqRange, Viewport } from "@/lib/vector-geometry";
import { CATEGORY_STYLE, cutSitesFromRecord, featureCategory, featureColor, formatRange, gcPercent, rangeLength, rangeSequence, reverseComplement, translate } from "@/lib/vector-geometry";
import type { History, Tagged } from "@/lib/vector-editor-state";
import { commit, createRequestGate, redoStep, undoStep, valueFor } from "@/lib/vector-editor-state";
import { IMPORT_EXTENSIONS, formatBp, importEncoding, librarySearchParams } from "@/lib/vector-library";
import type { ExportFormat, Orf, SiteFilter, WorkbenchFeature, WorkbenchSource, WorkbenchVector } from "@/lib/vector-workbench";
import {
  EXPORT_FORMATS, FEATURE_TYPES, FEATURE_TYPE_LABELS, SITE_FILTERS, addFeature, cleanDna, deleteFeature, emptyVector, enzymeSummary, filterCuts,
  findMotif, mirrorRange, orfAsFeature, orfMapFeatures, readOrfs, readVector, reverseComplementVector, saveChoice, sourceLabel, toEngine, updateFeature,
} from "@/lib/vector-workbench";
import { ANALYSED_ENZYMES } from "@/components/protein-labs/vector-design-panels";
import type { VectorSelection, ViewVector } from "@/components/protein-labs/vector-views";
import { CircularMap, FeatureLegend, LinearMap, SelectionBar, SequenceView, fitRange } from "@/components/protein-labs/vector-views";

type Pane = "split" | "map" | "sequence";
type SideTab = "features" | "enzymes" | "orfs";
type Analysis = { cuts: CutSite[]; orfs: Orf[] };

/** Below this width the map and sequence no longer fit side by side, so one pane shows at a time. */
const SPLIT_MIN_WIDTH = 1080;

/**
 * A construct editor outside any project: open a vector from a file, the
 * library or a project, look at it as a circular map and a sequence that
 * share one selection, edit its features, and save it back to the library.
 */
export function VectorWorkbench({ proteins, initialLibraryId, onBack }: { proteins: ProteinRecord[]; initialLibraryId?: string; onBack: () => void }) {
  const [history, setHistory] = useState<History<WorkbenchVector>>(() => ({ undo: [], redo: [], current: emptyVector() }));
  const vector = history.current;
  const [savedAs, setSavedAs] = useState(() => JSON.stringify(toEngine(emptyVector())));
  const [selection, setSelection] = useState<VectorSelection>(null);
  const [viewport, setViewport] = useState<Viewport>({ from: 0, to: 1 });
  const [siteFilter, setSiteFilter] = useState<SiteFilter>("unique");
  const [showOrfs, setShowOrfs] = useState(false);
  const [orfMinimum, setOrfMinimum] = useState(75);
  const [pane, setPane] = useState<Pane>("split");
  const [sideTab, setSideTab] = useState<SideTab>("features");
  const [analysis, setAnalysis] = useState<Tagged<Analysis> | null>(null);
  const [analysing, setAnalysing] = useState(false);
  const [analysisError, setAnalysisError] = useState("");
  const [analysisRun, setAnalysisRun] = useState(0);
  const [gate] = useState(createRequestGate);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [opening, setOpening] = useState<"library" | "project" | null>(null);
  const [saving, setSaving] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [busy, setBusy] = useState(false);
  const [narrow, setNarrow] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const length = vector.sequence.length;
  const dirty = useMemo(() => JSON.stringify(toEngine(vector)) !== savedAs, [vector, savedAs]);
  const say = (text: string, error = false) => setMessage({ text, error });

  useEffect(() => {
    const element = rootRef.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setNarrow(entries[0].contentRect.width < SPLIT_MIN_WIDTH));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const shownPane: Pane = narrow && pane === "split" ? "map" : pane;

  // ---- Analysis: restriction sites and ORFs from the engine ---------------------------------
  const analysisKey = `${vector.circular}:${orfMinimum}:${vector.sequence}`;
  useEffect(() => {
    if (!vector.sequence) { gate.cancel(); setAnalysing(false); setAnalysisError(""); return; }
    const token = gate.begin();
    setAnalysing(true); setAnalysisError("");
    // Typing in the sequence or flipping topology should not send a request per keystroke.
    const timer = window.setTimeout(async () => {
      try {
        const result = await proteinLabsApi.analyzeWorkbenchVector({ sequence: vector.sequence, circular: vector.circular, enzymeNames: ANALYSED_ENZYMES, minimumOrfAminoAcids: orfMinimum });
        if (!gate.isCurrent(token)) return;
        setAnalysis({ key: analysisKey, value: { cuts: cutSitesFromRecord(result.restrictionSites, vector.sequence.length), orfs: readOrfs(result.orfs) } });
      } catch (reason) {
        if (gate.isCurrent(token)) setAnalysisError(errorText(reason));
      } finally {
        if (gate.isCurrent(token)) setAnalysing(false);
      }
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [analysisKey, analysisRun]);
  const current = valueFor(analysis, analysisKey);
  const allCuts = useMemo(() => current?.cuts ?? [], [current]);
  const orfs = useMemo(() => current?.orfs ?? [], [current]);
  const shownCuts = useMemo(() => filterCuts(allCuts, siteFilter), [allCuts, siteFilter]);
  const enzymes = useMemo(() => enzymeSummary(allCuts), [allCuts]);

  const view: ViewVector = useMemo(() => ({
    name: vector.name, sequence: vector.sequence, circular: vector.circular, cuts: shownCuts,
    features: [...vector.features, ...(showOrfs ? orfMapFeatures(orfs) : [])],
  }), [vector, shownCuts, showOrfs, orfs]);
  const range = selection?.range ?? null;
  const selectedSize = range ? rangeLength(range, length) : 0;
  const activeFeature = selection?.featureId ? vector.features.find((feature) => feature.id === selection.featureId) : undefined;

  /** The one way selection changes, so the linear map follows a pick made elsewhere. */
  function select(next: VectorSelection) {
    setSelection(next);
    if (next && next.source !== "linear" && length) {
      const { start, end } = next.range;
      const inView = start >= viewport.from && Math.min(end, start + 1) <= viewport.to;
      if (viewport.to - viewport.from < length - 1 && !inView) setViewport(fitRange(end > start ? next.range : { start, end: start + 1 }, length));
    }
  }

  // ---- Editing -----------------------------------------------------------------------------
  function edit(next: WorkbenchVector) { setHistory((value) => commit(value, next)); }
  function step(direction: "undo" | "redo") {
    const target = direction === "undo" ? history.undo : history.redo;
    if (!target.length) return;
    setHistory((value) => (direction === "undo" ? undoStep : redoStep)(value));
    say(`${direction === "undo" ? "Undid" : "Redid"} the last change.`);
  }
  function apply(change: () => WorkbenchVector, note?: string) {
    try { edit(change()); if (note) say(note); return true; }
    catch (reason) { say(errorText(reason), true); return false; }
  }

  function setTopology(circular: boolean) {
    // A linear molecule has no origin to run through, so features that did are dropped (and come back on undo).
    const kept = circular ? vector.features : vector.features.filter((feature) => feature.end > feature.start);
    const dropped = vector.features.length - kept.length;
    edit({ ...vector, circular, features: kept });
    say(`Now ${circular ? "circular" : "linear"}.${dropped ? ` ${dropped} feature${dropped === 1 ? "" : "s"} across the origin removed; undo to restore.` : ""}`);
  }

  function flipStrand() {
    edit(reverseComplementVector(vector));
    if (range) setSelection({ ...selection!, range: mirrorRange(range, length), source: "list" });
    say("Reverse complemented the whole construct; features moved to the other strand.");
  }

  // ---- Opening ------------------------------------------------------------------------------
  function confirmDiscard() { return !dirty || window.confirm(`Discard unsaved changes to ${vector.name}?`); }

  function show(next: WorkbenchVector, note: string) {
    setHistory({ undo: [], redo: [], current: next });
    setSavedAs(JSON.stringify(toEngine(next)));
    setSelection(null);
    setViewport({ from: 0, to: Math.max(1, next.sequence.length) });
    say(note);
  }

  async function importFile(file: File | null) {
    if (!file) return;
    const encoding = importEncoding(file.name);
    if (!encoding) { say(`${file.name} is not a GenBank, FASTA or SnapGene (.dna) file.`, true); return; }
    if (!confirmDiscard()) return;
    setBusy(true); setMessage(null);
    try {
      const content = encoding === "base64" ? await fileToBase64(file) : await file.text();
      const parsed = await proteinLabsApi.parseVectorFile(file.name, content);
      const next = readVector(parsed, { kind: "file", filename: file.name, format: parsed.fileFormat });
      show(next, `Opened ${file.name}: ${next.sequence.length.toLocaleString()} bp with ${next.features.length} feature${next.features.length === 1 ? "" : "s"}.`);
    } catch (reason) { say(`Could not open ${file.name}: ${errorText(reason)}`, true); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  function startFromDna(dna: string) {
    const sequence = cleanDna(dna);
    if (!sequence) { say("Paste a DNA sequence (A, C, G, T or N) first.", true); return; }
    show({ ...emptyVector(), sequence }, `New ${sequence.length.toLocaleString()} bp construct. Add features, then save it to the library.`);
  }

  // A vector picked on the dashboard tile opens straight away.
  const [initialLoading, setInitialLoading] = useState(!!initialLibraryId);
  useEffect(() => {
    if (!initialLibraryId) return;
    let active = true;
    proteinLabsApi.getLibraryVector(initialLibraryId).then((raw) => {
      if (!active) return;
      const name = String(raw.name ?? "vector");
      show(readVector(raw, { kind: "library", libraryId: initialLibraryId, name, standard: Boolean(raw.isStandard) }), `Opened ${name} from the vector library${raw.isStandard ? " (a read-only standard vector; save your edits as a new entry)" : ""}.`);
    }).catch((reason) => { if (active) say(`Could not open that library vector: ${errorText(reason)}`, true); })
      .finally(() => { if (active) setInitialLoading(false); });
    return () => { active = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialLibraryId]);

  // ---- Saving and exporting ----------------------------------------------------------------
  async function saveToLibrary(mode: "new" | "overwrite", name: string) {
    const named = { ...vector, name: name.trim() || vector.name };
    setBusy(true);
    try {
      const saved = mode === "overwrite" && vector.source.kind === "library"
        ? await proteinLabsApi.overwriteLibraryVector(vector.source.libraryId, toEngine(named))
        : await proteinLabsApi.saveLibraryVectorAsNew(toEngine(named));
      const source: WorkbenchSource = { kind: "library", libraryId: String(saved.id), name: String(saved.name ?? named.name), standard: false };
      const next = { ...named, source };
      setHistory((value) => ({ ...value, current: next }));
      setSavedAs(JSON.stringify(toEngine(next)));
      setSaving(false);
      say(mode === "overwrite" ? `Saved over ${source.name} in the vector library.` : `Saved ${source.name} to the vector library as a new entry.`);
    } catch (reason) {
      say(`Could not save to the library: ${errorText(reason) === "read_only" ? "standard vectors are read-only" : errorText(reason)}`, true);
    } finally { setBusy(false); }
  }

  async function exportAs(format: ExportFormat) {
    setBusy(true);
    try {
      const result = await proteinLabsApi.exportWorkbenchVector(toEngine(vector), format);
      if (result.encoding === "base64") downloadBytes(result.filename, result.content); else downloadText(result.filename, result.content);
      setExporting(false);
      say(`Exported ${result.filename}.`);
    } catch (reason) { say(`Export failed: ${errorText(reason)}`, true); }
    finally { setBusy(false); }
  }

  function find(motif: string) {
    const hit = findMotif(vector.sequence, vector.circular, motif, range ? range.start + 1 : 0);
    if (!motif) return "";
    if (!hit) return "No match";
    select({ range: hit.range, source: "list" });
    return `${hit.count} match${hit.count === 1 ? "" : "es"}${hit.reverse ? " (reverse strand)" : ""}`;
  }

  // ---- Keyboard ------------------------------------------------------------------------------
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (opening || saving || exporting) return;
      const target = event.target as HTMLElement | null;
      const typing = !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "s" && length) { event.preventDefault(); setSaving(true); return; }
      if (mod && key === "o") { event.preventDefault(); setOpening("library"); return; }
      if (mod && key === "e" && length) { event.preventDefault(); setExporting(true); return; }
      if (mod && key === "f") { event.preventDefault(); document.getElementById("vector-find")?.focus(); return; }
      if (typing) return;
      if (event.key === "Escape") { setSelection(null); return; }
      if (mod && key === "z") { event.preventDefault(); step(event.shiftKey ? "redo" : "undo"); return; }
      if (mod && key === "y") { event.preventDefault(); step("redo"); return; }
      if (mod && key === "a" && length) { event.preventDefault(); select({ range: { start: 0, end: length }, source: "list" }); return; }
      if (mod && key === "c" && range && selectedSize) { void navigator.clipboard?.writeText(rangeSequence(vector.sequence, range)); return; }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const mapViews = { vector: view, selection, onSelect: select, showOrfs };
  const realFeatures = vector.features.length;
  const tally = (filter: SiteFilter) => filter === "none" ? null : new Set(filterCuts(allCuts, filter).map((site) => site.enzyme)).size;

  return <div className="vwb" ref={rootRef}>
    <header className="vwb-header">
      <Button variant="ghost" size="sm" onClick={() => { if (confirmDiscard()) onBack(); }} title="Back to the dashboard"><ArrowLeft /> Dashboard</Button>
      <div className="vwb-title">
        <span className="vwb-kicker"><Disc3 /> Vector Workbench</span>
        {length ? <input value={vector.name} aria-label="Vector name" onChange={(event) => setHistory((value) => ({ ...value, current: { ...value.current, name: event.target.value } }))} /> : <strong>No vector open</strong>}
        {length > 0 && <small>{length.toLocaleString()} bp · {vector.circular ? "circular" : "linear"} · {gcPercent(vector.sequence).toFixed(1)}% GC · {realFeatures} feature{realFeatures === 1 ? "" : "s"} · {sourceLabel(vector.source)}{dirty ? " · unsaved changes" : ""}</small>}
      </div>
      <div className="vwb-actions">
        <Button variant="outline" size="sm" onClick={() => setOpening("library")} title="Open from the vector library or a project (Ctrl+O)"><FolderOpen /> Open</Button>
        <Button variant="outline" size="sm" onClick={() => fileRef.current?.click()} title="Import a GenBank, FASTA or SnapGene .dna file"><FileInput /> Import</Button>
        <Button variant="outline" size="sm" disabled={!length} onClick={() => setExporting(true)} title="Export GenBank, FASTA or SnapGene .dna (Ctrl+E)"><Download /> Export</Button>
        <Button size="sm" disabled={!length || busy} onClick={() => setSaving(true)} title="Save to the vector library (Ctrl+S)">{busy ? <LoaderCircle className="spin" /> : <Save />} Save to library</Button>
        <Button variant="ghost" size="icon-sm" disabled={!history.undo.length} onClick={() => step("undo")} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 /></Button>
        <Button variant="ghost" size="icon-sm" disabled={!history.redo.length} onClick={() => step("redo")} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 /></Button>
      </div>
      <input ref={fileRef} type="file" hidden accept={IMPORT_EXTENSIONS.join(",")} onChange={(event) => void importFile(event.target.files?.[0] ?? null)} />
    </header>

    {message && <div className={`vector-status${message.error ? " error" : ""}`} role={message.error ? "alert" : "status"}>{message.error ? <CircleAlert /> : <Check />}<span>{message.text}</span><button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}><X /></button></div>}

    {!length && initialLoading ? <div className="vpanel-loading vwb-start"><LoaderCircle className="spin" /> Opening the vector…</div> : !length ? <WorkbenchStart busy={busy} onLibrary={() => setOpening("library")} onProject={() => setOpening("project")} onImport={() => fileRef.current?.click()} onDna={startFromDna} /> : <>
      <div className="vmap-toolbar vwb-toolbar">
        <div className="vseg" role="radiogroup" aria-label="Panes">
          {([["split", "Split", Columns2], ["map", "Map", MapIcon], ["sequence", "Sequence", Dna]] as const).map(([id, label, Icon]) => <button key={id} role="radio" aria-checked={shownPane === id} className={shownPane === id ? "active" : ""} disabled={id === "split" && narrow} title={id === "split" && narrow ? "Widen the window to see the map and sequence side by side" : undefined} onClick={() => setPane(id)}><Icon />{label}</button>)}
        </div>
        <span className="vmap-toolbar-label">Cut sites</span>
        <div className="vseg" role="radiogroup" aria-label="Which cut sites to show">
          {SITE_FILTERS.map(([id, label]) => <button key={id} role="radio" aria-checked={siteFilter === id} className={siteFilter === id ? "active" : ""} onClick={() => setSiteFilter(id)}>{label}{tally(id) !== null && <b>{current ? tally(id) : "…"}</b>}</button>)}
        </div>
        {analysing && <LoaderCircle className="spin" aria-label="Finding restriction sites and ORFs" />}
        <label className="topology-toggle"><input type="checkbox" checked={vector.circular} onChange={(event) => setTopology(event.target.checked)} /><span>{vector.circular ? "Circular" : "Linear"}</span></label>
        <Button variant="ghost" size="sm" onClick={flipStrand} title="Reverse complement the whole construct"><ArrowLeftRight /> Reverse complement</Button>
        <button type="button" className="vmap-toggle" onClick={() => setShowOrfs((value) => !value)} aria-pressed={showOrfs}>{showOrfs ? <Eye /> : <EyeOff />} ORFs</button>
      </div>
      {analysisError && <div className="vpanel-error vwb-analysis-error"><CircleAlert /><span>Restriction sites and ORFs are unavailable: {analysisError}</span><Button size="sm" variant="outline" onClick={() => setAnalysisRun((value) => value + 1)}><RefreshCw /> Retry</Button></div>}

      <div className={`vwb-body pane-${shownPane}`}>
        <section className="vwb-pane vwb-map" aria-label="Map" hidden={shownPane === "sequence"}>
          {vector.circular ? <CircularMap {...mapViews} /> : <LinearMap {...mapViews} viewport={viewport} onViewport={setViewport} />}
          <FeatureLegend features={view.features} />
        </section>
        <section className="vwb-pane vwb-seq" aria-label="Sequence" hidden={shownPane === "map"}>
          <LinearMap {...mapViews} viewport={viewport} onViewport={setViewport} compact />
          <SequenceView {...mapViews} />
        </section>
        <aside className="vwb-side" aria-label="Features, enzymes and ORFs">
          <nav className="vwb-tabs" role="tablist">
            {([["features", "Features", realFeatures], ["enzymes", "Enzymes", current ? enzymes.length : null], ["orfs", "ORFs", current ? orfs.length : null]] as const).map(([id, label, count]) => <button key={id} role="tab" aria-selected={sideTab === id} className={sideTab === id ? "active" : ""} onClick={() => setSideTab(id)}>{label}{count !== null && <b>{count}</b>}</button>)}
          </nav>
          <div className="vwb-side-body">
            {sideTab === "features" && <FeaturesPanel vector={vector} selection={selection} active={activeFeature} onSelect={select}
              onAdd={(fields) => { if (!range) return; try { const result = addFeature(vector, range, fields); edit(result.vector); select({ range, featureId: result.feature.id, source: "list" }); say(`Added ${result.feature.name} at ${formatRange(range, length)}.`); } catch (reason) { say(errorText(reason), true); } }}
              onUpdate={(id, patch) => { const ok = apply(() => updateFeature(vector, id, patch)); if (ok && ("start" in patch || "end" in patch)) select({ range: { start: patch.start!, end: patch.end! }, featureId: id, source: "list" }); return ok; }}
              onDelete={(id) => { const name = vector.features.find((feature) => feature.id === id)?.name ?? "feature"; edit(deleteFeature(vector, id)); setSelection(null); say(`Deleted ${name}. Undo with Ctrl+Z.`); }} />}
            {sideTab === "enzymes" && <EnzymePanel rows={enzymes} loading={analysing && !current} error={analysisError} filter={siteFilter} selected={selection?.enzyme}
              onPick={(enzyme, cut) => select({ range: { start: cut, end: cut }, enzyme, source: "list" })} />}
            {sideTab === "orfs" && <OrfPanel orfs={orfs} loading={analysing && !current} error={analysisError} minimum={orfMinimum} onMinimum={setOrfMinimum} length={length} selection={selection} showOrfs={showOrfs} onShow={setShowOrfs}
              onPick={(orf) => select({ range: { start: orf.start, end: orf.end }, source: "list" })}
              onKeep={(orf) => { try { const result = orfAsFeature(vector, orf); edit(result.vector); select({ range: { start: orf.start, end: orf.end }, featureId: result.feature.id, source: "list" }); setSideTab("features"); say(`Kept ${result.feature.name} as a CDS feature.`); } catch (reason) { say(errorText(reason), true); } }} />}
          </div>
        </aside>
      </div>
      <SelectionBar vector={view} selection={selection} onFind={find} />
    </>}

    {opening && <OpenDialog initial={opening} proteins={proteins} onClose={() => setOpening(null)}
      onOpen={(next, note) => { if (!confirmDiscard()) return false; show(next, note); setOpening(null); return true; }} />}
    {saving && <SaveDialog vector={vector} busy={busy} onClose={() => setSaving(false)} onSave={(mode, name) => void saveToLibrary(mode, name)} />}
    {exporting && <Dialog open onOpenChange={(open) => { if (!open) setExporting(false); }}>
      <DialogContent className="dialog-panel vwb-dialog">
        <DialogHeader><DialogTitle>Export {vector.name}</DialogTitle><DialogDescription>Choose a file format. GenBank is the safest way to move a construct into SnapGene, Benchling or ApE with all its features.</DialogDescription></DialogHeader>
        <div className="vwb-formats">{EXPORT_FORMATS.map((format) => <button key={format.id} type="button" disabled={busy} onClick={() => void exportAs(format.id)}><Download /><span><strong>{format.label}</strong><small>{format.hint}</small></span></button>)}</div>
        <DialogFooter><Button variant="outline" onClick={() => setExporting(false)}>Cancel</Button></DialogFooter>
      </DialogContent>
    </Dialog>}
  </div>;
}

// ---------------------------------------------------------------------------
// Empty state
// ---------------------------------------------------------------------------

function WorkbenchStart({ busy, onLibrary, onProject, onImport, onDna }: { busy: boolean; onLibrary: () => void; onProject: () => void; onImport: () => void; onDna: (dna: string) => void }) {
  const [dna, setDna] = useState("");
  return <div className="vwb-start">
    <div className="vempty">
      <Disc3 />
      <h3>Open a vector to start</h3>
      <p>The Workbench edits a construct on its own, outside any purification project. Open one from the library or a project, import a file, or paste DNA.</p>
      <div className="vwb-start-choices">
        <button type="button" onClick={onLibrary}><Library /><span><strong>Vector library</strong><small>Your saved vectors and the standard collection</small></span></button>
        <button type="button" onClick={onProject}><Database /><span><strong>From a project</strong><small>Vectors saved in an Expression vector design job</small></span></button>
        <button type="button" onClick={onImport} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <FileInput />}<span><strong>Import a file</strong><small>GenBank, FASTA or SnapGene .dna</small></span></button>
      </div>
      <form className="vwb-paste" onSubmit={(event) => { event.preventDefault(); onDna(dna); }}>
        <textarea className="dna-editor" spellCheck={false} value={dna} onChange={(event) => setDna(event.target.value)} aria-label="DNA sequence" placeholder="…or paste DNA (A, C, G, T, N). Numbers and spaces are ignored." />
        <Button type="submit" variant="outline" disabled={!cleanDna(dna)}><Plus /> New construct from DNA{cleanDna(dna) ? ` (${cleanDna(dna).length.toLocaleString()} bp)` : ""}</Button>
      </form>
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// Features
// ---------------------------------------------------------------------------

function FeaturesPanel({ vector, selection, active, onSelect, onAdd, onUpdate, onDelete }: {
  vector: WorkbenchVector; selection: VectorSelection; active?: WorkbenchFeature;
  onSelect: (selection: VectorSelection) => void;
  onAdd: (fields: { name: string; type: string; strand: number }) => void;
  onUpdate: (id: string, patch: { name: string; type: string; start: number; end: number; strand: number; notes: string }) => boolean;
  onDelete: (id: string) => void;
}) {
  const length = vector.sequence.length;
  const range = selection?.range;
  const size = range ? rangeLength(range, length) : 0;
  const sorted = useMemo(() => [...vector.features].sort((a, b) => a.start - b.start), [vector.features]);
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!active || selection?.source === "list") return;
    listRef.current?.querySelector<HTMLElement>(`[data-feature="${CSS.escape(active.id)}"]`)?.scrollIntoView({ block: "nearest" });
  }, [active, selection?.source]);

  return <div className="vwb-features">
    {active
      ? <FeatureEditor key={active.id + active.start + active.end} feature={active} length={length} circular={vector.circular} onSave={(patch) => onUpdate(active.id, patch)} onDelete={() => onDelete(active.id)} onClose={() => onSelect(null)} />
      : <NewFeature range={size ? range! : null} length={length} sequence={vector.sequence} onAdd={onAdd} />}
    <div className="vwb-feature-list" ref={listRef} role="list" aria-label="Features">
      {!sorted.length && <div className="vpanel-empty">No features yet. Drag across the map or sequence, then add one.</div>}
      {sorted.map((feature) => {
        const category = featureCategory(feature);
        return <button key={feature.id} type="button" role="listitem" data-feature={feature.id} className={feature.id === active?.id ? "selected" : ""} onClick={() => onSelect({ range: { start: feature.start, end: feature.end }, featureId: feature.id, source: "list" })}>
          <i style={{ background: featureColor(feature) }} />
          <span><strong>{feature.name}</strong><small>{CATEGORY_STYLE[category].label} · {formatRange(feature, length)} · {rangeLength(feature, length).toLocaleString()} bp</small></span>
          <em aria-label={feature.strand < 0 ? "reverse strand" : feature.strand > 0 ? "forward strand" : "no strand"}>{feature.strand < 0 ? "←" : feature.strand > 0 ? "→" : "·"}</em>
        </button>;
      })}
    </div>
  </div>;
}

function NewFeature({ range, length, sequence, onAdd }: { range: SeqRange | null; length: number; sequence: string; onAdd: (fields: { name: string; type: string; strand: number }) => void }) {
  const [name, setName] = useState("");
  const [type, setType] = useState("misc_feature");
  const [strand, setStrand] = useState(1);
  const bases = range ? rangeSequence(sequence, range) : "";
  return <form className="vwb-card" onSubmit={(event) => { event.preventDefault(); onAdd({ name: name || FEATURE_TYPE_LABELS[type] || "New feature", type, strand }); setName(""); }}>
    <header><strong>Add a feature</strong><small>{range ? `${formatRange(range, length)} · ${rangeLength(range, length).toLocaleString()} bp selected` : "Drag across the map or sequence to choose its bases"}</small></header>
    <label>Name<input value={name} onChange={(event) => setName(event.target.value)} placeholder={FEATURE_TYPE_LABELS[type]} disabled={!range} /></label>
    <div className="vwb-row">
      <label>Type<select value={type} onChange={(event) => setType(event.target.value)} disabled={!range}>{FEATURE_TYPES.map((value) => <option key={value} value={value}>{FEATURE_TYPE_LABELS[value]}</option>)}</select></label>
      <label>Strand<select value={strand} onChange={(event) => setStrand(Number(event.target.value))} disabled={!range}><option value={1}>Forward →</option><option value={-1}>Reverse ←</option><option value={0}>None</option></select></label>
    </div>
    <Button type="submit" size="sm" disabled={!range}><Plus /> Add feature</Button>
    {bases.length >= 3 && <Translation bases={bases} />}
  </form>;
}

function FeatureEditor({ feature, length, circular, onSave, onDelete, onClose }: {
  feature: WorkbenchFeature; length: number; circular: boolean;
  onSave: (patch: { name: string; type: string; start: number; end: number; strand: number; notes: string }) => boolean;
  onDelete: () => void; onClose: () => void;
}) {
  const [name, setName] = useState(feature.name);
  const [type, setType] = useState(feature.type);
  const [start, setStart] = useState(String(feature.start + 1));
  const [end, setEnd] = useState(String(feature.end));
  const [strand, setStrand] = useState(feature.strand);
  const [notes, setNotes] = useState(feature.notes);
  const [confirming, setConfirming] = useState(false);
  const changed = name !== feature.name || type !== feature.type || start !== String(feature.start + 1) || end !== String(feature.end) || strand !== feature.strand || notes !== feature.notes;
  function submit(event: FormEvent) {
    event.preventDefault();
    onSave({ name, type, start: Number(start) - 1, end: Number(end), strand, notes });
  }
  return <form className="vwb-card vwb-editor" onSubmit={submit} noValidate>
    <header><strong><i style={{ background: featureColor(feature) }} />{feature.name}</strong><Button type="button" variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close feature"><X /></Button></header>
    <label>Name<input value={name} onChange={(event) => setName(event.target.value)} /></label>
    <div className="vwb-row">
      <label>Type<select value={type} onChange={(event) => setType(event.target.value)}>{[...new Set([feature.type, ...FEATURE_TYPES])].map((value) => <option key={value} value={value}>{FEATURE_TYPE_LABELS[value] ?? value}</option>)}</select></label>
      <label>Strand<select value={strand} onChange={(event) => setStrand(Number(event.target.value))}><option value={1}>Forward →</option><option value={-1}>Reverse ←</option><option value={0}>None</option></select></label>
    </div>
    <div className="vwb-row">
      <label>Start<input type="number" min={1} max={length} value={start} onChange={(event) => setStart(event.target.value)} /></label>
      <label>End<input type="number" min={1} max={length} value={end} onChange={(event) => setEnd(event.target.value)} /></label>
    </div>
    {circular && Number(end) < Number(start) && <small className="vwb-hint">Runs through the origin.</small>}
    <label>Notes<textarea value={notes} onChange={(event) => setNotes(event.target.value)} rows={2} /></label>
    <div className="vwb-editor-actions">
      <Button type="submit" size="sm" disabled={!changed}><Check /> Apply changes</Button>
      {confirming
        ? <><Button type="button" size="sm" variant="destructive" onClick={onDelete}><Trash2 /> Delete {feature.name}</Button><Button type="button" size="sm" variant="ghost" onClick={() => setConfirming(false)}>Keep</Button></>
        : <Button type="button" size="sm" variant="ghost" className="danger-text" onClick={() => setConfirming(true)}><Trash2 /> Delete</Button>}
    </div>
  </form>;
}

/** The protein a stretch of DNA encodes, read on the top strand and on the reverse complement. */
function Translation({ bases }: { bases: string }) {
  const forward = translate(bases.slice(0, bases.length - (bases.length % 3)));
  const reverse = translate(reverseComplement(bases).slice(0, bases.length - (bases.length % 3)));
  return <dl className="vwb-translation">
    <div><dt>Translation, frame +1</dt><dd>{forward}<CopyButton text={forward} /></dd></div>
    <div><dt>Reverse complement, frame −1</dt><dd>{reverse}<CopyButton text={reverse} /></dd></div>
  </dl>;
}

function CopyButton({ text }: { text: string }) {
  return <button type="button" className="vwb-copy" title="Copy" aria-label="Copy" onClick={() => void navigator.clipboard?.writeText(text)}><Copy /></button>;
}

// ---------------------------------------------------------------------------
// Enzymes and ORFs
// ---------------------------------------------------------------------------

function EnzymePanel({ rows, loading, error, filter, selected, onPick }: { rows: ReturnType<typeof enzymeSummary>; loading: boolean; error: string; filter: SiteFilter; selected?: string; onPick: (enzyme: string, cut: number) => void }) {
  if (loading) return <div className="vpanel-loading"><LoaderCircle className="spin" /> Finding restriction sites…</div>;
  if (error && !rows.length) return <div className="vpanel-empty">Restriction sites are unavailable until the engine answers.</div>;
  const shown = rows.filter((row) => filter === "all" || filter === "none" || row.cutCount === (filter === "unique" ? 1 : 2));
  return <div className="vwb-enzymes">
    <p className="vwb-note"><Scissors /> {ANALYSED_ENZYMES.length} common enzymes checked; {rows.length} cut this construct. Showing {filter === "unique" ? "unique cutters" : filter === "two" ? "two-cutters" : "every cutter"}; change the filter above the map.</p>
    {!shown.length && <div className="vpanel-empty">No {filter === "unique" ? "unique cutters" : filter === "two" ? "two-cutters" : "enzymes"} among the common set.</div>}
    <div className="vwb-enzyme-list" role="list">
      {shown.map((row) => <button key={row.enzyme} type="button" role="listitem" className={selected === row.enzyme ? "selected" : ""} onClick={() => onPick(row.enzyme, row.cuts[0])}>
        <strong>{row.enzyme}</strong>
        <code>{row.recognitionSite}</code>
        <b className={row.cutCount === 1 ? "unique" : ""}>{row.cutCount === 1 ? "1 site" : `${row.cutCount} sites`}</b>
        <small>{row.cuts.map((cut) => (cut + 1).toLocaleString()).join(", ")}</small>
      </button>)}
    </div>
  </div>;
}

function OrfPanel({ orfs, loading, error, minimum, onMinimum, length, selection, showOrfs, onShow, onPick, onKeep }: {
  orfs: Orf[]; loading: boolean; error: string; minimum: number; onMinimum: (value: number) => void; length: number; selection: VectorSelection;
  showOrfs: boolean; onShow: (value: boolean) => void; onPick: (orf: Orf) => void; onKeep: (orf: Orf) => void;
}) {
  const [draft, setDraft] = useState(String(minimum));
  return <div className="vwb-orfs">
    <form className="vwb-row vwb-orf-settings" onSubmit={(event) => { event.preventDefault(); const value = Math.round(Number(draft)); if (value >= 5 && value <= 10000) onMinimum(value); else setDraft(String(minimum)); }}>
      <label>Shortest ORF (aa)<input type="number" min={5} max={10000} value={draft} onChange={(event) => setDraft(event.target.value)} onBlur={(event) => event.currentTarget.form?.requestSubmit()} /></label>
      <label className="vwb-check"><input type="checkbox" checked={showOrfs} onChange={(event) => onShow(event.target.checked)} /> Draw on the maps</label>
    </form>
    {loading && <div className="vpanel-loading"><LoaderCircle className="spin" /> Finding ORFs…</div>}
    {!loading && error && !orfs.length && <div className="vpanel-empty">ORFs are unavailable until the engine answers.</div>}
    {!loading && !error && !orfs.length && <div className="vpanel-empty">No ORFs of {minimum} amino acids or more, ATG to stop, in any of the six frames.</div>}
    <div className="vwb-orf-list" role="list">
      {orfs.map((orf) => {
        const picked = selection?.range.start === orf.start && selection.range.end === orf.end && !selection.featureId;
        return <div key={orf.id} role="listitem" className={`vwb-orf${picked ? " selected" : ""}`}>
          <button type="button" className="vwb-orf-pick" onClick={() => onPick(orf)}>
            <strong>{orf.aminoAcids} aa <em>{orf.strand < 0 ? "←" : "→"} frame {orf.frame > 0 ? `+${orf.frame}` : orf.frame}</em></strong>
            <small>{formatRange(orf, length)}</small>
            <code>{orf.translation.length > 60 ? `${orf.translation.slice(0, 60)}…` : orf.translation}</code>
          </button>
          <Button size="sm" variant="outline" onClick={() => onKeep(orf)} title="Keep this ORF as a CDS feature"><WandSparkles /> Keep as CDS</Button>
        </div>;
      })}
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// Open and save dialogs
// ---------------------------------------------------------------------------

type LibraryRow = { id: string; name: string; lengthBp: number; isStandard: boolean; supplier: string; featureCount: number; circular: boolean };
type ProjectVectorRow = { id: string; name: string; length: number; features: number; raw: JsonObject };

function OpenDialog({ initial, proteins, onClose, onOpen }: { initial: "library" | "project"; proteins: ProteinRecord[]; onClose: () => void; onOpen: (vector: WorkbenchVector, note: string) => boolean }) {
  const [tab, setTab] = useState(initial);
  const [query, setQuery] = useState("");
  const [rows, setRows] = useState<LibraryRow[] | null>(null);
  const [error, setError] = useState("");
  const [loadingId, setLoadingId] = useState("");
  const [projectId, setProjectId] = useState(proteins[0]?.id ?? "");
  const [projectRows, setProjectRows] = useState<ProjectVectorRow[] | null>(null);
  const [gate] = useState(createRequestGate);

  useEffect(() => {
    if (tab !== "library") return;
    const token = gate.begin();
    setError("");
    const timer = window.setTimeout(async () => {
      try {
        const result = await proteinLabsApi.searchVectorLibrary(librarySearchParams({ query, filters: {}, limit: 200 }));
        if (gate.isCurrent(token)) setRows(result.vectors.map((item) => ({ id: String(item.id), name: String(item.name ?? "Untitled"), lengthBp: Number(item.lengthBp ?? 0), isStandard: Boolean(item.isStandard), supplier: String(item.supplier ?? ""), featureCount: Number(item.featureCount ?? 0), circular: item.circular !== false })));
      } catch (reason) { if (gate.isCurrent(token)) { setRows([]); setError(errorText(reason)); } }
    }, query ? 200 : 0);
    return () => window.clearTimeout(timer);
  }, [tab, query, gate]);

  useEffect(() => {
    if (tab !== "project" || !projectId) return;
    const token = gate.begin();
    setProjectRows(null); setError("");
    proteinLabsApi.listVectors(projectId).then((result) => {
      if (gate.isCurrent(token)) setProjectRows(result.vectors.map((item) => ({ id: String(item.id), name: String(item.name ?? "Untitled"), length: String(item.sequence ?? "").length, features: Array.isArray(item.features) ? item.features.length : 0, raw: item })));
    }).catch((reason) => { if (gate.isCurrent(token)) { setProjectRows([]); setError(errorText(reason)); } });
  }, [tab, projectId, gate]);

  async function openLibrary(row: LibraryRow) {
    setLoadingId(row.id); setError("");
    try {
      const raw = await proteinLabsApi.getLibraryVector(row.id);
      const vector = readVector(raw, { kind: "library", libraryId: row.id, name: row.name, standard: row.isStandard });
      onOpen(vector, `Opened ${row.name} from the vector library${row.isStandard ? " (a read-only standard vector; save your edits as a new entry)" : ""}.`);
    } catch (reason) { setError(errorText(reason)); }
    finally { setLoadingId(""); }
  }

  function openProject(row: ProjectVectorRow) {
    const protein = proteins.find((item) => item.id === projectId);
    const vector = readVector(row.raw, { kind: "project", proteinId: projectId, proteinName: protein?.name ?? "project", vectorId: row.id });
    onOpen(vector, `Opened ${row.name} from ${protein?.name ?? "the project"}. Changes here do not alter the project; save them to the library.`);
  }

  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="dialog-panel vwb-dialog vwb-open">
      <DialogHeader><DialogTitle>Open a vector</DialogTitle><DialogDescription>Pick a saved vector. The Workbench edits its own copy until you save it to the library.</DialogDescription></DialogHeader>
      <nav className="vwb-tabs" role="tablist">
        <button role="tab" aria-selected={tab === "library"} className={tab === "library" ? "active" : ""} onClick={() => setTab("library")}><Library /> Vector library</button>
        <button role="tab" aria-selected={tab === "project"} className={tab === "project" ? "active" : ""} onClick={() => setTab("project")}><Database /> Project vectors</button>
      </nav>
      {error && <div className="vpanel-error"><CircleAlert /><span>{error}</span></div>}
      {tab === "library" ? <>
        <label className="vwb-search"><Search /><input autoFocus value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, promoter, tag, marker…" aria-label="Search the vector library" /></label>
        <div className="vwb-open-list" role="list">
          {rows === null && <div className="vpanel-loading"><LoaderCircle className="spin" /> Reading the vector library…</div>}
          {rows?.length === 0 && !error && <div className="vpanel-empty">{query ? `No library vectors match “${query}”.` : "The vector library is empty. Import a file instead."}</div>}
          {rows?.map((row) => <button key={row.id} type="button" role="listitem" disabled={!!loadingId} onClick={() => void openLibrary(row)}>
            {loadingId === row.id ? <LoaderCircle className="spin" /> : <Disc3 />}
            <span><strong>{row.name}</strong><small>{formatBp(row.lengthBp)} · {row.circular ? "circular" : "linear"} · {row.featureCount} feature{row.featureCount === 1 ? "" : "s"}{row.supplier ? ` · ${row.supplier}` : ""}</small></span>
            {row.isStandard && <em>Standard</em>}
          </button>)}
        </div>
      </> : <>
        {!proteins.length ? <div className="vpanel-empty">No projects yet. Vectors saved in a project’s Expression vector design job appear here.</div> : <>
          <label className="vwb-project-pick">Project<select value={projectId} onChange={(event) => setProjectId(event.target.value)}>{proteins.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>)}</select></label>
          <div className="vwb-open-list" role="list">
            {projectRows === null && <div className="vpanel-loading"><LoaderCircle className="spin" /> Reading the project’s vectors…</div>}
            {projectRows?.length === 0 && !error && <div className="vpanel-empty">This project has no saved vectors yet.</div>}
            {projectRows?.map((row) => <button key={row.id} type="button" role="listitem" disabled={!row.length} onClick={() => openProject(row)}>
              <Dna /><span><strong>{row.name}</strong><small>{row.length ? `${row.length.toLocaleString()} bp · ${row.features} feature${row.features === 1 ? "" : "s"}` : "No sequence yet"}</small></span>
            </button>)}
          </div>
        </>}
      </>}
      <DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button></DialogFooter>
    </DialogContent>
  </Dialog>;
}

function SaveDialog({ vector, busy, onClose, onSave }: { vector: WorkbenchVector; busy: boolean; onClose: () => void; onSave: (mode: "new" | "overwrite", name: string) => void }) {
  const choice = saveChoice(vector.source);
  const [mode, setMode] = useState<"new" | "overwrite">(choice.canOverwrite ? "overwrite" : "new");
  const [name, setName] = useState(vector.name);
  const [confirming, setConfirming] = useState(false);
  const target = vector.source.kind === "library" ? vector.source.name : "";
  return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
    <DialogContent className="dialog-panel vwb-dialog">
      <DialogHeader><DialogTitle>Save to the vector library</DialogTitle><DialogDescription>Library vectors can be opened here again, browsed in the Vector library, and loaded into any project.</DialogDescription></DialogHeader>
      <label className="field">Name<input autoFocus value={name} onChange={(event) => { setName(event.target.value); setConfirming(false); }} maxLength={120} /></label>
      <div className="vwb-save-modes" role="radiogroup" aria-label="How to save">
        <label className={mode === "new" ? "active" : ""}><input type="radio" name="save-mode" checked={mode === "new"} onChange={() => { setMode("new"); setConfirming(false); }} /><span><strong>Save as a new entry</strong><small>Keeps any existing entry as it is.</small></span></label>
        <label className={`${mode === "overwrite" ? "active" : ""}${choice.canOverwrite ? "" : " disabled"}`}><input type="radio" name="save-mode" disabled={!choice.canOverwrite} checked={mode === "overwrite"} onChange={() => setMode("overwrite")} /><span><strong>{target ? `Overwrite ${target}` : "Overwrite an entry"}</strong><small>{choice.canOverwrite ? "Replaces its sequence and features. Projects that already loaded it keep their own copy." : choice.reason}</small></span></label>
      </div>
      {confirming && <div className="vpanel-error" role="alert"><CircleAlert /><span>Replace the sequence and features of <b>{target}</b> in the library? This cannot be undone from the library.</span></div>}
      <DialogFooter>
        <Button variant="outline" onClick={onClose}>Cancel</Button>
        {mode === "overwrite" && !confirming
          ? <Button disabled={busy || !name.trim()} onClick={() => setConfirming(true)}><Save /> Overwrite…</Button>
          : <Button variant={mode === "overwrite" ? "destructive" : "default"} disabled={busy || !name.trim()} onClick={() => onSave(mode, name)}>{busy ? <LoaderCircle className="spin" /> : <Save />} {mode === "overwrite" ? `Yes, overwrite ${target}` : "Save as new"}</Button>}
      </DialogFooter>
    </DialogContent>
  </Dialog>;
}

function errorText(value: unknown) { return value instanceof Error ? value.message : String(value); }
function downloadText(filename: string, content: string) { downloadBlob(filename, new Blob([content], { type: "text/plain" })); }
function downloadBytes(filename: string, base64: string) { const binary = atob(base64); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index); downloadBlob(filename, new Blob([bytes], { type: "application/octet-stream" })); }
function downloadBlob(filename: string, blob: Blob) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }
