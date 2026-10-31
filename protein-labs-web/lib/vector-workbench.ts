// Pure model for the Vector Workbench: the construct being edited, where it
// came from, feature edits, reverse complement, and the shapes sent to and
// read from the engine. Coordinates are zero-based and half-open; a feature
// whose end is before its start wraps through the origin of a circular vector.

import type { CutSite, MapFeature, SeqRange } from "./vector-geometry.ts";
import { reverseComplement } from "./vector-geometry.ts";

export type WorkbenchFeature = MapFeature & { notes: string; qualifiers: Record<string, string[]>; isInsert?: boolean };

/** Where the open construct came from, which decides how "Save to library" behaves. */
export type WorkbenchSource =
  | { kind: "new" }
  | { kind: "file"; filename: string; format: string }
  | { kind: "library"; libraryId: string; name: string; standard: boolean }
  | { kind: "project"; proteinId: string; proteinName: string; vectorId: string };

export type WorkbenchVector = { name: string; sequence: string; circular: boolean; features: WorkbenchFeature[]; source: WorkbenchSource };

export type Orf = { id: string; name: string; start: number; end: number; strand: number; frame: number; aminoAcids: number; translation: string };

export const FEATURE_TYPES = ["promoter", "CDS", "gene", "terminator", "rep_origin", "RBS", "protein_bind", "primer_bind", "polyA_signal", "mat_peptide", "regulatory", "misc_feature"] as const;

/** Friendly names for the feature types a scientist picks from. */
export const FEATURE_TYPE_LABELS: Record<string, string> = {
  promoter: "Promoter", CDS: "CDS / ORF", gene: "Gene", terminator: "Terminator", rep_origin: "Origin of replication",
  RBS: "RBS", protein_bind: "Binding site / operator", primer_bind: "Primer site", polyA_signal: "PolyA signal",
  mat_peptide: "Tag / peptide", regulatory: "Regulatory", misc_feature: "Other",
};

export function emptyVector(): WorkbenchVector {
  return { name: "Untitled vector", sequence: "", circular: true, features: [], source: { kind: "new" } };
}

const text = (value: unknown, fallback = "") => (typeof value === "string" ? value : value == null ? fallback : String(value));

/** Keep only A, C, G, T and N; RNA U becomes T. */
export function cleanDna(value: string): string {
  return value.toUpperCase().replace(/U/g, "T").replace(/[^ACGTN]/g, "");
}

function qualifiersOf(value: unknown): Record<string, string[]> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).map(([key, values]) => [key, (Array.isArray(values) ? values : [values]).map((item) => text(item))]));
}

/** A feature as the engine or a library record describes it. */
export function readFeature(raw: Record<string, unknown>, index = 0): WorkbenchFeature {
  const strand = Number(raw.strand ?? 1);
  return {
    id: text(raw.id) || `feature-${index + 1}`,
    name: text(raw.name) || text(raw.type, "feature"),
    type: text(raw.type) || "misc_feature",
    start: Math.trunc(Number(raw.start ?? 0)),
    end: Math.trunc(Number(raw.end ?? 0)),
    strand: strand < 0 ? -1 : strand === 0 ? 0 : 1,
    // The engine fills in a colour by type; only a colour the user chose is kept.
    color: raw.customColor ? text(raw.color) : "",
    customColor: Boolean(raw.customColor),
    automatic: Boolean(raw.automatic),
    notes: text(raw.notes),
    qualifiers: qualifiersOf(raw.qualifiers),
    ...(raw.isInsert ? { isInsert: true } : {}),
  };
}

/** A construct from an engine answer (a parsed file, a library record, a project vector). */
export function readVector(raw: Record<string, unknown>, source: WorkbenchSource): WorkbenchVector {
  const sequence = cleanDna(text(raw.sequence));
  const features = Array.isArray(raw.features) ? raw.features.filter((item): item is Record<string, unknown> => !!item && typeof item === "object") : [];
  return { name: text(raw.name).trim() || "Untitled vector", sequence, circular: raw.circular !== false, features: features.map(readFeature), source };
}

/** The body the engine's workbench, library and export endpoints accept. */
export function toEngine(vector: WorkbenchVector): { name: string; sequence: string; circular: boolean; features: Record<string, unknown>[] } {
  return {
    name: vector.name.trim() || "Untitled vector",
    sequence: vector.sequence,
    circular: vector.circular,
    features: vector.features.map(({ id, name, type, start, end, strand, color, customColor, notes, qualifiers, isInsert, automatic }) => ({
      id, name, type, start, end, strand, notes, qualifiers, automatic: Boolean(automatic),
      ...(customColor && color ? { color, customColor: true } : {}),
      ...(isInsert ? { isInsert: true } : {}),
    })),
  };
}

// ---------------------------------------------------------------------------
// Feature edits
// ---------------------------------------------------------------------------

/** Why a feature's coordinates cannot be kept, or "" when they are fine. */
export function featureProblem(feature: Pick<WorkbenchFeature, "start" | "end" | "name">, length: number, circular: boolean): string {
  if (!feature.name.trim()) return "Give the feature a name.";
  if (!Number.isInteger(feature.start) || !Number.isInteger(feature.end)) return "Coordinates must be whole bases.";
  if (feature.start < 0 || feature.end < 0 || feature.start > length || feature.end > length) return `Coordinates must lie within 1–${length.toLocaleString()}.`;
  if (feature.start === feature.end) return "A feature must cover at least one base.";
  if (feature.end < feature.start && !circular) return "Only a circular vector can have a feature across the origin.";
  return "";
}

let counter = 0;
function newId() {
  counter += 1;
  return typeof crypto !== "undefined" && "randomUUID" in crypto ? `feature-${crypto.randomUUID()}` : `feature-${Date.now()}-${counter}`;
}

export function addFeature(vector: WorkbenchVector, range: SeqRange, fields: { name: string; type: string; strand?: number; notes?: string }): { vector: WorkbenchVector; feature: WorkbenchFeature } {
  const feature: WorkbenchFeature = {
    id: newId(), name: fields.name.trim() || "New feature", type: fields.type || "misc_feature",
    start: range.start, end: range.end, strand: fields.strand ?? 1, color: "", customColor: false, automatic: false,
    notes: fields.notes ?? "", qualifiers: {},
  };
  const problem = featureProblem(feature, vector.sequence.length, vector.circular);
  if (problem) throw new Error(problem);
  return { vector: { ...vector, features: [...vector.features, feature] }, feature };
}

export type FeaturePatch = Partial<Pick<WorkbenchFeature, "name" | "type" | "start" | "end" | "strand" | "notes" | "color" | "customColor">>;

/** Apply an edit to one feature. Bad coordinates throw so the form can show why. */
export function updateFeature(vector: WorkbenchVector, id: string, patch: FeaturePatch): WorkbenchVector {
  const current = vector.features.find((feature) => feature.id === id);
  if (!current) throw new Error("That feature no longer exists.");
  const next = { ...current, ...patch };
  const problem = featureProblem(next, vector.sequence.length, vector.circular);
  if (problem) throw new Error(problem);
  // A renamed feature should not keep a stale label qualifier that export would prefer.
  if (patch.name !== undefined && next.qualifiers.label) next.qualifiers = { ...next.qualifiers, label: [next.name] };
  return { ...vector, features: vector.features.map((feature) => (feature.id === id ? next : feature)) };
}

export function deleteFeature(vector: WorkbenchVector, id: string): WorkbenchVector {
  return { ...vector, features: vector.features.filter((feature) => feature.id !== id) };
}

/** A detected ORF kept as a CDS annotation. */
export function orfAsFeature(vector: WorkbenchVector, orf: Orf, name = `ORF ${orf.aminoAcids} aa`): { vector: WorkbenchVector; feature: WorkbenchFeature } {
  return addFeature(vector, { start: orf.start, end: orf.end }, { name: name.replace(/^ORF\b/, "CDS"), type: "CDS", strand: orf.strand, notes: `Frame ${orf.frame}; ${orf.aminoAcids} aa` });
}

// ---------------------------------------------------------------------------
// Whole-construct edits
// ---------------------------------------------------------------------------

/**
 * Flip the construct onto its other strand: the sequence becomes its reverse
 * complement and every feature is mirrored with its strand reversed. Doing it
 * twice gives back the original.
 */
export function reverseComplementVector(vector: WorkbenchVector): WorkbenchVector {
  const length = vector.sequence.length;
  const mirror = (position: number) => (length - position) % (length || 1);
  return {
    ...vector,
    sequence: reverseComplement(vector.sequence),
    features: vector.features.map((feature) => {
      const start = mirror(feature.end);
      // A feature ending at the last base mirrors to start at 0; its end stays at the far side.
      const end = feature.start === 0 ? length : mirror(feature.start);
      return { ...feature, start, end, strand: -feature.strand || 0 };
    }),
  };
}

/** Mirror a selection the same way, so it still covers the same bases after a flip. */
export function mirrorRange(range: SeqRange, length: number): SeqRange {
  if (range.start === range.end) return { start: length - range.start, end: length - range.start };
  return { start: (length - range.end) % (length || 1), end: range.start === 0 ? length : length - range.start };
}

// ---------------------------------------------------------------------------
// Analysis read-outs
// ---------------------------------------------------------------------------

export type SiteFilter = "unique" | "two" | "all" | "none";
export const SITE_FILTERS: [SiteFilter, string][] = [["unique", "Unique"], ["two", "Two-cutters"], ["all", "All"], ["none", "None"]];

export function filterCuts(cuts: CutSite[], filter: SiteFilter): CutSite[] {
  if (filter === "none") return [];
  if (filter === "all") return cuts;
  return cuts.filter((site) => site.cutCount === (filter === "unique" ? 1 : 2));
}

/** One row per enzyme that cuts, for the enzyme list. */
export function enzymeSummary(cuts: CutSite[]): { enzyme: string; recognitionSite: string; cutCount: number; cuts: number[] }[] {
  const rows = new Map<string, { enzyme: string; recognitionSite: string; cutCount: number; cuts: number[] }>();
  for (const site of cuts) {
    const row = rows.get(site.enzyme) ?? { enzyme: site.enzyme, recognitionSite: site.recognitionSite, cutCount: site.cutCount, cuts: [] };
    row.cuts.push(site.cut);
    rows.set(site.enzyme, row);
  }
  return [...rows.values()].map((row) => ({ ...row, cuts: row.cuts.sort((a, b) => a - b) })).sort((a, b) => a.cutCount - b.cutCount || a.enzyme.localeCompare(b.enzyme));
}

export function readOrfs(value: unknown): Orf[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is Record<string, unknown> => !!item && typeof item === "object").map((item) => ({
    id: text(item.id), name: text(item.name), start: Number(item.start ?? 0), end: Number(item.end ?? 0), strand: Number(item.strand ?? 1) < 0 ? -1 : 1,
    frame: Number(item.frame ?? 1), aminoAcids: Number(item.aminoAcids ?? 0), translation: text(item.translation),
  }));
}

/** ORFs as map features, drawn in the pale ORF colour and kept apart from real annotations. */
export function orfMapFeatures(orfs: Orf[]): MapFeature[] {
  return orfs.map((orf) => ({ id: `orf:${orf.id}`, name: `ORF ${orf.aminoAcids} aa`, type: "ORF", start: orf.start, end: orf.end, strand: orf.strand, automatic: true }));
}

// ---------------------------------------------------------------------------
// Files
// ---------------------------------------------------------------------------

export type ExportFormat = "genbank" | "fasta" | "snapgene";
export const EXPORT_FORMATS: { id: ExportFormat; label: string; extension: string; hint: string }[] = [
  { id: "genbank", label: "GenBank (.gb)", extension: "gb", hint: "Sequence, topology and every feature. Opens in SnapGene, Benchling and ApE." },
  { id: "snapgene", label: "SnapGene (.dna)", extension: "dna", hint: "SnapGene's own format: sequence, topology and features (no SnapGene-only extras such as primers or history)." },
  { id: "fasta", label: "FASTA (.fasta)", extension: "fasta", hint: "Sequence only; features are not kept." },
];

/** The default answer to "Save to library": overwrite only a user's own library entry. */
export function saveChoice(source: WorkbenchSource): { canOverwrite: boolean; reason: string } {
  if (source.kind !== "library") return { canOverwrite: false, reason: "This vector is not in the library yet." };
  if (source.standard) return { canOverwrite: false, reason: `${source.name} is a bundled standard vector, so it stays read-only. Save your version as a new entry.` };
  return { canOverwrite: true, reason: "" };
}

export function sourceLabel(source: WorkbenchSource): string {
  switch (source.kind) {
    case "new": return "New construct";
    case "file": return `Imported from ${source.filename}`;
    case "library": return `${source.standard ? "Standard vector" : "Library vector"} · ${source.name}`;
    case "project": return `From project ${source.proteinName}`;
  }
}

/**
 * The next match of a DNA motif after `from`, on either strand, wrapping
 * through the origin of a circular vector. Returns null when there is none.
 */
export function findMotif(sequence: string, circular: boolean, motif: string, from = 0): { range: SeqRange; count: number; reverse: boolean } | null {
  const query = cleanDna(motif);
  const length = sequence.length;
  if (!query || !length || query.length > length) return null;
  const haystack = circular ? sequence + sequence.slice(0, query.length - 1) : sequence;
  const hits = (needle: string) => { const out: number[] = []; for (let at = haystack.indexOf(needle); at >= 0 && at < length; at = haystack.indexOf(needle, at + 1)) out.push(at); return out; };
  const forward = hits(query);
  const reverseQuery = reverseComplement(query);
  const backward = reverseQuery === query ? [] : hits(reverseQuery);
  const all = [...forward.map((at) => ({ at, reverse: false })), ...backward.map((at) => ({ at, reverse: true }))].sort((a, b) => a.at - b.at);
  if (!all.length) return null;
  const next = all.find((hit) => hit.at >= from) ?? all[0];
  return { range: { start: next.at, end: (next.at + query.length) % length || length }, count: all.length, reverse: next.reverse };
}
