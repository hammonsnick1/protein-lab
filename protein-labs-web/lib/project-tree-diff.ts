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

const MATCH = 1;
const MISMATCH = -1;
const GAP = -2;
/** Above this the quadratic aligner is replaced by prefix/suffix trimming. */
const ALIGN_LIMIT = 4000;

export type Alignment = { alignedBefore: string; alignedAfter: string };

/** Length of the shared leading run of two strings. */
function commonPrefix(a: string, b: string) {
  let index = 0;
  while (index < a.length && index < b.length && a[index] === b[index]) index += 1;
  return index;
}

function commonSuffix(a: string, b: string, limit: number) {
  let index = 0;
  while (index < limit && a[a.length - 1 - index] === b[b.length - 1 - index]) index += 1;
  return index;
}

/**
 * Global alignment with a linear gap penalty. Protein Lab sequences are a few
 * hundred residues, so a full Needleman-Wunsch is cheap and gives the honest
 * residue-by-residue picture the strip needs; very long pairs degrade to a
 * prefix/suffix trim rather than allocating a huge matrix.
 */
export function alignSequences(before: string, after: string): Alignment {
  if (before === after) return { alignedBefore: before, alignedAfter: after };
  if (!before.length || !after.length) {
    return {
      alignedBefore: before || "-".repeat(after.length),
      alignedAfter: after || "-".repeat(before.length),
    };
  }
  if (before.length > ALIGN_LIMIT || after.length > ALIGN_LIMIT) return trimAlign(before, after);

  const rows = before.length + 1;
  const columns = after.length + 1;
  // 0 = diagonal, 1 = up (gap in `after`), 2 = left (gap in `before`).
  const trace = new Uint8Array(rows * columns);
  let previous = new Int32Array(columns);
  let current = new Int32Array(columns);
  for (let column = 1; column < columns; column += 1) {
    previous[column] = column * GAP;
    trace[column] = 2;
  }
  for (let row = 1; row < rows; row += 1) {
    current[0] = row * GAP;
    trace[row * columns] = 1;
    for (let column = 1; column < columns; column += 1) {
      const diagonal = previous[column - 1] + (before[row - 1] === after[column - 1] ? MATCH : MISMATCH);
      const up = previous[column] + GAP;
      const left = current[column - 1] + GAP;
      let best = diagonal;
      let move = 0;
      if (up > best) { best = up; move = 1; }
      if (left > best) { best = left; move = 2; }
      current[column] = best;
      trace[row * columns + column] = move;
    }
    const swap = previous;
    previous = current;
    current = swap;
  }

  let row = rows - 1;
  let column = columns - 1;
  const left: string[] = [];
  const right: string[] = [];
  while (row > 0 || column > 0) {
    const move = row === 0 ? 2 : column === 0 ? 1 : trace[row * columns + column];
    if (move === 0) {
      left.push(before[row - 1]);
      right.push(after[column - 1]);
      row -= 1;
      column -= 1;
    } else if (move === 1) {
      left.push(before[row - 1]);
      right.push("-");
      row -= 1;
    } else {
      left.push("-");
      right.push(after[column - 1]);
      column -= 1;
    }
  }
  return { alignedBefore: left.reverse().join(""), alignedAfter: right.reverse().join("") };
}

/** Cheap alignment for very long pairs: keep the shared ends, gap the middle. */
function trimAlign(before: string, after: string): Alignment {
  const head = commonPrefix(before, after);
  const tail = commonSuffix(before, after, Math.min(before.length, after.length) - head);
  const middleBefore = before.slice(head, before.length - tail);
  const middleAfter = after.slice(head, after.length - tail);
  const width = Math.max(middleBefore.length, middleAfter.length);
  return {
    alignedBefore: before.slice(0, head) + middleBefore.padEnd(width, "-") + before.slice(before.length - tail),
    alignedAfter: after.slice(0, head) + middleAfter.padEnd(width, "-") + after.slice(after.length - tail),
  };
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
  const counts = new Map<string, number>();
  for (const edit of sequence.edits) counts.set(edit.kind, (counts.get(edit.kind) ?? 0) + 1);
  const parts = [...counts].map(([kind, count]) => `${count} ${kind}${count === 1 ? "" : "s"}`);
  const spread = `${sequence.lengthBefore} → ${sequence.lengthAfter} aa, ${sequence.identityPercent}% identity`;
  return parts.length ? `${parts.join(", ")} (${spread}).` : `${spread}.`;
}
