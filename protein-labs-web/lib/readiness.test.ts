import { test } from "vitest";
import assert from "node:assert/strict";
import { LOW_EXTINCTION_THRESHOLD_M1CM1, formatExtinction, isLowExtinction, resolveExtinctionThreshold } from "./readiness.ts";

test("default low-extinction threshold is 10,000 M⁻¹ cm⁻¹", () => {
  assert.equal(LOW_EXTINCTION_THRESHOLD_M1CM1, 10000);
  assert.equal(resolveExtinctionThreshold(undefined), 10000);
  assert.equal(resolveExtinctionThreshold(null), 10000);
  assert.equal(resolveExtinctionThreshold(""), 10000);
});

test("saved jobs with the old default of 10 migrate to 10,000", () => {
  assert.equal(resolveExtinctionThreshold(10), 10000);
  assert.equal(resolveExtinctionThreshold("10"), 10000);
});

test("a researcher's custom threshold is kept", () => {
  assert.equal(resolveExtinctionThreshold(5000), 5000);
  assert.equal(resolveExtinctionThreshold("12500"), 12500);
  assert.equal(resolveExtinctionThreshold(0), 0);
});

test("invalid saved thresholds fall back to the default", () => {
  assert.equal(resolveExtinctionThreshold("abc"), 10000);
  assert.equal(resolveExtinctionThreshold(-1), 10000);
  assert.equal(resolveExtinctionThreshold(Number.POSITIVE_INFINITY), 10000);
});

test("values below 10,000 are flagged; 10,000 and above are not", () => {
  assert.equal(isLowExtinction(1490), true); // ubiquitin: one Tyr, no Trp
  assert.equal(isLowExtinction(9999), true);
  assert.equal(isLowExtinction(10000), false);
  assert.equal(isLowExtinction(15470), false); // human HBB, reduced Cys
  assert.equal(isLowExtinction(null), false);
  assert.equal(isLowExtinction(15470, 20000), true);
});

test("extinction coefficients print with thousands separators and units", () => {
  assert.equal(formatExtinction(15470), "15,470 M⁻¹ cm⁻¹");
  assert.equal(formatExtinction(1490), "1,490 M⁻¹ cm⁻¹");
  assert.equal(formatExtinction(115_950), "115,950 M⁻¹ cm⁻¹");
  assert.equal(formatExtinction(15595, false), "15,595");
  assert.equal(formatExtinction(null), "Not available");
});
