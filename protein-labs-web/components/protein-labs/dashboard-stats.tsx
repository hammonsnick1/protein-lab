"use client";

import { useMemo, useState } from "react";
import { BarChart3, ChartColumn, Table2 } from "lucide-react";
import type { ProteinBundle, ProteinRecord } from "@/lib/protein-labs-api";
import { completedByStage, jobStatusRows, niceMax, perWeek, projectsOverTime, type StatRow, type WeekRow } from "@/lib/dashboard-stats";
import { workflowJobs, workflowSections } from "@/lib/workflow";

const WEEKS = 8;
const stageLabels: Record<string, string> = { understand: "Understand", plan: "Plan", purify: "Purify", analysis: "Analyse", crystallize: "Crystallize" };
const stageOf = (appType: string) => workflowJobs.find((job) => job.appType === appType)?.stage;

export type BundlesState = "loading" | "ready" | "error";

/**
 * The dashboard's left column: headline counts and four small charts, all
 * counted from the projects and saved workflow jobs the engine returns. One
 * series per chart, drawn in the appearance's primary colour; every chart has
 * a table twin behind the Chart/Table switch.
 */
export function DashboardStats({ proteins, bundles, state, hours, children }: { proteins: ProteinRecord[]; bundles: ProteinBundle[]; state: BundlesState; hours: number; children?: React.ReactNode }) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const now = useMemo(() => new Date(), []);
  const jobs = useMemo(() => bundles.flatMap((bundle) => bundle.projectJobs), [bundles]);
  const complete = jobs.filter((job) => job.status === "complete").length;
  const purified = bundles.filter((bundle) => bundle.projectJobs.some((job) => job.status === "complete" && ["purification-workflow", "chromatogram-studio", "gel-analysis"].includes(job.appType))).length;
  const status = useMemo(() => jobStatusRows(jobs), [jobs]);
  const stages = useMemo(() => completedByStage(jobs, workflowSections.map((section) => ({ id: section.id, label: stageLabels[section.id] ?? section.label })), stageOf), [jobs]);
  const started = useMemo(() => perWeek(jobs.map((job) => job.createdAt), now, WEEKS), [jobs, now]);
  const projects = useMemo(() => projectsOverTime(proteins, now, WEEKS), [proteins, now]);
  const waiting = state === "loading" && proteins.length > 0;
  const noJobs = state === "ready" && !jobs.length;

  return <aside className="dashboard-stats-column" aria-label="Lab statistics">
    {children}
    <section className="dashboard-card dashboard-stats-card" aria-busy={waiting}>
      <header className="dashboard-card-header">
        <span><BarChart3/><span><strong>Lab statistics</strong><small>Counted from your saved projects and jobs</small></span></span>
        <div className="stats-view-switch" role="group" aria-label="Show statistics as">
          <button aria-pressed={view === "chart"} onClick={() => setView("chart")} title="Show as charts"><ChartColumn/><span className="sr-only">Charts</span></button>
          <button aria-pressed={view === "table"} onClick={() => setView("table")} title="Show as tables"><Table2/><span className="sr-only">Tables</span></button>
        </div>
      </header>
      <div className="dashboard-stats-scroll">
        <div className="stats-kpis">
          <Kpi value={proteins.length} label="Projects"/>
          <Kpi value={waiting ? "…" : purified} label="Proteins purified"/>
          <Kpi value={waiting ? "…" : complete} label="Jobs complete" detail={waiting ? undefined : `of ${jobs.length} saved`}/>
          <Kpi value={formatHours(hours)} label="Hours in Protein Lab"/>
        </div>
        {state === "error" && <p className="stats-message" role="status">The engine did not return every project&apos;s jobs, so job charts are incomplete. Restart the engine and reopen the dashboard.</p>}
        {!proteins.length && state !== "error" && <p className="stats-message">Create a project and save workflow steps; these charts fill in from that work.</p>}
        <div className={`stats-charts ${waiting ? "is-waiting" : ""}`}>
          <StatFigure title="Workflow jobs by status" note={noJobs ? "No jobs saved yet" : undefined} view={view} rows={status} unit="jobs">
            <BarList rows={status} unit="jobs"/>
          </StatFigure>
          <StatFigure title="Completed jobs by roadmap stage" view={view} rows={stages} unit="jobs">
            <BarList rows={stages} unit="jobs"/>
          </StatFigure>
          <StatFigure title={`Jobs started per week, last ${WEEKS} weeks`} view={view} rows={started} unit="jobs" weekly>
            <WeekColumns rows={started} unit="jobs started"/>
          </StatFigure>
          <StatFigure title={`Projects in the workspace, last ${WEEKS} weeks`} view={view} rows={projects} unit="projects" weekly>
            <WeekLine rows={projects} unit="projects"/>
          </StatFigure>
        </div>
      </div>
    </section>
  </aside>;
}

function Kpi({ value, label, detail }: { value: number | string; label: string; detail?: string }) {
  return <div className="stats-kpi"><span>{label}</span><strong>{value}</strong>{detail && <small>{detail}</small>}</div>;
}

function StatFigure({ title, note, view, rows, unit, weekly, children }: { title: string; note?: string; view: "chart" | "table"; rows: StatRow[]; unit: string; weekly?: boolean; children: React.ReactNode }) {
  return <figure className="stats-figure">
    <figcaption><strong>{title}</strong>{note && <small>{note}</small>}</figcaption>
    {view === "chart" ? children : <table className="stats-table">
      <thead><tr><th scope="col">{weekly ? "Week of" : "Group"}</th><th scope="col">{unit[0].toUpperCase() + unit.slice(1)}</th></tr></thead>
      <tbody>{rows.map((row) => <tr key={row.key}><th scope="row">{row.label}</th><td>{row.value}</td></tr>)}</tbody>
    </table>}
  </figure>;
}

/** Horizontal bars from one baseline, value at each tip. */
function BarList({ rows, unit }: { rows: StatRow[]; unit: string }) {
  const max = Math.max(1, ...rows.map((row) => row.value));
  return <div className="stats-bars" role="list">
    {rows.map((row) => <div key={row.key} className="stats-bar" role="listitem" aria-label={`${row.label}: ${row.value} ${unit}`}>
      <span>{row.label}</span>
      <span className="stats-bar-track"><i style={{ width: row.value ? `${(row.value / max) * 100}%` : 0 }}/><b>{row.value}</b></span>
    </div>)}
  </div>;
}

/** Arrow keys move a highlighted week so keyboard readers get the same
 *  readout as the pointer. */
function useWeekFocus(count: number) {
  const [active, setActive] = useState<number | null>(null);
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    event.preventDefault();
    setActive((value) => { const start = value ?? count - 1; return Math.max(0, Math.min(count - 1, start + (event.key === "ArrowRight" ? 1 : -1))); });
  };
  return { active, setActive, bind: { tabIndex: 0, onKeyDown, onFocus: () => setActive((value) => value ?? count - 1), onBlur: () => setActive(null), onPointerLeave: () => setActive(null) } };
}

function WeekReadout({ rows, active, unit }: { rows: WeekRow[]; active: number | null; unit: string }) {
  const row = active === null ? null : rows[active];
  return <div className="stats-readout" aria-live="polite">{row ? <><strong>{row.value}</strong> {unit} · week of {row.label}</> : <span>Point at or arrow through a week for its value</span>}</div>;
}

function WeekAxis({ rows }: { rows: WeekRow[] }) {
  // First, middle and current week keep the axis legible in a narrow column.
  return <div className="stats-week-axis" aria-hidden="true">{rows.map((row, index) => <span key={row.key}>{index === 0 || index === rows.length - 1 || index === Math.floor(rows.length / 2) ? (index === rows.length - 1 ? "This wk" : row.label) : ""}</span>)}</div>;
}

/** Columns per week. The peak and the current week carry labels; every week's
 *  value is in the readout and the table. */
function WeekColumns({ rows, unit }: { rows: WeekRow[]; unit: string }) {
  const max = niceMax(Math.max(...rows.map((row) => row.value)));
  const peak = rows.reduce((best, row, index) => (row.value > rows[best].value ? index : best), 0);
  const { active, setActive, bind } = useWeekFocus(rows.length);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  return <div className="stats-week-chart" role="img" aria-label={`${total} ${unit} over the last ${rows.length} weeks; ${rows[rows.length - 1].value} this week.`} {...bind}>
    <div className="stats-plot">
      <span className="stats-gridline" style={{ bottom: "100%" }}><em>{max}</em></span>
      <span className="stats-gridline" style={{ bottom: "50%" }}><em>{max / 2}</em></span>
      <span className="stats-gridline baseline" style={{ bottom: 0 }}><em>0</em></span>
      <div className="stats-columns">{rows.map((row, index) => <span key={row.key} className={index === active ? "active" : ""} onPointerEnter={() => setActive(index)}>
        <i style={{ height: `${(row.value / max) * 100}%` }}>{(index === rows.length - 1 || (index === peak && row.value > 0)) && <b>{row.value}</b>}</i>
      </span>)}</div>
    </div>
    <WeekAxis rows={rows}/>
    <WeekReadout rows={rows} active={active} unit={unit}/>
  </div>;
}

/** A running total as a 2px line over a light wash, labelled at its end. */
function WeekLine({ rows, unit }: { rows: WeekRow[]; unit: string }) {
  const max = niceMax(Math.max(...rows.map((row) => row.value)));
  const { active, setActive, bind } = useWeekFocus(rows.length);
  const x = (index: number) => (rows.length === 1 ? 50 : (index / (rows.length - 1)) * 100);
  const y = (value: number) => 100 - (value / max) * 100;
  const line = rows.map((row, index) => `${index ? "L" : "M"}${x(index)},${y(row.value)}`).join(" ");
  const last = rows[rows.length - 1];
  const marker = active ?? rows.length - 1;
  return <div className="stats-week-chart" role="img" aria-label={`${last.value} ${unit} now, from ${rows[0].value} ${rows.length} weeks ago.`} {...bind}>
    <div className="stats-plot">
      <span className="stats-gridline" style={{ bottom: "100%" }}><em>{max}</em></span>
      <span className="stats-gridline" style={{ bottom: "50%" }}><em>{max / 2}</em></span>
      <span className="stats-gridline baseline" style={{ bottom: 0 }}><em>0</em></span>
      <svg className="stats-line" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
        <path className="wash" d={`${line} L100,100 L0,100 Z`}/>
        <path className="stroke" d={line}/>
      </svg>
      <i className="stats-line-dot" style={{ left: `${x(marker)}%`, bottom: `${100 - y(rows[marker].value)}%` }}/>
      {active === null && <b className="stats-line-end" style={{ bottom: `${100 - y(last.value)}%` }}>{last.value}</b>}
      <div className="stats-hit" style={{ "--edge": `${rows.length > 1 ? -50 / (rows.length - 1) : 0}%` } as React.CSSProperties}>{rows.map((row, index) => <span key={row.key} onPointerEnter={() => setActive(index)}/>)}</div>
    </div>
    <WeekAxis rows={rows}/>
    <WeekReadout rows={rows} active={active} unit={unit}/>
  </div>;
}

export function formatHours(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return hours < 10 ? hours.toFixed(1) : String(Math.round(hours));
}
