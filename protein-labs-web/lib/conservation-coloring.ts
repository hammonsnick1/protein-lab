// Colour a structure by sequence conservation. Two sources give one grade per
// query position: a ConSurf run, or a conservation score computed from the
// saved BLAST alignment. Each structure chain is then aligned to that query so
// a grade lands on the residue it belongs to, never on a residue at the same
// index. Pure module: no `@/` imports, so the tests run it directly.

import { buildMsa, type BlastHit } from "./blast-alignment.ts";
import { CONSERVATION_COLORS, MAX_GRADE, MIN_GRADE, type ConservationResidue } from "./conservation.ts";
import type { ResidueColoring } from "./structure-coloring.ts";

export type ConservationSourceId = "consurf" | "alignment";

/** One grade per query position (index = position − 1); null where the source has no row. */
export type ConservationProfile = {
  source: ConservationSourceId;
  /** The sequence the grades are numbered against. */
  query: string;
  grades: ({ grade: number; insufficientData: boolean } | null)[];
  /** Provenance for the panel, e.g. "ConSurf-DB · 1CA2 chain A". */
  detail: string;
};

/** What the viewer is told about one source: a profile to paint, or why it cannot be chosen. */
export type ConservationSourceState =
  | { state: "ready"; profile: ConservationProfile }
  | { state: "loading" | "unavailable" | "error"; hint: string };
export type ConservationSources = Record<ConservationSourceId, ConservationSourceState>;

export const CONSERVATION_SOURCES: { id: ConservationSourceId; label: string; short: string }[] = [
  { id: "consurf", label: "ConSurf grades", short: "ConSurf" },
  { id: "alignment", label: "Alignment conservation", short: "Alignment" },
];

/** A polymer chain as the structure defines it: the full SEQRES and the label_seq_id of each letter. */
export type ChainSequence = { labelAsymId: string; authAsymId: string; sequence: string; seqIds: number[] };

/** Grey for residues with too little data behind their grade. */
export const INSUFFICIENT_COLOR = "#b9bdc3";
/** Darker grey for residues no grade reaches: outside the query, in an alignment gap, or on another protein. */
export const UNMAPPED_COLOR = "#7c828a";

// ConSurf's own threshold: fewer than six non-gapped sequences in a column is too few to grade.
export const MIN_COLUMN_SEQUENCES = 6;

// ---------------------------------------------------------------------------
// Sequence alignment (Smith–Waterman with affine gaps).

const GAP_OPEN = -10, GAP_EXTEND = -1, MATCH = 5, SIMILAR = 1, MISMATCH = -2;
const GROUP: Record<string, number> = {};
["ILVM", "FYW", "KRH", "DE", "NQ", "ST", "AG", "C", "P"].forEach((letters, index) => { for (const letter of letters) GROUP[letter] = index; });

function pairScore(a: string, b: string) {
  if (a === "X" || b === "X") return 0;
  if (a === b) return MATCH;
  return GROUP[a] !== undefined && GROUP[a] === GROUP[b] ? SIMILAR : MISMATCH;
}

export type SequenceAlignment = {
  /** Aligned [queryIndex, targetIndex] pairs, 0-based, in order. */
  pairs: [number, number][];
  identical: number;
};

/**
 * Local alignment: both sequences may overhang at either end for free, so a
 * chain that covers only part of the query, or carries a tag the query lacks,
 * aligns where it belongs. Internal gaps cost an affine penalty.
 */
export function alignSequences(query: string, target: string): SequenceAlignment {
  const n = query.length, m = target.length;
  if (!n || !m) return { pairs: [], identical: 0 };
  const width = m + 1, NEG = -1e9;
  const M = new Int32Array((n + 1) * width), X = new Int32Array((n + 1) * width).fill(NEG), Y = new Int32Array((n + 1) * width).fill(NEG);
  let best = 0, bestCell = 0;
  for (let i = 1; i <= n; i += 1) {
    const row = i * width, up = row - width;
    for (let j = 1; j <= m; j += 1) {
      // max(0, …) is the free start anywhere.
      const score = pairScore(query[i - 1], target[j - 1]) + Math.max(0, M[up + j - 1], X[up + j - 1], Y[up + j - 1]);
      M[row + j] = score;
      X[row + j] = Math.max(M[up + j] + GAP_OPEN, X[up + j] + GAP_EXTEND);
      Y[row + j] = Math.max(M[row + j - 1] + GAP_OPEN, Y[row + j - 1] + GAP_EXTEND);
      if (score > best) { best = score; bestCell = row + j; }
    }
  }
  const pairs: [number, number][] = [];
  let identical = 0, i = Math.floor(bestCell / width), j = bestCell % width, state: "M" | "X" | "Y" = "M";
  while (best > 0 && i > 0 && j > 0) {
    const cell = i * width + j, up = cell - width;
    if (state === "M") {
      pairs.push([i - 1, j - 1]);
      if (query[i - 1] === target[j - 1]) identical += 1;
      const from = M[cell] - pairScore(query[i - 1], target[j - 1]), diag = up - 1;
      if (from <= 0) break;
      state = M[diag] === from ? "M" : X[diag] === from ? "X" : "Y";
      i -= 1; j -= 1;
    } else if (state === "X") {
      state = X[cell] === M[up] + GAP_OPEN ? "M" : "X";
      i -= 1;
    } else {
      state = Y[cell] === M[cell - 1] + GAP_OPEN ? "M" : "Y";
      j -= 1;
    }
  }
  pairs.reverse();
  return { pairs, identical };
}

// ---------------------------------------------------------------------------
// Query → chain mapping.

export type ChainMapping = {
  labelAsymId: string;
  authAsymId: string;
  /** label_seq_id → one-based query position, for every aligned residue. */
  byLabelSeqId: Map<number, number>;
  aligned: number;
  identity: number;
  /** Aligned residues ÷ the shorter of chain and query. */
  coverage: number;
  /** Whether the chain is the query protein (or a close enough homologue) to carry its grades. */
  matches: boolean;
};

// A chain must align over a real stretch at a plausible identity; anything less
// is another protein in the entry (a partner, an antibody) and stays neutral.
export const MIN_MATCH_IDENTITY = 0.3;
export const MIN_MATCH_COVERAGE = 0.3;
export const MIN_MATCH_RESIDUES = 20;

const clean = (sequence: string) => sequence.toUpperCase().replace(/[^A-Z]/g, "");

export function mapChain(query: string, chain: ChainSequence): ChainMapping {
  const q = clean(query);
  const target = chain.sequence.toUpperCase();
  const { pairs, identical } = alignSequences(q, target);
  const byLabelSeqId = new Map<number, number>();
  for (const [queryIndex, targetIndex] of pairs) {
    const seqId = chain.seqIds[targetIndex];
    if (Number.isFinite(seqId)) byLabelSeqId.set(seqId, queryIndex + 1);
  }
  const aligned = pairs.length;
  const identity = aligned ? identical / aligned : 0;
  const coverage = aligned / Math.max(1, Math.min(q.length, target.length));
  const matches = aligned >= Math.min(MIN_MATCH_RESIDUES, q.length, target.length) && identity >= MIN_MATCH_IDENTITY && coverage >= MIN_MATCH_COVERAGE;
  return { labelAsymId: chain.labelAsymId, authAsymId: chain.authAsymId, byLabelSeqId, aligned, identity, coverage, matches };
}

// ---------------------------------------------------------------------------
// Sources.

/**
 * ConSurf grades numbered against the sequence that was graded. That sequence is
 * rebuilt from the rows themselves, because `position` counts along it: for a
 * ConSurf-DB run it is the representative chain's SEQRES, which can start at a
 * different residue than the project's `querySequence`.
 */
export function consurfProfile(job: { residues: ConservationResidue[] }, detail = ""): ConservationProfile {
  const length = Math.max(0, ...job.residues.map((residue) => residue.position));
  const letters = new Array<string>(length).fill("X");
  const grades: ConservationProfile["grades"] = new Array(length).fill(null);
  for (const residue of job.residues) {
    if (residue.position < 1) continue;
    letters[residue.position - 1] = clean(residue.residue || "X").slice(0, 1) || "X";
    grades[residue.position - 1] = { grade: Math.min(MAX_GRADE, Math.max(MIN_GRADE, Math.round(residue.grade))), insufficientData: residue.insufficientData };
  }
  return { source: "consurf", query: letters.join(""), grades, detail };
}

/**
 * Shannon-entropy conservation per query column of the BLAST alignment,
 * scaled by the column's occupancy so thinly covered columns rank lower:
 * score = (1 − H / ln 20) × (non-gap rows ÷ all rows).
 * Returns null for a column with fewer than six non-gapped sequences.
 */
export function columnEntropyScores(rows: string[]): (number | null)[] {
  const length = rows[0]?.length ?? 0;
  const maxEntropy = Math.log(20);
  return Array.from({ length }, (_, column) => {
    const counts = new Map<string, number>();
    let present = 0;
    for (const row of rows) {
      const residue = row[column];
      if (!residue || residue === "-" || residue === "X") continue;
      present += 1;
      counts.set(residue, (counts.get(residue) ?? 0) + 1);
    }
    if (present < MIN_COLUMN_SEQUENCES) return null;
    let entropy = 0;
    for (const count of counts.values()) { const p = count / present; entropy -= p * Math.log(p); }
    return Math.max(0, 1 - entropy / maxEntropy) * (present / rows.length);
  });
}

/**
 * ConSurf-style binning: grade 5 is centred on the mean score; the range above
 * the mean splits into 4.5 grades towards 9 and the range below into 4.5
 * towards 1. When every column scores the same there is no spread to bin, so
 * the absolute score picks the grade instead.
 */
export function binGrades(scores: (number | null)[]): (number | null)[] {
  const values = scores.filter((value): value is number => value !== null);
  if (!values.length) return scores.map(() => null);
  const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
  const max = Math.max(...values), min = Math.min(...values);
  const above = (max - mean) / 4.5, below = (mean - min) / 4.5;
  const clamp = (grade: number) => Math.min(MAX_GRADE, Math.max(MIN_GRADE, grade));
  return scores.map((score) => {
    if (score === null) return null;
    if (max - min < 1e-9) return clamp(1 + Math.floor(score * MAX_GRADE));
    const width = score >= mean ? above : below;
    return width > 0 ? clamp(Math.round(5 + (score - mean) / width)) : 5;
  });
}

/** Conservation of each query position across the saved BLAST alignment (query row included). */
export function alignmentProfile(query: string, hits: BlastHit[], detail = ""): ConservationProfile {
  const rows = buildMsa(query, hits.filter((hit) => hit.hsps.length)).map((row) => row.residues);
  const grades = binGrades(columnEntropyScores(rows));
  return {
    source: "alignment",
    query: rows[0] ?? "",
    grades: rows[0] ? Array.from(rows[0], (_, index) => grades[index] === null ? { grade: 0, insufficientData: true } : { grade: grades[index]!, insufficientData: false }) : [],
    detail,
  };
}

/** Hits that can feed the alignment score; fewer than this many cannot grade any column. */
export const MIN_ALIGNMENT_HITS = MIN_COLUMN_SEQUENCES - 1;

// ---------------------------------------------------------------------------
// The colour layer.

export type ConservationColoring = {
  coloring: ResidueColoring;
  chains: ChainMapping[];
  counts: { graded: number; insufficient: number; unmapped: number };
};

/**
 * Paints each modelled residue of a matching chain with its grade; residues the
 * alignment cannot place, and every residue of a chain that is not the query
 * protein, fall to the neutral base colour.
 */
export function conservationColoring(
  profile: ConservationProfile,
  chains: ChainSequence[],
  modelled: { labelAsymId: string; labelSeqId: number }[],
): ConservationColoring {
  const mappings = chains.map((chain) => mapChain(profile.query, chain));
  const byChain = new Map(mappings.map((mapping) => [mapping.labelAsymId, mapping]));
  const byGrade = new Map<number, { labelAsymId: string; labelSeqId: number }[]>();
  const insufficient: { labelAsymId: string; labelSeqId: number }[] = [];
  let unmapped = 0;
  for (const residue of modelled) {
    const mapping = byChain.get(residue.labelAsymId);
    const position = mapping?.matches ? mapping.byLabelSeqId.get(residue.labelSeqId) : undefined;
    const value = position ? profile.grades[position - 1] : null;
    if (!value) { unmapped += 1; continue; }
    const address = { labelAsymId: residue.labelAsymId, labelSeqId: residue.labelSeqId };
    if (value.insufficientData) { insufficient.push(address); continue; }
    const group = byGrade.get(value.grade);
    if (group) group.push(address); else byGrade.set(value.grade, [address]);
  }
  const groups = Array.from({ length: MAX_GRADE }, (_, index) => MAX_GRADE - index).map((grade) => ({
    key: String(grade),
    label: `Grade ${grade}`,
    color: CONSERVATION_COLORS[String(grade)],
    residues: byGrade.get(grade) ?? [],
  }));
  groups.push({ key: "insufficient", label: "Insufficient data", color: INSUFFICIENT_COLOR, residues: insufficient });
  const graded = groups.slice(0, MAX_GRADE).reduce((sum, group) => sum + group.residues.length, 0);
  return {
    coloring: {
      id: `conservation-${profile.source}`,
      title: profile.source === "consurf" ? "ConSurf grades" : "Alignment conservation",
      base: { label: "Not mapped", color: UNMAPPED_COLOR },
      groups,
    },
    chains: mappings,
    counts: { graded, insufficient: insufficient.length, unmapped },
  };
}
