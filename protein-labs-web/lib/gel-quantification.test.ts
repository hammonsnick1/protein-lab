// Focused tests for the honesty rules of the gel studio. Run with
// `npm run test` in protein-labs-web (Vitest).
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  bandQuantification,
  bandQuantificationNote,
  calibrationStale,
  finiteOrNull,
  formatSignalFraction,
  gelCsvRows,
  gelFigureNote,
  invalidateLaneFractions,
  ladderMassesError,
  ladderMassesKDa,
  laneQuantification,
  molecularWeightLabel,
  readGelAnalysis,
  readGelBand,
  readGelJobConfig,
  reanalysisReasons,
  bandsInLane,
} from "./gel-quantification.ts";

// A clipped band exactly as protein-labs/backend/protein_labs/gel_analysis.py
// reports it, next to a clean band in the same lane.
const saturatedLaneReply = {
  source: "gel.png",
  width: 600,
  height: 400,
  polarity: "dark",
  previewBase64: "AAA",
  lanes: [
    { id: "lane-a", label: "Lane 1", xStart: 0.1, xEnd: 0.3, isLadder: false, sampleLabel: "IMAC eluate", stageId: "step-imac" },
  ],
  bands: [
    {
      id: "band-clean",
      laneId: "lane-a",
      label: "Band 1",
      yStart: 0.2,
      yEnd: 0.24,
      centerY: 0.22,
      peakSignal: 41.5,
      autoDetected: true,
      isTarget: false,
      quantificationRefused: false,
      saturationReason: null,
      density: 1820.5,
      densityUncertainty: 12.4,
      flags: [
        {
          code: "lane_fraction_unavailable",
          level: "note",
          title: "Lane fraction withheld",
          message: "Another band in this lane is saturated.",
        },
      ],
      laneFraction: null,
      laneFractionUncertainty: null,
      normalizationBasis: "lane_fraction_unavailable_due_to_saturation",
      molecularWeightDa: 48300,
      molecularWeightStatus: "estimated",
    },
    {
      id: "band-clipped",
      laneId: "lane-a",
      label: "Band 2",
      yStart: 0.4,
      yEnd: 0.46,
      centerY: 0.43,
      peakSignal: 212,
      autoDetected: true,
      isTarget: false,
      quantificationRefused: true,
      saturationReason: "Band pixels are saturated (18.2% at or above 255); intensity is not in the linear range",
      density: null,
      densityUncertainty: null,
      flags: [
        {
          code: "saturated",
          level: "warning",
          title: "Saturated band",
          message: "Band pixels reach the detector ceiling.",
        },
      ],
      laneFraction: null,
      laneFractionUncertainty: null,
      normalizationBasis: "lane_fraction_unavailable_due_to_saturation",
      molecularWeightDa: null,
      molecularWeightStatus: "quantification_refused",
    },
  ],
  quantification: {
    backgroundMethod: "rolling_ball",
    backgroundRadiusPx: 28,
    backgroundKernel: "circular_cap_1d_opening",
    backgroundIntensityRadius: 28,
    backgroundBoundary: "truncated_support",
    laneGeometry: "straight_rectangles_with_one_twelfth_width_inset",
    uncertaintyMethod: "profile_MAD_noise_only_approximate_standard_error",
    caveats: [
      "Lane fractions describe detected band signal; undetected material is excluded",
      "Intensity fractions are not a validated protein mass purity measurement",
    ],
    normalizationBasis: "fraction_of_detected_band_integrals",
    linearDynamicRange: { minSignal: 0, maxSignal: 254, unit: "8_bit_polarity_corrected" },
    imageProcessing: {
      downscaled: false,
      originalWidth: 600,
      originalHeight: 400,
      maxDimensionLimit: null,
      scaleFactor: 1,
      resampling: null,
    },
  },
  ladderCalibration: {
    method: "log10_da_vs_relative_mobility",
    status: "calibrated",
    r2: 0.99617342,
    fitR2: 0.9962,
    residualConvention: "observed_minus_fitted_kDa",
    matchedBands: [
      { bandId: "ladder-1", relativeMobility: 0.12, massKDa: 250, fittedKDa: 246.1, residualKDa: 3.9 },
      { bandId: "ladder-2", relativeMobility: 0.2, massKDa: 150, fittedKDa: 153.2, residualKDa: -3.2 },
    ],
    slope: -2.1,
    intercept: 5.6,
    ladderBandCount: 10,
    calibrationMarkerCount: 10,
    mobilityRange: [0.12, 0.88],
    markerAssignment: "provided_masses_top_to_bottom_before_saturation_filter",
  },
};

function cleanBand(overrides: Record<string, unknown> = {}) {
  return readGelBand(
    {
      id: "band-1",
      laneId: "lane-b",
      label: "Band 1",
      centerY: 0.3,
      yStart: 0.28,
      yEnd: 0.32,
      peakSignal: 30,
      density: 900,
      laneFraction: 0.82,
      laneFractionUncertainty: 0.014,
      normalizationBasis: "fraction_of_detected_band_integrals",
      quantificationRefused: false,
      saturationReason: null,
      autoDetected: true,
      isTarget: true,
      molecularWeightDa: 48300,
      molecularWeightStatus: "estimated",
      ...overrides,
    },
    0,
  );
}

describe("reading engine results", () => {
  it("never turns a withheld measurement into zero", () => {
    assert.equal(finiteOrNull(null), null);
    assert.equal(finiteOrNull(undefined), null);
    assert.equal(finiteOrNull(""), null);
    assert.equal(finiteOrNull(Number.NaN), null);
    assert.equal(finiteOrNull(0), 0);
  });

  it("keeps the valid density and the refusal in a mixed lane", () => {
    const analysis = readGelAnalysis(saturatedLaneReply);
    const [clean, clipped] = analysis.bands;
    assert.equal(clean.density, 1820.5);
    assert.equal(bandQuantification(clean), "quantified");
    assert.equal(clipped.density, null);
    assert.equal(bandQuantification(clipped), "refused_saturated");
    assert.match(String(bandQuantificationNote(clipped)), /saturated/);
  });

  it("drops the placeholder density of a hand-drawn band", () => {
    const manual = readGelBand(
      { id: "m1", laneId: "lane-a", label: "Manual", centerY: 0.5, density: 1, peakSignal: 1, autoDetected: false },
      0,
    );
    assert.equal(manual.density, null);
    assert.equal(manual.laneFraction, null);
    assert.equal(bandQuantification(manual), "manual_annotation");
  });

  it("ignores a molecular weight the engine did not endorse", () => {
    const outside = cleanBand({ molecularWeightStatus: "outside_ladder_range", molecularWeightDa: 999000 });
    assert.equal(outside.molecularWeightDa, null);
    assert.equal(molecularWeightLabel(outside), "Outside ladder range");
  });
});

describe("lane verdicts", () => {
  it("stays unavailable in a mixed lane even once a target is chosen", () => {
    const analysis = readGelAnalysis(saturatedLaneReply);
    const withTarget = analysis.bands.map((band) =>
      band.id === "band-clean" ? { ...band, isTarget: true } : band,
    );
    const verdict = laneQuantification(withTarget);
    assert.equal(verdict.kind, "unavailable");
    assert.match(verdict.kind === "unavailable" ? verdict.headline : "", /saturated band/);
    // The density the engine did measure is still on the band.
    assert.equal(withTarget[0].density, 1820.5);
  });

  it("reports the engine's own fraction and uncertainty for a clean lane", () => {
    const verdict = laneQuantification([cleanBand()]);
    assert.equal(verdict.kind, "available");
    if (verdict.kind !== "available") return;
    assert.equal(verdict.fraction, 0.82);
    assert.equal(verdict.uncertainty, 0.014);
    assert.equal(verdict.basis, "fraction_of_detected_band_integrals");
    assert.equal(formatSignalFraction(verdict.fraction, verdict.uncertainty), "82.0% ± 1.4%");
  });

  it("asks for a target instead of guessing one", () => {
    assert.equal(laneQuantification([cleanBand({ isTarget: false })]).kind, "needs_target");
  });

  it("retires the lane fraction when the lane is edited, keeping densities", () => {
    const edited = invalidateLaneFractions([cleanBand()], "lane-b", "A band was deleted after detection.");
    assert.equal(edited[0].density, 900);
    assert.equal(edited[0].laneFraction, null);
    assert.equal(edited[0].laneFractionUncertainty, null);
    const verdict = laneQuantification(edited);
    assert.equal(verdict.kind, "unavailable");
    assert.match(verdict.kind === "unavailable" ? verdict.detail.join(" ") : "", /deleted after detection/);
  });

  it("refuses a lane that holds a hand-drawn band", () => {
    const manual = readGelBand({ id: "m1", laneId: "lane-b", label: "Manual", centerY: 0.6, autoDetected: false }, 1);
    const verdict = laneQuantification([cleanBand(), manual]);
    assert.equal(verdict.kind, "unavailable");
    assert.match(verdict.kind === "unavailable" ? verdict.headline : "", /manually drawn band/);
  });
});

describe("saving and reloading", () => {
  it("keeps refusals, uncertainty and metadata through a round trip", () => {
    const analysis = readGelAnalysis(saturatedLaneReply);
    const saved = JSON.parse(
      JSON.stringify({
        schemaVersion: 3,
        filename: "gel.png",
        previewBase64: "AAA",
        gelType: "SDS-PAGE",
        sensitivity: 0.58,
        backgroundRadiusPx: 28,
        ladderPreset: "Bio-Rad Precision Plus",
        customWeights: "",
        ladderMassesKDa: [250, 150, 100, 75, 50, 37, 25, 20, 15, 10],
        ladderLaneId: "lane-ladder",
        lanes: analysis.lanes,
        bands: analysis.bands.map((band) =>
          band.id === "band-clean" ? { ...band, isTarget: true } : band,
        ),
        quantification: analysis.quantification,
        ladderCalibration: analysis.ladderCalibration,
        calibrationIsStale: false,
        source: "gel.png",
        polarity: "dark",
        savedAt: "2026-10-13T00:00:00.000Z",
      }),
    );
    const loaded = readGelJobConfig(saved);
    const laneBands = bandsInLane(loaded.bands, "lane-a");
    assert.equal(laneBands[0].density, 1820.5);
    assert.equal(laneBands[1].density, null);
    assert.equal(laneBands[1].quantificationRefused, true);
    assert.match(String(laneBands[1].saturationReason), /not in the linear range/);
    assert.equal(laneQuantification(laneBands).kind, "unavailable");
    assert.equal(loaded.quantification?.backgroundRadiusPx, 28);
    assert.equal(loaded.quantification?.linearDynamicRange.maxSignal, 254);
    assert.equal(loaded.quantification?.caveats.length, 2);
    assert.equal(loaded.quantification?.imageProcessing.originalWidth, 600);
    assert.equal(loaded.ladderCalibration?.fitR2, 0.9962);
    assert.equal(loaded.ladderCalibration?.r2, 0.99617342);
    assert.equal(loaded.ladderCalibration?.residualConvention, "observed_minus_fitted_kDa");
    assert.deepEqual(
      loaded.ladderCalibration?.matchedBands.map((matched) => matched.residualKDa),
      [3.9, -3.2],
    );
    assert.equal(laneBands[0].densityUncertainty, 12.4);
    assert.equal(laneBands[1].densityUncertainty, null);
    assert.deepEqual(
      laneBands.map((band) => band.flags.map((flag) => flag.code)),
      [["lane_fraction_unavailable"], ["saturated"]],
    );
    assert.equal(loaded.lanes[0].sampleLabel, "IMAC eluate");
    assert.equal(loaded.lanes[0].stageId, "step-imac");
    assert.deepEqual(loaded.ladderCalibration?.mobilityRange, [0.12, 0.88]);
  });

  it("keeps an uncertainty of a clean lane through a round trip", () => {
    const loaded = readGelJobConfig({ schemaVersion: 3, bands: [cleanBand()] });
    assert.equal(loaded.bands[0].laneFraction, 0.82);
    assert.equal(loaded.bands[0].laneFractionUncertainty, 0.014);
  });

  it("does not inherit a purity from a version 2 save", () => {
    const loaded = readGelJobConfig({
      schemaVersion: 2,
      purityPercent: 94.1,
      lanes: [{ id: "lane-a", label: "Lane 1", xStart: 0.1, xEnd: 0.3 }],
      bands: [
        { id: "b1", laneId: "lane-a", label: "Band 1", centerY: 0.3, density: 900, isTarget: true, autoDetected: true },
        { id: "b2", laneId: "lane-a", label: "Band 2", centerY: 0.5, density: 100, autoDetected: true },
      ],
    });
    assert.equal(laneQuantification(bandsInLane(loaded.bands, "lane-a")).kind, "unavailable");
    assert.equal(loaded.bands[0].laneFraction, null);
  });
});

describe("report", () => {
  it("names the sample and keeps the lane unavailable in the figure note", () => {
    const loaded = readGelJobConfig({ schemaVersion: 3, ...readGelAnalysis(saturatedLaneReply) });
    const note = String(gelFigureNote(loaded));
    assert.match(note, /Lane 1 · IMAC eluate: quantification unavailable/);
    assert.doesNotMatch(note, /Lane 1 · IMAC eluate: .* is \d/);
  });
});

describe("ladder inputs", () => {
  it("treats a preset and the same masses typed by hand as identical", () => {
    const preset = ladderMassesKDa("Bio-Rad Precision Plus", "");
    const typed = ladderMassesKDa("Custom", "250, 150, 100, 75, 50, 37, 25, 20, 15, 10");
    assert.deepEqual(typed, preset);
    const settings = { sensitivity: 0.58, backgroundRadiusPx: 28, ladderLaneId: "lane-ladder" };
    assert.deepEqual(
      reanalysisReasons({ ...settings, ladderMassesKDa: typed }, { ...settings, ladderMassesKDa: preset }),
      [],
    );
    assert.equal(
      calibrationStale({ ...settings, ladderMassesKDa: typed }, { ...settings, ladderMassesKDa: preset }),
      false,
    );
  });

  it("rejects a list that is not strictly top to bottom", () => {
    assert.equal(ladderMassesError([250, 150, 100]), null);
    assert.match(String(ladderMassesError([100, 150])), /decrease from top to bottom/);
    assert.match(String(ladderMassesError([50, 50])), /decrease from top to bottom/);
    assert.match(String(ladderMassesError([50])), /at least two/);
  });

  it("asks for re-detection when the ladder changes", () => {
    const analyzed = {
      sensitivity: 0.58,
      backgroundRadiusPx: 28,
      ladderLaneId: "lane-ladder",
      ladderMassesKDa: [250, 150, 100],
    };
    const current = { ...analyzed, ladderMassesKDa: [250, 140, 100] };
    assert.match(reanalysisReasons(current, analyzed).join(" "), /Ladder marker masses changed/);
    assert.equal(calibrationStale(current, analyzed), true);
    assert.equal(molecularWeightLabel(cleanBand(), true), "Re-detect for molecular weight");
  });
});

describe("csv export", () => {
  const analysis = readGelAnalysis(saturatedLaneReply);
  const rows = gelCsvRows({
    lanes: analysis.lanes,
    bands: analysis.bands.map((band) => (band.id === "band-clean" ? { ...band, isTarget: true } : band)),
    quantification: analysis.quantification,
    ladderCalibration: analysis.ladderCalibration,
    calibrationIsStale: false,
  });
  const flat = rows.map((row) => row.join("|"));
  const header = rows[0];
  const cell = (row: string[], name: string) => {
    const index = header.indexOf(name);
    assert.ok(index >= 0, `missing column ${name}`);
    return row[index];
  };
  const bandRow = (label: string, from = rows) => from.find((row) => row[header.indexOf("Band")] === label);

  it("leaves a refused density empty and states the reason", () => {
    const clipped = bandRow("Band 2");
    assert.ok(clipped);
    assert.equal(cell(clipped, "Integrated density"), "");
    assert.equal(cell(clipped, "Density uncertainty (±, noise only)"), "");
    assert.equal(cell(clipped, "Lane signal fraction (%)"), "");
    assert.equal(cell(clipped, "Quantification refused"), "yes");
    assert.match(cell(clipped, "Reason"), /saturated/);
    assert.equal(cell(clipped, "Flags"), "warning:saturated");
  });

  it("keeps the valid density of the clean band in the same lane", () => {
    const clean = bandRow("Band 1");
    assert.ok(clean);
    assert.equal(cell(clean, "Integrated density"), "1820.5000");
    assert.equal(cell(clean, "Density uncertainty (±, noise only)"), "12.4000");
    // The lane holds a saturated band, so no fraction is derived from this one.
    assert.equal(cell(clean, "Lane signal fraction (%)"), "");
    assert.equal(cell(clean, "Sample"), "IMAC eluate");
    assert.equal(cell(clean, "Stage ID"), "step-imac");
  });

  it("records the lane as unavailable and carries the method metadata", () => {
    assert.ok(flat.some((row) => /# Lane: Lane 1\|unavailable/.test(row)));
    assert.ok(flat.some((row) => row.startsWith("# Background|rolling_ball")));
    assert.ok(flat.some((row) => row === "# Background radius (px)|28"));
    assert.ok(flat.some((row) => /# Caveat\|.*not a validated protein mass purity/.test(row)));
    assert.ok(flat.some((row) => row === "# Fit R²|0.996173"));
    assert.ok(flat.some((row) => row === "ladder-2|0.2000|150.00|153.20|-3.20"));
    assert.ok(flat.some((row) => /# Density uncertainty meaning\|.*not a purity confidence interval/.test(row)));
    assert.ok(flat.some((row) => /# Image processing\|600×400 px/.test(row)));
  });

  it("withholds molecular weights when the ladder changed after analysis", () => {
    const stale = gelCsvRows({
      lanes: analysis.lanes,
      bands: analysis.bands,
      quantification: analysis.quantification,
      ladderCalibration: analysis.ladderCalibration,
      calibrationIsStale: true,
    });
    const clean = bandRow("Band 1", stale);
    assert.ok(clean);
    assert.equal(cell(clean, "MW (kDa)"), "");
    assert.equal(cell(clean, "MW status"), "stale_ladder_calibration");
  });
});
