// Previous/next corner tabs of an open job. Run with `npm run test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import type { ProjectJob, ProteinBundle } from "./protein-labs-api.ts";
import { canSkipJob, jobNeighbours } from "./job-navigation.ts";
import { workflowJobs } from "./workflow.ts";

function job(appType: string, status: ProjectJob["status"], config: ProjectJob["config"] = {}): ProjectJob {
  return { id: `job-${appType}`, proteinId: "p1", name: appType, appType, status, config, createdAt: "", updatedAt: "" };
}

function bundle(projectJobs: ProjectJob[] = []): ProteinBundle {
  return {
    protein: { id: "p1", name: "Test protein", sequence: "MKT" } as ProteinBundle["protein"],
    protparam: null,
    blastJobs: [],
    uniprotMatches: [],
    pdbMatches: [],
    alphaFoldModels: [],
    projectJobs,
    projectNotebook: null,
  };
}

describe("jobNeighbours", () => {
  it("has no previous job on the first job of the workflow", () => {
    const { previous, next } = jobNeighbours("sequence");
    assert.equal(previous, null);
    assert.equal(next?.id, "properties");
  });

  it("has no next job on the last job of the workflow", () => {
    const { previous, next } = jobNeighbours(workflowJobs.at(-1)!.id);
    assert.equal(previous?.id, workflowJobs.at(-2)!.id);
    assert.equal(next, null);
  });

  it("follows the workflow order across stages", () => {
    assert.deepEqual(Object.values(jobNeighbours("research")).map((value) => value?.id), ["properties", "reference-match"]);
    assert.deepEqual(Object.values(jobNeighbours("purification-workflow")).map((value) => value?.id), ["purification-sec", "transformation-expression"]);
  });

  it("plans the purification in bench order", () => {
    assert.deepEqual(workflowJobs.filter((job) => job.stage === "plan").map((job) => job.id), [
      "expression-system", "expression-vector", "purification-affinity", "purification-subtractive", "purification-lysis", "purification-sec", "purification-workflow",
    ]);
    assert.deepEqual(Object.values(jobNeighbours("expression-system")).map((value) => value?.id), ["readiness", "expression-vector"]);
  });

  it("resolves folded jobs to the job that now holds them", () => {
    assert.deepEqual(jobNeighbours("purification-cleavage"), jobNeighbours("purification-subtractive"));
  });

  it("returns no neighbours for an unknown job", () => {
    assert.deepEqual(jobNeighbours("nonexistent"), { previous: null, next: null });
  });
});

describe("canSkipJob", () => {
  it("offers to skip an unfinished planning job", () => {
    assert.equal(canSkipJob(bundle(), "research"), true);
    assert.equal(canSkipJob(bundle([job("database-research", "in_progress")]), "research"), true);
  });

  it("does not offer to skip a finished or already skipped job", () => {
    assert.equal(canSkipJob(bundle([job("database-research", "complete")]), "research"), false);
    assert.equal(canSkipJob(bundle([job("purification-sec", "complete", { skipped: true })]), "purification-sec"), false);
  });

  it("never skips the sequence, bench or analysis jobs", () => {
    assert.equal(canSkipJob(bundle(), "sequence"), false);
    assert.equal(canSkipJob(bundle(), "transformation-expression"), false);
    assert.equal(canSkipJob(bundle(), "chromatogram"), false);
  });
});

describe("recommended-next prompts", () => {
  it("are gone from the job and workflow screens", () => {
    for (const file of ["components/protein-labs/job-workspace.tsx", "components/protein-labs/project-workflow.tsx", "app/globals.css"]) {
      const source = readFileSync(new URL(`../${file}`, import.meta.url), "utf8");
      assert.doesNotMatch(source, /recommended next|next-step-banner|job-next-copy/i, file);
    }
  });
});
