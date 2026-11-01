// Sample-preparation advice for the HSQC job (HOM-374): which tube holds how
// much, how much protein that takes, and whether the construct is big enough
// to need TROSY or deuteration.

/** Working volumes, in µL, from facility sample requirements (NCBS, UMD, NESG). */
export const NMR_TUBES = [
  { id: "5mm", label: "Standard 5 mm tube", minUl: 500, maxUl: 600 },
  { id: "shigemi", label: "Shigemi 5 mm tube", minUl: 250, maxUl: 300 },
  { id: "3mm", label: "3 mm tube", minUl: 160, maxUl: 200 },
] as const;

export type NmrTube = (typeof NMR_TUBES)[number];

/** Typical protein concentration range for a ¹H–¹⁵N HSQC, in mM. */
export const HSQC_CONCENTRATION_MM = { low: 0.1, high: 1 } as const;

/**
 * Mass boundaries, in kDa, where the advice changes. Below the first an
 * ordinary HSQC works; between them TROSY is recommended; above the second
 * deuteration and TROSY are both needed. The bounds bracket the ~25–30 kDa
 * point at which slow tumbling starts to broaden amide peaks.
 */
export const SIZE_LIMITS_KDA = { trosy: 25, deuterate: 40 } as const;

export type SizeTier = "standard" | "trosy" | "deuterate";

export function sizeTier(massKDa: number): SizeTier {
  if (massKDa >= SIZE_LIMITS_KDA.deuterate) return "deuterate";
  if (massKDa >= SIZE_LIMITS_KDA.trosy) return "trosy";
  return "standard";
}

/** Milligrams of protein for `volumeUl` at `concentrationMm`: mM × µL is nmol, and nmol × kDa is µg. */
export function proteinMassMg(massKDa: number, concentrationMm: number, volumeUl: number): number {
  return concentrationMm * volumeUl * massKDa / 1000;
}

/** One row per tube: the protein needed at the low and high end of the HSQC range, using the tube's larger working volume. */
export function tubeRequirements(massKDa: number): { tube: NmrTube; lowMg: number; highMg: number }[] {
  return NMR_TUBES.map((tube) => ({
    tube,
    lowMg: proteinMassMg(massKDa, HSQC_CONCENTRATION_MM.low, tube.maxUl),
    highMg: proteinMassMg(massKDa, HSQC_CONCENTRATION_MM.high, tube.maxUl),
  }));
}

/** "0.32 mg", "4.1 mg", "17 mg": two significant figures, never below 0.01. */
export function formatMg(value: number): string {
  if (value < 0.01) return "< 0.01 mg";
  const digits = value < 1 ? 2 : value < 10 ? 1 : 0;
  return `${value.toFixed(digits)} mg`;
}
