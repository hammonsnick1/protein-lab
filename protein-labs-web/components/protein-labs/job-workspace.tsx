"use client";

import { PointerEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { Activity, ArrowDownNarrowWide, Atom, BadgeCheck, BookOpen, Check, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Columns3, Disc3, Dna, Download, Filter, FlaskConical, LayoutGrid, ListTree, LoaderCircle, Magnet, Microscope, MousePointerClick, Play, Scale, Search, ShieldCheck, SkipForward, SquareDashedMousePointer, Upload, Workflow, X, Zap } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { StatusChip } from "@/components/ui/status-chip";
import { ensureProjectJob, JsonObject, ProteinBundle, proteinLabsApi } from "@/lib/protein-labs-api";
import { assemblyValue, minimumHigherOrder, OligomericKind, oligomericEvidence, oligomericKinds, oligomericLabel, OligomericState, oligomericStateProblem, oligomericStateSave, readOligomericState, recalculatedProtparamConfig, subunitCount, unknownState } from "@/lib/oligomeric-state";
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
import { ExpressionJob } from "@/components/protein-labs/expression-system-job";
import { OrganismCombobox } from "@/components/protein-labs/organism-combobox";
import { buildSkipConfig, definitionFor, jobsFor, type WorkflowJobDefinition } from "@/lib/workflow";
import { canSkipJob, jobNeighbours } from "@/lib/job-navigation";
import { aminoAcid, residueFamily, sideChainClassLabels } from "@/lib/amino-acids";
import { mostAbundantResidues } from "@/lib/residue-composition";
import { ResidueClassLegend, ResidueDetailDialog } from "@/components/protein-labs/residue-detail";
import { isLowExtinction } from "@/lib/readiness";

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
  "purification-workflow": ["Compile workflow", "Cross-check the design and generate a bench-ready workflow.", Workflow],
  "transformation-expression": ["Transformation and Expression", "Record starting material, host-specific medium, culture conditions, and expression notes.", FlaskConical],
  chromatogram: ["Chromatogram Studio", "Import traces, select peaks, calculate areas, and save results.", Activity],
  gel: ["Gel densitometry", "Detect lanes and bands, estimate molecular weight, and quantify purity.", Columns3],
};

type JobProps = { bundle: ProteinBundle; onChanged: () => Promise<void> };

export function JobWorkspace({ jobId, bundle, returnTo, onBack, onOpenJob, onStep, onReports, onRoadmap, onChanged }: { jobId: string; bundle: ProteinBundle; returnTo: "planning" | "roadmap"; onBack: () => void; onOpenJob: (jobId: string) => void; onStep: (jobId: string, direction: "forward" | "back") => void; onReports: () => void; onRoadmap: () => void; onChanged: () => Promise<void> }) {
  const [title, description, Icon] = labels[jobId] ?? labels.sequence;
  const [online, setOnline] = useState<boolean | null>(null);
  const [saved, setSaved] = useState(0);
  const [workflowLayout, setWorkflowLayout] = useState<"tree" | "cards">("tree");
  useEffect(() => { proteinLabsApi.health().then(() => setOnline(true)).catch(() => setOnline(false)); }, []);
  useEffect(() => {
    const savedLayout = localStorage.getItem("protein-labs-workflow-layout");
    if (savedLayout === "cards") queueMicrotask(() => setWorkflowLayout("cards"));
  }, []);
  // The "Saved" indicator shows briefly after each save, then clears itself.
  useEffect(() => {
    if (!saved) return;
    const timer = window.setTimeout(() => setSaved(0), 2600);
    return () => window.clearTimeout(timer);
  }, [saved]);
  async function handleChanged() {
    await onChanged();
    setSaved((count) => count + 1);
  }
  const changed = handleChanged;
  return <main className="job-workspace">
    <button className="job-return-tab" onClick={onBack} aria-label={returnTo === "roadmap" ? "Return to purification roadmap" : "Return to project planning"}>
      <ChevronLeft/>{returnTo === "roadmap" ? <FlaskConical/> : workflowLayout === "cards" ? <LayoutGrid/> : <ListTree/>}<span><strong>{returnTo === "roadmap" ? "Purification roadmap" : "Project planning"}</strong><small>{returnTo === "roadmap" ? "Back to roadmap" : `Back to ${workflowLayout === "cards" ? "Planning" : "tree"}`}</small></span>
    </button>
    <header className="job-header"><div className="job-title-row"><span className="job-hero-icon"><Icon /></span><div><span className="eyebrow">{bundle.protein.name} · CURRENT JOB</span><h1>{title}</h1><p>{description}</p></div></div><div className="job-header-actions"><span className={`engine-state ${online ? "online" : online === false ? "offline" : "checking"}`}><span />{online ? "Local engine connected" : online === false ? "Local engine unavailable" : "Checking engine"}</span><Button variant="outline" onClick={onRoadmap}><FlaskConical/> Roadmap</Button><Button variant="outline" onClick={onReports}><BookOpen /> Report</Button></div></header>
    <section className="job-surface">{jobId === "sequence" && <SequenceJob bundle={bundle} onChanged={changed} />}{jobId === "properties" && <PropertiesJob bundle={bundle} onChanged={changed} />}{jobId === "research" && <SequenceResearchJob bundle={bundle} onChanged={changed} />}{jobId === "reference-match" && <ReferenceMatchJob bundle={bundle} onChanged={changed} />}{jobId === "structure" && <StructureJob bundle={bundle} onChanged={changed} onOpenJob={onOpenJob} />}{jobId === "readiness" && <ProteinReadinessJob bundle={bundle} onChanged={changed} onReports={onReports} onOpenJob={onOpenJob} />}{jobId === "expression-system" && <ExpressionJob bundle={bundle} onChanged={changed} />}{jobId === "expression-vector" && <ExpressionVectorJob bundle={bundle} onChanged={changed} />}{(["purification-lysis","purification-subtractive","purification-sec"] as string[]).includes(jobId) && <PurificationStageJob bundle={bundle} onChanged={changed} mode={jobId as "purification-lysis"|"purification-subtractive"|"purification-sec"} />}{(["purification-affinity","purification-workflow"] as string[]).includes(jobId) && <PurificationPlannerJob bundle={bundle} onChanged={changed} section={jobId} />}{jobId === "transformation-expression" && <TransformationExpressionJob bundle={bundle} onChanged={changed} />}{jobId === "chromatogram" && <ChromatogramStudioJob bundle={bundle} onChanged={changed} />}{jobId === "gel" && <GelAnalysisJob bundle={bundle} onChanged={changed} />}</section>
    <JobNavigation bundle={bundle} jobId={jobId} saved={saved > 0} onStep={onStep} onChanged={onChanged}/>
  </main>;
}

/** Previous and Next job tabs in the bottom corners of an open job. They sit
 *  in their own strip under the job, so they never cover its content. */
function JobNavigation({ bundle, jobId, saved, onStep, onChanged }: { bundle: ProteinBundle; jobId: string; saved: boolean; onStep: (jobId: string, direction: "forward" | "back") => void; onChanged: () => Promise<void> }) {
  const { previous, next } = jobNeighbours(jobId);
  const [skipping, setSkipping] = useState(false);
  const [failure, setFailure] = useState("");
  const current = definitionFor(jobId);
  async function skip(definition: WorkflowJobDefinition, then: WorkflowJobDefinition) {
    setSkipping(true); setFailure("");
    try {
      const existing = jobsFor(bundle, definition)[0];
      const job = existing ?? await proteinLabsApi.createJob(bundle.protein.id, definition.label, definition.appType);
      await proteinLabsApi.updateJob(bundle.protein.id, job.id, `Skipped — ${definition.label}`, "complete", buildSkipConfig(job.config));
      await onChanged();
      onStep(then.id, "forward");
    } catch (reason) { setFailure(reason instanceof Error ? reason.message : String(reason)); }
    finally { setSkipping(false); }
  }
  return <nav className="job-nav" aria-label="Workflow jobs">
    {previous && <JobNavTab direction="back" target={previous} onStep={onStep}/>}
    <span className="job-nav-trailing">
      <span className={`job-nav-status ${failure ? "error" : ""}`} role="status">{failure ? <><CircleAlert/> {failure}</> : saved ? <><Check/> Saved</> : null}</span>
      {next && canSkipJob(bundle, jobId) && <button type="button" className="job-nav-skip" disabled={skipping} onClick={() => void skip(current, next)} aria-label={`Skip ${current.label} and open the next job`}>{skipping ? <LoaderCircle className="spin"/> : <SkipForward/>} Skip</button>}
      {next && <JobNavTab direction="forward" target={next} onStep={onStep}/>}
    </span>
  </nav>;
}

function JobNavTab({ direction, target, onStep }: { direction: "forward" | "back"; target: WorkflowJobDefinition; onStep: (jobId: string, direction: "forward" | "back") => void }) {
  const tooltip = useId();
  const label = direction === "back" ? "Previous job" : "Next job";
  return <span className={`job-nav-corner ${direction === "back" ? "previous" : "next"}`}>
    <button type="button" className="job-nav-tab" onClick={() => onStep(target.id, direction)} aria-describedby={tooltip}>
      {direction === "back" && <ChevronLeft aria-hidden="true"/>}{label}{direction === "forward" && <ChevronRight aria-hidden="true"/>}
    </button>
    <span className="job-nav-tooltip" role="tooltip" id={tooltip}>{target.label}</span>
  </span>;
}

function Panel({ title, hint, children, className = "" }: { title: string; hint?: string; children: React.ReactNode; className?: string }) { return <section className={`lab-panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></div>{children}</section>; }
function Field({ label, children }: { label: string; children: React.ReactNode }) { return <label className="lab-field"><span>{label}</span>{children}</label>; }
function Notice({ message, error = false }: { message: string; error?: boolean }) { return message ? <div className={`inline-message ${error ? "error" : ""}`}>{error ? <CircleAlert /> : <CircleCheck />} {message}</div> : null; }
function asObject(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function asArray(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }
function text(value: unknown, fallback: unknown = "—") { return String(value === null || value === undefined || value === "" ? fallback : value); }
/** Residue counts and their share of the sequence, split into two aligned
 *  halves with a total row that shows the shares add up to the whole. Bars
 *  take the side-chain class colour; a row opens that residue's details.
 *  The residue (or residues, on a tie) with the highest count is tinted and
 *  badged "Most abundant". */
function CompositionTable({ residues }: { residues: [string, unknown][] }) {
  const [open, setOpen] = useState<number | null>(null);
  const container = useRef<HTMLDivElement>(null);
  const rows = residues.map(([aa, raw]) => {
    const row = asObject(raw);
    return { aa, name: text(row.name, aa), count: Number(row.count ?? 0), percent: Number(row.percent ?? 0), acid: aminoAcid(aa), family: residueFamily(aa) };
  });
  const details = rows.flatMap((row) => row.acid ? [{ acid: row.acid, count: row.count, percent: row.percent }] : []);
  if (!rows.length) return <p className="composition-empty">Run the calculation to see the residue composition.</p>;
  const totalCount = rows.reduce((sum, row) => sum + row.count, 0);
  const totalPercent = rows.reduce((sum, row) => sum + row.percent, 0);
  const largest = Math.max(...rows.map((row) => row.percent));
  const top = mostAbundantResidues(rows);
  const half = Math.ceil(rows.length / 2);
  const show = (aa: string) => { const index = details.findIndex((detail) => detail.acid.code === aa); if (index >= 0) setOpen(index); };
  return <div className="composition" ref={container}>
    <div className="composition-halves">
      {[rows.slice(0, half), rows.slice(half)].map((group, index) => <table className="composition-table" key={index}>
        <thead><tr><th scope="col">Residue</th><th scope="col" className="num">Count</th><th scope="col" className="num">% of protein</th><th scope="col" aria-label="Relative abundance"/></tr></thead>
        <tbody>{group.map((row) => <tr key={row.aa} className={`aa-family-${row.family}${row.acid ? " is-clickable" : ""}${top.has(row.aa) ? " is-most-abundant" : ""}`} onClick={row.acid ? () => show(row.aa) : undefined}>
          <th scope="row">{row.acid
            ? <button type="button" className="composition-residue" data-residue={row.aa} onClick={(event) => { event.stopPropagation(); show(row.aa); }} aria-label={`${row.name}, ${sideChainClassLabels[row.acid.family].toLowerCase()}: ${row.count} residues, ${row.percent.toFixed(2)}%${top.has(row.aa) ? ", most abundant" : ""}. Show residue details`}><strong>{row.aa}</strong><span>{row.name}</span></button>
            : <><strong>{row.aa}</strong><span>{row.name}</span></>}</th>
          <td className="num">{row.count}</td>
          <td className="num">{row.percent.toFixed(2)}%</td>
          <td className="composition-bar-cell">{top.has(row.aa) && <span className="composition-top-badge">Most abundant</span>}<span className="composition-bar"><i style={{ width: `${largest ? (row.percent / largest) * 100 : 0}%` }}/></span></td>
        </tr>)}</tbody>
      </table>)}
    </div>
    <p className="composition-total"><span>Total</span><strong>{totalCount} residues</strong><strong>{totalPercent.toFixed(2)}%</strong></p>
    <div className="composition-footer"><ResidueClassLegend present={new Set(rows.map((row) => row.family))}/><small><MousePointerClick aria-hidden="true"/> Select a residue for its structure and properties.</small></div>
    <ResidueDetailDialog rows={details} index={open} onIndexChange={setOpen} onClose={() => setOpen(null)} onReturnFocus={(code) => container.current?.querySelector<HTMLButtonElement>(`[data-residue="${code}"]`)?.focus()}/>
  </div>;
}

function metric(value: unknown, decimals = 2) { return typeof value === "number" ? value.toFixed(decimals) : "—"; }

function SequenceJob({ bundle, onChanged }: JobProps) {
  const protein = bundle.protein;
  const [name, setName] = useState(protein.name);
  const [sequence, setSequence] = useState(protein.sequence);
  const [organism, setOrganism] = useState(protein.organism ?? "");
  const [organismTaxonId, setOrganismTaxonId] = useState<number | null>(protein.organismTaxonId ?? null);
  const [geneName, setGeneName] = useState(protein.geneName ?? "");
  const [description, setDescription] = useState(protein.description ?? "");
  const [notes, setNotes] = useState(protein.notes ?? "");
  const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [failed, setFailed] = useState(false);
  async function save() {
    const normalized = sequence.replace(/\s+/g, "").toUpperCase();
    if (!normalized) { setFailed(true); setMessage("Enter an amino-acid sequence first."); return; }
    setBusy(true); setMessage("");
    try {
      await proteinLabsApi.updateProtein(protein.id, { name: name.trim() || "Untitled protein", sequence: normalized, organism, organismTaxonId, geneName, description, notes });
      const refreshed = await proteinLabsApi.getProtein(protein.id);
      await ensureProjectJob(protein.id, refreshed.projectJobs, "protein-planner", "Protein sequence", { sequenceLength: normalized.length, savedByUser: true });
      await onChanged(); setFailed(false); setMessage("Sequence saved and protein properties recalculated locally.");
    } catch (reason) { setFailed(true); setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  return <div className="two-column"><Panel title="Primary sequence" hint="Spaces and line breaks are ignored."><Field label="Construct name"><input value={name} onChange={(event) => setName(event.target.value)} /></Field><Field label="Amino acid sequence"><textarea className="sequence-editor" value={sequence} onChange={(event) => setSequence(event.target.value.toUpperCase().replace(/[^A-Z\n\r ]/g, ""))} /></Field><div className="sequence-footer"><span>{sequence.replace(/\s/g, "").length} amino acids</span><Button disabled={busy} onClick={() => void save()}>{busy ? <LoaderCircle className="spin" /> : <Check />} Save sequence</Button></div><Notice message={message} error={failed} /></Panel><Panel title="Construct metadata" hint="Saved with the protein and used by later jobs."><OrganismCombobox value={organism} taxonId={organismTaxonId} onChange={(text, taxon) => { setOrganism(text); setOrganismTaxonId(taxon); }}/><Field label="Gene"><input value={geneName} onChange={(event) => setGeneName(event.target.value)} placeholder="e.g. PA0012" /></Field><Field label="Description"><textarea rows={3} value={description} onChange={(event) => setDescription(event.target.value)} /></Field><Field label="Notes"><textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field></Panel></div>;
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
      const saved = latest.projectJobs.find((job) => job.appType === "protparam")?.config;
      await ensureProjectJob(bundle.protein.id, latest.projectJobs, "protparam", "Protein properties", recalculatedProtparamConfig(saved, new Date().toISOString()));
      await onChanged(); setMessage("ProtParam properties recalculated and saved.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  const extinction = asObject(result.extinctionCoefficient280);
  const stability = typeof result.instabilityIndex === "number" ? (result.stabilityPrediction === "stable" ? "pass" : "warning") : null;
  // Label, value, unit, and what the number means.
  const metrics: [string, string, string, string][] = [["Molecular weight", metric(result.molecularWeightDa, 1), "Da", "Average isotopic mass of the chain"], ["Monoisotopic mass", metric(result.monoisotopicMassDa, 1), "Da", "Lightest isotopes only, for mass spectra"], ["Theoretical pI", metric(result.theoreticalPI, 2), "", "The pH at which net charge is zero"], ["Instability index", metric(result.instabilityIndex, 2), "", "Below 40 predicts a stable protein"], ["Aliphatic index", metric(result.aliphaticIndex, 2), "", "Relative volume of A, V, I and L side chains"], ["GRAVY", metric(result.gravy, 3), "", "Mean Kyte–Doolittle hydropathy; below 0 is hydrophilic"], ["Aromaticity", metric(result.aromaticity, 3), "fraction", "Share of F, W and Y residues"], ["Chemical formula", text(result.chemicalFormula), "", "Neutral, unmodified chain"], ["Total atoms", text(result.totalAtoms), "atoms", "Including hydrogens"]];
  const composition = asObject(result.aminoAcidComposition);
  const residues = Object.entries(composition).sort((a, b) => a[0].localeCompare(b[0]));
  const charged = asObject(result.chargedResidues);
  const sequenceSummary = asObject(result.sequence);
  const halfLife=asObject(result.estimatedHalfLife),secondary=asObject(result.secondaryStructureFraction),atomic=asObject(result.atomicComposition);
  const sequenceLength = Number(sequenceSummary.length ?? bundle.protein.sequence.length);
  const terminus = (letter: unknown, position: number) => letter ? `${text(asObject(composition[String(letter)]).name, String(letter))}${position}` : "—";
  const secondaryRows:[string,number,string][]=[["Helix",Number(secondary.helix??0),"#52c7b8"],["Turn",Number(secondary.turn??0),"#e5ab55"],["Sheet",Number(secondary.sheet??0),"#8d83e8"]];
  return <div className="properties-layout"><Panel title="Complete ProtParam profile" hint={`ExPASy-compatible definitions calculated locally for the current ${bundle.protein.sequence.length} aa construct.`} className="span-two"><div className="metric-grid">{metrics.map(([label, value, unit, meaning]) => <div className="metric-card" key={label}><span>{label}</span><strong>{value}{unit && value !== "—" && <small>{unit}</small>}{label === "Instability index" && stability && <StatusChip tone={stability} label={text(result.stabilityPrediction)}/>}</strong><p>{meaning}</p></div>)}</div><div className="panel-actions"><small>{text(asObject(result.algorithm).compatibility,"Biopython ProtParam definitions")}</small><Button onClick={() => void calculate()} disabled={busy}>{busy ? <LoaderCircle className="spin" /> : <Play />} Recalculate and save</Button></div><Notice message={message} error={message.toLowerCase().includes("error")} /></Panel><Panel title="Extinction coefficient at 280 nm" hint="Reported for reduced cysteines and maximally oxidized cystines."><div className="property-detail-grid"><span>Reduced molar</span><strong>{metric(extinction.reducedMolarM1Cm1,0)} M⁻¹ cm⁻¹</strong><span>Oxidized molar</span><strong>{metric(extinction.oxidizedMolarM1Cm1,0)} M⁻¹ cm⁻¹</strong><span>Reduced A(0.1%)</span><strong>{metric(extinction.reducedAbsorbance01Percent,3)}</strong><span>Oxidized A(0.1%)</span><strong>{metric(extinction.oxidizedAbsorbance01Percent,3)}</strong></div></Panel><Panel title="Estimated half-life" hint={text(halfLife.warning,"")}><div className="property-detail-grid"><span>N-terminal residue</span><strong>{text(halfLife.nTerminalResidue)}</strong><span>Mammalian reticulocytes</span><strong>{text(halfLife.mammalianReticulocytesInVitro)}</strong><span>Yeast in vivo</span><strong>{text(halfLife.yeastInVivo)}</strong><span>E. coli in vivo</span><strong>{text(halfLife.ecoliInVivo)}</strong></div></Panel><Panel title="Secondary-structure propensity" hint="Share of residues in each ProtParam propensity set (helix V I Y F W L, turn N P G S, sheet E M A L); not a structure prediction."><div className="secondary-bars">{secondaryRows.map(([label,value,color])=><div key={label}><span><b>{label}</b><small>{metric(value*100,1)}%</small></span><i><em style={{width:`${value*100}%`,background:color}}/></i></div>)}</div></Panel><Panel title="Sequence and charge summary" hint="Residues are numbered from the N-terminus to the C-terminus."><div className="terminus-strip" role="img" aria-label={`${sequenceLength} residues, from the N-terminus at ${terminus(sequenceSummary.nTerminus, 1)} to the C-terminus at ${terminus(sequenceSummary.cTerminus, sequenceLength)}`}><span><b>N-terminus</b><small>{terminus(sequenceSummary.nTerminus, 1)}</small></span><i><em>{sequenceLength} residues</em></i><span><b>C-terminus</b><small>{terminus(sequenceSummary.cTerminus, sequenceLength)}</small></span></div><div className="check-list"><span><CircleCheck/> Net charge at pH 7: {metric(charged.predictedChargeAtPH7,2)}</span><span><CircleCheck/> Acidic D + E: {text(charged.negativeAspGlu)} residues</span><span><CircleCheck/> Basic R + K: {text(charged.positiveArgLys)} residues</span><span><CircleCheck/> Atomic composition: {Object.entries(atomic).map(([element,count])=>`${element}${count}`).join(" ")}</span></div></Panel><OligomericStatePanel bundle={bundle} result={result} onChanged={onChanged}/><Panel title="Amino-acid composition" hint="Share of each residue in the full sequence; the bar is scaled to the most abundant residue and coloured by side-chain class." className="span-two"><CompositionTable residues={residues}/></Panel><Panel title="Calculation assumptions" className="span-two"><div className="assumption-list">{(Array.isArray(result.assumptions)?result.assumptions:[]).map((value,index)=><span key={index}><CircleAlert/>{String(value)}</span>)}</div></Panel></div>;
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
      const { config, status } = oligomericStateSave(latest.projectJobs.find((job) => job.appType === "protparam"), draft);
      await ensureProjectJob(bundle.protein.id, latest.projectJobs, "protparam", "Protein properties", config, status);
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
  const checks = [["Membrane protein", membrane ? "Possible" : "No strong segment", membrane ? "A long hydrophobic window was detected" : "No long hydrophobic window detected"], ["Cysteines", String(cysteines), cysteines ? "Review redox state and disulfide requirements" : "No cysteines in the construct"], ["Cellular location", location, "Set the expected native localization"], ["Extinction coefficient", metric(extinction.reducedMolarM1Cm1, 0), isLowExtinction(typeof extinction.reducedMolarM1Cm1 === "number" ? extinction.reducedMolarM1Cm1 : null) ? "Very low A280 signal" : "Suitable for A280 quantitation"], ["Intrinsic disorder", "Review", "Confirm with structure and disorder predictors"], ["Cofactor", cofactor, "Record any required metal, ligand, or prosthetic group"]];
  async function save() { try { await ensureProjectJob(bundle.protein.id, bundle.projectJobs, "protein-readiness", "Protein readiness check", { membraneProtein: membrane, cysteineCount: cysteines, cellularLocation: location, extinctionCoefficient: extinction.reducedMolarM1Cm1 ?? null, intrinsicallyDisordered: "review", cofactor, notes, checkedAt: new Date().toISOString() }); await onChanged(); setMessage("Readiness review saved."); } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); } }
  return <Panel title="Protein readiness review" hint="Review each finding before expression planning."><div className="readiness-list">{checks.map(([name,value,note], index)=><div key={name} className={index === 1 && cysteines ? "attention" : ""}><span className="readiness-check">{index === 1 && cysteines ? <CircleAlert/>:<CircleCheck/>}</span><span><strong>{name}</strong><small>{note}</small></span><b>{value}</b></div>)}</div><div className="two-column"><Field label="Expected cellular location"><input value={location} onChange={(event) => setLocation(event.target.value)} /></Field><Field label="Required cofactor"><input value={cofactor} onChange={(event) => setCofactor(event.target.value)} placeholder="e.g. heme, Zn²⁺, none" /></Field></div><Field label="Readiness notes"><textarea rows={4} value={notes} onChange={(event) => setNotes(event.target.value)} /></Field><div className="panel-actions"><Button onClick={() => void save()}><Check/> Save readiness check</Button></div><Notice message={message} /></Panel>;
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
