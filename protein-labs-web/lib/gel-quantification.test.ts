// Focused tests for the honesty rules of the gel studio. Run with
// `npm run test` in protein-labs-web (Node's built-in runner, no extra deps).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  bandQuantification,
  bandQuantificationNote,
  calibrationStale,
  finiteOrNull,
  formatSignalFraction,
  gelCsvRows,
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
  lanes: [{ id: "lane-a", label: "Lane 1", xStart: 0.1, xEnd: 0.3, isLadder: false }],
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
    fitR2: 0.9962,
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

  it("leaves a refused density empty and states the reason", () => {
    const clipped = rows.find((row) => row[1] === "Band 2");
    assert.ok(clipped);
    assert.equal(clipped[6], "");
    assert.equal(clipped[7], "");
    assert.equal(clipped[10], "yes");
    assert.match(clipped[11], /saturated/);
  });

  it("keeps the valid density of the clean band in the same lane", () => {
    const clean = rows.find((row) => row[1] === "Band 1");
    assert.ok(clean);
    assert.equal(clean[6], "1820.5000");
    assert.equal(clean[7], "");
  });

  it("records the lane as unavailable and carries the method metadata", () => {
    assert.ok(flat.some((row) => /# Lane: Lane 1\|unavailable/.test(row)));
    assert.ok(flat.some((row) => row.startsWith("# Background|rolling_ball")));
    assert.ok(flat.some((row) => row === "# Background radius (px)|28"));
    assert.ok(flat.some((row) => /# Caveat\|.*not a validated protein mass purity/.test(row)));
    assert.ok(flat.some((row) => row === "# Fit R²|0.9962"));
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
    const clean = stale.find((row) => row[1] === "Band 1");
    assert.ok(clean);
    assert.equal(clean[4], "");
    assert.equal(clean[5], "stale_ladder_calibration");
  });
});
