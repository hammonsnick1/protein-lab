// Which space groups to flag in the selector, read from what earlier jobs
// already found out about the protein.
//
// Two sources, kept apart on purpose:
//  - `pdb`: a saved PDB homologue really crystallised in that group. Evidence.
//  - `predictor`: a tool such as MASCL suggests it. A suggestion, and only
//    present when a predictor actually ran; nothing here invents one.
//
// A PDB entry writes its symbol as `_symmetry.space_group_name_H-M`, e.g.
// "P 21 21 21" or "H 3" for R3, so every name goes through `findSpaceGroup`.
// Names that do not resolve are reported rather than dropped silently.
//
// Only erasable TypeScript syntax is used, so the unit tests run under Node
// without a bundler.
import { findSpaceGroup, type SpaceGroup, type UnitCell } from "./space-groups.ts";
import { formatProbability, type SpaceGroupSuggestion } from "./crystallization.ts";

/** The part of a saved PDB hit this module needs (see `lib/protein-facts.ts`). */
export type SpaceGroupHit = {
  pdbId: string;
  spaceGroup: string | null;
  unitCell: UnitCell | null;
};

export type SpaceGroupHighlight = {
  /** ITA number of the group this flags. */
  number: number;
  /** As written in the table, e.g. "P212121". */
  symbol: string;
  kind: "pdb" | "predictor";
  /** Who says so: "Saved PDB homologues", "MASCL", … */
  source: string;
  /** One line of detail for the tooltip. */
  detail: string;
  pdbIds: string[];
  /** A cell from the evidence, so distances can be shown in Ångström. */
  unitCell: UnitCell | null;
};

/** A predictor's suggestion, before it is matched to the table. */
export type PredictorSuggestion = { symbol: string; source: string; detail?: string };

/**
 * The predictor suggestions in the engine's assessment, for the selector.
 *
 * Only the `origin: "mascl"` entries: those are predictions. The engine's
 * `origin: "homologue"` entries read the same `bundle.pdbMatches[].spaceGroup`
 * the shared facts helper reads, and the facts version is the better source —
 * it groups by PDB id and carries the entry's unit cell, where the engine
 * counts one per matching entity record. So homologue groups arrive through
 * `spaceGroupHighlights`' `hits` argument instead, as evidence rather than a
 * suggestion. A group MASCL predicts that a homologue also used arrives here
 * with `homologueCount > 0` and keeps both flags.
 */
export function masclSuggestions(suggestions: readonly SpaceGroupSuggestion[] = []): PredictorSuggestion[] {
  return suggestions
    .filter((entry) => entry.origin === "mascl")
    .map((entry) => ({
      symbol: entry.spaceGroup,
      source: "MASCL",
      detail: entry.probability === null
        ? "Suggested by MASCL, which gave no probability."
        : `MASCL probability ${formatProbability(entry.probability)}.`,
    }));
}

/**
 * One highlight per group, keyed by ITA number. Real crystal forms win over
 * suggestions when both point at the same group, because they are evidence.
 */
export function spaceGroupHighlights(
  hits: readonly SpaceGroupHit[] = [],
  suggestions: readonly PredictorSuggestion[] = [],
): Map<number, SpaceGroupHighlight> {
  const highlights = new Map<number, SpaceGroupHighlight>();
  for (const suggestion of suggestions) {
    const group = findSpaceGroup(suggestion.symbol);
    if (!group) continue;
    highlights.set(group.n, {
      number: group.n, symbol: group.short, kind: "predictor", source: suggestion.source,
      detail: suggestion.detail ?? `${suggestion.source} suggests ${group.short}.`,
      pdbIds: [], unitCell: null,
    });
  }
  for (const hit of hits) {
    if (!hit.spaceGroup) continue;
    const group = findSpaceGroup(hit.spaceGroup);
    if (!group) continue;
    const existing = highlights.get(group.n);
    const pdbIds = [...(existing?.kind === "pdb" ? existing.pdbIds : []), hit.pdbId].filter(Boolean);
    highlights.set(group.n, {
      number: group.n, symbol: group.short, kind: "pdb", source: "Saved PDB homologues",
      detail: `${pdbIds.length} saved homologue${pdbIds.length === 1 ? "" : "s"} crystallised in ${group.short}: ${pdbIds.join(", ")}.`,
      pdbIds,
      unitCell: existing?.unitCell ?? hit.unitCell,
    });
  }
  return highlights;
}

/** Space-group names in the evidence that the table could not resolve. */
export function unresolvedSpaceGroups(hits: readonly SpaceGroupHit[] = []): string[] {
  return [...new Set(hits
    .map((hit) => hit.spaceGroup)
    .filter((symbol): symbol is string => Boolean(symbol) && !findSpaceGroup(symbol!)))];
}

/**
 * The group to open with: the caller's choice if it resolves, else the one the
 * most homologues used, else P2₁2₁2₁ — the group protein crystals adopt most
 * often (Wukovitz & Yeates 1995), so the first thing a student sees is the one
 * they are most likely to meet.
 */
export function startingGroup(highlights: Map<number, SpaceGroupHighlight>, preferred?: string): string {
  const chosen = preferred ? findSpaceGroup(preferred) : null;
  if (chosen) return chosen.short;
  const evidence = [...highlights.values()]
    .filter((highlight) => highlight.kind === "pdb")
    .sort((left, right) => right.pdbIds.length - left.pdbIds.length || left.number - right.number)[0];
  if (evidence) return evidence.symbol;
  return (findSpaceGroup("P 21 21 21") as SpaceGroup).short;
}
