// Report diagnostics carried from the chromatography engine onto the studio's
// peaks and back out of a saved job. The engine decides every flag, fit
// statistic and uncertainty; this module only copies them so that a value and
// the caveat that qualifies it are saved, and reopened, together.
import type {
  EngineFlag,
  EnginePeak,
  FitQuality,
  SecPrediction,
} from "./chromatography-api";

export type PeakDiagnostics = {
  flags: EngineFlag[];
  fitQuality: FitQuality | null;
  // Always present as a key so a fresh result overwrites a stored one; null
  // means the engine could not estimate it, undefined means no SEC mass at all.
  mwUncertaintyKDa: number | null | undefined;
};

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
