import assert from "node:assert/strict";
import { describe, it } from "vitest";
import type { ConservationResidue } from "./conservation.ts";
import {
  CONSERVATION_COLORS,
  clampGrade,
  conservedStretches,
  describeSource,
  formatCoverage,
  gradeColor,
  gradeInk,
  gradeLabel,
  gradeLegend,
  preferredJob,
  stripColumnWidth,
  stripRows,
  summarizeConservation,
} from "./conservation.ts";

function residue(position: number, grade: number, overrides: Partial<ConservationResidue> = {}): ConservationResidue {
  return {
    position,
    residue: "A",
    grade,
    score: 0,
    insufficientData: false,
    confidenceInterval: null,
    confidenceGrades: null,
    alignedSequences: 200,
    totalSequences: 300,
    msaData: "200/300",
    burialState: "e",
    functionalState: "",
    residueVariety: "A",
    varietyResidues: [],
    atomLabel: `ALA:${position}:A`,
    pdbResidueNumber: String(position),
    pdbChain: "A",
    modelled: true,
    ...overrides,
  };
}

describe("ConSurf grade colours", () => {
  it("covers every grade and the insufficient-data case", () => {
    for (let grade = 1; grade <= 9; grade += 1) {
      assert.match(gradeColor(grade), /^#[0-9A-F]{6}$/i, `grade ${grade} has no colour`);
    }
    assert.equal(gradeColor(9), "#A02560");
    assert.equal(gradeColor(1), "#10C8D1");
    assert.equal(gradeColor(5, true), CONSERVATION_COLORS.insufficient);
  });

  it("clamps a grade that is out of range or not a number", () => {
    assert.equal(clampGrade(0), 1);
    assert.equal(clampGrade(12), 9);
    assert.equal(clampGrade(Number.NaN), 1);
    assert.equal(clampGrade(6.4), 6);
  });

  it("keeps the grade number readable on its own colour", () => {
    // The conserved end is dark, the variable end light; both need their own ink.
    assert.equal(gradeInk(9), "#ffffff");
    assert.equal(gradeInk(2), "#23272f");
    assert.notEqual(gradeInk(5, true), gradeInk(5));
  });

  it("names each end of the scale the way ConSurf describes it", () => {
    assert.equal(gradeLabel(9), "highly conserved");
    assert.equal(gradeLabel(5), "average");
    assert.equal(gradeLabel(1), "highly variable");
  });

  it("orders the legend conserved first and ends with insufficient data", () => {
    const legend = gradeLegend();
    assert.equal(legend.length, 10);
    assert.deepEqual(legend.slice(0, 9).map((entry) => entry.grade), [9, 8, 7, 6, 5, 4, 3, 2, 1]);
    assert.equal(legend[9].insufficientData, true);
    assert.equal(legend[9].key, "insufficient");
  });
});

describe("summarizeConservation", () => {
  const residues = [
    residue(1, 9),
    residue(2, 9),
    residue(3, 5),
    residue(4, 2, { insufficientData: true, alignedSequences: 3, msaData: "3/300" }),
    residue(5, 7, { modelled: false, pdbResidueNumber: "", pdbChain: "", atomLabel: "" }),
  ];

  it("counts graded and insufficient-data residues separately", () => {
    const summary = summarizeConservation(residues);
    assert.equal(summary.residueCount, 5);
    assert.equal(summary.gradedCount, 4);
    assert.equal(summary.insufficientDataCount, 1);
  });

  it("averages only the sites with enough data behind them", () => {
    // (9 + 9 + 5 + 7) / 4 — the starred grade 2 must not drag the mean down.
    assert.equal(summarizeConservation(residues).meanGrade, 7.5);
  });

  it("lists grade 9 positions and counts residues missing from the model", () => {
    const summary = summarizeConservation(residues);
    assert.deepEqual(summary.highlyConserved, [1, 2]);
    assert.equal(summary.unmodelledCount, 1);
    assert.deepEqual(summary.chains, ["A"]);
  });

  it("builds a histogram that adds up to the graded residues", () => {
    const summary = summarizeConservation(residues);
    assert.deepEqual(summary.histogram.map((bucket) => bucket.grade), [9, 8, 7, 6, 5, 4, 3, 2, 1]);
    assert.equal(summary.histogram.reduce((total, bucket) => total + bucket.count, 0), summary.gradedCount);
    assert.equal(summary.histogram[0].count, 2);
    const shares = summary.histogram.reduce((total, bucket) => total + bucket.share, 0);
    assert.ok(Math.abs(shares - 1) < 1e-9);
  });

  it("handles an empty profile without dividing by zero", () => {
    const summary = summarizeConservation([]);
    assert.equal(summary.meanGrade, null);
    assert.deepEqual(summary.highlyConserved, []);
    assert.equal(summary.histogram.every((bucket) => bucket.share === 0), true);
  });
});

describe("conservedStretches", () => {
  it("finds runs of consecutive conserved positions", () => {
    const residues = [
      residue(1, 9), residue(2, 8), residue(3, 9), residue(4, 4),
      residue(5, 9), residue(6, 9), residue(7, 9), residue(8, 9),
    ];
    assert.deepEqual(conservedStretches(residues), [
      { start: 1, end: 3, minGrade: 8, length: 3 },
      { start: 5, end: 8, minGrade: 9, length: 4 },
    ]);
  });

  it("ignores runs shorter than the minimum", () => {
    assert.deepEqual(conservedStretches([residue(1, 9), residue(2, 9), residue(3, 2)]), []);
  });

  it("breaks a run at an insufficient-data site rather than bridging it", () => {
    const residues = [
      residue(1, 9), residue(2, 9), residue(3, 9, { insufficientData: true }),
      residue(4, 9), residue(5, 9), residue(6, 9),
    ];
    assert.deepEqual(conservedStretches(residues).map((item) => [item.start, item.end]), [[4, 6]]);
  });

  it("breaks a run at a gap in the numbering", () => {
    const residues = [residue(1, 9), residue(2, 9), residue(3, 9), residue(40, 9), residue(41, 9), residue(42, 9)];
    assert.deepEqual(conservedStretches(residues).map((item) => item.start), [1, 40]);
  });
});

describe("strip geometry", () => {
  it("keeps columns inside the readable bounds at both extremes", () => {
    // 2 residues must not stretch across the panel; 2000 must still fit.
    assert.equal(stripColumnWidth(2, 900, { min: 3, max: 16 }), 16);
    assert.equal(stripColumnWidth(2000, 900, { min: 3, max: 16 }), 3);
    assert.equal(stripColumnWidth(90, 900, { min: 3, max: 16 }), 10);
  });

  it("falls back to the maximum when there is nothing to measure", () => {
    assert.equal(stripColumnWidth(0, 900), 18);
    assert.equal(stripColumnWidth(50, 0), 18);
  });

  it("splits residues into rows of the requested width, keeping order", () => {
    const rows = stripRows([1, 2, 3, 4, 5], 2);
    assert.deepEqual(rows, [[1, 2], [3, 4], [5]]);
    assert.deepEqual(rows.flat(), [1, 2, 3, 4, 5]);
  });

  it("never produces a zero-width row", () => {
    assert.deepEqual(stripRows([1, 2], 0), [[1], [2]]);
    assert.deepEqual(stripRows([], 10), []);
  });
});

describe("run selection and labels", () => {
  const prepared = { id: "a", status: "prepared", residueCount: 0 };
  const complete = { id: "b", status: "complete", residueCount: 76 };
  const emptyComplete = { id: "c", status: "complete", residueCount: 0 };

  it("prefers the newest run that actually has grades", () => {
    assert.equal(preferredJob([prepared, complete])?.id, "b");
    assert.equal(preferredJob([complete, prepared])?.id, "b");
  });

  it("falls back to the newest run when none has grades", () => {
    assert.equal(preferredJob([prepared, emptyComplete])?.id, "a");
    assert.equal(preferredJob([]), undefined);
  });

  it("says when ConSurf-DB answered from a different representative chain", () => {
    assert.equal(
      describeSource({
        source: "consurf-db",
        pdbId: "1UBQ",
        chain: "A",
        metadata: { identicalPdbId: "6Q00", identicalChain: "A" },
      }),
      "ConSurf-DB · 1UBQ chain A via representative 6Q00 chain A",
    );
  });

  it("does not claim a redirect when the chain asked for is the one used", () => {
    assert.equal(
      describeSource({
        source: "consurf-db",
        pdbId: "6Q00",
        chain: "A",
        metadata: { identicalPdbId: "6Q00", identicalChain: "A" },
      }),
      "ConSurf-DB · 6Q00 chain A",
    );
  });

  it("names the imported file, and the server flow when nothing was imported", () => {
    assert.equal(
      describeSource({ source: "consurf-server-import", pdbId: "", chain: "", metadata: { importedFile: "consurf_grades.txt" } }),
      "Imported · consurf_grades.txt",
    );
    assert.equal(
      describeSource({ source: "consurf-server", pdbId: "", chain: "", metadata: {} }),
      "ConSurf server submission",
    );
  });

  it("formats a coverage fraction and refuses to invent one", () => {
    assert.equal(formatCoverage(1), "100.0%");
    assert.equal(formatCoverage(0.8421), "84.2%");
    assert.equal(formatCoverage(null), "—");
    assert.equal(formatCoverage(undefined), "—");
  });
});
