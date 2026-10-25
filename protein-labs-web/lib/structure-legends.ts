// Legends for the Mol* colour themes the Structure Viewer offers. Each swatch
// is the colour Mol* actually draws: its secondary-structure theme desaturates
// the base map by one step (`saturation: -1`). structure-legends.test.ts checks
// this list against Mol*'s own colour map so a Mol* upgrade cannot silently
// add or recolour a category.

export type LegendEntry = { key: string; label: string; color: string };

/** Every category the secondary-structure theme can give the polymer component, in reading order. */
export const SECONDARY_STRUCTURE_LEGEND: readonly LegendEntry[] = [
  { key: "alphaHelix", label: "α-helix", color: "#e84481" },
  { key: "threeTenHelix", label: "3₁₀ helix", color: "#8e2e75" },
  { key: "piHelix", label: "π-helix", color: "#581d6e" },
  { key: "betaStrand", label: "β-strand", color: "#f9c94b" },
  { key: "betaTurn", label: "β-turn", color: "#7482e1" },
  { key: "turn", label: "Turn", color: "#51ad76" },
  { key: "bend", label: "Bend", color: "#9dcfc7" },
  { key: "coil", label: "Coil", color: "#ffffff" },
  { key: "dna", label: "DNA", color: "#a72fe8" },
  { key: "rna", label: "RNA", color: "#e64268" },
];

/**
 * Mol* categories deliberately left out: carbohydrates are branched entities,
 * which the viewer never draws with the polymer colouring.
 */
export const SECONDARY_STRUCTURE_NOT_SHOWN: readonly string[] = ["carbohydrate"];

/** Mol*'s red-yellow-green list over the Wimley–White scale: the most hydrophilic residue is red. */
export const HYDROPHOBICITY_SCALE = { from: "Hydrophilic", to: "Hydrophobic", colors: ["#d73027", "#ffffbf", "#1a9850"], source: "Wimley–White interface scale" } as const;
