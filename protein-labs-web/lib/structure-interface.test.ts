// Chain-interface detection for the Structure Viewer. Run with `npm run test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { coloringLegend, MUTED_RESIDUE_COLOR } from "./structure-coloring.ts";
import { clampCutoff, DEFAULT_INTERFACE_CUTOFF, findInterfaces, interfaceChainColor, interfaceColoring, interfaceResiduesByChain, type InterfaceAtom } from "./structure-interface.ts";

const atom = (chain: string, seq: number, x: number, y = 0, z = 0): InterfaceAtom => ({ chain, seq, x, y, z });

describe("findInterfaces", () => {
  it("finds residues on both sides within the cutoff and ignores contacts inside one chain", () => {
    const result = findInterfaces([
      atom("A", 1, 0), atom("A", 2, 10), atom("A", 3, 1),
      atom("B", 7, 4.4), atom("B", 8, 30),
    ]);
    assert.equal(result.cutoff, DEFAULT_INTERFACE_CUTOFF);
    assert.deepEqual(result.chains, ["A", "B"]);
    assert.equal(result.pairs.length, 1);
    assert.deepEqual(result.pairs[0].chains, ["A", "B"]);
    // A1 (4.4 Å) and A3 (3.4 Å) touch B7; A2 is 5.6 Å away.
    assert.deepEqual(result.pairs[0].residues, [[1, 3], [7]]);
    assert.ok(Math.abs(result.pairs[0].minDistance - 3.4) < 1e-9);
  });

  it("counts a contact exactly at the cutoff and not just beyond it", () => {
    assert.equal(findInterfaces([atom("A", 1, 0), atom("B", 1, 4.5)], 4.5).pairs.length, 1);
    assert.equal(findInterfaces([atom("A", 1, 0), atom("B", 1, 4.5001)], 4.5).pairs.length, 0);
  });

  it("finds contacts across grid cells in every direction, including negative coordinates", () => {
    const result = findInterfaces([atom("A", 1, -0.1, -0.1, -0.1), atom("B", 2, 2, 2, 2), atom("C", 3, -2.2, 2.3, -2.1)], 4.5);
    assert.deepEqual(result.pairs.map((pair) => pair.chains.join("")), ["AB", "AC"]);
  });

  it("reports nothing for a single chain or an empty structure", () => {
    assert.deepEqual(findInterfaces([atom("A", 1, 0), atom("A", 2, 1)]).pairs, []);
    assert.deepEqual(findInterfaces([]), { cutoff: DEFAULT_INTERFACE_CUTOFF, chains: [], pairs: [] });
  });

  it("keeps chain pairs in structure order, not alphabetical order", () => {
    const result = findInterfaces([atom("D", 1, 0), atom("B", 1, 3)]);
    assert.deepEqual(result.chains, ["D", "B"]);
    assert.deepEqual(result.pairs[0].chains, ["D", "B"]);
  });

  it("matches an independent Biopython NeighborSearch on hemoglobin 4HHB (α2β2)", () => {
    const fixture = JSON.parse(readFileSync(new URL("./structure-interface.4hhb.json", import.meta.url), "utf8")) as { atoms: [string, number, number, number, number][] };
    const atoms = fixture.atoms.map(([chain, seq, x, y, z]) => ({ chain, seq, x, y, z }));
    const result = findInterfaces(atoms, 4.5);
    // Expected counts from Bio.PDB.NeighborSearch(heavy atoms).search_all(4.5) on the full entry.
    assert.deepEqual(result.pairs.map((pair) => [pair.chains.join(""), pair.residues[0].length, pair.residues[1].length]), [
      ["AB", 20, 21], ["AC", 5, 4], ["AD", 14, 15], ["BC", 15, 14], ["CD", 20, 21],
    ]);
    assert.deepEqual(result.pairs[0].residues[0].slice(0, 8), [30, 31, 34, 35, 36, 103, 104, 106]);
    // A wider cutoff only ever adds residues.
    const wider = findInterfaces(atoms, 6);
    for (const [index, pair] of result.pairs.entries()) for (const side of [0, 1] as const) assert.ok(pair.residues[side].every((seq) => wider.pairs[index].residues[side].includes(seq)));
  });
});

describe("interface colouring", () => {
  const result = findInterfaces([atom("A", 1, 0), atom("B", 5, 3), atom("B", 6, 30), atom("C", 9, 33)]);

  it("merges each chain's residues across partners", () => {
    assert.deepEqual([...interfaceResiduesByChain(result)], [["A", [1]], ["B", [5, 6]], ["C", [9]]]);
  });

  it("gives each chain its own colour and greys out the rest", () => {
    const coloring = interfaceColoring(result, (chain) => `${chain}*`);
    assert.equal(coloring.title, "Chain interface (4.5 Å)");
    assert.deepEqual(coloring.groups.map((group) => group.label), ["Chain A* interface", "Chain B* interface", "Chain C* interface"]);
    assert.equal(new Set(coloring.groups.map((group) => group.color)).size, 3);
    assert.equal(coloring.groups[1].color, interfaceChainColor(result, "B"));
    assert.deepEqual(coloring.groups[1].residues, [{ labelAsymId: "B", labelSeqId: 5 }, { labelAsymId: "B", labelSeqId: 6 }]);
    assert.deepEqual(coloringLegend(coloring).at(-1), { key: "base", label: "Not at an interface", color: MUTED_RESIDUE_COLOR });
  });
});

describe("clampCutoff", () => {
  it("snaps to the slider range and step", () => {
    assert.equal(clampCutoff(4.6), 4.5);
    assert.equal(clampCutoff(1), 3);
    assert.equal(clampCutoff(9), 6);
    assert.equal(clampCutoff(Number.NaN), DEFAULT_INTERFACE_CUTOFF);
  });
});
