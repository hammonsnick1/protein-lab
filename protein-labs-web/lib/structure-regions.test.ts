// Region-to-selection conversion for the Structure Viewer. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { regionSections, regionSelection, residueLabel, stepRegion, structureOptionLabel, type MappedResidue, type StructureRegion } from "./structure-regions.ts";

function row(labelChainId: string | null, labelSeqId: number | null, fields: Partial<MappedResidue> = {}): MappedResidue {
  return { constructPosition: null, uniprotPosition: labelSeqId, chainId: labelChainId, labelChainId, labelSeqId, authSeqId: labelSeqId == null ? null : String(labelSeqId), insertionCode: null, structureResidue: "C", modeled: true, ...fields };
}

function region(id: string, type: string, residues: MappedResidue[], metadata: Record<string, unknown> = {}): StructureRegion {
  return { id, type, label: id, description: "", defaultVisible: true, residues, metadata };
}

// 1CA2 zinc site as returned by the engine: auth chain A, label chain B for the ion.
const zinc = region("ligand:A:262::ZN:1", "ligand_binding_site", [row("A", 92), row("A", 94), row("A", 117)], { ccdId: "ZN", chainId: "A", labelChainId: "B", authSeqId: "262", insertionCode: null, classification: "ligand" });
const water = region("ligand:A:301::HOH:2", "ligand_binding_site", [row("A", 5)], { ccdId: "HOH", chainId: "A", labelChainId: "C", authSeqId: "301", insertionCode: null, classification: "water" });
const cysteines = region("cysteines", "cysteines", [row("A", 3), row("A", 4), row("A", 40)]);
const disulfide = region("disulfide:A:3:A:40", "disulfide", [row("A", 3), row("A", 40)]);
const domain = region("reference_domain:1", "reference_domain", [row("A", 10), row("A", 11)]);

describe("regionSections", () => {
  it("orders sections cysteines first and hides waters and additives by default", () => {
    const sections = regionSections([domain, water, zinc, disulfide, cysteines]);
    assert.deepEqual(sections.map((section) => section.key), ["cysteines", "ligands", "reference"]);
    assert.deepEqual(sections[0].regions.map((item) => item.id), ["disulfide:A:3:A:40", "cysteines"]);
    assert.deepEqual(sections[1].regions.map((item) => item.id), ["ligand:A:262::ZN:1"]);
  });

  it("lists one entry per ligand instance, waters included on request", () => {
    const sections = regionSections([zinc, water], { showAdditives: true });
    assert.equal(sections[0].regions.length, 2);
  });

  it("keeps region types it does not know about instead of dropping them", () => {
    const sections = regionSections([region("x", "future_type", [row("A", 1)])]);
    assert.equal(sections[0].key, "other");
  });
});

describe("stepRegion", () => {
  const sections = regionSections([cysteines, disulfide, zinc]);
  it("walks forward and wraps", () => {
    assert.equal(stepRegion(sections, null, 1), "cysteines");
    assert.equal(stepRegion(sections, "cysteines", 1), "disulfide:A:3:A:40");
    assert.equal(stepRegion(sections, "ligand:A:262::ZN:1", 1), "cysteines");
  });
  it("walks backward and wraps", () => {
    assert.equal(stepRegion(sections, null, -1), "ligand:A:262::ZN:1");
    assert.equal(stepRegion(sections, "cysteines", -1), "ligand:A:262::ZN:1");
  });
  it("returns null with nothing to step through", () => {
    assert.equal(stepRegion([], null, 1), null);
  });
});

describe("regionSelection", () => {
  it("addresses residues by label_asym_id and label_seq_id, de-duplicated", () => {
    const selection = regionSelection(region("r", "cysteines", [row("A", 3), row("A", 3), row("B", 3)]));
    assert.deepEqual(selection.residues, [{ labelAsymId: "A", labelSeqId: 3 }, { labelAsymId: "B", labelSeqId: 3 }]);
    assert.equal(selection.status, "mapped");
  });

  it("selects the ligand instance by its own label chain, not the protein chain", () => {
    const selection = regionSelection(zinc);
    assert.deepEqual(selection.ligand, { labelAsymId: "B", authSeqId: "262", insertionCode: null, compId: "ZN" });
    assert.equal(selection.residues.length, 3);
  });

  it("never guesses a position for residues without structure numbering", () => {
    const selection = regionSelection(region("r", "reference_ptm", [row("A", 3), row(null, null), row("A", 9, { modeled: false })]));
    assert.deepEqual(selection.residues, [{ labelAsymId: "A", labelSeqId: 3 }]);
    assert.equal(selection.status, "partial");
    assert.equal(selection.unmappedCount, 2);
  });

  it("reports a region with nothing in the model as unmapped", () => {
    const selection = regionSelection(region("r", "disorder_uniprot", [], { unmappedPositions: [1, 2, 3] }));
    assert.equal(selection.status, "unmapped");
    assert.equal(selection.unmappedCount, 3);
  });

  it("still highlights a ligand with no protein contacts", () => {
    const selection = regionSelection({ ...zinc, residues: [] });
    assert.equal(selection.status, "mapped");
    assert.ok(selection.ligand);
  });

  it("counts positions the engine reports as outside the model", () => {
    const selection = regionSelection(region("r", "reference_domain", [row("A", 10)], { unmappedPositions: [1, 2] }));
    assert.equal(selection.status, "partial");
    assert.equal(selection.unmappedCount, 2);
  });
});

describe("labels", () => {
  it("names residues in author numbering with insertion codes", () => {
    assert.equal(residueLabel(row("A", 42, { authSeqId: "42", insertionCode: "A", chainId: "B" })), "Cys 42A · chain B");
  });
  it("describes experimental entries with method, resolution and ligands", () => {
    assert.equal(structureOptionLabel({ id: "1CA2", source: "pdb", format: "cif", method: "X-RAY DIFFRACTION", resolutionAngstrom: 2, chains: [], ligands: [{ ccdId: "ZN", chainId: "A", labelChainId: "B", authSeqId: "262", insertionCode: null, classification: "ligand" }, { ccdId: "HOH", chainId: "A", labelChainId: "C", authSeqId: "301", insertionCode: null, classification: "water" }] }), "1CA2 · X-ray diffraction · 2.00 Å · 1 ligand");
    assert.equal(structureOptionLabel({ id: "AF-P00918-F1", source: "alphafold_db", format: "cif", chains: [], ligands: [] }), "AlphaFold model · AF-P00918-F1");
  });
});
