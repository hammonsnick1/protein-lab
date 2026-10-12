"use client";

import { useEffect, useMemo, useState } from "react";
import { Atom, CircleAlert, CircleCheck, Database, Dna, ExternalLink, LoaderCircle, Play, RefreshCw, Search, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { ensureProjectJob, proteinLabsApi } from "@/lib/protein-labs-api";

export function SequenceResearchJob({ bundle, onChanged }: { bundle: ProteinBundle; onChanged: () => Promise<void> }) {
  const [blastJobs, setBlastJobs] = useState<JsonObject[]>(bundle.blastJobs);
  const [uniprot, setUniprot] = useState<JsonObject[]>(bundle.uniprotMatches);
  const [pdb, setPdb] = useState<JsonObject[]>(bundle.pdbMatches);
  const [running, setRunning] = useState("");
  const [step, setStep] = useState("");
  const [progress, setProgress] = useState(0);
  const [message, setMessage] = useState("");
  const [query, setQuery] = useState("");
  const [accession, setAccession] = useState("");
  const activeJobs = useMemo(() => blastJobs.filter((job) => !terminal(String(job.status ?? ""))), [blastJobs]);

  useEffect(() => {
    if (!activeJobs.length) return;
    let stopped = false;
    const poll = async () => {
      const values: JsonObject[] = [];
      for (const job of activeJobs) {
        try { values.push(await proteinLabsApi.pollBlast(String(job.rid))); }
        catch (reason) { values.push({ ...job, stage: `Status check failed: ${errorText(reason)}` }); }
      }
      if (stopped) return;
      setBlastJobs((current) => current.map((job) => values.find((value) => value.rid === job.rid) ?? job));
      if (values.some((value) => terminal(String(value.status ?? "")))) { await onChanged(); const latest = await proteinLabsApi.getProtein(bundle.protein.id); setUniprot(latest.uniprotMatches); }
    };
    const timer = window.setInterval(() => void poll(), 5000);
    return () => { stopped = true; window.clearInterval(timer); };
  }, [activeJobs, bundle.protein.id, onChanged]);

  async function saveResearchSource(source: string, status: "in_progress" | "complete" = "complete") {
    const latest = await proteinLabsApi.getProtein(bundle.protein.id);
    const existing = latest.projectJobs.find((job) => job.appType === "database-research");
    const sources = Array.from(new Set([...(Array.isArray(existing?.config.savedSources) ? existing.config.savedSources.map(String) : []), source]));
    await ensureProjectJob(bundle.protein.id, latest.projectJobs, "database-research", "Sequence research", { savedSources: sources, updatedAt: new Date().toISOString(), savedByUser: true }, status);
  }

  async function perform(name: string, action: () => Promise<unknown>, after: (value: unknown) => void, source: string, queued = false) {
    setRunning(name); setStep("Saving and validating the current amino-acid sequence…"); setProgress(12); setMessage("");
    try {
      setStep(`Contacting ${name}…`); setProgress(38);
      const value = await action(); after(value);
      setStep("Normalizing evidence and saving it to this project…"); setProgress(82);
      await saveResearchSource(source, queued ? "in_progress" : "complete");
      await onChanged(); setProgress(100); setMessage(queued ? `${name} was submitted. Protein Lab is checking the remote queue automatically.` : `${name} completed and its evidence was saved.`);
    } catch (reason) { setMessage(errorText(reason)); }
    finally { setRunning(""); setStep(""); }
  }

  function runUniProt() { return perform("UniProt sequence matching", () => proteinLabsApi.uniprot(bundle.protein.id), (value) => setUniprot((value as { matches: JsonObject[] }).matches), "UniProt"); }
  function runBlast() { return perform("NCBI protein BLAST", () => proteinLabsApi.blast(bundle.protein.id), (value) => setBlastJobs((jobs) => [value as JsonObject, ...jobs.filter((job) => job.rid !== (value as JsonObject).rid)]), "NCBI BLAST", true); }
  function runPdb() { return perform("RCSB PDB sequence search", () => proteinLabsApi.pdb(bundle.protein.id), (value) => setPdb((value as { matches: JsonObject[] }).matches), "PDB"); }
  function manualSearch() { if (!query.trim()) return; return perform("UniProt text search", () => proteinLabsApi.searchUniProt(bundle.protein.id, query.trim()), (value) => setUniprot((value as { matches: JsonObject[] }).matches), "UniProt"); }
  function fetchAccession() { if (!accession.trim()) return; return perform("UniProt accession lookup", () => proteinLabsApi.fetchUniProt(bundle.protein.id, accession.trim().toUpperCase()), (value) => setUniprot((items) => [((value as { match: JsonObject }).match), ...items]), "UniProt"); }
  async function pollNow(rid: string) { setMessage(`Checking BLAST job ${rid}…`); try { const value = await proteinLabsApi.pollBlast(rid); setBlastJobs((jobs) => jobs.map((job) => job.rid === rid ? value : job)); if (terminal(String(value.status))) await onChanged(); setMessage(String(value.stage ?? value.status)); } catch (reason) { setMessage(errorText(reason)); } }
  async function terminate(rid: string) { try { const value = await proteinLabsApi.cancelBlast(rid); setBlastJobs((jobs) => jobs.map((job) => job.rid === rid ? value : job)); await onChanged(); setMessage(`BLAST job ${rid} was terminated locally.`); } catch (reason) { setMessage(errorText(reason)); } }

  return <div className="research-workspace">
    <header><div><span className="eyebrow">ONE-CLICK DATABASE RESEARCH</span><h2>Sequence, structure, PTM, and condition evidence</h2><p>Run each search directly from the entered sequence. Only these remote searches require an internet connection; normalized records remain attached to the local project.</p></div></header>
    {(running || activeJobs.length > 0) && <section className="research-progress"><LoaderCircle className="spin"/><span><strong>{running ? "Search in progress" : `${activeJobs.length} BLAST search${activeJobs.length === 1 ? "" : "es"} in progress`}</strong><small>{running ? step : String(activeJobs[0].stage ?? "Waiting in the remote queue; Protein Lab is checking automatically.")}</small></span><Progress value={running ? progress : undefined}/><em>{running ? `${progress}% of local submission steps complete` : "NCBI/EMBL-EBI does not report a numeric queue percentage."}</em></section>}
    <section className="research-actions"><ResearchAction icon={Dna} title="UniProt sequence match" detail="Matches the sequence directly, then saves PTMs, maturation features, topology, cellular location, and cofactors." count={uniprot.length} busy={Boolean(running)} active={running.startsWith("UniProt")} onRun={() => void runUniProt()} label="Find UniProt matches"/><ResearchAction icon={Search} title="NCBI protein BLAST" detail="Searches Swiss-Prot, follows the queue, imports alignment metrics, and enriches hits with UniProt evidence." count={blastJobs.length} busy={Boolean(running) || activeJobs.length > 0} active={running.startsWith("NCBI")} onRun={() => void runBlast()} label="Run protein BLAST"/><ResearchAction icon={Atom} title="PDB structures & conditions" detail="Finds experimental structures and evidence-linked crystallization and purification conditions." count={pdb.length} busy={Boolean(running)} active={running.startsWith("RCSB")} onRun={() => void runPdb()} label="Find PDB structures"/></section>
    <section className="manual-research"><label>Optional UniProt text query<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. hemoglobin beta reviewed:true"/></label><Button variant="outline" disabled={Boolean(running) || !query.trim()} onClick={() => void manualSearch()}><Search/> Search</Button><label>Optional accession<input value={accession} onChange={(event) => setAccession(event.target.value.toUpperCase())} placeholder="e.g. P02067"/></label><Button variant="outline" disabled={Boolean(running) || !accession.trim()} onClick={() => void fetchAccession()}><Database/> Fetch</Button></section>
    {message && <div className={`research-message ${/failed|error|unavailable|timed out/i.test(message) ? "error" : ""}`}>{/failed|error|unavailable|timed out/i.test(message) ? <CircleAlert/> : <CircleCheck/>}{message}</div>}
    <section className="research-results">
      <ResultSection title="NCBI BLAST jobs" count={blastJobs.length}>{blastJobs.length ? blastJobs.map((job) => <BlastCard key={String(job.rid)} job={job} onPoll={pollNow} onTerminate={terminate}/>) : <Empty text="No BLAST search has been submitted for this sequence."/>}</ResultSection>
      <ResultSection title="UniProt matches and PTMs" count={uniprot.length}>{uniprot.length ? uniprot.map((match, index) => <UniProtCard key={`${String(match.accession)}-${index}`} match={match}/>) : <Empty text="No UniProt matches have been saved yet."/>}</ResultSection>
      <ResultSection title="PDB structures and conditions" count={pdb.length}>{pdb.length > 0 && <p className="pdb-metrics-legend"><strong>Identity</strong> — identical residues. <strong>Similarity</strong> — identical or chemically similar (BLOSUM62). Both are measured over the aligned region; <strong>coverage</strong> is how much of your sequence that region spans.</p>}{pdb.length ? pdb.map((record, index) => <PdbCard key={`${String(record.pdbId)}-${index}`} record={record}/>) : <Empty text="No matching PDB structures have been saved yet."/>}</ResultSection>
    </section>
  </div>;
}

function ResearchAction({ icon: Icon, title, detail, count, busy, active, onRun, label }: { icon: typeof Dna; title: string; detail: string; count: number; busy: boolean; active: boolean; onRun: () => void; label: string }) { return <article><span className="research-action-icon"><Icon/></span><div><h3>{title}</h3><p>{detail}</p><small>{count} saved result{count === 1 ? "" : "s"}</small></div><Button disabled={busy} onClick={onRun}>{active ? <LoaderCircle className="spin"/> : <Play/>}{label}</Button></article>; }
function ResultSection({ title, count, children }: { title: string; count: number; children: React.ReactNode }) { return <section><header><h3>{title}</h3><span>{count}</span></header><div>{children}</div></section>; }
function Empty({ text }: { text: string }) { return <div className="research-empty"><Database/><span>{text}</span></div>; }
function BlastCard({ job, onPoll, onTerminate }: { job: JsonObject; onPoll: (rid: string) => Promise<void>; onTerminate: (rid: string) => Promise<void> }) { const rid = String(job.rid ?? ""); const status = String(job.status ?? "unknown"); const results = objects(job.results); const parameters = object(job.parameters); const provider = String(parameters.provider ?? "").includes("ebi") ? " via EMBL-EBI" : ""; return <article className={`research-result-card ${status}`}><span>{status === "complete" ? <CircleCheck/> : terminal(status) ? <CircleAlert/> : <LoaderCircle className="spin"/>}</span><div><strong>{String(parameters.purpose) === "uniprot" ? "UniProt similarity search" : "Protein BLAST"}{provider} · {rid}</strong><small>{status.toUpperCase()} · {results.length} hits</small><p>{String(job.stage ?? "Checking job status")}</p>{!terminal(status) && <Progress value={typeof job.progress === "number" ? Number(job.progress) * 100 : undefined}/>} {results.slice(0, 5).map((hit, index) => <em key={index}>{String(hit.uniprotAccession ?? hit.accession ?? "Hit")} · {percent(hit.identity)} identity · {percent(hit.queryCoverage)} coverage · E {String(hit.evalue ?? "—")}</em>)}</div>{!terminal(status) && <aside><Button size="sm" variant="outline" onClick={() => void onPoll(rid)}><RefreshCw/> Check now</Button><Button size="sm" variant="ghost" onClick={() => void onTerminate(rid)}><StopCircle/> Terminate</Button></aside>}</article>; }
function UniProtCard({ match }: { match: JsonObject }) { const record = Object.keys(object(match.record)).length ? object(match.record) : match; const organism = object(record.organism); const ptms = objects(record.postTranslationalModifications); const topology = objects(record.transmembraneRegions); const disorder = objects(record.disorderedRegions); const cofactors = objects(record.cofactors); return <article className="research-result-card"><span><Dna/></span><div><strong>{String(record.accession ?? match.accession ?? "UniProt")} · {String(record.proteinName ?? record.uniProtkbId ?? record.name ?? "")}</strong><small>{String(organism.scientificName ?? "Unknown organism")} · {percent(match.identity)} identity · {percent(match.queryCoverage)} coverage · {record.reviewed === true ? "reviewed" : "unreviewed"}</small><div className="evidence-tags"><b>{ptms.length} PTM/maturation</b><b>{topology.length} transmembrane</b><b>{disorder.length} disorder</b><b>{cofactors.length} cofactor</b></div>{ptms.slice(0, 6).map((ptm, index) => { const location = object(ptm.location); return <em key={index}>{String(ptm.type)}: {String(ptm.description ?? "")} ({String(location.start ?? "?")}–{String(location.end ?? "?")})</em>; })}</div>{Boolean(record.accession) && <a href={`https://www.uniprot.org/uniprotkb/${String(record.accession)}`} target="_blank" rel="noreferrer"><ExternalLink/></a>}</article>; }
function PdbCard({ record }: { record: JsonObject }) { const crystal = object(record.crystallizationConditions), purification = object(record.purificationConditions), growth = objects(crystal.crystalGrowth), purificationEvidence = objects(purification.evidence); const resolution = Array.isArray(record.resolutionAngstrom) ? record.resolutionAngstrom.join(", ") : String(record.resolutionAngstrom ?? ""); return <article className="research-result-card"><span><Atom/></span><div><strong>{String(record.pdbId ?? "PDB")} · {String(record.entityDescription ?? record.title ?? "")}</strong><small>{(Array.isArray(record.experimentalMethods) ? record.experimentalMethods : []).join(", ")}{resolution ? ` · ${resolution} Å` : ""}</small><PdbSimilarity record={record}/>{growth.length ? <em>Crystallization: {summary(growth[0])}</em> : <em>Crystallization conditions: not reported in the deposition.</em>}{purification.status === "reported" ? purificationEvidence.slice(0, 3).map((item, index) => <em key={index}>Purification: {String(item.reportedText ?? summary(item))}</em>) : <em>Purification conditions: not reported in a standardized PDB field.</em>}</div>{Boolean(record.pdbId) && <a href={`https://www.rcsb.org/structure/${String(record.pdbId)}`} target="_blank" rel="noreferrer"><ExternalLink/></a>}</article>; }

function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function objects(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }
function terminal(status: string) { return ["complete", "failed", "canceled", "unknown"].includes(status); }
/** How close a structure's sequence is to the user's: identity, similarity and
 *  how much of the query the alignment spans. Matches saved before these were
 *  calculated say so instead of showing a misleading 0%. */
function PdbSimilarity({ record }: { record: JsonObject }) {
  const comparison = object(record.comparison);
  const identity = Number(record.identity), similarity = Number(record.similarity);
  if (!Number.isFinite(identity) && !Number.isFinite(similarity)) return <span className="pdb-metrics pending">Identity and similarity not calculated for this saved match — run the PDB search again to compare it with your sequence.</span>;
  const coverage = Number(comparison.queryCoverage);
  // The PDB chain length shows when your protein is only part of it (a fusion or complex construct).
  const range = comparison.queryStart ? `aa ${String(comparison.queryStart)}–${String(comparison.queryEnd)} of ${String(comparison.queryLength)} · PDB chain ${String(comparison.targetLength)} aa` : "";
  return <span className="pdb-metrics">
    <span><b>{percent(record.identity)}</b><small>identity</small></span>
    <span><b>{percent(record.similarity)}</b><small>similarity</small></span>
    <span><b>{Number.isFinite(coverage) ? percent(coverage) : "—"}</b><small>coverage{range ? ` · ${range}` : ""}</small></span>
  </span>;
}
function percent(value: unknown) { const number = Number(value); return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "—"; }
function summary(value: JsonObject) { return Object.entries(value).filter(([, item]) => item !== null && item !== "").map(([key, item]) => `${key}: ${String(item)}`).join(" · "); }
function errorText(value: unknown) { return value instanceof Error ? value.message : String(value); }
