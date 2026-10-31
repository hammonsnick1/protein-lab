/** One residue's tally from the engine's amino-acid composition. */
export type ResidueCount = { aa: string; count: number };

/** The residue codes that share the highest count. Every residue tied for
 *  the top is returned; an empty composition, or one where nothing counted
 *  above zero, has no most abundant residue. */
export function mostAbundantResidues(rows: readonly ResidueCount[]): Set<string> {
  const counts = rows.filter((row) => Number.isFinite(row.count) && row.count > 0);
  if (!counts.length) return new Set();
  const top = Math.max(...counts.map((row) => row.count));
  return new Set(counts.filter((row) => row.count === top).map((row) => row.aa));
}
