// One selector for native / fusion / cleaved / assembly numbers. Run with
// `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { JsonObject, ProjectJob, ProteinBundle } from "./protein-labs-api.ts";
import { constructNumbers, secMassKDa, sequencesToAnalyse, type SpeciesNumbers } from "./construct-numbers.ts";

const target = "SHHWGYGKHNGPEHWHKDFPIAKGERQSPVDIDT";

function job(appType: string, config: JsonObject): ProjectJob {
  return { id: appType, proteinId: "p1", name: appType, appType, status: "complete", config, createdAt: "", updatedAt: "" };
}
function bundle(jobs: ProjectJob[], protparam: JsonObject | null = { molecularWeightDa: 29245.98, theoreticalPI: 6.87, extinctionCoefficient280: { reducedMolarM1Cm1: 50420, oxidizedMolarM1Cm1: 50420 } }): ProteinBundle {
  return { protein: { id: "p1", name: "CA2", sequence: target }, protparam: protparam ? { result: protparam } : null, projectJobs: jobs } as unknown as ProteinBundle;
}
// The shape `constructSummary` saves: ConstructMetrics objects, not flat fields.
const savedConstruct = {
  tagName: "His6", cleaves: true, scar: "GGA", fusionSequence: "M".repeat(283), cleavedSequence: "G".repeat(263),
  fusionProperties: { lengthAa: 283, massDa: 31990.12, pI: 6.51, extinctionReduced: 53400, extinctionOxidized: 53525 },
  cleavedProperties: { lengthAa: 263, massDa: 29430.4, pI: 6.94, extinctionReduced: 50420, extinctionOxidized: 50545 },
};
const tetramer = job("protparam", { oligomericState: { kind: "homotetramer" } });

describe("constructNumbers", () => {
  it("reads the saved construct, not native plus a reference tag", () => {
    const numbers = constructNumbers(bundle([job("purification-cleavage", { proteaseId: "tev", construct: savedConstruct })]));
    assert.equal(numbers.constructSource, "saved");
    assert.equal(numbers.fusion?.massDa, 31990.12);
    assert.equal(numbers.fusion?.extinctionReduced, 53400);
    assert.equal(numbers.cleaved?.massDa, 29430.4);
    assert.equal(numbers.purified, numbers.cleaved);
    assert.equal(numbers.purifiedSpecies, "cleaved product");
    assert.equal(numbers.native?.massDa, 29245.98);
    assert.equal(numbers.scar, "GGA");
    assert.equal(numbers.assembly, null);
  });

  it("falls back to the affinity job's construct and keeps the tag when nothing cleaves", () => {
    const numbers = constructNumbers(bundle([job("purification-affinity", { construct: { ...savedConstruct, cleaves: false } })]));
    assert.equal(numbers.cleaves, false);
    assert.equal(numbers.cleaved, null);
    assert.equal(numbers.purified?.massDa, 31990.12);
    assert.equal(numbers.purifiedSpecies, "tagged fusion");
  });

  it("scales the purified chain by a recorded homo-oligomer for SEC", () => {
    const numbers = constructNumbers(bundle([tetramer, job("purification-cleavage", { construct: savedConstruct })]));
    assert.equal(numbers.subunits, 4);
    assert.equal(numbers.assemblyLabel, "Homotetramer");
    assert.equal(numbers.assembly?.massDa, 29430.4 * 4);
    assert.equal(numbers.assembly?.extinctionReduced, 50420 * 4);
    assert.equal(secMassKDa(numbers), 117.72);
  });

  it("sizes SEC for the native assembly when no construct is planned (HBB 16 → 64 kDa)", () => {
    const hbb = bundle([tetramer], { molecularWeightDa: 15998.21, extinctionCoefficient280: { reducedMolarM1Cm1: 15470, oxidizedMolarM1Cm1: 15595 } });
    const numbers = constructNumbers(hbb);
    assert.equal(numbers.constructSource, "none");
    assert.equal(numbers.purifiedSpecies, "native chain");
    assert.equal(secMassKDa(numbers), 63.99);
  });

  it("does not scale a hetero-complex or an unknown state", () => {
    const hetero = job("protparam", { oligomericState: { kind: "hetero-complex", complexNote: "α2β2 with HBA" } });
    assert.equal(constructNumbers(bundle([hetero])).assembly, null);
    assert.equal(secMassKDa(constructNumbers(bundle([hetero]))), 29.25);
    assert.equal(constructNumbers(bundle([job("protparam", { oligomericState: { kind: "unknown" } })])).assembly, null);
  });

  it("assembles the planned construct and asks for its numbers until one is saved", () => {
    const planned = bundle([job("purification-affinity", { tag: "6×His / polyhistidine" }), job("purification-cleavage", { proteaseId: "tev" })]);
    const pending = sequencesToAnalyse(planned);
    assert.equal(pending.length, 2);
    const [fusion, cleaved] = pending;
    assert.match(fusion, /^MHHHHHH.*ENLYFQG.*SHHWGYG/);
    assert.ok(cleaved.endsWith(target) && cleaved.length < fusion.length);
    const waiting = constructNumbers(planned);
    assert.equal(waiting.constructSource, "planned");
    assert.equal(waiting.fusion, null);
    assert.equal(waiting.cleaves, true);
    const analysed = new Map<string, SpeciesNumbers>([
      [fusion, { residues: fusion.length, massDa: 6000, pI: 7, extinctionReduced: 9000, extinctionOxidized: 9000 }],
      [cleaved, { residues: cleaved.length, massDa: 4100, pI: 7, extinctionReduced: 7500, extinctionOxidized: 7500 }],
    ]);
    const numbers = constructNumbers(planned, analysed);
    assert.equal(numbers.fusion?.massDa, 6000);
    assert.equal(numbers.purified?.massDa, 4100);
    // A saved construct needs no engine call.
    assert.deepEqual(sequencesToAnalyse(bundle([job("purification-affinity", { tag: "6×His", construct: savedConstruct })])), []);
  });

  it("reports a large fusion partner without a sequence instead of guessing", () => {
    const numbers = constructNumbers(bundle([job("purification-affinity", { tag: "GST" })]));
    assert.equal(numbers.unresolvedTag, "GST");
    assert.equal(numbers.constructSource, "none");
    assert.deepEqual(sequencesToAnalyse(bundle([job("purification-affinity", { tag: "GST" })])), []);
  });

  it("still reads constructs saved with flat mass fields", () => {
    const numbers = constructNumbers(bundle([job("purification-cleavage", { construct: { fusionLength: 163, fusionMassDa: 18321.7, fusionExtinction: 15470, cleavedLength: 144, cleavedMassDa: 16141.38, cleavedExtinction: 15470 } })]));
    assert.equal(numbers.cleaves, true);
    assert.equal(numbers.fusion?.residues, 163);
    assert.equal(numbers.cleaved?.massDa, 16141.38);
  });
});
