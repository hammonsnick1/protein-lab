"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { AlignCenter, ArrowLeftRight, Beaker, Check, CircleAlert, Database, Dna, Download, Eye, EyeOff, FileInput, FlaskConical, History, Keyboard, LoaderCircle, Map as MapIcon, Plus, Redo2, Save, Scissors, Trash2, Undo2, WandSparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EnzymeRow, GelResult, JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { ensureProjectJob, fileToBase64, proteinLabsApi } from "@/lib/protein-labs-api";
import type { MapFeature, Viewport } from "@/lib/vector-geometry";
import { CATEGORY_STYLE, cutSitesFromEnzymeRows, cutSitesFromRecord, featureCategory, featureColor, formatRange, locateMcs, rangeLength, rangeSequence } from "@/lib/vector-geometry";
import type { CheckedPrimer, Tagged } from "@/lib/vector-editor-state";
import { commit, createRequestGate, readDesignedPrimers, redoStep, undoStep, valueFor } from "@/lib/vector-editor-state";
import { VectorBackboneBrowser } from "@/components/protein-labs/vector-backbone-browser";
import { VectorCloningWorkspace } from "@/components/protein-labs/vector-cloning-workspace";
import type { VectorSelection, ViewVector } from "@/components/protein-labs/vector-views";
import { CircularMap, FeatureLegend, LinearMap, SelectionBar, SequenceView, fitRange } from "@/components/protein-labs/vector-views";
import type { GelLaneRequest, PrimerSettings } from "@/components/protein-labs/vector-design-panels";
import { ANALYSED_ENZYMES, EnzymeChooser, GelPanel, PrimerPanel, defaultPrimerSettings, enzymeInGroup } from "@/components/protein-labs/vector-design-panels";

type VectorRecord = JsonObject & { id: string; name: string; sequence: string; circular: boolean; features: JsonObject[]; primers: JsonObject[]; orfs: JsonObject[]; restrictionSites: JsonObject[]; history: JsonObject[] };
type VectorTab = "map" | "sequence" | "enzymes" | "clone" | "primers" | "orfs" | "tools" | "history";
type SiteMode = "unique" | "two" | "mcs" | "chosen" | "none";

const TABS: [VectorTab, string, typeof Dna, string][] = [
  ["map", "Map", MapIcon, "1"], ["sequence", "Sequence", Dna, "2"], ["enzymes", "Enzymes & gel", Scissors, "3"],
  ["clone", "Clone", FlaskConical, "4"], ["primers", "Primers", Beaker, "5"], ["orfs", "ORFs", WandSparkles, ""],
  ["tools", "Tools", AlignCenter, ""], ["history", "History", History, ""],
];
const SITE_MODES: [SiteMode, string][] = [["unique", "Unique"], ["two", "Two-cutters"], ["mcs", "MCS-flanking"], ["chosen", "Chosen"], ["none", "None"]];
const FEATURE_TYPES = ["CDS", "gene", "promoter", "terminator", "rep_origin", "RBS", "protein_bind", "primer_bind", "polyA_signal", "mat_peptide", "regulatory", "misc_feature"];
const SHORTCUTS: [string, string][] = [
  ["Ctrl S", "Save"], ["Ctrl Z / Ctrl ⇧ Z", "Undo / redo"], ["Esc", "Clear selection"], ["Ctrl A", "Select whole sequence"],
  ["Ctrl C", "Copy selected DNA"], ["Ctrl F", "Find DNA"], ["+ / −", "Zoom the linear map"], ["0 / Z", "Show all / zoom to selection"],
  ["1 – 5", "Map, Sequence, Enzymes, Clone, Primers"], ["?", "This list"],
];

export function ExpressionVectorJob({ bundle, onChanged }: { bundle: ProteinBundle; onChanged: () => Promise<void> }) {
  const [vectors, setVectors] = useState<VectorRecord[]>([]);
  const [loadingList, setLoadingList] = useState(true);
  const [listError, setListError] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<VectorRecord>(() => blankVector());
  const [dirty, setDirty] = useState(false);
  const [tab, setTab] = useState<VectorTab>("map");
  const [selection, setSelection] = useState<VectorSelection>(null);
  const [viewport, setViewport] = useState<Viewport>({ from: 0, to: 1 });
  const [showOrfs, setShowOrfs] = useState(false);
  const [siteMode, setSiteMode] = useState<SiteMode>("unique");
  const [featureName, setFeatureName] = useState("New feature");
  const [featureType, setFeatureType] = useState("misc_feature");
  const [insertSequence, setInsertSequence] = useState("");
  const [orfMinimum, setOrfMinimum] = useState(50);
  const [alignId, setAlignId] = useState("");
  const [alignment, setAlignment] = useState<JsonObject | null>(null);
  const [assemblyIds, setAssemblyIds] = useState<string[]>([]);
  const [assemblyName, setAssemblyName] = useState("Overlap assembly");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [browsing, setBrowsing] = useState(false);
  const [browserDismissed, setBrowserDismissed] = useState(false);
  const [undo, setUndo] = useState<VectorRecord[]>([]);
  const [redo, setRedo] = useState<VectorRecord[]>([]);
  const [helpOpen, setHelpOpen] = useState(false);
  // Enzymes, gel and primers.
  // Enzyme rows are tagged with the vector they describe, and only the latest
  // request may store them, so a slow answer can never plot another vector's sites.
  const [enzymeResult, setEnzymeResult] = useState<Tagged<EnzymeRow[]> | null>(null);
  const [enzymeGate] = useState(createRequestGate);
  const [enzymeLoading, setEnzymeLoading] = useState(false);
  const [enzymeError, setEnzymeError] = useState("");
  const [insertChecked, setInsertChecked] = useState(false);
  const [chosen, setChosen] = useState<string[]>([]);
  const [gelLanes, setGelLanes] = useState<GelLaneRequest[]>([]);
  const [ladder, setLadder] = useState<"1kb" | "100bp">("1kb");
  const [gel, setGel] = useState<GelResult | null>(null);
  const [gelLoading, setGelLoading] = useState(false);
  const [gelError, setGelError] = useState("");
  const [primerSettings, setPrimerSettings] = useState<PrimerSettings>(defaultPrimerSettings);
  const [designed, setDesigned] = useState<CheckedPrimer[]>([]);
  const [primerLoading, setPrimerLoading] = useState(false);
  const [primerError, setPrimerError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);

  const say = (text: string, error = false) => setMessage({ text, error });
  const length = draft.sequence.length;

  function show(record: VectorRecord) {
    setSelectedId(record.id); setDraft(record); setDirty(false);
    setViewport({ from: 0, to: Math.max(1, record.sequence.length) });
  }

  async function load(preferred = selectedId) {
    setLoadingList(true); setListError("");
    try {
      const response = await proteinLabsApi.listVectors(bundle.protein.id);
      const next = response.vectors.map(vectorRecord);
      setVectors(next);
      const selected = next.find((vector) => vector.id === preferred) ?? next[0];
      if (selected) show(selected);
      else { setSelectedId(""); setDraft(blankVector()); setDirty(false); }
      return next;
    } catch (reason) { setListError(errorText(reason)); return []; }
    finally { setLoadingList(false); }
  }
  useEffect(() => {
    void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.protein.id]);

  // ---- The construct as every view sees it -------------------------------------------------
  const features = useMemo<MapFeature[]>(() => draft.features.map(mapFeature), [draft.features]);
  const recordCuts = useMemo(() => cutSitesFromRecord(draft.restrictionSites, length), [draft.restrictionSites, length]);
  const mcs = useMemo(() => locateMcs(features, recordCuts, length), [features, recordCuts, length]);
  // "Flanks the MCS" means a unique cutter in or just beside the cloning region,
  // which is what a cloner looks for. (The engine's flag requires sites on both
  // sides, which only multi-cutters can satisfy.)
  const rawEnzymeRows = valueFor(enzymeResult, selectedId);
  const enzymeRows = useMemo(() => rawEnzymeRows?.map((row) => ({ ...row, mcsFlanking: row.uniqueCutter && !!mcs && row.cutPositions.some((position) => position - 1 >= mcs.start - 40 && position - 1 <= mcs.end + 40) })) ?? null, [rawEnzymeRows, mcs]);
  const allCuts = useMemo(() => enzymeRows ? cutSitesFromEnzymeRows(enzymeRows, length) : recordCuts, [enzymeRows, recordCuts, length]);
  const shownCuts = useMemo(() => {
    if (siteMode === "none") return [];
    if (siteMode === "chosen") return allCuts.filter((site) => chosen.includes(site.enzyme));
    if (siteMode === "mcs") { const flanking = new Set((enzymeRows ?? []).filter((row) => row.mcsFlanking).map((row) => row.enzyme)); return allCuts.filter((site) => flanking.has(site.enzyme)); }
    return allCuts.filter((site) => site.cutCount === (siteMode === "unique" ? 1 : 2));
  }, [allCuts, siteMode, chosen, enzymeRows]);
  const view: ViewVector = useMemo(() => ({ name: draft.name, sequence: draft.sequence, circular: draft.circular, features, cuts: shownCuts }), [draft.name, draft.sequence, draft.circular, features, shownCuts]);
  const activeFeature = selection?.featureId ? draft.features.find((feature) => String(feature.id) === selection.featureId) : undefined;
  const range = selection?.range ?? null;
  const selectedSize = range ? rangeLength(range, length) : 0;

  /** The single entry point for selection; keeps the linear map showing what was picked elsewhere. */
  function select(next: VectorSelection) {
    setSelection(next);
    if (next && next.source !== "linear" && length) {
      const { start, end } = next.range;
      const inView = start >= viewport.from && Math.min(end, start + 1) <= viewport.to;
      const zoomed = viewport.to - viewport.from < length - 1;
      if (zoomed && !inView) setViewport(fitRange(end > start ? next.range : { start, end: start + 1 }, length));
    }
  }

  // ---- Enzyme analysis ---------------------------------------------------------------------
  async function analyseEnzymes(id = selectedId, record = draft) {
    const token = enzymeGate.begin();
    setEnzymeResult(null); setEnzymeError("");
    if (!id) { setEnzymeLoading(false); return; }
    setEnzymeLoading(true);
    try {
      let insert = "";
      if (insertChecked && bundle.protein.sequence) insert = String((await proteinLabsApi.backTranslate(bundle.protein.sequence, "ecoli")).dna ?? "");
      if (!enzymeGate.isCurrent(token)) return;
      const cuts = cutSitesFromRecord(record.restrictionSites, record.sequence.length);
      const region = locateMcs(record.features.map(mapFeature), cuts, record.sequence.length);
      const result = await proteinLabsApi.vectorEnzymeSets(bundle.protein.id, id, { enzymeNames: ANALYSED_ENZYMES, ...(insert ? { insertSequence: insert } : {}), ...(region ? { mcs: region } : {}) });
      if (enzymeGate.isCurrent(token)) setEnzymeResult({ key: id, value: result.enzymes });
    } catch (reason) { if (enzymeGate.isCurrent(token)) setEnzymeError(`Enzyme analysis failed: ${errorText(reason)}. The maps show the vector's stored sites instead.`); }
    finally { if (enzymeGate.isCurrent(token)) setEnzymeLoading(false); }
  }
  useEffect(() => {
    void analyseEnzymes(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedId, insertChecked, draft.updatedAt]);

  // ---- Persistence -------------------------------------------------------------------------
  function choose(id: string) {
    if (dirty && !window.confirm(`Discard unsaved changes to ${draft.name}?`)) return;
    const value = vectors.find((vector) => vector.id === id);
    if (!value) return;
    show(value); setSelection(null); setUndo([]); setRedo([]); setAlignment(null); setDesigned([]); setGel(null); setGelLanes([]); setChosen([]);
  }

  function beginNew() {
    if (dirty && !window.confirm(`Discard unsaved changes to ${draft.name}?`)) return;
    setSelectedId(""); setDraft(blankVector()); setDirty(false); setSelection(null); setUndo([]); setRedo([]); setTab("sequence");
  }

  async function persist(value = draft, note = "Vector saved.") {
    if (!value.sequence.trim()) { say("Enter or import a DNA sequence before saving.", true); return null; }
    setBusy(true); setMessage(null);
    try {
      const saved = selectedId ? await proteinLabsApi.updateVector(bundle.protein.id, selectedId, value) : await proteinLabsApi.createVector(bundle.protein.id, value);
      const record = vectorRecord(saved);
      const latest = await proteinLabsApi.getProtein(bundle.protein.id);
      await ensureProjectJob(bundle.protein.id, latest.projectJobs, "expression-planning", `Expression vector — ${record.name}`, { vectorId: record.id, vectorName: record.name, featureCount: record.features.length, primerCount: record.primers.length, savedByUser: true });
      await load(record.id); await onChanged(); say(note); return record;
    } catch (reason) { say(errorText(reason), true); return null; }
    finally { setBusy(false); }
  }

  /** Server operations act on the saved vector, so unsaved edits are saved first. */
  async function savedRecord() {
    if (selectedId && !dirty) return draft;
    return persist(draft, "Changes saved.");
  }

  async function adopt(vector: JsonObject, note: string, nextTab: VectorTab = "clone") {
    const record = vectorRecord(vector);
    await load(record.id);
    const latest = await proteinLabsApi.getProtein(bundle.protein.id);
    await ensureProjectJob(bundle.protein.id, latest.projectJobs, "expression-planning", `Expression vector — ${record.name}`, {
      vectorId: record.id, vectorName: record.name, featureCount: record.features.length, primerCount: record.primers.length,
      source: String(vector.source ?? vector.sourceName ?? "project"), sourceId: String(vector.sourceId ?? ""), sourceUrl: String(vector.sourceUrl ?? ""), savedByUser: true,
    });
    await onChanged();
    setBrowsing(false); setTab(nextTab); say(note);
    return record;
  }

  /** A server-side commit into the open construct: keep the construct before it on the undo stack. */
  async function adoptCommitted(vector: JsonObject, note: string, before: VectorRecord) {
    const record = await adopt(vector, note, "map");
    const next = commit({ undo, redo, current: before }, record);
    setUndo(next.undo); setRedo(next.redo);
  }

  async function importFile(file: File | null) {
    if (!file) return;
    setBusy(true); setMessage(null);
    try {
      const snapgene = /\.(dna|prot)$/i.test(file.name);
      const content = snapgene ? await fileToBase64(file) : await file.text();
      const imported = vectorRecord(await proteinLabsApi.importVector(bundle.protein.id, file.name, content));
      await load(imported.id); setTab("map"); say(`${file.name} imported with ${imported.features.length} annotations.`);
    }
    catch (reason) { say(errorText(reason), true); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function exportFile(format: "genbank" | "fasta" | "snapgene") {
    if (!selectedId || dirty) { say("Save the vector before exporting it.", true); return; }
    try {
      const result = await proteinLabsApi.exportVector(bundle.protein.id, selectedId, format);
      if (result.encoding === "base64") downloadBytes(result.filename, result.content);
      else downloadText(result.filename, result.content);
    }
    catch (reason) { say(errorText(reason), true); }
  }

  async function annotateAutomatically() {
    const saved = await savedRecord();
    if (!saved) return;
    setBusy(true);
    try { const annotated = vectorRecord(await proteinLabsApi.autoAnnotateVector(bundle.protein.id, saved.id, orfMinimum, true)); await load(annotated.id); setTab("map"); const report = object(annotated.annotationReport); say(`${String(report.added ?? 0)} features added by ${String(report.method ?? "automatic annotation")}.`); }
    catch (reason) { say(errorText(reason), true); }
    finally { setBusy(false); }
  }

  // ---- Local edits with undo ---------------------------------------------------------------
  function edit(next: VectorRecord) {
    const history = commit({ undo, redo, current: structuredClone(draft) }, next);
    setUndo(history.undo); setRedo(history.redo);
    setDraft(next); setDirty(true);
  }

  function restore(direction: "undo" | "redo") {
    if (!(direction === "undo" ? undo : redo).length) return;
    const history = (direction === "undo" ? undoStep : redoStep)({ undo, redo, current: structuredClone(draft) });
    setUndo(history.undo); setRedo(history.redo);
    setDraft(history.current); setDirty(true); say(`${direction === "undo" ? "Undid" : "Redid"} the last change. Save to keep it.`);
  }

  function annotateSelection() {
    if (!range || !selectedSize) { say("Select a region on any view first.", true); return; }
    const feature = { id: `feature-${crypto.randomUUID()}`, name: featureName.trim() || "New feature", type: featureType, start: range.start, end: range.end, strand: 1, color: "", notes: "", automatic: false };
    edit({ ...draft, features: [...draft.features, feature] });
    select({ range, featureId: feature.id, source: "list" });
    say(`${feature.name} annotated at ${formatRange(range, length)}. Save to keep it.`);
  }

  function updateFeature(patch: JsonObject) {
    if (!activeFeature) return;
    const next = { ...draft, features: draft.features.map((feature) => String(feature.id) === selection?.featureId ? { ...feature, ...patch } : feature) };
    edit(next);
    if ("start" in patch || "end" in patch) {
      const updated = next.features.find((feature) => String(feature.id) === selection?.featureId);
      if (updated) setSelection({ range: { start: Number(updated.start), end: Number(updated.end) }, featureId: String(updated.id), source: "list" });
    }
  }

  function deleteFeature() {
    if (!activeFeature) return;
    edit({ ...draft, features: draft.features.filter((feature) => String(feature.id) !== selection?.featureId) });
    setSelection(null); say("Annotation removed. Save to keep the change.");
  }

  async function sequenceOperation(operation: "insert" | "delete" | "replace" | "reverse_complement") {
    let start = range?.start ?? 0, end = range?.end ?? 0;
    if (range && range.end < range.start) { say("Edits across the origin are not supported; select one side of the origin.", true); return; }
    const replacement = operation === "insert" || operation === "replace" ? cleanDna(insertSequence) : "";
    if ((operation === "delete" || operation === "replace") && end <= start) { say("Select a region first.", true); return; }
    if ((operation === "insert" || operation === "replace") && !replacement) { say("Enter the DNA to insert in the inspector.", true); return; }
    if (operation === "reverse_complement" && end <= start) { start = 0; end = length; }
    const saved = await savedRecord();
    if (!saved) return;
    setUndo((values) => [...values.slice(-99), structuredClone(saved)]); setRedo([]); setBusy(true);
    try { const result = vectorRecord(await proteinLabsApi.editVectorSequence(bundle.protein.id, saved.id, operation, start, end, replacement)); await load(result.id); setSelection(null); say(`${operation.replace("_", " ")} applied and saved.`); }
    catch (reason) { say(errorText(reason), true); }
    finally { setBusy(false); }
  }

  function find(motif: string) {
    const query = cleanDna(motif);
    if (!query) return "";
    const haystack = draft.circular ? draft.sequence + draft.sequence.slice(0, query.length - 1) : draft.sequence;
    const from = range ? range.start + 1 : 0;
    let index = haystack.indexOf(query, from);
    if (index < 0 || index >= length) index = haystack.indexOf(query);
    const reverse = haystack.indexOf(reverseComplementOf(query), from);
    if (index < 0 && reverse < 0) return "No match";
    const hit = index >= 0 && index < length ? index : reverse;
    const hitRange = { start: hit, end: (hit + query.length) % (length || 1) || length };
    select({ range: hitRange, source: "list" });
    let count = 0;
    for (let at = haystack.indexOf(query); at >= 0 && at < length; at = haystack.indexOf(query, at + 1)) count += 1;
    return `${count} match${count === 1 ? "" : "es"}${hit === reverse && index !== hit ? " (reverse strand)" : ""}`;
  }

  // ---- Enzymes, gel and primers ------------------------------------------------------------
  function digest(names: string[]) {
    const lane = { id: `lane-${names.join("-")}-${gelLanes.length}`, name: names.join(" + "), enzymeNames: names };
    const lanes = [...gelLanes.filter((value) => value.name !== lane.name), lane];
    setGelLanes(lanes);
    void runGel(lanes);
  }

  async function runGel(lanes = gelLanes) {
    const saved = await savedRecord();
    if (!saved || !lanes.length) return;
    setGelLoading(true); setGelError("");
    try { setGel(await proteinLabsApi.simulateGel(bundle.protein.id, ladder, lanes.map((lane) => lane.enzymeNames.length ? { id: lane.id, name: lane.name, vectorId: saved.id, enzymeNames: lane.enzymeNames } : { id: lane.id, name: `${lane.name} (full length)`, bandSizes: [saved.sequence.length] }))); }
    catch (reason) { setGelError(`The gel could not be simulated: ${errorText(reason)}`); }
    finally { setGelLoading(false); }
  }

  async function designPrimers() {
    if (!range || range.end <= range.start) { setPrimerError("Select the region to amplify."); return; }
    const saved = await savedRecord();
    if (!saved) return;
    setPrimerLoading(true); setPrimerError("");
    const settings = primerSettings;
    try {
      const response = await proteinLabsApi.designTmPrimers(bundle.protein.id, saved.id, {
        name: settings.name, start: range.start, end: range.end, targetTmCelsius: settings.targetTm, minLength: settings.minLength, maxLength: settings.maxLength,
        minGcPercent: settings.minGc, maxGcPercent: settings.maxGc, cloningMethod: settings.method === "restriction" ? "pcr" : settings.method,
        forwardOverhang: settings.forwardOverhang, reverseOverhang: settings.reverseOverhang,
      });
      const checked = readDesignedPrimers(response);
      setDesigned(checked.primers);
      await load(String(response.id ?? saved.id));
      if (checked.error) setPrimerError(checked.error);
      else say("Primer pair designed and saved to the construct.");
    } catch (reason) { setPrimerError(errorText(reason)); }
    finally { setPrimerLoading(false); }
  }

  async function removePrimer(id: string) { const next = { ...draft, primers: draft.primers.filter((primer) => String(primer.id) !== id) }; setDraft(next); await persist(next, "Primer removed."); }

  async function runAlignment() { if (!selectedId || !alignId) return say("Choose a second saved vector.", true); setBusy(true); try { setAlignment(await proteinLabsApi.alignVectors(bundle.protein.id, selectedId, alignId)); say("Pairwise DNA alignment completed."); } catch (reason) { say(errorText(reason), true); } finally { setBusy(false); } }
  async function runAssembly() { if (assemblyIds.length < 2) return say("Select at least two vectors in assembly order.", true); setBusy(true); try { const created = vectorRecord(await proteinLabsApi.assembleVectors(bundle.protein.id, assemblyName, assemblyIds, 20, false)); await load(created.id); say("Overlap assembly created and saved as a new vector."); } catch (reason) { say(errorText(reason), true); } finally { setBusy(false); } }
  async function deleteVector() { if (!selectedId || !window.confirm(`Delete ${draft.name}?`)) return; await proteinLabsApi.deleteVector(bundle.protein.id, selectedId); await load(""); say("Vector deleted."); }

  // ---- Keyboard ----------------------------------------------------------------------------
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      const typing = !!target && (/^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName) || target.isContentEditable);
      const mod = event.ctrlKey || event.metaKey;
      const key = event.key.toLowerCase();
      if (mod && key === "s") { event.preventDefault(); if (!busy) void persist(); return; }
      if (event.key === "Escape") { if (helpOpen) setHelpOpen(false); else if (!typing) setSelection(null); return; }
      if (mod && key === "f") { event.preventDefault(); document.getElementById("vector-find")?.focus(); return; }
      if (typing) return;
      if (mod && key === "z") { event.preventDefault(); restore(event.shiftKey ? "redo" : "undo"); return; }
      if (mod && key === "y") { event.preventDefault(); restore("redo"); return; }
      if (mod && key === "a" && length) { event.preventDefault(); select({ range: { start: 0, end: length }, source: "list" }); return; }
      if (mod && key === "c" && range && selectedSize) { event.preventDefault(); void navigator.clipboard?.writeText(rangeSequence(draft.sequence, range)); say(`${selectedSize} bp copied.`); return; }
      if (mod || event.altKey) return;
      if (event.key === "?") { setHelpOpen((open) => !open); return; }
      if (event.key === "+" || event.key === "=") { setViewport((current) => zoomAbout(current, 0.625, length)); return; }
      if (event.key === "-" || event.key === "_") { setViewport((current) => zoomAbout(current, 1.6, length)); return; }
      if (event.key === "0") { setViewport({ from: 0, to: length }); return; }
      if (key === "z" && range && selectedSize) { setViewport(fitRange(range, length)); return; }
      const shortcut = TABS.find(([, , , digit]) => digit && digit === event.key);
      if (shortcut) setTab(shortcut[0]);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  });

  const mapViews = { vector: view, selection, onSelect: select, showOrfs };
  const featureTally = features.reduce((tally, feature) => featureCategory(feature) === "orf" ? { ...tally, orfs: tally.orfs + 1 } : { ...tally, real: tally.real + 1 }, { real: 0, orfs: 0 });

  return <div className="vector-planner">
    <aside className="vector-library">
      <header><span><strong>Project vectors</strong><small>{loadingList ? "Loading…" : `${vectors.length} saved construct${vectors.length === 1 ? "" : "s"}`}</small></span><Button size="icon-sm" onClick={beginNew} title="New blank vector" aria-label="New blank vector"><Plus /></Button></header>
      <div>
        {listError && <div className="vpanel-error"><CircleAlert /><span>Could not load vectors: {listError}</span><Button size="sm" variant="outline" onClick={() => void load()}>Retry</Button></div>}
        {loadingList && !vectors.length && <div className="vpanel-loading"><LoaderCircle className="spin" /> Loading constructs…</div>}
        {vectors.map((vector) => <button className={vector.id === selectedId ? "selected" : ""} key={vector.id} onClick={() => choose(vector.id)}><Dna /><span><strong>{vector.name}</strong><small>{vector.sequence.length.toLocaleString()} bp · {vector.features.length} features</small></span></button>)}
      </div>
      <input ref={fileRef} type="file" hidden accept=".gb,.gbk,.genbank,.fa,.fasta,.fna,.dna" onChange={(event) => void importFile(event.target.files?.[0] ?? null)} />
      <Button onClick={() => setBrowsing(true)}><Database /> Load backbone</Button>
      <Button variant="outline" onClick={() => fileRef.current?.click()}><FileInput /> Import GenBank / FASTA / .dna</Button>
    </aside>

    <section className="vector-main">
      <header className="vector-editor-header">
        <div>
          <input value={draft.name} aria-label="Construct name" onChange={(event) => { setDraft({ ...draft, name: event.target.value }); setDirty(true); }} />
          <span>{length.toLocaleString()} bp · {draft.circular ? "circular" : "linear"} · {Number(gcOf(draft.sequence)).toFixed(1)}% GC · {featureTally.real} features{featureTally.orfs ? ` + ${featureTally.orfs} ORFs` : ""}{dirty ? " · unsaved changes" : ""}</span>
        </div>
        <label className="topology-toggle"><input type="checkbox" checked={draft.circular} onChange={(event) => edit({ ...draft, circular: event.target.checked })} /><span>{draft.circular ? "Circular" : "Linear"}</span></label>
        <Button disabled={busy || (!dirty && !!selectedId)} onClick={() => void persist()} title="Save (Ctrl+S)">{busy ? <LoaderCircle className="spin" /> : <Save />} {dirty || !selectedId ? "Save" : "Saved"}</Button>
        <Button variant="outline" onClick={() => void annotateAutomatically()} title="Detect common features and ORFs"><WandSparkles /> Auto annotate</Button>
        <Button variant="ghost" size="icon" disabled={!undo.length} onClick={() => restore("undo")} title="Undo (Ctrl+Z)" aria-label="Undo"><Undo2 /></Button>
        <Button variant="ghost" size="icon" disabled={!redo.length} onClick={() => restore("redo")} title="Redo (Ctrl+Shift+Z)" aria-label="Redo"><Redo2 /></Button>
        <Button variant="ghost" size="icon" onClick={() => setHelpOpen(true)} title="Keyboard shortcuts (?)" aria-label="Keyboard shortcuts"><Keyboard /></Button>
      </header>
      <nav className="vector-tabs" role="tablist">{TABS.map(([id, label, Icon, digit]) => <button key={id} role="tab" aria-selected={tab === id} className={tab === id ? "active" : ""} onClick={() => setTab(id)} title={digit ? `${label} (${digit})` : label}><Icon />{label}</button>)}</nav>
      {message && <div className={`vector-status${message.error ? " error" : ""}`} role={message.error ? "alert" : "status"}>{message.error ? <CircleAlert /> : <Check />}<span>{message.text}</span><button type="button" aria-label="Dismiss" onClick={() => setMessage(null)}><X /></button></div>}
      {(tab === "map" || tab === "sequence") && length > 0 && <div className="vmap-toolbar">
        <span className="vmap-toolbar-label">Cut sites</span>
        <div className="vseg" role="radiogroup" aria-label="Which cut sites to show">{SITE_MODES.map(([id, label]) => <button key={id} role="radio" aria-checked={siteMode === id} className={siteMode === id ? "active" : ""} disabled={id === "chosen" && !chosen.length} onClick={() => setSiteMode(id)}>{label}{id !== "none" && <b>{countFor(id, enzymeRows, recordCuts, chosen)}</b>}</button>)}</div>
        {enzymeLoading && <LoaderCircle className="spin" aria-label="Analysing enzymes" />}
        <button type="button" className="vmap-toggle" onClick={() => setShowOrfs((value) => !value)} aria-pressed={showOrfs}>{showOrfs ? <Eye /> : <EyeOff />} ORFs</button>
      </div>}
      <div className={`vector-tab-content tab-${tab}`}>
        {(tab === "map" || tab === "sequence") && !length && <EmptySequence draft={draft} onSequence={(sequence) => { setDraft({ ...draft, sequence }); setDirty(true); setViewport({ from: 0, to: Math.max(1, sequence.length) }); }} onBrowse={() => setBrowsing(true)} onImport={() => fileRef.current?.click()} />}
        {tab === "map" && length > 0 && <div className="vmap-stack">
          <CircularMap {...mapViews} />
          <LinearMap {...mapViews} viewport={viewport} onViewport={setViewport} compact />
          <FeatureLegend features={view.features.filter((feature) => showOrfs || featureCategory(feature) !== "orf")} />
        </div>}
        {tab === "sequence" && length > 0 && <div className="vseq-stack">
          <LinearMap {...mapViews} viewport={viewport} onViewport={setViewport} compact />
          <div className="sequence-toolbar">
            <Button size="sm" variant="outline" onClick={annotateSelection} disabled={!selectedSize}><Plus /> Annotate selection</Button>
            <Button size="sm" variant="ghost" onClick={() => void sequenceOperation("insert")} disabled={!range}><Plus /> Insert DNA at caret</Button>
            <Button size="sm" variant="ghost" onClick={() => void sequenceOperation("replace")} disabled={!selectedSize}><ArrowLeftRight /> Replace</Button>
            <Button size="sm" variant="ghost" onClick={() => void sequenceOperation("delete")} disabled={!selectedSize}><Trash2 /> Delete</Button>
            <Button size="sm" variant="ghost" onClick={() => void sequenceOperation("reverse_complement")}><AlignCenter /> Reverse complement</Button>
          </div>
          <SequenceView {...mapViews} />
        </div>}
        {tab === "enzymes" && <div className="venz-stack">
          {!selectedId ? <div className="vpanel-empty">Save or load a construct to analyse its restriction sites.</div> : <>
            <EnzymeChooser rows={enzymeRows} loading={enzymeLoading} error={enzymeError} insertChecked={insertChecked} onInsertCheck={setInsertChecked} onReload={() => void analyseEnzymes()} chosen={chosen}
              onChosen={(names) => { setChosen(names); if (names.length) setSiteMode("chosen"); else if (siteMode === "chosen") setSiteMode("unique"); }}
              onFocus={(row) => { const first = cutSitesFromEnzymeRows([row], length)[0]; if (first) select({ range: { start: first.cut, end: first.cut }, enzyme: row.enzyme, source: "list" }); }}
              onDigest={digest} />
            <GelPanel lanes={gelLanes} onLanes={setGelLanes} result={gel} loading={gelLoading} error={gelError} ladder={ladder} onLadder={setLadder} onRun={() => void runGel()} />
          </>}
        </div>}
        {tab === "clone" && <VectorCloningWorkspace bundle={bundle} vectorId={dirty ? "" : selectedId} vectorName={draft.name} backbone={view} projectVectors={vectors.filter((vector) => vector.id !== selectedId).map((vector) => ({ id: vector.id, name: vector.name, length: vector.sequence.length }))} uniqueEnzymes={(enzymeRows ?? []).filter((row) => enzymeInGroup(row, "unique")).map((row) => row.enzyme)} unsaved={dirty} onInserted={(vector, note) => adopt(vector, note, "map")} onCommitted={(vector, note) => adoptCommitted(vector, note, structuredClone(draft))} />}
        {tab === "primers" && <PrimerPanel settings={primerSettings} onSettings={setPrimerSettings} region={range && selectedSize ? range : null} length={length} designed={designed} saved={draft.primers} loading={primerLoading} error={primerError} onDesign={() => void designPrimers()} onRemove={(id) => void removePrimer(id)} onFocus={(next) => select({ range: next, source: "list" })} />}
        {tab === "orfs" && <div className="orf-workspace"><div className="tool-row"><label>Minimum ORF amino acids<input type="number" min="5" value={orfMinimum} onChange={(event) => setOrfMinimum(Number(event.target.value))} /></label><Button onClick={() => void annotateAutomatically()}><WandSparkles /> Detect and annotate ORFs</Button></div>{!draft.orfs.length && <div className="vpanel-empty">No ORFs detected yet. Run detection above.</div>}{draft.orfs.length > 0 && <div className="data-table"><div><b>ORF</b><b>Coordinates</b><b>Frame</b><b>Length</b><b>Translation</b></div>{draft.orfs.map((orf) => <button key={String(orf.id)} onClick={() => select({ range: { start: Number(orf.start), end: Number(orf.end) }, source: "list" })}><strong>{String(orf.name)}</strong><span>{Number(orf.start) + 1}–{String(orf.end)}</span><span>{String(orf.frame)}</span><span>{String(orf.aminoAcids)} aa</span><code>{String(orf.translation).slice(0, 45)}…</code></button>)}</div>}</div>}
        {tab === "tools" && <div className="vector-tools"><section><h3><AlignCenter /> Align saved vectors</h3><select value={alignId} onChange={(event) => setAlignId(event.target.value)}><option value="">Choose query vector</option>{vectors.filter((vector) => vector.id !== selectedId).map((vector) => <option key={vector.id} value={vector.id}>{vector.name}</option>)}</select><Button onClick={() => void runAlignment()}>Align</Button>{alignment && <div className="alignment-result"><strong>{Number(alignment.identityPercent ?? 0).toFixed(2)}% identity</strong><span>{String(alignment.mismatches ?? 0)} mismatches · {String(alignment.gaps ?? 0)} gaps · score {String(alignment.score ?? "—")}</span></div>}</section><section><h3><FlaskConical /> Overlap assembly</h3><input value={assemblyName} onChange={(event) => setAssemblyName(event.target.value)} /><div className="assembly-list">{vectors.map((vector) => <label key={vector.id}><input type="checkbox" checked={assemblyIds.includes(vector.id)} onChange={(event) => setAssemblyIds(event.target.checked ? [...assemblyIds, vector.id] : assemblyIds.filter((id) => id !== vector.id))} />{vector.name}</label>)}</div><Button onClick={() => void runAssembly()}>Assemble selected vectors</Button></section></div>}
        {tab === "history" && <div className="history-list">{!draft.history.length && <div className="vpanel-empty">No recorded operations yet.</div>}{[...draft.history].reverse().map((entry, index) => <article key={index}><History /><span><strong>{humanize(String(entry.type ?? "Vector operation"))}</strong><small>{historyDetail(entry)}</small></span></article>)}</div>}
      </div>
      {length > 0 && <SelectionBar vector={view} selection={selection} onFind={find} />}
    </section>

    <aside className="feature-inspector">
      <header><strong>{activeFeature ? "Feature" : "Inspector"}</strong>{activeFeature && <Button variant="ghost" size="icon-sm" onClick={() => setSelection(null)} aria-label="Close feature"><X /></Button>}</header>
      {activeFeature ? <>
        <div className="vinspect-swatch"><i style={{ background: featureColor(mapFeature(activeFeature)) }} />{CATEGORY_STYLE[featureCategory(mapFeature(activeFeature))].label}</div>
        <label>Name<input value={String(activeFeature.name ?? "")} onChange={(event) => updateFeature({ name: event.target.value })} /></label>
        <label>Type<select value={String(activeFeature.type ?? "misc_feature")} onChange={(event) => updateFeature({ type: event.target.value })}>{[...new Set([String(activeFeature.type ?? "misc_feature"), ...FEATURE_TYPES])].map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <div className="coordinate-row"><label>Start<input type="number" min="1" max={length} value={Number(activeFeature.start) + 1} onChange={(event) => updateFeature({ start: Math.max(0, Number(event.target.value) - 1) })} /></label><label>End<input type="number" min="1" max={length} value={Number(activeFeature.end)} onChange={(event) => updateFeature({ end: Math.min(length, Number(event.target.value)) })} /></label></div>
        <label>Strand<select value={Number(activeFeature.strand) < 0 ? -1 : Number(activeFeature.strand) === 0 ? 0 : 1} onChange={(event) => updateFeature({ strand: Number(event.target.value) })}><option value="1">Forward (+)</option><option value="-1">Reverse (−)</option><option value="0">None</option></select></label>
        <label className="vinspect-color"><span><input type="checkbox" checked={Boolean(activeFeature.customColor)} onChange={(event) => updateFeature({ customColor: event.target.checked, color: String(activeFeature.color || featureColor(mapFeature(activeFeature))) })} /> Custom colour</span>{Boolean(activeFeature.customColor) && <input type="color" value={hexOr(String(activeFeature.color ?? ""), "#607d8b")} onChange={(event) => updateFeature({ color: event.target.value })} />}</label>
        <label>Notes<textarea value={String(activeFeature.notes ?? "")} onChange={(event) => updateFeature({ notes: event.target.value })} /></label>
        <Button variant="destructive" onClick={deleteFeature}><Trash2 /> Delete annotation</Button>
      </> : <>
        <p>Select a feature on any view to edit it, or drag across the map or sequence to select a region.</p>
        <label>New feature name<input value={featureName} onChange={(event) => setFeatureName(event.target.value)} /></label>
        <label>Feature type<select value={featureType} onChange={(event) => setFeatureType(event.target.value)}>{FEATURE_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
        <Button onClick={annotateSelection} disabled={!selectedSize}><Plus /> Annotate selection</Button>
        <label>DNA to insert or replace with<textarea className="short-dna" value={insertSequence} onChange={(event) => setInsertSequence(cleanDna(event.target.value))} placeholder="Used by Insert and Replace on the Sequence tab" /></label>
      </>}
      <hr />
      <div className="vinspect-export">
        <Button variant="outline" size="sm" onClick={() => void exportFile("genbank")}><Download /> GenBank</Button>
        <Button variant="outline" size="sm" onClick={() => void exportFile("snapgene")}><Download /> SnapGene .dna</Button>
        <Button variant="outline" size="sm" onClick={() => void exportFile("fasta")}><Download /> FASTA</Button>
      </div>
      {selectedId && <Button variant="ghost" className="danger-text" onClick={() => void deleteVector()}><Trash2 /> Delete vector</Button>}
    </aside>
    {helpOpen && <div className="backbone-overlay" role="dialog" aria-label="Keyboard shortcuts" onClick={() => setHelpOpen(false)}><div className="vhelp" onClick={(event) => event.stopPropagation()}><header><strong>Keyboard shortcuts</strong><Button variant="ghost" size="icon-sm" onClick={() => setHelpOpen(false)} aria-label="Close"><X /></Button></header><dl>{SHORTCUTS.map(([keys, action]) => <div key={keys}><dt>{keys.split(" ").map((part, index) => <kbd key={index}>{part}</kbd>)}</dt><dd>{action}</dd></div>)}</dl></div></div>}
    {(browsing || (!loadingList && !listError && !vectors.length && !selectedId && !browserDismissed)) && <div className="backbone-overlay" role="dialog" aria-label="Load a vector backbone"><VectorBackboneBrowser proteinId={bundle.protein.id} onLoaded={async (vector, note) => { await adopt(vector, note, "map"); }} onClose={() => { setBrowsing(false); setBrowserDismissed(true); }} /></div>}
  </div>;
}

function EmptySequence({ draft, onSequence, onBrowse, onImport }: { draft: VectorRecord; onSequence: (sequence: string) => void; onBrowse: () => void; onImport: () => void }) {
  return <div className="vempty">
    <Dna />
    <h3>{draft.id ? `${draft.name} has no sequence` : "Start a construct"}</h3>
    <p>Load a backbone from the catalogue, import a GenBank, FASTA or SnapGene file, or paste DNA below.</p>
    <div><Button onClick={onBrowse}><Database /> Load backbone</Button><Button variant="outline" onClick={onImport}><FileInput /> Import file</Button></div>
    <textarea className="dna-editor" spellCheck={false} placeholder="Paste DNA (A, C, G, T, N). Numbers and spaces are ignored." onChange={(event) => onSequence(cleanDna(event.target.value))} />
  </div>;
}

function countFor(mode: SiteMode, rows: EnzymeRow[] | null, recordCuts: { enzyme: string; cutCount: number }[], chosen: string[]) {
  if (mode === "chosen") return chosen.length;
  if (rows) return rows.filter((row) => mode === "unique" ? row.uniqueCutter : mode === "two" ? row.twoCutter : row.mcsFlanking).length;
  const names = new Set(recordCuts.filter((site) => site.cutCount === (mode === "unique" ? 1 : 2)).map((site) => site.enzyme));
  return mode === "mcs" ? "–" : names.size;
}

function zoomAbout(view: Viewport, factor: number, length: number): Viewport {
  const span = view.to - view.from, centre = (view.from + view.to) / 2;
  const next = Math.max(Math.min(length, 60), Math.min(length, span * factor));
  const from = Math.max(0, Math.min(length - next, centre - next / 2));
  return { from, to: from + next };
}

function mapFeature(raw: JsonObject): MapFeature {
  return { id: String(raw.id ?? ""), name: String(raw.name ?? raw.type ?? "feature"), type: String(raw.type ?? "misc_feature"), start: Number(raw.start ?? 0), end: Number(raw.end ?? 0), strand: Number(raw.strand ?? 1), color: String(raw.color ?? ""), customColor: Boolean(raw.customColor), automatic: Boolean(raw.automatic) };
}
function historyDetail(entry: JsonObject) {
  // The engine records zero-based, half-open coordinates; show them the way every other view does.
  const { start, end } = entry;
  const coordinates = typeof start === "number" && typeof end === "number"
    ? [end > start ? `Bases: ${(start + 1).toLocaleString()}–${end.toLocaleString()}` : `After base: ${start.toLocaleString()}`]
    : [];
  const parts = Object.entries(entry).filter(([key, value]) => key !== "type" && !(coordinates.length && (key === "start" || key === "end")) && value !== null && value !== "" && !(Array.isArray(value) && !value.length) && typeof value !== "object");
  return [...coordinates, ...parts.map(([key, value]) => `${sentence(key)}: ${String(value)}`)].join(" · ") || "No details recorded";
}
function blankVector(): VectorRecord { return { id: "", name: "Untitled vector", sequence: "", circular: true, features: [], primers: [], orfs: [], restrictionSites: [], history: [], enzymeNames: [], minimumOrfAminoAcids: 50 }; }
function vectorRecord(raw: JsonObject): VectorRecord { return { ...blankVector(), ...raw, id: String(raw.id ?? ""), name: String(raw.name ?? "Untitled vector"), sequence: String(raw.sequence ?? ""), circular: raw.circular !== false, features: array(raw.features), primers: array(raw.primers), orfs: array(raw.orfs), restrictionSites: array(raw.restrictionSites), history: array(raw.history) }; }
function array(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function cleanDna(value: string) { return value.toUpperCase().replace(/[^ACGTUN]/g, "").replace(/U/g, "T"); }
function gcOf(value: string) { return value ? (value.match(/[GC]/g)?.length ?? 0) / value.length * 100 : 0; }
function reverseComplementOf(value: string) { return value.split("").reverse().map((base) => ({ A: "T", T: "A", G: "C", C: "G" } as Record<string, string>)[base] ?? "N").join(""); }
function hexOr(value: string, fallback: string) { return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback; }
function errorText(value: unknown) { return value instanceof Error ? value.message : String(value); }
function humanize(value: string) { return value.replace(/([a-z])([A-Z])/g, "$1 $2").replace(/[_-]/g, " "); }
function sentence(value: string) { const words = humanize(value).toLowerCase(); return words.charAt(0).toUpperCase() + words.slice(1); }
function downloadText(filename: string, content: string) { downloadBlob(filename, new Blob([content], { type: "text/plain" })); }
function downloadBytes(filename: string, base64: string) { const binary = atob(base64); const bytes = new Uint8Array(binary.length); for (let index = 0; index < binary.length; index += 1) bytes[index] = binary.charCodeAt(index); downloadBlob(filename, new Blob([bytes], { type: "application/octet-stream" })); }
function downloadBlob(filename: string, blob: Blob) { const url = URL.createObjectURL(blob); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }
