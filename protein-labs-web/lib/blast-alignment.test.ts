// BLAST alignment viewers. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { alignmentBlocks, blastStepIndex, buildMsa, cleanDescription, clustalColours, columnConservation, formatElapsed, formatEvalue, isTerminalStatus, msaFasta, normalizeHits, organismOf, readHsp, sortHits } from "./blast-alignment.ts";
import type { BlastHit, BlastHsp } from "./blast-alignment.ts";

const QUERY = "MVHLTPEEKSAVTALWGKV"; // HBB 1–19

function hsp(fields: Partial<BlastHsp> & Pick<BlastHsp, "queryFrom" | "qseq" | "hseq">): BlastHsp {
  return readHsp(fields as Record<string, unknown>)!;
}
function hit(id: string, hsps: BlastHsp[]): BlastHit {
  return { id, rank: 1, accession: id, uniprotAccession: id, description: "", organism: "", length: null, identity: null, coverage: null, evalue: null, bitScore: null, queryStart: null, queryEnd: null, hsps };
}

describe("readHsp", () => {
  it("derives counts, ends and a midline when the engine leaves them out", () => {
    const value = hsp({ queryFrom: 3, hitFrom: 10, qseq: "HLT-PE", hseq: "HLSAPE" });
    assert.equal(value.queryTo, 7);
    assert.equal(value.hitTo, 15);
    assert.equal(value.identities, 4);
    assert.equal(value.gaps, 1);
    assert.equal(value.midline, "HL  PE");
  });

  it("rejects unequal or missing alignment strings", () => {
    assert.equal(readHsp({ qseq: "MVH", hseq: "MV" }), null);
    assert.equal(readHsp({ queryFrom: 1 }), null);
  });
});

describe("normalizeHits", () => {
  it("reads nested HSPs and cleans the NCBI description", () => {
    const [value] = normalizeHits([{ rank: 1, accession: "P68871", uniprotAccession: "P68871", description: "RecName: Full=Hemoglobin subunit beta; AltName: Full=Beta-globin", scientificName: "Homo sapiens", hitLength: 147, identity: 1, queryCoverage: 1, evalue: 1e-100, bitScore: 300, hsps: [{ queryFrom: 1, queryTo: 19, hitFrom: 1, hitTo: 19, qseq: QUERY, hseq: QUERY, midline: QUERY, identity: 1.0, positives: 19, gaps: 0, alignLength: 19, evalue: 0.0, bitScore: 40.0 }] }]);
    assert.equal(value.description, "Hemoglobin subunit beta");
    assert.equal(value.organism, "Homo sapiens");
    assert.equal(value.hsps.length, 1);
    // The engine's HSP `identity` is a fraction; the count comes from the strings.
    assert.equal(value.hsps[0].identities, 19);
    assert.equal(value.hsps[0].positives, 19);
    assert.equal(value.hsps[0].evalue, 0);
    assert.equal(value.queryStart, 1);
  });

  it("keeps old saved hits without alignment strings and still shows their metrics", () => {
    const [value] = normalizeHits([{ rank: 2, accession: "sp|P02070|HBB_BOVIN", description: "Hemoglobin subunit beta OS=Bos taurus OX=9913 GN=HBB", identity: 0.84, queryCoverage: 0.99, evalue: 2e-80, queryStart: 2, queryEnd: 147 }]);
    assert.deepEqual(value.hsps, []);
    assert.equal(value.organism, "Bos taurus");
    assert.equal(value.description, "Hemoglobin subunit beta");
    assert.equal(value.queryStart, 2);
  });

  it("accepts a flat hit that inlines its best HSP", () => {
    const [value] = normalizeHits([{ accession: "X", queryStart: 5, queryEnd: 8, hitStart: 1, qseq: "TPEE", hseq: "TPDE" }]);
    assert.equal(value.hsps.length, 1);
    assert.equal(value.hsps[0].queryFrom, 5);
  });
});

describe("organismOf / cleanDescription", () => {
  it("reads the NCBI bracket form", () => {
    assert.equal(organismOf({ description: "hemoglobin beta [Pan troglodytes]" }), "Pan troglodytes");
    assert.equal(cleanDescription("hemoglobin beta [Pan troglodytes]"), "hemoglobin beta");
  });
});

describe("alignmentBlocks", () => {
  it("numbers each 60-column block by residues, skipping gaps", () => {
    const qseq = "A".repeat(58) + "--" + "C".repeat(10);
    const hseq = "A".repeat(60) + "C".repeat(10);
    const [one, two] = alignmentBlocks(hsp({ queryFrom: 11, hitFrom: 101, qseq, hseq }));
    assert.deepEqual([one.queryStart, one.queryEnd, one.subjectStart, one.subjectEnd], [11, 68, 101, 160]);
    assert.deepEqual([two.queryStart, two.queryEnd, two.subjectStart, two.subjectEnd], [69, 78, 161, 170]);
    assert.deepEqual(one.kinds.slice(56, 60), ["identity", "identity", "gap", "gap"]);
  });

  it("marks conservative substitutions from the midline", () => {
    const [block] = alignmentBlocks(hsp({ queryFrom: 1, qseq: "KE", hseq: "RD", midline: "+ " }));
    assert.deepEqual(block.kinds, ["positive", "mismatch"]);
  });

  it("keeps the previous number for a block that is all gaps in one sequence", () => {
    const [, second] = alignmentBlocks(hsp({ queryFrom: 1, qseq: "MV--", hseq: "MVHL" }), 2);
    assert.deepEqual([second.queryStart, second.queryEnd, second.subjectStart, second.subjectEnd], [2, 2, 3, 4]);
  });

  it("counts down for a reversed (minus-strand) range", () => {
    const [block] = alignmentBlocks(hsp({ queryFrom: 10, queryTo: 7, hitFrom: 1, qseq: "ABCD", hseq: "ABCD" }));
    assert.deepEqual([block.queryStart, block.queryEnd], [10, 7]);
  });
});

describe("buildMsa", () => {
  it("puts the query first and pads unaligned ends with gaps", () => {
    const rows = buildMsa(QUERY, [hit("A", [hsp({ queryFrom: 5, qseq: "TPEEK", hseq: "TPDEK" })])]);
    assert.equal(rows[0].residues, QUERY);
    assert.equal(rows[1].residues, "----TPDEK----------");
    assert.equal(rows[1].residues.length, QUERY.length);
    assert.equal(rows[1].covered, 5);
    assert.equal(rows[1].identity, 4 / 5);
  });

  it("draws deletions as gaps and drops residues inserted relative to the query", () => {
    // Hit lacks query residue 3 (H) and carries an extra G after query residue 5 (T).
    const rows = buildMsa(QUERY, [hit("A", [hsp({ queryFrom: 1, qseq: "MVHLT-PE", hseq: "MV-LTGPE" })])]);
    assert.equal(rows[1].residues.slice(0, 7), "MV-LTPE");
    assert.equal(rows[1].insertions, 1);
    assert.equal(rows[1].covered, 7);
  });

  it("lets the better HSP win where two HSPs overlap", () => {
    const best = hsp({ queryFrom: 1, qseq: "MVHLTPEE", hseq: "MVHLTPEE" });
    const weaker = hsp({ queryFrom: 6, qseq: "PEEKSAVT", hseq: "XXXKSAVT" });
    const rows = buildMsa(QUERY, [hit("A", [best, weaker])]);
    assert.equal(rows[1].residues, "MVHLTPEEKSAVT------");
  });

  it("ignores insertions from an HSP that adds no columns", () => {
    const best = hsp({ queryFrom: 1, qseq: "MVHLT", hseq: "MVHLT" });
    const hidden = hsp({ queryFrom: 2, qseq: "V--H", hseq: "VGGH" });
    assert.equal(buildMsa(QUERY, [hit("A", [best, hidden])])[1].insertions, 0);
  });

  it("clips HSP columns that fall outside the query (offsets below 1 or past the end)", () => {
    const rows = buildMsa("MVHL", [hit("A", [hsp({ queryFrom: -1, queryTo: 6, qseq: "XXMVHLYY", hseq: "ZZMVHLWW" })])]);
    assert.equal(rows[1].residues, "MVHL");
    assert.equal(rows[1].covered, 4);
  });

  it("maps a reversed HSP onto ascending query columns", () => {
    const rows = buildMsa("ABCDEF", [hit("A", [hsp({ queryFrom: 5, queryTo: 2, qseq: "EDCB", hseq: "EDXB" })])]);
    assert.equal(rows[1].residues, "-BXDE-");
  });

  it("keeps hits without HSPs as empty rows", () => {
    const rows = buildMsa("MVHL", [hit("A", [])]);
    assert.equal(rows[1].residues, "----");
    assert.equal(rows[1].identity, 0);
  });
});

describe("clustalColours", () => {
  it("colours glycine and proline always and hydrophobics only when the column is mostly hydrophobic", () => {
    const colours = clustalColours(["GPLK", "GPLK", "GPAE", "GPSE"]);
    assert.deepEqual(colours[0].slice(0, 2), ["orange", "yellow"]);
    assert.equal(colours[0][2], "blue"); // L, L, A hydrophobic = 75%
    assert.equal(colours[3][2], "green"); // S/T are green in a > 60% hydrophobic column
    assert.equal(colours[0][3], "");      // K, K, E, E: neither KR > 60% nor any residue > 85%
  });

  it("does not colour a column that is mostly gaps", () => {
    const colours = clustalColours(["L", "-", "-", "-"]);
    assert.equal(colours[0][0], "");
  });
});

describe("columnConservation / msaFasta", () => {
  it("scores the most common residue over all rows", () => {
    assert.deepEqual(columnConservation(["AA-", "AC-", "AC-", "-CD"]), [0.75, 0.75, 0.25]);
  });

  it("wraps FASTA at 60 columns with one header per row", () => {
    const fasta = msaFasta([{ label: "Query", residues: "A".repeat(61) }, { label: "P1  Homo sapiens", residues: "-".repeat(61) }]);
    assert.equal(fasta, `>Query\n${"A".repeat(60)}\nA\n>P1 Homo sapiens\n${"-".repeat(60)}\n-\n`);
  });
});

describe("sortHits", () => {
  const base = normalizeHits([
    { rank: 1, accession: "A", identity: 0.9, evalue: 1e-50 },
    { rank: 2, accession: "B", identity: null, evalue: 1e-80 },
    { rank: 3, accession: "C", identity: 0.95, evalue: 0.01 },
  ]);
  it("sorts numbers both ways and keeps missing values last", () => {
    assert.deepEqual(sortHits(base, "identity", "desc").map((value) => value.accession), ["C", "A", "B"]);
    assert.deepEqual(sortHits(base, "identity", "asc").map((value) => value.accession), ["A", "C", "B"]);
    assert.deepEqual(sortHits(base, "evalue", "asc").map((value) => value.accession), ["B", "A", "C"]);
  });
});

describe("progress helpers", () => {
  it("maps engine statuses and legacy stage text to steps", () => {
    assert.equal(blastStepIndex("submitted"), 0);
    assert.equal(blastStepIndex("waiting"), 1);
    assert.equal(blastStepIndex("queued"), 1);
    assert.equal(blastStepIndex("running"), 2);
    assert.equal(blastStepIndex("parsing"), 3);
    assert.equal(blastStepIndex("complete"), 4);
    assert.equal(blastStepIndex("done"), 4);
    assert.equal(blastStepIndex("checking", "Parsing hits from NCBI"), 3);
    assert.equal(isTerminalStatus("cancelled"), true);
    assert.equal(isTerminalStatus("waiting"), false);
  });

  it("formats elapsed time and E-values", () => {
    assert.equal(formatElapsed(65_000), "1:05");
    assert.equal(formatElapsed(3_725_000), "1:02:05");
    assert.equal(formatEvalue(0), "0");
    assert.equal(formatEvalue(2.34e-98), "2.3e-98");
    assert.equal(formatEvalue(0.012), "0.012");
  });
});
