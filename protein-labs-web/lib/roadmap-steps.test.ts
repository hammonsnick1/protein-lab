// The step list a gel lane can be bound to, step moves and the buffer
// recipes shown on the board. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { ProjectJob, ProteinBundle } from "./protein-labs-api.ts";
import { ingredientLabel, moveStep, roadmapStepOptions, stageBindingLabel, stepBuffers } from "./roadmap-steps.ts";

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

describe("moveStep", () => {
  const steps = ["a", "b", "c", "d"];

  it("moves a step forward to before the step at the insertion point", () => {
    assert.deepEqual(moveStep(steps, 0, 3), ["b", "c", "a", "d"]);
  });

  it("moves a step backward and to either end", () => {
    assert.deepEqual(moveStep(steps, 2, 0), ["c", "a", "b", "d"]);
    assert.deepEqual(moveStep(steps, 1, 4), ["a", "c", "d", "b"]);
  });

  it("leaves the order alone when dropped beside itself or out of range", () => {
    assert.deepEqual(moveStep(steps, 1, 1), steps);
    assert.deepEqual(moveStep(steps, 1, 2), steps);
    assert.equal(moveStep(steps, 9, 0), steps);
  });
});

describe("stepBuffers", () => {
  const tris = { name: "Tris-HCl", concentration: 50, unit: "mM", role: "Buffer" };
  const salt = { name: "NaCl", concentration: "300", unit: "mM", role: "Ionic strength" };

  it("shows the binding, wash and elution recipes on the affinity step", () => {
    const shared = job("purification-buffer", { steps: {
      binding: { pH: "8.0", purpose: "Binding", components: [tris, salt] },
      wash: { pH: "8.0", purpose: "Wash", components: [tris] },
      elution: { pH: "", purpose: "Elution step", components: [] },
    } });
    const buffers = stepBuffers(bundle([shared]), "affinity");
    assert.deepEqual(buffers.map((value) => [value.label, value.pH, value.ingredients.map(ingredientLabel)]), [
      ["Binding", "8.0", ["50 mM Tris-HCl", "300 mM NaCl"]],
      ["Wash", "8.0", ["50 mM Tris-HCl"]],
      ["Elution", "", []],
    ]);
  });

  it("falls back to the owning job's buffer when the shared record has none", () => {
    const sec = job("purification-sec", { bufferPH: 7.5, bufferComponents: [salt] });
    assert.deepEqual(stepBuffers(bundle([sec]), "sec").map((value) => [value.label, value.pH, value.ingredients.map(ingredientLabel)]), [["SEC running / storage", "7.5", ["300 mM NaCl"]]]);
  });

  it("reads Affinity capture's own binding buffer for projects saved before the shared record", () => {
    const affinity = job("purification-affinity", { buffers: { binding: { pH: "7.5", components: [tris] } } });
    assert.deepEqual(stepBuffers(bundle([affinity]), "affinity").map((value) => value.ingredients.map(ingredientLabel)), [["50 mM Tris-HCl"], [], []]);
  });

  it("has no buffers for custom steps or steps that do not use one", () => {
    assert.deepEqual(stepBuffers(bundle(), "added-ion"), []);
    assert.deepEqual(stepBuffers(bundle(), "transformation-expression"), []);
    assert.deepEqual(stepBuffers(bundle([job("purification-cleavage", { proteaseId: "retain" })]), "cleavage"), []);
  });
});
