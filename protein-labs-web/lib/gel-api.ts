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
  caveats: string[];
  normalizationBasis: string;
  linearDynamicRange: GelLinearRange;
  imageProcessing: GelImageProcessing;
};

export type GelLadderCalibration = {
  method: string;
  status: string;
  relativeMobilityAxis: string;
  markerAssignment: string;
  assumption: string;
  fitR2: number | null;
  slope: number | null;
  intercept: number | null;
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
