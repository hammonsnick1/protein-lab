// The panel slots of the Crystallize your protein job. The job owns the
// header, the engine assessment and the saved `crystallization` project job;
// each panel is one tab and receives the same props. To plug a panel in,
// export a component that takes `CrystallizePanelProps` and register it in
// `panelComponents` in `components/protein-labs/crystallize-job.tsx`.
// Unregistered slots are not shown.
//
// Saved state: each panel owns `config.panels[<its id>]` of the job and
// writes it only through `save`, so panels never overwrite one another. The
// space group a student picks is shared, because the lattice builder needs
// the one chosen in the space-group selector: it lives at
// `config.selectedSpaceGroup` and changes through `selectSpaceGroup`.
//
// Only erasable TypeScript syntax is used, so the unit tests run under Node
// without a bundler.
import type { JsonObject, ProteinBundle } from "./protein-labs-api.ts";
import type { ProteinFacts } from "./protein-facts.ts";
import type { Assessment, SpaceGroupSuggestion } from "./crystallization.ts";

export type CrystallizePanelId = "propensity" | "space-groups" | "lattice" | "guidance";

export type CrystallizePanelProps = {
  bundle: ProteinBundle;
  /** What earlier jobs found, from the shared protein-facts helper. Never ask for these again. */
  facts: ProteinFacts;
  /** The engine's assessment; null while it loads or when the engine could not answer. */
  assessment: Assessment | null;
  /** Space groups to highlight: MASCL's predictions first, then those PDB homologues crystallised in. */
  suggestedSpaceGroups: SpaceGroupSuggestion[];
  /** The space group the student chose, shared by all panels (Hermann–Mauguin, single-spaced). */
  selectedSpaceGroup: string | null;
  selectSpaceGroup: (symbol: string | null) => Promise<void>;
  /** This panel's own saved state, `config.panels[id]`; `{}` before the first save. */
  saved: JsonObject;
  /** Shallow-merge `patch` into this panel's saved state and save the job. */
  save: (patch: JsonObject) => Promise<void>;
  onOpenJob: (jobId: string) => void;
};

/** Tab order and labels. Owners: propensity HOM-309, space-groups HOM-310, lattice HOM-311, guidance HOM-312. */
export const CRYSTALLIZE_PANELS: { id: CrystallizePanelId; label: string; summary: string }[] = [
  { id: "propensity", label: "Propensity and advice", summary: "How likely crystals are, and why" },
  { id: "space-groups", label: "Space groups", summary: "Symmetry the crystal could have" },
  { id: "lattice", label: "Lattice and packing", summary: "How copies of the protein pack" },
  { id: "guidance", label: "Practical guidance", summary: "Screens, drops and buffers to start with" },
];

export function panelState(config: JsonObject | undefined, id: CrystallizePanelId): JsonObject {
  const panels = asObject(config?.panels);
  return asObject(panels[id]);
}

/** The job config with `patch` merged into one panel's state; everything else is kept. */
export function withPanelState(config: JsonObject | undefined, id: CrystallizePanelId, patch: JsonObject): JsonObject {
  const panels = asObject(config?.panels);
  return { ...(config ?? {}), panels: { ...panels, [id]: { ...asObject(panels[id]), ...patch } } };
}

export function selectedSpaceGroup(config: JsonObject | undefined): string | null {
  const value = config?.selectedSpaceGroup;
  return typeof value === "string" && value.trim() ? value.trim().replace(/\s+/g, " ") : null;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
