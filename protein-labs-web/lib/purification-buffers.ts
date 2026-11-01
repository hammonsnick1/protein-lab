import { ensureProjectJob, type ProjectJob } from "@/lib/protein-labs-api";
import { bufferStepLabels, normalizeBufferSteps, type BufferStep } from "@/lib/purification-catalog";
import type { StageBuffer } from "@/lib/purification-stage-catalog";

/** The job that sets each buffer step, in bench order. */
export const bufferStepOwners: Record<string, { appType: string; job: string }> = {
  lysis: { appType: "purification-lysis", job: "Cell lysis" },
  binding: { appType: "purification-affinity", job: "Affinity capture" },
  wash: { appType: "purification-affinity", job: "Affinity capture" },
  elution: { appType: "purification-affinity", job: "Affinity capture" },
  cleavage: { appType: "purification-subtractive", job: "Subtractive cleanup" },
  storage: { appType: "purification-sec", job: "SEC polishing" },
};

type SavedJob = Pick<ProjectJob, "appType" | "config">;

/**
 * The saved buffer for each step, read from one record: the
 * `purification-buffer` job's `steps`. Projects saved before every job wrote
 * that record kept some buffers only on the job that set them (Affinity
 * capture's `buffers`, a stage job's `bufferStep` or `bufferComponents`); a
 * step missing from the record is filled from there. Steps with no components
 * anywhere are left out, so `steps.lysis` is undefined until a lysis buffer
 * has been saved.
 */
export function savedBufferSteps(jobs: SavedJob[]): Record<string, BufferStep> {
  const config = (appType: string) => jobs.find((job) => job.appType === appType)?.config ?? {};
  const record = normalizeBufferSteps(config("purification-buffer").steps) ?? {};
  const result: Record<string, BufferStep> = {};
  for (const [id, owner] of Object.entries(bufferStepOwners)) {
    const step = filled(record[id]) ?? filled(legacyStep(id, config(owner.appType)));
    if (step) result[id] = step;
  }
  return result;
}

function legacyStep(id: string, saved: Record<string, unknown>): BufferStep | null {
  if (saved.skipped === true) return null;
  if (bufferStepOwners[id].appType === "purification-affinity") return normalizeBufferSteps(saved.buffers)?.[id] ?? null;
  const raw = saved.bufferStep && typeof saved.bufferStep === "object" ? saved.bufferStep
    : Array.isArray(saved.bufferComponents) ? { pH: saved.bufferPH ?? "", purpose: `${bufferStepLabels[id]} — ${String(saved.bufferName ?? "saved buffer")}`, components: saved.bufferComponents }
    : null;
  return raw ? normalizeBufferSteps({ [id]: raw })?.[id] ?? null : null;
}

function filled(step: BufferStep | null | undefined) { return step?.components.some((item) => item.name.trim()) ? step : null; }

/**
 * Each purification job sets the buffers it uses: Affinity capture the
 * binding, wash and elution buffers, Subtractive cleanup the cleavage buffer,
 * SEC polishing the storage buffer and Cell lysis the lysis buffer. They are
 * kept together in one per-step record, which every job reopens from and the
 * roadmap, reports and Compile workflow read. A save also writes any step
 * that so far was only on an older job's config, so the record catches up.
 */
export async function saveBufferSteps(proteinId: string, jobs: ProjectJob[], steps: Record<string, BufferStep>) {
  const existing = jobs.find((job) => job.appType === "purification-buffer")?.config ?? {};
  const current = existing.steps && typeof existing.steps === "object" && !Array.isArray(existing.steps) ? existing.steps as Record<string, unknown> : {};
  return ensureProjectJob(proteinId, jobs, "purification-buffer", "Purification buffers", {
    ...existing,
    presetId: "per-job",
    presetName: "Set in each purification job",
    steps: { ...current, ...savedBufferSteps(jobs), ...steps },
    savedByUser: true,
    guidanceOnly: true,
    reference: "Starting conditions derived from manufacturer handbooks; verify exact product instructions.",
  });
}

export function stageBufferStep(buffer: StageBuffer, purpose: string): BufferStep {
  return { pH: String(buffer.pH), purpose: `${purpose} — ${buffer.name}`, components: buffer.components };
}
