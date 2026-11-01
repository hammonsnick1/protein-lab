// NMR sample preparation (HOM-374): size advice and protein amounts per tube.
// Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { formatMg, NMR_TUBES, proteinMassMg, sizeTier, SIZE_LIMITS_KDA, tubeRequirements } from "./nmr-sample-prep.ts";

describe("sizeTier", () => {
  it("keeps small proteins on an ordinary HSQC", () => {
    assert.equal(sizeTier(8.6), "standard");
    assert.equal(sizeTier(24.9), "standard");
  });
  it("recommends TROSY from the lower bound", () => {
    assert.equal(sizeTier(SIZE_LIMITS_KDA.trosy), "trosy");
    assert.equal(sizeTier(32), "trosy");
  });
  it("asks for deuteration from the upper bound", () => {
    assert.equal(sizeTier(SIZE_LIMITS_KDA.deuterate), "deuterate");
    assert.equal(sizeTier(120), "deuterate");
  });
});

describe("protein amounts", () => {
  it("multiplies concentration, volume and mass", () => {
    // 1 mM of a 20 kDa protein in 500 µL: 0.5 µmol × 20 000 g/mol = 10 mg.
    assert.equal(proteinMassMg(20, 1, 500), 10);
    assert.ok(Math.abs(proteinMassMg(15, 0.1, 160) - 0.24) < 1e-12);
  });
  it("gives one row per tube at the larger working volume", () => {
    const rows = tubeRequirements(10);
    assert.deepEqual(rows.map((row) => row.tube.id), NMR_TUBES.map((tube) => tube.id));
    const expected = [[0.6, 6], [0.3, 3], [0.2, 2]];
    rows.forEach((row, index) => {
      assert.ok(Math.abs(row.lowMg - expected[index][0]) < 1e-9);
      assert.ok(Math.abs(row.highMg - expected[index][1]) < 1e-9);
    });
  });
  it("formats milligrams for the table", () => {
    assert.equal(formatMg(0.004), "< 0.01 mg");
    assert.equal(formatMg(0.316), "0.32 mg");
    assert.equal(formatMg(4.125), "4.1 mg");
    assert.equal(formatMg(16.5), "17 mg");
  });
});
