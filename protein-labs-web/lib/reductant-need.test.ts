// When a buffer needs a reductant, and the TCEP-in-phosphate caveat. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { cleanupBuffers, secBuffers } from "./purification-stage-catalog.ts";
import { constructCysteines, cysteineCount, dropUnneededReductant, tcepInPhosphate } from "./reductant-need.ts";

// Human haemoglobin β (HBB, P68871): Cys93 and Cys112, so 2 Cys.
const hbb = "MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH";
// Human ubiquitin (P0CG48, residues 1–76): no cysteine.
const ubiquitin = "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG";

describe("cysteineCount", () => {
  it("counts Cys in published sequences", () => {
    assert.equal(cysteineCount(hbb), 2);
    assert.equal(cysteineCount(ubiquitin), 0);
    assert.equal(cysteineCount("mac c\n"), 2);
    assert.equal(cysteineCount(""), null);
    assert.equal(cysteineCount(undefined), null);
  });
});

describe("constructCysteines", () => {
  const construct = { cleaves: true, fusionSequence: `MGSSHHHHHHSSGENLYFQGC${ubiquitin}`, cleavedSequence: `GC${ubiquitin}` };
  it("reads the fusion before cleavage and the cleaved product after it", () => {
    assert.equal(constructCysteines({ ...construct, fusionSequence: `C${construct.fusionSequence}` }, ubiquitin), 2);
    assert.equal(constructCysteines({ ...construct, cleavedSequence: `G${ubiquitin}` }, hbb, true), 0);
    assert.equal(constructCysteines({ ...construct, cleaves: false }, ubiquitin, true), 1);
  });
  it("falls back to the protein sequence without a construct", () => {
    assert.equal(constructCysteines(null, hbb), 2);
    assert.equal(constructCysteines(undefined, ""), null);
  });
});

describe("dropUnneededReductant", () => {
  const hepes = secBuffers.find((preset) => preset.id === "sec-hepes")!.components;
  it("drops TCEP from the HEPES SEC preset only when the construct has no cysteines", () => {
    assert.deepEqual(dropUnneededReductant(hepes, 0).map((item) => item.name), ["HEPES", "NaCl"]);
    assert.equal(dropUnneededReductant(hepes, 2), hepes);
    assert.equal(dropUnneededReductant(hepes, null), hepes);
  });
  it("drops the reductant from every SEC and cleanup preset that has one", () => {
    for (const preset of [...secBuffers, ...cleanupBuffers]) assert.ok(!dropUnneededReductant(preset.components, 0).some((item) => /TCEP|DTT|mercapto/i.test(item.name)), preset.id);
  });
});

describe("tcepInPhosphate", () => {
  const tcep = { name: "TCEP", concentration: 1, unit: "mM", role: "Reducing agent" };
  it("flags TCEP with a phosphate base, not with HEPES or phosphate alone", () => {
    assert.ok(tcepInPhosphate([{ name: "Sodium phosphate", concentration: 50, unit: "mM", role: "Buffering" }, tcep]));
    assert.ok(tcepInPhosphate([{ name: "NaH2PO4", concentration: 20, unit: "mM", role: "Buffering" }, tcep]));
    assert.ok(!tcepInPhosphate([{ name: "HEPES", concentration: 20, unit: "mM", role: "Buffering" }, tcep]));
    assert.ok(!tcepInPhosphate([{ name: "Sodium phosphate", concentration: 50, unit: "mM", role: "Buffering" }]));
  });
});
