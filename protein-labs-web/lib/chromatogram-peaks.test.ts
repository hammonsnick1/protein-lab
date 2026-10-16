import { describe, expect, it } from "vitest";
import type {
  EngineFlag,
  EnginePeak,
  SecCalibration,
  SecPrediction,
} from "./chromatography-api";
import { loadPeaks, measurePeak, studioJobConfig, type MeasuredPeak } from "./chromatogram-peaks";

// Engine shapes follow protein-labs/backend/CHROMATOGRAPHY_API.md, "Report
// diagnostics". Every test goes through the studio's own join, saved-job
// config and reopen, so dropping a field at any of the three fails here.
const model = "gaussian_fixed_apex_fwhm_amplitude_fit";
const flag = (code: string, level: EngineFlag["level"]): EngineFlag => ({
  code,
  level,
  title: code,
  message: `${code} message`,
});
const measured = (extra: Partial<EnginePeak> = {}): EnginePeak => ({
  start: 14.02,
  end: 17.98,
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
// A peak as the researcher drew it: identity, style and requested range.
const [drawn] = loadPeaks([{ id: "peak-a", traceId: "trace-1", name: "Monomer", start: 14, end: 18 }]);

/** Save through the job config, write it as the job store does, then reopen. */
function saveAndReopen(peaks: MeasuredPeak[], fit: SecCalibration | null = calibration) {
  const config = studioJobConfig({ projectName: "Test" }, peaks, fit);
  const stored = JSON.parse(JSON.stringify(config)) as { peaks: unknown; calibration: SecCalibration | null };
  return { stored, reopened: loadPeaks(stored.peaks) };
}

describe("chromatogram peaks through a saved studio job", () => {
  it("keeps values, flags, fit quality and the calibration mass range together", () => {
    const peak = measurePeak(drawn, measured(), prediction(), 1.8);
    const { stored, reopened } = saveAndReopen([peak]);

    expect(stored.calibration?.standardMassRangeKDa).toEqual([1, 1000]);
    expect(reopened[0]).toMatchObject({
      id: "peak-a",
      traceId: "trace-1",
      name: "Monomer",
      start: 14,
      end: 18,
      area: 42,
      kav: 0.5,
      mwKDa: 10,
      mwUncertaintyKDa: 1.485,
      fitQuality: { rSquared: 0.91, residual: 3.4, model },
      flags: [
        flag("poor_gaussian_fit", "caution"),
        flag("calibration_only_mass_uncertainty", "note"),
      ],
    });
  });

  it("keeps null uncertainty and null fit statistics as null, never zero", () => {
    const peak = measurePeak(
      drawn,
      measured({
        fitQuality: { rSquared: null, residual: null, model },
        flags: [flag("peak_fit_unavailable", "caution")],
      }),
      // Two standards: the engine cannot estimate scatter and says so.
      prediction({ mwUncertaintyKDa: null, flags: [flag("mass_uncertainty_unavailable", "caution")] }),
      null,
    );
    const [reopened] = saveAndReopen([peak]).reopened;

    expect(reopened.mwUncertaintyKDa).toBeNull();
    expect(reopened.fitQuality).toEqual({ rSquared: null, residual: null, model });
    expect(reopened.flags?.map((value) => value.code)).toEqual([
      "peak_fit_unavailable",
      "mass_uncertainty_unavailable",
    ]);
  });

  it("keeps an out-of-range mass absent rather than zero", () => {
    const peak = measurePeak(
      drawn,
      measured(),
      prediction({ mwKDa: null, mwUncertaintyKDa: null, outOfRange: true, flags: [] }),
      null,
    );
    const [reopened] = saveAndReopen([peak]).reopened;

    expect(reopened.mwKDa).toBeUndefined();
    expect(reopened.mwUncertaintyKDa).toBeNull();
  });

  it("keeps a zero uncertainty from an exact line with its limitation note", () => {
    const peak = measurePeak(drawn, measured({ flags: [] }), prediction({ mwUncertaintyKDa: 0 }), null);
    const [reopened] = saveAndReopen([peak]).reopened;

    expect(reopened.mwUncertaintyKDa).toBe(0);
    expect(reopened.flags?.map((value) => value.code)).toEqual(["calibration_only_mass_uncertainty"]);
  });

  it("replaces the previous prediction's flags when a reopened peak is recalibrated", () => {
    const first = measurePeak(
      drawn,
      measured(),
      prediction({ mwUncertaintyKDa: 12, flags: [flag("large_mass_uncertainty", "warning")] }),
      null,
    );
    const [reopened] = saveAndReopen([first]).reopened;
    const recalibrated = measurePeak(reopened, measured(), prediction(), null);

    expect(recalibrated.mwUncertaintyKDa).toBe(1.485);
    expect(recalibrated.flags?.map((value) => value.code)).toEqual([
      "poor_gaussian_fit",
      "calibration_only_mass_uncertainty",
    ]);
  });

  it("clears a stored uncertainty when the peak no longer has an SEC mass", () => {
    const [reopened] = saveAndReopen([measurePeak(drawn, measured(), prediction(), null)]).reopened;
    const minutes = measurePeak(reopened, measured(), undefined, null);
    const [again] = saveAndReopen([minutes], null).reopened;

    expect(again).not.toHaveProperty("mwUncertaintyKDa");
    expect(again.flags?.map((value) => value.code)).toEqual(["poor_gaussian_fit"]);
  });

  it("keeps stored diagnostics with stored numbers while the engine has no result", () => {
    const [reopened] = saveAndReopen([measurePeak(drawn, measured(), prediction(), null)]).reopened;
    const unmeasured = measurePeak(reopened, undefined, undefined, null);
    const [again] = saveAndReopen([unmeasured]).reopened;

    expect(unmeasured.measured).toBe(false);
    expect(again).toMatchObject({ mwKDa: 10, mwUncertaintyKDa: 1.485 });
    expect(again.flags).toHaveLength(2);
  });

  it("opens an older project without inventing diagnostics", () => {
    const [reopened] = loadPeaks([{ id: "old", area: 3, mwKDa: null, kav: null }]);

    expect(reopened.id).toBe("old");
    expect(reopened.mwKDa).toBeUndefined();
    expect(reopened.kav).toBeUndefined();
    expect(reopened).not.toHaveProperty("flags");
    expect(reopened).not.toHaveProperty("fitQuality");
    expect(reopened).not.toHaveProperty("mwUncertaintyKDa");
  });
});
