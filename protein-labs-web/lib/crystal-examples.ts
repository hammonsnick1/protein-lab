// One-click PDB examples for the lattice builder, so students can compare how
// proteins pack in common space groups. Every entry's space group, cell and
// paper were checked against the RCSB PDB entry and Crossref on 2026-11-01.
//
// Only erasable TypeScript syntax is used, so the unit tests run under Node
// without a bundler.
import type { CitationId } from "./citations.ts";

export type CrystalExample = {
  pdbId: string;
  /** Hermann–Mauguin symbol as the PDB writes it. */
  spaceGroup: string;
  protein: string;
  /** Molecules (asymmetric units) in one unit cell. */
  copiesPerCell: number;
  /** What to look for, in one or two plain sentences. */
  lesson: string;
  /** The paper that reported the structure. */
  citation: CitationId;
};

export const CRYSTAL_EXAMPLES: readonly CrystalExample[] = [
  {
    pdbId: "1UBQ", spaceGroup: "P 21 21 21", protein: "Ubiquitin", copiesPerCell: 4, citation: "vijaykumar1987",
    lesson: "Three 2₁ screw axes at right angles, none of them crossing each other. Every copy touches its neighbours through different patches of surface. This is the space group proteins choose most often.",
  },
  {
    pdbId: "1CRN", spaceGroup: "P 1 21 1", protein: "Crambin", copiesPerCell: 2, citation: "teeter1984",
    lesson: "One 2₁ screw axis along b: each copy is turned 180° and moved half a cell up. The second most common group for proteins.",
  },
  {
    pdbId: "2LZT", spaceGroup: "P 1", protein: "Hen lysozyme, triclinic form", copiesPerCell: 1, citation: "ramanadham1990",
    lesson: "No symmetry at all: one molecule per cell, and every neighbour is the same molecule moved by whole cells. Compare it with 193L: the same protein packs quite differently.",
  },
  {
    pdbId: "193L", spaceGroup: "P 43 21 2", protein: "Hen lysozyme, tetragonal form", copiesPerCell: 8, citation: "vaney1996",
    lesson: "Eight copies per cell, spiralling round 4₃ screw axes along c. The classic crystal grown in teaching labs.",
  },
  {
    pdbId: "1AMM", spaceGroup: "P 41 21 2", protein: "γB-crystallin", copiesPerCell: 8, citation: "kumaraswamy1996",
    lesson: "The mirror twin of P 43 21 2: the screw axes turn the other way. Proteins can crystallise in either one, but never in both at once.",
  },
  {
    pdbId: "1OUR", spaceGroup: "I 2 2 2", protein: "LecB lectin with mannose", copiesPerCell: 8, citation: "loris2003",
    lesson: "Body-centred: every copy has a twin moved half a cell along a, b and c at once, which doubles the four copies of 222 to eight.",
  },
  {
    pdbId: "4INS", spaceGroup: "H 3", protein: "Pig insulin, 2-zinc form", copiesPerCell: 9, citation: "baker1988",
    lesson: "Threefold axes along c gather three insulin dimers into the zinc hexamer, the form insulin is stored in. The rhombohedral lattice is drawn in hexagonal axes, so the cell holds three hexamers' worth of copies.",
  },
];

export function findExample(pdbId: string): CrystalExample | null {
  return CRYSTAL_EXAMPLES.find((example) => example.pdbId === pdbId.toUpperCase()) ?? null;
}
