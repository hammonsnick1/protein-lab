import { test } from "vitest";
import assert from "node:assert/strict";
import type { ModelConfidence } from "./readiness-evidence.ts";
import { assessDisorder, assessMembrane, conservationSummary, disorderWindow, hydrophobicWindow, meanGrade } from "./readiness-evidence.ts";

// Human carbonic anhydrase 2, UniProt P00918. Residues 8–37 are ordered in
// every crystal structure (e.g. PDB 1CA2) and have pLDDT > 90 in AF-P00918-F1.
const CA2 = "MSHHWGYGKHNGPEHWHKDFPIAKGERQSPVDIDTHTAKYDPSLKPLSVSYDQATSLRILNNGHAFNVEFDDSQDKAVLKGGPLDGTYRLIQFHFHWGSLDGQGSEHTVDKKKYAAELHLVHWNTKYGDFGKAVQQPDGLAVLG"
  + "IFLKVGSAKPGLQKVVDVLDSIKTKGKSADFTNFDPRGLLPESLDYWTYPGSLTTPPLLECVTWIVLKEPISVSSEQVLKFRKLNFNGEGEPEELMVDNWRPAQPLKNRQIKASFK";
// Values the engine returns for the AF-P00918-F1 v6 model (backend tests/test_readiness.py).
const ca2Model: ModelConfidence = {
  modelId: "AF-P00918-F1", source: "AlphaFold DB", accession: "P00918", name: "Carbonic anhydrase 2", error: "",
  threshold: 50, minimumRunLength: 10, meanPlddt: 97.37, modelResidueCount: 260, lowConfidenceResidueCount: 1,
  shortLowConfidenceRuns: 1, mismatches: 0, lowConfidenceRegions: [], constructResiduesNotInModel: [],
};

test("CA2 composition screens give the values the review measured", () => {
  const window = disorderWindow(CA2)!;
  assert.deepEqual([window.start, window.end], [8, 37]);
  assert.ok(window.score >= 0.43);
  assert.equal(hydrophobicWindow(CA2)!.score.toFixed(3), "0.429");
});

test("an AlphaFold model overrides the composition window: CA2 8–37 is not disordered", () => {
  const result = assessDisorder({ referenceAccession: "P00918", disorderedCount: 0, model: ca2Model, window: disorderWindow(CA2), conservation: null });
  assert.equal(result.answer, "No");
  assert.equal(result.basis, "plddt");
  assert.match(result.detail, /mean pLDDT 97\.4/);
  assert.match(result.detail, /composition screen is not used/);
  assert.doesNotMatch(result.detail, /8–37/);
});

test("without a model the composition window is used and says so", () => {
  const result = assessDisorder({ referenceAccession: "P00918", disorderedCount: 0, model: null, window: disorderWindow(CA2), conservation: null });
  assert.equal(result.answer, "Needs follow-up");
  assert.equal(result.basis, "composition");
  assert.match(result.detail, /no structure model in this project/i);
  assert.match(result.detail, /8–37/);
});

test("an unreadable model falls back to the window and names the error", () => {
  const result = assessDisorder({ referenceAccession: "P00918", disorderedCount: 0, model: { ...ca2Model, error: "no C-alpha atoms", lowConfidenceRegions: undefined }, window: disorderWindow(CA2), conservation: null });
  assert.equal(result.basis, "composition");
  assert.match(result.detail, /could not be read \(no C-alpha atoms\)/);
});

test("while the model evidence loads the answer stays open", () => {
  assert.equal(assessDisorder({ referenceAccession: "", disorderedCount: 0, model: undefined, window: null, conservation: null }).basis, "pending");
});

test("UniProt disorder annotation still wins over a confident model", () => {
  assert.equal(assessDisorder({ referenceAccession: "P04637", disorderedCount: 2, model: ca2Model, window: null, conservation: null }).basis, "uniprot");
});

test("long low-pLDDT stretches answer Yes in construct numbering with ConSurf grades", () => {
  const model: ModelConfidence = { ...ca2Model, lowConfidenceRegions: [{ modelStart: 249, modelEnd: 260, length: 12, constructStart: 269, constructEnd: 270, meanPlddt: 30 }], constructResiduesNotInModel: [{ start: 1, end: 20 }] };
  const conservation = { jobId: "j", source: "consurf-db", pdbId: "1CA3", chain: "A", identicalPdbId: "5Y2S", identicalChain: "A", constructGrades: ".".repeat(268) + "35", gradedConstructResidues: 2 };
  const result = assessDisorder({ referenceAccession: "P00918", disorderedCount: 0, model, window: null, conservation });
  assert.equal(result.answer, "Yes");
  assert.match(result.detail, /269–270 \(model 249–260\), mean pLDDT 30\.0, ConSurf mean grade 4\.0 of 9 over 2\/2/);
  assert.match(result.detail, /Construct residues 1–20 are not in the model/);
});

test("membrane: no TM annotation and no hydrophobic flag answers No with the caveat", () => {
  const result = assessMembrane({ referenceAccession: "P00918", transmembraneCount: 0, hydrophobic: hydrophobicWindow(CA2) });
  assert.equal(result.answer, "No");
  assert.match(result.detail, /0\.429, below the 0\.52 flag/);
  assert.match(result.detail, /not proof that the protein is soluble/);
});

test("membrane: annotation says Yes, a strong window needs follow-up, no reference stays open", () => {
  assert.equal(assessMembrane({ referenceAccession: "P02945", transmembraneCount: 7, hydrophobic: null }).answer, "Yes");
  assert.equal(assessMembrane({ referenceAccession: "X", transmembraneCount: 0, hydrophobic: { start: 1, end: 21, score: 0.6, sequence: "" } }).answer, "Needs follow-up");
  assert.equal(assessMembrane({ referenceAccession: "", transmembraneCount: 0, hydrophobic: hydrophobicWindow(CA2) }).answer, "Not reviewed");
});

test("ConSurf grades ignore ungraded positions", () => {
  const conservation = { jobId: "j", source: "consurf-db", pdbId: "1CA3", chain: "A", identicalPdbId: "5Y2S", identicalChain: "A", constructGrades: "9.1", gradedConstructResidues: 2 };
  assert.deepEqual(meanGrade(conservation, 1, 3), { mean: 5, graded: 2, total: 3 });
  assert.equal(meanGrade(conservation, 2, 2), null);
  assert.deepEqual(conservationSummary(conservation), ["ConSurf 1CA3 chain A (via 5Y2S) · 2 of 3 construct residues graded · mean grade 5.0"]);
});
