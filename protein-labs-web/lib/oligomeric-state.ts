// The oligomeric state the scientist records in the Protein properties job,
// and the assembly values derived from it.
//
// The state is saved inside the `protparam` job's config under
// `oligomericState`. The engine's ProtParam numbers always describe one
// polypeptide chain; a homo-oligomer's mass and ε₂₈₀ are that monomer value
// times the subunit count, and are always shown next to the monomer value,
// never instead of it. Hetero-complexes and an unknown state have no subunit
// count, so nothing is scaled for them.
//
// Only erasable TypeScript syntax and type-only imports are used, so the unit
// tests run under Node's built-in type stripping.
import type { JsonObject, ProjectJob } from "./protein-labs-api.ts";

export type OligomericKind = "monomer" | "homodimer" | "homotrimer" | "homotetramer" | "homo-oligomer" | "hetero-complex" | "unknown";

export type OligomericState = {
  kind: OligomericKind;
  /** Subunit count entered for a higher-order homo-oligomer; ignored otherwise. */
  subunits: number | null;
  /** Composition of a hetero-complex, e.g. "α2β2 with HBA". */
  complexNote: string;
  notes: string;
  evidence: string;
};

export const oligomericKinds: { id: OligomericKind; label: string; subunits: number | null }[] = [
  { id: "monomer", label: "Monomer", subunits: 1 },
  { id: "homodimer", label: "Homodimer", subunits: 2 },
  { id: "homotrimer", label: "Homotrimer", subunits: 3 },
  { id: "homotetramer", label: "Homotetramer", subunits: 4 },
  { id: "homo-oligomer", label: "Higher-order homo-oligomer", subunits: null },
  { id: "hetero-complex", label: "Hetero-complex", subunits: null },
  { id: "unknown", label: "Unknown", subunits: null },
];

/** Suggestions for the evidence field; any free text is accepted. */
export const oligomericEvidence = ["Literature", "SEC", "SEC-MALS", "Analytical ultracentrifugation", "Native mass spectrometry", "Crystal structure", "Cryo-EM structure", "Crosslinking", "Homology to a reference"];

/** The smallest higher-order homo-oligomer: anything smaller has its own option. */
export const minimumHigherOrder = 5;

export const unknownState: OligomericState = { kind: "unknown", subunits: null, complexNote: "", notes: "", evidence: "" };

function cleanText(value: unknown) {
  return typeof value === "string" ? value.trim() : "";
}

/** Read a saved state, tolerating a missing or hand-edited config. */
export function readOligomericState(config: JsonObject | null | undefined): OligomericState | null {
  const saved = config?.oligomericState;
  if (!saved || typeof saved !== "object" || Array.isArray(saved)) return null;
  const raw = saved as JsonObject;
  const kind = oligomericKinds.find((option) => option.id === raw.kind)?.id;
  if (!kind) return null;
  const count = Number(raw.subunits);
  return {
    kind,
    subunits: kind === "homo-oligomer" && Number.isInteger(count) && count >= minimumHigherOrder ? count : null,
    complexNote: kind === "hetero-complex" ? cleanText(raw.complexNote) : "",
    notes: cleanText(raw.notes),
    evidence: cleanText(raw.evidence),
  };
}

/** The config value to save; fields that do not apply to the kind are dropped. */
export function oligomericStateConfig(state: OligomericState): JsonObject {
  const value: JsonObject = { kind: state.kind };
  if (state.kind === "homo-oligomer" && state.subunits !== null) value.subunits = state.subunits;
  if (state.kind === "hetero-complex" && state.complexNote.trim()) value.complexNote = state.complexNote.trim();
  if (state.notes.trim()) value.notes = state.notes.trim();
  if (state.evidence.trim()) value.evidence = state.evidence.trim();
  return value;
}

/** Why a state cannot be saved yet, or null when it can. */
export function oligomericStateProblem(state: OligomericState): string | null {
  if (state.kind === "homo-oligomer" && state.subunits === null) return `Enter the number of identical subunits (${minimumHigherOrder} or more).`;
  if (state.kind === "hetero-complex" && !state.complexNote.trim()) return "Describe the hetero-complex, for example its partner chains and stoichiometry.";
  return null;
}

/** Identical chains in the assembly, or null when that cannot be known from this sequence alone. */
export function subunitCount(state: OligomericState | null): number | null {
  if (!state) return null;
  if (state.kind === "homo-oligomer") return state.subunits;
  return oligomericKinds.find((option) => option.id === state.kind)?.subunits ?? null;
}

/** "Homodimer", "Homo-12-mer", "Hetero-complex — α2β2 with HBA". */
export function oligomericLabel(state: OligomericState): string {
  if (state.kind === "homo-oligomer") return state.subunits === null ? "Higher-order homo-oligomer" : `Homo-${state.subunits}-mer`;
  const label = oligomericKinds.find((option) => option.id === state.kind)?.label ?? "Unknown";
  return state.kind === "hetero-complex" && state.complexNote ? `${label} — ${state.complexNote}` : label;
}

/** The one-line summary the report and journal quote. */
export function oligomericSummary(state: OligomericState): string {
  const count = subunitCount(state);
  const parts = [oligomericLabel(state)];
  if (count !== null && count > 1) parts.push(`${count} identical subunits`);
  if (state.evidence) parts.push(`evidence: ${state.evidence}`);
  return parts.join(" · ");
}

/** A monomer value scaled to the homo-oligomer, or null when it should not be shown. */
export function assemblyValue(monomer: unknown, state: OligomericState | null): number | null {
  const count = subunitCount(state);
  if (count === null || count < 2 || typeof monomer !== "number" || !Number.isFinite(monomer)) return null;
  return monomer * count;
}

/**
 * The protparam job config after "Recalculate and save": the new calculation
 * stamp merged over what the scientist recorded, so the oligomeric state survives.
 */
export function recalculatedProtparamConfig(saved: JsonObject | null | undefined, analyzedAt: string): JsonObject {
  return { ...(saved ?? {}), reviewStatus: "calculated", analyzedAt };
}

/**
 * The protparam job update that records a state. It keeps the rest of the
 * config and the job's status; recording a state before any calculation leaves
 * the job in progress rather than marking it complete.
 */
export function oligomericStateSave(existing: ProjectJob | null | undefined, state: OligomericState): { config: JsonObject; status: ProjectJob["status"] } {
  return { config: { ...(existing?.config ?? {}), oligomericState: oligomericStateConfig(state) }, status: existing?.status ?? "in_progress" };
}
