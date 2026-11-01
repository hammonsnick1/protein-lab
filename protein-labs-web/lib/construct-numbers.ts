// One place for the protein's numbers: the native chain, the expressed fusion,
// the cleaved product, and the assembly that runs on SEC.
//
// The roadmap's cleavage panel, the SEC polishing default and the report all
// read this selector, so one project can never quote two masses for the same
// species. The values are never approximated in the browser:
//
//   native    the engine's ProtParam result for the saved sequence
//   fusion    what the cell expresses: tag, linker, cleavage site, junction
//   cleaved   what survives tag removal, scar residues included
//   purified  what leaves the last column: cleaved when a protease cuts,
//             otherwise the fusion, otherwise the native chain
//   assembly  the purified chain times the recorded homo-oligomer count
//
// Fusion and cleaved come from the construct saved by Affinity capture or
// Subtractive cleanup. A project that has not saved one yet gets the construct
// those pages would show (the saved plan, or the house layout), and the caller
// supplies its ProtParam values through `analysed`; see `sequencesToAnalyse`.
import type { JsonObject, ProteinBundle } from "./protein-labs-api.ts";
import { assembleConstruct, type AssembledConstruct } from "./construct-catalog.ts";
import { initialPlan } from "./construct-records.ts";
import { affinityColumns } from "./purification-catalog.ts";
import { oligomericLabel, readOligomericState, subunitCount, type OligomericState } from "./oligomeric-state.ts";

export type SpeciesNumbers = {
  residues: number;
  massDa: number;
  pI: number | null;
  extinctionReduced: number | null;
  extinctionOxidized: number | null;
};

export type ConstructNumbers = {
  native: SpeciesNumbers | null;
  fusion: SpeciesNumbers | null;
  cleaved: SpeciesNumbers | null;
  purified: SpeciesNumbers | null;
  purifiedSpecies: "cleaved product" | "tagged fusion" | "native chain";
  assembly: SpeciesNumbers | null;
  oligomer: OligomericState | null;
  /** Identical chains in the assembly; null when the state is unknown or a hetero-complex. */
  subunits: number | null;
  /** "Homotetramer"; null when nothing is scaled. */
  assemblyLabel: string | null;
  /** Whether a protease removes the tag in this plan. */
  cleaves: boolean;
  scar: string;
  tagName: string | null;
  /** A large fusion partner chosen without its sequence: nothing tagged can be calculated. */
  unresolvedTag: string | null;
  /** "saved": the construct a job saved; "planned": assembled from the plan; "none": no tag chosen. */
  constructSource: "saved" | "planned" | "none";
  /** Construct sequences, so a caller can analyse a planned construct. */
  sequences: { fusion: string; cleaved: string };
};

function object(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function config(bundle: ProteinBundle, appType: string): JsonObject {
  return object(bundle.projectJobs.find((job) => job.appType === appType)?.config);
}
function positive(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() === "" ? NaN : Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}
function nonNegative(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 ? number : null;
}

/** ConstructMetrics as the designer saves them, or the engine's ProtParam result. */
export function speciesFromMetrics(value: unknown, fallbackResidues = 0): SpeciesNumbers | null {
  const raw = object(value);
  const extinction = object(raw.extinctionCoefficient280);
  const massDa = positive(raw.massDa ?? raw.molecularWeightDa);
  if (massDa === null) return null;
  return {
    residues: positive(raw.lengthAa ?? object(raw.sequence).length) ?? fallbackResidues,
    massDa,
    pI: positive(raw.pI ?? raw.theoreticalPI),
    extinctionReduced: nonNegative(raw.extinctionReduced ?? extinction.reducedMolarM1Cm1),
    extinctionOxidized: nonNegative(raw.extinctionOxidized ?? extinction.oxidizedMolarM1Cm1),
  };
}

/** Older saves wrote flat `fusionMassDa`-style fields instead of the metrics objects. */
function legacySpecies(construct: JsonObject, prefix: "fusion" | "cleaved"): SpeciesNumbers | null {
  const massDa = positive(construct[`${prefix}MassDa`]);
  if (massDa === null) return null;
  return { residues: positive(construct[`${prefix}Length`]) ?? String(construct[`${prefix}Sequence`] ?? "").length, massDa, pI: positive(construct[`${prefix}PI`]), extinctionReduced: nonNegative(construct[`${prefix}Extinction`]), extinctionOxidized: null };
}

function savedConstruct(bundle: ProteinBundle): JsonObject | null {
  const saved = config(bundle, "purification-cleavage").construct ?? config(bundle, "purification-affinity").construct;
  const construct = object(saved);
  return Object.keys(construct).length ? construct : null;
}

/** The construct Affinity capture would show for this project, or null with no tag chosen. */
export function plannedConstruct(bundle: ProteinBundle): AssembledConstruct | null {
  const affinity = config(bundle, "purification-affinity");
  const affinityTag = String(affinity.tag ?? affinityColumns.find((column) => column.id === String(affinity.columnId ?? ""))?.tag ?? "");
  const plan = initialPlan(affinity, affinityTag);
  if (!plan.tagId || !bundle.protein.sequence) return null;
  const proteaseId = String(config(bundle, "purification-cleavage").proteaseId ?? config(bundle, "purification-subtractive").proteaseId ?? "");
  const construct = assembleConstruct(bundle.protein.sequence, { ...plan, cleavageId: proteaseId });
  return construct.fusion ? construct : null;
}

/** Planned construct sequences that still need ProtParam values from the engine. */
export function sequencesToAnalyse(bundle: ProteinBundle): string[] {
  if (savedConstruct(bundle)) return [];
  const construct = plannedConstruct(bundle);
  if (!construct || construct.unresolvedTag) return [];
  return [...new Set([construct.fusion, construct.cleaves ? construct.cleaved : ""].filter(Boolean))];
}

export function constructNumbers(bundle: ProteinBundle, analysed: ReadonlyMap<string, SpeciesNumbers> = new Map()): ConstructNumbers {
  const native = speciesFromMetrics(bundle.protparam?.result, bundle.protein.sequence.length);
  const saved = savedConstruct(bundle);
  let fusion: SpeciesNumbers | null = null, cleaved: SpeciesNumbers | null = null;
  let cleaves = false, scar = "", tagName: string | null = null, unresolvedTag: string | null = null, sequences = { fusion: "", cleaved: "" };
  let constructSource: ConstructNumbers["constructSource"] = "none";
  if (saved) {
    constructSource = "saved";
    cleaves = saved.cleaves === true;
    scar = String(saved.scar ?? "");
    tagName = saved.tagName ? String(saved.tagName) : null;
    sequences = { fusion: String(saved.fusionSequence ?? ""), cleaved: String(saved.cleavedSequence ?? "") };
    fusion = speciesFromMetrics(saved.fusionProperties, sequences.fusion.length) ?? legacySpecies(saved, "fusion");
    cleaved = speciesFromMetrics(saved.cleavedProperties, sequences.cleaved.length) ?? legacySpecies(saved, "cleaved");
    // Legacy saves carry no `cleaves` flag; a cleaved mass different from the fusion means one.
    if (saved.cleaves === undefined) cleaves = Boolean(fusion && cleaved && cleaved.massDa !== fusion.massDa);
  } else {
    const construct = plannedConstruct(bundle);
    if (construct?.unresolvedTag) unresolvedTag = construct.unresolvedTag.name;
    else if (construct) {
      constructSource = "planned";
      cleaves = construct.cleaves;
      scar = construct.scar;
      tagName = construct.segments.find((segment) => segment.kind === "tag")?.label ?? null;
      sequences = { fusion: construct.fusion, cleaved: construct.cleaved };
      fusion = analysed.get(construct.fusion) ?? null;
      cleaved = cleaves ? analysed.get(construct.cleaved) ?? null : null;
    }
  }
  if (!cleaves) cleaved = null;
  const purified = cleaves ? cleaved : fusion ?? native;
  const purifiedSpecies: ConstructNumbers["purifiedSpecies"] = cleaves ? "cleaved product" : fusion ? "tagged fusion" : "native chain";
  const oligomer = readOligomericState(config(bundle, "protparam"));
  const count = subunitCount(oligomer);
  const scaled = count !== null && count > 1 && purified;
  const scale = (value: number | null) => value === null || !scaled ? null : value * count;
  const assembly = scaled ? { residues: purified.residues * count, massDa: purified.massDa * count, pI: purified.pI, extinctionReduced: scale(purified.extinctionReduced), extinctionOxidized: scale(purified.extinctionOxidized) } : null;
  return {
    native, fusion, cleaved, purified, purifiedSpecies, assembly, oligomer,
    subunits: scaled ? count : null,
    assemblyLabel: scaled && oligomer ? oligomericLabel(oligomer) : null,
    cleaves, scar, tagName, unresolvedTag, constructSource, sequences,
  };
}

/** The mass SEC sizes for, in kDa: the assembly when one is recorded, otherwise the purified chain. */
export function secMassKDa(numbers: ConstructNumbers): number | null {
  const species = numbers.assembly ?? numbers.purified;
  return species ? Math.max(.1, Math.round(species.massDa / 10) / 100) : null;
}
