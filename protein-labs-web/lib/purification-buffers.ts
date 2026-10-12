import { ensureProjectJob, type ProjectJob } from "@/lib/protein-labs-api";
import type { BufferStep } from "@/lib/purification-catalog";
import type { StageBuffer } from "@/lib/purification-stage-catalog";

/**
 * Each purification job sets the buffers it uses: Affinity capture the
 * binding, wash and elution buffers, Subtractive cleanup the cleavage buffer,
 * SEC polishing the storage buffer and Cell lysis the lysis buffer. They are
 * also kept together in one per-step record, which the roadmap, reports and
 * Compile workflow read.
 */
export async function saveBufferSteps(proteinId: string, jobs: ProjectJob[], steps: Record<string, BufferStep>) {
  const existing = jobs.find((job) => job.appType === "purification-buffer")?.config ?? {};
  const current = existing.steps && typeof existing.steps === "object" && !Array.isArray(existing.steps) ? existing.steps as Record<string, unknown> : {};
  return ensureProjectJob(proteinId, jobs, "purification-buffer", "Purification buffers", {
    ...existing,
    presetId: "per-job",
    presetName: "Set in each purification job",
    steps: { ...current, ...steps },
    savedByUser: true,
    guidanceOnly: true,
    reference: "Starting conditions derived from manufacturer handbooks; verify exact product instructions.",
  });
}

export function stageBufferStep(buffer: StageBuffer, purpose: string): BufferStep {
  return { pH: String(buffer.pH), purpose: `${purpose} — ${buffer.name}`, components: buffer.components };
}
