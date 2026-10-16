import { describe, it } from "node:test";
import assert from "node:assert/strict";
import type { JsonObject, ProjectJob, ProteinBundle } from "@/lib/protein-labs-api";
import {
  assignedMass, bandMass, buildReportData, emptyYieldEntry, formatPeakFit, formatPurity, formatSecMass,
  type ReportData, type YieldEntry,
} from "./report-data.ts";

/**
 * Known-answer tests for the report's data layer.
 *
 * Every expected number here is worked out by hand from the fixture, not read
 * back from the code, so a change to the arithmetic shows up as a failure.
 */

function bundle(jobs: Record<string, JsonObject>): ProteinBundle {
  const projectJobs: ProjectJob[] = Object.entries(jobs).map(([appType, config]) => ({
    id: appType, proteinId: "p", name: appType, appType, status: "complete", config,
    createdAt: "", updatedAt: "",
  }));
  return {
    protein: {} as ProteinBundle["protein"], protparam: null, blastJobs: [], uniprotMatches: [], pdbMatches: [],
    alphaFoldModels: [], projectJobs, projectNotebook: null,
  };
}

function roadmap(...titles: string[]): JsonObject {
  return { steps: titles.map((title, index) => ({ id: `s${index + 1}`, title })) };
}

function entry(id: string, values: Partial<YieldEntry>): YieldEntry {
  return { ...emptyYieldEntry(id, id), ...values };
}

function lane(data: ReportData, name: string) {
  const row = data.purity?.rows.find((value) => value.lane === name);
  assert.ok(row, `lane ${name} is in the purity table`);
  return row;
}

const calibration = { slope: -1.2, intercept: 5.1, r2: 0.991 };
const near = (actual: number | null, expected: number) => {
  assert.ok(actual !== null, `expected ${expected}, got null`);
  assert.ok(Math.abs(actual - expected) < 1e-9, `expected ${expected}, got ${actual}`);
};

describe("yield arithmetic", () => {
  it("completes each row and computes step and overall recovery", () => {
    const data = buildReportData(bundle({ "purification-roadmap": roadmap("Lysate", "Affinity", "SEC") }), [
      // 50 mL at 2 mg/mL = 100 mg.
      entry("s1", { volumeMl: "50", concentrationMgMl: "2" }),
      // 10 mL holding 40 mg = 4 mg/mL; 40/100 = 40% of both stages.
      entry("s2", { volumeMl: "10", totalProteinMg: "40" }),
      // 2 mL at 5 mg/mL = 10 mg; 10/40 = 25% step, 10/100 = 10% overall.
      entry("s3", { volumeMl: "2", concentrationMgMl: "5" }),
    ]);
    const [lysate, affinity, sec] = data.yieldRows;
    near(lysate.totalProteinMg, 100);
    near(lysate.overallRecoveryPercent, 100);
    assert.equal(lysate.stepRecoveryPercent, null);
    near(affinity.concentrationMgMl, 4);
    near(affinity.stepRecoveryPercent, 40);
    near(affinity.overallRecoveryPercent, 40);
    near(sec.totalProteinMg, 10);
    near(sec.stepRecoveryPercent, 25);
    near(sec.overallRecoveryPercent, 10);
  });

  it("measures step recovery against the previous quantified stage", () => {
    const data = buildReportData(bundle({ "purification-roadmap": roadmap("Lysate", "Wash", "Eluate") }), [
      entry("s1", { volumeMl: "20", totalProteinMg: "80" }),
      entry("s3", { volumeMl: "4", totalProteinMg: "20" }),
    ]);
    assert.equal(data.yieldRows[1].totalProteinMg, null);
    near(data.yieldRows[2].stepRecoveryPercent, 25);
    near(data.yieldRows[2].overallRecoveryPercent, 25);
  });

  it("flags a step that recovers more than it was given", () => {
    const data = buildReportData(bundle({ "purification-roadmap": roadmap("A", "B") }), [
      entry("s1", { volumeMl: "1", totalProteinMg: "10" }),
      entry("s2", { volumeMl: "1", totalProteinMg: "12" }),
    ]);
    near(data.yieldRows[1].stepRecoveryPercent, 120);
    assert.ok(data.yieldRows[1].flags.some((value) => value.title === "Step recovery above 100%"));
  });
});

describe("purity from densitometry", () => {
  const gel = (bands: JsonObject[], lanes: JsonObject[] = [{ id: "1", label: "SEC" }]) => ({
    calibration, lanes, bands,
  });

  it("is the target's share of the lane density", () => {
    const data = buildReportData(bundle({
      "purification-roadmap": roadmap("Lysate", "SEC"),
      "gel-analysis": gel([
        { laneId: "1", density: 900, isTarget: true },
        { laneId: "1", density: 60 },
        { laneId: "1", density: 40 },
      ]),
    }), []);
    near(lane(data, "SEC").purityPercent, 90);
    assert.equal(lane(data, "SEC").purityBound, "measured");
    near(data.yieldRows[1].purityPercent, 90);
  });

  it("reports nothing for a lane the engine refused to quantify", () => {
    const data = buildReportData(bundle({
      "purification-roadmap": roadmap("SEC"),
      "gel-analysis": gel(
        [{ laneId: "1", density: 900, isTarget: true }, { laneId: "1", density: 100 }],
        [{ id: "1", label: "SEC", quantificationRefused: true, saturationReason: "lane_saturated" }],
      ),
    }), []);
    assert.equal(lane(data, "SEC").purityPercent, null);
    assert.equal(data.yieldRows[0].purityPercent, null);
    assert.ok(lane(data, "SEC").flags.some((value) => value.title === "The engine refused to quantify this lane"));
  });
});

describe("finding 1: lanes bind to one stage or none", () => {
  it("leaves a lane naming two stages unbound, with a caveat", () => {
    const data = buildReportData(bundle({
      "purification-roadmap": roadmap("Pre SEC pool", "Post SEC pool"),
      "gel-analysis": { calibration, lanes: [{ id: "1", label: "SEC pool" }], bands: [
        { laneId: "1", density: 80, isTarget: true }, { laneId: "1", density: 20 },
      ] },
    }), []);
    assert.equal(lane(data, "SEC pool").matchedStage, "");
    assert.deepEqual(data.yieldRows.map((row) => row.purityPercent), [null, null]);
    assert.ok(lane(data, "SEC pool").flags.some((value) => value.title === "Lane name matches more than one purification stage"));
  });

  it("prefers an exact name over a substring", () => {
    const data = buildReportData(bundle({
      "purification-roadmap": roadmap("SEC", "SEC pool"),
      "gel-analysis": { calibration, lanes: [{ id: "1", label: "sec pool" }], bands: [
        { laneId: "1", density: 75, isTarget: true }, { laneId: "1", density: 25 },
      ] },
    }), []);
    assert.equal(lane(data, "sec pool").matchedStage, "s2");
    assert.equal(data.yieldRows[0].purityPercent, null);
    near(data.yieldRows[1].purityPercent, 75);
  });

  it("honours an explicit stageId over the printed label", () => {
    const data = buildReportData(bundle({
      "purification-roadmap": roadmap("Affinity", "SEC"),
      "gel-analysis": { calibration, lanes: [{ id: "1", label: "SEC", stageId: "s1" }], bands: [
        { laneId: "1", density: 60, isTarget: true }, { laneId: "1", density: 40 },
      ] },
    }), []);
    near(data.yieldRows[0].purityPercent, 60);
    assert.equal(data.yieldRows[1].purityPercent, null);
  });

  it("binds neither of two lanes that collide on a stage by name", () => {
    const bands = [
      { laneId: "1", density: 90, isTarget: true }, { laneId: "1", density: 10 },
      { laneId: "2", density: 50, isTarget: true }, { laneId: "2", density: 50 },
    ];
    const data = buildReportData(bundle({
      "purification-roadmap": roadmap("SEC"),
      "gel-analysis": { calibration, lanes: [{ id: "1", label: "SEC" }, { id: "2", label: "sec" }], bands },
    }), []);
    assert.equal(data.yieldRows[0].purityPercent, null);
    assert.ok(data.purity?.flags.some((value) => value.title === "More than one lane claims the \"SEC\" stage"));
  });
});

describe("finding 2: flags survive at every level", () => {
  it("carries gel, calibration, lane, chromatogram and peak flags into the report", () => {
    const flagged = (code: string) => [{ code, level: "warning", message: `${code} message` }];
    const data = buildReportData(bundle({
      "gel-analysis": {
        flags: flagged("gel_level"),
        calibration: { ...calibration, flags: flagged("gel_calibration_level") },
        lanes: [{ id: "1", label: "Load", flags: flagged("lane_level") }],
        bands: [{ laneId: "1", density: 1, isTarget: true, flags: flagged("band_level") }],
      },
      "chromatogram-studio": {
        flags: flagged("run_level"),
        calibration: { slope: -3, intercept: 6, r2: 0.99, flags: flagged("sec_calibration_level") },
        peaks: [{ name: "P1", apexX: 12, kav: 0.4, flags: flagged("peak_level") }],
      },
    }), []);
    const titles = data.flags.map((value) => value.title);
    for (const title of ["Gel level", "Gel calibration level", "Lane level", "Band level",
      "Run level", "Sec calibration level", "Peak level"]) {
      assert.ok(titles.includes(title), `${title} is reported`);
    }
  });
});

describe("finding 3: a stale mass is never printed", () => {
  it("withholds a saved SEC mass when the column has no calibration", () => {
    const data = buildReportData(bundle({
      "chromatogram-studio": { peaks: [{ name: "P1", apexX: 12, kav: 0.4, mwKDa: 100 }] },
    }), []);
    const peak = data.sec?.peaks[0];
    assert.equal(peak?.mwKDa, null);
    assert.ok(peak?.mwSuppressedReason);
    assert.ok(peak?.flags.some((value) => value.title === "A saved apparent mass is not reported"));
  });

  it("withholds a mass outside the separation range and keeps a valid one", () => {
    assert.equal(assignedMass({ mwKDa: 100, kav: 1.2 }, true).mwKDa, null);
    assert.equal(assignedMass({ mwKDa: 100, kav: 0 }, true).mwKDa, null);
    assert.equal(assignedMass({ mwKDa: -5, kav: 0.4 }, true).mwKDa, null);
    assert.equal(assignedMass({ mwKDa: 66.5, kav: 0.4 }, true).mwKDa, 66.5);
  });

  it("reads the gel engine's nullable mass and its status", () => {
    assert.deepEqual(bandMass({ molecularWeightDa: 45000, molecularWeightStatus: "estimated" }, true), { kDa: 45, reason: "" });
    const outside = bandMass({ molecularWeightDa: null, molecularWeightStatus: "outside_ladder_range", molecularWeightKDa: 45 }, true);
    assert.equal(outside.kDa, null);
    assert.match(outside.reason, /^Outside ladder range\./);
    assert.equal(bandMass({ molecularWeightKDa: 45 }, false).kDa, null);
    assert.equal(bandMass({ molecularWeightKDa: 45 }, true).kDa, 45);
  });
});

describe("finding 4: saturation bounds purity in the right direction", () => {
  const lanePurity = (targetSaturated: boolean, contaminantSaturated: boolean) => {
    const data = buildReportData(bundle({
      "gel-analysis": { calibration, lanes: [{ id: "1", label: "L" }], bands: [
        { laneId: "1", density: 80, isTarget: true, saturated: targetSaturated },
        { laneId: "1", density: 20, saturated: contaminantSaturated },
      ] },
    }), []);
    return lane(data, "L");
  };

  it("makes a saturated target a lower bound", () => {
    const row = lanePurity(true, false);
    near(row.purityPercent, 80);
    assert.equal(row.purityBound, "lower");
    assert.equal(formatPurity(row.purityPercent, row.purityBound), "≥ 80.0%");
  });

  it("makes a saturated contaminant an upper bound", () => {
    const row = lanePurity(false, true);
    assert.equal(row.purityBound, "upper");
    assert.equal(formatPurity(row.purityPercent, row.purityBound), "≤ 80.0%");
  });

  it("calls the figure unreliable when both sides are saturated", () => {
    const row = lanePurity(true, true);
    assert.equal(row.purityBound, "unreliable");
    assert.equal(formatPurity(row.purityPercent, row.purityBound), "80.0% (unreliable)");
  });

  it("recognises saturation reported as an engine flag", () => {
    const data = buildReportData(bundle({
      "gel-analysis": { calibration, lanes: [{ id: "1", label: "L" }], bands: [
        { laneId: "1", density: 80, isTarget: true, flags: [{ code: "band_saturated", level: "warning", title: "Saturated band", message: "" }] },
        { laneId: "1", density: 20 },
      ] },
    }), []);
    assert.equal(lane(data, "L").purityBound, "lower");
  });

  it("does not attach the gel's bound to a purity the researcher typed", () => {
    const data = buildReportData(bundle({
      "purification-roadmap": roadmap("L"),
      "gel-analysis": { calibration, lanes: [{ id: "1", label: "L" }], bands: [
        { laneId: "1", density: 80, isTarget: true, saturated: true }, { laneId: "1", density: 20 },
      ] },
    }), [entry("s1", { purityPercent: "95" })]);
    near(data.yieldRows[0].purityPercent, 95);
    assert.equal(data.yieldRows[0].purityBound, "measured");
  });
});

describe("HOM-25: chromatography diagnostics from a saved studio job", () => {
  // The saved shape written by Chromatogram Studio's `studioJobConfig` (PR #8),
  // with values from a real HOM-15 engine run: four standards for P1, two for P2.
  const model = "gaussian_fixed_apex_fwhm_amplitude_fit";
  const note = (code: string, level: string) => ({ code, level, title: code, message: `${code} message` });
  const studioJob = (calibration: JsonObject): JsonObject => ({
    traces: [{ id: "t1", yUnit: "mAU" }],
    standards: [{ mwDa: 2000, included: true }, { mwDa: 600000, included: true }],
    calibration: { slope: -0.25, intercept: 1.5, r2: 0.9998, ...calibration },
    peaks: [
      { id: "p1", traceId: "t1", name: "P1", apexX: 16, kav: 0.5, mwKDa: 10, mwUncertaintyKDa: 1.502, area: 3,
        fitQuality: { rSquared: 0.985, residual: 4.137, model }, flags: [note("calibration_only_mass_uncertainty", "note")] },
      { id: "p2", traceId: "t1", name: "P2", apexX: 16, kav: 0.5, mwKDa: 10, mwUncertaintyKDa: null, area: 1,
        fitQuality: { rSquared: null, residual: null, model }, flags: [note("mass_uncertainty_unavailable", "caution")] },
      { id: "p3", name: "Older peak", apexX: 16, kav: 0.5, mwKDa: 10, area: 1 },
    ],
  });

  it("prints mass uncertainty, peak fit and engine flags together, and null as not estimated", () => {
    const data = buildReportData(bundle({ "chromatogram-studio": studioJob({ standardMassRangeKDa: [1, 1000] }) }), []);
    const [p1, p2, p3] = data.sec?.peaks ?? [];

    assert.equal(p1.mwUncertaintyKDa, 1.502);
    assert.deepEqual(p1.fitQuality, { rSquared: 0.985, residual: 4.137, unit: "mAU" });
    assert.equal(formatSecMass(p1), "10.0 kDa ± 1.50 kDa");
    assert.equal(formatPeakFit(p1.fitQuality), "0.985 · 4.137 mAU");
    assert.ok(p1.flags.some((value) => value.title === "calibration_only_mass_uncertainty"));

    assert.equal(p2.mwUncertaintyKDa, null);
    assert.equal(formatSecMass(p2), "10.0 kDa");
    assert.equal(formatPeakFit(p2.fitQuality), "—");
    assert.ok(p2.flags.some((value) => value.title === "mass_uncertainty_unavailable"));

    assert.equal(p3.mwUncertaintyKDa, null);
    assert.equal(p3.fitQuality, null);
  });

  it("takes the calibrated mass range from the engine, falling back for older jobs", () => {
    const engine = buildReportData(bundle({ "chromatogram-studio": studioJob({ standardMassRangeKDa: [1, 1000] }) }), []);
    assert.deepEqual(engine.sec?.calibratedRangeKDa, [1, 1000]);

    const older = buildReportData(bundle({ "chromatogram-studio": studioJob({}) }), []);
    assert.deepEqual(older.sec?.calibratedRangeKDa, [2, 600]);
  });

  it("drops the uncertainty when the mass itself is withheld", () => {
    const job = studioJob({ standardMassRangeKDa: [1, 1000] });
    job.calibration = null;
    const [p1] = buildReportData(bundle({ "chromatogram-studio": job }), []).sec?.peaks ?? [];
    assert.equal(p1.mwKDa, null);
    assert.equal(p1.mwUncertaintyKDa, null);
  });
});
