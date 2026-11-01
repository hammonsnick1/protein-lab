// The step list a gel lane can be bound to. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { ProjectJob, ProteinBundle } from "./protein-labs-api.ts";
import { finalStorageBuffer, liveSteps, roadmapStepOptions, stageBindingLabel } from "./roadmap-steps.ts";

function job(appType: string, config: ProjectJob["config"]): ProjectJob {
  return { id: `job-${appType}`, proteinId: "p1", name: appType, appType, status: "ready", config, createdAt: "", updatedAt: "" };
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

describe("roadmapStepOptions", () => {
  it("lists the planned steps in board order before any roadmap is saved", () => {
    const options = roadmapStepOptions(bundle());
    assert.deepEqual(
      options.map((option) => option.id),
      ["transformation-expression", "lysis", "affinity", "cleavage", "subtractive", "sec", "quality-storage"],
    );
    assert.deepEqual(options[2], { id: "affinity", number: 3, title: "Affinity capture" });
  });

  it("follows the saved board's order, edited titles and custom steps", () => {
    const saved = job("purification-roadmap", {
      steps: [
        { id: "affinity", title: "IMAC capture", components: [] },
        { id: "added-ion", title: "Ion-exchange chromatography", components: [] },
      ],
    });
    const options = roadmapStepOptions(bundle([saved]));
    assert.deepEqual(options.slice(0, 2), [
      { id: "affinity", number: 1, title: "IMAC capture" },
      { id: "added-ion", number: 2, title: "Ion-exchange chromatography" },
    ]);
    assert.equal(options.length, 8);
  });
});

describe("stageBindingLabel", () => {
  const options = roadmapStepOptions(bundle());

  it("states an unbound lane as unbound", () => {
    assert.equal(stageBindingLabel(null, options), "Not bound to a step");
  });

  it("names a bound step by its board number and title", () => {
    assert.equal(stageBindingLabel("sec", options), "Step 6 · SEC polishing");
  });

  it("keeps a binding to a removed step visible instead of matching another step", () => {
    assert.equal(stageBindingLabel("added-gone", options), "Step no longer on the roadmap (added-gone)");
  });
});

describe("quality-control and storage step", () => {
  const qc = (jobs: ProjectJob[]) => liveSteps(bundle(jobs)).find((value) => value.id === "quality-storage")!;
  const perJob = job("purification-buffer", { presetId: "per-job", presetName: "Set in each purification job", steps: {} });

  it("is not ready and never prints the per-job marker before SEC saves a storage buffer", () => {
    const step = qc([perJob]);
    assert.equal(step.ready, false);
    assert.deepEqual(step.planDetails, []);
    assert.match(step.instruction, /the storage buffer\.$/);
    assert.equal(finalStorageBuffer(bundle([perJob])), null);
  });

  it("is ready once the SEC polishing job saves its storage buffer, and names that job", () => {
    const sec = job("purification-sec", { columnId: "sd200", bufferId: "sec-hepes", bufferName: "HEPES storage buffer", bufferPH: 7.5, bufferEdited: true });
    const step = qc([perJob, sec]);
    assert.equal(step.ready, true);
    assert.deepEqual(step.planDetails, ["Storage buffer: HEPES storage buffer (edited), pH 7.5"]);
    assert.equal(step.jobId, "purification-sec");
    assert.equal(step.jobLabel, "Storage buffer · SEC polishing job");
  });

  it("keeps a named preset from projects saved before per-job buffers", () => {
    assert.deepEqual(finalStorageBuffer(bundle([job("purification-buffer", { presetId: "tris-glycerol", presetName: "Tris–glycerol storage" })])), { name: "Tris–glycerol storage", pH: "" });
  });

  it("labels the cleavage step with the job that holds the protease choice", () => {
    const cleavage = liveSteps(bundle()).find((value) => value.id === "cleavage")!;
    assert.equal(cleavage.jobId, "purification-subtractive");
    assert.equal(cleavage.jobLabel, "Protease choice · Subtractive cleanup job");
  });
});
