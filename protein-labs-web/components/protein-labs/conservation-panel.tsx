"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, Database, ExternalLink, ListChecks, LoaderCircle, Rows3, Shield, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { proteinLabsApi } from "@/lib/protein-labs-api";
import type { ConservationJob, ConservationJobSummary, ConservationResidue } from "@/lib/conservation";
import {
  TICK_HALF,
  clamp,
  conservedStretches,
  describeSource,
  formatCoverage,
  gradeColor,
  gradeInk,
  gradeLabel,
  gradeLegend,
  rulerPositions,
  stripColumnWidth,
  stripRows,
  summarizeConservation,
  tickStride,
} from "@/lib/conservation";

const ROW_HEIGHT = 38;
const ROW_GAP = 14;
const LABEL_HEIGHT = 15;
const LETTER_MIN_WIDTH = 11;

export type ConservationPanelProps = {
  proteinId: string;
  jobs: ConservationJobSummary[];
  selectedId: string;
  onSelect: (jobId: string) => void;
  loading: boolean;
  job: ConservationJob | null;
  error: string;
  busy: boolean;
  onImport: (gradesPath: string, msaPath: string) => Promise<void>;
  onDelete: (jobId: string) => Promise<void>;
};

/** The conservation section of Sequence research: grade strip, legend, detail. */
export function ConservationPanel({
  proteinId, jobs, selectedId, onSelect, loading, job, error, busy, onImport, onDelete,
}: ConservationPanelProps) {
  const summary = useMemo(() => summarizeConservation(job?.residues ?? []), [job]);
  const stretches = useMemo(() => conservedStretches(job?.residues ?? []), [job]);
  // The selection is held with the run it belongs to, so switching runs clears
  // it without an effect that would cascade a second render.
  const [selection, setSelection] = useState<{ jobId: string; position: number } | null>(null);
  const selectedPosition = selection && selection.jobId === job?.id ? selection.position : null;
  const selectPosition = useCallback(
    (position: number | null) => setSelection(position === null || !job ? null : { jobId: job.id, position }),
    [job],
  );
  const selected = job?.residues.find((residue) => residue.position === selectedPosition) ?? null;

  return <section className="research-section research-conservation">
    <header>
      <span className="research-section-icon"><Shield/></span>
      <div>
        <h3>Evolutionary conservation</h3>
        <p>{job ? `${describeSource(job)} · ${job.stage || "ConSurf"}` : "ConSurf grades each residue 1–9, from most variable to most conserved."}</p>
      </div>
      {jobs.length > 1 && <label className="research-run-picker">Run<select value={selectedId} onChange={(event) => onSelect(event.target.value)}>
        {jobs.map((item) => <option key={item.id} value={item.id}>{runLabel(item)}</option>)}
      </select></label>}
      {job && <div className="research-section-actions">
        {job.metadata.msa?.available && <MsaButton proteinId={proteinId} jobId={job.id} count={job.metadata.msa.sequenceCount}/>}
        {job.metadata.entryUrl && <a className="conservation-link" href={job.metadata.entryUrl} target="_blank" rel="noreferrer">Open in ConSurf-DB<ExternalLink/></a>}
        <Button size="sm" variant="ghost" disabled={busy} onClick={() => void onDelete(job.id)} aria-label="Delete this conservation run"><Trash2/> Delete run</Button>
      </div>}
    </header>

    {error && <div className="research-message error" role="alert"><CircleAlert/><span>{error}</span></div>}

    {loading
      ? <div className="research-empty"><LoaderCircle className="spin"/><span>Loading the conservation grades…</span></div>
      : !jobs.length
        ? <Empty text="No conservation analysis yet. Look up a pre-calculated ConSurf-DB entry, or prepare a ConSurf server submission and import the grades file it returns."/>
        : job?.status === "prepared"
          ? <PreparedGuide job={job} busy={busy} onImport={onImport}/>
          : !job || !job.residues.length
            ? <Empty text="This run has no grades saved. Import the ConSurf grades file to fill it in."/>
            : <>
              <ConservationStats job={job} summary={summary} stretches={stretches}/>
              <GradeStrip
                residues={job.residues}
                selectedPosition={selectedPosition}
                onSelectPosition={selectPosition}
              />
              <GradeLegend/>
              {selected
                ? <ResidueDetail residue={selected} onClear={() => selectPosition(null)}/>
                : <p className="conservation-hint">Select a residue in the strip to see its score, confidence interval and the residues seen at that position. Arrow keys move along the sequence.</p>}
              <ImportForm job={job} busy={busy} onImport={onImport} compact/>
            </>}
  </section>;
}

/** Summary chips. Every number is stated, never implied by the colours alone. */
function ConservationStats({ job, summary, stretches }: {
  job: ConservationJob;
  summary: ReturnType<typeof summarizeConservation>;
  stretches: ReturnType<typeof conservedStretches>;
}) {
  const match = job.metadata.sequenceMatch;
  const skipped = job.metadata.skippedRowCount ?? 0;
  return <div className="conservation-stats">
    <dl>
      <div><dt>Residues graded</dt><dd>{summary.residueCount}</dd></div>
      <div><dt>Mean grade</dt><dd>{summary.meanGrade === null ? "—" : summary.meanGrade.toFixed(2)}</dd></div>
      <div><dt>Grade 9 sites</dt><dd>{summary.highlyConserved.length}</dd></div>
      <div><dt>Insufficient data</dt><dd>{summary.insufficientDataCount}</dd></div>
      {summary.chains.length > 0 && <div><dt>PDB chain{summary.chains.length === 1 ? "" : "s"}</dt><dd>{summary.chains.join(", ")}</dd></div>}
      {job.metadata.msa?.available && <div><dt>Alignment</dt><dd>{job.metadata.msa.sequenceCount} sequences</dd></div>}
    </dl>
    <div className="conservation-distribution" role="img" aria-label={conservationDistributionLabel(summary)}>
      {summary.histogram.filter((bucket) => bucket.count > 0).map((bucket) => <span
        key={bucket.grade}
        style={{ background: gradeColor(bucket.grade), color: gradeInk(bucket.grade), flexGrow: bucket.count }}
        title={`${bucket.count} residue${bucket.count === 1 ? "" : "s"} at grade ${bucket.grade} (${gradeLabel(bucket.grade)})`}
      >{bucket.share >= 0.07 ? bucket.grade : ""}</span>)}
      {summary.insufficientDataCount > 0 && <span
        className="insufficient"
        style={{ flexGrow: summary.insufficientDataCount }}
        title={`${summary.insufficientDataCount} residue${summary.insufficientDataCount === 1 ? "" : "s"} with insufficient data`}
      >{summary.insufficientDataCount / Math.max(1, summary.residueCount) >= 0.07 ? "*" : ""}</span>}
    </div>
    <ul className="conservation-notes">
      {stretches.length > 0 && <li>Conserved stretches (grade 8+): {stretches.slice(0, 6).map((item) => `${item.start}–${item.end}`).join(", ")}{stretches.length > 6 ? ` and ${stretches.length - 6} more` : ""}.</li>}
      {match?.compared && match.identical === false && <li className="warn"><CircleAlert/>These grades cover {match.gradedLength ?? "?"} residues against this project&apos;s {match.queryLength} ({formatCoverage(match.coverage)} overlap) and the residues do not all agree. Check you imported the run for this sequence.</li>}
      {summary.unmodelledCount > 0 && <li>{summary.unmodelledCount} residue{summary.unmodelledCount === 1 ? " is" : "s are"} graded from the alignment but absent from the structure, so they cannot be coloured on a model.</li>}
      {skipped > 0 && <li className="warn"><CircleAlert/>{skipped} row{skipped === 1 ? "" : "s"} in the grades file could not be read and {skipped === 1 ? "was" : "were"} left out.</li>}
    </ul>
  </div>;
}

/** The residue strip: colour plus a grade-height bar, so it survives greyscale. */
function GradeStrip({ residues, selectedPosition, onSelectPosition }: {
  residues: ConservationResidue[];
  selectedPosition: number | null;
  onSelectPosition: (position: number | null) => void;
}) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const [width, setWidth] = useState(880);
  useEffect(() => {
    const host = hostRef.current;
    if (!host || typeof ResizeObserver === "undefined") return;
    // observe() delivers the current size straight away, so the first width
    // arrives through the callback rather than from the effect body.
    const observer = new ResizeObserver((entries) => {
      const measured = entries[0]?.contentRect.width ?? 0;
      if (measured > 0) setWidth(measured);
    });
    observer.observe(host);
    return () => observer.disconnect();
  }, []);

  // Aim for readable columns, then wrap on a whole ten so the position ruler
  // lands on round numbers. A short protein keeps wide cells rather than being
  // stretched across the panel.
  const target = stripColumnWidth(residues.length, width, { min: 3, max: 16 });
  const capacity = Math.max(10, Math.floor(width / target));
  const perRow = residues.length <= capacity
    ? Math.max(1, residues.length)
    : Math.max(10, Math.floor(capacity / 10) * 10);
  const columnWidth = Math.min(16, width / perRow);
  const rows = useMemo(() => stripRows(residues, perRow), [residues, perRow]);
  const showLetters = columnWidth >= LETTER_MIN_WIDTH;
  const height = rows.length * (ROW_HEIGHT + LABEL_HEIGHT + ROW_GAP);
  const tickPositions = useMemo(
    () => rulerPositions(rows, tickStride(columnWidth), columnWidth),
    [rows, columnWidth],
  );

  const move = useCallback((delta: number) => {
    const current = residues.findIndex((residue) => residue.position === selectedPosition);
    const next = current < 0 ? 0 : Math.min(residues.length - 1, Math.max(0, current + delta));
    onSelectPosition(residues[next]?.position ?? null);
  }, [residues, selectedPosition, onSelectPosition]);

  return <div className="conservation-strip" ref={hostRef}>
    <svg
      viewBox={`0 0 ${width} ${height}`}
      width={width}
      height={height}
      role="group"
      tabIndex={0}
      aria-label={`Conservation grade strip, ${residues.length} residues. Use the arrow keys to move along the sequence.`}
      onKeyDown={(event) => {
        if (event.key === "ArrowRight") { event.preventDefault(); move(1); }
        else if (event.key === "ArrowLeft") { event.preventDefault(); move(-1); }
        else if (event.key === "ArrowDown") { event.preventDefault(); move(perRow); }
        else if (event.key === "ArrowUp") { event.preventDefault(); move(-perRow); }
        else if (event.key === "Home") { event.preventDefault(); onSelectPosition(residues[0]?.position ?? null); }
        else if (event.key === "End") { event.preventDefault(); onSelectPosition(residues[residues.length - 1]?.position ?? null); }
        else if (event.key === "Escape") onSelectPosition(null);
      }}
    >
      <defs>
        {/* Insufficient data is hatched as well as yellow, so it reads without colour. */}
        <pattern id="conservation-insufficient" width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="5" height="5" fill={gradeColor(0, true)}/>
          <line x1="0" y1="0" x2="0" y2="5" stroke="#8a7400" strokeWidth="1.6"/>
        </pattern>
      </defs>
      {rows.map((row, rowIndex) => {
        const top = rowIndex * (ROW_HEIGHT + LABEL_HEIGHT + ROW_GAP);
        return <g key={rowIndex}>
          {row.map((residue, columnIndex) => {
            const x = columnIndex * columnWidth;
            // Bar height encodes the grade independently of the colour.
            const barHeight = Math.max(2, (residue.grade / 9) * (ROW_HEIGHT - 6));
            const isSelected = residue.position === selectedPosition;
            return <g
              key={residue.position}
              className={`conservation-cell${isSelected ? " selected" : ""}`}
              onClick={() => onSelectPosition(isSelected ? null : residue.position)}
            >
              <title>{`${residue.residue}${residue.position} · grade ${residue.grade} (${gradeLabel(residue.grade)})${residue.insufficientData ? " · insufficient data" : ""}`}</title>
              <rect
                x={x} y={top} width={Math.max(0.8, columnWidth - 0.6)} height={ROW_HEIGHT}
                fill={residue.insufficientData ? "url(#conservation-insufficient)" : gradeColor(residue.grade)}
              />
              <rect
                x={x} y={top + ROW_HEIGHT - barHeight} width={Math.max(0.8, columnWidth - 0.6)} height={barHeight}
                fill={residue.insufficientData ? "#8a7400" : gradeInk(residue.grade)}
                opacity={residue.insufficientData ? 0.5 : 0.24}
              />
              {/* The skyline contour. Without it the grade would only be in
                  the fill, which grades 3-7 cannot carry in greyscale. */}
              <rect
                x={x} y={top + ROW_HEIGHT - barHeight} width={Math.max(0.8, columnWidth - 0.6)} height={1.6}
                fill={residue.insufficientData ? "#6b5a00" : gradeInk(residue.grade)}
                opacity={0.85}
              />
              {isSelected && <rect
                className="conservation-selection"
                x={x - 0.5} y={top - 1.5} width={Math.max(1.8, columnWidth + 0.4)} height={ROW_HEIGHT + 3}
              />}
              {showLetters && <text
                x={x + columnWidth / 2} y={top + ROW_HEIGHT / 2}
                className="conservation-letter"
                fill={residue.insufficientData ? gradeInk(0, true) : gradeInk(residue.grade)}
              >{residue.residue}</text>}
            </g>;
          })}
          {/* The ruler. The stride widens as columns get thinner so labels
              never collide, and each label is clamped inside the drawing so a
              long position number is not cut off at either edge. */}
          {row.map((residue, columnIndex) => tickPositions.has(residue.position) && <text
            key={`tick-${residue.position}`}
            className="conservation-tick"
            x={clamp(columnIndex * columnWidth + columnWidth / 2, TICK_HALF, width - TICK_HALF)}
            y={top + ROW_HEIGHT + LABEL_HEIGHT - 3}
            textAnchor="middle"
          >{residue.position}</text>)}
        </g>;
      })}
    </svg>
  </div>;
}

function GradeLegend() {
  return <ul className="conservation-legend">
    <li className="caption">Conservation grade</li>
    {gradeLegend().map((entry) => <li key={entry.key} title={entry.label}>
      <span style={{ background: entry.insufficientData ? undefined : entry.color, color: entry.ink }} className={entry.insufficientData ? "insufficient" : ""}>
        {entry.insufficientData ? "*" : entry.grade}
      </span>
      {(entry.grade === 9 || entry.grade === 1 || entry.insufficientData) && <small>{entry.label}</small>}
    </li>)}
  </ul>;
}

function ResidueDetail({ residue, onClear }: { residue: ConservationResidue; onClear: () => void }) {
  const variety = residue.varietyResidues.length ? residue.varietyResidues : null;
  return <article className="conservation-detail">
    <span className="conservation-detail-grade" style={{ background: gradeColor(residue.grade, residue.insufficientData), color: gradeInk(residue.grade, residue.insufficientData) }}>
      <b>{residue.grade}</b><small>{residue.insufficientData ? "low confidence" : gradeLabel(residue.grade)}</small>
    </span>
    <div>
      <strong>{residue.residue}{residue.position}{residue.pdbResidueNumber ? ` · PDB ${residue.pdbResidueNumber}${residue.pdbChain ? `:${residue.pdbChain}` : ""}` : ""}</strong>
      <dl>
        <div><dt>Score</dt><dd>{residue.score.toFixed(3)}</dd></div>
        <div><dt>Confidence interval</dt><dd>{residue.confidenceInterval ? `${residue.confidenceInterval[0].toFixed(3)} to ${residue.confidenceInterval[1].toFixed(3)}` : "not reported"}{residue.confidenceGrades ? ` (grades ${residue.confidenceGrades[0]}–${residue.confidenceGrades[1]})` : ""}</dd></div>
        <div><dt>Alignment support</dt><dd>{residue.msaData ?? "not reported"}</dd></div>
        <div><dt>Burial</dt><dd>{residue.burialState === "b" ? "buried" : residue.burialState === "e" ? "exposed" : "not reported"}</dd></div>
        <div><dt>ConSurf call</dt><dd>{residue.functionalState === "f" ? "functional (conserved and exposed)" : residue.functionalState === "s" ? "structural (conserved and buried)" : "none"}</dd></div>
        {!residue.modelled && <div><dt>Structure</dt><dd>absent from the model</dd></div>}
      </dl>
      {residue.insufficientData && <p className="conservation-warn"><CircleAlert/>ConSurf marked this site as insufficient data: too few non-gapped homologues, or a confidence interval spanning four or more grades. Treat the grade as indicative only.</p>}
      {variety && <p className="conservation-variety">Residues seen here: {variety.map((item) => `${item.residue}${item.percent === null ? "" : item.belowOnePercent ? " <1%" : ` ${item.percent}%`}`).join(", ")}</p>}
    </div>
    <Button size="sm" variant="ghost" onClick={onClear} aria-label="Clear the selected residue">×</Button>
  </article>;
}

/** The guided path for a prepared submission: files, steps, then the import. */
function PreparedGuide({ job, busy, onImport }: { job: ConservationJob; busy: boolean; onImport: (gradesPath: string, msaPath: string) => Promise<void> }) {
  const files = job.metadata.files ?? [];
  const steps = job.metadata.steps ?? [];
  return <div className="conservation-prepared">
    <p className="conservation-lead">ConSurf has no submission API, so the run happens on their web server. Protein Lab has written the input files for you:</p>
    <ul className="conservation-files">{files.map((file) => <li key={file.path}>
      <b>{file.label}</b>
      <code>{file.path}</code>
      <small>{(file.bytes / 1024).toFixed(1)} kB{file.chain ? ` · chain ${file.chain}` : ""}</small>
    </li>)}</ul>
    <ol className="conservation-steps">{steps.map((step, index) => <li key={index}>{step}</li>)}</ol>
    <a className="conservation-server-link" href={job.metadata.serverUrl ?? "https://consurf.tau.ac.il/"} target="_blank" rel="noreferrer">
      Open the ConSurf server<ExternalLink/>
    </a>
    <ImportForm job={job} busy={busy} onImport={onImport}/>
  </div>;
}

function ImportForm({ job, busy, onImport, compact = false }: { job: ConservationJob; busy: boolean; onImport: (gradesPath: string, msaPath: string) => Promise<void>; compact?: boolean }) {
  const [gradesPath, setGradesPath] = useState("");
  const [msaPath, setMsaPath] = useState("");
  const submit = () => { if (gradesPath.trim()) void onImport(gradesPath.trim(), msaPath.trim()); };
  const body = <div className="conservation-import">
    <label>ConSurf grades file<input value={gradesPath} onChange={(event) => setGradesPath(event.target.value)} placeholder="/home/you/Downloads/consurf_grades.txt" onKeyDown={(event) => { if (event.key === "Enter") submit(); }}/></label>
    <label>Alignment file (optional)<input value={msaPath} onChange={(event) => setMsaPath(event.target.value)} placeholder="/home/you/Downloads/msa.fasta" onKeyDown={(event) => { if (event.key === "Enter") submit(); }}/></label>
    <Button variant="outline" disabled={busy || !gradesPath.trim()} onClick={submit}><Upload/> Import grades</Button>
  </div>;
  if (!compact) return body;
  return <details className="conservation-reimport">
    <summary><Rows3/> Import another grades file for this run</summary>
    <p>Replaces the {job.residueCount} saved grades with the ones in the file you choose.</p>
    {body}
  </details>;
}

function MsaButton({ proteinId, jobId, count }: { proteinId: string; jobId: string; count: number }) {
  const [state, setState] = useState<{ busy: boolean; text: string; error: string }>({ busy: false, text: "", error: "" });
  const [open, setOpen] = useState(false);
  async function load() {
    if (state.text) { setOpen((value) => !value); return; }
    setState({ busy: true, text: "", error: "" });
    try {
      const value = await proteinLabsApi.getConservationMsa(proteinId, jobId);
      setState({ busy: false, text: value.fasta, error: value.fasta ? "" : "This run kept no alignment." });
      setOpen(true);
    } catch (reason) {
      setState({ busy: false, text: "", error: reason instanceof Error ? reason.message : String(reason) });
    }
  }
  return <>
    <Button size="sm" variant="outline" disabled={state.busy} onClick={() => void load()}>
      {state.busy ? <LoaderCircle className="spin"/> : <ListChecks/>} {open ? "Hide alignment" : `Alignment (${count})`}
    </Button>
    {open && (state.error
      ? <div className="research-message error" role="alert"><CircleAlert/><span>{state.error}</span></div>
      : <pre className="conservation-msa" aria-label={`ConSurf alignment, ${count} sequences`}>{state.text.slice(0, 20000)}{state.text.length > 20000 ? "\n…truncated for display\n" : ""}</pre>)}
  </>;
}

function Empty({ text }: { text: string }) { return <div className="research-empty"><Database/><span>{text}</span></div>; }

function conservationDistributionLabel(summary: ReturnType<typeof summarizeConservation>) {
  const parts = summary.histogram.filter((bucket) => bucket.count > 0).map((bucket) => `grade ${bucket.grade}: ${bucket.count}`);
  if (summary.insufficientDataCount > 0) parts.push(`insufficient data: ${summary.insufficientDataCount}`);
  return `Grade distribution — ${parts.join(", ")}`;
}

function runLabel(job: ConservationJobSummary) {
  const when = Date.parse(job.createdAt);
  const stamp = Number.isFinite(when) ? new Date(when).toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }) : "time not recorded";
  const source = job.source === "consurf-db" ? "ConSurf-DB" : job.source === "consurf-server-import" ? "Imported" : "Prepared";
  return `${source} · ${stamp}${job.residueCount ? ` · ${job.residueCount} residues` : ""}`;
}
