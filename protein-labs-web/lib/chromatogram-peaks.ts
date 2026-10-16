// Chromatogram Studio peaks: how a peak is joined to the engine result that
// measured it, and how a saved peak is read back when a job reopens. This is
// the path every saved `chromatogram-studio` job goes through, so the report
// diagnostics (flags, fit quality, mass uncertainty) travel with the numbers
// they qualify. The engine decides every value; nothing here recalculates one.
import type {
  EngineFlag,
  EnginePeak,
  FitQuality,
  SecCalibration,
  SecPrediction,
} from "./chromatography-api";

export type Peak = {
  id: string;
  traceId: string;
  name: string;
  start: number;
  end: number;
  apexX: number;
  response: number;
  height: number;
  area: number;
  color: string;
  fillColor: string;
  fillVisible: boolean;
  fillOpacity: number;
  outlineWidth: number;
  calloutVisible: boolean;
  calloutBorder: boolean;
  calloutX: number;
  calloutY: number;
  showVe: boolean;
  showResponse: boolean;
  showArea: boolean;
  showMw: boolean;
  customText: string;
  mwKDa?: number;
  kav?: number;
  fraction?: string;
  // Engine measurements. `start`/`end` stay the integration range the
  // researcher asked for; the engine reports the samples it actually used as
  // `measuredStart`/`measuredEnd`, so re-measuring never drifts the request.
  measuredStart?: number;
  measuredEnd?: number;
  fwhm?: number | null;
  asymmetry10?: number | null;
  outOfRange?: boolean;
  // Engine report diagnostics, saved beside the numbers they qualify.
  flags?: EngineFlag[];
  fitQuality?: FitQuality | null;
  mwUncertaintyKDa?: number | null;
};
// A peak joined to the current engine result. `measured` is false whenever the
// numbers on screen did not come from this engine run, so the studio can say so
// instead of presenting a stored or stale value as a fresh measurement.
export type MeasuredPeak = Peak & { measured: boolean; rs: number | null };

export type PeakDiagnostics = {
  flags: EngineFlag[];
  fitQuality: FitQuality | null;
  // Always present as a key so a fresh result overwrites a stored one; null
  // means the engine could not estimate it, undefined means no SEC mass at all.
  mwUncertaintyKDa: number | null | undefined;
};

/**
 * Join a peak to the engine result that measured it. Identity, label, style
 * and requested range stay local; every quantity comes from the engine. On an
 * mL axis the separate SEC calibration supplies Kav, mass and its uncertainty.
 */
export function measurePeak(
  peak: Peak,
  measured: EnginePeak | undefined,
  prediction: SecPrediction | undefined,
  rs: number | null,
): MeasuredPeak {
  if (!measured) return { ...peak, measured: false, rs: null };
  return {
    ...peak,
    measured: true,
    rs,
    measuredStart: measured.start,
    measuredEnd: measured.end,
    apexX: measured.apexX,
    response: measured.response,
    height: measured.height,
    area: measured.area,
    fwhm: measured.fwhm,
    asymmetry10: measured.asymmetry10,
    kav: prediction?.kav,
    mwKDa: prediction?.mwKDa ?? undefined,
    outOfRange: prediction?.outOfRange,
    ...peakDiagnostics(measured, prediction),
  };
}

/**
 * Diagnostics for one measured peak. When SEC is calibrated by the separate
 * endpoint, its prediction owns the mass uncertainty and adds its own flags.
 * The list is rebuilt from the current results every time, so recalibrating
 * replaces the previous prediction's flags instead of piling them up.
 */
export function peakDiagnostics(
  measured: EnginePeak,
  prediction?: SecPrediction,
): PeakDiagnostics {
  return {
    flags: [...(measured.flags ?? []), ...(prediction?.flags ?? [])],
    fitQuality: measured.fitQuality ?? null,
    mwUncertaintyKDa: prediction ? prediction.mwUncertaintyKDa : measured.mwUncertaintyKDa,
  };
}

/**
 * The config saved on the `chromatogram-studio` project job. Peaks are saved
 * as joined, diagnostics included, and the calibration is the engine's object
 * unchanged, so `standardMassRangeKDa` reaches the report reader as sent.
 */
export function studioJobConfig<Workspace extends Record<string, unknown>>(
  workspace: Workspace,
  peaks: MeasuredPeak[],
  calibration: SecCalibration | null,
) {
  return {
    schemaVersion: 12,
    ...workspace,
    peaks,
    calibration,
    savedAt: new Date().toISOString(),
    savedByUser: true,
  };
}

/** Read peaks back from a saved job or a `.chromproj`, old formats included. */
export function loadPeaks(value: unknown): Peak[] {
  return records(value).map((raw, index) => ({
    id: String(raw.id ?? crypto.randomUUID()),
    traceId: String(raw.traceId ?? ""),
    name: String(raw.name ?? `Peak ${index + 1}`),
    start: Number(raw.start ?? 0),
    end: Number(raw.end ?? 0),
    apexX: Number(raw.apexX ?? raw.retentionVolume ?? 0),
    response: Number(raw.response ?? 0),
    height: Number(raw.height ?? 0),
    area: Number(raw.area ?? 0),
    color: String(raw.color ?? raw.outlineColor ?? "#25bba7"),
    fillColor: String(raw.fillColor ?? "#25bba7"),
    fillVisible: raw.fillVisible !== false,
    fillOpacity: Number(raw.fillOpacity ?? 0.25),
    outlineWidth: Number(raw.outlineWidth ?? 2),
    calloutVisible: raw.calloutVisible !== false,
    calloutBorder: raw.calloutBorder !== false,
    calloutX: Number(raw.calloutX ?? raw.apexX ?? 0),
    calloutY: Number(raw.calloutY ?? 12),
    showVe: raw.showVe !== false,
    showResponse: raw.showResponse !== false,
    showArea: raw.showArea !== false,
    showMw: raw.showMw !== false,
    customText: String(raw.customText ?? ""),
    // A stored null is an absent value, not zero.
    mwKDa: raw.mwKDa == null ? undefined : Number(raw.mwKDa),
    kav: raw.kav == null ? undefined : Number(raw.kav),
    fraction: raw.fraction ? String(raw.fraction) : undefined,
    ...loadPeakDiagnostics(raw),
  }));
}

/** Read diagnostics back from a saved peak, keeping nulls as nulls. */
export function loadPeakDiagnostics(raw: Record<string, unknown>): Partial<PeakDiagnostics> {
  const loaded: Partial<PeakDiagnostics> = {};
  if (Array.isArray(raw.flags)) loaded.flags = raw.flags.filter(isFlag);
  if (raw.fitQuality === null) loaded.fitQuality = null;
  else if (isFitQuality(raw.fitQuality)) loaded.fitQuality = raw.fitQuality;
  if (raw.mwUncertaintyKDa === null || isFiniteNumber(raw.mwUncertaintyKDa))
    loaded.mwUncertaintyKDa = raw.mwUncertaintyKDa;
  return loaded;
}

function records(value: unknown): Record<string, unknown>[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is Record<string, unknown> =>
          Boolean(item) && typeof item === "object" && !Array.isArray(item),
      )
    : [];
}

function isFlag(value: unknown): value is EngineFlag {
  if (!value || typeof value !== "object") return false;
  const flag = value as Record<string, unknown>;
  return typeof flag.code === "string" && typeof flag.message === "string";
}

function isFitQuality(value: unknown): value is FitQuality {
  if (!value || typeof value !== "object") return false;
  const fit = value as Record<string, unknown>;
  return (
    typeof fit.model === "string" &&
    (fit.rSquared === null || isFiniteNumber(fit.rSquared)) &&
    (fit.residual === null || isFiniteNumber(fit.residual))
  );
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}
