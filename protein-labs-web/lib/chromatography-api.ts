// Client for the Python chromatography engine (v1 of
// protein-labs/backend/CHROMATOGRAPHY_API.md). Every quantity the studio
// reports — baseline, smoothing, peak areas, FWHM, asymmetry, resolution, SEC
// Kav/Mw and mass recovery — comes from these two endpoints. Nothing in this
// module recalculates a measurement; it only shapes requests and reads results.
import { request } from "@/lib/protein-labs-api";

export type ChromPoint = { x: number; y: number };
export type ChromRange = { start: number; end: number };
export type AxisX = "mL" | "min";
export type AxisY = "mAU" | "mg/mL";
export type ChromUnits = { x: AxisX; y: AxisY };
// The engine echoes the requested axes plus the derived units it used, so a
// readout never has to guess what "area" or "mass" means.
export type ResultUnits = ChromUnits & {
  area: string;
  width: string;
  mw: string;
  mass: string;
  recovery: string;
};
export type SecStandardInput = { mwDa: number; veMl: number; included: boolean };
export type SecInput = { voMl: number; vtMl: number; standards: SecStandardInput[] };
export type MassBalanceInput = {
  loadedMg: number;
  responseFactorMAUPerMgMl?: number;
  flowMlPerMin?: number;
};
export type AnalyzeRequest = {
  schemaVersion: 1;
  units: ChromUnits;
  points: ChromPoint[];
  processing: { smoothing: number; baseline: "none" | "percentile5" };
  // Omitted entirely to ask the engine to detect ranges; [] processes without
  // detecting. Non-overlapping and inside the trace, or the engine rejects it.
  ranges?: ChromRange[];
  maxPeaks?: number;
  sec?: SecInput;
  massBalance?: MassBalanceInput;
};
// Report diagnostics (additive v1 fields). Engines built before they existed
// omit them, so every one is optional on the way in.
export type EngineFlag = {
  code: string;
  level: "note" | "caution" | "warning";
  title: string;
  message: string;
};
// `residual` is RMSE in the input y units. Both statistics are null when the
// peak has too few samples or no usable FWHM; R² can be negative.
export type FitQuality = {
  rSquared: number | null;
  residual: number | null;
  model: string;
};
export type EnginePeak = {
  start: number;
  end: number;
  apexX: number;
  response: number;
  height: number;
  area: number;
  fwhm: number | null;
  asymmetry10: number | null;
  flags?: EngineFlag[];
  fitQuality?: FitQuality;
  kav?: number;
  mwKDa?: number | null;
  // One-sigma, calibration-only. Null when it cannot be estimated.
  mwUncertaintyKDa?: number | null;
  outOfRange?: boolean;
};
export type SecCalibration = {
  slope: number;
  intercept: number;
  r2: number;
  logMwDaRange: [number, number];
  veMlRange: [number, number];
  voMl: number;
  vtMl: number;
  standardCount: number;
  // Included standards only, in kDa.
  standardMassRangeKDa?: [number, number];
  residualVarianceKav?: number | null;
  meanLogMwDa?: number;
  sumSquaredLogMwDa?: number;
};
export type EngineResolution = {
  leftPeakIndex: number;
  rightPeakIndex: number;
  rs: number | null;
};
export type EngineMassBalance = {
  status: "not_requested" | "calculated";
  integratedArea: number;
  recoveredMg: number | null;
  recoveryPercent: number | null;
  loadedMg?: number;
  unaccountedMg?: number;
  exceedsLoaded?: boolean;
};
export type EngineMethods = {
  baseline: string;
  peakBaseline: string;
  resolution: string;
  asymmetry: string;
  noise: string;
};
export type AnalyzeResult = {
  schemaVersion: 1;
  units: ResultUnits;
  points: ChromPoint[];
  baselineOffset: number;
  peaks: EnginePeak[];
  calibration: SecCalibration | null;
  resolutions: EngineResolution[];
  massBalance: EngineMassBalance;
  methods: EngineMethods;
};
export type SecPrediction = {
  veMl: number;
  kav: number;
  mwKDa: number | null;
  mwUncertaintyKDa?: number | null;
  outOfRange: boolean;
  flags?: EngineFlag[];
};
export type CalibrateSecResult = {
  schemaVersion: 1;
  calibration: SecCalibration;
  predictions: SecPrediction[];
};

export const chromatographyApi = {
  analyze: (body: AnalyzeRequest, signal?: AbortSignal) =>
    request<AnalyzeResult>("/v1/chromatogram/analyze", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
  calibrateSec: (
    body: SecInput & { elutionVolumesMl?: number[] },
    signal?: AbortSignal,
  ) =>
    request<CalibrateSecResult>("/v1/chromatogram/calibrate-sec", {
      method: "POST",
      body: JSON.stringify(body),
      signal,
    }),
};

// The engine needs 3 samples with strictly increasing x. Shorter runs of
// surviving points are real data the researcher can still see, but they cannot
// be measured, so they are reported rather than quietly merged into a neighbour.
export const minimumSegmentPoints = 3;

/**
 * Split a trace at its excluded regions so the engine never integrates across
 * a gap: each contiguous run of surviving samples becomes its own request.
 */
export function traceSegments(points: ChromPoint[], excluded: ChromRange[]) {
  const segments: ChromPoint[][] = [];
  let current: ChromPoint[] = [];
  for (const point of points) {
    const dropped = excluded.some(
      (range) => point.x >= Math.min(range.start, range.end) && point.x <= Math.max(range.start, range.end),
    );
    if (dropped) {
      if (current.length) segments.push(current);
      current = [];
      continue;
    }
    // A repeated or decreasing x would be rejected by the engine; break the
    // segment there rather than sending data it has to refuse.
    if (current.length && point.x <= current[current.length - 1].x) {
      segments.push(current);
      current = [];
    }
    current.push(point);
  }
  if (current.length) segments.push(current);
  return segments;
}

/** The engine measures only inside the trace, so snap a dragged region onto the samples it owns. */
export function clampToSegment(range: ChromRange, points: ChromPoint[]): ChromRange | null {
  if (points.length < minimumSegmentPoints) return null;
  const start = Math.max(points[0].x, Math.min(range.start, range.end));
  const end = Math.min(points[points.length - 1].x, Math.max(range.start, range.end));
  if (!(start < end)) return null;
  const inside = points.filter((point) => point.x >= start && point.x <= end);
  if (inside.length < minimumSegmentPoints) return null;
  return { start, end };
}
