// Client for the Python gel densitometry engine
// (protein-labs/backend/protein_labs/gel_analysis.py, POST /v1/gel/analyze).
//
// Every quantity the gel studio shows — integrated density, lane signal
// fraction, its uncertainty, and molecular weight — is produced by that engine.
// Nothing in this module or its consumers recalculates a measurement, and
// nothing substitutes a number for one the engine declined to report: a refused
// density arrives as `null` and stays `null` all the way to the screen, the
// saved job, the report and the CSV.
import { request } from "@/lib/protein-labs-api";

export type GelLaneInput = {
  id?: string;
  label: string;
  xStart: number;
  xEnd: number;
  isLadder: boolean;
  // What was loaded in the lane, and the purification step it belongs to. The
  // engine echoes both and never invents a stage id, so `null` means unbound.
  sampleLabel: string;
  stageId: string | null;
};

export type GelLane = GelLaneInput & { id: string };

export type GelAnalyzeRequest = {
  filename: string;
  imageBase64: string;
  sensitivity: number;
  backgroundRadiusPx: number;
  // Omitted entirely to ask the engine to find the lanes itself. Sent back
  // verbatim to re-integrate the lanes the scientist curated.
  lanes?: GelLaneInput[];
  // Marker masses ordered top to bottom. The engine needs one per detected
  // ladder band and reports a count mismatch rather than guessing an
  // assignment, so this list is never truncated to fit.
  ladderMassesKDa?: number[];
};

// Why a band carries no lane fraction. The engine refuses a whole lane when any
// band in it is clipped, because the remaining subset is no longer a fraction
// of anything measurable.
export type NormalizationBasis =
  | "fraction_of_detected_band_integrals"
  | "lane_fraction_unavailable_due_to_saturation";

export type MolecularWeightStatus =
  | "estimated"
  | "outside_ladder_range"
  | "quantification_refused"
  | "no_ladder_lane"
  | "insufficient_ladder_bands"
  | "ladder_masses_required"
  | "ladder_mass_count_mismatch"
  | "ambiguous_ladder_mobility";

// A machine-readable caveat from the engine. `level` is "warning" for a
// refusal, "caution" for a result it will not extrapolate, "note" for a
// qualification of a number it did report.
export type GelBandFlag = {
  code: string;
  level: string;
  title: string;
  message: string;
};

export type GelBand = {
  id: string;
  laneId: string;
  label: string;
  yStart: number;
  yEnd: number;
  centerY: number;
  peakSignal: number | null;
  // `null` means the engine did not report a density. It is never 0.
  density: number | null;
  // Noise-only approximate standard error on the density. Not a purity
  // confidence interval: background bias and staining response are excluded.
  densityUncertainty: number | null;
  flags: GelBandFlag[];
  laneFraction: number | null;
  laneFractionUncertainty: number | null;
  normalizationBasis: NormalizationBasis | null;
  quantificationRefused: boolean;
  saturationReason: string | null;
  molecularWeightDa: number | null;
  molecularWeightStatus: MolecularWeightStatus | null;
  ladderMarkerMassDa: number | null;
  autoDetected: boolean;
  isTarget: boolean;
  // Studio-owned, never set by the engine: the lane was edited after the last
  // detection, so the engine's lane fractions no longer describe its contents.
  laneFractionStaleReason: string | null;
};

export type GelImageProcessing = {
  downscaled: boolean;
  originalWidth: number | null;
  originalHeight: number | null;
  maxDimensionLimit: number | null;
  scaleFactor: number | null;
  resampling: string | null;
};

export type GelLinearRange = {
  minSignal: number | null;
  maxSignal: number | null;
  unit: string;
};

export type GelQuantification = {
  backgroundMethod: string;
  backgroundRadiusPx: number | null;
  backgroundKernel: string;
  backgroundIntensityRadius: number | null;
  backgroundBoundary: string;
  laneGeometry: string;
  uncertaintyMethod: string;
  uncertaintyPropagation: string;
  profileNoiseFloor: number | null;
  profileSmoothingRadiusPx: number | null;
  caveats: string[];
  normalizationBasis: string;
  linearDynamicRange: GelLinearRange;
  imageProcessing: GelImageProcessing;
};

// One marker that entered the fit, with the engine's own residual. Masses are
// kDa here; `slope` and `intercept` below are the log₁₀(Da) fit, so neither is
// read as a kDa quantity.
export type LadderMatchedBand = {
  bandId: string;
  relativeMobility: number | null;
  massKDa: number | null;
  fittedKDa: number | null;
  residualKDa: number | null;
};

export type GelLadderCalibration = {
  method: string;
  status: string;
  relativeMobilityAxis: string;
  markerAssignment: string;
  assumption: string;
  // `r2` is unrounded; `fitR2` is the rounded legacy field.
  r2: number | null;
  fitR2: number | null;
  slope: number | null;
  intercept: number | null;
  residualConvention: string;
  matchedBands: LadderMatchedBand[];
  ladderBandCount: number | null;
  calibrationMarkerCount: number | null;
  mobilityRange: [number, number] | null;
  detectedMarkerCount: number | null;
  providedMarkerCount: number | null;
};

export type GelAnalysis = {
  source: string;
  width: number | null;
  height: number | null;
  polarity: string;
  previewBase64: string;
  lanes: GelLane[];
  bands: GelBand[];
  quantification: GelQuantification | null;
  ladderCalibration: GelLadderCalibration | null;
};

export const gelApi = {
  analyze: (body: GelAnalyzeRequest) =>
    request<unknown>("/v1/gel/analyze", { method: "POST", body: JSON.stringify(body) }),
};
