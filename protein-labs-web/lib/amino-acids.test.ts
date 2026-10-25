// Residue reference data for the composition detail window (HOM-213). Run
// with `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { aminoAcid, aminoAcids, preferredStructure, residueFamily, sideChainClassOrder, waterMassDa } from "./amino-acids.ts";

const ionizable = { D: 3.65, E: 4.25, H: 6.0, C: 8.18, Y: 10.07, K: 10.53, R: 12.48 } as Record<string, number>;

describe("amino-acid reference data", () => {
  it("covers each of the 20 standard residues once", () => {
    assert.deepEqual(aminoAcids.map((acid) => acid.code).sort().join(""), "ACDEFGHIKLMNPQRSTVWY");
    assert.equal(new Set(aminoAcids.map((acid) => acid.three)).size, 20);
  });

  it("fills every field for every residue", () => {
    for (const acid of aminoAcids) {
      assert.match(acid.three, /^[A-Z][a-z]{2}$/, acid.code);
      assert.ok(acid.name.length > 3, acid.code);
      assert.ok(acid.classes.length > 0 && acid.classes.every((value) => sideChainClassOrder.includes(value)), acid.code);
      assert.ok(acid.classes.includes(acid.family), `${acid.code} family is one of its chips`);
      assert.ok(acid.residueMassDa > 57 && acid.residueMassDa < 187, acid.code);
      assert.ok(acid.kyteDoolittle >= -4.5 && acid.kyteDoolittle <= 4.5, acid.code);
      assert.ok(acid.pKaCarboxyl > 1.5 && acid.pKaCarboxyl < 2.5, acid.code);
      assert.ok(acid.pKaAmino > 8.5 && acid.pKaAmino < 11, acid.code);
      assert.ok(acid.locationNote.endsWith("."), acid.code);
      for (const value of Object.values(acid.chouFasman)) assert.ok(value > 0.3 && value < 1.8, acid.code);
      assert.ok(acid.facts.length >= 2 && acid.facts.length <= 3, acid.code);
      for (const fact of acid.facts) assert.ok(fact.length > 20 && fact.endsWith("."), `${acid.code}: ${fact}`);
    }
  });

  it("gives a side-chain pKa only to the seven ionizable residues", () => {
    for (const acid of aminoAcids) {
      assert.equal(acid.pKaSideChain, ionizable[acid.code] ?? null, acid.code);
      assert.equal(Boolean(acid.sideChainGroup), acid.code in ionizable, acid.code);
    }
  });

  it("matches the ProtParam residue masses for a reference peptide", () => {
    // Free glycine is 75.07 Da; a peptide is its residues plus one water.
    assert.equal((aminoAcid("G")!.residueMassDa + waterMassDa).toFixed(2), "75.07");
    const peptide = "GAVLIW".split("").reduce((sum, code) => sum + aminoAcid(code)!.residueMassDa, waterMassDa);
    assert.equal(peptide.toFixed(2), "657.80"); // Biopython ProteinAnalysis("GAVLIW").molecular_weight()
    assert.equal(aminoAcid("L")!.residueMassDa, aminoAcid("I")!.residueMassDa);
  });

  it("keeps the published scale extremes", () => {
    const byHydropathy = [...aminoAcids].sort((a, b) => a.kyteDoolittle - b.kyteDoolittle);
    assert.equal(byHydropathy[0].code, "R");
    assert.equal(byHydropathy[19].code, "I");
    assert.equal(preferredStructure(aminoAcid("E")!), "helix");
    assert.equal(preferredStructure(aminoAcid("V")!), "sheet");
    assert.equal(preferredStructure(aminoAcid("G")!), "turn");
  });

  it("draws a connected structure with the side chain marked", () => {
    for (const acid of aminoAcids) {
      const ids = new Set(acid.structure.atoms.map((atom) => atom.id));
      assert.equal(ids.size, acid.structure.atoms.length, `${acid.code} atom ids are unique`);
      assert.ok(acid.structure.atoms.some((atom) => atom.sideChain), `${acid.code} has a side chain`);
      for (const bond of acid.structure.bonds) {
        assert.ok(ids.has(bond.from) && ids.has(bond.to), `${acid.code} ${bond.from}-${bond.to}`);
        const [a, b] = [bond.from, bond.to].map((id) => acid.structure.atoms.find((atom) => atom.id === id)!);
        assert.ok(Math.abs(Math.hypot(a.x - b.x, a.y - b.y) - 1) < 0.01, `${acid.code} ${bond.from}-${bond.to} has unit length`);
      }
      // Every atom is reachable from Cα.
      const seen = new Set(["CA"]);
      for (let grown = true; grown;) {
        grown = false;
        for (const bond of acid.structure.bonds) for (const [x, y] of [[bond.from, bond.to], [bond.to, bond.from]]) if (seen.has(x) && !seen.has(y)) { seen.add(y); grown = true; }
      }
      assert.equal(seen.size, ids.size, `${acid.code} is connected`);
    }
  });

  it("looks residues up case-insensitively and leaves non-standard letters alone", () => {
    assert.equal(aminoAcid("w")?.name, "Tryptophan");
    assert.equal(aminoAcid("X"), undefined);
    assert.equal(residueFamily("U"), "other");
    assert.equal(residueFamily("K"), "basic");
  });
});
