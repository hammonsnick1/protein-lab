// Previous and next jobs for the corner tabs of an open workflow job. The
// order is the workflow's own: understanding, planning, the bench jobs, then
// the analysis studios. Only erasable TypeScript syntax is used, so the unit
// tests run under Node without a bundler.
import type { ProteinBundle } from "./protein-labs-api.ts";
import { isComplete, resolveJobId, workflowJobs, type WorkflowJobDefinition } from "./workflow.ts";

export type JobNeighbours = { previous: WorkflowJobDefinition | null; next: WorkflowJobDefinition | null };

/** The jobs either side of `jobId`; null at the ends of the workflow. */
export function jobNeighbours(jobId: string, jobs: WorkflowJobDefinition[] = workflowJobs): JobNeighbours {
  const index = jobs.findIndex((job) => job.id === resolveJobId(jobId));
  if (index < 0) return { previous: null, next: null };
  return { previous: jobs[index - 1] ?? null, next: jobs[index + 1] ?? null };
}

/** A planning job the scientist has not finished may be skipped on the way to
 *  the next one. The sequence anchors the project and cannot be skipped. */
export function canSkipJob(bundle: ProteinBundle, jobId: string, jobs: WorkflowJobDefinition[] = workflowJobs) {
  const definition = jobs.find((job) => job.id === resolveJobId(jobId));
  if (!definition || definition.appType === "protein-planner") return false;
  if (definition.stage !== "understand" && definition.stage !== "plan") return false;
  return !isComplete(bundle, definition);
}
