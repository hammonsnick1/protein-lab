"use client";

import { PointerEvent, useEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownNarrowWide, Atom, BadgeCheck, BookOpen, Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Columns3, Disc3, Dna, Download, Filter, FlaskConical, LayoutGrid, ListTree, LoaderCircle, Magnet, Microscope, Play, Scale, Search, ShieldCheck, Sparkles, SquareDashedMousePointer, Upload, Workflow, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ensureProjectJob, JsonObject, ProteinBundle, proteinLabsApi } from "@/lib/protein-labs-api";
import { assemblyValue, minimumHigherOrder, OligomericKind, oligomericEvidence, oligomericKinds, oligomericLabel, OligomericState, oligomericStateConfig, oligomericStateProblem, readOligomericState, subunitCount, unknownState } from "@/lib/oligomeric-state";
import { ExpressionVectorJob } from "@/components/protein-labs/expression-vector-job";
import { PurificationPlannerJob } from "@/components/protein-labs/purification-planner-job";
import { PurificationStageJob } from "@/components/protein-labs/purification-stage-job";
import { GelAnalysisJob } from "@/components/protein-labs/gel-analysis-job";
import { ChromatogramStudioJob } from "@/components/protein-labs/chromatogram-studio-job";
import { ProteinReadinessJob } from "@/components/protein-labs/protein-readiness-job";
import { SequenceResearchJob } from "@/components/protein-labs/sequence-research-job";
import { ReferenceMatchJob } from "@/components/protein-labs/reference-match-job";
import { StructureJob } from "@/components/protein-labs/structure-viewer-job";
import { TransformationExpressionJob } from "@/components/protein-labs/transformation-expression-job";
import { isComplete, workflowJobs } from "@/lib/workflow";

const labels: Record<string, [string, string, typeof Dna]> = {
  sequence: ["Protein sequence", "Create or revise the construct that anchors this branch.", Dna],
  properties: ["Protein properties", "Calculate physicochemical properties with the local ProtParam engine.", Scale],
  research: ["Sequence research", "Run one-click UniProt, NCBI BLAST, and PDB searches.", Search],
  "reference-match": ["Choose reference match", "Select one traceable homolog for cofactor, PTM, localization, and topology evidence.", BadgeCheck],
  structure: ["Structure Viewer", "View the AlphaFold model or an experimental PDB entry and highlight regions of interest.", Atom],
  readiness: ["Protein readiness", "Resolve risks before designing expression and purification.", ShieldCheck],
  "expression-system": ["Expression system", "Compare hosts and strains, then choose the cell line for this project.", Microscope],
  "expression-vector": ["Expression vector design", "Build and annotate a complete expression plasmid.", Disc3],
  "purification-lysis": ["Cell lysis", "Choose a host-compatible lysis method and buffer, then review compatibility.", Zap],
  "purification-affinity": ["Affinity capture", "Choose the affinity tag, linker and resin, and set the binding, wash and elution buffers.", Magnet],
  "purification-subtractive": ["Subtractive cleanup", "Choose the cleavage protease, then remove the tag, uncleaved fusion and protease by reverse affinity.", Filter],
  "purification-sec": ["SEC polishing", "Choose a size-exclusion column and the final storage buffer.", ArrowDownNarrowWide],
  "purification-workflow": ["Purification workflow", "Cross-check the design and generate a bench-ready workflow.", Workflow],
  "transformation-expression": ["Transformation and Expression", "Record starting material, host-specific medium, culture conditions, and expression notes.", FlaskConical],
  chromatogram: ["Chromatogram Studio", "Import traces, select peaks, calculate areas, and save results.", Activity],
  gel: ["Gel densitometry", "Detect lanes and bands, estimate molecular weight, and quantify purity.", Columns3],
};

type JobProps = { bundle: ProteinBundle; onChanged: () => Promise<void> };

export function JobWorkspace({ jobId, bundle, returnTo, onBack, onOpenJob, onReports, onRoadmap, onChanged }: { jobId: string; bundle: ProteinBundle; returnTo: "planning" | "roadmap"; onBack: () => void; onOpenJob: (jobId: string) => void; onReports: () => void; onRoadmap: () => void; onChanged: () => Promise<void> }) {
  const [title, description, Icon] = labels[jobId] ?? labels.sequence;
  const [online, setOnline] = useState<boolean | null>(null);
  const [savedInSession, setSavedInSession] = useState(false);
  const [workflowLayout, setWorkflowLayout] = useState<"tree" | "cards">("tree");
  useEffect(() => { proteinLabsApi.health().then(() => setOnline(true)).catch(() => setOnline(false)); }, []);
  useEffect(() => {
    const savedLayout = localStorage.getItem("protein-labs-workflow-layout");
    if (savedLayout === "cards") queueMicrotask(() => setWorkflowLayout("cards"));
  }, []);
  async function handleChanged() {
    await onChanged();
    setSavedInSession(true);
  }
  const planningJobs = workflowJobs.filter((definition) => definition.stage === "understand" || definition.stage === "plan");
  const recommended = planningJobs.find((definition) => !isComplete(bundle, definition)) ?? planningJobs.at(-1)!;
  const planningComplete = planningJobs.every((definition) => isComplete(bundle, definition));
  const returnToRoadmap = returnTo === "roadmap" || planningComplete;
  function continueWorkflow() {
    setSavedInSession(false);
    if (returnToRoadmap) onRoadmap();
    else onOpenJob(recommended.id);
  }
  const changed = handleChanged;
  return <main className="job-workspace">
    <button className="job-return-tab" onClick={onBack} aria-label={returnTo === "roadmap" ? "Return to purification roadmap" : "Return to project planning"}>
      <ChevronLeft/>{returnTo === "roadmap" ? <FlaskConical/> : workflowLayout === "cards" ? <LayoutGrid/> : <ListTree/>}<span><strong>{returnTo === "roadmap" ? "Purification roadmap" : "Project planning"}</strong><small>{returnTo === "roadmap" ? "Back to roadmap" : `Back to ${workflowLayout === "cards" ? "Planning" : "tree"}`}</small></span>
    </button>
    <header className="job-header"><div className="job-title-row"><span className="job-hero-icon"><Icon /></span><div><span className="eyebrow">{bundle.protein.name} · CURRENT JOB</span><h1>{title}</h1><p>{description}</p></div></div><div className="job-header-actions"><span className={`engine-state ${online ? "online" : online === false ? "offline" : "checking"}`}><span />{online ? "Local engine connected" : online === false ? "Local engine unavailable" : "Checking engine"}</span><Button variant="outline" onClick={onRoadmap}><FlaskConical/> Roadmap</Button><Button variant="outline" onClick={onReports}><BookOpen /> Report</Button></div></header>
    <section className="job-surface">{jobId === "sequence" && <SequenceJob bundle={bundle} onChanged={changed} />}{jobId === "properties" && <PropertiesJob bundle={bundle} onChanged={changed} />}{jobId === "research" && <SequenceResearchJob bundle={bundle} onChanged={changed} />}{jobId === "reference-match" && <ReferenceMatchJob bundle={bundle} onChanged={changed} />}{jobId === "structure" && <StructureJob bundle={bundle} onChanged={changed} />}{jobId === "readiness" && <ProteinReadinessJob bundle={bundle} onChanged={changed} onReports={onReports} />}{jobId === "expression-system" && <ExpressionJob bundle={bundle} onChanged={changed} />}{jobId === "expression-vector" && <ExpressionVectorJob bundle={bundle} onChanged={changed} />}{(["purification-lysis","purification-subtractive","purification-sec"] as string[]).includes(jobId) && <PurificationStageJob bundle={bundle} onChanged={changed} mode={jobId as "purification-lysis"|"purification-subtractive"|"purification-sec"} />}{(["purification-affinity","purification-workflow"] as string[]).includes(jobId) && <PurificationPlannerJob bundle={bundle} onChanged={changed} section={jobId} />}{jobId === "transformation-expression" && <TransformationExpressionJob bundle={bundle} onChanged={changed} />}{jobId === "chromatogram" && <ChromatogramStudioJob bundle={bundle} onChanged={changed} />}{jobId === "gel" && <GelAnalysisJob bundle={bundle} onChanged={changed} />}</section>
    {savedInSession && <button className="job-next-tab" onClick={continueWorkflow}>
      <span className="job-next-status"><Check/> Saved</span>
      <span className="job-next-copy"><small>{returnToRoadmap ? "CONTINUE THE PURIFICATION" : "RECOMMENDED NEXT PLANNING JOB"}</small><strong>{returnToRoadmap ? "Return to purification roadmap" : recommended.label}</strong><em>{returnToRoadmap ? "The saved result and planning choices are reflected in the roadmap." : recommended.description}</em></span>
      {returnToRoadmap ? <FlaskConical/> : <><Sparkles className="job-next-sparkle"/><ChevronRight className="job-next-arrow"/></>}
    </button>}
  </main>;
}

function Panel({ title, hint, children, className = "" }: { title: string; hint?: string; children: React.ReactNode; className?: string }) { return <section className={`lab-panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></div>{children}</section>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="lab-field"><span>{label}</span>{children}</label>; }
function Notice({ message, error = false }: { message: string; error?: boolean }) { return message ? <div className={`inline-message ${error ? "error" : ""}`}>{error ? <CircleAlert /> : <CircleCheck />} {message}</div> : null; }
function asObject(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function asArray(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }
function text(value: unknown, fallback: unknown = "—") { return String(value === null || value === undefined || value === "" ? fallback : value); }
/** Residue counts and their share of the sequence, split into two aligned
 *  halves with a total row that shows the shares add up to the whole. */
function CompositionTable({ residues }: { residues: [string, unknown][] }) {
  const rows = residues.map(([aa, raw]) => {
    const row = asObject(raw);
    return { aa, name: text(row.name, aa), count: Number(row.count ?? 0), percent: Number(row.percent ?? 0) };
  });
  if (!rows.length) return <p className="composition-empty">Run the calculation to see the residue composition.</p>;
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const totalPercent = rows.reduce((sum, row) => sum + row.percent, 0);
  const largest = Math.max(...rows.map((row) => row.percent));
  const half = Math.ceil(rows.length / 2);
  return <div className="composition">
    <div className="composition-halves">
      {[rows.slice(0, half), rows.slice(half)].map((group, index) => <table className="composition-table" key={index}>
        <thead><tr><th scope="col">Residue</th><th scope="col" className="num">Count</th><th scope="col" className="num">% of protein</th><th scope="col" aria-label="Relative abundance"/></tr></thead>
        <tbody>{group.map((row) => <tr key={row.aa}>
          <th scope="row"><strong>{row.aa}</strong><span>{row.name}</span></th>
          <td className="num">{row.count}</td>
          <td className="num">{row.percent.toFixed(2)}%</td>
          <td className="composition-bar-cell"><span className="composition-bar"><i style={{ width: `${largest ? (row.percent / largest) * 100 : 0}%` }}/></span></td>
        </tr>)}</tbody>
      </table>)}
    </div>
    <p className="composition-total"><span>Total</span><strong>{totalCount} residues</strong><strong>{totalPercent.toFixed(2)}%</strong></p>
  </div>;
}

function metric(value: unknown, decimals = 2) { return typeof value === "number" ? value.toFixed(decimals) : "—"; }

function SequenceJob({ bundle, onChanged }: JobProps) {
  const protein = bundle.protein;
  const [name, setName] = useState(protein.name);
  const [sequence, setSequence] = useState(protein.sequence);
  const [organism, setOrganism] = useState(protein.organism ?? "");
  const [geneName, setGeneName] = useState(protein.geneName ?? "");
  const [description, setDescription] = useState(protein.description ?? "");
  const [notes, setNotes] = useState(protein.notes ?? "");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [failed, setFailed] = useState(false);
  async function save() {
    const normalized = sequence.replace(/\s+/g, "").toUpperCase();
    if (!normalized) { setFailed(true); setMessage("Enter an amino-acid sequence first."); return; }
    setBusy(true); setMessage("");
    try {
      await proteinLabsApi.updateProtein(protein.id, { name: name.trim() || "Untitled protein", sequence: normalized, organism, geneName, description, notes });
      const refreshed = await proteinLabsApi.getProtein(protein.id);
      await ensureProjectJob(protein.id, refreshed.projectJobs, "protein-planner", "Protein sequence", { sequenceLength: normalized.length, savedByUser: true });
      await onChanged(); setFailed(false); setMessage("Sequence saved and protein properties recalculated locally.");
    } catch (reason) { setFailed(true); setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <div className="two-column"><Panel title="Primary sequence" hint="Spaces and line breaks are ignored."><Field label="Construct name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Amino acid sequence"><textarea className="sequence-editor" value={sequence} onChange={(event) => setSequence(event.target.value.toUpperCase().replace(/[^A-Z\n\r ]/g, ""))} /></Field><div className="sequence-footer"><span>{sequence.replace(/\s/g, "").length} amino acids</span><Button disabled={busy} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" /> : <Check />} Save sequence</Button></div><Notice message={message} error={failed} /></Panel><Panel title="Construct metadata" hint="Saved with the protein and used by later jobs."><Field label="Organism"><input value={organism} onChange={(event) => setOrganism(event.target.value)} placeholder="e.g. Pseudomonas aeruginosa" /></Field><Field label="Gene"><input value={geneName} onChange={(event) => setGeneName(event.target.value)} placeholder="e.g. PA0012" /></Field><Field label="Description"><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Field label="Notes"><textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field></Panel></div>;
}

function PropertiesJob({ bundle, onChanged }: JobProps) {
  const [result, setResult] = useState<JsonObject>(bundle.protparam?.result ?? {});
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState("");
  async function calculate() {
    setBusy(true); setMessage("");
    try {
      const response = await proteinLabsApi.analyze(bundle.protein.id); setResult(response.result);
      const latest = await proteinLabsApi.getProtein(bundle.protein.id);
      // Keep what the scientist recorded in this job, such as the oligomeric state.
      const saved = latest.projectJobs.find((job) => job.appType === "protparam")?.config ?? {};
      await ensureProjectJob(bundle.protein.id, latest.projectJobs, "protparam", "Protein properties", { ...saved, reviewStatus: "calculated", analyzedAt: new Date().toISOString() });
      await onChanged(); setMessage("ProtParam properties recalculated and saved.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  const extinction = asObject(result.extinctionCoefficient280);
  const metrics: [string,string][] = [["Molecular weight", `${metric(result.molecularWeightDa, 1)} Da`], ["Monoisotopic mass", `${metric(result.monoisotopicMassDa, 1)} Da`], ["Theoretical pI", metric(result.theoreticalPI, 2)], ["Instability index", `${metric(result.instabilityIndex, 2)} · ${text(result.stabilityPrediction)}`], ["Aliphatic index", metric(result.aliphaticIndex, 2)], ["GRAVY", metric(result.gravy, 3)], ["Aromaticity", metric(result.aromaticity, 3)], ["Chemical formula", text(result.chemicalFormula)], ["Total atoms", text(result.totalAtoms)]];
  const composition = asObject(result.aminoAcidComposition);
  const residues = Object.entries(composition).sort((a, b) => a[0].localeCompare(b[0]));
  const charged = asObject(result.chargedResidues);
  const sequenceSummary = asObject(result.sequence);
  const halfLife=asObject(result.estimatedHalfLife),secondary=asObject(result.secondaryStructureFraction),atomic=asObject(result.atomicComposition);
  const sequenceLength = Number(sequenceSummary.length ?? bundle.protein.sequence.length);
  const terminus = (letter: unknown, position: number) => letter ? `${text(asObject(composition[String(letter)]).name, String(letter))}${position}` : "—";
  const secondaryRows:[string,number,string][]=[["Helix",Number(secondary.helix??0),"#52c7b8"],["Turn",Number(secondary.turn??0),"#e5ab55"],["Sheet",Number(secondary.sheet??0),"#8d83e8"]];
  return <div className="properties-layout"><Panel title="Complete ProtParam profile" hint={`ExPASy-compatible definitions calculated locally for the current ${bundle.protein.sequence.length} aa construct.`} className="span-two"><div className="metric-grid">{metrics.map(([label, value]) => <div className="metric-card" key={label}><span>{label}</span><strong>{value}</strong></div>)}</div><div className="panel-actions"><small>{text(asObject(result.algorithm).compatibility,"Biopython ProtParam definitions")}</small><Button onClick={() => void calculate()} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Play />} Recalculate and save</Button></div><Notice message={message} error={message.toLowerCase().includes("error")} /></Panel><Panel title="Extinction coefficient at 280 nm" hint="Reported for reduced cysteines and maximally oxidized cystines."><div className="property-detail-grid"><span>Reduced molar</span><strong>{metric(extinction.reducedMolarM1Cm1,0)} M⁻¹ cm⁻¹</strong><span>Oxidized molar</span><strong>{metric(extinction.oxidizedMolarM1Cm1,0)} M⁻¹ cm⁻¹</strong><span>Reduced A(0.1%)</span><strong>{metric(extinction.reducedAbsorbance01Percent,3)}</strong><span>Oxidized A(0.1%)</span><strong>{metric(extinction.oxidizedAbsorbance01Percent,3)}</strong></div></Panel><Panel title="Estimated half-life" hint={text(halfLife.warning,"")}><div className="property-detail-grid"><span>N-terminal residue</span><strong>{text(halfLife.nTerminalResidue)}</strong><span>Mammalian reticulocytes</span><strong>{text(halfLife.mammalianReticulocytesInVitro)}</strong><span>Yeast in vivo</span><strong>{text(halfLife.yeastInVivo)}</strong><span>E. coli in vivo</span><strong>{text(halfLife.ecoliInVivo)}</strong></div></Panel><Panel title="Secondary-structure propensity"><div className="secondary-bars">{secondaryRows.map(([label,value,color])=><div key={label}><span><b>{label}</b><small>{metric(value*100,1)}%</small></span><i><em style={{width:`${value*100}%`,background:color}}/></i></div>)}</div></Panel><Panel title="Sequence and charge summary" hint="Residues are numbered from the N-terminus to the C-terminus."><div className="terminus-strip" role="img" aria-label={`${sequenceLength} residues, from the N-terminus at ${terminus(sequenceSummary.nTerminus, 1)} to the C-terminus at ${terminus(sequenceSummary.cTerminus, sequenceLength)}`}><span><b>N-terminus</b><small>{terminus(sequenceSummary.nTerminus, 1)}</small></span><i><em>{sequenceLength} residues</em></i><span><b>C-terminus</b><small>{terminus(sequenceSummary.cTerminus, sequenceLength)}</small></span></div><div className="check-list"><span><CircleCheck/> Net charge at pH 7: {metric(charged.predictedChargeAtPH7,2)}</span><span><CircleCheck/> Acidic D + E: {text(charged.negativeAspGlu)} residues</span><span><CircleCheck/> Basic R + K: {text(charged.positiveArgLys)} residues</span><span><CircleCheck/> Atomic composition: {Object.entries(atomic).map(([element,count])=>`${element}${count}`).join(" ")}</span></div></Panel><OligomericStatePanel bundle={bundle} result={result} onChanged={onChanged}/><Panel title="Amino-acid composition" hint="Share of each residue in the full sequence; the bar is scaled to the most abundant residue." className="span-two"><CompositionTable residues={residues}/></Panel><Panel title="Calculation assumptions" className="span-two"><div className="assumption-list">{(Array.isArray(result.assumptions)?result.assumptions:[]).map((value,index)=><span key={index}><CircleAlert/>{String(value)}</span>)}</div></Panel></div>;
}

/** The assembly the protein forms, recorded by the scientist and saved with the properties job. */
function OligomericStatePanel({ bundle, result, onChanged }: JobProps & { result: JsonObject }) {
  const saved = readOligomericState(bundle.projectJobs.find((job) => job.appType === "protparam")?.config);
  const [draft, setDraft] = useState<OligomericState>(saved ?? unknownState);
  const [subunitText, setSubunitText] = useState(saved?.subunits ? String(saved.subunits) : "");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [failed, setFailed] = useState(false);
  const extinction = asObject(result.extinctionCoefficient280);
  const count = subunitCount(draft);
  const update = (patch: Partial<OligomericState>) => { setDraft((value) => ({ ...value, ...patch })); setMessage(""); };
  function chooseKind(kind: OligomericKind) { update({ kind, subunits: kind === "homo-oligomer" ? parsedSubunits(subunitText) : null }); }
  async function save() {
    const problem = oligomericStateProblem(draft);
    if (problem) { setFailed(true); setMessage(problem); return; }
    setBusy(true); setMessage("");
    try {
      const latest = await proteinLabsApi.getProtein(bundle.protein.id);
      const existing = latest.projectJobs.find((job) => job.appType === "protparam");
      // Recording the state alone does not mark an uncalculated properties job complete.
      await ensureProjectJob(bundle.protein.id, latest.projectJobs, "protparam", "Protein properties", { ...(existing?.config ?? {}), oligomericState: oligomericStateConfig(draft) }, existing?.status ?? "in_progress");
      await onChanged(); setFailed(false); setMessage(`Oligomeric state saved: ${oligomericLabel(draft)}.`);
    } catch (reason) { setFailed(true); setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  const rows: [string, unknown, number, string][] = [["Molecular weight", result.molecularWeightDa, 2, "Da"], ["ε₂₈₀ reduced", extinction.reducedMolarM1Cm1, 0, "M⁻¹ cm⁻¹"], ["ε₂₈₀ oxidized", extinction.oxidizedMolarM1Cm1, 0, "M⁻¹ cm⁻¹"]];
  const scaled = count !== null && count > 1;
  return <Panel title="Oligomeric state" hint="The assembly this protein forms in solution. ProtParam values above describe one polypeptide chain." className="span-two">
    <div className="oligomer-layout">
      <div className="oligomer-form">
        <fieldset className="oligomer-options"><legend>Assembly</legend>{oligomericKinds.map((option) => <label key={option.id} className={draft.kind === option.id ? "selected" : ""}><input type="radio" name="oligomeric-state" value={option.id} checked={draft.kind === option.id} onChange={() => chooseKind(option.id)}/><span><strong>{option.label}</strong><small>{option.subunits ? `${option.subunits} ${option.subunits === 1 ? "chain" : "identical chains"}` : option.id === "homo-oligomer" ? `${minimumHigherOrder} or more identical chains` : option.id === "hetero-complex" ? "Different partner chains" : "Not yet determined"}</small></span></label>)}</fieldset>
        {draft.kind === "homo-oligomer" && <Field label={`Number of identical subunits (${minimumHigherOrder} or more)`}><input type="number" min={minimumHigherOrder} step="1" inputMode="numeric" value={subunitText} onChange={(event) => { setSubunitText(event.target.value); update({ subunits: parsedSubunits(event.target.value) }); }} placeholder="e.g. 6"/></Field>}
        {draft.kind === "hetero-complex" && <Field label="Complex composition"><input value={draft.complexNote} onChange={(event) => update({ complexNote: event.target.value })} placeholder="e.g. α2β2 with hemoglobin α (HBA1)"/></Field>}
        <div className="oligomer-fields">
          <Field label="Evidence source (optional)"><input list="oligomer-evidence" value={draft.evidence} onChange={(event) => update({ evidence: event.target.value })} placeholder="e.g. Literature, SEC, crystal structure"/><datalist id="oligomer-evidence">{oligomericEvidence.map((value) => <option key={value} value={value}/>)}</datalist></Field>
          <Field label="Notes (optional)"><textarea rows={2} value={draft.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="e.g. Dimer at > 1 mg/mL; PDB 2HHB"/></Field>
        </div>
      </div>
      <div className="oligomer-values">
        <table>
          <thead><tr><th scope="col">Value</th><th scope="col" className="num">Monomer</th><th scope="col" className="num">{scaled ? `${oligomericLabel(draft)} (${count} × monomer)` : "Assembly"}</th></tr></thead>
          <tbody>{rows.map(([label, value, decimals, unit]) => { const assembly = assemblyValue(value, draft); return <tr key={label}><th scope="row">{label} <small>{unit}</small></th><td className="num">{groupedMetric(value, decimals)}</td><td className="num">{assembly === null ? "—" : groupedMetric(assembly, decimals)}</td></tr>; })}</tbody>
        </table>
        <small>{scaled ? `Assembly values are the monomer value × ${count}; they assume ${count} identical chains and no bound ligands.` : draft.kind === "hetero-complex" ? "The partner chains are not in this sequence, so no assembly value is calculated." : draft.kind === "monomer" ? "A monomer's assembly values equal the monomer values." : "Choose a homo-oligomer to see assembly mass and ε₂₈₀."}</small>
      </div>
    </div>
    <div className="panel-actions"><small>{saved ? `Saved: ${oligomericLabel(saved)}${saved.evidence ? ` · ${saved.evidence}` : ""}` : "Not recorded yet"}</small><Button onClick={() => void save()} disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <Check/>} Save oligomeric state</Button></div>
    <Notice message={message} error={failed}/>
  </Panel>;
}
function parsedSubunits(value: string) { const count = Number(value); return value.trim() && Number.isInteger(count) && count >= minimumHigherOrder ? count : null; }
function groupedMetric(value: unknown, decimals: number) { return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { minimumFractionDigits: decimals, maximumFractionDigits: decimals }) : "—"; }

// Kept temporarily for backward-compatible saved layouts; the full console is routed above.
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ResearchJob({ bundle, onChanged }: JobProps) {
  const latestBlast = bundle.blastJobs[0] ?? null;
  const [running, setRunning] = useState<string | null>(null); const [progress, setProgress] = useState(0); const [step, setStep] = useState(""); const [message, setMessage] = useState(""); const [blast, setBlast] = useState<JsonObject | null>(latestBlast);
  const blastRid = blast ? text(blast.rid, "") : "";
  const blastStatus = blast ? text(blast.status, "") : "";
  useEffect(() => {
    if (!blastRid || ["complete", "failed", "canceled"].includes(blastStatus)) return;
    const timer = window.setInterval(() => {
      proteinLabsApi.pollBlast(blastRid).then(async (value) => { setBlast(value); if (["complete", "failed", "canceled"].includes(text(value.status, ""))) await onChanged(); }).catch((reason) => setMessage(reason instanceof Error ? reason.message : String(reason)));
    }, 5000);
    return () => window.clearInterval(timer);
  }, [blastRid, blastStatus, onChanged]);
  async function execute(name: string, action: () => Promise<unknown>, source: string) {
    setRunning(name); setProgress(12); setStep("Saving the current sequence…"); setMessage("");
    try {
      setProgress(38); setStep(`Contacting ${name}…`); const value = await action();
      if (name === "NCBI BLAST") setBlast(value as JsonObject);
      setProgress(88); setStep("Saving results to this project…");
      const latest = await proteinLabsApi.getProtein(bundle.protein.id);
      const existing = latest.projectJobs.find((job) => job.appType === "database-research");
      const sources = Array.from(new Set([...(Array.isArray(existing?.config.savedSources) ? existing.config.savedSources.map(String) : []), source]));
      await ensureProjectJob(bundle.protein.id, latest.projectJobs, "database-research", "Sequence research", { savedSources: sources, updatedAt: new Date().toISOString() }, name === "NCBI BLAST" ? "in_progress" : "complete");
      await onChanged(); setProgress(100); setMessage(`${name} action completed and was saved.`);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setRunning(null); setStep(""); }
  }
  async function terminate() { if (!blastRid) return; await proteinLabsApi.cancelBlast(blastRid); setBlast({ ...(blast ?? {}), status: "canceled", stage: "Terminated locally" }); await onChanged(); }
  const uni = bundle.uniprotMatches[0]; const uniRecord = asObject(uni?.record); const pdb = bundle.pdbMatches[0];
  return <div className="research-grid"><Panel title="UniProt sequence match" hint="Find reviewed entries and import PTM annotations."><div className="research-icon"><Dna /></div>{uni ? <div className="match-card"><CircleCheck/><span><strong>{text(uni.accession)} · {text(uniRecord.uniProtkbId, text(uniRecord.name))}</strong><small>{metric(Number(uni.identity ?? 0) * 100, 1)}% identity · {asArray(uniRecord.features).length} annotated features</small></span></div> : <p>No saved UniProt match yet.</p>}<Button className="wide" disabled={Boolean(running)} onClick={() => void execute("UniProt", () => proteinLabsApi.uniprot(bundle.protein.id), "UniProt")}>{running === "UniProt" ? <LoaderCircle className="spin" /> : <Play />} Find UniProt matches</Button></Panel><Panel title="NCBI protein BLAST" hint="Submit to Swiss-Prot and follow the remote queue."><div className="research-icon"><Search /></div>{blast ? <div className="running-box"><span><strong>{text(blast.stage, blastStatus)}</strong><small>RID {blastRid}</small></span>{!["complete", "failed", "canceled"].includes(blastStatus) && <><Progress value={typeof blast.progress === "number" ? Number(blast.progress) * 100 : 55}/><Button variant="outline" size="sm" onClick={() => void terminate()}><X/> Terminate</Button></>}</div> : <p>No saved BLAST job yet.</p>}<Button className="wide" disabled={Boolean(running) || (!["", "complete", "failed", "canceled"].includes(blastStatus))} onClick={() => void execute("NCBI BLAST", () => proteinLabsApi.blast(bundle.protein.id), "NCBI BLAST")}>{running === "NCBI BLAST" ? <LoaderCircle className="spin" /> : <Play />} Run BLAST</Button></Panel><Panel title="PDB structures & conditions" hint="Find experimental structures and reported conditions."><div className="research-icon"><Atom /></div>{pdb ? <div className="match-card"><CircleCheck/><span><strong>{text(pdb.pdbId)} · {text(pdb.entityDescription)}</strong><small>{metric(Number(pdb.identity ?? 0) * 100, 1)}% identity · {text(asArray(pdb.experimentalMethods)[0])}</small></span></div> : <p>No saved PDB structure yet.</p>}<Button className="wide" disabled={Boolean(running)} onClick={() => void execute("RCSB PDB", () => proteinLabsApi.pdb(bundle.protein.id), "PDB")}>{running === "RCSB PDB" ? <LoaderCircle className="spin" /> : <Play />} Search PDB</Button></Panel>{running && <Panel title="Research progress" className="span-two"><div className="running-box"><LoaderCircle className="spin"/><span><strong>{step}</strong><small>{running}</small></span><Progress value={progress}/></div></Panel>}<Notice message={message} error={/failed|error|unavailable/i.test(message)} /></div>;
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ReadinessJob({ bundle, onChanged }: JobProps) {
  const sequence = bundle.protein.sequence; const result = bundle.protparam?.result ?? {}; const extinction = asObject(result.extinctionCoefficient280); const cysteines = [...sequence].filter((aa) => aa === "C").length; const membrane = hasHydrophobicSegment(sequence); const [location, setLocation] = useState(bundle.protein.organism ? "Cytosol" : "Unknown / review"); const [cofactor, setCofactor] = useState("None known"); const [notes, setNotes] = useState(""); const [message, setMessage] = useState("");
  const checks = [["Membrane protein", membrane ? "Possible" : "No strong segment", membrane ? "A long hydrophobic window was detected" : "No long hydrophobic window detected"], ["Cysteines", String(cysteines), cysteines ? "Review redox state and disulfide requirements" : "No cysteines in the construct"], ["Cellular location", location, "Set the expected native localization"], ["Extinction coefficient", metric(extinction.reducedMolarM1Cm1, 0), Number(extinction.reducedMolarM1Cm1 ?? 0) < 10 ? "Very low A280 signal" : "Suitable for A280 quantitation"], ["Intrinsic disorder", "Review", "Confirm with structure and disorder predictors"], ["Cofactor", cofactor, "Record any required metal, ligand, or prosthetic group"]];
  async function save() { try { await ensureProjectJob(bundle.protein.id, bundle.projectJobs, "protein-readiness", "Protein readiness check", { membraneProtein: membrane, cysteineCount: cysteines, cellularLocation: location, extinctionCoefficient: extinction.reducedMolarM1Cm1 ?? null, intrinsicallyDisordered: "review", cofactor, notes, checkedAt: new Date().toISOString() }); await onChanged(); setMessage("Readiness review saved."); } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); } }
  return <Panel title="Protein readiness review" hint="Review each finding before expression planning."><div className="readiness-list">{checks.map(([name,value,note], index)=><div key={name} className={index === 1 && cysteines ? "attention" : ""}><span className="readiness-check">{index === 1 && cysteines ? <CircleAlert/>:<CircleCheck/>}</span><span><strong>{name}</strong><small>{note}</small></span><b>{value}</b></div>)}</div><div className="two-column"><Field label="Expected cellular location"><input value={location} onChange={(event) => setLocation(event.target.value)} /></Field><Field label="Required cofactor"><input value={cofactor} onChange={(event) => setCofactor(event.target.value)} placeholder="e.g. heme, Zn²⁺, none" /></Field></div><Field label="Readiness notes"><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field><div className="panel-actions"><Button onClick={() => void save()}><Check/> Save readiness check</Button></div><Notice message={message} /></Panel>;
}

type HostSystem = "ecoli" | "yeast" | "insect" | "mammalian";
type ExpressionHost = { id: string; name: string; category: string; lineage: string; promoter: string; genotype: string; usefulFor: string; bestFor: string[]; markers: string; caution: string; reference: string; color: string };
type ExpressionVectorFamily = { id: string; name: string; promoter: string; replication: string; selection: string; delivery: string; benefits: string; caution: string; compatibleHostIds?: string[]; requiredPromoterTokens?: string[] };
function normalizeHostSystem(value:unknown):HostSystem{const key=String(value??"").toLowerCase();if(key.includes("yeast"))return"yeast";if(key.includes("insect"))return"insect";if(key.includes("mammal"))return"mammalian";return"ecoli"}
function systemLabel(value:HostSystem){return value==="ecoli"?"Escherichia coli":value==="yeast"?"Yeast":value==="insect"?"Insect":"Mammalian"}

// Restored from the original Protein Lab expression-system catalog. The
// catalog is intentionally data-driven so new strains can be added without
// changing the workflow component.
const expressionHosts: Record<HostSystem, ExpressionHost[]> = {
  ecoli: [
    { id: "bl21-de3", name: "BL21(DE3)", category: "Routine T7 expression", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "F− ompT hsdS_B(r_B− m_B−) gal dcm λ(DE3)", usefulFor: "The standard first-choice host for routine high-level T7 expression.", bestFor: ["Routine soluble proteins", "pET vectors", "Fast screening"], markers: "No intrinsic plasmid-selection marker.", caution: "Basal T7 expression can be toxic and inclusion bodies remain possible.", reference: "NEB C2527; BL21(DE3) user guides", color: "#35B99A" },
    { id: "bl21", name: "BL21", category: "Non-T7 routine expression", lineage: "E. coli B", promoter: "lac / tac / trc / araBAD", genotype: "F− ompT hsdS_B(r_B− m_B−) gal dcm", usefulFor: "Protease-deficient background for non-T7 bacterial promoters.", bestFor: ["pMAL", "pGEX", "pBAD", "Routine cytoplasmic expression"], markers: "No intrinsic plasmid-selection marker.", caution: "Does not supply T7 RNA polymerase; T7-only vectors will not express.", reference: "NEB BL21 C2530 documentation", color: "#4DB6AC" },
    { id: "bl21-plyss", name: "BL21(DE3)pLysS", category: "Tight / toxic expression", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "BL21(DE3) pLysS (Camᴿ)", usefulFor: "T7 lysozyme suppresses basal T7 polymerase activity before induction.", bestFor: ["Mildly toxic targets", "Reduced leakiness"], markers: "Chloramphenicol resistance from pLysS.", caution: "Yield can be lower and chloramphenicol selection is required.", reference: "Thermo Fisher competent-cell genotype table", color: "#FF8A65" },
    { id: "bl21-ai", name: "BL21-AI", category: "Arabinose-controlled T7", lineage: "E. coli B", promoter: "T7 / arabinose", genotype: "araB::T7RNAP-tetA", usefulFor: "Arabinose-controlled T7 polymerase provides low basal expression and tunable induction.", bestFor: ["Toxic proteins", "Arabinose-controlled T7"], markers: "Chromosomal tetA at the T7 polymerase insertion.", caution: "Induction differs from IPTG-only DE3 workflows and needs optimization.", reference: "Thermo Fisher E. coli genotype table", color: "#FF7043" },
    { id: "bl21-star", name: "BL21 Star(DE3)", category: "High transcript abundance", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "BL21(DE3) rne131", usefulFor: "The rne131 allele stabilizes mRNA and can increase recombinant yield.", bestFor: ["Short-lived mRNA", "High yield"], markers: "No intrinsic plasmid-selection marker.", caution: "Greater mRNA stability can raise basal expression.", reference: "Thermo Fisher BL21 Star manual", color: "#FFCA28" },
    { id: "tuner", name: "Tuner(DE3)", category: "Induction tuning", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "BL21(DE3) lacY1", usefulFor: "lacY1 enables more uniform IPTG entry and concentration-dependent tuning.", bestFor: ["Dose-response induction", "Solubility optimization", "Toxic targets"], markers: "No intrinsic plasmid-selection marker.", caution: "Requires an IPTG titration; maximum expression may not be most soluble.", reference: "Novagen Tuner documentation", color: "#FFA726" },
    { id: "rosetta2", name: "Rosetta 2(DE3)", category: "Rare codons", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "BL21(DE3) pRARE2 (Camᴿ)", usefulFor: "pRARE2 supplies tRNAs for codons uncommon in E. coli.", bestFor: ["Eukaryotic genes", "Rare-codon-rich ORFs", "Non-optimized constructs"], markers: "Chloramphenicol resistance from pRARE2.", caution: "Maintain pRARE2 selection and check resistance compatibility.", reference: "Novagen Rosetta 2 documentation", color: "#7E9CFF" },
    { id: "codonplus", name: "BL21-CodonPlus(DE3)-RIL", category: "Rare codons", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "Enhanced tRNA genes argU ileY leuW; Tetᴿ/Strᴿ", usefulFor: "Extra Arg, Ile and Leu tRNAs improve translation of AT-rich or eukaryotic genes.", bestFor: ["AGA/AGG", "AUA", "CUA codons"], markers: "Tetracycline and streptomycin/spectinomycin resistance.", caution: "Accessory tRNA plasmid adds a second selection requirement.", reference: "Agilent Protein Expression Competent Cell Pack", color: "#7986CB" },
    { id: "origami", name: "Origami B(DE3)", category: "Disulfide folding", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "gor522::Tn10 trxB (Kanᴿ, Tetᴿ)", usefulFor: "trxB/gor defects create a more oxidizing cytoplasm for disulfide bonds.", bestFor: ["Cytoplasmic disulfides", "Cysteine-rich proteins"], markers: "Kanamycin and tetracycline resistance.", caution: "Growth is slower and the strain already carries multiple resistances.", reference: "Novagen Origami genotype record", color: "#AB47BC" },
    { id: "rosetta-gami", name: "Rosetta-gami B(DE3)", category: "Rare codons + disulfides", lineage: "E. coli B", promoter: "T7 / IPTG", genotype: "gor522::Tn10 trxB pRARE (Camᴿ, Kanᴿ, Tetᴿ)", usefulFor: "Combines oxidative folding with rare-codon tRNAs.", bestFor: ["Disulfide-rich eukaryotic proteins", "Rare codons plus oxidative folding"], markers: "Chloramphenicol, kanamycin and tetracycline resistance.", caution: "Multiple markers constrain vector choice and slow growth.", reference: "Novagen competent-cell technical bulletin", color: "#8E24AA" },
    { id: "shuffle", name: "SHuffle T7 Express", category: "Disulfide folding", lineage: "Enhanced E. coli B", promoter: "T7 / IPTG", genotype: "ΔtrxB Δgor with cytoplasmic DsbC (Specᴿ)", usefulFor: "Oxidizing cytoplasm plus DsbC supports correct multi-disulfide folding.", bestFor: ["Antibody fragments", "Secreted-domain mimics", "Multiple disulfides"], markers: "Spectinomycin resistance.", caution: "Compare B-lineage and K-12 SHuffle hosts at lower temperatures.", reference: "NEB SHuffle technical reference", color: "#CE5DD6" },
    { id: "shuffle-lysy", name: "SHuffle T7 Express lysY", category: "Tight + disulfide folding", lineage: "Enhanced E. coli B", promoter: "T7 / IPTG", genotype: "SHuffle background plus MiniF lysY (Camᴿ)", usefulFor: "Adds LysY suppression of basal T7 activity to an oxidative-folding host.", bestFor: ["Toxic disulfide-rich proteins", "Tight control plus DsbC"], markers: "Chloramphenicol and spectinomycin resistance.", caution: "Expect slower optimization with two selection antibiotics.", reference: "NEB SHuffle T7 Express lysY C3030", color: "#D65F8D" },
    { id: "lemo21", name: "Lemo21(DE3)", category: "Tight / membrane expression", lineage: "BL21(DE3) derivative", promoter: "T7 / IPTG + rhamnose", genotype: "BL21(DE3) with rhamnose-tunable T7 lysozyme (Camᴿ)", usefulFor: "Rhamnose tunes effective T7 transcription over a broad range.", bestFor: ["Membrane proteins", "Toxic proteins", "Insoluble targets"], markers: "Chloramphenicol resistance from pLemo.", caution: "Requires two-dimensional IPTG/rhamnose optimization.", reference: "NEB Lemo21 C2528", color: "#FF6F61" },
    { id: "c41", name: "C41(DE3)", category: "Toxic / membrane expression", lineage: "BL21(DE3)-derived", promoter: "Reduced-activity T7 / IPTG", genotype: "Selected T7-expression tolerance mutations", usefulFor: "Tolerates targets whose strong T7 expression kills standard BL21(DE3).", bestFor: ["Toxic proteins", "Membrane proteins", "Problematic T7 constructs"], markers: "No intrinsic plasmid-selection marker.", caution: "Expression can be lower; screen C41 and C43 in parallel.", reference: "LGC Biosearch OverExpress C41", color: "#EF5350" },
    { id: "c43", name: "C43(DE3)", category: "Toxic / membrane expression", lineage: "C41(DE3)-derived", promoter: "Reduced-activity T7 / IPTG", genotype: "C41-derived T7-expression tolerance mutations", usefulFor: "Second-generation toxic-protein host with a distinct tolerance profile.", bestFor: ["Highly toxic targets", "Membrane proteins", "C41 failures"], markers: "No intrinsic plasmid-selection marker.", caution: "Lower transcription can reduce total yield.", reference: "LGC Biosearch OverExpress C43", color: "#E53935" },
    { id: "arctic", name: "ArcticExpress(DE3) RIL", category: "Solubility / cold folding", lineage: "Enhanced E. coli B", promoter: "T7 / IPTG", genotype: "Cpn10/Cpn60 chaperonins plus argU ileY leuW tRNAs", usefulFor: "Cold-adapted chaperonins support folding during low-temperature expression.", bestFor: ["Insoluble proteins", "Low-temperature induction", "Rare codons"], markers: "Gentamicin, streptomycin and tetracycline resistance.", caution: "Chaperonins appear in lysate and add selection constraints.", reference: "Agilent ArcticExpress RIL manual", color: "#42A5F5" },
    { id: "nico21", name: "NiCo21(DE3)", category: "Purification optimized", lineage: "Enhanced E. coli B", promoter: "T7 / IPTG", genotype: "can::CBD; slyD::CBD; ΔhsdS", usefulFor: "Reduces common E. coli contaminants in nickel/cobalt IMAC eluates.", bestFor: ["His-tag purification", "Cleaner IMAC", "Structural biology"], markers: "No intrinsic expression-plasmid marker.", caution: "Use the intended cleanup strategy for maximum benefit.", reference: "NEB NiCo21 C2529", color: "#26A69A" },
    { id: "t7-express", name: "T7 Express lysY/Iᵠ", category: "Very tight T7 control", lineage: "Enhanced E. coli B", promoter: "T7 / IPTG", genotype: "Stable MiniF lysY/lacIᵠ; BL21-derived", usefulFor: "LysY and lacIᵠ minimize basal T7 expression for exceptionally toxic targets.", bestFor: ["Highly toxic proteins", "Unstable plasmids", "Lowest basal expression"], markers: "Stable MiniF lysY/lacIᵠ.", caution: "Tight repression may require longer induction optimization.", reference: "NEB T7 Express lysY/Iᵠ C3013", color: "#FF5C8A" },
    { id: "nebexpress", name: "NEBExpress Iᵠ", category: "Non-T7 lac control", lineage: "Enhanced E. coli B", promoter: "lac / tac / trc / T5-lacO", genotype: "Enhanced BL21-derived non-T7 host carrying stable MiniF lacIᵠ", usefulFor: "Strong lac repression for controlled non-T7 expression.", bestFor: ["Non-T7 vectors", "pMAL", "lac/tac/trc systems"], markers: "Stable lacIᵠ; follow vector selection guidance.", caution: "Does not supply T7 RNA polymerase.", reference: "NEB E. coli strain selection guide", color: "#66BB6A" },
  ],
  yeast: [
    { id: "by4741", name: "S. cerevisiae BY4741", category: "Budding yeast", lineage: "S. cerevisiae S288C-derived", promoter: "GAL1 / TEF1 / PGK1 / GPD", genotype: "MATa his3Δ1 leu2Δ0 met15Δ0 ura3Δ0", usefulFor: "Defined auxotrophies and extensive genetics make BY4741 reproducible for intracellular expression.", bestFor: ["Functional studies", "Auxotrophic selection", "Eukaryotic folding"], markers: "his3Δ1, leu2Δ0, met15Δ0, ura3Δ0.", caution: "Glycosylation differs from mammalian cells.", reference: "Saccharomyces Genome Deletion Project", color: "#F4A261" },
    { id: "w303", name: "S. cerevisiae W303-1A", category: "Budding yeast", lineage: "S. cerevisiae W303", promoter: "GAL1 / TEF1 / PGK1 / GPD", genotype: "MATa ade2-1 can1-100 his3-11,15 leu2-3,112 trp1-1 ura3-1", usefulFor: "Widely used laboratory background with multiple auxotrophic markers.", bestFor: ["GAL1 induction", "Multi-plasmid selection", "Mechanistic studies"], markers: "ADE2, HIS3, LEU2, TRP1 and URA3 auxotrophies.", caution: "Document the exact W303 derivative used.", reference: "W303 genotype records", color: "#E9C46A" },
    { id: "invsc1", name: "S. cerevisiae INVSc1", category: "GAL1 induction", lineage: "S. cerevisiae diploid", promoter: "GAL1 / galactose", genotype: "his3Δ1 leu2 trp1-289 ura3-52", usefulFor: "Common diploid host supplied for galactose-inducible pYES workflows.", bestFor: ["pYES vectors", "GAL1 induction", "Routine eukaryotic expression"], markers: "HIS3, LEU2, TRP1 and URA3 auxotrophies.", caution: "Glucose represses GAL1; switch carbon source carefully.", reference: "Invitrogen INVSc1/pYES guide", color: "#F6BD60" },
    { id: "eby100", name: "S. cerevisiae EBY100", category: "Surface display", lineage: "BJ5465-derived", promoter: "GAL1 / galactose", genotype: "AGA1::GAL1-AGA1::URA3; pep4::HIS3; prb1Δ", usefulFor: "Chromosomal Aga1 enables Aga2-fusion display for affinity maturation and library screening.", bestFor: ["Yeast surface display", "Binder libraries", "Flow selection"], markers: "URA3 integration plus TRP1/LEU2/HIS3 options.", caution: "Requires an Aga2 display vector and secretion signal.", reference: "Addgene EBY100 documentation", color: "#DDA15E" },
    { id: "x33", name: "K. phaffii X-33", category: "Methylotrophic yeast", lineage: "Pichia/Komagataella wild type", promoter: "AOX1 / methanol or GAP", genotype: "Wild type; Mut⁺ phenotype", usefulFor: "Robust secretion and high-cell-density expression with AOX1 or GAP vectors.", bestFor: ["Secreted proteins", "High-density fermentation", "pPICZ/pGAPZ"], markers: "Dominant Zeocin selection.", caution: "Methanol induction requires process controls; glycosylation can be heterogeneous.", reference: "EasySelect Pichia manual", color: "#BC6C25" },
    { id: "gs115", name: "K. phaffii GS115", category: "Methylotrophic yeast", lineage: "Komagataella phaffii", promoter: "AOX1 / methanol or GAP", genotype: "his4; Mut⁺ phenotype", usefulFor: "HIS4 auxotrophy supports classic Pichia-vector selection.", bestFor: ["AOX1 expression", "HIS4 selection", "Secreted proteins"], markers: "his4 auxotrophy; Zeocin-compatible derivatives.", caution: "Screen multiple integration clones.", reference: "EasySelect Pichia manual", color: "#B56576" },
    { id: "km71h", name: "K. phaffii KM71H", category: "Mutˢ control", lineage: "Komagataella phaffii", promoter: "AOX1 / methanol or GAP", genotype: "arg4 aox1::ARG4; Mutˢ phenotype", usefulFor: "Slow methanol utilization can moderate AOX1 production for difficult targets.", bestFor: ["Mutˢ screening", "Difficult secreted proteins", "pPICZ"], markers: "Zeocin; AOX1 disrupted by ARG4.", caution: "Induction kinetics differ from Mut⁺ strains.", reference: "EasySelect Pichia manual", color: "#9C6644" },
    { id: "smd1168h", name: "K. phaffii SMD1168H", category: "Protease deficient", lineage: "GS115-derived", promoter: "AOX1 / methanol or GAP", genotype: "pep4 his4; reduced vacuolar protease A", usefulFor: "Reduced proteolysis can improve recovery of sensitive intracellular or secreted products.", bestFor: ["Protease-sensitive targets", "Secreted proteins", "pPICZ/pGAPZ"], markers: "his4; Zeocin-compatible.", caution: "Protease deficiency does not eliminate all extracellular proteolysis.", reference: "Pichia host-strain documentation", color: "#7F5539" },
  ],
  insect: [
    { id: "sf9", name: "Sf9", category: "Baculovirus workhorse", lineage: "Spodoptera frugiperda ovarian clone", promoter: "Polyhedrin / p10; OpIE", genotype: "Clonal derivative of Sf21; aneuploid insect line", usefulFor: "Standard host for baculovirus generation, plaque assays, amplification and recombinant expression.", bestFor: ["Baculovirus production", "Membrane proteins", "Suspension scale-up"], markers: "Viral workflow; plasmid systems may use blasticidin.", caution: "Optimize MOI and harvest time; glycosylation differs from mammals.", reference: "Thermo Fisher Bac-to-Bac guides", color: "#52B788" },
    { id: "sf21", name: "Sf21", category: "Baculovirus alternative", lineage: "Spodoptera frugiperda ovarian line", promoter: "Polyhedrin / p10; OpIE", genotype: "Parental heterogeneous line from which Sf9 was cloned", usefulFor: "Established host for baculovirus transfection, amplification and expression.", bestFor: ["Virus amplification", "Baculovirus expression", "Alternative to Sf9"], markers: "System-dependent viral or plasmid selection.", caution: "Compare yield and infection kinetics with Sf9.", reference: "Insect cell-line maintenance guide", color: "#40916C" },
    { id: "high-five", name: "High Five", category: "High-yield secretion", lineage: "Trichoplusia ni BTI-TN-5B1-4", promoter: "Polyhedrin / p10", genotype: "Ovarian-derived T. ni line; heterogeneous aneuploid genome", usefulFor: "Frequently gives strong recombinant and secreted protein yield after baculovirus infection.", bestFor: ["Secreted proteins", "High expression", "Serum-free suspension"], markers: "Baculovirus workflow; no infection selection marker.", caution: "Use Sf9/Sf21 for initial virus generation when recommended.", reference: "High Five cell-line documentation", color: "#2D6A4F" },
    { id: "expisf9", name: "ExpiSf9", category: "High-density suspension", lineage: "Suspension-adapted Sf9", promoter: "Polyhedrin / p10", genotype: "Proprietary high-density Sf9-derived line", usefulFor: "High-density, chemically defined baculovirus expression with matched medium and workflow.", bestFor: ["High-density suspension", "Scale-up", "Baculovirus expression"], markers: "Matched ExpiSf reagents.", caution: "Treat as an integrated vendor system.", reference: "Thermo Fisher ExpiSf guide", color: "#1B4332" },
    { id: "s2", name: "Drosophila S2", category: "Stable plasmid expression", lineage: "Drosophila melanogaster Schneider 2", promoter: "Metallothionein / CuSO₄; Act5C", genotype: "Late-embryonic hemocyte-like aneuploid line", usefulFor: "Simple nonviral transient or stable expression with inducible MT or constitutive Act5C vectors.", bestFor: ["Stable insect lines", "Secreted proteins", "Nonviral expression"], markers: "Blasticidin or hygromycin via cotransfected marker.", caution: "Baculovirus transfer vectors are not the appropriate plasmid system.", reference: "Drosophila Expression System manual", color: "#74C69D" },
  ],
  mammalian: [
    { id: "hek293t", name: "HEK293T", category: "Transient adherent", lineage: "Human embryonic kidney 293-derived", promoter: "CMV / CAG / EF1α; SV40 enhancement", genotype: "HEK293 derivative expressing SV40 large T antigen", usefulFor: "Very high transient transfection efficiency for rapid small-to-medium-scale production.", bestFor: ["Transient expression", "Viral packaging", "Complex mammalian proteins"], markers: "Vector-dependent G418, puromycin or hygromycin.", caution: "Adherent workflows scale less easily; SV40-origin replication needs compatible vectors.", reference: "ATCC HEK293T documentation", color: "#5E60CE" },
    { id: "expi293f", name: "Expi293F", category: "Transient suspension", lineage: "High-density suspension HEK293", promoter: "CMV / CAG / EF1α", genotype: "Proprietary HEK293-derived suspension production line", usefulFor: "High-density transient expression with human-like folding and PTM processing.", bestFor: ["Secreted proteins", "Antibodies", "Structural biology"], markers: "Transient workflow; optional vector-dependent selection.", caution: "Use matched medium, reagent, feed and enhancer.", reference: "Thermo Fisher Expi293 guide", color: "#6930C3" },
    { id: "hek293-6e", name: "HEK293-6E", category: "EBNA1 suspension", lineage: "Suspension HEK293 expressing EBNA1", promoter: "CMV / CAG with oriP/EBNA1", genotype: "HEK293 derivative stably expressing EBNA1", usefulFor: "EBNA1 supports transient episomal amplification and retention of oriP vectors.", bestFor: ["pTT/oriP vectors", "Secreted proteins", "Transient scale-up"], markers: "Vector-dependent; EBNA1 is host encoded.", caution: "oriP benefit requires EBNA1 and a compatible vector.", reference: "NRC HEK293-6E/pTT literature", color: "#7400B8" },
    { id: "cho-k1", name: "CHO-K1", category: "Stable or transient", lineage: "Chinese hamster ovary K1", promoter: "CMV / CAG / EF1α", genotype: "Aneuploid CHO-K1 lineage", usefulFor: "Industry-standard mammalian background for stable recombinant proteins and biologics.", bestFor: ["Stable cell lines", "Secreted glycoproteins", "Bioprocess development"], markers: "Vector-dependent G418, puromycin, DHFR or GS selection.", caution: "Stable clone development is slower; glycans are CHO-specific.", reference: "ATCC CHO-K1 references", color: "#4EA8DE" },
    { id: "expicho", name: "ExpiCHO-S", category: "Transient suspension", lineage: "High-density suspension CHO-S", promoter: "CMV / CAG / EF1α", genotype: "Proprietary CHO-S-derived production line", usefulFor: "High-yield transient CHO expression with a matched chemically defined system.", bestFor: ["Antibodies", "Secreted proteins", "CHO-like glycosylation"], markers: "Transient system; stable selection is separate.", caution: "Follow matched transfection, feed, enhancer and temperature-shift workflows.", reference: "Thermo Fisher ExpiCHO guide", color: "#48BFE3" },
    { id: "cho-dg44", name: "CHO-DG44", category: "Stable amplified expression", lineage: "CHO double-deletion mutant", promoter: "CMV / SV40 with DHFR", genotype: "DHFR-deficient CHO derivative", usefulFor: "DHFR selection and methotrexate amplification support high-producing stable clones.", bestFor: ["Stable biologics", "Gene amplification", "Antibodies"], markers: "DHFR complementation and methotrexate amplification.", caution: "Clone development and amplification are time-intensive.", reference: "CHO-DG44/DHFR literature", color: "#56CFE1" },
  ],
};

const expressionVectors: Record<HostSystem, ExpressionVectorFamily[]> = {
  ecoli: [
    { id: "pet28", name: "pET-28 / kanamycin T7", promoter: "T7-lac / IPTG", replication: "pBR322/pMB1-family bacterial origin", selection: "Kanamycin", delivery: "Transform a host supplying T7 RNA polymerase", benefits: "Strong inducible expression, common His₆ tags and straightforward IMAC purification.", caution: "Requires a DE3/T7 host; basal expression can be toxic.", requiredPromoterTokens: ["t7"] },
    { id: "pet21", name: "pET-21 / ampicillin T7", promoter: "T7-lac / IPTG", replication: "pBR322/pMB1-family origin", selection: "Ampicillin", delivery: "Transform a T7 polymerase host", benefits: "Widely used T7 backbone with optional C-terminal His tag.", caution: "Ampicillin selection can be less stable at high density.", requiredPromoterTokens: ["t7"] },
    { id: "pet-sumo", name: "pET-SUMO fusion", promoter: "T7-lac / IPTG", replication: "pBR322/pMB1-family origin", selection: "Usually kanamycin", delivery: "Transform a T7 polymerase host", benefits: "SUMO can improve soluble expression and Ulp1 cleavage exposes a native N terminus.", caution: "Adds a large fusion and requires efficient SUMO proteolysis.", requiredPromoterTokens: ["t7"] },
    { id: "pgex", name: "pGEX GST fusion", promoter: "tac / lac repression / IPTG", replication: "pBR322-derived replicon", selection: "Ampicillin", delivery: "Transform a compatible E. coli host", benefits: "GST improves solubility and enables glutathione capture.", caution: "GST is ~26 kDa and dimeric; it may alter oligomerization." },
    { id: "pmal", name: "pMAL MBP fusion", promoter: "tac / lac repression / IPTG", replication: "pBR322/ColE1-family origin", selection: "Ampicillin", delivery: "Transform a non-T7 or T7-capable host", benefits: "MBP is a strong solubility enhancer and supports amylose capture.", caution: "MBP is ~42 kDa and often should be removed before structural studies." },
    { id: "pbad", name: "pBAD arabinose-inducible", promoter: "araBAD / L-arabinose", replication: "pBR322/ColE1-family origin", selection: "Ampicillin or kanamycin", delivery: "Transform an ara-compatible host", benefits: "Tunable induction and low basal expression without T7 polymerase.", caution: "Carbon source and strain affect arabinose response." },
    { id: "pduet", name: "Duet co-expression vectors", promoter: "Two T7-lac cassettes / IPTG", replication: "Compatible origins by family member", selection: "Ampicillin, kanamycin, chloramphenicol or streptomycin", delivery: "Co-transform compatible-origin plasmids into a T7 host", benefits: "Coordinates complexes, chaperones, cofactors or multiple subunits.", caution: "Verify origin and antibiotic compatibility across every plasmid.", requiredPromoterTokens: ["t7"] },
  ],
  yeast: [
    { id: "pyes2", name: "pYES2 GAL1 / 2µ", promoter: "GAL1 / galactose", replication: "2µ high-copy episome plus E. coli origin", selection: "URA3 yeast; ampicillin E. coli", delivery: "Transform S. cerevisiae and select uracil prototrophy", benefits: "Strong inducible expression with a familiar shuttle-vector workflow.", caution: "Carbon-source switching is required and high copy can burden cells.", compatibleHostIds: ["by4741", "w303", "invsc1"], requiredPromoterTokens: ["gal1"] },
    { id: "pesc", name: "pESC dual GAL1/GAL10", promoter: "Bidirectional GAL1 / GAL10", replication: "2µ high-copy episome", selection: "HIS3, TRP1, LEU2 or URA3", delivery: "Transform S. cerevisiae with the matching auxotrophic marker", benefits: "Co-expresses two proteins from divergent galactose-inducible promoters.", caution: "Match marker to host auxotrophy and balance both cassettes.", compatibleHostIds: ["by4741", "w303", "invsc1"], requiredPromoterTokens: ["gal1"] },
    { id: "prs", name: "pRS CEN/ARS or 2µ shuttle", promoter: "TEF1, GPD, PGK1 or GAL1", replication: "CEN/ARS low-copy or 2µ high-copy", selection: "HIS3, TRP1, LEU2 or URA3", delivery: "Transform S. cerevisiae", benefits: "Modular copy-number and marker choices support controlled expression.", caution: "The backbone does not define the expression promoter; annotate the cassette.", compatibleHostIds: ["by4741", "w303", "invsc1"] },
    { id: "pyd1", name: "pYD1 / Aga2 yeast-display", promoter: "GAL1 / galactose", replication: "2µ yeast shuttle vector", selection: "TRP1 yeast; ampicillin E. coli", delivery: "Transform EBY100 or another Aga1-compatible display strain", benefits: "Displays Aga2 fusions on the yeast surface for quantitative binding and library selection.", caution: "Requires an Aga2 display vector, secretion signal and Aga1-expressing host.", compatibleHostIds: ["eby100"], requiredPromoterTokens: ["gal1"] },
    { id: "ppicz", name: "pPICZ / pPICZα AOX1", promoter: "AOX1 / methanol", replication: "AOX1 genomic integration", selection: "Zeocin", delivery: "Linearize, transform K. phaffii and screen clones", benefits: "Strong methanol-inducible intracellular or α-factor-directed secretion.", caution: "Methanol handling, Mut phenotype and integration copy effects require screening.", compatibleHostIds: ["x33", "gs115", "km71h", "smd1168h"], requiredPromoterTokens: ["aox1"] },
    { id: "pgapz", name: "pGAPZ / pGAPZα", promoter: "GAP / constitutive", replication: "K. phaffii genomic integration", selection: "Zeocin", delivery: "Linearize and transform K. phaffii", benefits: "Avoids methanol induction and supports continuous production.", caution: "No off-switch for toxic proteins.", compatibleHostIds: ["x33", "gs115", "km71h", "smd1168h"] },
  ],
  insect: [
    { id: "pfastbac1", name: "pFastBac1 baculovirus transfer", promoter: "Polyhedrin late promoter", replication: "Tn7 transposition into bacmid", selection: "Bacmid-generation antibiotics", delivery: "Generate bacmid/virus, amplify in Sf9/Sf21, infect production cells", benefits: "High-level expression across Sf9, Sf21 and High Five.", caution: "Requires virus generation, titering and MOI/time-course optimization.", compatibleHostIds: ["sf9", "sf21", "high-five", "expisf9"] },
    { id: "pfastbac-dual", name: "pFastBac Dual", promoter: "Polyhedrin and p10", replication: "Tn7 transposition into bacmid", selection: "Bacmid-generation antibiotics", delivery: "Generate one virus encoding two cassettes", benefits: "Co-expresses two subunits or a target plus helper.", caution: "Promoter strength differs; verify stoichiometry empirically.", compatibleHostIds: ["sf9", "sf21", "high-five", "expisf9"] },
    { id: "pib", name: "pIB / OpIE plasmid", promoter: "OpIE1/OpIE2 immediate-early", replication: "Nonviral plasmid; transient or stable", selection: "Blasticidin", delivery: "Direct plasmid transfection", benefits: "Simpler nonviral expression without generating baculovirus.", caution: "Usually lower expression than optimized baculovirus systems.", compatibleHostIds: ["sf9", "sf21", "high-five", "expisf9"] },
    { id: "pmt-bip", name: "pMT/BiP/V5-His", promoter: "Drosophila metallothionein / Cu²⁺", replication: "Nonviral plasmid", selection: "Blasticidin or hygromycin", delivery: "Transfect S2 cells and induce with copper sulfate", benefits: "Tight inducible S2 expression with BiP secretion and V5/His tags.", caution: "Copper concentration and induction duration require optimization.", compatibleHostIds: ["s2"], requiredPromoterTokens: ["metallothionein"] },
    { id: "pac51", name: "pAc5.1 Drosophila vectors", promoter: "Actin 5C / constitutive", replication: "Nonviral plasmid", selection: "Blasticidin or hygromycin", delivery: "Directly transfect S2 cells", benefits: "Continuous expression without an induction step.", caution: "Constitutive expression is unsuitable for toxic products.", compatibleHostIds: ["s2"] },
  ],
  mammalian: [
    { id: "pcdna31", name: "pcDNA3.1 CMV", promoter: "CMV immediate-early", replication: "Transient plasmid or random integration", selection: "Neomycin/G418; ampicillin in E. coli", delivery: "Transient transfection or stable integration", benefits: "Broad-host, high-level mammalian expression with many tag variants.", caution: "Verify signal peptide, Kozak sequence and marker orientation." },
    { id: "pcdna34", name: "pcDNA3.4 high-expression", promoter: "Full-length CMV", replication: "Transient mammalian plasmid", selection: "Backbone/system dependent", delivery: "Expi293F or ExpiCHO-S transient transfection", benefits: "Optimized high-level transient expression for Expi workflows.", caution: "Use matched cell, medium, transfection and enhancer conditions.", compatibleHostIds: ["hek293t", "expi293f", "cho-k1", "expicho"] },
    { id: "ptt5", name: "pTT / oriP-EBNA1", promoter: "CMV with oriP/EBNA1", replication: "EBNA1-positive oriP episome", selection: "Backbone dependent", delivery: "Transient transfection into HEK293-6E", benefits: "High transient copy number and prolonged expression in EBNA1 cells.", caution: "The advantage is lost in hosts without EBNA1.", compatibleHostIds: ["hek293-6e"], requiredPromoterTokens: ["orip", "ebna1"] },
    { id: "pcag", name: "CAG promoter vectors", promoter: "CAG hybrid", replication: "Transient or stable integration", selection: "Puromycin, G418, hygromycin or none", delivery: "Transient transfection or stable-line generation", benefits: "Strong broad expression and often better resistance to silencing than minimal CMV.", caution: "Large promoter/enhancer footprint can constrain vector capacity." },
    { id: "lentiviral", name: "Third-generation lentiviral transfer", promoter: "EF1α, PGK, SFFV or cell-specific", replication: "Integrated self-inactivating provirus", selection: "Puromycin, blasticidin, hygromycin or fluorescent sorting", delivery: "Package, transduce target cells and select", benefits: "Stable delivery to dividing and non-dividing mammalian cells.", caution: "Requires biosafety review and insertion/copy-number assessment." },
    { id: "dhfr-cho", name: "DHFR-linked CHO vectors", promoter: "CMV or SV40 linked to DHFR", replication: "Stable integration with amplification", selection: "DHFR complementation and methotrexate", delivery: "Transfect DHFR-deficient CHO, select, amplify and clone", benefits: "Classical route to very high-producing stable CHO clones.", caution: "Long development timeline and amplification-associated instability.", compatibleHostIds: ["cho-dg44"], requiredPromoterTokens: ["dhfr"] },
  ],
};

function HostCartoon({ host, compact = false }: { host: ExpressionHost; compact?: boolean }) {
  return <div className={`host-cartoon ${compact ? "compact" : ""}`} style={{ "--host-color": host.color } as React.CSSProperties} aria-hidden="true"><i /><i /><i /></div>;
}

type VectorMatch = { family: ExpressionVectorFamily; level: "pass" | "warning"; note: string };
// Which catalog vectors can actually be used in one chosen cell line. A family
// restricted to other hosts is left out entirely; one whose promoter machinery
// the host does not supply is listed with the caveat rather than hidden, since
// the host can often be swapped for a compatible relative.
function compatibleVectorFamilies(system: HostSystem, host: ExpressionHost): VectorMatch[] {
  return expressionVectors[system]
    .filter((family) => !family.compatibleHostIds || family.compatibleHostIds.includes(host.id))
    .map((family) => family.requiredPromoterTokens && !family.requiredPromoterTokens.some((token) => host.promoter.toLowerCase().includes(token))
      ? { family, level: "warning" as const, note: `Expects ${family.requiredPromoterTokens.join(" / ")} capability, which is not listed for ${host.name}.` }
      : { family, level: "pass" as const, note: family.benefits });
}

function ExpressionJob({ bundle, onChanged }: JobProps) {
  const saved = bundle.projectJobs.find((job) => job.appType === "expression-system");
  const savedSystem = normalizeHostSystem(saved?.config.hostSystem);
  const savedHostId = String(saved?.config.strainId ?? saved?.config.hostId ?? "");
  const [system, setSystem] = useState<HostSystem>(savedSystem);
  // Nothing is preselected unless it was saved earlier: the compatible vectors
  // appear in response to choosing a cell line, so a default choice would
  // present vectors the researcher never asked about.
  const [selectedId, setSelectedId] = useState(() => expressionHosts[savedSystem].some((entry) => entry.id === savedHostId) ? savedHostId : "");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All hosts");
  const [comparison, setComparison] = useState<string[]>([]);
  const [inspector, setInspector] = useState<{ kind: "host" | "vector"; system: HostSystem; id: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const options = expressionHosts[system];
  const host = options.find((entry) => entry.id === selectedId) ?? null;
  const vectorMatches = host ? compatibleVectorFamilies(system, host) : [];
  const categories = ["All hosts", ...Array.from(new Set(options.map((entry) => entry.category)))];
  const visibleHosts = options.filter((entry) => (category === "All hosts" || entry.category === category) && [entry.name, entry.category, entry.genotype, entry.usefulFor, entry.bestFor.join(" ")].join(" ").toLowerCase().includes(search.trim().toLowerCase()));
  function toggleCompare(id:string){setComparison(values=>values.includes(id)?values.filter(value=>value!==id):values.length<4?[...values,id]:values)}
  function chooseHost(target: HostSystem, id: string) { setSystem(target); setSelectedId(id); setCategory("All hosts"); setInspector(null); setMessage(""); }
  async function saveHost() {
    if (!host) { setMessage("Choose a cell line before saving."); return; }
    setBusy(true);
    try {
      // Only the cell line is committed here. The vector is chosen later, in
      // Expression vector design, against a real annotated backbone.
      await ensureProjectJob(bundle.protein.id, bundle.projectJobs, "expression-system", `Expression system — ${host.name}`, { hostSystem: systemLabel(system), hostSystemId: system, hostId: host.id, strainId: host.id, strainName: host.name, category: host.category, lineage: host.lineage, promoter: host.promoter, genotype: host.genotype, usefulFor: host.usefulFor, bestFor: host.bestFor, markers: host.markers, savedByUser: true }, "complete");
      await onChanged(); setMessage(`${host.name} saved as the expression cell line.`);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  const inspectedHost = inspector?.kind === "host" ? expressionHosts[inspector.system].find((entry) => entry.id === inspector.id) ?? null : null;
  const inspectedVector = inspector?.kind === "vector" ? expressionVectors[inspector.system].find((entry) => entry.id === inspector.id) ?? null : null;
  return <div className="expression-layout">
    <div className="expression-main">
      <Panel title="Expression host catalog" hint="Choose the cell line for this project. Each card includes genotype, use case and markers." className="expression-host-panel">
        <Tabs value={system} onValueChange={(value) => { setSystem(value as HostSystem); setSelectedId(""); setCategory("All hosts"); setInspector(null); }}><TabsList><TabsTrigger value="ecoli">E. coli · {expressionHosts.ecoli.length}</TabsTrigger><TabsTrigger value="yeast">Yeast · {expressionHosts.yeast.length}</TabsTrigger><TabsTrigger value="insect">Insect · {expressionHosts.insect.length}</TabsTrigger><TabsTrigger value="mammalian">Mammalian · {expressionHosts.mammalian.length}</TabsTrigger></TabsList><div className="host-filter-row"><label><Search/><input value={search} onChange={(event)=>setSearch(event.target.value)} placeholder="Search hosts, genotypes, or applications"/></label><select value={category} onChange={(event)=>setCategory(event.target.value)}>{categories.map(value=><option key={value}>{value}</option>)}</select><span>{visibleHosts.length} {systemLabel(system)} hosts</span></div><TabsContent value={system}><div className="host-grid">{visibleHosts.map((entry) => <div key={entry.id} className={`host-card ${selectedId === entry.id ? "selected" : ""}`} style={{ "--host-color": entry.color } as React.CSSProperties}><button onClick={() => setInspector({ kind: "host", system, id: entry.id })}><HostCartoon host={entry} compact /><span><strong>{entry.name}</strong><small>{entry.category}</small><em>{entry.usefulFor}</em></span>{selectedId === entry.id && <Check />}</button><label><input type="checkbox" checked={comparison.includes(entry.id)} disabled={!comparison.includes(entry.id)&&comparison.length>=4} onChange={()=>toggleCompare(entry.id)}/>Compare</label></div>)}</div></TabsContent></Tabs>
      </Panel>
      {comparison.length>=2&&<Panel title={`Host comparison · ${comparison.length}/4`} hint="Compare production hosts side by side before choosing one."><div className="host-comparison">{comparison.map(id=>Object.values(expressionHosts).flat().find(entry=>entry.id===id)).filter((entry):entry is ExpressionHost=>Boolean(entry)).map(entry=><article key={entry.id} style={{"--host-color":entry.color} as React.CSSProperties}><HostCartoon host={entry} compact/><strong>{entry.name}</strong><small>{entry.lineage}</small><dl><dt>Promoter</dt><dd>{entry.promoter}</dd><dt>Best for</dt><dd>{entry.bestFor.join(" · ")}</dd><dt>Genotype</dt><dd>{entry.genotype}</dd><dt>Watch-outs</dt><dd>{entry.caution}</dd></dl><Button size="sm" variant="outline" onClick={()=>{const target=(Object.keys(expressionHosts) as HostSystem[]).find(value=>expressionHosts[value].some(host=>host.id===entry.id));if(!target)return;chooseHost(target,entry.id)}}>Select host</Button></article>)}</div></Panel>}
    </div>
    <div className="expression-side">
      <Panel title="Chosen cell line" hint={host ? "Save this cell line to the project, then design its vector in the next job." : "Open a host card from the catalog and choose it to continue."}>
        {host
          ? <>
              <div className="host-profile-heading" style={{ "--host-color": host.color } as React.CSSProperties}><HostCartoon host={host} /><span><strong>{host.name}</strong><small>{host.category} · {host.lineage}</small></span></div>
              <dl className="host-details"><dt>Lineage</dt><dd>{host.lineage}</dd><dt>Promoter machinery</dt><dd>{host.promoter}</dd><dt>Genotype</dt><dd>{host.genotype}</dd><dt>Markers</dt><dd>{host.markers}</dd></dl>
              <div className="host-tags">{host.bestFor.map((item) => <span key={item}>{item}</span>)}</div>
              <Button className="wide" disabled={busy} onClick={() => void saveHost()}>{busy ? <LoaderCircle className="spin"/> : <Check />} Save cell line</Button>
            </>
          : <p className="expression-empty">No cell line chosen yet. Pick one from the catalog to see the vectors that are compatible with it.</p>}
        <Notice message={message} error={/error|could not|choose/i.test(message)} />
      </Panel>
      {host && <Panel title="Compatible vector families" hint={`Reference only — ${vectorMatches.length} families work with ${host.name}. The vector itself is chosen in Expression vector design.`}>
        <div className="vector-family-list">{vectorMatches.map(({ family, level, note }) => <button key={family.id} className={level} onClick={() => setInspector({ kind: "vector", system, id: family.id })}><span><strong>{family.name}</strong><small>{family.promoter} · {family.selection}</small><em>{note}</em></span>{level === "warning" ? <CircleAlert /> : <CircleCheck />}</button>)}</div>
        {!vectorMatches.length && <p className="expression-empty">No catalog vector family is listed for {host.name}.</p>}
      </Panel>}
    </div>
    {inspectedHost && <aside className="selection-inspector"><header><span><small>EXPRESSION HOST</small><strong>{inspectedHost.name}</strong></span><Button variant="ghost" size="icon" onClick={() => setInspector(null)}><X/></Button></header><div className="selection-inspector-body"><div className="host-profile-heading" style={{ "--host-color": inspectedHost.color } as React.CSSProperties}><HostCartoon host={inspectedHost}/><span><strong>{inspectedHost.category}</strong><small>{inspectedHost.lineage}</small></span></div><p>{inspectedHost.usefulFor}</p><dl className="host-details"><dt>Genotype</dt><dd>{inspectedHost.genotype}</dd><dt>Promoter</dt><dd>{inspectedHost.promoter}</dd><dt>Markers</dt><dd>{inspectedHost.markers}</dd></dl><div className="host-tags">{inspectedHost.bestFor.map((item) => <span key={item}>{item}</span>)}</div><div className="host-caution"><CircleAlert/><span><strong>Selection caution</strong><small>{inspectedHost.caution}</small></span></div><small className="host-reference">Reference: {inspectedHost.reference}</small></div><footer><Button variant="outline" onClick={() => setInspector(null)}>Close</Button><Button onClick={() => { if (inspector) chooseHost(inspector.system, inspector.id); }}><Check/> Choose this cell line</Button></footer></aside>}
    {inspectedVector && <aside className="selection-inspector"><header><span><small>VECTOR FAMILY</small><strong>{inspectedVector.name}</strong></span><Button variant="ghost" size="icon" onClick={() => setInspector(null)}><X/></Button></header><div className="selection-inspector-body"><div className="inspector-vector-badge"><Dna/></div><p>{inspectedVector.benefits}</p><dl className="host-details"><dt>Promoter</dt><dd>{inspectedVector.promoter}</dd><dt>Replication</dt><dd>{inspectedVector.replication}</dd><dt>Selection</dt><dd>{inspectedVector.selection}</dd><dt>Delivery</dt><dd>{inspectedVector.delivery}</dd></dl><div className="host-caution"><CircleAlert/><span><strong>Selection caution</strong><small>{inspectedVector.caution}</small></span></div></div><footer><Button variant="outline" onClick={() => setInspector(null)}>Close</Button></footer></aside>}
  </div>;
}

type TracePoint = { x: number; y: number };
// eslint-disable-next-line @typescript-eslint/no-unused-vars
function ChromatogramJob({ bundle, onChanged }: JobProps) {
  const svgRef = useRef<SVGSVGElement>(null); const saved = bundle.projectJobs.find((job) => job.appType === "chromatogram-studio"); const savedPoints = Array.isArray(saved?.config.points) ? (saved!.config.points as unknown[]).map((entry) => asObject(entry)).map((entry) => ({x:Number(entry.x),y:Number(entry.y)})).filter((entry) => Number.isFinite(entry.x) && Number.isFinite(entry.y)) : [];
  const [points, setPoints] = useState<TracePoint[]>(savedPoints); const [filename, setFilename] = useState(text(saved?.config.filename, "")); const [start, setStart] = useState(0.35); const [end, setEnd] = useState(0.55); const [dragging, setDragging] = useState(false); const [color, setColor] = useState("#5ee0cc"); const [opacity, setOpacity] = useState(.32); const [message, setMessage] = useState("");
  const data = points.length ? points : Array.from({length:121},(_,i)=>({x:i/120*20,y:2+70*Math.exp(-Math.pow((i/120-.49)/.052,2))+21*Math.exp(-Math.pow((i/120-.76)/.08,2))})); const bounds = useMemo(() => ({ minX:Math.min(...data.map((p)=>p.x)), maxX:Math.max(...data.map((p)=>p.x)), minY:Math.min(...data.map((p)=>p.y)), maxY:Math.max(...data.map((p)=>p.y)) }), [data]); const normalize = (p:TracePoint) => ({x:(p.x-bounds.minX)/Math.max(.0001,bounds.maxX-bounds.minX)*100,y:88-(p.y-bounds.minY)/Math.max(.0001,bounds.maxY-bounds.minY)*78}); const line = data.map((point,index)=>{const p=normalize(point);return `${index?"L":"M"}${p.x},${p.y}`}).join(" "); const selected = peakRegion(data, Math.min(start,end), Math.max(start,end)); const peak = data.slice(selected[0],selected[1]+1); const peakArea = trapezoidArea(peak); const apex = peak.reduce((best,p)=>p.y>best.y?p:best,peak[0]??data[0]); const leftN=normalize(data[selected[0]]), rightN=normalize(data[selected[1]]); const area = peak.map((point,index)=>{const p=normalize(point);return `${index?"L":"M"}${p.x},${p.y}`}).join(" ")+` L${rightN.x},88 L${leftN.x},88 Z`;
  function position(event:PointerEvent<SVGSVGElement>){const rect=svgRef.current!.getBoundingClientRect();return Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width));}
  async function importCsv(file:File|null){if(!file)return;try{const parsed=parseTrace(await file.text());if(parsed.length<3)throw new Error("No two-column numeric trace was found.");setPoints(parsed);setFilename(file.name);setStart(.35);setEnd(.55);setMessage(`${parsed.length} points imported from ${file.name}.`);}catch(reason){setMessage(reason instanceof Error?reason.message:String(reason));}}
  async function save(){try{const summary={filename:filename||"Untitled trace",points:data,peakTable:[{name:"Peak 1",retentionVolume:apex.x,response:apex.y,area:peakArea,start:data[selected[0]].x,end:data[selected[1]].x}],traceCount:1,peakCount:1,savedAt:new Date().toISOString()};await ensureProjectJob(bundle.protein.id,bundle.projectJobs,"chromatogram-studio","Chromatogram analysis",summary);await onChanged();setMessage("Chromatogram and selected peak saved to this protein project.");}catch(reason){setMessage(reason instanceof Error?reason.message:String(reason));}}
  return <div className="chrom-layout"><Panel title="Interactive chromatogram" hint="Import CSV/TSV data, then drag across a peak; selection expands to local baseline." className="chrom-panel"><div className="plot-toolbar"><label className="upload-button"><Upload/> Import trace<input type="file" accept=".csv,.tsv,.txt,.dat" onChange={(event)=>void importCsv(event.target.files?.[0]??null)}/></label><Button size="sm" variant="secondary"><SquareDashedMousePointer/> Select peak</Button><span>{filename||"Example trace"}</span></div><svg ref={svgRef} className="chrom-plot" viewBox="0 0 100 100" preserveAspectRatio="none" onPointerDown={(event)=>{const x=position(event);setStart(x);setEnd(x);setDragging(true);event.currentTarget.setPointerCapture(event.pointerId)}} onPointerMove={(event)=>dragging&&setEnd(position(event))} onPointerUp={()=>setDragging(false)}>{[20,40,60,80].map(y=><line key={y} x1="0" x2="100" y1={y} y2={y} className="grid-line"/>)}<path d={area} fill={color} opacity={opacity}/><path d={line} className="trace-line"/><line x1={leftN.x} x2={leftN.x} y1="6" y2="88" className="selection-line"/><line x1={rightN.x} x2={rightN.x} y1="6" y2="88" className="selection-line"/></svg><div className="axis-label">Retention volume / time</div><div className="peak-table"><span>Peak 1</span><strong>Ve {apex.x.toFixed(3)}</strong><span>Response {apex.y.toFixed(3)}</span><span>Area {peakArea.toFixed(3)}</span><span>Bounds {data[selected[0]].x.toFixed(3)}–{data[selected[1]].x.toFixed(3)}</span></div><Notice message={message}/></Panel><Panel title="Peak appearance"><Field label="Area color"><input type="color" value={color} onChange={(event)=>setColor(event.target.value)}/></Field><Field label={`Fill opacity · ${Math.round(opacity*100)}%`}><input type="range" min="0" max="1" step=".01" value={opacity} onChange={(event)=>setOpacity(Number(event.target.value))}/></Field><Button className="wide" onClick={()=>void save()}><Check/> Save chromatogram job</Button><Button variant="outline" className="wide" onClick={()=>downloadCsv(filename||"peak-results.csv",[["Peak","Ve","Response","Area","Start","End"],["Peak 1",apex.x,apex.y,peakArea,data[selected[0]].x,data[selected[1]].x]])}><Download/> Export peak table</Button></Panel></div>;
}

function hasHydrophobicSegment(sequence:string){const hydrophobic=new Set("AILMFWVY");for(let i=0;i<=sequence.length-19;i++){let count=0;for(const aa of sequence.slice(i,i+19))if(hydrophobic.has(aa))count++;if(count>=14)return true;}return false;}
function parseTrace(raw:string){const rows:TracePoint[]=[];for(const line of raw.split(/\r?\n/)){const parts=line.trim().split(/[\t,; ]+/);if(parts.length<2)continue;const x=Number(parts[0]),y=Number(parts[1]);if(Number.isFinite(x)&&Number.isFinite(y))rows.push({x,y});}return rows.sort((a,b)=>a.x-b.x);}
function peakRegion(points:TracePoint[],start:number,end:number):[number,number]{const low=Math.max(0,Math.floor(start*(points.length-1))),high=Math.min(points.length-1,Math.ceil(end*(points.length-1)));let apex=low;for(let i=low;i<=high;i++)if(points[i].y>points[apex].y)apex=i;const baseline=Math.min(points[low].y,points[high].y);const threshold=baseline+(points[apex].y-baseline)*.04;let left=apex,right=apex;while(left>0&&points[left].y>threshold)left--;while(right<points.length-1&&points[right].y>threshold)right++;return[left,right];}
function trapezoidArea(points:TracePoint[]){let area=0;for(let i=1;i<points.length;i++)area+=(points[i].x-points[i-1].x)*(points[i].y+points[i-1].y)/2;return Math.max(0,area);}
function downloadCsv(filename:string,rows:(string|number)[][]){const blob=new Blob([rows.map((row)=>row.join(",")).join("\n")],{type:"text/csv"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=filename.endsWith(".csv")?filename:`${filename}.csv`;link.click();URL.revokeObjectURL(url);}
