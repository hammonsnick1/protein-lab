// Optimizing a crystallization hit: grid plates and technique notes. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { citations, citationScope } from "./citations.ts";
import {
  EXAMPLE_HIT, formatNumber, hitFromSaved, hitProblems, OPTIMIZATION_CITATIONS, optimizationPlate, phSteps, precipitantSteps,
  proteinSteps, TECHNIQUE_GROUPS, TECHNIQUES, techniqueHint, type HitCondition,
} from "./crystal-optimization.ts";
import type { CrystallizationProfile } from "./crystallization-guidance.ts";

const hit = (overrides: Partial<HitCondition> = {}): HitCondition => ({ ...EXAMPLE_HIT, ...overrides });
const profile = (overrides: Partial<CrystallizationProfile> = {}): CrystallizationProfile => ({
  residues: 260, massKDa: 29.2, membrane: "no", disorder: "no", ligands: [], cofactorReview: { status: "known", required: "No" }, pdbConditions: [], ...overrides,
});

describe("grid steps", () => {
  it("brackets the precipitant at 70–120 % in bench-sized steps", () => {
    assert.deepEqual(precipitantSteps(20), [14, 16, 18, 20, 22, 24]);
    assert.deepEqual(precipitantSteps(1.6), [1.1, 1.3, 1.4, 1.6, 1.8, 1.9]);
    assert.deepEqual(precipitantSteps(0.2), [0.14, 0.16, 0.18, 0.2, 0.22, 0.24]);
  });

  it("steps pH by 0.2 with the hit in row C, and protein from half to 1.5 ×", () => {
    assert.deepEqual(phSteps(7.5), [7.1, 7.3, 7.5, 7.7]);
    assert.deepEqual(proteinSteps(10), [5, 8, 10, 15]);
    assert.deepEqual(proteinSteps(20), [10, 15, 20, 30]);
  });
});

describe("optimization plates", () => {
  it("lays out a 4 × 6 precipitant-vs-pH plate with the hit in C4 and stock volumes for 500 µL", () => {
    const plate = optimizationPlate(hit(), "precipitant-ph");
    assert.ok(plate);
    assert.equal(plate.wells.length, 4);
    assert.ok(plate.wells.every((row) => row.length === 6));
    assert.deepEqual(plate.wells.flat().filter((well) => well.isHit).map((well) => well.id), ["C4"]);
    const c4 = plate.wells[2][3];
    assert.equal(c4.precipitant, 20);
    assert.equal(c4.pH, 7.5);
    assert.equal(c4.stockMicrolitres, 200); // 20 % from a 50 % stock in 500 µL
    assert.equal(plate.wells[0][0].id, "A1");
    assert.equal(plate.wells[0][0].stockMicrolitres, 140);
    assert.equal(plate.wells[3][5].pH, 7.7);
    assert.match(plate.constant.join(" "), /one buffer stock per row/);
    assert.match(plate.constant.join(" "), /0\.2 M ammonium sulfate/);
  });

  it("varies protein down the rows of plate 2 and keeps pH fixed", () => {
    const plate = optimizationPlate(hit(), "precipitant-protein");
    assert.ok(plate);
    assert.deepEqual(plate.rowValues, [5, 8, 10, 15]);
    assert.ok(plate.wells.flat().every((well) => well.pH === 7.5));
    assert.equal(plate.wells[2][3].isHit, true);
    assert.match(plate.constant[0], /pH 7\.5/);
  });

  it("offers no pH plate when the hit has no pH, but still the protein plate", () => {
    assert.equal(optimizationPlate(hit({ pH: null }), "precipitant-ph"), null);
    assert.ok(optimizationPlate(hit({ pH: null }), "precipitant-protein"));
  });

  it("refuses an unusable hit with a reason for each problem", () => {
    assert.deepEqual(hitProblems(EXAMPLE_HIT), []);
    assert.equal(optimizationPlate(hit({ concentration: 0 }), "precipitant-protein"), null);
    assert.match(hitProblems(hit({ stock: 22 })).join(" "), /more concentrated than the strongest well \(24 % \(w\/v\)\)/);
    assert.match(hitProblems(hit({ pH: 14 })).join(" "), /pH must be between 2 and 12/);
    assert.match(hitProblems(hit({ precipitant: " " })).join(" "), /Name the precipitant/);
    assert.match(hitProblems(hit({ unit: "% (v/v)", concentration: 120, stock: 100 })).join(" "), /cannot exceed 100 %/);
  });
});

describe("saved hit", () => {
  it("round-trips through the job config and rejects malformed values", () => {
    assert.deepEqual(hitFromSaved(JSON.parse(JSON.stringify(hit({ pH: null })))), hit({ pH: null }));
    assert.equal(hitFromSaved(undefined), null);
    assert.equal(hitFromSaved({ ...EXAMPLE_HIT, unit: "mM" }), null);
    assert.equal(hitFromSaved({ ...EXAMPLE_HIT, concentration: "20" }), null);
  });

  it("formats numbers without trailing zeros", () => {
    assert.equal(formatNumber(20), "20");
    assert.equal(formatNumber(7.30000001), "7.3");
    assert.equal(formatNumber(0.15), "0.15");
  });
});

describe("techniques", () => {
  it("covers every technique the brief names", () => {
    const ids = new Set(TECHNIQUES.map((technique) => technique.id));
    for (const id of ["microseeding", "streak", "macroseeding", "cross-seeding", "rmms", "drop-ratio", "temperature", "drop-format", "additives",
      "detergents", "protein-concentration", "ligand", "proteolysis", "ser", "silver-bullets", "oil"]) assert.ok(ids.has(id), id);
    for (const technique of TECHNIQUES) {
      assert.ok(TECHNIQUE_GROUPS.some((group) => group.id === technique.group), technique.id);
      assert.ok(technique.citations.length > 0 && technique.steps.length > 0, technique.id);
    }
  });

  it("cites only registered sources, all in the panel's reference list", () => {
    const scope = citationScope("opt", OPTIMIZATION_CITATIONS);
    for (const id of OPTIMIZATION_CITATIONS) {
      assert.ok(citations[id], id);
      assert.ok(scope.number(id) > 0);
    }
  });

  it("flags techniques that fit what earlier jobs recorded", () => {
    const byId = (id: string) => TECHNIQUES.find((technique) => technique.id === id)!;
    assert.equal(techniqueHint(byId("proteolysis"), profile()), null);
    assert.match(techniqueHint(byId("proteolysis"), profile({ disorder: "yes" })) ?? "", /Disordered/);
    assert.match(techniqueHint(byId("ligand"), profile({ ligands: ["Zn2+", "Zn2+"] })) ?? "", /record Zn2\+\.$/);
    assert.match(techniqueHint(byId("detergents"), profile({ membrane: "yes" })) ?? "", /membrane/);
    assert.equal(techniqueHint(byId("microseeding"), profile({ disorder: "yes", membrane: "yes" })), null);
  });
});
