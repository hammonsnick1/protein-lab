// PDB hits saved by the Sequence research job (`bundle.pdbMatches`) turned
// into Structure Viewer choices. The saved record shape is changing under
// HOM-192, so this adapter reads both the original fields (`experimentalMethods`,
// `resolutionAngstrom` as a list, `comparison.queryCoverage`) and the stable
// ones (`method`, `resolution`, `coverage`, `chainIds`). It never computes a
// metric the engine did not report; a missing value stays null.
import type { StructureEntry } from "./structure-regions.ts";

export type ResearchHit = {
  pdbId: string;
  /** Polymer entities of this entry that matched; one entry can match on several. */
  entityIds: string[];
  /** Author chain IDs of the matching entities, when RCSB reported them. */
  chainIds: string[];
  title: string;
  /** The matching entity's name, e.g. "Hemoglobin subunit beta". */
  description: string;
  method: string | null;
  resolutionAngstrom: number | null;
  /** Fractions 0..1 over the aligned region; the best entity of the entry. */
  identity: number | null;
  coverage: number | null;
};

export type ChoiceOrigin = "alphafold" | "research" | "reference" | "manual";

export type StructureChoice = {
  key: string;
  origin: ChoiceOrigin;
  entry: StructureEntry;
  /** Sequence research metrics, when Sequence research found this entry. */
  hit: ResearchHit | null;
};

/** RCSB entry IDs: four characters, the first a digit (e.g. 1A3N, 4HHB). */
export function normalizePdbId(value: string): string | null {
  const id = value.trim().toUpperCase();
  return /^[0-9][A-Z0-9]{3}$/.test(id) ? id : null;
}

export const choiceKey = (entry: Pick<StructureEntry, "source" | "id">) => `${entry.source}:${entry.source === "pdb" ? entry.id.toUpperCase() : entry.id}`;

/** One row per PDB entry, in the order Sequence research ranked them. Malformed records are skipped. */
export function researchHits(records: readonly unknown[] | null | undefined): ResearchHit[] {
  const hits = new Map<string, ResearchHit>();
  for (const value of records ?? []) {
    const record = object(value);
    const pdbId = normalizePdbId(String(record.pdbId ?? ""));
    if (!pdbId) continue;
    const comparison = object(record.comparison);
    const entityId = text(record.entityId);
    const chains = Array.isArray(record.chainIds) ? record.chainIds.map(String) : text(record.chainId) ? [String(record.chainId)] : [];
    const methods = Array.isArray(record.experimentalMethods) ? record.experimentalMethods.map(String).filter(Boolean) : [];
    const identity = fraction(record.identity);
    const coverage = fraction(record.coverage) ?? fraction(comparison.queryCoverage);
    const existing = hits.get(pdbId);
    if (existing) {
      if (entityId && !existing.entityIds.includes(entityId)) existing.entityIds.push(entityId);
      for (const chain of chains) if (chain && !existing.chainIds.includes(chain)) existing.chainIds.push(chain);
      // Keep the best-matching entity's metrics for the entry.
      if (identity !== null && (existing.identity === null || identity > existing.identity)) { existing.identity = identity; existing.coverage = coverage; existing.description = text(record.entityDescription) || existing.description; }
      continue;
    }
    hits.set(pdbId, {
      pdbId,
      entityIds: entityId ? [entityId] : [],
      chainIds: chains.filter(Boolean),
      title: text(record.title),
      description: text(record.entityDescription),
      method: text(record.method) || methods.join("; ") || null,
      resolutionAngstrom: resolution(record.resolution) ?? resolution(record.resolutionAngstrom),
      identity,
      coverage,
    });
  }
  return [...hits.values()];
}

/** A minimal list entry for a hit the engine's list did not include; chains and ligands fill in once loaded. */
export function hitEntry(hit: ResearchHit): StructureEntry {
  return { id: hit.pdbId, source: "pdb", format: "cif", title: hit.title || hit.description || null, method: hit.method, resolutionAngstrom: hit.resolutionAngstrom, chains: [], ligands: [], sourceUrl: `https://www.rcsb.org/structure/${hit.pdbId}` };
}

export function manualEntry(pdbId: string): StructureEntry {
  return { id: pdbId, source: "pdb", format: "cif", title: null, method: null, resolutionAngstrom: null, chains: [], ligands: [], sourceUrl: `https://www.rcsb.org/structure/${pdbId}` };
}

/**
 * Every structure the user can load, grouped by where it came from: AlphaFold
 * models, then every Sequence research hit (ranked), then other PDB entries the
 * engine links to the UniProt reference, then IDs typed in by hand. Each entry
 * appears once; an engine entry that research also found keeps the engine's
 * chain and ligand details and gains the research metrics.
 */
export function structureChoices(structures: readonly StructureEntry[], hits: readonly ResearchHit[], manual: readonly string[] = []): StructureChoice[] {
  const listed = new Map(structures.map((entry) => [choiceKey(entry), entry]));
  const choices: StructureChoice[] = [];
  const seen = new Set<string>();
  const push = (origin: ChoiceOrigin, entry: StructureEntry, hit: ResearchHit | null) => {
    const key = choiceKey(entry);
    if (seen.has(key)) return;
    seen.add(key);
    choices.push({ key, origin, entry, hit });
  };
  for (const entry of structures) if (entry.source === "alphafold_db") push("alphafold", entry, null);
  for (const hit of hits) push("research", listed.get(`pdb:${hit.pdbId}`) ?? hitEntry(hit), hit);
  for (const entry of structures) if (entry.source === "pdb") push("reference", entry, null);
  for (const value of manual) { const id = normalizePdbId(value); if (id) push("manual", listed.get(`pdb:${id}`) ?? manualEntry(id), null); }
  return choices;
}

/**
 * The structure shown first: the AlphaFold model, else the engine's first
 * entry (as before HOM-194), else the best Sequence research hit.
 */
export function defaultChoiceKey(structures: readonly StructureEntry[], choices: readonly StructureChoice[]): string {
  const preferred = structures.find((entry) => entry.source === "alphafold_db") ?? structures[0];
  return preferred ? choiceKey(preferred) : choices[0]?.key ?? "";
}

/** Keeps the current choice while it still exists, otherwise falls back to the default. */
export function nextChoiceKey(current: string, structures: readonly StructureEntry[], choices: readonly StructureChoice[]): string {
  return choices.some((choice) => choice.key === current) ? current : defaultChoiceKey(structures, choices);
}

export const CHOICE_GROUPS: { origin: ChoiceOrigin; label: (count: number, accession: string | null) => string }[] = [
  { origin: "alphafold", label: () => "Predicted (AlphaFold)" },
  { origin: "research", label: (count) => `Found by Sequence research · ${count}` },
  { origin: "reference", label: (count, accession) => `${accession ? `Linked to UniProt ${accession}` : "Other PDB entries"} · ${count}` },
  { origin: "manual", label: () => "Added by PDB ID" },
];

function object(value: unknown): Record<string, unknown> { return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : {}; }
function text(value: unknown) { return value === null || value === undefined ? "" : String(value).trim(); }
function fraction(value: unknown) { if (value === null || value === undefined || value === "") return null; const number = Number(value); return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null; }
function resolution(value: unknown): number | null {
  const values = (Array.isArray(value) ? value : [value]).filter((item) => item !== null && item !== undefined && item !== "").map(Number).filter((item) => Number.isFinite(item) && item > 0);
  return values.length ? Math.min(...values) : null;
}

/** Author chains the engine numbered against UniProt in a loaded structure (rows with both a UniProt and a structure position). */
export function mappedChainIds(residues: readonly { chainId: string | null; labelSeqId: number | null; uniprotPosition: number | null }[] | null | undefined): string[] {
  return [...new Set((residues ?? []).filter((row) => row.chainId && row.uniprotPosition !== null && typeof row.labelSeqId === "number").map((row) => String(row.chainId)))];
}

/** "99.3%"; whole numbers lose the decimal. */
export function percentText(value: number | null) {
  if (value === null) return "—";
  const percent = value * 100;
  return `${Number.isInteger(Math.round(percent * 10) / 10) ? Math.round(percent) : percent.toFixed(1)}%`;
}
