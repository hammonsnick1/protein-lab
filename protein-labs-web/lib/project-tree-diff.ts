// Local project diff (HOM-137).
//
// The engine owns the real diff service (HOM-136) and this file deliberately
// produces exactly its contract, so the tree view never branches on where a
// diff came from: the API client tries the engine first and falls back here.
// That also keeps the screen useful offline and before the engine ships.

import type { JsonObject, ProjectJob, ProteinBundle, ProteinRecord } from "./protein-labs-api.ts";
import type {
  ChangeCategory,
  ProjectDiff,
  ProjectDiffChange,
  ProtParamDelta,
  SequenceDiff,
  SequenceEdit,
} from "./project-tree-types.ts";
import { orderCategories } from "./project-tree-types.ts";

/** Everything the local diff can read about one project. */
export type DiffSource = {
  protein: ProteinRecord;
  protparam?: JsonObject | null;
  jobs?: ProjectJob[];
};

export function diffSourceFromBundle(bundle: ProteinBundle): DiffSource {
  return { protein: bundle.protein, protparam: bundle.protparam?.result ?? null, jobs: bundle.projectJobs };
}

// --- sequence alignment ------------------------------------------------------

// The engine aligns with Biopython's PairwiseAligner in global mode (HOM-136
// `_sequence_diff`). The browser fallback has to produce the *same* alignment,
// not merely a plausible one: gap placement decides the 1-based edit
// positions, the mutation labels, the identity figure and the branch summary,
// and the view presents all of those as fact. So this is Gotoh affine
// Needleman-Wunsch with the engine's exact scoring, and
// lib/project-tree-diff.test.ts checks it against alignments dumped from the
// engine itself rather than against this implementation.
const MATCH = 2;
const MISMATCH = -1;
/** Cost of a gap's first residue. A gap of length L costs OPEN + (L-1) * EXTEND. */
const GAP_OPEN = -4;
const GAP_EXTEND = -0.5;

/** Traceback predecessor states, two bits each inside one byte per cell. */
const FROM_M = 0;
const FROM_X = 1;
const FROM_Y = 2;

/**
 * Largest alignment the browser will attempt, as a cell count. The traceback
 * needs one byte per cell, so this caps it at ~4 MB — about 2000x2000
 * residues. The engine has no such limit, so beyond this the fallback reports
 * the alignment as unavailable instead of inventing a cheaper one.
 */
export const MAX_ALIGNMENT_CELLS = 4_000_000;

export type Alignment = { alignedBefore: string; alignedAfter: string };

export function alignmentFitsInBrowser(before: string, after: string) {
  return (before.length + 1) * (after.length + 1) <= MAX_ALIGNMENT_CELLS;
}

/**
 * Global alignment with affine gap penalties, matching the engine's scoring.
 * Callers must check `alignmentFitsInBrowser` first; this allocates a
 * traceback byte per cell.
 */
export function alignSequences(before: string, after: string): Alignment {
  if (before === after) return { alignedBefore: before, alignedAfter: after };
  // The engine's aligner rejects an empty sequence outright; the only sensible
  // alignment is one whole-length gap, so the fallback answers that directly.
  if (!before.length || !after.length) {
    return {
      alignedBefore: before || "-".repeat(after.length),
      alignedAfter: after || "-".repeat(before.length),
    };
  }

  const rows = before.length + 1;
  const columns = after.length + 1;
  const trace = new Uint8Array(rows * columns);
  // `m` ends on an aligned pair, `x` on a gap in `after`, `y` on a gap in `before`.
  let previousM = new Float64Array(columns);
  let previousX = new Float64Array(columns);
  let previousY = new Float64Array(columns);
  let currentM = new Float64Array(columns);
  let currentX = new Float64Array(columns);
  let currentY = new Float64Array(columns);

  previousM[0] = 0;
  previousX[0] = -Infinity;
  previousY[0] = -Infinity;
  for (let column = 1; column < columns; column += 1) {
    previousM[column] = -Infinity;
    previousX[column] = -Infinity;
    previousY[column] = GAP_OPEN + (column - 1) * GAP_EXTEND;
    trace[column] = FROM_Y << 4;
  }

  for (let row = 1; row < rows; row += 1) {
    currentM[0] = -Infinity;
    currentY[0] = -Infinity;
    currentX[0] = GAP_OPEN + (row - 1) * GAP_EXTEND;
    trace[row * columns] = FROM_X << 2;
    for (let column = 1; column < columns; column += 1) {
      const score = before[row - 1] === after[column - 1] ? MATCH : MISMATCH;
      // Every tie resolves in the same M, then X, then Y order — including
      // inside the gap states, where preferring the extend candidate instead
      // picks a different (equally optimal) alignment from the engine's. The
      // corpus test in the sibling test file is what pins this down.
      let bestM = previousM[column - 1];
      let fromM = FROM_M;
      if (previousX[column - 1] > bestM) { bestM = previousX[column - 1]; fromM = FROM_X; }
      if (previousY[column - 1] > bestM) { bestM = previousY[column - 1]; fromM = FROM_Y; }
      currentM[column] = bestM + score;

      let bestX = previousM[column] + GAP_OPEN;
      let fromX = FROM_M;
      if (previousX[column] + GAP_EXTEND > bestX) { bestX = previousX[column] + GAP_EXTEND; fromX = FROM_X; }
      if (previousY[column] + GAP_OPEN > bestX) { bestX = previousY[column] + GAP_OPEN; fromX = FROM_Y; }
      currentX[column] = bestX;

      let bestY = currentM[column - 1] + GAP_OPEN;
      let fromY = FROM_M;
      if (currentX[column - 1] + GAP_OPEN > bestY) { bestY = currentX[column - 1] + GAP_OPEN; fromY = FROM_X; }
      if (currentY[column - 1] + GAP_EXTEND > bestY) { bestY = currentY[column - 1] + GAP_EXTEND; fromY = FROM_Y; }
      currentY[column] = bestY;

      trace[row * columns + column] = fromM | (fromX << 2) | (fromY << 4);
    }
    [previousM, currentM] = [currentM, previousM];
    [previousX, currentX] = [currentX, previousX];
    [previousY, currentY] = [currentY, previousY];
  }

  let row = rows - 1;
  let column = columns - 1;
  let state = FROM_M;
  if (previousX[column] > previousM[column]) state = FROM_X;
  if (previousY[column] > Math.max(previousM[column], previousX[column])) state = FROM_Y;

  const left: string[] = [];
  const right: string[] = [];
  while (row > 0 || column > 0) {
    if (row === 0) state = FROM_Y;
    else if (column === 0) state = FROM_X;
    const cell = trace[row * columns + column];
    if (state === FROM_M) {
      left.push(before[row - 1]);
      right.push(after[column - 1]);
      state = cell & 0b11;
      row -= 1;
      column -= 1;
    } else if (state === FROM_X) {
      left.push(before[row - 1]);
      right.push("-");
      state = (cell >> 2) & 0b11;
      row -= 1;
    } else {
      left.push("-");
      right.push(after[column - 1]);
      state = (cell >> 4) & 0b11;
      column -= 1;
    }
  }
  return { alignedBefore: left.reverse().join(""), alignedAfter: right.reverse().join("") };
}

/** Group an alignment into substitutions and runs of insertion/deletion. */
export function sequenceEdits(alignment: Alignment): SequenceEdit[] {
  const { alignedBefore, alignedAfter } = alignment;
  const edits: SequenceEdit[] = [];
  let beforePosition = 0;
  let index = 0;
  while (index < alignedBefore.length) {
    const left = alignedBefore[index];
    const right = alignedAfter[index];
    if (left === right) {
      beforePosition += 1;
      index += 1;
      continue;
    }
    if (left === "-" || right === "-") {
      // Collect the whole gap run so one indel is one row, not twenty.
      const deletion = right === "-";
      let end = index;
      while (end < alignedBefore.length
        && (deletion ? alignedAfter[end] === "-" : alignedBefore[end] === "-")) end += 1;
      const residues = (deletion ? alignedBefore : alignedAfter).slice(index, end);
      const atEnd = end === alignedBefore.length;
      const position = beforePosition + 1;
      edits.push({
        kind: deletion ? (atEnd ? "truncation" : "deletion") : (atEnd ? "extension" : "insertion"),
        position,
        before: deletion ? residues : "",
        after: deletion ? "" : residues,
        label: deletion
          ? `Δ${position}${residues.length > 1 ? `-${position + residues.length - 1}` : ""}`
          : `${position}ins${residues.length > 3 ? `${residues.length}` : residues}`,
      });
      if (deletion) beforePosition += residues.length;
      index = end;
      continue;
    }
    const position = beforePosition + 1;
    edits.push({ kind: "substitution", position, before: left, after: right, label: `${left}${position}${right}` });
    beforePosition += 1;
    index += 1;
  }
  return edits;
}

export function sequenceDiff(before: string, after: string): SequenceDiff | null {
  if (before === after) return null;
  // Beyond the browser's budget the honest answer is "the engine computes
  // this", not a cheaper alignment dressed up as the engine's. Lengths are
  // exact either way, so the branch still reports that the sequence changed.
  if (!alignmentFitsInBrowser(before, after)) {
    return {
      identityPercent: 0,
      lengthBefore: before.length,
      lengthAfter: after.length,
      alignedBefore: "",
      alignedAfter: "",
      edits: [],
      alignmentUnavailable: true,
    };
  }
  const alignment = alignSequences(before, after);
  const columns = alignment.alignedBefore.length;
  let matches = 0;
  for (let index = 0; index < columns; index += 1) {
    if (alignment.alignedBefore[index] === alignment.alignedAfter[index]) matches += 1;
  }
  return {
    identityPercent: columns ? Math.round((matches / columns) * 1000) / 10 : 0,
    lengthBefore: before.length,
    lengthAfter: after.length,
    alignedBefore: alignment.alignedBefore,
    alignedAfter: alignment.alignedAfter,
    edits: sequenceEdits(alignment),
  };
}

// --- project facets ---------------------------------------------------------

type Facet = {
  key: string; category: ChangeCategory; field: string; value: string;
  /** Compact form for the one-line branch label, when `value` is a list. */
  short?: string;
};

function text(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(Math.round(value * 100) / 100) : "";
  if (typeof value === "boolean") return value ? "yes" : "no";
  if (Array.isArray(value)) return value.map(text).filter(Boolean).join(", ");
  return String(value).trim();
}

/** First non-empty value among the given keys of a job config. */
function pick(config: JsonObject | undefined, ...keys: string[]): string {
  if (!config) return "";
  for (const key of keys) {
    const value = text(config[key]);
    if (value) return value;
  }
  return "";
}

function configFor(jobs: ProjectJob[], appType: string): JsonObject | undefined {
  return jobs.find((job) => job.appType === appType)?.config;
}

/**
 * The comparable facts about one project, pulled out of the protein record and
 * its saved jobs. Empty values are kept so "nothing chosen yet" → "chosen"
 * still reads as a change.
 */
export function projectFacets(source: DiffSource): Facet[] {
  const jobs = source.jobs ?? [];
  const vector = configFor(jobs, "expression-planning");
  const host = configFor(jobs, "expression-system");
  const affinity = configFor(jobs, "purification-affinity");
  const subtractive = configFor(jobs, "purification-subtractive");
  const sec = configFor(jobs, "purification-sec");
  const lysis = configFor(jobs, "purification-lysis");
  const facets: Facet[] = [
    { key: "vector", category: "vector", field: "Backbone", value: pick(vector, "vectorName", "backboneName", "backbone", "plasmidName", "name") },
    { key: "vector-method", category: "vector", field: "Cloning method", value: pick(vector, "cloningMethod", "method") },
    { key: "host", category: "host", field: "Expression host", value: pick(host, "strainName", "strainId", "hostName", "host") || text(source.protein.expressionSystem) },
    { key: "host-system", category: "host", field: "Expression system", value: pick(host, "systemName", "system") },
    { key: "tag", category: "tag", field: "Affinity tag", value: pick(affinity, "tagName", "affinityTag", "tagId") },
    { key: "tag-terminus", category: "tag", field: "Tag terminus", value: pick(affinity, "terminus") },
    { key: "tag-linker", category: "tag", field: "Linker", value: pick(affinity, "linkerName", "linkerId") },
    { key: "tag-cleavage", category: "tag", field: "Cleavage protease", value: pick(subtractive, "cleavageName", "cleavageId", "proteaseName") },
    { key: "capture", category: "purification", field: "Capture column", value: pick(affinity, "columnName", "columnId") },
    { key: "cleanup", category: "purification", field: "Subtractive column", value: pick(subtractive, "columnName", "columnId") },
    { key: "polish", category: "purification", field: "SEC column", value: pick(sec, "columnName", "columnId") },
    { key: "lysis", category: "purification", field: "Lysis method", value: pick(lysis, "methodName", "methodId") },
    { key: "organism", category: "notes", field: "Source organism", value: text(source.protein.organism) },
    { key: "gene", category: "notes", field: "Gene name", value: text(source.protein.geneName) },
    { key: "tags", category: "notes", field: "Project tags", value: text(source.protein.tags) },
  ];
  // Assays and analyses are "which jobs exist", not a single field.
  const assays = jobs
    .filter((job) => job.appType === "chromatogram-studio" || job.appType === "gel-analysis" || job.appType === "transformation-expression")
    .map((job) => `${job.name} (${job.status.replace("_", " ")})`)
    .sort();
  facets.push({
    key: "assays", category: "assay", field: "Assays and analyses",
    value: assays.join(", "),
    // The branch label gets the count; the panel row keeps the names.
    short: `${assays.length} assay${assays.length === 1 ? "" : "s"}`,
  });
  return facets;
}

const PROTPARAM_FIELDS: { keys: string[]; label: string; unit?: string }[] = [
  { keys: ["molecularWeight", "molecular_weight", "mw"], label: "Molecular weight", unit: " Da" },
  { keys: ["theoreticalPi", "theoretical_pi", "isoelectricPoint", "pi"], label: "Theoretical pI" },
  { keys: ["extinctionCoefficient", "extinction_coefficient"], label: "Extinction coefficient" },
  { keys: ["instabilityIndex", "instability_index"], label: "Instability index" },
  { keys: ["gravy", "GRAVY"], label: "GRAVY" },
  { keys: ["aliphaticIndex", "aliphatic_index"], label: "Aliphatic index" },
  { keys: ["length", "sequenceLength"], label: "Residues" },
];

function protparamValue(result: JsonObject | null | undefined, keys: string[]): number | null {
  if (!result) return null;
  for (const key of keys) {
    const raw = result[key];
    const value = typeof raw === "number" ? raw : typeof raw === "string" ? Number(raw) : Number.NaN;
    if (Number.isFinite(value)) return value;
  }
  return null;
}

export function protparamDeltas(from: DiffSource, to: DiffSource): ProtParamDelta[] {
  const deltas: ProtParamDelta[] = [];
  for (const field of PROTPARAM_FIELDS) {
    const before = protparamValue(from.protparam, field.keys);
    const after = protparamValue(to.protparam, field.keys);
    if (before === null && after === null) continue;
    if (before !== null && after !== null && Math.abs(before - after) < 1e-6) continue;
    const unit = field.unit ?? "";
    deltas.push({
      label: field.label,
      before: before === null ? "—" : `${format(before)}${unit}`,
      after: after === null ? "—" : `${format(after)}${unit}`,
      direction: before === null || after === null ? "flat" : after > before ? "up" : after < before ? "down" : "flat",
    });
  }
  return deltas;
}

function format(value: number) {
  const rounded = Math.round(value * 100) / 100;
  return Math.abs(rounded) >= 1000 ? rounded.toLocaleString("en-US") : String(rounded);
}

// --- the diff ---------------------------------------------------------------

const MAX_SUMMARY_PARTS = 2;
/** The branch label clamps at two lines; a part longer than this never fits. */
const MAX_SUMMARY_PART = 26;

function shorten(value: string) {
  return value.length > MAX_SUMMARY_PART ? `${value.slice(0, MAX_SUMMARY_PART - 1).trimEnd()}…` : value;
}

/**
 * `K73A · pET-28a → pMAL-c5X` — the one line a branch shows in the tree.
 * `changes` should exclude the sequence row and ProtParam, which are already
 * represented by `sequence` and are a consequence of the other changes.
 */
export function branchSummary(sequence: SequenceDiff | null, changes: ProjectDiffChange[]): string {
  const parts: string[] = [];
  if (sequence) {
    const labels = sequence.edits.slice(0, MAX_SUMMARY_PARTS).map((edit) => edit.label);
    const extra = sequence.edits.length - labels.length;
    parts.push(labels.length
      ? labels.join(", ") + (extra > 0 ? ` +${extra}` : "")
      : `${sequence.lengthBefore} → ${sequence.lengthAfter} aa`);
  }
  let used = 0;
  for (const change of changes) {
    if (parts.length >= MAX_SUMMARY_PARTS) break;
    parts.push(change.before !== "—" && change.after !== "—"
      ? `${shorten(change.before)} → ${shorten(change.after)}`
      : change.after !== "—" ? shorten(change.after) : `${change.field} cleared`);
    used += 1;
  }
  const line = parts.join(" · ");
  if (!line) return "No recorded differences";
  const hidden = changes.length - used;
  return hidden > 0 ? `${line} · +${hidden} more` : line;
}

/** Build the engine-shaped diff from whatever the browser already has loaded. */
export function localProjectDiff(from: DiffSource, to: DiffSource): ProjectDiff {
  const sequence = sequenceDiff(from.protein.sequence ?? "", to.protein.sequence ?? "");
  const sequenceChange: ProjectDiffChange[] = sequence ? [{
    id: "sequence",
    category: "sequence",
    field: "Amino-acid sequence",
    before: `${sequence.lengthBefore} aa`,
    after: `${sequence.lengthAfter} aa`,
    summary: describeSequence(sequence),
  }] : [];
  const facetChanges: ProjectDiffChange[] = [];
  // The label and the panel disagree on purpose for list-valued facets: the
  // label shows the compact form, the panel the full before/after.
  const summaryChanges: ProjectDiffChange[] = [];
  const after = new Map(projectFacets(to).map((facet) => [facet.key, facet]));
  for (const facet of projectFacets(from)) {
    const next = after.get(facet.key);
    if (!next || next.value === facet.value) continue;
    summaryChanges.push({
      id: facet.key, category: facet.category, field: facet.field,
      before: facet.short || facet.value || "—", after: next.short || next.value || "—", summary: "",
    });
    facetChanges.push({
      id: facet.key,
      category: facet.category,
      field: facet.field,
      before: facet.value || "—",
      after: next.value || "—",
      summary: !facet.value
        ? `${facet.field} set to ${next.value}.`
        : !next.value
          ? `${facet.field} cleared (was ${facet.value}).`
          : `${facet.field} changed from ${facet.value} to ${next.value}.`,
    });
  }
  const protparam = protparamDeltas(from, to);
  const protparamChanges: ProjectDiffChange[] = protparam.map((delta) => ({
    id: `protparam:${delta.label}`,
    category: "protparam",
    field: delta.label,
    before: delta.before,
    after: delta.after,
    summary: `${delta.label} moved from ${delta.before} to ${delta.after}.`,
  }));
  // ProtParam always moves when the sequence or the tag does, so it only earns
  // a branch chip of its own when nothing else changed.
  const chipped = [...sequenceChange, ...facetChanges];
  const categories = orderCategories(
    (chipped.length ? chipped : protparamChanges).map((change) => change.category),
  );
  return {
    fromProjectId: from.protein.id,
    toProjectId: to.protein.id,
    summary: branchSummary(sequence, summaryChanges),
    categories,
    changes: [...sequenceChange, ...facetChanges, ...protparamChanges],
    sequence,
    protparam,
  };
}

function describeSequence(sequence: SequenceDiff) {
  const lengths = `${sequence.lengthBefore} → ${sequence.lengthAfter} aa`;
  if (sequence.alignmentUnavailable) {
    return `${lengths}. These sequences are too long to align in the app — the engine computes the residue-level comparison.`;
  }
  const counts = new Map<string, number>();
  for (const edit of sequence.edits) counts.set(edit.kind, (counts.get(edit.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`);
  const spread = `${lengths}, ${sequence.identityPercent}% identity`;
  return parts.length ? `${parts.join(", ")} (${spread}).` : `${spread}.`;
}
