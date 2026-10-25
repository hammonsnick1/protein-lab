"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { ArrowDown, ArrowUp, ArrowUpDown, Atom, CircleAlert, CircleCheck, Database, Dna, ExternalLink, History, ListChecks, LoaderCircle, Play, RefreshCw, Rows3, Search, StopCircle } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { ensureProjectJob, proteinLabsApi } from "@/lib/protein-labs-api";
import { BLAST_STEPS, blastStepIndex, coverageTier, evalueTier, formatEvalue, identityTier, isTerminalStatus, normalizeHits, sortHits } from "@/lib/blast-alignment";
import type { SortDirection, SortKey, Tier } from "@/lib/blast-alignment";
import { BlastResultsWindow } from "@/components/protein-labs/blast-results-window";
import type { BlastWindowTab } from "@/components/protein-labs/blast-results-window";
import { ResearchProgress } from "@/components/protein-labs/research-progress";

type LocalRun = { title: string; steps: readonly string[]; active: number; detail: string; startedAt: number; blast: boolean };

export function SequenceResearchJob({ bundle, onChanged }: { bundle: ProteinBundle; onChanged: () => Promise<void> }) {
  const [blastJobs, setBlastJobs] = useState<JsonObject[]>(bundle.blastJobs);
  const [uniprot, setUniprot] = useState<JsonObject[]>(bundle.uniprotMatches);
  const [pdb, setPdb] = useState<JsonObject[]>(bundle.pdbMatches);
  const [local, setLocal] = useState<LocalRun | null>(null);
  const [message, setMessage] = useState<{ text: string; error: boolean } | null>(null);
  const [query, setQuery] = useState("");
  const [accession, setAccession] = useState("");
  const [selectedRid, setSelectedRid] = useState("");
  const [windowState, setWindowState] = useState<{ open: boolean; tab: BlastWindowTab; focus: string }>({ open: false, tab: "pairwise", focus: "" });
  const sequence = bundle.protein.sequence.replace(/\s+/g, "").toUpperCase();
  const busy = Boolean(local);
  const activeJobs = useMemo(() => blastJobs.filter((job) => !isTerminalStatus(String(job.status ?? ""))), [blastJobs]);
  const activeKey = activeJobs.map((job) => String(job.rid)).join(",");
  const onChangedRef = useRef(onChanged);
  useEffect(() => { onChangedRef.current = onChanged; }, [onChanged]);

  // Follow queued remote jobs until they finish. Keyed on the job ids, so a
  // status update does not restart the timer; the first check comes quickly.
  useEffect(() => {
    if (!activeKey) return;
    const rids = activeKey.split(",");
    let stopped = false;
    const poll = async () => {
      const values = await Promise.all(rids.map(async (rid) => {
        try { return await proteinLabsApi.pollBlast(rid); }
        catch (reason) { return { rid, pollError: errorText(reason) } as JsonObject; }
      }));
      if (stopped) return;
      setBlastJobs((current) => current.map((job) => {
        const value = values.find((item) => item.rid === job.rid);
        if (!value) return job;
        return value.pollError ? { ...job, pollError: value.pollError } : { ...value, polledAt: Date.now() };
      }));
      const finished = values.filter((value) => !value.pollError && isTerminalStatus(String(value.status ?? "")));
      if (!finished.length) return;
      for (const job of finished) {
        const notice = finishedNotice(job);
        if (!notice) continue;
        if (!notice.error) setSelectedRid(String(job.rid));
        setMessage(notice);
      }
      await onChangedRef.current();
      const latest = await proteinLabsApi.getProtein(bundle.protein.id);
      if (!stopped) setUniprot(latest.uniprotMatches);
    };
    const first = window.setTimeout(() => void poll(), 1200);
    const timer = window.setInterval(() => void poll(), 5000);
    return () => { stopped = true; window.clearTimeout(first); window.clearInterval(timer); };
  }, [activeKey, bundle.protein.id]);

  function announceFinished(job: JsonObject) {
    const notice = finishedNotice(job);
    if (!notice) return;
    if (!notice.error) setSelectedRid(String(job.rid));
    setMessage(notice);
  }

  async function saveResearchSource(source: string, status: "in_progress" | "complete" = "complete") {
    const latest = await proteinLabsApi.getProtein(bundle.protein.id);
    const existing = latest.projectJobs.find((job) => job.appType === "database-research");
    const sources = Array.from(new Set([...(Array.isArray(existing?.config.savedSources) ? existing.config.savedSources.map(String) : []), source]));
    await ensureProjectJob(bundle.protein.id, latest.projectJobs, "database-research", "Sequence research", { savedSources: sources, updatedAt: new Date().toISOString(), savedByUser: true }, status);
  }

  /** Runs one search with honest steps: the remote call, then saving. A BLAST
   *  submission hands over to the queued-job panel once NCBI accepts it. */
  async function perform(title: string, service: string, action: () => Promise<unknown>, after: (value: unknown) => void, source: string, blast = false) {
    if (!sequence) { setMessage({ text: "This project has no amino-acid sequence yet. Add it in the Sequence job, then run the search.", error: true }); return; }
    const steps = blast ? BLAST_STEPS : [`Contacting ${service}`, "Saving evidence", "Done"];
    const startedAt = Date.now();
    setMessage(null);
    setLocal({ title, steps, active: 0, detail: blast ? `Sending the ${sequence.length}-residue sequence to ${service}…` : `Searching ${service} with the ${sequence.length}-residue sequence…`, startedAt, blast });
    try {
      const value = await action();
      after(value);
      setLocal({ title, steps, active: blast ? 0 : 1, detail: "Saving the evidence to this project…", startedAt, blast });
      await saveResearchSource(source, blast ? "in_progress" : "complete");
      await onChanged();
      setMessage({ text: blast ? `${title} was accepted. Protein Lab checks the remote queue every few seconds.` : `${title} finished and its evidence was saved.`, error: false });
    } catch (reason) { setMessage({ text: `${title} failed: ${errorText(reason)}`, error: true }); }
    finally { setLocal(null); }
  }

  function runUniProt() { return perform("UniProt sequence match", "UniProt", () => proteinLabsApi.uniprot(bundle.protein.id), (value) => setUniprot((value as { matches: JsonObject[] }).matches), "UniProt"); }
  function runBlast() { return perform("NCBI protein BLAST", "NCBI", () => proteinLabsApi.blast(bundle.protein.id), (value) => { const job = value as JsonObject; setBlastJobs((jobs) => [job, ...jobs.filter((item) => item.rid !== job.rid)]); }, "NCBI BLAST", true); }
  function runPdb() { return perform("RCSB PDB sequence search", "RCSB PDB", () => proteinLabsApi.pdb(bundle.protein.id), (value) => setPdb((value as { matches: JsonObject[] }).matches), "PDB"); }
  function manualSearch() { if (!query.trim()) return; return perform("UniProt text search", "UniProt", () => proteinLabsApi.searchUniProt(bundle.protein.id, query.trim()), (value) => setUniprot((value as { matches: JsonObject[] }).matches), "UniProt"); }
  function fetchAccession() { if (!accession.trim()) return; return perform("UniProt accession lookup", "UniProt", () => proteinLabsApi.fetchUniProt(bundle.protein.id, accession.trim().toUpperCase()), (value) => setUniprot((items) => [((value as { match: JsonObject }).match), ...items]), "UniProt"); }
  async function pollNow(rid: string) {
    try {
      const value = await proteinLabsApi.pollBlast(rid);
      setBlastJobs((jobs) => jobs.map((job) => job.rid === rid ? { ...value, polledAt: Date.now() } : job));
      if (isTerminalStatus(String(value.status))) { announceFinished(value); await onChanged(); }
    } catch (reason) { setMessage({ text: `Could not check BLAST job ${rid}: ${errorText(reason)}`, error: true }); }
  }
  async function terminate(rid: string) {
    try {
      const value = await proteinLabsApi.cancelBlast(rid);
      setBlastJobs((jobs) => jobs.map((job) => job.rid === rid ? value : job));
      await onChanged();
      setMessage({ text: `BLAST job ${rid} was stopped. Its remote search may still finish at NCBI, but Protein Lab no longer follows it.`, error: false });
    } catch (reason) { setMessage({ text: `Could not stop BLAST job ${rid}: ${errorText(reason)}`, error: true }); }
  }

  // The hit table shows one run: the one picked, else the newest with results.
  const blastRuns = useMemo(() => [...blastJobs].sort((a, b) => String(b.submittedAt ?? "").localeCompare(String(a.submittedAt ?? ""))), [blastJobs]);
  const shownJob = blastRuns.find((job) => String(job.rid) === selectedRid) ?? blastRuns.find((job) => Array.isArray(job.results) && job.results.length) ?? blastRuns[0];
  const hits = useMemo(() => normalizeHits(shownJob?.results), [shownJob]);
  const blastQuery = String(shownJob?.querySequence ?? sequence).replace(/\s+/g, "").toUpperCase();
  const openWindow = (tab: BlastWindowTab, focus = "") => setWindowState({ open: true, tab, focus });

  return <div className="research-workspace">
    <header><div><span className="eyebrow">ONE-CLICK DATABASE RESEARCH</span><h2>Sequence, structure, PTM, and condition evidence</h2><p>Run each search directly from the entered sequence. Only these remote searches need an internet connection; the results stay attached to this project on this computer.</p></div></header>
    <QueryCard bundle={bundle} sequence={sequence} counts={{ blast: hits.length, uniprot: uniprot.length, pdb: pdb.length }}/>
    <section className="research-actions">
      <ResearchAction icon={Dna} title="UniProt sequence match" detail="Matches the sequence directly, then saves PTMs, maturation features, topology, cellular location, and cofactors." count={uniprot.length} busy={busy || !sequence} active={local?.title === "UniProt sequence match"} onRun={() => void runUniProt()} label="Find UniProt matches"/>
      <ResearchAction icon={Search} title="NCBI protein BLAST" detail="Searches Swiss-Prot, follows the queue, saves every alignment, and enriches hits with UniProt evidence." count={blastJobs.length} countLabel="run" busy={busy || activeJobs.length > 0 || !sequence} active={Boolean(local?.blast) || activeJobs.length > 0} onRun={() => void runBlast()} label={activeJobs.length ? "BLAST running…" : "Run protein BLAST"}/>
      <ResearchAction icon={Atom} title="PDB structures & conditions" detail="Finds experimental structures and evidence-linked crystallization and purification conditions." count={pdb.length} busy={busy || !sequence} active={local?.title === "RCSB PDB sequence search"} onRun={() => void runPdb()} label="Find PDB structures"/>
    </section>
    <section className="manual-research"><label>Optional UniProt text query<input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="e.g. hemoglobin beta reviewed:true" onKeyDown={(event) => { if (event.key === "Enter") void manualSearch(); }}/></label><Button variant="outline" disabled={busy || !query.trim()} onClick={() => void manualSearch()}><Search/> Search</Button><label>Optional accession<input value={accession} onChange={(event) => setAccession(event.target.value.toUpperCase())} placeholder="e.g. P02067" onKeyDown={(event) => { if (event.key === "Enter") void fetchAccession(); }}/></label><Button variant="outline" disabled={busy || !accession.trim()} onClick={() => void fetchAccession()}><Database/> Fetch</Button></section>
    {local
      ? <ResearchProgress title={local.title} steps={local.steps} active={local.active} detail={local.detail} startedAt={local.startedAt} motif={sequence}/>
      : activeJobs.map((job) => <RemoteJobProgress key={String(job.rid)} job={job} motif={sequence} onPoll={pollNow} onTerminate={terminate}/>)}
    {message && <div className={`research-message${message.error ? " error" : ""}`} role={message.error ? "alert" : "status"}>{message.error ? <CircleAlert/> : <CircleCheck/>}<span>{message.text}</span><button type="button" onClick={() => setMessage(null)} aria-label="Dismiss message">×</button></div>}

    <section className="research-section research-blast">
      <header>
        <span className="research-section-icon"><Search/></span>
        <div><h3>BLAST hits</h3><p>{shownJob ? runLabel(shownJob) : "Similar sequences from Swiss-Prot appear here."}</p></div>
        {blastRuns.length > 1 && <label className="research-run-picker">Run<select value={String(shownJob?.rid ?? "")} onChange={(event) => setSelectedRid(event.target.value)}>{blastRuns.map((job) => <option key={String(job.rid)} value={String(job.rid)}>{runLabel(job)}</option>)}</select></label>}
        <div className="research-section-actions">
          <Button variant="outline" disabled={!hits.length} onClick={() => openWindow("pairwise")}><Rows3/> View BLAST results</Button>
          <Button disabled={!hits.length} onClick={() => openWindow("msa")}><ListChecks/> Multiple sequence alignment</Button>
        </div>
      </header>
      <BlastHitsBody job={shownJob} hits={hits} running={activeJobs.length > 0 || Boolean(local?.blast)} onRun={() => void runBlast()} canRun={!busy && !activeJobs.length && Boolean(sequence)} onAlignment={(id) => openWindow("pairwise", id)}/>
      {blastRuns.length > 0 && <details className="research-run-history"><summary><History/> Run history <span>{blastRuns.length}</span></summary>{blastRuns.map((job) => <BlastRunRow key={String(job.rid)} job={job} selected={job === shownJob} onShow={() => setSelectedRid(String(job.rid))} onPoll={pollNow} onTerminate={terminate}/>)}</details>}
    </section>

    <section className="research-results">
      <ResultSection icon={Dna} title="UniProt matches and PTMs" count={uniprot.length}>{uniprot.length ? uniprot.map((match, index) => <UniProtCard key={`${String(match.accession)}-${index}`} match={match} featured={index === 0}/>) : <Empty text="No UniProt matches have been saved yet. Run a UniProt sequence match, or fetch an accession you already know."/>}</ResultSection>
      <ResultSection icon={Atom} title="PDB structures and conditions" count={pdb.length}>{pdb.length > 0 && <p className="pdb-metrics-legend"><strong>Identity</strong> — identical residues. <strong>Similarity</strong> — identical or chemically similar (BLOSUM62). Both are measured over the aligned region; <strong>coverage</strong> is how much of your sequence that region spans.</p>}{pdb.length ? pdb.map((record, index) => <PdbCard key={`${String(record.pdbId)}-${index}`} record={record}/>) : <Empty text="No matching PDB structures have been saved yet."/>}</ResultSection>
    </section>

    <BlastResultsWindow open={windowState.open} onOpenChange={(open) => setWindowState((state) => ({ ...state, open }))} tab={windowState.tab} onTabChange={(tab) => setWindowState((state) => ({ ...state, tab }))} focusHitId={windowState.focus} hits={hits} query={blastQuery} proteinName={bundle.protein.name || "Protein"} runLabel={shownJob ? `RID ${String(shownJob.rid ?? "")} · ${when(shownJob.submittedAt)}` : ""}/>
  </div>;
}

function QueryCard({ bundle, sequence, counts }: { bundle: ProteinBundle; sequence: string; counts: { blast: number; uniprot: number; pdb: number } }) {
  const { protein } = bundle;
  const lines = useMemo(() => {
    const rows: { start: number; groups: string[] }[] = [];
    for (let start = 0; start < sequence.length; start += 60) rows.push({ start: start + 1, groups: (sequence.slice(start, start + 60).match(/.{1,10}/g) ?? []) });
    return rows;
  }, [sequence]);
  return <section className="research-query">
    <div className="research-query-id">
      <span className="eyebrow">QUERY</span>
      <strong>{protein.name || "Unnamed protein"}</strong>
      <small>{[protein.organism, protein.geneName && `gene ${protein.geneName}`].filter(Boolean).join(" · ") || "Organism not set"}</small>
      <dl>
        <div><dt>Length</dt><dd>{sequence.length ? `${sequence.length} aa` : "—"}</dd></div>
        <div><dt>BLAST hits</dt><dd>{counts.blast}</dd></div>
        <div><dt>UniProt</dt><dd>{counts.uniprot}</dd></div>
        <div><dt>PDB</dt><dd>{counts.pdb}</dd></div>
      </dl>
    </div>
    {sequence
      ? <pre className="research-query-seq" aria-label={`Query sequence, ${sequence.length} residues`}>{lines.map((line) => <span key={line.start}><b>{String(line.start).padStart(String(sequence.length).length)}</b>{line.groups.join(" ")}{"\n"}</span>)}</pre>
      : <div className="research-query-missing"><CircleAlert/><span>This project has no amino-acid sequence yet. Add it in the Sequence job before running searches.</span></div>}
  </section>;
}

function RemoteJobProgress({ job, motif, onPoll, onTerminate }: { job: JsonObject; motif: string; onPoll: (rid: string) => Promise<void>; onTerminate: (rid: string) => Promise<void> }) {
  const rid = String(job.rid ?? "");
  const parameters = object(job.parameters);
  const ebi = String(parameters.provider ?? "").includes("ebi");
  const steps = BLAST_STEPS.map((step) => step === "Queued" ? `Queued at ${ebi ? "EMBL-EBI" : "NCBI"}` : step);
  const status = String(job.status ?? "");
  const submitted = Date.parse(String(job.submittedAt ?? ""));
  // A job saved without a submit time counts from when this panel first saw it.
  const [seenAt] = useState(() => Date.now());
  const pollError = typeof job.pollError === "string" ? job.pollError : "";
  const title = String(parameters.purpose) === "uniprot" ? "UniProt similarity search" : "NCBI protein BLAST";
  const detail = pollError ? `Status check failed (${pollError}). Retrying automatically.` : String(job.stage ?? "Waiting in the remote queue");
  return <ResearchProgress title={`${title} · ${rid}`} steps={steps} active={blastStepIndex(String(job.stageId ?? status), String(job.stage ?? ""))} detail={detail} startedAt={Number.isFinite(submitted) ? submitted : seenAt} motif={motif} error={Boolean(pollError)} note={`${ebi ? "EMBL-EBI" : "NCBI"} does not report how far through the queue a job is, so the bar moves by stage. Protein Lab checks every 5 seconds.`}>
    <Button size="sm" variant="outline" onClick={() => void onPoll(rid)}><RefreshCw/> Check now</Button>
    <Button size="sm" variant="ghost" onClick={() => void onTerminate(rid)}><StopCircle/> Stop</Button>
  </ResearchProgress>;
}

const SORTABLE: { key: SortKey; label: string; numeric?: boolean }[] = [
  { key: "rank", label: "#", numeric: true },
  { key: "accession", label: "Accession" },
  { key: "organism", label: "Protein · organism" },
  { key: "identity", label: "Identity", numeric: true },
  { key: "coverage", label: "Coverage", numeric: true },
  { key: "evalue", label: "E-value", numeric: true },
  { key: "bitScore", label: "Bits", numeric: true },
  { key: "length", label: "Length", numeric: true },
];

function BlastHitsBody({ job, hits, running, canRun, onRun, onAlignment }: { job: JsonObject | undefined; hits: ReturnType<typeof normalizeHits>; running: boolean; canRun: boolean; onRun: () => void; onAlignment: (id: string) => void }) {
  const [sort, setSort] = useState<{ key: SortKey; direction: SortDirection }>({ key: "rank", direction: "asc" });
  const sorted = useMemo(() => sortHits(hits, sort.key, sort.direction), [hits, sort]);
  const status = String(job?.status ?? "");
  if (!job) return <Empty text="No BLAST search yet. Run protein BLAST to find similar sequences in Swiss-Prot and compare them residue by residue."/>;
  if (!hits.length && !isTerminalStatus(status)) return <div className="research-empty"><LoaderCircle className="spin"/><span>{running ? "BLAST is running. The hits appear here as soon as the remote search finishes." : "This run is still queued."}</span></div>;
  if (!hits.length && (status === "failed" || status === "unknown")) return <div className="research-empty error"><CircleAlert/><span>This BLAST run failed: {String(job.error ?? job.stage ?? "the remote service reported an error")}.</span>{canRun && <Button size="sm" variant="outline" onClick={onRun}><Play/> Run again</Button>}</div>;
  if (!hits.length && status === "canceled") return <div className="research-empty"><StopCircle/><span>This BLAST run was stopped before it returned hits.</span>{canRun && <Button size="sm" variant="outline" onClick={onRun}><Play/> Run again</Button>}</div>;
  if (!hits.length) return <Empty text="BLAST finished but found no similar sequences in Swiss-Prot."/>;
  const toggle = (key: SortKey, numeric?: boolean) => setSort((current) => current.key === key ? { key, direction: current.direction === "asc" ? "desc" : "asc" } : { key, direction: numeric && key !== "rank" && key !== "evalue" ? "desc" : "asc" });
  return <div className="blast-hit-table-wrap">
    <table className="blast-hit-table">
      <thead><tr>{SORTABLE.map((column) => <th key={column.key} aria-sort={sort.key === column.key ? (sort.direction === "asc" ? "ascending" : "descending") : "none"} className={column.numeric ? "numeric" : ""}>
        <button type="button" onClick={() => toggle(column.key, column.numeric)}>{column.label}{sort.key === column.key ? (sort.direction === "asc" ? <ArrowUp/> : <ArrowDown/>) : <ArrowUpDown className="idle"/>}</button>
      </th>)}<th><span className="sr-only">Alignment</span></th></tr></thead>
      <tbody>{sorted.map((hit) => <tr key={hit.id}>
        <td className="numeric">{hit.rank}</td>
        <td className="accession">{hit.uniprotAccession ? <a href={`https://www.uniprot.org/uniprotkb/${hit.uniprotAccession}`} target="_blank" rel="noreferrer">{hit.accession}<ExternalLink/></a> : hit.accession}</td>
        <td className="protein"><strong title={hit.description}>{hit.description || "—"}</strong><small>{hit.organism}</small></td>
        <td className="numeric"><Chip value={percent(hit.identity)} tier={identityTier(hit.identity)}/></td>
        <td className="numeric"><Chip value={percent(hit.coverage)} tier={coverageTier(hit.coverage)}/></td>
        <td className="numeric"><Chip value={formatEvalue(hit.evalue)} tier={evalueTier(hit.evalue)}/></td>
        <td className="numeric">{hit.bitScore === null ? "—" : hit.bitScore.toFixed(1)}</td>
        <td className="numeric">{hit.length ? `${hit.length} aa` : "—"}</td>
        <td><Button size="sm" variant="ghost" onClick={() => onAlignment(hit.id)} aria-label={`Show the alignment with ${hit.accession}`}><Rows3/> Alignment</Button></td>
      </tr>)}</tbody>
    </table>
  </div>;
}

function Chip({ value, tier }: { value: string; tier: Tier }) { return <span className={`hit-chip ${tier}`}><b>{value}</b></span>; }

function BlastRunRow({ job, selected, onShow, onPoll, onTerminate }: { job: JsonObject; selected: boolean; onShow: () => void; onPoll: (rid: string) => Promise<void>; onTerminate: (rid: string) => Promise<void> }) {
  const rid = String(job.rid ?? ""), status = String(job.status ?? "unknown");
  const results = Array.isArray(job.results) ? job.results.length : 0;
  return <article className={`research-run-row ${status}${selected ? " selected" : ""}`}>
    <span>{status === "complete" ? <CircleCheck/> : isTerminalStatus(status) ? <CircleAlert/> : <LoaderCircle className="spin"/>}</span>
    <div><strong>{rid}</strong><small>{when(job.submittedAt)} · {status} · {results} hit{results === 1 ? "" : "s"}{job.error ? ` · ${String(job.error)}` : ""}</small></div>
    <aside>
      {results > 0 && !selected && <Button size="sm" variant="outline" onClick={onShow}>Show hits</Button>}
      {!isTerminalStatus(status) && <><Button size="sm" variant="outline" onClick={() => void onPoll(rid)}><RefreshCw/> Check now</Button><Button size="sm" variant="ghost" onClick={() => void onTerminate(rid)}><StopCircle/> Stop</Button></>}
    </aside>
  </article>;
}

function ResearchAction({ icon: Icon, title, detail, count, countLabel = "saved result", busy, active, onRun, label }: { icon: typeof Dna; title: string; detail: string; count: number; countLabel?: string; busy: boolean; active: boolean; onRun: () => void; label: string }) { return <article className={active ? "active" : ""}><span className="research-action-icon"><Icon/></span><div><h3>{title}</h3><p>{detail}</p><small>{count} {countLabel}{count === 1 ? "" : "s"}</small></div><Button disabled={busy} onClick={onRun}>{active ? <LoaderCircle className="spin"/> : <Play/>}{label}</Button></article>; }
function ResultSection({ icon: Icon, title, count, children }: { icon: typeof Dna; title: string; count: number; children: React.ReactNode }) { return <section><header><h3><Icon/>{title}</h3><span>{count}</span></header><div>{children}</div></section>; }
function Empty({ text }: { text: string }) { return <div className="research-empty"><Database/><span>{text}</span></div>; }
function UniProtCard({ match, featured }: { match: JsonObject; featured: boolean }) { const record = Object.keys(object(match.record)).length ? object(match.record) : match; const organism = object(record.organism); const ptms = objects(record.postTranslationalModifications); const topology = objects(record.transmembraneRegions); const disorder = objects(record.disorderedRegions); const cofactors = objects(record.cofactors); const identity = Number(match.identity), coverage = Number(match.queryCoverage); return <article className={`research-result-card${featured ? " featured" : ""}`}><span><Dna/></span><div>{featured && <span className="research-best-match">Best match</span>}<strong>{String(record.accession ?? match.accession ?? "UniProt")} · {String(record.proteinName ?? record.uniProtkbId ?? record.name ?? "")}</strong><small><i>{String(organism.scientificName ?? "Unknown organism")}</i> · {record.reviewed === true ? "reviewed (Swiss-Prot)" : "unreviewed (TrEMBL)"}</small><span className="research-chip-row">{Number.isFinite(identity) && <span className={`hit-chip ${identityTier(identity)}`}><b>{percent(identity)}</b> identity</span>}{Number.isFinite(coverage) && <span className={`hit-chip ${coverageTier(coverage)}`}><b>{percent(coverage)}</b> coverage</span>}</span><div className="evidence-tags"><b>{ptms.length} PTM/maturation</b><b>{topology.length} transmembrane</b><b>{disorder.length} disorder</b><b>{cofactors.length} cofactor</b></div>{ptms.slice(0, featured ? 8 : 3).map((ptm, index) => { const location = object(ptm.location); return <em key={index}>{String(ptm.type)}: {String(ptm.description ?? "")} ({String(location.start ?? "?")}–{String(location.end ?? "?")})</em>; })}</div>{Boolean(record.accession) && <a href={`https://www.uniprot.org/uniprotkb/${String(record.accession)}`} target="_blank" rel="noreferrer" aria-label={`Open ${String(record.accession)} at UniProt`}><ExternalLink/></a>}</article>; }
function PdbCard({ record }: { record: JsonObject }) { const crystal = object(record.crystallizationConditions), purification = object(record.purificationConditions), growth = objects(crystal.crystalGrowth), purificationEvidence = objects(purification.evidence); const resolution = Array.isArray(record.resolutionAngstrom) ? record.resolutionAngstrom.join(", ") : String(record.resolutionAngstrom ?? ""); return <article className="research-result-card"><span><Atom/></span><div><strong>{String(record.pdbId ?? "PDB")} · {String(record.entityDescription ?? record.title ?? "")}</strong><small>{(Array.isArray(record.experimentalMethods) ? record.experimentalMethods : []).join(", ")}{resolution ? ` · ${resolution} Å` : ""}</small><PdbSimilarity record={record}/>{growth.length ? <em>Crystallization: {summary(growth[0])}</em> : <em>Crystallization conditions: not reported in the deposition.</em>}{purification.status === "reported" ? purificationEvidence.slice(0, 3).map((item, index) => <em key={index}>Purification: {String(item.reportedText ?? summary(item))}</em>) : <em>Purification conditions: not reported in a standardized PDB field.</em>}</div>{Boolean(record.pdbId) && <a href={`https://www.rcsb.org/structure/${String(record.pdbId)}`} target="_blank" rel="noreferrer" aria-label={`Open ${String(record.pdbId)} at RCSB PDB`}><ExternalLink/></a>}</article>; }

function finishedNotice(job: JsonObject) {
  const status = String(job.status ?? "");
  const hits = Array.isArray(job.results) ? job.results.length : 0;
  if (status === "complete" || status === "done") return { text: `BLAST finished: ${hits} hit${hits === 1 ? "" : "s"} saved to this project.`, error: false };
  if (status === "failed" || status === "unknown") return { text: `BLAST job ${String(job.rid)} failed: ${String(job.error ?? job.stage ?? "the remote service reported an error")}.`, error: true };
  return null;
}
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function objects(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }
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
function percent(value: unknown) { if (value === null || value === undefined || value === "") return "—"; const number = Number(value); return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "—"; }
function summary(value: JsonObject) { return Object.entries(value).filter(([, item]) => item !== null && item !== "").map(([key, item]) => `${key}: ${String(item)}`).join(" · "); }
function errorText(value: unknown) { return value instanceof Error ? value.message : String(value); }
function when(value: unknown) { const time = Date.parse(String(value ?? "")); return Number.isFinite(time) ? new Date(time).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "time not recorded"; }
function runLabel(job: JsonObject) { const results = Array.isArray(job.results) ? job.results.length : 0; return `RID ${String(job.rid ?? "")} · ${when(job.submittedAt)} · ${String(job.status ?? "unknown")}${results ? ` · ${results} hits` : ""}`; }
