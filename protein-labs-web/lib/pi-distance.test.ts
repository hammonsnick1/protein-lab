// Buffer pH against the pI: warn under 1 unit, block under 0.5, fusion pI for capture. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { captureSteps, constructPIs, pIBufferChecks, pIDistanceLevel } from "./pi-distance.ts";

// CA2 with the house His6–TEV layout (HOM-381 report §3.10): fusion pI 6.51, cleaved product pI 6.94.
const ca2 = { cleaves: true, fusionProperties: { pI: 6.51, massDa: 31990 }, cleavedProperties: { pI: 6.94 } };

describe("pI distance rule", () => {
  it("warns under 1.0 pH unit and blocks under 0.5", () => {
    assert.equal(pIDistanceLevel(8.0, 6.51), "pass");
    assert.equal(pIDistanceLevel(7.5, 6.51), "warning"); // 0.99 unit
    assert.equal(pIDistanceLevel(7.2, 6.94), "error"); // 0.26 unit
    assert.equal(pIDistanceLevel(5.5, 6.51), "pass"); // 1.01 unit, below the pI
  });

  it("puts the boundaries on the safe side of each line", () => {
    // Floating-point 7.5 - 6.5 is exact, but 7.3 - 6.3 is 0.9999999999999991.
    assert.equal(pIDistanceLevel(7.5, 6.5), "pass");
    assert.equal(pIDistanceLevel(7.3, 6.3), "pass");
    assert.equal(pIDistanceLevel(7.0, 6.5), "warning");
    assert.equal(pIDistanceLevel(6.99, 6.5), "error");
  });

  it("uses the fusion pI for capture and the cleaved product's pI downstream", () => {
    const { capture, downstream } = constructPIs(ca2, 7.1);
    assert.deepEqual(capture, { pI: 6.51, species: "fusion" });
    assert.deepEqual(downstream, { pI: 6.94, species: "cleaved product" });
    assert.deepEqual(captureSteps, ["lysis", "binding", "wash", "elution"]);
  });

  it("keeps the fusion pI downstream when the tag is retained", () => {
    const { downstream } = constructPIs({ cleaves: false, fusionProperties: { pI: 6.51 }, cleavedProperties: null }, 7.1);
    assert.deepEqual(downstream, { pI: 6.51, species: "fusion" });
  });

  it("falls back to the target's pI without a construct, and to nothing without either", () => {
    assert.deepEqual(constructPIs(undefined, 7.1), { capture: { pI: 7.1, species: "target" }, downstream: { pI: 7.1, species: "target" } });
    assert.deepEqual(constructPIs({ cleaves: true, fusionProperties: { pI: 0 } }, Number.NaN), { capture: null, downstream: null });
  });

  it("lists each offending buffer under one blocking and one warning finding", () => {
    const { capture, downstream } = constructPIs(ca2, null);
    const checks = pIBufferChecks([
      { step: "Binding", pH: 7.5, reference: capture },
      { step: "Wash", pH: 8.0, reference: capture },
      { step: "SEC / storage", pH: 7.2, reference: downstream },
    ]);
    assert.deepEqual(checks.map((check) => [check.level, check.title]), [["error", "Buffer pH is too close to the pI"], ["warning", "Buffer pH is close to the pI"]]);
    assert.match(checks[0].detail, /^SEC \/ storage pH 7\.2 is 0\.26 unit from the cleaved product pI 6\.94\./);
    assert.match(checks[1].detail, /^Binding pH 7\.5 is 0\.99 unit from the fusion pI 6\.51\./);
    assert.doesNotMatch(checks.map((check) => check.detail).join(" "), /Wash/);
  });

  it("passes when every buffer clears one unit, and says nothing when nothing can be checked", () => {
    const { capture } = constructPIs(ca2, null);
    const checks = pIBufferChecks([{ step: "Binding", pH: 8.0, reference: capture }, { step: "Elution", pH: null, reference: capture }]);
    assert.deepEqual(checks.map((check) => check.level), ["pass"]);
    assert.match(checks[0].detail, /fusion pI 6\.51/);
    assert.deepEqual(pIBufferChecks([{ step: "Binding", pH: 7.5, reference: null }]), []);
  });
});
