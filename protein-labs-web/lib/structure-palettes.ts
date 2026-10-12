/** Decorative protein colors only; these palettes do not encode confidence or chemistry. */
export const STRUCTURE_PALETTES = [
  { id: "coral", name: "Coral", colors: ["#e96f61", "#f5a183", "#bf4560", "#f7c392"], bond: "#ffd8ca" },
  { id: "lagoon", name: "Lagoon", colors: ["#169e9a", "#65d0b9", "#277b93", "#a4e1cb"], bond: "#c0ede1" },
  { id: "azure", name: "Azure", colors: ["#4389d1", "#85c1e9", "#5265b7", "#a8dcea"], bond: "#d2e5fa" },
  { id: "violet", name: "Violet", colors: ["#9870c6", "#c5a2df", "#bd6f9d", "#e6bdd6"], bond: "#e6d2f5" },
  { id: "amber", name: "Amber", colors: ["#d89b36", "#f0c86b", "#bc6d40", "#edb18a"], bond: "#f8e2af" },
  { id: "fern", name: "Fern", colors: ["#60a86e", "#aed07c", "#408777", "#d3df9d"], bond: "#deebc8" },
] as const;

/** The app icon's chain colours, used for the welcome protein. Kept out of
 *  STRUCTURE_PALETTES so projects' automatic palettes and the picker are unchanged. */
export const PROTEIN_LAB_PALETTE = { id: "protein-lab", name: "Protein Lab", colors: ["#d35532", "#ebb21e", "#189af7", "#1eb846"], bond: "#f7f2e8" } as const;

export type StructurePaletteId = typeof STRUCTURE_PALETTES[number]["id"] | typeof PROTEIN_LAB_PALETTE.id;

export function structurePaletteForKey(key: string) {
  let hash = 2166136261;
  for (const character of key) hash = Math.imul(hash ^ character.charCodeAt(0), 16777619);
  return STRUCTURE_PALETTES[(hash >>> 0) % STRUCTURE_PALETTES.length];
}

export function findStructurePalette(id: string | null | undefined) {
  if (id === PROTEIN_LAB_PALETTE.id) return PROTEIN_LAB_PALETTE;
  return STRUCTURE_PALETTES.find((palette) => palette.id === id);
}
