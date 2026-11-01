"use client";

import { useCallback, useEffect, useId, useMemo, useState, type ComponentType } from "react";
import { ArrowRight, Check, CircleAlert, LoaderCircle, RefreshCw, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Cite, CiteGroup, ReferenceList } from "@/components/ui/citations";
import { citationScope, type CitationId, type CitationScope } from "@/lib/citations";
import { ensureProjectJob, proteinLabsApi, type JsonObject, type ProteinBundle } from "@/lib/protein-labs-api";
import { FACT_GUIDE, proteinFacts } from "@/lib/protein-facts";
import {
  assessmentCitations, CRYSTALLIZE_APP_TYPE, crystallizeConfig, factInfluences, formatProbability, INFLUENCE_LABELS, PREDICTOR_CITATIONS, readAssessment, scoreView,
  type Assessment, type FactInfluence, type InfluenceEffect, type Predictor, type ScoreView, type SpaceGroupSuggestion,
} from "@/lib/crystallization";
import { JobSummary, JobTabs } from "@/components/protein-labs/job-tabs";
import { CrystallizationGuidance } from "@/components/protein-labs/crystallization-guidance";
import { SpaceGroupExplorer } from "@/components/protein-labs/space-group-explorer";
import { CrystalLatticePanel } from "@/components/protein-labs/crystal-lattice-panel";
import { masclSuggestions } from "@/lib/space-group-evidence";
import { CRYSTALLIZE_PANELS, panelState, selectedSpaceGroup, withPanelState, type CrystallizePanelId, type CrystallizePanelProps } from "@/lib/crystallize-panels";

const JOB_LABEL = "Crystallize your protein";

// Panels that plug into this job's tabs (see lib/crystallize-panels.ts). The
// space-group, lattice and practical-guidance panels register here.
const panelComponents: Partial<Record<CrystallizePanelId, ComponentType<CrystallizePanelProps>>> = {
  propensity: PropensityPanel,
  "space-groups": SpaceGroupPanel,
  lattice: CrystalLatticePanel,
  guidance: ({ facts, saved, save }) => <CrystallizationGuidance facts={facts} saved={saved} save={save}/>,
};

/**
 * The space-group selector in this job's slot. It reads the homologues' own
 * crystal forms from `facts` and takes predictions through `suggestions`;
 * `selectSpaceGroup` shares the chosen group with the lattice builder.
 */
function SpaceGroupPanel({ bundle, facts, suggestedSpaceGroups, selectedSpaceGroup: chosen, selectSpaceGroup }: CrystallizePanelProps) {
  // A fresh array each render would defeat the explorer's own memos.
  const suggestions = useMemo(() => masclSuggestions(suggestedSpaceGroups), [suggestedSpaceGroups]);
  return <SpaceGroupExplorer
    facts={facts}
    proteinName={bundle.protein.name}
    suggestions={suggestions}
    initialSymbol={chosen ?? undefined}
    onSelect={(group) => void selectSpaceGroup(group.hm)}
  />;
}

// Every source this job cites, in first-use order down the page. The engine's
// recommendation sits second, so the ids it sends are numbered right after the
// score card's; the rest follow in page order.
const SCORE_REFERENCES: CitationId[] = ["shoebill2026", "mall2025plm"];
const REFERENCES: CitationId[] = ["dale2003", "mcpherson2014", "caffrey2015", "mascl2025", "ita2016", "pdb2000", "carugo1997", "uniprot2023", "jancarik1991", "consurf2023", "alphafold2021", "tunyasuvunakool2021"];

type Load = { state: "loading" } | { state: "ready"; assessment: Assessment } | { state: "error"; message: string };

export function CrystallizeJob({ bundle, onChanged, onOpenJob }: { bundle: ProteinBundle; onChanged: () => Promise<void>; onOpenJob: (jobId: string) => void }) {
  const facts = useMemo(() => proteinFacts(bundle), [bundle]);
  const savedJob = bundle.projectJobs.find((job) => job.appType === CRYSTALLIZE_APP_TYPE);
  const [load, setLoad] = useState<Load>({ state: "loading" });
  const [tab, setTab] = useState<CrystallizePanelId>("propensity");
  const tabsId = useId();

  const assess = useCallback(async () => {
    setLoad({ state: "loading" });
    try { setLoad({ state: "ready", assessment: readAssessment(await proteinLabsApi.getCrystallization(bundle.protein.id)) }); }
    catch (reason) { setLoad({ state: "error", message: engineMessage(reason) }); }
  }, [bundle.protein.id]);
  useEffect(() => { queueMicrotask(() => void assess()); }, [assess]);

  const assessment = load.state === "ready" ? load.assessment : null;

  /** Read the newest saved config, change it, and save the job. Panel saves keep its status; saving the assessment completes it. */
  const update = useCallback(async (change: (config: JsonObject) => JsonObject, complete = false) => {
    const latest = await proteinLabsApi.getProtein(bundle.protein.id);
    const existing = latest.projectJobs.find((job) => job.appType === CRYSTALLIZE_APP_TYPE);
    await ensureProjectJob(bundle.protein.id, latest.projectJobs, CRYSTALLIZE_APP_TYPE, JOB_LABEL, change(existing?.config ?? {}), complete || existing?.status === "complete" ? "complete" : "in_progress");
    await onChanged();
  }, [bundle.protein.id, onChanged]);

  const panels = CRYSTALLIZE_PANELS.filter((panel) => panelComponents[panel.id]);
  const active = panels.find((panel) => panel.id === tab) ?? panels[0];
  const Panel = panelComponents[active.id]!;
  const props: CrystallizePanelProps = {
    bundle, facts, assessment,
    suggestedSpaceGroups: assessment?.spaceGroups ?? [],
    selectedSpaceGroup: selectedSpaceGroup(savedJob?.config),
    selectSpaceGroup: (symbol) => update((config) => ({ ...config, selectedSpaceGroup: symbol })),
    saved: panelState(savedJob?.config, active.id),
    save: (patch) => update((config) => withPanelState(config, active.id, patch)),
    onOpenJob,
  };

  return <div className="crystallize-workspace">
    <header>
      <div><span className="eyebrow">STRUCTURAL BIOLOGY</span><h2>Will this protein crystallise?</h2><p>To see a protein&apos;s atoms by X-ray crystallography you first need a crystal: billions of copies packed in a regular, repeating lattice. This job gathers what the project already knows about {bundle.protein.name}, asks the crystallization predictors what they make of it, and turns both into a starting plan.</p></div>
      <Button variant="outline" onClick={() => void assess()} disabled={load.state === "loading"}>{load.state === "loading" ? <LoaderCircle className="spin"/> : <RefreshCw/>} Re-run assessment</Button>
    </header>
    <CrystallizeSummary load={load} facts={facts} selectedSpaceGroup={selectedSpaceGroup(savedJob?.config)} savedAt={typeof savedJob?.config.assessedAt === "string" ? savedJob.config.assessedAt : ""}/>
    {panels.length > 1 && <div className="crystallize-tabs" role="tablist" aria-label="Crystallize panels">{panels.map((panel) => <button key={panel.id} type="button" role="tab" id={`${tabsId}-${panel.id}`} aria-selected={panel.id === active.id} aria-controls={`${tabsId}-panel`} tabIndex={panel.id === active.id ? 0 : -1} onClick={() => setTab(panel.id)} onKeyDown={(event) => {
      const index = panels.indexOf(panel);
      const next = event.key === "ArrowRight" ? panels[(index + 1) % panels.length] : event.key === "ArrowLeft" ? panels[(index - 1 + panels.length) % panels.length] : null;
      if (next) { event.preventDefault(); setTab(next.id); document.getElementById(`${tabsId}-${next.id}`)?.focus(); }
    }}><strong>{panel.label}</strong><small>{panel.summary}</small></button>)}</div>}
    <div id={`${tabsId}-panel`} role={panels.length > 1 ? "tabpanel" : undefined} aria-labelledby={panels.length > 1 ? `${tabsId}-${active.id}` : undefined}>
      {active.id === "propensity"
        ? <PropensityPanel {...props} load={load} onRetry={() => void assess()} onSaveAssessment={(assessed, influences) => update((config) => crystallizeConfig(config, assessed, influences, new Date().toISOString()), true)}/>
        : <Panel {...props}/>}
    </div>
  </div>;
}

// ── Propensity and advice ───────────────────────────────────────────────────

function PropensityPanel({ bundle, facts, assessment, onOpenJob, load, onRetry, onSaveAssessment }: CrystallizePanelProps & { load?: Load; onRetry?: () => void; onSaveAssessment?: (assessment: Assessment, influences: FactInfluence[]) => Promise<void> }) {
  const refs = useMemo(() => citationScope("crystallize", [...SCORE_REFERENCES, ...assessmentCitations(assessment), ...REFERENCES]), [assessment]);
  const influences = useMemo(() => factInfluences(facts), [facts]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [failed, setFailed] = useState(false);
  const state = load ?? (assessment ? { state: "ready" as const, assessment } : { state: "loading" as const });
  const savedJob = bundle.projectJobs.find((job) => job.appType === CRYSTALLIZE_APP_TYPE);
  const savedAt = typeof savedJob?.config.assessedAt === "string" ? savedJob.config.assessedAt : "";

  async function save() {
    if (!assessment || !onSaveAssessment) return;
    setBusy(true); setMessage("");
    try {
      await onSaveAssessment(assessment, influences);
      setFailed(false); setMessage("Assessment saved to this project.");
    } catch (reason) { setFailed(true); setMessage(engineMessage(reason)); }
    finally { setBusy(false); }
  }

  return <div className="crystallize-propensity">
    <section className="crystallize-summary" aria-busy={state.state === "loading"}>
      <ScoreCard load={state} refs={refs} onRetry={onRetry}/>
      <Recommendation load={state} refs={refs}/>
    </section>

    <JobTabs compact label="Propensity details" tabs={[
      { id: "predictors", label: "Predictors", hint: assessment ? `${assessment.predictors.filter((item) => item.status === "ran").length} of ${assessment.predictors.length} ran` : "With the assessment", content: <Predictors assessment={assessment} refs={refs}/> },
      { id: "space-groups", label: "Suggested space groups", hint: assessment ? `${assessment.spaceGroups.length} suggested` : "With the assessment", content: <SpaceGroups assessment={assessment} refs={refs} loading={state.state === "loading"}/> },
      { id: "facts", label: "Project facts", hint: `${influences.filter((item) => item.effect !== "missing").length} of ${influences.length} known`, content: <Influences influences={influences} refs={refs} onOpenJob={onOpenJob}/> },
      { id: "meaning", label: "What the score means", hint: "Limits of a propensity", content: <>
        <section className="crystallize-explainer" aria-labelledby="crystallize-explainer-heading">
          <h3 id="crystallize-explainer-heading">What “crystallization propensity” means</h3>
          <div>
            <div><h4>What it is</h4><p>A propensity is the chance, from 0 to 1, that a purified protein will form crystals good enough to solve its structure. Predictors learn it from records of past crystallization attempts and look for the sequence and structure features the successes shared.<CiteGroup scope={refs} ids={["shoebill2026", "mall2025plm"]}/></p><p>A range such as 0.55–0.70 is more honest than one number: it shows how sure the predictors are.</p></div>
            <div><h4>What it cannot tell you</h4><ul>
              <li>It is a chance, not a promise. A low score does not mean it will never crystallise, and a high one does not mean the first screen will work.</li>
              <li>It describes the sequence you saved. A shorter construct, a bound ligand or a surface mutation can change the outcome a lot.<Cite scope={refs} id="dale2003"/></li>
              <li>It says nothing about your sample&apos;s purity, concentration or buffer, which matter as much as the protein itself.<CiteGroup scope={refs} ids={["dale2003", "mcpherson2014"]}/></li>
              <li>Membrane proteins need detergents or lipids to crystallise, which these predictors do not model, so treat their scores with extra care.<Cite scope={refs} id="caffrey2015"/></li>
            </ul></div>
          </div>
        </section>
      </> },
    ]}/>

    <ReferenceList scope={refs} className="crystallize-references"/>

    <footer>
      <span role="status" className={failed ? "error" : ""}>{failed && <CircleAlert/>}{message || (savedAt ? `Last saved ${new Date(savedAt).toLocaleString()}.` : "Not saved to the project yet.")}</span>
      <Button disabled={busy || !assessment || !onSaveAssessment} onClick={() => void save()}>{busy ? <LoaderCircle className="spin"/> : <Check/>} Save assessment</Button>
    </footer>
  </div>;
}

/** The job at a glance above its tabs: the score, what ran, the chosen space group and how much the project already knows. */
function CrystallizeSummary({ load, facts, selectedSpaceGroup: chosen, savedAt }: { load: Load; facts: CrystallizePanelProps["facts"]; selectedSpaceGroup: string | null; savedAt: string }) {
  const assessment = load.state === "ready" ? load.assessment : null;
  const view = assessment ? scoreView(assessment) : null;
  const influences = factInfluences(facts);
  const known = influences.filter((item) => item.effect !== "missing").length;
  const cautions = influences.filter((item) => item.effect === "caution").length;
  const ran = assessment?.predictors.filter((item) => item.status === "ran").length ?? 0;
  return <JobSummary label="Crystallization summary" items={[
    { label: "Combined propensity", value: load.state === "loading" ? "Assessing…" : load.state === "error" ? "Unavailable" : view?.kind === "range" ? `${formatProbability(view.lower)}–${formatProbability(view.upper)}` : view?.kind === "point" ? `≈ ${formatProbability(view.value)}` : "Not estimated", detail: load.state === "error" ? "The engine could not assess this protein" : assessment ? `${ran} of ${assessment.predictors.length} predictors ran` : undefined, status: load.state === "error" ? { tone: "error", label: "Error" } : view?.kind === "unavailable" ? { tone: "review", label: "No score" } : undefined },
    { label: "Space group", value: chosen ?? "Not chosen", detail: chosen ? "Used by the lattice builder" : "Pick one in the Space groups tab" },
    { label: "Project facts", value: `${known} of ${influences.length} known`, detail: cautions ? `${cautions} caution${cautions === 1 ? " changes" : "s change"} the advice` : "No caution from earlier jobs", status: cautions ? { tone: "attention", label: "Caution" } : undefined },
  ]} note={savedAt ? `Assessment last saved ${new Date(savedAt).toLocaleString()}.` : "Assessment not saved to the project yet."}/>;
}

function ScoreCard({ load, refs, onRetry }: { load: Load; refs: CitationScope; onRetry?: () => void }) {
  if (load.state === "loading") return <div className="crystallize-score loading"><span className="eyebrow">COMBINED PROPENSITY</span><strong><LoaderCircle className="spin"/> Assessing…</strong><ScoreScale view={null}/><small>Reading the saved project evidence and the predictors.</small></div>;
  if (load.state === "error") return <div className="crystallize-score error" role="alert"><span className="eyebrow">COMBINED PROPENSITY</span><strong><CircleAlert/> Assessment unavailable</strong><ScoreScale view={null}/><small>{load.message}</small>{onRetry && <Button size="sm" variant="outline" onClick={onRetry}><RefreshCw/> Try again</Button>}</div>;
  const view = scoreView(load.assessment);
  // MASCL predicts space groups, not propensity, so it is not part of the combined score.
  const ran = load.assessment.predictors.filter((item) => item.status === "ran" && item.id !== "mascl").map((item) => item.name);
  return <div className={`crystallize-score ${view.kind}`}>
    <span className="eyebrow">COMBINED PROPENSITY<CiteGroup scope={refs} ids={["shoebill2026", "mall2025plm"]}/></span>
    <strong>{view.kind === "range" ? <>{formatProbability(view.lower)}–{formatProbability(view.upper)}<small>probability</small></> : view.kind === "point" ? <>≈ {formatProbability(view.value)}<small>range not given</small></> : "No score yet"}</strong>
    <ScoreScale view={view}/>
    <small>{view.kind === "unavailable" ? view.reason : view.reading}{view.kind !== "unavailable" && ran.length ? ` Combined from ${ran.length < 3 ? ran.join(" and ") : `${ran.slice(0, -1).join(", ")} and ${ran.at(-1)}`}.` : ""}</small>
  </div>;
}

/** 0–1 probability axis with the predicted range as a band and the point estimate as a tick. */
function ScoreScale({ view }: { view: ScoreView | null }) {
  const pattern = useId();
  const x = (value: number) => 12 + value * 456;
  const title = !view || view.kind === "unavailable" ? "No probability estimated" : view.kind === "range" ? `Predicted range ${formatProbability(view.lower)} to ${formatProbability(view.upper)}${view.value === null ? "" : `, estimate ${formatProbability(view.value)}`}` : `Estimate ${formatProbability(view.value)}, uncertainty not given`;
  return <figure className="crystallize-scale">
    <svg viewBox="0 0 480 58" role="img" aria-label={`Crystallization probability on a 0 to 1 scale. ${title}.`}>
      <defs><pattern id={pattern} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)"><line x1="0" y1="0" x2="0" y2="6" className="hatch"/></pattern></defs>
      <line x1={x(0)} x2={x(1)} y1="30" y2="30" className="axis"/>
      <line x1={x(0.5)} x2={x(0.5)} y1="10" y2="34" className="midline"/>
      {[0, 0.25, 0.5, 0.75, 1].map((tick) => <g key={tick}><line x1={x(tick)} x2={x(tick)} y1="30" y2="35" className="tick"/><text x={x(tick)} y="49" textAnchor={tick === 0 ? "start" : tick === 1 ? "end" : "middle"}>{tick === 0 ? "0" : tick === 1 ? "1" : tick.toFixed(2)}</text></g>)}
      {(!view || view.kind === "unavailable") && <rect x={x(0)} y="14" width={x(1) - x(0)} height="12" rx="4" fill={`url(#${pattern})`} className="unknown"><title>{title}</title></rect>}
      {view?.kind === "range" && <rect x={x(view.lower)} y="13" width={Math.max(4, x(view.upper) - x(view.lower))} height="14" rx="4" className="band"><title>{title}</title></rect>}
      {view && view.kind !== "unavailable" && view.value !== null && <line x1={x(view.value)} x2={x(view.value)} y1="9" y2="31" className="estimate"><title>{title}</title></line>}
    </svg>
    <figcaption><span>0 · crystals unlikely</span><span>Crystallization probability</span><span>1 · crystals likely</span></figcaption>
  </figure>;
}

function Recommendation({ load, refs }: { load: Load; refs: CitationScope }) {
  const assessment = load.state === "ready" ? load.assessment : null;
  return <div className="crystallize-recommendation">
    <span className="eyebrow"><Sparkles aria-hidden="true"/> RECOMMENDATION</span>
    {assessment ? <>
      <p className="crystallize-lead">{assessment.recommendation || "No recommendation was returned."}{assessment.recommendation && assessment.recommendationCitations.length > 0 && <CiteGroup scope={refs} ids={assessment.recommendationCitations}/>}</p>
      {assessment.explanations.length > 0 && <ul>{assessment.explanations.map((item, index) => <li key={index}><StatusChip tone={DIRECTION_TONES[item.direction]} label={DIRECTION_LABELS[item.direction]}/><span>{item.summary}{item.citations.length > 0 && <CiteGroup scope={refs} ids={item.citations}/>}{item.source && <small>{item.source}</small>}</span></li>)}</ul>}
      {assessment.method.plainLanguage && <p className="method">{assessment.method.plainLanguage}</p>}
    </> : <p className="method">{load.state === "loading" ? "The recommendation appears once the assessment finishes." : "The facts below still show what the project knows; the recommendation needs the local engine."}</p>}
  </div>;
}

const DIRECTION_TONES: Record<Assessment["explanations"][number]["direction"], StatusTone> = { caution: "attention", action: "review", support: "pass", missing_evidence: "review" };
const DIRECTION_LABELS: Record<Assessment["explanations"][number]["direction"], string> = { caution: "Caution", action: "Action", support: "Supports", missing_evidence: "Missing evidence" };

function Predictors({ assessment, refs }: { assessment: Assessment | null; refs: CitationScope }) {
  return <section className="crystallize-section" aria-labelledby="crystallize-predictors-heading">
    <header><h3 id="crystallize-predictors-heading">The predictors</h3><small>Each one is a published model. A predictor that did not run says why; none of them is replaced by a guess.</small></header>
    {assessment ? <div className="crystallize-predictors">{assessment.predictors.map((predictor) => <PredictorCard key={predictor.id} predictor={predictor} refs={refs}/>)}</div>
      : <p className="crystallize-empty">The predictor list comes with the assessment.</p>}
  </section>;
}

const PREDICTOR_ROLES: Record<string, string> = {
  shoebill: "Scores how likely crystals are from sequence features and an AlphaFold2 model of the protein.",
  plm: "Scores how likely crystals are from a protein language model's reading of the sequence alone.",
  mascl: "Suggests which space groups (crystal symmetries) the protein is likely to adopt.",
};

function PredictorCard({ predictor, refs }: { predictor: Predictor; refs: CitationScope }) {
  const citation = PREDICTOR_CITATIONS[predictor.id];
  const ran = predictor.status === "ran";
  return <article className={`crystallize-predictor ${ran ? "ran" : "unavailable"}`}>
    <header><strong>{predictor.name}{citation && <Cite scope={refs} id={citation}/>}</strong><StatusChip tone={ran ? "pass" : "review"} label={ran ? "Ran" : "Not run"}/></header>
    {PREDICTOR_ROLES[predictor.id] && <p>{PREDICTOR_ROLES[predictor.id]}</p>}
    {ran && predictor.id === "mascl" && predictor.spaceGroups[0] && <p className="crystallize-predictor-score"><b className="space-group">{predictor.spaceGroups[0].spaceGroup}</b><small>{predictor.spaceGroups[0].probability === null ? "most likely group" : `most likely group · ${formatProbability(predictor.spaceGroups[0].probability)}`}</small></p>}
    {ran && predictor.id !== "mascl" && predictor.score !== null && <p className="crystallize-predictor-score"><b>{predictor.lower !== null && predictor.upper !== null ? `${formatProbability(predictor.lower)}–${formatProbability(predictor.upper)}` : formatProbability(predictor.score)}</b><small>{predictor.lower !== null && predictor.upper !== null ? `estimate ${formatProbability(predictor.score)}` : "no range given"}</small></p>}
    {predictor.features.length > 0 && <table className="crystallize-features"><caption>What moved the score</caption><thead><tr><th scope="col">Feature</th><th scope="col" className="num">Value</th><th scope="col">Effect</th></tr></thead><tbody>{predictor.features.map((feature) => <tr key={feature.name}><th scope="row">{feature.name}{feature.plainLanguage && <small>{feature.plainLanguage}</small>}</th><td className="num">{feature.value}</td><td>{feature.effect === "raises" ? "▲ raises" : feature.effect === "lowers" ? "▼ lowers" : "– none"}</td></tr>)}</tbody></table>}
    {predictor.reason && <p className="reason">{predictor.reason}</p>}
  </article>;
}

function SpaceGroups({ assessment, refs, loading }: { assessment: Assessment | null; refs: CitationScope; loading: boolean }) {
  const mascl = assessment?.predictors.find((item) => item.id === "mascl");
  const groups: SpaceGroupSuggestion[] = assessment?.spaceGroups ?? [];
  return <section className="crystallize-section" aria-labelledby="crystallize-groups-heading">
    <header><h3 id="crystallize-groups-heading">Space-group suggestions</h3><small>A space group is the set of symmetry moves (rotations, screw turns and shifts) that copies one protein molecule into every position in the crystal. Proteins are chiral, so only 65 of the 230 space groups are possible for them.<Cite scope={refs} id="ita2016"/></small></header>
    {groups.length ? <table className="crystallize-groups">
      <thead><tr><th scope="col">Space group</th><th scope="col">Where the suggestion comes from</th><th scope="col" className="num">PDB homologues</th><th scope="col" className="num">MASCL probability</th></tr></thead>
      <tbody>{groups.map((group) => <tr key={group.spaceGroup}>
        <th scope="row"><span className="space-group">{group.spaceGroup}</span></th>
        <td>{[group.origin === "mascl" || group.probability !== null ? <span key="m">Predicted by MASCL<Cite scope={refs} id="mascl2025"/></span> : null, group.homologueCount ? <span key="h">Reported by related PDB structures<Cite scope={refs} id="pdb2000"/></span> : null].filter(Boolean)}</td>
        <td className="num">{group.homologueCount || "—"}</td>
        <td className="num">{group.probability === null ? "—" : formatProbability(group.probability)}</td>
      </tr>)}</tbody>
    </table> : <p className="crystallize-empty">{loading ? "Suggestions appear with the assessment." : <>No space group to suggest yet. {mascl && mascl.status !== "ran" ? "MASCL did not run" : "MASCL returned no groups"}<Cite scope={refs} id="mascl2025"/>, and none of the saved PDB homologues reports a crystal form<Cite scope={refs} id="pdb2000"/>. Running the PDB search in Sequence research can add reported groups.</>}</p>}
    {groups.some((group) => group.origin === "homologue") && <p className="crystallize-note">Groups reported by related structures are facts about those crystals, not predictions for yours; a related protein can pack differently.<Cite scope={refs} id="carugo1997"/></p>}
  </section>;
}

const EFFECT_TONES: Record<InfluenceEffect, StatusTone> = { caution: "attention", action: "review", support: "pass", neutral: "review", missing: "review" };

function Influences({ influences, refs, onOpenJob }: { influences: FactInfluence[]; refs: CitationScope; onOpenJob: (jobId: string) => void }) {
  const known = influences.filter((item) => item.effect !== "missing").length;
  return <section className="crystallize-section" aria-labelledby="crystallize-facts-heading">
    <header><h3 id="crystallize-facts-heading">How what you already know changed the advice</h3><small>Read from earlier jobs; nothing here needs typing in again. {known} of {influences.length} facts are known. Open the job named on a missing fact to fill it in.</small></header>
    <table className="crystallize-influences">
      <thead><tr><th scope="col">Fact</th><th scope="col">What the earlier job found</th><th scope="col">Effect</th><th scope="col">What it changes</th></tr></thead>
      <tbody>{influences.map((item) => <tr key={item.key} className={item.effect}>
        <th scope="row"><strong>{item.label}</strong><small>{FACT_GUIDE[item.key].explanation}{FACT_GUIDE[item.key].citations.length > 0 && <CiteGroup scope={refs} ids={FACT_GUIDE[item.key].citations}/>}</small></th>
        <td>{item.finding}{item.sources.length > 0 && <small className="crystallize-source">{item.sources.map((source) => `${source.label}${source.date ? ` · ${new Date(source.date).toLocaleDateString()}` : ""}`).filter((value, index, all) => all.indexOf(value) === index).join("; ")}</small>}</td>
        <td><StatusChip tone={EFFECT_TONES[item.effect]} label={INFLUENCE_LABELS[item.effect]}/></td>
        <td>{item.advice}{item.citations.length > 0 && <CiteGroup scope={refs} ids={item.citations}/>}{item.producedBy && <Button size="sm" variant="outline" className="crystallize-open-job" onClick={() => onOpenJob(item.producedBy!.jobId)}>Open {item.producedBy.label} <ArrowRight/></Button>}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}

function engineMessage(reason: unknown) {
  const text = reason instanceof Error ? reason.message : String(reason);
  // Engines older than the crystallization API answer with a generic 404.
  return /endpoint not found/i.test(text) ? "This version of the local engine cannot assess crystallization yet. Update Protein Labs, then try again. The facts below still come from your earlier jobs." : text;
}
