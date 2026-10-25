// The viewer's colour legends against Mol*'s own themes. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { Color } from "molstar/lib/mol-util/color/color.js";
import { SecondaryStructureColors } from "molstar/lib/mol-theme/color/secondary-structure.js";
import { SECONDARY_STRUCTURE_LEGEND, SECONDARY_STRUCTURE_NOT_SHOWN } from "./structure-legends.ts";

describe("secondary-structure legend", () => {
  const molstar = SecondaryStructureColors as unknown as Record<string, number>;

  it("explains every colour Mol* can give the polymer, and nothing else", () => {
    const shown = SECONDARY_STRUCTURE_LEGEND.map((entry) => entry.key).sort();
    const expected = Object.keys(molstar).filter((key) => !SECONDARY_STRUCTURE_NOT_SHOWN.includes(key)).sort();
    assert.deepEqual(shown, expected);
  });

  it("includes π-helices and bends", () => {
    const keys = SECONDARY_STRUCTURE_LEGEND.map((entry) => entry.key);
    assert.ok(keys.includes("piHelix"));
    assert.ok(keys.includes("bend"));
  });

  it("uses the colours Mol* draws (its default saturation of -1)", () => {
    for (const entry of SECONDARY_STRUCTURE_LEGEND) assert.equal(entry.color, Color.toHexStyle(Color.saturate(molstar[entry.key] as Color, -1)), entry.key);
  });

  it("has distinct, unique labels", () => {
    assert.equal(new Set(SECONDARY_STRUCTURE_LEGEND.map((entry) => entry.label)).size, SECONDARY_STRUCTURE_LEGEND.length);
    assert.equal(new Set(SECONDARY_STRUCTURE_LEGEND.map((entry) => entry.color)).size, SECONDARY_STRUCTURE_LEGEND.length);
  });
});
