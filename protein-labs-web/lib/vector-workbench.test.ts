// Tests for the Vector Workbench model: reading and writing the engine's
// vector shape, feature edits, reverse complement and cut-site filters.
// Run with `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { WorkbenchVector } from "./vector-workbench.ts";
import {
  addFeature, cleanDna, deleteFeature, enzymeSummary, featureProblem, filterCuts, findMotif, mirrorRange, orfAsFeature, orfMapFeatures,
  readOrfs, readVector, reverseComplementVector, saveChoice, toEngine, updateFeature,
} from "./vector-workbench.ts";

// What the engine's /v1/vector-workbench/parse returns for a GenBank file.
const PARSED = {
  name: "pDemo",
  sequence: "GAATTCATGGCTGCTGCTTAAGGATCCAAATTT",
  circular: true,
  fileFormat: "genbank",
  features: [
    { id: "feature-1", name: "demo CDS", type: "CDS", start: 6, end: 18, strand: 1, color: "#43A047", notes: "made up", automatic: false, isInsert: false, wrapsOrigin: false, parts: [{ start: 6, end: 18 }], qualifiers: { label: ["demo CDS"], note: ["made up"] } },
    { id: "feature-2", name: "wrap", type: "misc_feature", start: 30, end: 3, strand: -1, color: "#607D8B", notes: "", automatic: false, isInsert: false, wrapsOrigin: true, parts: [], qualifiers: {} },
  ],
};

const vector = (): WorkbenchVector => readVector(PARSED, { kind: "file", filename: "pDemo.gb", format: "genbank" });

describe("engine round trip", () => {
  it("reads a parsed file and writes back the same sequence, topology and features", () => {
    const body = toEngine(vector());
    assert.equal(body.name, "pDemo");
    assert.equal(body.sequence, PARSED.sequence);
    assert.equal(body.circular, true);
    assert.deepEqual(body.features.map(({ name, type, start, end, strand, notes }) => ({ name, type, start, end, strand, notes })), [
      { name: "demo CDS", type: "CDS", start: 6, end: 18, strand: 1, notes: "made up" },
      { name: "wrap", type: "misc_feature", start: 30, end: 3, strand: -1, notes: "" },
    ]);
    assert.deepEqual(body.features[0].qualifiers, { label: ["demo CDS"], note: ["made up"] });
    // The engine's type colours are not pinned as a user colour.
    assert.equal("color" in body.features[0], false);
    // Reading what we wrote gives the same construct.
    assert.deepEqual(readVector(body, vector().source), vector());
  });

  it("keeps a colour the user chose and the insert flag", () => {
    const raw = { ...PARSED, features: [{ ...PARSED.features[0], color: "#123456", customColor: true, isInsert: true }] };
    const body = toEngine(readVector(raw, { kind: "new" }));
    assert.equal(body.features[0].color, "#123456");
    assert.equal(body.features[0].isInsert, true);
  });

  it("cleans DNA and defaults a missing name and topology", () => {
    const read = readVector({ sequence: "acg u n\n12x" }, { kind: "new" });
    assert.equal(read.sequence, "ACGTN");
    assert.equal(read.name, "Untitled vector");
    assert.equal(read.circular, true);
    assert.equal(cleanDna("a-c g\tu"), "ACGT");
  });
});

describe("feature edits", () => {
  it("adds, edits and deletes a feature", () => {
    const { vector: added, feature } = addFeature(vector(), { start: 0, end: 6 }, { name: " EcoRI site ", type: "misc_feature" });
    assert.equal(added.features.length, 3);
    assert.equal(feature.name, "EcoRI site");
    assert.equal(feature.strand, 1);

    const edited = updateFeature(added, feature.id, { name: "lac promoter", type: "promoter", start: 1, end: 5, strand: -1, notes: "moved" });
    const after = edited.features.find((item) => item.id === feature.id)!;
    assert.deepEqual({ name: after.name, type: after.type, start: after.start, end: after.end, strand: after.strand, notes: after.notes }, { name: "lac promoter", type: "promoter", start: 1, end: 5, strand: -1, notes: "moved" });

    const removed = deleteFeature(edited, feature.id);
    assert.deepEqual(removed.features.map((item) => item.id), ["feature-1", "feature-2"]);
  });

  it("renaming updates the label qualifier export prefers", () => {
    const edited = updateFeature(vector(), "feature-1", { name: "GFP" });
    assert.deepEqual(edited.features[0].qualifiers.label, ["GFP"]);
    assert.deepEqual(edited.features[0].qualifiers.note, ["made up"]);
  });

  it("refuses coordinates outside the sequence, empty ranges, blank names and origin-spanning features on linear DNA", () => {
    const length = PARSED.sequence.length;
    assert.throws(() => updateFeature(vector(), "feature-1", { end: length + 1 }), /within 1–33/);
    assert.throws(() => updateFeature(vector(), "feature-1", { start: 4, end: 4 }), /at least one base/);
    assert.throws(() => updateFeature(vector(), "feature-1", { name: "  " }), /name/);
    assert.throws(() => addFeature({ ...vector(), circular: false }, { start: 30, end: 3 }, { name: "x", type: "misc_feature" }), /circular/);
    assert.throws(() => updateFeature(vector(), "missing", { name: "x" }), /no longer exists/);
    assert.equal(featureProblem({ name: "ok", start: 30, end: 3 }, length, true), "");
  });

  it("keeps a detected ORF as a CDS on its strand", () => {
    const [orf] = readOrfs([{ id: "orf-1", name: "ORF 3 aa", start: 6, end: 18, strand: -1, frame: -2, aminoAcids: 3, translation: "MAA" }]);
    const { feature } = orfAsFeature(vector(), orf);
    assert.deepEqual({ name: feature.name, type: feature.type, start: feature.start, end: feature.end, strand: feature.strand }, { name: "CDS 3 aa", type: "CDS", start: 6, end: 18, strand: -1 });
    assert.equal(orfMapFeatures([orf])[0].type, "ORF");
  });
});

describe("reverse complement", () => {
  it("mirrors the sequence and every feature, and undoes itself", () => {
    const original = vector();
    const flipped = reverseComplementVector(original);
    const length = original.sequence.length;
    assert.equal(flipped.sequence, "AAATTTGGATCCTTAAGCAGCAGCCATGAATTC");
    // The CDS on 6–18 (+) now sits on L-18 … L-6 (−) and still reads the same bases.
    assert.deepEqual(flipped.features.map(({ start, end, strand }) => ({ start, end, strand })), [
      { start: length - 18, end: length - 6, strand: -1 },
      { start: length - 3, end: length - 30, strand: 1 },
    ]);
    assert.deepEqual(reverseComplementVector(flipped), original);
  });

  it("handles features touching either end", () => {
    const base = { ...vector(), features: [] };
    const { vector: withEnds } = addFeature(base, { start: 0, end: 4 }, { name: "head", type: "misc_feature" });
    const { vector: both } = addFeature(withEnds, { start: 29, end: 33 }, { name: "tail", type: "misc_feature" });
    const flipped = reverseComplementVector(both);
    assert.deepEqual(flipped.features.map(({ start, end }) => [start, end]), [[29, 33], [0, 4]]);
    assert.deepEqual(mirrorRange({ start: 0, end: 4 }, 33), { start: 29, end: 33 });
    assert.deepEqual(mirrorRange({ start: 29, end: 33 }, 33), { start: 0, end: 4 });
    assert.deepEqual(mirrorRange({ start: 10, end: 10 }, 33), { start: 23, end: 23 });
  });
});

describe("cut sites", () => {
  const cuts = [
    { enzyme: "EcoRI", cut: 1, recognitionSite: "GAATTC", cutCount: 1 },
    { enzyme: "SmaI", cut: 40, recognitionSite: "CCCGGG", cutCount: 2 },
    { enzyme: "SmaI", cut: 12, recognitionSite: "CCCGGG", cutCount: 2 },
    { enzyme: "HaeIII", cut: 5, recognitionSite: "GGCC", cutCount: 3 },
  ];
  it("filters unique and two-cutters", () => {
    assert.deepEqual(filterCuts(cuts, "unique").map((site) => site.enzyme), ["EcoRI"]);
    assert.deepEqual(filterCuts(cuts, "two").map((site) => site.cut), [40, 12]);
    assert.equal(filterCuts(cuts, "all").length, 4);
    assert.equal(filterCuts(cuts, "none").length, 0);
  });
  it("summarises one row per enzyme, fewest cuts first", () => {
    assert.deepEqual(enzymeSummary(cuts).map((row) => [row.enzyme, row.cuts]), [["EcoRI", [1]], ["SmaI", [12, 40]], ["HaeIII", [5]]]);
  });
});

describe("saving to the library", () => {
  it("only offers overwrite for the user's own library entries", () => {
    assert.equal(saveChoice({ kind: "library", libraryId: "a", name: "pMine", standard: false }).canOverwrite, true);
    assert.match(saveChoice({ kind: "library", libraryId: "b", name: "pET-28a(+)", standard: true }).reason, /read-only/);
    assert.equal(saveChoice({ kind: "file", filename: "x.gb", format: "genbank" }).canOverwrite, false);
    assert.equal(saveChoice({ kind: "project", proteinId: "p", proteinName: "HBB", vectorId: "v" }).canOverwrite, false);
  });
});

describe("find", () => {
  it("finds the next match on either strand and wraps through the origin", () => {
    const sequence = "GGATCCAAAACTTTT";
    assert.deepEqual(findMotif(sequence, true, "ggatcc"), { range: { start: 0, end: 6 }, count: 1, reverse: false });
    // AAGT is only on the reverse strand (ACTT on top).
    assert.deepEqual(findMotif(sequence, true, "AAGT"), { range: { start: 9, end: 13 }, count: 1, reverse: true });
    // TTGG spans the origin of the circle; its reverse complement CCAA sits at 4 on any molecule.
    assert.deepEqual(findMotif(sequence, true, "TTGG", 5), { range: { start: 13, end: 2 }, count: 2, reverse: false });
    assert.deepEqual(findMotif(sequence, false, "TTGG", 5), { range: { start: 4, end: 8 }, count: 1, reverse: true });
    assert.equal(findMotif(sequence, true, "CCCC"), null);
    // Searching on from the first hit moves to the next one.
    assert.equal(findMotif("AAAGAAAG", false, "AAAG", 1)?.range.start, 4);
  });
});
