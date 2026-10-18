// Reading and presenting gel densitometry results honestly.
//
// This module has one job: carry what the Python engine reported — including
// what it refused to report — through display, save/load, the report and the
// CSV without inventing a number. It therefore contains no arithmetic on
// measurements beyond unit conversion and percentage formatting. In particular
// it never sums densities to recover a lane fraction the engine withheld: a
// lane with one clipped band has no measurable total, so the fraction of the
// remaining bands is not a purity, and no selection of a target band can make
// it one.
//
// Only erasable TypeScript syntax and type-only imports are used, so the unit
// tests can run this file directly under `node --test`.
import type {
  GelAnalysis,
  GelBand,
  GelBandFlag,
  GelImageProcessing,
  GelLadderCalibration,
  GelLane,
  GelLinearRange,
  GelQuantification,
  MolecularWeightStatus,
  NormalizationBasis,
} from "@/lib/gel-api";

export const LADDER_PRESETS: Record<string, number[]> = {
  "Bio-Rad Precision Plus": [250, 150, 100, 75, 50, 37, 25, 20, 15, 10],
  "Thermo PageRuler Plus": [250, 130, 100, 70, 55, 35, 25, 15, 10],
  "NEB Color Prestained": [245, 180, 135, 100, 75, 63, 48, 35, 25, 20, 17, 11],
  Custom: [],
};

export const DEFAULT_BACKGROUND_RADIUS_PX = 28;
export const MIN_BACKGROUND_RADIUS_PX = 4;
export const MAX_BACKGROUND_RADIUS_PX = 120;

/** What the studio may say about a single band's density. */
export type BandQuantification =
  | "quantified"
  | "refused_saturated"
  | "manual_annotation"
  | "not_quantified";

/** What the studio may say about the selected lane as a whole. */
export type LaneQuantification =
  | { kind: "no_bands" }
  | { kind: "needs_target" }
  | { kind: "available"; fraction: number; uncertainty: number | null; basis: NormalizationBasis | null }
  | { kind: "unavailable"; headline: string; detail: string[] };

/** The engine inputs that change a result, so a change demands re-detection. */
export type DetectionSettings = {
  sensitivity: number;
  backgroundRadiusPx: number;
  ladderMassesKDa: number[];
  ladderLaneId: string;
};

function record(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function list(value: unknown): unknown[] {
  return Array.isArray(value) ? value : [];
}

function text(value: unknown, fallback = ""): string {
  return typeof value === "string" && value.length ? value : fallback;
}

/**
 * The central honesty primitive: a missing, null or unparseable measurement
 * reads as `null`, never as 0. `Number(null)` is 0, which is how a refused
 * density used to become a confident "0.0" in a purity denominator.
 */
export function finiteOrNull(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string" && value.trim().length) {
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}

function clampedNumber(value: unknown, fallback: number, low: number, high: number): number {
  const parsed = finiteOrNull(value);
  return parsed === null ? fallback : Math.max(low, Math.min(high, parsed));
}

const MOLECULAR_WEIGHT_STATUSES: MolecularWeightStatus[] = [
  "estimated",
  "outside_ladder_range",
  "quantification_refused",
  "no_ladder_lane",
  "insufficient_ladder_bands",
  "ladder_masses_required",
  "ladder_mass_count_mismatch",
  "ambiguous_ladder_mobility",
];

const NORMALIZATION_BASES: NormalizationBasis[] = [
  "fraction_of_detected_band_integrals",
  "lane_fraction_unavailable_due_to_saturation",
];

export function readGelLane(value: unknown, index: number): GelLane {
  const raw = record(value);
  const label = text(raw.label, `Lane ${index + 1}`);
  return {
    id: text(raw.id, `lane-${index + 1}`),
    label,
    xStart: clampedNumber(raw.xStart, 0, 0, 1),
    xEnd: clampedNumber(raw.xEnd, 1, 0, 1),
    isLadder: raw.isLadder === true,
    sampleLabel: text(raw.sampleLabel, label),
    // A stage binding comes from the caller or nowhere; it is never inferred.
    stageId: text(raw.stageId) || null,
  };
}

function readBandFlags(value: unknown): GelBandFlag[] {
  return list(value)
    .map((item) => {
      const raw = record(item);
      return {
        code: text(raw.code),
        level: text(raw.level, "note"),
        title: text(raw.title),
        message: text(raw.message),
      };
    })
    .filter((flag) => flag.code.length > 0 && flag.message.length > 0);
}

/**
 * Reads one band from an engine reply or a saved job. Bands the scientist drew
 * by hand are forced back to "no density": an older save gave them a
 * placeholder density of 1, which is an outline, not a measurement.
 */
export function readGelBand(value: unknown, index: number): GelBand {
  const raw = record(value);
  const autoDetected = raw.autoDetected !== false;
  const refused = raw.quantificationRefused === true;
  const density = autoDetected && !refused ? finiteOrNull(raw.density) : null;
  const quantified = density !== null;
  const basis = NORMALIZATION_BASES.find((candidate) => candidate === raw.normalizationBasis) ?? null;
  const status =
    MOLECULAR_WEIGHT_STATUSES.find((candidate) => candidate === raw.molecularWeightStatus) ?? null;
  return {
    id: text(raw.id, `band-${index + 1}`),
    laneId: text(raw.laneId),
    label: text(raw.label, `Band ${index + 1}`),
    yStart: clampedNumber(raw.yStart, 0, 0, 1),
    yEnd: clampedNumber(raw.yEnd, 1, 0, 1),
    centerY: clampedNumber(raw.centerY, 0, 0, 1),
    peakSignal: autoDetected ? finiteOrNull(raw.peakSignal) : null,
    density,
    densityUncertainty: quantified ? finiteOrNull(raw.densityUncertainty) : null,
    flags: readBandFlags(raw.flags),
    laneFraction: quantified ? finiteOrNull(raw.laneFraction) : null,
    laneFractionUncertainty: quantified ? finiteOrNull(raw.laneFractionUncertainty) : null,
    normalizationBasis: quantified || refused ? basis : null,
    quantificationRefused: refused,
    saturationReason: refused ? text(raw.saturationReason) || null : null,
    molecularWeightDa: status === "estimated" ? finiteOrNull(raw.molecularWeightDa) : null,
    molecularWeightStatus: status,
    ladderMarkerMassDa: finiteOrNull(raw.ladderMarkerMassDa),
    autoDetected,
    isTarget: raw.isTarget === true,
    laneFractionStaleReason: text(raw.laneFractionStaleReason) || null,
  };
}

export function readGelImageProcessing(value: unknown): GelImageProcessing {
  const raw = record(value);
  return {
    downscaled: raw.downscaled === true,
    originalWidth: finiteOrNull(raw.originalWidth),
    originalHeight: finiteOrNull(raw.originalHeight),
    maxDimensionLimit: finiteOrNull(raw.maxDimensionLimit),
    scaleFactor: finiteOrNull(raw.scaleFactor),
    resampling: text(raw.resampling) || null,
  };
}

export function readGelLinearRange(value: unknown): GelLinearRange {
  const raw = record(value);
  return {
    minSignal: finiteOrNull(raw.minSignal),
    maxSignal: finiteOrNull(raw.maxSignal),
    unit: text(raw.unit),
  };
}

export function readGelQuantification(value: unknown): GelQuantification | null {
  if (!Object.keys(record(value)).length) return null;
  const raw = record(value);
  return {
    backgroundMethod: text(raw.backgroundMethod),
    backgroundRadiusPx: finiteOrNull(raw.backgroundRadiusPx),
    backgroundKernel: text(raw.backgroundKernel),
    backgroundIntensityRadius: finiteOrNull(raw.backgroundIntensityRadius),
    backgroundBoundary: text(raw.backgroundBoundary),
    laneGeometry: text(raw.laneGeometry),
    uncertaintyMethod: text(raw.uncertaintyMethod),
    uncertaintyPropagation: text(raw.uncertaintyPropagation),
    profileNoiseFloor: finiteOrNull(raw.profileNoiseFloor),
    profileSmoothingRadiusPx: finiteOrNull(raw.profileSmoothingRadiusPx),
    caveats: list(raw.caveats).map((caveat) => text(caveat)).filter((caveat) => caveat.length > 0),
    normalizationBasis: text(raw.normalizationBasis),
    linearDynamicRange: readGelLinearRange(raw.linearDynamicRange),
    imageProcessing: readGelImageProcessing(raw.imageProcessing),
  };
}

export function readLadderCalibration(value: unknown): GelLadderCalibration | null {
  if (!Object.keys(record(value)).length) return null;
  const raw = record(value);
  const range = list(raw.mobilityRange).map(finiteOrNull);
  return {
    method: text(raw.method),
    status: text(raw.status, "unknown"),
    relativeMobilityAxis: text(raw.relativeMobilityAxis),
    markerAssignment: text(raw.markerAssignment),
    assumption: text(raw.assumption),
    r2: finiteOrNull(raw.r2),
    fitR2: finiteOrNull(raw.fitR2),
    slope: finiteOrNull(raw.slope),
    intercept: finiteOrNull(raw.intercept),
    residualConvention: text(raw.residualConvention),
    matchedBands: list(raw.matchedBands)
      .map((item) => {
        const matched = record(item);
        return {
          bandId: text(matched.bandId),
          relativeMobility: finiteOrNull(matched.relativeMobility),
          massKDa: finiteOrNull(matched.massKDa),
          fittedKDa: finiteOrNull(matched.fittedKDa),
          residualKDa: finiteOrNull(matched.residualKDa),
        };
      })
      .filter((matched) => matched.bandId.length > 0),
    ladderBandCount: finiteOrNull(raw.ladderBandCount),
    calibrationMarkerCount: finiteOrNull(raw.calibrationMarkerCount),
    mobilityRange:
      range.length === 2 && range[0] !== null && range[1] !== null ? [range[0], range[1]] : null,
    detectedMarkerCount: finiteOrNull(raw.detectedMarkerCount),
    providedMarkerCount: finiteOrNull(raw.providedMarkerCount),
  };
}

export function readGelAnalysis(value: unknown): GelAnalysis {
  const raw = record(value);
  return {
    source: text(raw.source, "gel image"),
    width: finiteOrNull(raw.width),
    height: finiteOrNull(raw.height),
    polarity: text(raw.polarity),
    previewBase64: text(raw.previewBase64),
    lanes: list(raw.lanes).map(readGelLane),
    bands: list(raw.bands).map(readGelBand),
    quantification: readGelQuantification(raw.quantification),
    ladderCalibration: readLadderCalibration(raw.ladderCalibration),
  };
}

export function bandQuantification(band: GelBand): BandQuantification {
  if (band.quantificationRefused) return "refused_saturated";
  if (!band.autoDetected) return "manual_annotation";
  return band.density === null ? "not_quantified" : "quantified";
}

export function bandQuantificationNote(band: GelBand): string | null {
  switch (bandQuantification(band)) {
    case "refused_saturated":
      return (
        band.saturationReason ??
        "The engine refused to quantify this band because its pixels are saturated."
      );
    case "manual_annotation":
      return "Manually drawn outline. The engine has not integrated it, so it carries no density, fraction or molecular weight. Re-detect in lanes to quantify it.";
    case "not_quantified":
      return "The engine reported no density for this band. Re-detect in lanes to quantify it.";
    default:
      return null;
  }
}

const BASIS_DETAIL: Record<NormalizationBasis, string> = {
  fraction_of_detected_band_integrals:
    "Engine basis: fraction of detected band integrals in this lane.",
  lane_fraction_unavailable_due_to_saturation:
    "Engine basis: lane fraction unavailable because a band in this lane is saturated.",
};

export function normalizationBasisDetail(basis: NormalizationBasis | null): string {
  return basis === null
    ? "No normalization basis was reported for this lane."
    : BASIS_DETAIL[basis];
}

/**
 * The lane verdict. Saturation and lane edits are checked before the target
 * band, so choosing a target can never turn an unquantifiable lane into a
 * number, and the engine's own `laneFraction` is the only fraction reported.
 */
export function laneQuantification(laneBands: GelBand[]): LaneQuantification {
  if (!laneBands.length) return { kind: "no_bands" };

  const refused = laneBands.filter((band) => band.quantificationRefused);
  if (refused.length) {
    const reasons = unique(
      refused.map(
        (band) =>
          `${band.label}: ${band.saturationReason ?? "saturated pixels outside the linear range"}`,
      ),
    );
    return {
      kind: "unavailable",
      headline: `${refused.length} saturated band${refused.length === 1 ? "" : "s"} in this lane`,
      detail: [
        ...reasons,
        "A lane fraction needs a measurable lane total, so the engine withholds it for every band here — including the bands it did quantify.",
        "Re-image the gel with a shorter exposure to quantify this lane.",
      ],
    };
  }

  const stale = unique(
    laneBands
      .map((band) => band.laneFractionStaleReason)
      .filter((reason): reason is string => reason !== null),
  );
  if (stale.length) {
    return {
      kind: "unavailable",
      headline: "Lane edited since the last detection",
      detail: [...stale, "Re-detect in lanes to quantify the lane as it now stands."],
    };
  }

  const manual = laneBands.filter((band) => !band.autoDetected);
  if (manual.length) {
    return {
      kind: "unavailable",
      headline: `${manual.length} manually drawn band${manual.length === 1 ? "" : "s"} in this lane`,
      detail: [
        `Not integrated by the engine: ${manual.map((band) => band.label).join(", ")}.`,
        "Re-detect in lanes so every band in the lane is measured before a fraction is reported.",
      ],
    };
  }

  const target = laneBands.find((band) => band.isTarget);
  if (!target) return { kind: "needs_target" };

  if (target.laneFraction === null) {
    return {
      kind: "unavailable",
      headline: "The engine reported no lane fraction for the target band",
      detail: [normalizationBasisDetail(target.normalizationBasis)],
    };
  }

  return {
    kind: "available",
    fraction: target.laneFraction,
    uncertainty: target.laneFractionUncertainty,
    basis: target.normalizationBasis,
  };
}

export function bandsInLane(bands: GelBand[], laneId: string): GelBand[] {
  return bands
    .filter((band) => band.laneId === laneId)
    .sort((left, right) => left.centerY - right.centerY);
}

/**
 * Drops the engine's lane fractions for a lane the scientist just changed,
 * recording why. The densities the engine did measure are left untouched; only
 * the normalization — which depended on the lane's full band set — is retired.
 */
export function invalidateLaneFractions(bands: GelBand[], laneId: string, reason: string): GelBand[] {
  return bands.map((band) =>
    band.laneId === laneId && !band.quantificationRefused
      ? {
          ...band,
          laneFraction: null,
          laneFractionUncertainty: null,
          normalizationBasis: null,
          laneFractionStaleReason: reason,
        }
      : band,
  );
}

const MOLECULAR_WEIGHT_LABELS: Record<Exclude<MolecularWeightStatus, "estimated">, string> = {
  outside_ladder_range: "Outside ladder range",
  quantification_refused: "Not estimated · saturated band",
  no_ladder_lane: "Mark a ladder lane",
  insufficient_ladder_bands: "Ladder needs two clean bands",
  ladder_mass_count_mismatch: "Ladder masses do not match detected markers",
  ladder_masses_required: "Ladder masses required",
  ambiguous_ladder_mobility: "Ladder bands share a mobility",
};

/** The molecular weight exactly as the engine left it, or why there isn't one. */
export function molecularWeightLabel(band: GelBand, stale = false): string {
  if (stale) return "Re-detect for molecular weight";
  if (band.molecularWeightStatus === "estimated" && band.molecularWeightDa !== null) {
    return `${formatKDa(band.molecularWeightDa)} kDa`;
  }
  if (band.molecularWeightStatus === null) return "Not reported";
  if (band.molecularWeightStatus === "estimated") return "Not reported";
  return MOLECULAR_WEIGHT_LABELS[band.molecularWeightStatus];
}

export function formatKDa(molecularWeightDa: number): string {
  const kDa = molecularWeightDa / 1000;
  return kDa >= 100 ? kDa.toFixed(0) : kDa.toFixed(1);
}

export function formatPercent(fraction: number, digits = 1): string {
  return `${(fraction * 100).toFixed(digits)}%`;
}

/** "86.2% ± 1.4%", or just the fraction when the engine reported no uncertainty. */
export function formatSignalFraction(fraction: number, uncertainty: number | null): string {
  return uncertainty === null
    ? formatPercent(fraction)
    : `${formatPercent(fraction)} ± ${formatPercent(uncertainty)}`;
}

/** The density with the engine's noise-only standard error, when it gave one. */
export function formatDensity(density: number | null, uncertainty: number | null = null): string {
  if (density === null) return "—";
  return uncertainty === null ? density.toFixed(1) : `${density.toFixed(1)} ± ${uncertainty.toFixed(1)}`;
}

export const DENSITY_UNCERTAINTY_CAVEAT =
  "Noise-only approximate standard error. It is not a purity confidence interval: background bias, staining response and lane curvature are excluded.";

export const SIGNAL_FRACTION_CAVEAT =
  "Fraction of the detected band signal in this lane. It is not a validated protein mass purity: undetected material is excluded and staining response is assumed linear.";

export function ladderMassesKDa(preset: string, customText: string): number[] {
  return preset === "Custom" ? parseMassText(customText) : (LADDER_PRESETS[preset] ?? []);
}

export function parseMassText(value: string): number[] {
  return value
    .split(/[,;\s]+/)
    .map((part) => finiteOrNull(part))
    .filter((mass): mass is number => mass !== null && mass > 0);
}

/**
 * The engine rejects a mass list that is not strictly decreasing, so the studio
 * says so before spending a request on it.
 */
export function ladderMassesError(masses: number[]): string | null {
  if (masses.length < 2) return "List at least two marker masses, ordered top to bottom.";
  for (let index = 1; index < masses.length; index += 1) {
    if (masses[index] >= masses[index - 1]) {
      return `Masses must decrease from top to bottom: ${masses[index - 1]} kDa is followed by ${masses[index]} kDa.`;
    }
  }
  return null;
}

/** Why the displayed result no longer matches the controls, if it does not. */
export function reanalysisReasons(
  current: DetectionSettings,
  analyzed: DetectionSettings | null,
): string[] {
  if (!analyzed) return [];
  const reasons: string[] = [];
  if (current.sensitivity !== analyzed.sensitivity) {
    reasons.push(
      `Band sensitivity changed from ${analyzed.sensitivity.toFixed(2)} to ${current.sensitivity.toFixed(2)}.`,
    );
  }
  if (current.backgroundRadiusPx !== analyzed.backgroundRadiusPx) {
    reasons.push(
      `Rolling-ball radius changed from ${analyzed.backgroundRadiusPx} px to ${current.backgroundRadiusPx} px.`,
    );
  }
  if (!sameNumbers(current.ladderMassesKDa, analyzed.ladderMassesKDa)) {
    reasons.push("Ladder marker masses changed, so the molecular-weight calibration is out of date.");
  }
  if (current.ladderLaneId !== analyzed.ladderLaneId) {
    reasons.push("The ladder lane changed, so the molecular-weight calibration is out of date.");
  }
  return reasons;
}

/** True when the shown molecular weights were fitted from other inputs. */
export function calibrationStale(
  current: DetectionSettings,
  analyzed: DetectionSettings | null,
): boolean {
  if (!analyzed) return false;
  return (
    !sameNumbers(current.ladderMassesKDa, analyzed.ladderMassesKDa) ||
    current.ladderLaneId !== analyzed.ladderLaneId
  );
}

export type CalibrationSummary = { headline: string; detail: string; tone: "ok" | "warning" };

export function ladderCalibrationSummary(
  calibration: GelLadderCalibration | null,
): CalibrationSummary {
  if (!calibration) {
    return {
      headline: "No ladder calibration",
      detail: "Mark a ladder lane with at least two detected bands, then re-detect.",
      tone: "warning",
    };
  }
  if (calibration.status === "calibrated") {
    const range = calibration.mobilityRange;
    // `r2` is the unrounded fit; `fitR2` is the rounded legacy field.
    const r2 = calibration.r2 ?? calibration.fitR2;
    const fit = r2 === null ? "R² not reported" : `R² = ${r2.toFixed(4)}`;
    const markers =
      calibration.calibrationMarkerCount === null
        ? ""
        : ` · ${calibration.calibrationMarkerCount} of ${calibration.ladderBandCount ?? calibration.calibrationMarkerCount} markers used`;
    const span = range
      ? ` · valid for mobility ${range[0].toFixed(3)}–${range[1].toFixed(3)} from the top`
      : "";
    return {
      headline: `log₁₀(Da) vs mobility${markers}`,
      detail: `${fit}${span}. Bands outside that span are reported as outside the ladder range, not extrapolated.`,
      tone: "ok",
    };
  }
  if (calibration.status === "ladder_mass_count_mismatch") {
    return {
      headline: "Ladder masses do not match the detected markers",
      detail: `The engine detected ${calibration.detectedMarkerCount ?? "?"} ladder bands and received ${calibration.providedMarkerCount ?? "?"} masses. Edit the ladder masses to list every detected marker, top to bottom, then re-detect.`,
      tone: "warning",
    };
  }
  if (calibration.status === "ladder_masses_required") {
    return {
      headline: "Ladder masses required",
      detail: "Choose a ladder preset or enter marker masses, then re-detect.",
      tone: "warning",
    };
  }
  if (calibration.status === "ambiguous_ladder_mobility") {
    return {
      headline: "Ladder bands share a mobility",
      detail: "Two markers resolved to the same position, so no calibration was fitted.",
      tone: "warning",
    };
  }
  return {
    headline: "No molecular-weight calibration",
    detail: `The engine reported status "${calibration.status}".`,
    tone: "warning",
  };
}

export type GelCsvInput = {
  lanes: GelLane[];
  bands: GelBand[];
  quantification: GelQuantification | null;
  ladderCalibration: GelLadderCalibration | null;
  calibrationIsStale: boolean;
};

/**
 * The export carries the refusals with the numbers. A reader who only looks at
 * the density column still sees an empty cell and a stated reason, never a 0.
 */
export function gelCsvRows(input: GelCsvInput): string[][] {
  const rows: string[][] = [
    [
      "Lane",
      "Sample",
      "Stage ID",
      "Band",
      "Source",
      "Center (fraction from top)",
      "MW (kDa)",
      "MW status",
      "Integrated density",
      "Density uncertainty (±, noise only)",
      "Lane signal fraction (%)",
      "Fraction uncertainty (±%)",
      "Normalization basis",
      "Quantification refused",
      "Reason",
      "Flags",
    ],
  ];
  for (const lane of input.lanes) {
    for (const band of bandsInLane(input.bands, lane.id)) {
      rows.push([
        lane.label,
        lane.sampleLabel,
        lane.stageId ?? "",
        band.label,
        band.autoDetected ? "engine" : "manual",
        band.centerY.toFixed(4),
        band.molecularWeightStatus === "estimated" && band.molecularWeightDa !== null && !input.calibrationIsStale
          ? formatKDa(band.molecularWeightDa)
          : "",
        input.calibrationIsStale ? "stale_ladder_calibration" : (band.molecularWeightStatus ?? "not_reported"),
        band.density === null ? "" : band.density.toFixed(4),
        band.densityUncertainty === null ? "" : band.densityUncertainty.toFixed(4),
        band.laneFraction === null ? "" : (band.laneFraction * 100).toFixed(2),
        band.laneFractionUncertainty === null ? "" : (band.laneFractionUncertainty * 100).toFixed(2),
        band.normalizationBasis ?? "",
        band.quantificationRefused ? "yes" : "no",
        bandQuantificationNote(band) ?? band.laneFractionStaleReason ?? "",
        band.flags.map((flag) => `${flag.level}:${flag.code}`).join(" "),
      ]);
    }
  }
  rows.push([]);
  rows.push(["# Lane signal fractions are not a validated protein mass purity"]);
  for (const lane of input.lanes) {
    const verdict = laneQuantification(bandsInLane(input.bands, lane.id));
    rows.push([
      `# Lane: ${lane.label}`,
      verdict.kind === "available"
        ? `target signal fraction ${formatSignalFraction(verdict.fraction, verdict.uncertainty)}`
        : verdict.kind === "unavailable"
          ? `unavailable — ${verdict.headline}`
          : verdict.kind === "needs_target"
            ? "no target band selected"
            : "no bands detected",
    ]);
  }
  const quantification = input.quantification;
  if (quantification) {
    rows.push([]);
    rows.push(["# Quantification method"]);
    rows.push(["# Background", `${quantification.backgroundMethod} · ${quantification.backgroundKernel}`]);
    rows.push(["# Background radius (px)", String(quantification.backgroundRadiusPx ?? "")]);
    rows.push(["# Background boundary", quantification.backgroundBoundary]);
    rows.push(["# Lane geometry", quantification.laneGeometry]);
    rows.push(["# Uncertainty", quantification.uncertaintyMethod]);
    if (quantification.uncertaintyPropagation) {
      rows.push(["# Uncertainty propagation", quantification.uncertaintyPropagation]);
    }
    rows.push(["# Density uncertainty meaning", DENSITY_UNCERTAINTY_CAVEAT]);
    if (quantification.profileSmoothingRadiusPx !== null) {
      rows.push([
        "# Profile smoothing radius (px)",
        String(quantification.profileSmoothingRadiusPx),
      ]);
    }
    if (quantification.profileNoiseFloor !== null) {
      rows.push(["# Profile noise floor", String(quantification.profileNoiseFloor)]);
    }
    rows.push([
      "# Linear dynamic range",
      `${quantification.linearDynamicRange.minSignal ?? ""}–${quantification.linearDynamicRange.maxSignal ?? ""} ${quantification.linearDynamicRange.unit}`,
    ]);
    rows.push([
      "# Image processing",
      `${quantification.imageProcessing.originalWidth ?? "?"}×${quantification.imageProcessing.originalHeight ?? "?"} px · downscaled ${quantification.imageProcessing.downscaled ? "yes" : "no"} · scale ${quantification.imageProcessing.scaleFactor ?? 1}${quantification.imageProcessing.resampling ? ` · ${quantification.imageProcessing.resampling}` : ""}`,
    ]);
    for (const caveat of quantification.caveats) rows.push(["# Caveat", caveat]);
  }
  const calibration = input.ladderCalibration;
  if (calibration) {
    const summary = ladderCalibrationSummary(calibration);
    rows.push([]);
    rows.push(["# Ladder calibration"]);
    rows.push(["# Status", calibration.status]);
    rows.push(["# Summary", `${summary.headline}. ${summary.detail}`]);
    const r2 = calibration.r2 ?? calibration.fitR2;
    if (r2 !== null) rows.push(["# Fit R²", r2.toFixed(6)]);
    if (calibration.mobilityRange) {
      rows.push([
        "# Valid mobility range",
        `${calibration.mobilityRange[0].toFixed(4)}–${calibration.mobilityRange[1].toFixed(4)}`,
      ]);
    }
    if (calibration.markerAssignment) rows.push(["# Marker assignment", calibration.markerAssignment]);
    if (calibration.matchedBands.length) {
      rows.push([]);
      rows.push([
        `# Ladder markers used in the fit (residual convention: ${calibration.residualConvention || "observed_minus_fitted_kDa"})`,
      ]);
      rows.push(["# Band ID", "Mobility", "Marker (kDa)", "Fitted (kDa)", "Residual (kDa)"]);
      for (const matched of calibration.matchedBands) {
        rows.push([
          matched.bandId,
          matched.relativeMobility === null ? "" : matched.relativeMobility.toFixed(4),
          matched.massKDa === null ? "" : matched.massKDa.toFixed(2),
          matched.fittedKDa === null ? "" : matched.fittedKDa.toFixed(2),
          matched.residualKDa === null ? "" : matched.residualKDa.toFixed(2),
        ]);
      }
    }
    if (input.calibrationIsStale) {
      rows.push([
        "# Warning",
        "The ladder inputs changed after this analysis, so molecular weights were withheld from this export.",
      ]);
    }
  }
  return rows;
}

/**
 * The saved gel job. Version 3 stores the engine's own fields — including the
 * refusals, the uncertainties and the quantification metadata — so a reload or
 * a report never has to re-derive a measurement it cannot see.
 */
export type GelJobConfig = {
  schemaVersion: number;
  filename: string;
  previewBase64: string;
  gelType: string;
  origin: number;
  dyeFront: number;
  sensitivity: number;
  backgroundRadiusPx: number;
  ladderPreset: string;
  customWeights: string;
  ladderMassesKDa: number[];
  ladderLaneId: string;
  lanes: GelLane[];
  bands: GelBand[];
  quantification: GelQuantification | null;
  ladderCalibration: GelLadderCalibration | null;
  calibrationIsStale: boolean;
  source: string;
  polarity: string;
  savedAt: string;
};

export function readGelJobConfig(value: unknown): GelJobConfig {
  const raw = record(value);
  return {
    schemaVersion: finiteOrNull(raw.schemaVersion) ?? 1,
    filename: text(raw.filename, "gel-image"),
    previewBase64: text(raw.previewBase64),
    gelType: text(raw.gelType, "SDS-PAGE"),
    origin: clampedNumber(raw.origin, 0.08, 0, 0.5),
    dyeFront: clampedNumber(raw.dyeFront, 0.92, 0.5, 1),
    sensitivity: clampedNumber(raw.sensitivity, 0.52, 0, 1),
    backgroundRadiusPx: Math.round(
      clampedNumber(
        raw.backgroundRadiusPx,
        DEFAULT_BACKGROUND_RADIUS_PX,
        MIN_BACKGROUND_RADIUS_PX,
        MAX_BACKGROUND_RADIUS_PX,
      ),
    ),
    ladderPreset: text(raw.ladderPreset, "Bio-Rad Precision Plus"),
    customWeights: text(raw.customWeights),
    ladderMassesKDa: list(raw.ladderMassesKDa)
      .map(finiteOrNull)
      .filter((mass): mass is number => mass !== null && mass > 0),
    ladderLaneId: text(raw.ladderLaneId),
    lanes: list(raw.lanes).map(readGelLane),
    bands: list(raw.bands).map(readGelBand),
    quantification: readGelQuantification(raw.quantification),
    ladderCalibration: readLadderCalibration(raw.ladderCalibration),
    calibrationIsStale: raw.calibrationIsStale === true,
    source: text(raw.source),
    polarity: text(raw.polarity),
    savedAt: text(raw.savedAt),
  };
}

export type GelReportLane = {
  label: string;
  isLadder: boolean;
  targetLabel: string | null;
  verdict: LaneQuantification;
};

/** One verdict per annotated lane, for the purification report. */
export function gelReportLanes(config: GelJobConfig): GelReportLane[] {
  return config.lanes
    .map((lane) => {
      const laneBands = bandsInLane(config.bands, lane.id);
      const target = laneBands.find((band) => band.isTarget);
      // The report reader needs what was loaded, not only where it ran.
      const sample = lane.sampleLabel.trim();
      return {
        label: sample && sample !== lane.label ? `${lane.label} · ${sample}` : lane.label,
        isLadder: lane.isLadder,
        targetLabel: target ? target.label : null,
        verdict: laneQuantification(laneBands),
      };
    })
    .filter((lane) => lane.verdict.kind !== "no_bands");
}

/**
 * One sentence a figure caption can carry without overstating the gel: what
 * the engine reported for each annotated lane, or why it reported nothing.
 */
export function gelFigureNote(config: GelJobConfig): string | null {
  const lanes = gelReportLanes(config).filter((lane) => !lane.isLadder);
  if (!lanes.length) return null;
  const parts = lanes.map((lane) => {
    const verdict = lane.verdict;
    if (verdict.kind === "available") {
      return `${lane.label}: ${lane.targetLabel ?? "target"} is ${formatSignalFraction(verdict.fraction, verdict.uncertainty)} of the detected band signal`;
    }
    if (verdict.kind === "unavailable") {
      return `${lane.label}: quantification unavailable — ${verdict.headline.toLowerCase()}`;
    }
    return `${lane.label}: no target band selected`;
  });
  return `${parts.join(". ")}. ${SIGNAL_FRACTION_CAVEAT}`;
}

function unique(values: string[]): string[] {
  return values.filter((value, index) => values.indexOf(value) === index);
}

function sameNumbers(left: number[], right: number[]): boolean {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
