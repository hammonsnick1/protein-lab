/**
 * Identity and coverage of a saved sequence match, as fractions (0–1).
 *
 * A match saved without an alignment carries `null`. `Number(null)` is 0, so
 * a careless conversion shows an exact match as "0.0 % identity" (HOM-390).
 * Every display path goes through these helpers instead.
 */
export function matchMetric(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

/** "100.0% identity", or "identity not calculated" when there is no value. */
export function metricLabel(value: unknown, label: string): string {
  const number = matchMetric(value);
  return number === null ? `${label} not calculated` : `${(number * 100).toFixed(1)}% ${label}`;
}
