// Most-abundant residue picking for the composition table. Run with
// `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { mostAbundantResidues } from "./residue-composition.ts";

const codes = (rows: { aa: string; count: number }[]) => [...mostAbundantResidues(rows)].sort();

describe("mostAbundantResidues", () => {
  it("picks the single residue with the highest count", () => {
    assert.deepEqual(codes([{ aa: "A", count: 15 }, { aa: "L", count: 18 }, { aa: "V", count: 13 }]), ["L"]);
  });

  it("returns every residue tied for the top count", () => {
    assert.deepEqual(codes([{ aa: "A", count: 9 }, { aa: "G", count: 12 }, { aa: "L", count: 12 }, { aa: "S", count: 12 }]), ["G", "L", "S"]);
  });

  it("does not count a near tie as a tie", () => {
    assert.deepEqual(codes([{ aa: "G", count: 12 }, { aa: "L", count: 11 }]), ["G"]);
  });

  it("has no winner when the composition is empty or all zero", () => {
    assert.deepEqual(codes([]), []);
    assert.deepEqual(codes([{ aa: "A", count: 0 }, { aa: "C", count: 0 }]), []);
  });

  it("ignores counts that are not finite numbers", () => {
    assert.deepEqual(codes([{ aa: "A", count: Number.NaN }, { aa: "C", count: 2 }, { aa: "D", count: Infinity }]), ["C"]);
  });
});
