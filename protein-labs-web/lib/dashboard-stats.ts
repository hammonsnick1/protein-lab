// Aggregates for the dashboard's statistics column. Everything here is counted
// from records the engine already returns (projects and their saved workflow
// jobs); nothing is estimated. Pure functions so `node --test` can cover them.
import type { ProjectJob, ProteinRecord } from "./protein-labs-api.ts";

export type StatRow = { key: string; label: string; value: number };
export type WeekRow = StatRow & { start: Date; end: Date };

const statusOrder: { key: ProjectJob["status"]; label: string }[] = [
  { key: "complete", label: "Complete" },
  { key: "in_progress", label: "In progress" },
  { key: "ready", label: "Not started" },
];

export function jobStatusRows(jobs: ProjectJob[]): StatRow[] {
  return statusOrder.map(({ key, label }) => ({ key, label, value: jobs.filter((job) => job.status === key).length }));
}

/** Completed jobs per roadmap stage, in roadmap order. Jobs whose type is not
 *  on the roadmap are left out rather than guessed into a stage. */
export function completedByStage(jobs: ProjectJob[], stages: { id: string; label: string }[], stageOf: (appType: string) => string | undefined): StatRow[] {
  return stages.map((stage) => ({
    key: stage.id,
    label: stage.label,
    value: jobs.filter((job) => job.status === "complete" && stageOf(job.appType) === stage.id).length,
  }));
}

/** Monday 00:00 local time of the week containing `date`. */
export function weekStart(date: Date) {
  const start = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  start.setDate(start.getDate() - ((start.getDay() + 6) % 7));
  return start;
}

function weekWindows(now: Date, weeks: number) {
  const current = weekStart(now);
  return Array.from({ length: weeks }, (_, index) => {
    const start = new Date(current.getFullYear(), current.getMonth(), current.getDate() - 7 * (weeks - 1 - index));
    const end = new Date(start.getFullYear(), start.getMonth(), start.getDate() + 7);
    return { start, end, key: start.toISOString(), label: start.toLocaleDateString("en-GB", { day: "numeric", month: "short" }) };
  });
}

function time(value?: string) {
  const parsed = value ? Date.parse(value) : Number.NaN;
  return Number.isFinite(parsed) ? parsed : null;
}

/** How many timestamps fall in each of the last `weeks` calendar weeks
 *  (Monday to Sunday, the current week last). Unparseable values are skipped. */
export function perWeek(values: (string | undefined)[], now: Date, weeks = 8): WeekRow[] {
  const times = values.map(time).filter((value): value is number => value !== null);
  return weekWindows(now, weeks).map((week) => ({
    ...week,
    value: times.filter((value) => value >= week.start.getTime() && value < week.end.getTime()).length,
  }));
}

/** Running total of projects at the end of each week. A project with no
 *  creation date predates the window, so it counts from the first week. */
export function projectsOverTime(proteins: ProteinRecord[], now: Date, weeks = 8): WeekRow[] {
  return weekWindows(now, weeks).map((week) => ({
    ...week,
    value: proteins.filter((protein) => { const created = time(protein.createdAt); return created === null || created < week.end.getTime(); }).length,
  }));
}

/** A round axis maximum at or above `value`: 1, 2, 5, 10, 20, 50 ... */
export function niceMax(value: number) {
  if (value <= 1) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(value));
  return ([1, 2, 5, 10].map((step) => step * magnitude).find((step) => step >= value)) ?? 10 * magnitude;
}
