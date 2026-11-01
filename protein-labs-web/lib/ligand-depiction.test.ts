// 2D ↔ 3D ligand sync for the Structure Viewer. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { depictionAtoms, depictionErrorHint, depictionQuery, doubleBondLabels, drawableLigands, ligandForPick, ligandKey, nearestAtom, regionForLigand, regionLigand, svgViewBox, type LigandDepiction } from "./ligand-depiction.ts";
import type { StructureLigand, StructureRegion } from "./structure-regions.ts";

// The engine's answer for (S)-ibuprofen B 2002 in 2BXG (backend fixture), without the SVG.
const ibuprofen: LigandDepiction = {
  source: "pdb", structureId: "2BXG", ligand: { ccdId: "IBP", chainId: "B", authSeqId: "2002", insertionCode: null },
  svg: "<?xml version='1.0'?><svg version='1.1' width='500px' height='350px' viewBox='0 0 500 350'></svg>",
  atomIndexToPdbAtomName: { 0: "C1", 1: "C2", 2: "C3", 3: "C4", 4: "C5", 5: "C6", 6: "C7", 7: "C8", 8: "C9", 9: "C10", 10: "C11", 11: "C12", 12: "C13", 13: "O1", 14: "O2" },
  atomCoordinates: { 0: [110.6, 203.3], 1: [380.7, 134.0], 2: [414.3, 184.7], 3: [475.0, 181.0], 4: [387.1, 239.1], 5: [137.8, 148.9], 6: [104.2, 98.1], 7: [198.5, 145.1], 8: [225.6, 90.7], 9: [286.4, 87.0], 10: [320.0, 137.7], 11: [292.8, 192.1], 12: [232.1, 195.9], 13: [49.9, 207.1], 14: [144.2, 254.1] },
  bondIndexToPdbAtomNames: { 0: ["C1", "C6"], 7: ["C6", "C7"] },
  stereo: { method: "", cipLabels: { 5: "S" }, doubleBondLabels: {}, wedgeBonds: [{ from: "C6", to: "C7", style: "wedge" }], ccdDisagreements: [] },
};

function ligand(ccdId: string, chainId: string, authSeqId: string, classification = "ligand", fields: Partial<StructureLigand> = {}): StructureLigand {
  return { ccdId, name: null, chainId, labelChainId: `${chainId}x`, authSeqId, insertionCode: null, classification, ...fields };
}

function site(metadata: Record<string, unknown>): StructureRegion {
  return { id: `ligand:${String(metadata.chainId)}:${String(metadata.authSeqId)}`, type: "ligand_binding_site", label: "", description: "", defaultVisible: true, residues: [], metadata };
}

describe("ligand depiction", () => {
  it("lists every drawn atom by PDB name with its point and R/S label", () => {
    const atoms = depictionAtoms(ibuprofen);
    assert.equal(atoms.length, 15);
    assert.deepEqual(atoms[5], { index: 5, name: "C6", x: 137.8, y: 148.9, cip: "S", disagreement: null });
    assert.deepEqual(atoms.filter((atom) => atom.cip).map((atom) => atom.name), ["C6"]);
  });

  it("picks the atom under a click and nothing between atoms", () => {
    const atoms = depictionAtoms(ibuprofen);
    assert.equal(nearestAtom(atoms, 140, 150, 16)?.name, "C6");
    assert.equal(nearestAtom(atoms, 52, 205, 16)?.name, "O1");
    // Half-way along the C6–C8 bond (~60 units long) is 30 from both: no atom.
    assert.equal(nearestAtom(atoms, 168, 147, 16), null);
  });

  it("cannot hit-test an engine that sends no coordinates, but still lists the atoms", () => {
    const atoms = depictionAtoms({ ...ibuprofen, atomCoordinates: undefined });
    assert.equal(atoms.length, 15);
    assert.equal(nearestAtom(atoms, 137.8, 148.9, 16), null);
  });

  it("names flagged CCD disagreements on the atom", () => {
    const atoms = depictionAtoms({ ...ibuprofen, stereo: { ...ibuprofen.stereo, cipLabels: { 5: "R" }, ccdDisagreements: [{ pdbAtomName: "C6", deposited: "R", ccd: "S" }] } });
    assert.deepEqual(atoms[5].disagreement, { pdbAtomName: "C6", deposited: "R", ccd: "S" });
  });

  it("names E/Z double bonds by their two atoms", () => {
    const retinal = { ...ibuprofen, bondIndexToPdbAtomNames: { 10: ["C7", "C8"] as [string, string], 12: ["C9", "C10"] as [string, string] }, stereo: { ...ibuprofen.stereo, doubleBondLabels: { 10: "E", 12: "E", 99: "Z" } } };
    assert.deepEqual(doubleBondLabels(retinal), [{ atoms: ["C7", "C8"], label: "E" }, { atoms: ["C9", "C10"], label: "E" }]);
  });

  it("reads the drawing size from the viewBox", () => {
    assert.deepEqual(svgViewBox(ibuprofen.svg), { width: 500, height: 350 });
    assert.deepEqual(svgViewBox("<svg viewBox=\"0 0 640 480\"/>"), { width: 640, height: 480 });
  });

  it("asks the engine for exactly one instance, with the insertion code only when there is one", () => {
    assert.equal(depictionQuery({ ccdId: "IBP", chainId: "B", authSeqId: "2002", insertionCode: null }), "chainId=B&authSeqId=2002&ccdId=IBP");
    assert.equal(depictionQuery({ ccdId: "NAG", chainId: "A", authSeqId: "501", insertionCode: "B" }), "chainId=A&authSeqId=501&ccdId=NAG&insertionCode=B");
  });
});

describe("ligand selection", () => {
  const entry = [ligand("IBP", "A", "2001"), ligand("IBP", "B", "2002"), ligand("IBP", "B", "2002"), ligand("HOH", "A", "3001", "water"), ligand("GOL", "A", "4001", "common_additive")];

  it("keeps each instance once, leaves out waters, and lists additives only on request", () => {
    assert.deepEqual(drawableLigands(entry).map(ligandKey), ["A:2001:IBP", "B:2002:IBP"]);
    assert.deepEqual(drawableLigands(entry, { showAdditives: true }).map(ligandKey), ["A:2001:IBP", "B:2002:IBP", "A:4001:GOL"]);
  });

  it("matches a 3D click to its instance by chain, number, insertion code and code", () => {
    const ligands = drawableLigands(entry);
    assert.equal(ligandForPick(ligands, { chainId: "B", authSeqId: "2002", insertionCode: null, ccdId: "IBP", atomName: "C6" })?.labelChainId, "Bx");
    // Same number, other chain: a different instance, never the nearest guess.
    assert.equal(ligandForPick(ligands, { chainId: "C", authSeqId: "2002", insertionCode: null, ccdId: "IBP", atomName: "C6" }), null);
    assert.equal(ligandForPick(ligands, { chainId: "A", authSeqId: "3001", insertionCode: null, ccdId: "HOH", atomName: "O" }), null);
  });

  it("links a binding-site region and its ligand both ways", () => {
    const regions = [site({ ccdId: "IBP", chainId: "A", labelChainId: "Ax", authSeqId: "2001", insertionCode: null, name: "IBUPROFEN" }), site({ ccdId: "IBP", chainId: "B", labelChainId: "Bx", authSeqId: 2002, insertionCode: "" })];
    assert.deepEqual(regionLigand(regions[1]), { ccdId: "IBP", name: null, chainId: "B", labelChainId: "Bx", authSeqId: "2002", insertionCode: null });
    assert.equal(regionForLigand(regions, drawableLigands(entry)[1]), regions[1]);
    assert.equal(regionLigand({ ...regions[0], type: "cysteines" }), null);
  });

  it("explains engine refusals in plain words", () => {
    assert.match(depictionErrorHint("Ligand depictions are available only for experimental PDB entries; AlphaFold DB models contain no ligands", null) ?? "", /AlphaFold models contain no ligands/);
    assert.match(depictionErrorHint("Ligand HEM A 154 is missing deposited coordinates for CCD atom(s): C1A.", null) ?? "", /not modelled/);
    assert.match(depictionErrorHint("PDB Chemical Component Dictionary has no definition for XYZ", null) ?? "", /no entry for this code/);
    assert.equal(depictionErrorHint("Something else", null), null);
  });
});
