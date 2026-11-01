"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowRight, Check, CircleAlert, Info, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { Cite, CiteGroup, ReferenceList } from "@/components/ui/citations";
import { StructureViewer } from "@/components/protein-labs/structure-viewer";
import { HsqcSpectrum } from "@/components/protein-labs/hsqc-spectrum";
import type { ViewerRegion } from "@/components/protein-labs/molstar-viewer";
import { citationScope, type CitationId, type CitationScope } from "@/lib/citations";
import { ensureProjectJob, proteinLabsApi, type JsonObject, type ProteinBundle } from "@/lib/protein-labs-api";
import { proteinFacts, type ProteinFacts } from "@/lib/protein-facts";
import { structureOptionLabel, type ResidueAddress, type StructureDetail, type StructureEntry, type StructureRegion } from "@/lib/structure-regions";
import {
  DEFAULT_VIEW, HSQC_APP_TYPE, hsqcConfig, hsqcInputs, hsqcPeaks, LINEWIDTH_HZ, positionAt, PREDICTOR_CITATIONS, PREDICTOR_ROLES, readHsqcPrediction, residuesAt, revealPoint, SPECTROMETER_MHZ, threeLetter, viewBounds,
  type HsqcInputs, type HsqcPrediction, type Peak, type SpectrumView,
} from "@/lib/hsqc";

const JOB_LABEL = "HSQC spectrum prediction";

// Every source this job cites, in first-use order down the page.
const REFERENCES: CitationId[] = ["bodenhausen1980", "kay1992", "cavanagh2007", "pervushin1997", "ucbshift2", "legolas2025", "shiftx2", "wishart1995", "nmrfam-sparky", "molstar", "alphafold2021", "uniprot2023", "bmrb"];

type Load<T> = { state: "idle" | "loading" } | { state: "ready"; value: T } | { state: "error"; message: string };
type StructureLoad = { key: string; detail: Load<StructureDetail>; regions: Load<StructureRegion[]> };

const NONE = "none";
const entryKey = (entry: { source: string; id: string }) => `${entry.source}:${entry.id}`;

export function HsqcJob({ bundle, onChanged, onOpenJob }: { bundle: ProteinBundle; onChanged: () => Promise<void>; onOpenJob: (jobId: string) => void }) {
  const proteinId = bundle.protein.id;
  const facts = useMemo(() => proteinFacts(bundle), [bundle]);
  const refs = useMemo(() => citationScope("hsqc", REFERENCES), []);
  const savedJob = bundle.projectJobs.find((job) => job.appType === HSQC_APP_TYPE);
  const sequence = facts.sequence.status === "known" ? facts.sequence.value.sequence : "";

  // ── Structure: the saved choice, else the AlphaFold model, else the first PDB entry.
  const [list, setList] = useState<Load<StructureEntry[]>>({ state: "loading" });
  const [choice, setChoice] = useState<string | null>(null);
  useEffect(() => {
    let active = true;
    proteinLabsApi.listStructures(proteinId).then((value) => { if (active) setList({ state: "ready", value: value.structures ?? [] }); })
      .catch((reason: unknown) => { if (active) setList({ state: "error", message: engineMessage(reason) }); });
    return () => { active = false; };
  }, [proteinId, bundle.alphaFoldModels.length]);
  const structures = useMemo(() => list.state === "ready" ? list.value : [], [list]);
  const savedStructure = savedStructureKey(savedJob?.config);
  const defaultKey = savedStructure && structures.some((entry) => entryKey(entry) === savedStructure) ? savedStructure : structures.find((entry) => entry.source === "alphafold_db") ? entryKey(structures.find((entry) => entry.source === "alphafold_db")!) : structures[0] ? entryKey(structures[0]) : NONE;
  const activeKey = choice ?? (list.state === "loading" ? null : defaultKey);
  const selected = structures.find((entry) => entryKey(entry) === activeKey) ?? null;

  const [loaded, setLoaded] = useState<StructureLoad>({ key: NONE, detail: { state: "idle" }, regions: { state: "idle" } });
  useEffect(() => {
    if (!selected) return;
    let active = true;
    const key = entryKey(selected);
    queueMicrotask(() => { if (active) setLoaded({ key, detail: { state: "loading" }, regions: { state: "loading" } }); });
    proteinLabsApi.getStructure(proteinId, selected.source, selected.id)
      .then((value) => { if (active) setLoaded((current) => current.key === key ? { ...current, detail: { state: "ready", value } } : current); })
      .catch((reason: unknown) => { if (active) setLoaded((current) => current.key === key ? { ...current, detail: { state: "error", message: engineMessage(reason) } } : current); });
    proteinLabsApi.getStructureRegions(proteinId, selected.source, selected.id)
      .then((value) => { if (active) setLoaded((current) => current.key === key ? { ...current, regions: { state: "ready", value: value.groups ?? [] } } : current); })
      .catch((reason: unknown) => { if (active) setLoaded((current) => current.key === key ? { ...current, regions: { state: "error", message: engineMessage(reason) } } : current); });
    return () => { active = false; };
  }, [proteinId, selected]);
  const current: StructureLoad = selected && loaded.key === entryKey(selected) ? loaded : { key: activeKey ?? NONE, detail: { state: selected ? "loading" : "idle" }, regions: { state: selected ? "loading" : "idle" } };
  const detail = current.detail.state === "ready" ? current.detail.value : null;
  const regions = useMemo(() => current.regions.state === "ready" ? current.regions.value : [], [current.regions]);
  // Inputs are final once the structure (if any) has answered, either way.
  const settled = activeKey !== null && (activeKey === NONE || !selected || (current.detail.state !== "loading" && current.detail.state !== "idle" && current.regions.state !== "loading" && current.regions.state !== "idle"));
  const inputs = useMemo<HsqcInputs | null>(() => sequence && settled ? hsqcInputs(sequence, detail, regions) : null, [sequence, settled, detail, regions]);

  // ── Prediction
  const [prediction, setPrediction] = useState<Load<HsqcPrediction>>({ state: "idle" });
  const [run, setRun] = useState(0);
  const requestKey = inputs ? JSON.stringify(inputs.request) : "";
  useEffect(() => {
    if (!inputs) return;
    let active = true;
    queueMicrotask(() => { if (active) setPrediction({ state: "loading" }); });
    proteinLabsApi.predictHsqc(inputs.request)
      .then((value) => { if (active) setPrediction({ state: "ready", value: readHsqcPrediction(value) }); })
      .catch((reason: unknown) => { if (active) setPrediction({ state: "error", message: engineMessage(reason) }); });
    return () => { active = false; };
    // The serialised request stands in for the inputs object, which is rebuilt on every structure answer.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [requestKey, run]);
  const result = prediction.state === "ready" ? prediction.value : null;
  const { peaks, noPeak } = useMemo(() => result ? hsqcPeaks(result) : { peaks: [], noPeak: [] }, [result]);
  const bounds = useMemo(() => viewBounds(peaks), [peaks]);

  // ── Selection, shared by the spectrum, the table and the 3D view.
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [view, setView] = useState<SpectrumView>(DEFAULT_VIEW);
  const [note, setNote] = useState("");
  const selectedPeak = peaks.find((peak) => peak.id === selectedId) ?? null;
  const mapping = detail?.mapping?.residues;
  const region = useMemo<ViewerRegion | null>(() => {
    if (!selectedPeak) return null;
    const residues = residuesAt(mapping, selectedPeak.position);
    return residues.length ? { id: `hsqc-${selectedPeak.position}`, residues, ligand: null } : null;
  }, [selectedPeak, mapping]);

  function selectPeak(peak: Peak | null, reveal = false) {
    setSelectedId(peak?.id ?? null);
    if (!peak) { setNote(""); return; }
    if (reveal) setView((value) => revealPoint(value, peak, bounds));
    setNote(!detail ? "" : residuesAt(mapping, peak.position).length ? "" : `${threeLetter(peak.residue)} ${peak.position} is not in the ${selected ? structureOptionLabel(selected) : "structure"} model (outside the modelled range or in an alignment gap), so nothing is highlighted in 3D.`);
  }
  const pickResidue = useCallback((address: ResidueAddress) => {
    const position = positionAt(mapping, address);
    if (position === null) { setSelectedId(null); setNote("That residue is not part of your construct's sequence, so it has no predicted peak."); return; }
    const peak = peaks.find((item) => item.id === `bb-${position}`);
    const row = result?.residues.find((item) => item.position === position);
    if (!peak) {
      setSelectedId(null);
      setNote(row && !row.hasHnPeak ? `${threeLetter(row.residue)} ${position} is a proline. Its backbone nitrogen carries no hydrogen, so it gives no HSQC peak.` : `No shift was predicted for residue ${position}, so it has no peak.`);
      return;
    }
    setSelectedId(peak.id); setNote("");
    setView((value) => revealPoint(value, peak, bounds));
  }, [mapping, peaks, result, bounds]);

  // ── Save
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const savedAt = typeof savedJob?.config.predictedAt === "string" ? savedJob.config.predictedAt : "";
  async function save() {
    if (!result) return;
    setBusy(true); setMessage("");
    try {
      const latest = await proteinLabsApi.getProtein(proteinId);
      await ensureProjectJob(proteinId, latest.projectJobs, HSQC_APP_TYPE, JOB_LABEL, hsqcConfig(result, peaks, selected ? { source: selected.source, id: selected.id } : null, new Date().toISOString()));
      await onChanged();
      setFailed(false); setMessage("Prediction saved to this project.");
    } catch (reason) { setFailed(true); setMessage(engineMessage(reason)); }
    finally { setBusy(false); }
  }

  if (!sequence) return <div className="hsqc-workspace"><Intro refs={refs} name={bundle.protein.name}/><div className="hsqc-empty"><CircleAlert/><strong>No sequence saved yet</strong><small>The prediction starts from your construct&apos;s amino-acid sequence. Save it in the Protein sequence job first.</small><Button variant="outline" onClick={() => onOpenJob("sequence")}>Open Protein sequence <ArrowRight/></Button></div></div>;

  return <div className="hsqc-workspace">
    <header>
      <div><span className="eyebrow">NMR SPECTROSCOPY</span><h2>What will {bundle.protein.name}&apos;s HSQC look like?</h2><p>This job predicts where each backbone N–H of your protein should appear in a ¹H–¹⁵N HSQC spectrum, draws the spectrum the way NMR software such as Sparky does,<Cite scope={refs} id="nmrfam-sparky"/> and links every peak to its residue in the 3D structure.</p></div>
      <Button variant="outline" onClick={() => setRun((value) => value + 1)} disabled={!inputs || prediction.state === "loading"}>{prediction.state === "loading" ? <LoaderCircle className="spin"/> : <RefreshCw/>} Predict again</Button>
    </header>

    <Intro refs={refs} name={bundle.protein.name}/>

    <Inputs facts={facts} refs={refs} structures={structures} list={list} activeKey={activeKey} onChoose={(key) => { setChoice(key); setSelectedId(null); setNote(""); }} current={current} inputs={inputs} onOpenJob={onOpenJob}/>

    <PredictorPanel prediction={prediction} refs={refs} onRetry={() => setRun((value) => value + 1)}/>

    <section className="hsqc-stage" aria-label="Predicted spectrum and structure">
      <div className="hsqc-spectrum-panel">
        <header><h3>Predicted ¹H–¹⁵N HSQC</h3><small>{result ? `${peaks.filter((peak) => peak.kind === "backbone").length} backbone peaks${peaks.some((peak) => peak.kind === "sidechain") ? ` · ${peaks.filter((peak) => peak.kind === "sidechain").length} side-chain` : ""} · ${noPeak.filter((item) => item.reason === "proline").length} prolines without a peak` : prediction.state === "loading" ? "Predicting…" : ""}</small></header>
        {result ? <HsqcSpectrum peaks={peaks} selectedId={selectedId} onSelect={(peak) => selectPeak(peak)} view={view} onView={setView} bounds={bounds} rmse={result.predictor.rmse} predictorLabel={result.predictor.label}/>
          : <div className={`hsqc-placeholder ${prediction.state === "error" ? "error" : ""}`} role={prediction.state === "error" ? "alert" : "status"}>{prediction.state === "error" ? <><CircleAlert/><strong>No spectrum</strong><small>{prediction.message}</small></> : <><LoaderCircle className="spin"/><strong>{inputs ? "Predicting chemical shifts…" : "Gathering what the project knows…"}</strong><small>{inputs ? "The built-in fallback answers at once; an installed structure-based predictor can take a few minutes." : "Reading the saved structure and its regions."}</small></>}</div>}
        <SelectionDetails peak={selectedPeak} result={result} note={note} refs={refs}/>
      </div>
      <div className="hsqc-structure-panel">
        <header><h3>Structure</h3><small>{selected ? structureOptionLabel(selected) : "No structure"} · click a residue to find its peak</small></header>
        <div className="molecule-stage hsqc-molecule">
          {detail?.structureText ? <StructureViewer geometry={{ structureText: detail.structureText, format: detail.format ?? "cif", source: selected?.source ?? null }} paletteKey={proteinId} label={selected?.id ?? "Structure"} confidence={selected?.source === "alphafold_db"} region={region} controlsHost={null} onResiduePick={pickResidue}/>
            : <div className="structure-empty" role={current.detail.state === "error" ? "alert" : "status"}>{current.detail.state === "loading" ? <><LoaderCircle className="spin"/><strong>Downloading the structure…</strong><small>Structures come from AlphaFold DB or the PDB and can take a moment.</small></> : current.detail.state === "error" ? <><CircleAlert/><strong>The structure could not be loaded</strong><small>{current.detail.message} The spectrum still works; peaks just cannot be shown in 3D.</small></> : <><Info/><strong>No structure to link to</strong><small>Fetch the AlphaFold model or pick a PDB entry in the Structure Viewer job to click between peaks and residues.</small><Button variant="outline" onClick={() => onOpenJob("structure")}>Open Structure Viewer <ArrowRight/></Button></>}</div>}
        </div>
      </div>
    </section>

    {result && <PeakTable peaks={peaks} noPeak={noPeak} selectedId={selectedId} onSelect={(peak) => selectPeak(peak, true)}/>}

    <ReferenceList scope={refs} className="hsqc-references"/>

    <footer>
      <span role="status" className={failed ? "error" : ""}>{failed && <CircleAlert/>}{message || (savedAt ? `Last saved ${new Date(savedAt).toLocaleString()}.` : "Not saved to the project yet.")}</span>
      <Button disabled={busy || !result} onClick={() => void save()}>{busy ? <LoaderCircle className="spin"/> : <Check/>} Save prediction</Button>
    </footer>
  </div>;
}

// ── Plain-language introduction ─────────────────────────────────────────────

function Intro({ refs, name }: { refs: CitationScope; name: string }) {
  return <section className="hsqc-intro" aria-labelledby="hsqc-intro-heading">
    <h3 id="hsqc-intro-heading">What an HSQC spectrum is</h3>
    <div>
      <div><h4>One peak for every N–H</h4><p>In NMR, atomic nuclei in a strong magnet absorb radio waves at a frequency set by their chemical surroundings. That frequency, quoted in parts per million (ppm) from a reference, is the <em>chemical shift</em>. An HSQC transfers signal from each hydrogen to the nitrogen it is bonded to and back, so every N–H pair gives one spot: its ¹H shift along one axis and its ¹⁵N shift along the other.<CiteGroup scope={refs} ids={["bodenhausen1980", "kay1992"]}/></p></div>
      <div><h4>Why it is a fingerprint</h4><p>Every amino acid except proline has a hydrogen on its backbone nitrogen, so {name} should give about one peak per residue. Prolines have no backbone N–H and give none. Asparagine, glutamine and tryptophan side chains add a few extra peaks. Because each peak&apos;s position depends on its residue&apos;s 3D surroundings, the HSQC is the standard first check that a protein is folded: folded proteins spread their peaks out, unfolded ones crowd them into a narrow band near 8–8.5 ppm.<Cite scope={refs} id="cavanagh2007"/></p></div>
      <div><h4>How to read it</h4><ul>
        <li>By NMR convention both axes run backwards: ¹H shift falls from left to right and ¹⁵N shift rises from top to bottom.</li>
        <li>Each peak is drawn as contour rings, like hills on a map. Sharp, tall peaks have many rings.</li>
        <li>Larger proteins tumble more slowly, which broadens their peaks; above about 30 kDa special methods such as TROSY and deuteration are usually needed.<Cite scope={refs} id="pervushin1997"/></li>
        <li>A prediction is a guide for assigning a real spectrum, not a replacement for one.</li>
      </ul></div>
    </div>
  </section>;
}

// ── Inputs from earlier jobs ────────────────────────────────────────────────

function Inputs({ facts, refs, structures, list, activeKey, onChoose, current, inputs, onOpenJob }: { facts: ProteinFacts; refs: CitationScope; structures: StructureEntry[]; list: Load<StructureEntry[]>; activeKey: string | null; onChoose: (key: string) => void; current: StructureLoad; inputs: HsqcInputs | null; onOpenJob: (jobId: string) => void }) {
  const sequence = facts.sequence.status === "known" ? facts.sequence.value : null;
  const model = facts.alphaFoldModels.status === "known" ? facts.alphaFoldModels.value[0] : null;
  const cofactors = facts.cofactors.status === "known" ? facts.cofactors.value.cofactors.map((item) => item.name) : [];
  const regionsNote = current.regions.state === "error" ? "The structure's regions could not be read, so no position is flagged." : current.regions.state === "loading" ? "Reading the structure's regions…" : "";
  return <section className="hsqc-section" aria-labelledby="hsqc-inputs-heading">
    <header><h3 id="hsqc-inputs-heading">What the prediction starts from</h3><small>Read from earlier jobs; nothing here needs typing in again.</small></header>
    <dl className="hsqc-inputs">
      <div><dt>Sequence</dt><dd>{sequence ? `${sequence.length} residues` : "Not saved"}<small>From Protein sequence. Every residue except proline gets a peak.</small></dd></div>
      <div><dt>Structure</dt><dd>
        <select aria-label="Structure for the prediction and the 3D view" value={activeKey ?? ""} disabled={list.state === "loading"} onChange={(event) => onChoose(event.target.value)}>
          {list.state === "loading" && <option value="">Listing structures…</option>}
          {structures.map((entry) => <option key={entryKey(entry)} value={entryKey(entry)}>{structureOptionLabel(entry)}</option>)}
          <option value={NONE}>No structure (sequence only)</option>
        </select>
        <small>{list.state === "error" ? `Structures could not be listed: ${list.message}` : inputs?.structure.sent ? "Its coordinates go to the predictor." : inputs?.structure.sent === false && inputs.structure.reason === "numbering" ? "Its residue numbers differ from your construct's, so the predictor gets the sequence only; it is still used for the 3D view." : model ? <>AlphaFold model, mean pLDDT {model.meanPlddt?.toFixed(0) ?? "—"}.<Cite scope={refs} id="alphafold2021"/></> : "From the Structure Viewer job."}</small>
      </dd></div>
      <div><dt>Disordered residues</dt><dd>{inputs ? `${inputs.disordered.length} flagged` : "—"}<small>{regionsNote || (inputs?.disordered.length ? "From UniProt disorder notes and low-pLDDT stretches of the model. They get random-coil shifts." : facts.disorder.status === "known" && facts.disorder.value.verdict === "yes" ? "Your readiness check notes disorder, but the structure's regions place none on this model." : "None mapped onto this structure.")}{facts.disorder.status === "known" && <Cite scope={refs} id="uniprot2023"/>}</small>{facts.disorder.status === "missing" && <OpenJob label={facts.disorder.producedBy.label} onClick={() => onOpenJob(facts.disorder.status === "missing" ? facts.disorder.producedBy.jobId : "readiness")}/>}</dd></div>
      <div><dt>Near a ligand</dt><dd>{inputs ? `${inputs.ligandAdjacent.length} residues` : "—"}<small>{regionsNote || (inputs?.ligandAdjacent.length ? "Binding-site residues are flagged: a bound ligand can move their peaks in ways the predictor does not model." : cofactors.length ? `Known cofactors: ${cofactors.join(", ")}. This structure shows no binding site for them.` : "No ligand binding site on this structure.")}</small>{facts.cofactors.status === "missing" && <OpenJob label={facts.cofactors.producedBy.label} onClick={() => onOpenJob(facts.cofactors.status === "missing" ? facts.cofactors.producedBy.jobId : "readiness")}/>}</dd></div>
    </dl>
  </section>;
}

function OpenJob({ label, onClick }: { label: string; onClick: () => void }) {
  return <Button size="sm" variant="outline" className="hsqc-open-job" onClick={onClick}>Open {label} <ArrowRight/></Button>;
}

// ── Predictor and its error ─────────────────────────────────────────────────

function PredictorPanel({ prediction, refs, onRetry }: { prediction: Load<HsqcPrediction>; refs: CitationScope; onRetry: () => void }) {
  if (prediction.state === "error") return <section className="hsqc-predictor error" role="alert"><CircleAlert/><div><strong>The prediction did not run</strong><p>{prediction.message}</p><Button size="sm" variant="outline" onClick={onRetry}><RefreshCw/> Try again</Button></div></section>;
  if (prediction.state !== "ready") return <section className="hsqc-predictor loading" aria-busy="true"><LoaderCircle className="spin"/><div><strong>Choosing a predictor…</strong><p>The engine tries UCBShift 2.0, LEGOLAS and SHIFTX2 in turn and falls back to random-coil shifts when none is installed.<CiteGroup scope={refs} ids={["ucbshift2", "legolas2025", "shiftx2", "wishart1995"]}/></p></div></section>;
  const { predictor, status, warnings, method } = prediction.value;
  const structural = status === "structure_aware";
  const citation = PREDICTOR_CITATIONS[predictor.id];
  return <section className={`hsqc-predictor ${structural ? "ran" : "fallback"}`} aria-labelledby="hsqc-predictor-heading">
    <div className="hsqc-predictor-head">
      <span className="eyebrow">PREDICTOR USED</span>
      <h3 id="hsqc-predictor-heading">{predictor.label}{citation && <Cite scope={refs} id={citation}/>}</h3>
      <StatusChip tone={structural ? "pass" : "attention"} label={structural ? "Structure-based" : "Sequence only"}/>
    </div>
    <p>{PREDICTOR_ROLES[predictor.id] ?? ""}</p>
    <dl className="hsqc-error">
      <div><dt>Expected error, ¹H</dt><dd>{predictor.rmse.h === null ? "not published" : `± ${predictor.rmse.h.toFixed(2)} ppm`}</dd></div>
      <div><dt>Expected error, ¹⁵N</dt><dd>{predictor.rmse.n === null ? "not published" : `± ${predictor.rmse.n.toFixed(2)} ppm`}</dd></div>
    </dl>
    <p className="hsqc-error-note">{predictor.rmse.h !== null && predictor.rmse.n !== null ? "These are the root-mean-square errors (RMSE) the authors measured against assigned spectra. The inner ellipse around the selected peak spans one RMSE each way and the outer one two. If the errors are roughly normal, about 4 in 10 real peaks fall inside the inner ellipse and about 85 in 100 inside the outer one." : structural ? "The authors report no ¹H/¹⁵N error that can be compared, so no error ellipse is drawn." : "Random-coil values describe unfolded chains. In a folded protein the real peaks spread far from them, so the spots here are a starting guide, not a prediction of the folded spectrum, and no error ellipse is drawn."}</p>
    {!structural && <div className="hsqc-fallback-note"><CircleAlert/><span><strong>No structure-based predictor is installed.</strong> Every folded residue sits at the average shift of its amino-acid type, so most peaks pile up near 8.2 ppm ¹H and 120 ppm ¹⁵N. A real spectrum of a folded protein is much more spread out.<Cite scope={refs} id="wishart1995"/></span></div>}
    {warnings.length > 0 && <details className="hsqc-warnings"><summary>Engine notes ({warnings.length})</summary><ul>{warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details>}
    {(method.disorderTreatment || method.ligandContactTreatment) && <p className="method">{[method.disorderTreatment, method.ligandContactTreatment, method.determinismScope].filter(Boolean).join(" ")}</p>}
  </section>;
}

// ── Selected peak ───────────────────────────────────────────────────────────

function SelectionDetails({ peak, result, note, refs }: { peak: Peak | null; result: HsqcPrediction | null; note: string; refs: CitationScope }) {
  if (!result) return null;
  if (!peak) return <p className="hsqc-selection empty" role="status">{note || "Click a peak, a row in the peak list, or a residue in the 3D view to link them."}</p>;
  const rmse = result.predictor.rmse;
  const width = peak.disordered ? LINEWIDTH_HZ.disordered : LINEWIDTH_HZ.folded;
  return <div className="hsqc-selection" role="status">
    <strong>{peak.label}<small>{peak.description}</small></strong>
    <span>¹H <b>{peak.h.toFixed(2)}</b> ppm{rmse.h !== null && <> ± {rmse.h.toFixed(2)}</>} · ¹⁵N <b>{peak.n.toFixed(1)}</b> ppm{rmse.n !== null && <> ± {rmse.n.toFixed(1)}</>}</span>
    <span className="hsqc-flags">{peak.disordered && <StatusChip tone="review" label="Disordered"/>}{peak.ligandAdjacent && <StatusChip tone="attention" label="Near a ligand"/>}{peak.crowded && <StatusChip tone="review" label="Crowded region"/>}</span>
    <small>Drawn with {width.h} Hz ¹H and {width.n} Hz ¹⁵N linewidths at {SPECTROMETER_MHZ.h} MHz{peak.disordered ? " (sharper, because flexible residues tumble on their own)" : ""}.<Cite scope={refs} id="cavanagh2007"/>{note && <> {note}</>}</small>
  </div>;
}

// ── Peak list ───────────────────────────────────────────────────────────────

function PeakTable({ peaks, noPeak, selectedId, onSelect }: { peaks: Peak[]; noPeak: { position: number; residue: string; reason: string }[]; selectedId: string | null; onSelect: (peak: Peak) => void }) {
  const prolines = noPeak.filter((item) => item.reason === "proline");
  const missing = noPeak.filter((item) => item.reason !== "proline");
  useEffect(() => { if (selectedId) document.getElementById(`hsqc-row-${selectedId}`)?.scrollIntoView({ block: "nearest" }); }, [selectedId]);
  return <section className="hsqc-section" aria-labelledby="hsqc-peaks-heading">
    <header><h3 id="hsqc-peaks-heading">Peak list</h3><small>Every predicted peak; choose a row to find it in the spectrum and the structure.{prolines.length ? ` Prolines without a peak: ${prolines.map((item) => `P${item.position}`).join(", ")}.` : ""}{missing.length ? ` No shift predicted for ${missing.map((item) => `${item.residue}${item.position}`).join(", ")}.` : ""}</small></header>
    <div className="hsqc-table-wrap">
      <table className="hsqc-peaks">
        <thead><tr><th scope="col">Peak</th><th scope="col">Residue</th><th scope="col" className="num">¹H (ppm)</th><th scope="col" className="num">¹⁵N (ppm)</th><th scope="col">Notes</th></tr></thead>
        <tbody>{peaks.map((peak) => <tr key={peak.id} id={`hsqc-row-${peak.id}`} className={peak.id === selectedId ? "selected" : ""} aria-selected={peak.id === selectedId}>
          <th scope="row"><button type="button" onClick={() => onSelect(peak)} aria-pressed={peak.id === selectedId}>{peak.label}</button></th>
          <td>{peak.description}</td>
          <td className="num">{peak.h.toFixed(2)}</td>
          <td className="num">{peak.n.toFixed(1)}</td>
          <td>{[peak.disordered && "disordered", peak.ligandAdjacent && "near a ligand", peak.crowded && "crowded region"].filter(Boolean).join(", ") || "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function savedStructureKey(config: JsonObject | undefined): string | null {
  const structure = config?.structure;
  if (!structure || typeof structure !== "object" || Array.isArray(structure)) return null;
  const { source, id } = structure as JsonObject;
  return typeof source === "string" && typeof id === "string" ? `${source}:${id}` : null;
}

function engineMessage(reason: unknown) {
  const text = reason instanceof Error ? reason.message : String(reason);
  // Engines older than the NMR API answer with a generic 404.
  return /endpoint not found/i.test(text) ? "This version of the local engine cannot predict HSQC spectra yet. Update Protein Labs, then try again." : text;
}
