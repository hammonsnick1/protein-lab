"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, BookOpen, Check, Database, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { ensureProjectJob, proteinLabsApi } from "@/lib/protein-labs-api";
import { LOW_EXTINCTION_THRESHOLD_M1CM1, formatExtinction, isLowExtinction, resolveExtinctionThreshold } from "@/lib/readiness";

type Answer = "Not reviewed" | "Yes" | "No" | "Needs follow-up";
type Tone = "pass" | "attention" | "review";
type WindowEvidence = { start: number; end: number; score: number; sequence: string } | null;
const answers: Answer[] = ["Not reviewed", "Yes", "No", "Needs follow-up"];
const toneLabels: Record<Tone, string> = { pass: "Pass", attention: "Attention", review: "Review" };

export function ProteinReadinessJob({ bundle, onChanged, onReports }: { bundle: ProteinBundle; onChanged: () => Promise<void>; onReports: () => void }) {
  const savedJob = bundle.projectJobs.find((job) => job.appType === "protein-readiness");
  const saved = savedJob?.config ?? {};
  const evidence = useMemo(() => gatherEvidence(bundle, bundle.projectJobs.find((job) => job.appType === "reference-match")?.config ?? {}), [bundle]);
  const [membrane, setMembrane] = useState<Answer>(() => savedAnswer(saved.membraneProtein, evidence.transmembrane.length ? "Yes" : evidence.membraneFlag ? "Needs follow-up" : "Not reviewed"));
  const [disorder, setDisorder] = useState<Answer>(() => savedAnswer(saved.intrinsicallyDisordered, evidence.disordered.length ? "Yes" : evidence.disorderFlag ? "Needs follow-up" : "Not reviewed"));
  const [cofactor, setCofactor] = useState<Answer>(() => savedAnswer(saved.cofactorRequired, evidence.cofactors.length ? "Yes" : "Not reviewed"));
  const [ptm, setPtm] = useState<Answer>(() => savedAnswer(saved.postTranslationalModification, evidence.ptms.length ? "Yes" : "Not reviewed"));
  const [location, setLocation] = useState(String(saved.cellularLocation ?? evidence.locations.join("; ")));
  const [cofactorDetails, setCofactorDetails] = useState(String(saved.cofactorDetails ?? evidence.cofactors.join("; ")));
  const [ptmDetails, setPtmDetails] = useState(String(saved.postTranslationalModificationDetails ?? evidence.ptms.map(regionSummary).join("; ")));
  const [threshold, setThreshold] = useState(() => resolveExtinctionThreshold(saved.extinctionThresholdM1Cm1));
  const [notes, setNotes] = useState(String(saved.notes ?? ""));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [savedJobId, setSavedJobId] = useState(savedJob?.id ?? "");

  const reduced = evidence.reducedExtinction;
  const oxidized = evidence.oxidizedExtinction;
  const lowExtinction = isLowExtinction(reduced, threshold);
  const membraneEvidence = evidence.transmembrane.length
    ? `${evidence.transmembrane.length} membrane-spanning region(s) reported by the selected UniProt reference.`
    : evidence.membraneFlag && evidence.hydrophobic
      ? `A hydrophobic composition screen flagged residues ${evidence.hydrophobic.start}–${evidence.hydrophobic.end}; confirm with a dedicated topology predictor.`
      : "No transmembrane annotation in the selected reference or strong local hydrophobic segment was found. Absence of evidence is not proof that the protein is soluble.";
  const disorderEvidence = evidence.disordered.length
    ? `${evidence.disordered.length} disordered region(s) reported by the selected UniProt reference.`
    : evidence.disorderFlag && evidence.disorderWindow
      ? `A disorder-enriched composition screen flagged residues ${evidence.disorderWindow.start}–${evidence.disorderWindow.end}; confirm with a dedicated disorder predictor.`
      : "No disordered-region annotation in the selected reference or strong composition flag was found. This local screen is not a disorder predictor.";

  function useEvidence() {
    if (evidence.transmembrane.length) setMembrane("Yes"); else if (evidence.membraneFlag) setMembrane("Needs follow-up");
    if (evidence.disordered.length) setDisorder("Yes"); else if (evidence.disorderFlag) setDisorder("Needs follow-up");
    if (evidence.cofactors.length) { setCofactor("Yes"); if (!cofactorDetails.trim()) setCofactorDetails(evidence.cofactors.join("; ")); }
    if (evidence.ptms.length) { setPtm("Yes"); if (!ptmDetails.trim()) setPtmDetails(evidence.ptms.map(regionSummary).join("; ")); }
    if (evidence.locations.length && !location.trim()) setLocation(evidence.locations.join("; "));
    setMessage(evidence.referenceAccession ? `Evidence from ${evidence.referenceAccession} and local sequence screens was applied for review.` : "Local sequence screens were applied. Select a UniProt reference to transfer biological annotations.");
  }

  function config(): JsonObject {
    const needsFollowUp = [membrane, disorder, cofactor, ptm].some((value) => value === "Not reviewed" || value === "Needs follow-up");
    return {
      reviewStatus: needsFollowUp ? "needs_follow_up" : "reviewed",
      referenceAccession: evidence.referenceAccession,
      referenceProteinName: evidence.referenceProteinName,
      referenceIdentity: evidence.referenceIdentity,
      referenceQueryCoverage: evidence.referenceQueryCoverage,
      membraneProtein: membrane,
      membraneEvidence,
      cysteineCount: evidence.cysteines,
      hasCysteines: evidence.cysteines > 0,
      cellularLocation: location.trim(),
      extinctionThresholdM1Cm1: threshold,
      reducedExtinctionM1Cm1: reduced,
      oxidizedExtinctionM1Cm1: oxidized,
      reducedExtinctionBelowThreshold: lowExtinction,
      intrinsicallyDisordered: disorder,
      disorderEvidence,
      cofactorRequired: cofactor,
      cofactorDetails: cofactorDetails.trim(),
      postTranslationalModification: ptm,
      postTranslationalModificationDetails: ptmDetails.trim(),
      notes: notes.trim(),
      reviewedAt: new Date().toISOString(),
      savedByUser: true,
    };
  }

  async function save() {
    setBusy(true); setMessage("");
    try {
      const latest = await proteinLabsApi.getProtein(bundle.protein.id);
      const job = await ensureProjectJob(bundle.protein.id, latest.projectJobs, "protein-readiness", "Protein readiness check", config());
      setSavedJobId(job.id); await onChanged();
      setMessage(config().reviewStatus === "reviewed" ? "Protein readiness check completed." : "Readiness check saved with follow-up items.");
    } catch (reason) { setMessage(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function sendToJournal() {
    setBusy(true); setMessage("");
    try {
      let jobId = savedJobId;
      if (!jobId) {
        const latest = await proteinLabsApi.getProtein(bundle.protein.id);
        const job = await ensureProjectJob(bundle.protein.id, latest.projectJobs, "protein-readiness", "Protein readiness check", config());
        jobId = job.id; setSavedJobId(job.id);
      }
      const latest = await proteinLabsApi.getProtein(bundle.protein.id);
      const capturedAt = new Date().toISOString();
      const sections = (latest.projectNotebook?.sections ?? []).filter((section) => section.sourceAppType !== "protein-readiness");
      sections.push({ id: `readiness-${jobId || capturedAt}`, type: "job-result", title: "Protein readiness and experimental considerations", content: journalContent(bundle, config()), sourceJobId: jobId, sourceAppType: "protein-readiness", sourceLabel: "Protein readiness check", capturedAt });
      await proteinLabsApi.saveNotebook(bundle.protein.id, latest.projectNotebook?.title ?? `${bundle.protein.name} purification report`, latest.projectNotebook?.summary ?? "", sections);
      await onChanged(); setMessage("Readiness section added to the project journal."); onReports();
    } catch (reason) { setMessage(errorText(reason)); }
    finally { setBusy(false); }
  }

  const checks: { title: string; value: string; detail: string; tone: Tone }[] = [
    { title: "Membrane protein?", value: membrane, detail: membraneEvidence, tone: tone(membrane) },
    { title: "Contains cysteines?", value: evidence.cysteines ? `Yes · ${evidence.cysteines}` : "No", detail: evidence.cysteines ? "Review redox state, disulfide requirements, and reducing-agent compatibility." : "No cysteines occur in the current construct.", tone: evidence.cysteines ? "attention" : "pass" },
    { title: "Where is it expressed in the cell?", value: location || "Not recorded", detail: evidence.locations.length ? `Loaded from ${evidence.locations.length} location annotation(s) in ${evidence.referenceAccession}.` : "No location annotation is available from the selected reference; enter a known or expected compartment.", tone: location ? "pass" : "review" },
    { title: "Low extinction coefficient?", value: reduced === null ? "Not available" : `${lowExtinction ? "Yes" : "No"} · ${formatExtinction(reduced)}`, detail: reduced === null ? "Complete Protein properties to calculate the A₂₈₀ extinction coefficient." : `Reduced-Cys ε₂₈₀ is ${lowExtinction ? "below" : "at or above"} the ${formatExtinction(threshold)} threshold${lowExtinction ? "; A₂₈₀ quantitation will be weak, so plan a dye-based assay or a longer path length" : ""}.${oxidized === null ? "" : ` Oxidized-Cys ε₂₈₀: ${formatExtinction(oxidized)}.`}`, tone: lowExtinction ? "attention" : reduced === null ? "review" : "pass" },
    { title: "Intrinsically disordered?", value: disorder, detail: disorderEvidence, tone: tone(disorder) },
    { title: "Requires a cofactor?", value: cofactor, detail: evidence.cofactors.length ? `${evidence.referenceAccession} reports: ${evidence.cofactors.join("; ")}.` : "No structured cofactor annotation is saved for the selected reference. Review homologs and literature.", tone: tone(cofactor) },
    { title: "Known PTM or maturation feature?", value: ptm, detail: evidence.ptms.length ? `${evidence.referenceAccession} reports ${evidence.ptms.length} feature(s): ${evidence.ptms.slice(0, 3).map(regionSummary).join("; ")}.` : "No structured PTM or maturation feature is saved for the selected reference. Absence of annotation is not evidence of absence.", tone: tone(ptm) },
  ];

  return <div className="readiness-workspace">
    <header><div><span className="eyebrow">EVIDENCE-BASED CHECKPOINT</span><h2>Protein readiness check</h2><p>This checkpoint combines exact sequence calculations with one explicitly selected UniProt reference and clearly labeled local screens.</p></div><Button variant="outline" onClick={useEvidence}><RefreshCw/> Use detected evidence</Button></header>
    <div className={`readiness-reference ${evidence.referenceAccession ? "selected" : "missing"}`}><BadgeCheck/><span><strong>{evidence.referenceAccession ? `${evidence.referenceAccession} · ${evidence.referenceProteinName}` : "No biological reference selected"}</strong><small>{evidence.referenceAccession ? `${percent(evidence.referenceIdentity)} identity · ${percent(evidence.referenceQueryCoverage)} query coverage · cofactor and PTM evidence below comes only from this record.` : "Return to the tree and complete Choose reference match before finalizing this review."}</small></span></div>
    <div className="readiness-section-head"><span><h3>Checkpoint findings</h3><small>Sequence calculations and the selected reference, answered for this construct.</small></span><span className="readiness-tally">{(["attention", "review", "pass"] as const).map((value) => <StatusChip key={value} tone={value} label={`${checks.filter((item) => item.tone === value).length} ${toneLabels[value].toLowerCase()}`}/>)}</span></div>
    <section className="readiness-overview">{checks.map((item) => <article className={item.tone} key={item.title}><header><strong>{item.title}</strong><StatusChip tone={item.tone} label={toneLabels[item.tone]}/></header><b>{item.value}</b><small>{item.detail}</small></article>)}</section>
    <div className="readiness-editor">
      <section><header><h3>Researcher review</h3><small>Confirm or override each answer before saving.</small></header><div className="readiness-answer-grid"><AnswerField label="Membrane protein" value={membrane} onChange={setMembrane}/><AnswerField label="Intrinsically disordered" value={disorder} onChange={setDisorder}/><AnswerField label="Requires a cofactor" value={cofactor} onChange={setCofactor}/><AnswerField label="Known PTM/maturation" value={ptm} onChange={setPtm}/></div><label>Cellular location<input value={location} onChange={(event) => setLocation(event.target.value)} placeholder="e.g. cytosol, periplasm, secreted"/></label><label>Cofactor details<input value={cofactorDetails} onChange={(event) => setCofactorDetails(event.target.value)} placeholder="e.g. heme, Zn²⁺, FAD, none"/></label><label>PTM and maturation details<textarea rows={3} value={ptmDetails} onChange={(event) => setPtmDetails(event.target.value)} placeholder="e.g. initiator methionine removed, phosphoserine, glycosylation"/></label><label>Low-extinction warning threshold (M⁻¹ cm⁻¹)<input type="number" min="0" step="500" value={threshold} onChange={(event) => setThreshold(Number(event.target.value) || 0)}/><small className="field-hint">Reduced-Cys ε₂₈₀ below {formatExtinction(threshold)} is flagged. Default {formatExtinction(LOW_EXTINCTION_THRESHOLD_M1CM1)}.</small></label><label>Readiness notes<textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)}/></label></section>
      <section><header><h3>Evidence ledger</h3><small>What each answer above is based on.</small></header><Evidence title="Selected UniProt reference" values={evidence.referenceAccession ? [`${evidence.referenceAccession} · ${evidence.referenceProteinName} · ${percent(evidence.referenceIdentity)} identity · ${percent(evidence.referenceQueryCoverage)} coverage`] : []}/><Evidence title="Cofactors" values={evidence.cofactors}/><Evidence title="PTM and maturation features" values={evidence.ptms.map(regionSummary)}/><Evidence title="UniProt transmembrane regions" values={evidence.transmembrane.map(regionSummary)}/><Evidence title="UniProt disordered regions" values={evidence.disordered.map(regionSummary)}/><Evidence title="Subcellular locations" values={evidence.locations}/>{evidence.hydrophobic && <Evidence title="Strongest hydrophobic window" values={[`${evidence.hydrophobic.start}–${evidence.hydrophobic.end} · score ${evidence.hydrophobic.score.toFixed(3)} · ${evidence.hydrophobic.sequence}`]}/>} {evidence.disorderWindow && <Evidence title="Strongest disorder-composition window" values={[`${evidence.disorderWindow.start}–${evidence.disorderWindow.end} · score ${evidence.disorderWindow.score.toFixed(3)} · ${evidence.disorderWindow.sequence}`]}/>}<div className="readiness-method"><Database/><span><strong>Evidence hierarchy</strong><small>The selected UniProt record is used exclusively for transferred biological annotations. Cysteine count and extinction values come directly from this construct. Local window screens are triage only.</small></span></div></section>
    </div>
    <footer><span role="status">{message}</span><Button variant="outline" disabled={busy} onClick={() => void sendToJournal()}><BookOpen/> Send this section to journal</Button><Button disabled={busy} onClick={() => void save()}>{busy ? <LoaderCircle className="spin"/> : <Check/>} Save readiness check</Button></footer>
  </div>;
}

function AnswerField({ label, value, onChange }: { label: string; value: Answer; onChange: (value: Answer) => void }) { return <label>{label}<select value={value} onChange={(event) => onChange(event.target.value as Answer)}>{answers.map((answer) => <option key={answer}>{answer}</option>)}</select></label>; }
function Evidence({ title, values }: { title: string; values: string[] }) { return <div className="evidence-block"><strong>{title}</strong>{values.length ? values.map((value, index) => <span key={`${value}-${index}`}>{value}</span>) : <small className="evidence-empty">No saved evidence</small>}</div>; }
function savedAnswer(value: unknown, fallback: Answer): Answer { return answers.includes(value as Answer) ? value as Answer : fallback; }
function tone(answer: Answer): Tone { return answer === "No" ? "pass" : answer === "Yes" ? "attention" : "review"; }
function asObject(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function asObjects(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }
function regionSummary(region: JsonObject) { const location = asObject(region.location); const start = region.start ?? location.start ?? "?"; const end = region.end ?? location.end ?? "?"; return `${String(region.description ?? region.type ?? "Region")} · ${String(start)}–${String(end)}`; }

function gatherEvidence(bundle: ProteinBundle, referenceConfig: JsonObject) {
  const selectedAccession = String(referenceConfig.selectedAccession ?? "");
  const selectedMatch = bundle.uniprotMatches.find((match) => accessionFor(match) === selectedAccession);
  const selectedRecord = recordFor(selectedMatch);
  const snapshot = asObject(referenceConfig.evidenceSnapshot);
  const source = Object.keys(selectedRecord).length ? selectedRecord : snapshot;
  const transmembrane = asObjects(source.transmembraneRegions);
  const disordered = asObjects(source.disorderedRegions);
  const ptms = asObjects(source.postTranslationalModifications);
  const locations = new Set<string>(), cofactors = new Set<string>();
  for (const location of asObjects(source.subcellularLocations)) { const label = [location.location, location.topology].filter(Boolean).map(String).join(" · "); if (label) locations.add(label); }
  for (const comment of asObjects(source.comments)) if (String(comment.type).toUpperCase() === "SUBCELLULAR LOCATION") for (const value of Array.isArray(comment.texts) ? comment.texts : []) if (String(value).trim()) locations.add(String(value).trim());
  for (const cofactorItem of asObjects(source.cofactors)) { const label = [cofactorItem.name, cofactorItem.chebiId].filter(Boolean).map(String).join(" · "); if (label) cofactors.add(label); }
  const sequence = bundle.protein.sequence.toUpperCase();
  const hydrophobic = windowScreen(sequence, 15, 21, "AILMFWVY", "DEKR");
  const disorderWindow = windowScreen(sequence, 20, 30, "PESTQKRGND", "AILMFWVY");
  const extinction = asObject(bundle.protparam?.result.extinctionCoefficient280);
  return { referenceAccession: selectedAccession, referenceProteinName: String(referenceConfig.selectedProteinName ?? selectedRecord.proteinName ?? selectedRecord.uniProtkbId ?? ""), referenceIdentity: finiteOrNull(referenceConfig.identity ?? selectedMatch?.identity), referenceQueryCoverage: finiteOrNull(referenceConfig.queryCoverage ?? selectedMatch?.queryCoverage), transmembrane, disordered, ptms, locations: [...locations], cofactors: [...cofactors], cysteines: [...sequence].filter((aa) => aa === "C").length, hydrophobic, disorderWindow, membraneFlag: (hydrophobic?.score ?? 0) >= .52, disorderFlag: (disorderWindow?.score ?? 0) >= .43, reducedExtinction: finiteOrNull(extinction.reducedMolarM1Cm1), oxidizedExtinction: finiteOrNull(extinction.oxidizedMolarM1Cm1) };
}

function recordFor(match: JsonObject | undefined) { const record = asObject(match?.record); return Object.keys(record).length ? record : (match ?? {}); }
function accessionFor(match: JsonObject) { const record = recordFor(match); return String(record.accession ?? match.accession ?? ""); }
function windowScreen(sequence: string, minimum: number, maximumWindow: number, positive: string, negative: string): WindowEvidence { if (sequence.length < minimum) return null; const window = Math.min(maximumWindow, sequence.length); let best: NonNullable<WindowEvidence> | null = null; for (let start = 0; start <= sequence.length - window; start++) { const segment = sequence.slice(start, start + window); const score = ([...segment].filter((aa) => positive.includes(aa)).length - [...segment].filter((aa) => negative.includes(aa)).length) / window; if (!best || score > best.score) best = { start: start + 1, end: start + window, score, sequence: segment }; } return best; }
function finiteOrNull(value: unknown) { const number = Number(value); return value === null || value === undefined || value === "" || !Number.isFinite(number) ? null : number; }
function percent(value: number | null) { return value === null ? "—" : `${(value * 100).toFixed(1)}%`; }
function errorText(value: unknown) { return value instanceof Error ? value.message : String(value); }
function journalContent(bundle: ProteinBundle, config: JsonObject) { return ["Purpose", `Final review of ${bundle.protein.name} sequence-derived risks and experimental considerations before expression and purification planning.`, "", "Selected biological reference", config.referenceAccession ? `${config.referenceAccession} · ${config.referenceProteinName || "Unnamed protein"} · ${percent(finiteOrNull(config.referenceIdentity))} identity · ${percent(finiteOrNull(config.referenceQueryCoverage))} query coverage` : "No reference selected", "", "Review summary", `Membrane protein: ${config.membraneProtein}`, `Cysteines: ${config.cysteineCount} residue(s) detected (${config.hasCysteines ? "yes" : "no"})`, `Reported cellular location: ${config.cellularLocation || "Not recorded"}`, `Extinction coefficient below ${formatExtinction(finiteOrNull(config.extinctionThresholdM1Cm1))}: ${config.reducedExtinctionBelowThreshold ? "yes" : "no"}`, `Reduced extinction coefficient: ${formatExtinction(finiteOrNull(config.reducedExtinctionM1Cm1))}`, `Oxidized extinction coefficient: ${formatExtinction(finiteOrNull(config.oxidizedExtinctionM1Cm1))}`, `Intrinsically disordered: ${config.intrinsicallyDisordered}`, `Cofactor requirement: ${config.cofactorDetails ? `${config.cofactorRequired} — ${config.cofactorDetails}` : config.cofactorRequired}`, `Known PTM or maturation feature: ${config.postTranslationalModificationDetails ? `${config.postTranslationalModification} — ${config.postTranslationalModificationDetails}` : config.postTranslationalModification}`, "", "Evidence and interpretation", `Membrane evidence: ${config.membraneEvidence}`, `Disorder evidence: ${config.disorderEvidence}`, ...(config.notes ? ["", "Researcher notes", String(config.notes)] : [])].join("\n"); }
