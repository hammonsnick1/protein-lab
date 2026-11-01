// The one buffer record every purification job reopens from and Compile reads. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { savedBufferSteps } from "./purification-buffers.ts";
import type { JsonObject } from "./protein-labs-api.ts";

const job = (appType: string, config: JsonObject) => ({ appType, config });
const tris = { name: "Tris-HCl", concentration: 50, unit: "mM", role: "Buffering" };
const nacl = { name: "NaCl", concentration: 300, unit: "mM", role: "Ionic strength" };
const imidazole = (mM: number) => ({ name: "Imidazole", concentration: mM, unit: "mM", role: "Competitor" });
const hepes = { name: "HEPES", concentration: 20, unit: "mM", role: "Buffering" };

// The HOM-382 seed: buffers only on the jobs that set them, and no shared record.
const legacy = [
  job("purification-affinity", { columnId: "his-ni", tag: "6xHis", buffers: { binding: { pH: "7.5", purpose: "Affinity capture", components: [tris, nacl, imidazole(15)] }, wash: { pH: "7.5", purpose: "Remove contaminants", components: [tris, nacl, imidazole(30)] }, elution: { pH: "7.5", purpose: "Elute target", components: [tris, nacl, imidazole(300)] } } }),
  job("purification-lysis", { methodId: "sonication", bufferPH: "8.0", bufferComponents: [{ name: "Tris-HCl", concentration: 50, unit: "mM" }, { name: "NaCl", concentration: 300, unit: "mM" }, { name: "Imidazole", concentration: 15, unit: "mM" }] }),
  job("purification-sec", { columnId: "superdex-75", bufferName: "General HEPES", bufferStep: { pH: "7.5", purpose: "SEC / storage — General HEPES", components: [hepes, nacl] } }),
];

describe("savedBufferSteps", () => {
  it("fills every step from the job that set it when there is no shared record", () => {
    const steps = savedBufferSteps(legacy);
    assert.deepEqual(Object.keys(steps), ["lysis", "binding", "wash", "elution", "storage"]);
    assert.equal(steps.elution.components[2].concentration, 300);
    assert.deepEqual(steps.lysis.components.map((item) => item.name), ["Tris-HCl", "NaCl", "Imidazole"]);
    assert.equal(steps.lysis.pH, "8.0");
    assert.equal(steps.storage.components[0].name, "HEPES");
  });

  it("reads the shared record first and back-fills only the steps it lacks", () => {
    const record = job("purification-buffer", { steps: { storage: { pH: "7.4", purpose: "SEC / storage — edited", components: [hepes] }, lysis: { pH: "", purpose: "Lysis step", components: [] } } });
    const steps = savedBufferSteps([...legacy, record]);
    assert.equal(steps.storage.pH, "7.4");
    assert.equal(steps.storage.components.length, 1);
    // An empty step in the record does not hide the lysis buffer the job saved.
    assert.equal(steps.lysis.components.length, 3);
    assert.equal(steps.binding.components.length, 3);
  });

  it("leaves out steps nobody has saved, and skipped jobs", () => {
    assert.deepEqual(savedBufferSteps([]), {});
    const skipped = job("purification-sec", { skipped: true, bufferComponents: [hepes] });
    assert.equal(savedBufferSteps([skipped]).storage, undefined);
    const blankRow = job("purification-lysis", { methodId: "sonication", bufferComponents: [{ name: " ", concentration: "", unit: "mM" }] });
    assert.equal(savedBufferSteps([blankRow]).lysis, undefined);
  });

  it("keeps the cleavage buffer on the subtractive cleanup job", () => {
    const steps = savedBufferSteps([job("purification-subtractive", { columnId: "his-ni", bufferName: "IMAC cleanup", bufferPH: 7.5, bufferComponents: [tris, nacl] })]);
    assert.equal(steps.cleavage.pH, "7.5");
    assert.equal(steps.cleavage.purpose, "Cleavage — IMAC cleanup");
  });
});
