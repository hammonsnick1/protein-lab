// Shared vocabulary for the project tree screen (HOM-137).
//
// These types mirror the engine contract agreed on HOM-136/HOM-137: the tree
// endpoint embeds a one-line summary per branch so the whole tree draws in one
// call, and the full diff is fetched lazily when a branch is selected. The
// local fallback in lib/project-tree-diff.ts produces the same shapes, so the
// view never learns where its data came from.

/** Every kind of change a branch can carry. The engine sends these strings verbatim. */
export const CHANGE_CATEGORIES = [
  "sequence",
  "vector",
  "host",
  "tag",
  "purification",
  "assay",
  "protparam",
  "notes",
  "other",
] as const;

export type ChangeCategory = (typeof CHANGE_CATEGORIES)[number];

export type SequenceEditKind = "substitution" | "insertion" | "deletion" | "truncation" | "extension";

export type SequenceEdit = {
  kind: SequenceEditKind;
  /** 1-based position in the parent sequence. */
  position: number;
  before: string;
  after: string;
  /** Short mutation label such as `K73A`. */
  label: string;
};

export type SequenceDiff = {
  identityPercent: number;
  lengthBefore: number;
  lengthAfter: number;
  /** Gapped alignment strings of equal length, so the residue strip needs no aligner. */
  alignedBefore: string;
  alignedAfter: string;
  edits: SequenceEdit[];
};

export type ProjectDiffChange = {
  id: string;
  category: ChangeCategory;
  /** Human label for the row, e.g. "Backbone" or "Expression host". */
  field: string;
  before: string;
  after: string;
  summary: string;
};

export type ProtParamDelta = {
  label: string;
  before: string;
  after: string;
  direction: "up" | "down" | "flat";
};

export type ProjectDiff = {
  fromProjectId: string;
  toProjectId: string;
  summary: string;
  categories: ChangeCategory[];
  changes: ProjectDiffChange[];
  /** null when the two projects share an identical sequence. */
  sequence: SequenceDiff | null;
  protparam: ProtParamDelta[];
};

export type ProjectTreeBranch = {
  id: string;
  fromProjectId: string;
  toProjectId: string;
  /** One-line change summary, e.g. `K73A · pET-28a → pMAL-c5X`. */
  summary: string;
  categories: ChangeCategory[];
  changeCount: number;
  /** User-written explanation of the link. May be empty. */
  note: string;
};

export type ProjectTree = {
  id: string;
  name: string;
  rootProjectId: string;
  branches: ProjectTreeBranch[];
  createdAt: string;
  updatedAt: string;
};

/**
 * Presentation for one change category. `code` and `glyph` carry the meaning in
 * greyscale, so the colour is never the only signal (UI quality bar).
 */
export type CategoryStyle = {
  category: ChangeCategory;
  /** Full name used in the diff panel and the legend. */
  label: string;
  /** Three-letter badge drawn on branch chips. */
  code: string;
  /** Node/edge marker shape — a second non-colour channel. */
  glyph: "circle" | "square" | "diamond" | "triangle" | "hexagon" | "bar";
  /** CSS custom property holding the category hue. */
  token: string;
};

export const CATEGORY_STYLES: Record<ChangeCategory, CategoryStyle> = {
  sequence: { category: "sequence", label: "Sequence", code: "SEQ", glyph: "circle", token: "--change-sequence" },
  vector: { category: "vector", label: "Vector", code: "VEC", glyph: "diamond", token: "--change-vector" },
  host: { category: "host", label: "Host", code: "HST", glyph: "hexagon", token: "--change-host" },
  tag: { category: "tag", label: "Tag & fusion", code: "TAG", glyph: "square", token: "--change-tag" },
  purification: { category: "purification", label: "Purification", code: "PUR", glyph: "triangle", token: "--change-purification" },
  assay: { category: "assay", label: "Assays & jobs", code: "ASY", glyph: "bar", token: "--change-assay" },
  protparam: { category: "protparam", label: "ProtParam", code: "PRM", glyph: "circle", token: "--change-protparam" },
  notes: { category: "notes", label: "Notes", code: "NTE", glyph: "bar", token: "--change-notes" },
  other: { category: "other", label: "Other", code: "OTH", glyph: "circle", token: "--change-other" },
};

/** Stable display order so chips and legends never shuffle between renders. */
export function orderCategories(categories: readonly ChangeCategory[]): ChangeCategory[] {
  const seen = new Set(categories);
  return CHANGE_CATEGORIES.filter((category) => seen.has(category));
}

/** The category a branch is coloured by: the first one in canonical order. */
export function primaryCategory(categories: readonly ChangeCategory[]): ChangeCategory {
  return orderCategories(categories)[0] ?? "other";
}

export function isChangeCategory(value: unknown): value is ChangeCategory {
  return typeof value === "string" && (CHANGE_CATEGORIES as readonly string[]).includes(value);
}
