import { describe, expect, it } from "vitest";
import type {
  EngineFlag,
  EnginePeak,
  SecCalibration,
  SecPrediction,
} from "./chromatography-api";
import { loadPeakDiagnostics, peakDiagnostics } from "./chromatogram-diagnostics";

// Shapes follow protein-labs/backend/CHROMATOGRAPHY_API.md, "Report diagnostics".
const model = "gaussian_fixed_apex_fwhm_amplitude_fit";
const flag = (code: string, level: EngineFlag["level"]): EngineFlag => ({
  code,
  level,
  title: code,
  message: `${code} message`,
});
const measured = (extra: Partial<EnginePeak> = {}): EnginePeak => ({
  start: 14,
  end: 18,
  apexX: 16,
  response: 120,
  height: 118,
  area: 42,
  fwhm: 1.2,
  asymmetry10: 1.1,
  fitQuality: { rSquared: 0.91, residual: 3.4, model },
  flags: [flag("poor_gaussian_fit", "caution")],
  ...extra,
});
const prediction = (extra: Partial<SecPrediction> = {}): SecPrediction => ({
  veMl: 16,
  kav: 0.5,
  mwKDa: 10,
  mwUncertaintyKDa: 1.485,
  outOfRange: false,
  flags: [flag("calibration_only_mass_uncertainty", "note")],
  ...extra,
});
const calibration: SecCalibration = {
  slope: -0.25,
  intercept: 1.5,
  r2: 0.999,
  logMwDaRange: [3, 6],
  veMlRange: [12, 20],
  voMl: 8,
  vtMl: 24,
  standardCount: 4,
  standardMassRangeKDa: [1, 1000],
  residualVarianceKav: 0.0002,
  meanLogMwDa: 4.5,
  sumSquaredLogMwDa: 5,
};

/** What the studio writes to the job, then what a reopen reads back. */
function saveAndReopen(peaks: Record<string, unknown>[]) {
  const saved = JSON.parse(JSON.stringify({ peaks, calibration })) as {
    peaks: Record<string, unknown>[];
    calibration: SecCalibration;
  };
  return { ...saved, reopened: saved.peaks.map(loadPeakDiagnostics) };
}

describe("peak diagnostics through a saved chromatogram job", () => {
  it("keeps values, flags and the calibration mass range together", () => {
    const peak = { id: "peak-a", ...peakDiagnostics(measured(), prediction()) };
    const { reopened, calibration: savedFit, peaks } = saveAndReopen([peak]);

    expect(peaks[0].id).toBe("peak-a");
    expect(reopened[0]).toEqual({
      fitQuality: { rSquared: 0.91, residual: 3.4, model },
      mwUncertaintyKDa: 1.485,
      flags: [
        flag("poor_gaussian_fit", "caution"),
        flag("calibration_only_mass_uncertainty", "note"),
      ],
    });
    expect(savedFit.standardMassRangeKDa).toEqual([1, 1000]);
  });

  it("keeps null uncertainty and null fit statistics as null, never zero", () => {
    const peak = peakDiagnostics(
      measured({
        fitQuality: { rSquared: null, residual: null, model },
        flags: [flag("peak_fit_unavailable", "caution")],
      }),
      // Two standards: the engine cannot estimate scatter and says so.
      prediction({
        mwUncertaintyKDa: null,
        flags: [flag("mass_uncertainty_unavailable", "caution")],
      }),
    );
    const [reopened] = saveAndReopen([peak]).reopened;

    expect(reopened.mwUncertaintyKDa).toBeNull();
    expect(reopened.fitQuality).toEqual({ rSquared: null, residual: null, model });
    expect(reopened.flags?.map((value) => value.code)).toEqual([
      "peak_fit_unavailable",
      "mass_uncertainty_unavailable",
    ]);
  });

  it("keeps a zero uncertainty from an exact line with its limitation note", () => {
    const peak = peakDiagnostics(measured({ flags: [] }), prediction({ mwUncertaintyKDa: 0 }));
    const [reopened] = saveAndReopen([peak]).reopened;

    expect(reopened.mwUncertaintyKDa).toBe(0);
    expect(reopened.flags?.map((value) => value.code)).toEqual(["calibration_only_mass_uncertainty"]);
  });

  it("replaces the previous prediction's flags when the column is recalibrated", () => {
    const first = peakDiagnostics(
      measured(),
      prediction({ mwUncertaintyKDa: 12, flags: [flag("large_mass_uncertainty", "warning")] }),
    );
    // The studio spreads fresh diagnostics over the stored peak.
    const recalibrated = { ...first, ...peakDiagnostics(measured(), prediction()) };

    expect(recalibrated.mwUncertaintyKDa).toBe(1.485);
    expect(recalibrated.flags.map((value) => value.code)).toEqual([
      "poor_gaussian_fit",
      "calibration_only_mass_uncertainty",
    ]);
  });

  it("clears a stored uncertainty when the peak no longer has an SEC mass", () => {
    const stored = peakDiagnostics(measured(), prediction());
    const minutes = { ...stored, ...peakDiagnostics(measured()) };
    const [reopened] = saveAndReopen([minutes]).reopened;

    expect(reopened).not.toHaveProperty("mwUncertaintyKDa");
    expect(reopened.flags?.map((value) => value.code)).toEqual(["poor_gaussian_fit"]);
  });

  it("opens an older project without inventing diagnostics", () => {
    const [reopened] = saveAndReopen([{ id: "old", area: 3, mwKDa: 44 }]).reopened;
    expect(reopened).toEqual({});
  });
});
