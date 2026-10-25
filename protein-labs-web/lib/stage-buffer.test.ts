// Subtractive cleanup and SEC polishing buffers: checks read the edited recipe, and saves load. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { BufferStep } from "./purification-catalog.ts";
import { cleanupBuffers, secBuffers } from "./purification-stage-catalog.ts";
import { cleanupBufferChecks, loadStageBufferStep, presetBufferStep, secBufferChecks } from "./stage-buffer.ts";

const preset = (id: string) => [...cleanupBuffers, ...secBuffers].find((item) => item.id === id)!;
const titles = (checks: { title: string }[]) => checks.map((item) => item.title);
const errors = (checks: { level: string; title: string }[]) => checks.filter((item) => item.level === "error").map((item) => item.title);
const resin = { phMin: 3, phMax: 12 };

describe("cleanup checks read the edited buffer", () => {
  it("passes the chelator-free preset and fails once EDTA is added", () => {
    const step = presetBufferStep(preset("cleanup-imac"), "Cleavage");
    assert.deepEqual(errors(cleanupBufferChecks("His6", step)), []);
    const edited: BufferStep = { ...step, components: [...step.components, { name: "EDTA", concentration: 1, unit: "mM", role: "Chelator" }] };
    assert.deepEqual(errors(cleanupBufferChecks("His6", edited)), ["Cleanup buffer contains an IMAC-incompatible chelator"]);
  });

  it("catches custom chelators by name but not an EDTA-free inhibitor cocktail", () => {
    const step = presetBufferStep(preset("cleanup-imac"), "Cleavage");
    const egta: BufferStep = { ...step, components: [...step.components, { name: "EGTA", concentration: 2, unit: "mM", role: "" }] };
    assert.equal(errors(cleanupBufferChecks("His6", egta)).length, 1);
    const cocktail: BufferStep = { ...step, components: [...step.components, { name: "EDTA-free protease inhibitor", concentration: 1, unit: "×", role: "Protease inhibitor" }] };
    assert.deepEqual(errors(cleanupBufferChecks("His6", cocktail)), []);
  });

  it("flags biotin or desthiobiotin added before Strep recapture", () => {
    const step = presetBufferStep(preset("cleanup-neutral"), "Cleavage");
    assert.deepEqual(errors(cleanupBufferChecks("Strep-tag II", step)), []);
    const edited: BufferStep = { ...step, components: [...step.components, { name: "D-desthiobiotin", concentration: 2.5, unit: "mM", role: "" }] };
    assert.deepEqual(errors(cleanupBufferChecks("Strep-tag II", edited)), ["Competing ligand blocks Strep recapture"]);
  });
});

describe("SEC checks read the edited buffer", () => {
  it("fails a membrane protein once the detergent row is removed, even from the membrane preset", () => {
    const step = presetBufferStep(preset("sec-membrane"), "SEC / storage");
    assert.deepEqual(errors(secBufferChecks(resin, step, { pI: null, membrane: true })), []);
    const edited: BufferStep = { ...step, components: step.components.filter((item) => item.name !== "DDM") };
    assert.deepEqual(errors(secBufferChecks(resin, edited, { pI: null, membrane: true })), ["Membrane-protein SEC buffer lacks detergent"]);
  });

  it("accepts a custom detergent the library does not know", () => {
    const step = presetBufferStep(preset("sec-hepes"), "SEC / storage");
    const edited: BufferStep = { ...step, components: [...step.components, { name: "LMNG", concentration: 0.002, unit: "% (w/v)", role: "Detergent" }] };
    assert.deepEqual(errors(secBufferChecks(resin, edited, { pI: null, membrane: true })), []);
  });

  it("warns about glycerol only when the edited buffer has it", () => {
    const stabilizing = presetBufferStep(preset("sec-stabilizing"), "SEC / storage");
    assert.ok(titles(secBufferChecks(resin, stabilizing, { pI: null, membrane: false })).includes("Viscous SEC buffer requires lower flow"));
    const removed: BufferStep = { ...stabilizing, components: stabilizing.components.filter((item) => item.name !== "Glycerol") };
    assert.ok(!titles(secBufferChecks(resin, removed, { pI: null, membrane: false })).includes("Viscous SEC buffer requires lower flow"));
  });

  it("checks the edited pH against the resin range and the pI", () => {
    const step = presetBufferStep(preset("sec-hepes"), "SEC / storage");
    assert.deepEqual(errors(secBufferChecks({ phMin: 3, phMax: 8 }, { ...step, pH: "8.5" }, { pI: null, membrane: false })), ["Buffer pH is outside the operating range"]);
    assert.ok(titles(secBufferChecks(resin, { ...step, pH: "6.2" }, { pI: 6.0, membrane: false })).includes("SEC buffer pH is close to predicted pI"));
    assert.ok(!titles(secBufferChecks(resin, step, { pI: 6.0, membrane: false })).includes("SEC buffer pH is close to predicted pI"));
    assert.deepEqual(errors(secBufferChecks(resin, { ...step, pH: "" }, { pI: null, membrane: false })), ["Buffer pH is not set"]);
  });
});

describe("saved stage buffers load", () => {
  it("loads an old save that only has a bufferId as that preset", () => {
    assert.deepEqual(loadStageBufferStep({ bufferId: "sec-high-salt" }, secBuffers, "sec-hepes", "SEC / storage"), presetBufferStep(preset("sec-high-salt"), "SEC / storage"));
  });

  it("falls back to the default preset when there is no save or the id is unknown", () => {
    assert.deepEqual(loadStageBufferStep({}, secBuffers, "sec-hepes", "SEC / storage"), presetBufferStep(preset("sec-hepes"), "SEC / storage"));
    assert.deepEqual(loadStageBufferStep({ bufferId: "retired" }, cleanupBuffers, "cleanup-imac", "Cleavage"), presetBufferStep(preset("cleanup-imac"), "Cleavage"));
  });

  it("loads the components and pH older saves stored next to the bufferId", () => {
    const loaded = loadStageBufferStep({ bufferId: "cleanup-imac", bufferName: "Reverse-IMAC flow-through buffer", bufferPH: 7.5, bufferComponents: preset("cleanup-imac").components }, cleanupBuffers, "cleanup-imac", "Cleavage");
    assert.deepEqual(loaded, presetBufferStep(preset("cleanup-imac"), "Cleavage"));
  });

  it("round-trips an edited buffer with custom components through JSON", () => {
    const edited: BufferStep = { pH: "7.2", purpose: "SEC / storage — General HEPES SEC / storage", components: [{ name: "HEPES", concentration: 25, unit: "mM", role: "Buffering agent" }, { name: "My osmolyte", concentration: "0.3", unit: "M", role: "Keeps the dimer together" }] };
    const saved = JSON.parse(JSON.stringify({ bufferId: "sec-hepes", bufferPH: 7.2, bufferComponents: edited.components, bufferStep: edited }));
    assert.deepEqual(loadStageBufferStep(saved, secBuffers, "sec-hepes", "SEC / storage"), edited);
  });
});
