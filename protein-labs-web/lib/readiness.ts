/**
 * Low-A₂₈₀ rule shared by the Protein readiness check and anything else that
 * flags a weak extinction coefficient. Pure module: no `@/` runtime imports,
 * so `node --test` can load it directly.
 */

/** Below this reduced-Cys ε₂₈₀, A₂₈₀ quantitation is unreliable at working concentrations. */
export const LOW_EXTINCTION_THRESHOLD_M1CM1 = 10_000;

/** The old default, saved by readiness checks before HOM-195. It was a unit slip, not a choice. */
const LEGACY_DEFAULT_THRESHOLD_M1CM1 = 10;

/**
 * The threshold a saved readiness job should use. Missing or invalid values and
 * the legacy default of 10 become 10,000 M⁻¹ cm⁻¹; any other value the
 * researcher set is kept.
 */
export function resolveExtinctionThreshold(saved: unknown): number {
  if (saved === null || saved === undefined || saved === "") return LOW_EXTINCTION_THRESHOLD_M1CM1;
  const value = Number(saved);
  if (!Number.isFinite(value) || value < 0 || value === LEGACY_DEFAULT_THRESHOLD_M1CM1) return LOW_EXTINCTION_THRESHOLD_M1CM1;
  return value;
}

/** True when the coefficient is known and strictly below the threshold. */
export function isLowExtinction(extinctionM1Cm1: number | null, threshold = LOW_EXTINCTION_THRESHOLD_M1CM1): boolean {
  return extinctionM1Cm1 !== null && Number.isFinite(extinctionM1Cm1) && extinctionM1Cm1 < threshold;
}

/** "15,470 M⁻¹ cm⁻¹"; "Not available" when the engine returned nothing. */
export function formatExtinction(value: number | null, unit = true): string {
  if (value === null || !Number.isFinite(value)) return "Not available";
  const number = Math.round(value).toLocaleString("en-US");
  return unit ? `${number} M⁻¹ cm⁻¹` : number;
}
