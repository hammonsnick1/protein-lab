// Conservation colouring: query → chain mapping and the alignment score. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { BlastHit } from "./blast-alignment.ts";
import type { ConservationResidue } from "./conservation.ts";
import { alignSequences, alignmentProfile, binGrades, columnEntropyScores, consurfProfile, conservationColoring, mapChain, UNMAPPED_COLOR, type ChainSequence, type ConservationProfile } from "./conservation-coloring.ts";

// Human carbonic anhydrase II (P00918), the seed protein.
const CA2 = "MSHHWGYGKHNGPEHWHKDFPIAKGERQSPVDIDTHTAKYDPSLKPLSVSYDQATSLRILNNGHAFNVEFDDSQDKAVLKGGPLDGTYRLIQFHFHWGSLDGQGSEHTVDKKKYAAELHLVHWNTKYGDFGKAVQQPDGLAVLGIFLKVGSAKPGLQKVVDVLDSIKTKGKSADFTNFDPRGLLPESLDYWTYPGSLTTPPLLECVTWIVLKEPISVSSEQVLKFRKLNFNGEGEPEELMVDNWRPAQPLKNRQIKASFK";
const LYSOZYME = "KVFGRCELAAAMKRHGLDNYRGYSLGNWVCAAKFESNFNTQATNRNTDGSTDYGILQINSRWWCNDGRTPGSRNLCNIPCSALLSSDITASVNCAKKIVSDGNGMNAWVAWRNRCKGTDVQAWIRGCRL";

const chain = (labelAsymId: string, sequence: string, firstSeqId = 1, authAsymId = labelAsymId): ChainSequence => ({ labelAsymId, authAsymId, sequence, seqIds: Array.from(sequence, (_, index) => firstSeqId + index) });
const residuesOf = (item: ChainSequence, skip: number[] = []) => item.seqIds.filter((seqId) => !skip.includes(seqId)).map((labelSeqId) => ({ labelAsymId: item.labelAsymId, labelSeqId }));
/** Each query position graded by its own index, so a mapped residue tells which position it got. */
const indexProfile = (query: string): ConservationProfile => ({ source: "consurf", query, detail: "", grades: Array.from(query, (_, index) => ({ grade: (index % 9) + 1, insufficientData: false })) });
const gradeOf = (result: ReturnType<typeof conservationColoring>, labelAsymId: string, labelSeqId: number) =>
  result.coloring.groups.find((group) => group.residues.some((item) => item.labelAsymId === labelAsymId && item.labelSeqId === labelSeqId))?.key ?? null;

describe("alignSequences", () => {
  it("aligns identical sequences position for position", () => {
    const { pairs, identical } = alignSequences(CA2, CA2);
    assert.equal(pairs.length, CA2.length);
    assert.equal(identical, CA2.length);
    assert.ok(pairs.every(([query, target]) => query === target));
  });

  it("places a fragment where it occurs in the query, not at its start", () => {
    const { pairs } = alignSequences(CA2, CA2.slice(50, 150));
    assert.deepEqual(pairs[0], [50, 0]);
    assert.deepEqual(pairs.at(-1), [149, 99]);
  });

  it("returns nothing for an empty sequence", () => {
    assert.deepEqual(alignSequences("", CA2).pairs, []);
  });
});

describe("mapChain", () => {
  it("maps a chain that starts mid-sequence to the right query positions", () => {
    const mapping = mapChain(CA2, chain("A", CA2.slice(20)));
    assert.equal(mapping.matches, true);
    assert.equal(mapping.byLabelSeqId.get(1), 21);
    assert.equal(mapping.byLabelSeqId.get(100), 120);
    assert.equal(mapping.identity, 1);
  });

  it("leaves an expression tag the query lacks unmapped", () => {
    const tag = "MGSSHHHHHHSSGLVPRGDP";
    const mapping = mapChain(CA2, chain("A", tag + CA2.slice(2)));
    for (let seqId = 1; seqId <= tag.length; seqId += 1) assert.equal(mapping.byLabelSeqId.has(seqId), false, `tag residue ${seqId}`);
    assert.equal(mapping.byLabelSeqId.get(tag.length + 1), 3);
  });

  it("steps over a deletion in the chain so residues after it keep their own positions", () => {
    // The chain lacks query positions 101–110.
    const sequence = CA2.slice(0, 100) + CA2.slice(110);
    const mapping = mapChain(CA2, chain("A", sequence));
    assert.equal(mapping.byLabelSeqId.get(100), 100);
    assert.equal(mapping.byLabelSeqId.get(101), 111);
    assert.equal(mapping.byLabelSeqId.get(sequence.length), CA2.length);
  });

  it("steps over an insertion in the chain and leaves the inserted residues unmapped", () => {
    const sequence = CA2.slice(0, 100) + "GGSGGS" + CA2.slice(100);
    const mapping = mapChain(CA2, chain("A", sequence));
    assert.equal(mapping.byLabelSeqId.get(100), 100);
    for (let seqId = 101; seqId <= 106; seqId += 1) assert.equal(mapping.byLabelSeqId.has(seqId), false);
    assert.equal(mapping.byLabelSeqId.get(107), 101);
  });

  it("follows label_seq_id numbering that does not start at 1", () => {
    const mapping = mapChain(CA2, chain("A", CA2.slice(4), 5));
    assert.equal(mapping.byLabelSeqId.get(5), 5);
    assert.equal(mapping.byLabelSeqId.has(1), false);
  });

  it("does not match an unrelated protein", () => {
    const mapping = mapChain(CA2, chain("C", LYSOZYME));
    assert.equal(mapping.matches, false);
  });
});

describe("conservationColoring", () => {
  it("colours modelled residues by their own grade around missing residues", () => {
    // SEQRES covers the whole chain; residues 30–39 have no coordinates.
    const item = chain("A", CA2);
    const missing = Array.from({ length: 10 }, (_, index) => 30 + index);
    const result = conservationColoring(indexProfile(CA2), [item], residuesOf(item, missing));
    assert.equal(gradeOf(result, "A", 29), String((28 % 9) + 1));
    assert.equal(gradeOf(result, "A", 40), String((39 % 9) + 1));
    assert.equal(gradeOf(result, "A", 30), null, "a missing residue is never painted");
    assert.equal(result.counts.graded, CA2.length - missing.length);
    assert.equal(result.counts.unmapped, 0);
  });

  it("colours both copies of a homodimer and leaves a partner chain neutral", () => {
    const a = chain("A", CA2.slice(2), 1, "A"), b = chain("B", CA2.slice(2), 1, "B"), partner = chain("C", LYSOZYME, 1, "L");
    const result = conservationColoring(indexProfile(CA2), [a, b, partner], [...residuesOf(a), ...residuesOf(b), ...residuesOf(partner)]);
    assert.equal(gradeOf(result, "A", 1), String((2 % 9) + 1));
    assert.equal(gradeOf(result, "B", 1), gradeOf(result, "A", 1));
    assert.equal(gradeOf(result, "C", 1), null);
    assert.deepEqual(result.chains.map((mapping) => mapping.matches), [true, true, false]);
    assert.equal(result.counts.unmapped, LYSOZYME.length);
    assert.deepEqual(result.coloring.base, { label: "Not mapped", color: UNMAPPED_COLOR });
  });

  it("keeps insufficient-data grades out of the graded groups", () => {
    const profile = indexProfile(CA2);
    profile.grades[9] = { grade: 9, insufficientData: true };
    const item = chain("A", CA2);
    const result = conservationColoring(profile, [item], residuesOf(item));
    assert.equal(gradeOf(result, "A", 10), "insufficient");
    assert.equal(result.counts.insufficient, 1);
  });

  it("counts residues outside the graded stretch as unmapped", () => {
    const profile = indexProfile(CA2.slice(0, 120));
    const item = chain("A", CA2);
    const result = conservationColoring(profile, [item], residuesOf(item));
    assert.equal(gradeOf(result, "A", 120), String((119 % 9) + 1));
    assert.equal(gradeOf(result, "A", 121), null);
    assert.equal(result.counts.unmapped, CA2.length - 120);
  });
});

describe("consurfProfile", () => {
  const row = (position: number, residue: string, grade: number, insufficientData = false) => ({ position, residue, grade, insufficientData }) as ConservationResidue;

  it("numbers grades by the sequence ConSurf was given", () => {
    const profile = consurfProfile({ querySequence: "MKV", residues: [row(1, "M", 9), row(2, "K", 3, true), row(3, "V", 1)] });
    assert.equal(profile.query, "MKV");
    assert.deepEqual(profile.grades, [{ grade: 9, insufficientData: false }, { grade: 3, insufficientData: true }, { grade: 1, insufficientData: false }]);
  });

  it("rebuilds the query from the rows when the stated one is missing", () => {
    const profile = consurfProfile({ querySequence: "", residues: [row(1, "M", 9), row(3, "V", 1)] });
    assert.equal(profile.query, "MXV");
    assert.equal(profile.grades[1], null);
  });
});

describe("alignment conservation", () => {
  it("scores a fully conserved column above a variable one and refuses thin columns", () => {
    const rows = ["AKW", "AKW", "AEW", "ARW", "ADW", "AS-", "AT-"];
    const [conserved, variable, thin] = columnEntropyScores(rows);
    assert.equal(conserved, 1);
    assert.ok(variable !== null && variable < 0.5);
    assert.equal(thin, null);
  });

  it("bins with grade 5 at the mean, 9 at the top and 1 at the bottom", () => {
    assert.deepEqual(binGrades([0, 0.5, 1, null]), [1, 5, 9, null]);
    assert.deepEqual(binGrades([1, 1]), [9, 9]);
  });

  it("grades query positions from the BLAST hits", () => {
    const query = "MKVLAAGIVG";
    const hits: BlastHit[] = Array.from({ length: 6 }, (_, index) => ({
      id: `h${index}`, rank: index + 1, accession: `P${index}`, uniprotAccession: "", description: "", organism: "", length: 10, identity: null, coverage: null, evalue: null, bitScore: null, queryStart: 1, queryEnd: 10,
      // Column 1 always M; column 2 varies; the rest match the query.
      hsps: [{ queryFrom: 1, queryTo: 10, hitFrom: 1, hitTo: 10, qseq: query, hseq: "M" + "KREDST"[index] + query.slice(2), midline: "", identities: 9, positives: null, gaps: 0, alignLength: 10, evalue: null, bitScore: null }],
    }));
    const profile = alignmentProfile(query, hits);
    assert.equal(profile.query, query);
    assert.ok(profile.grades[0]!.grade > profile.grades[1]!.grade);
    assert.equal(profile.grades.every((value) => value && !value.insufficientData), true);
    assert.equal(alignmentProfile(query, hits.slice(0, 3)).grades.every((value) => value?.insufficientData), true);
  });
});
