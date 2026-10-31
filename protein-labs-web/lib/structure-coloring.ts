// Per-residue colour layers for the Structure Viewer. A colour source (chain
// interfaces now, conservation later) turns its result into a ResidueColoring;
// the Mol* stage paints the layers over the current colour theme and the
// viewer draws the legend from the same object, so a new source only needs a
// function that returns one of these.

export type ColoredResidue = { labelAsymId: string; labelSeqId: number };

export type ColoringGroup = { key: string; label: string; color: string; residues: ColoredResidue[] };

export type ResidueColoring = {
  id: string;
  /** Names the colouring in the legend, e.g. "Chain interface (4.5 Å)". */
  title: string;
  /** Colour for every polymer residue no group claims; null keeps the current theme underneath. */
  base: { label: string; color: string } | null;
  /** Painted in order, so a later group wins where two overlap. */
  groups: ColoringGroup[];
};

export type ColoringLegendEntry = { key: string; label: string; color: string };

/** Legend rows in drawing order, then the base colour; groups with no residues are left out. */
export function coloringLegend(coloring: ResidueColoring): ColoringLegendEntry[] {
  const entries = coloring.groups.filter((group) => group.residues.length).map(({ key, label, color }) => ({ key, label, color }));
  return coloring.base ? [...entries, { key: "base", label: coloring.base.label, color: coloring.base.color }] : entries;
}

/** Distinct, colour-blind-aware hues (Okabe–Ito order) for per-chain highlights; repeats after eight chains. */
export const HIGHLIGHT_COLORS = ["#e69f00", "#0072b2", "#009e73", "#cc79a7", "#d55e00", "#56b4e9", "#b8a200", "#7a5195"] as const;

/** Neutral grey for residues outside every highlighted group. */
export const MUTED_RESIDUE_COLOR = "#c3c7cc";
