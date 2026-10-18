// Pure helpers for the vector library browser: search parameters, facets,
// size ranges, source status, file import and the preview mini map.
// Nothing here touches React or the network so it can be unit tested.

export type LibraryVectorUse = { proteinId: string; proteinName: string; vectorId?: string; firstUsedAt?: string; lastUsedAt?: string };

export type LibraryVector = {
  id: string;
  name: string;
  lengthBp: number;
  circular: boolean;
  featureCount: number;
  insertName: string;
  notes?: string;
  host: string[];
  promoter: string[];
  inducer: string[];
  nTags: string[];
  cTags: string[];
  proteaseSites: string[];
  selectionMarker: string;
  origin: string;
  copyNumber: string;
  supplier: string;
  sourceUrl: string;
  license: string;
  licenseUrl: string;
  isStandard: boolean;
  favorite: boolean;
  projectCount: number;
  projects: LibraryVectorUse[];
  updatedAt?: string;
  lastUsedAt?: string;
  sequence?: string;
  features?: MapFeature[];
};

export type FacetKey = "host" | "promoter" | "nTag" | "cTag" | "proteaseSite" | "selectionMarker" | "copyNumber" | "supplier" | "origin" | "inducer";
export type FacetValue = { value: string; count: number };
export type FacetCounts = Partial<Record<FacetKey, FacetValue[]>>;
export type Filters = Partial<Record<FacetKey, string[]>>;

// The order a scientist narrows a backbone down: where it expresses, what
// drives it, what the protein comes out fused to, how it is selected.
export const FACETS: { key: FacetKey; label: string }[] = [
  { key: "host", label: "Host" },
  { key: "promoter", label: "Promoter" },
  { key: "nTag", label: "N-terminal tag" },
  { key: "cTag", label: "C-terminal tag" },
  { key: "proteaseSite", label: "Protease site" },
  { key: "selectionMarker", label: "Selection marker" },
  { key: "copyNumber", label: "Copy number" },
  { key: "supplier", label: "Supplier" },
  { key: "inducer", label: "Inducer" },
  { key: "origin", label: "Origin" },
];

export type LibrarySearch = { query: string; filters: Filters; favorite?: boolean; limit?: number; offset?: number };

/** Query string for GET /vector-library. Values repeat so commas inside a value survive. */
export function librarySearchParams({ query, filters, favorite, limit = 500, offset = 0 }: LibrarySearch): string {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  for (const { key } of FACETS) for (const value of filters[key] ?? []) params.append(key, value);
  if (favorite !== undefined) params.set("favorite", String(favorite));
  params.set("limit", String(limit));
  params.set("offset", String(offset));
  return params.toString();
}

export function toggleFilter(filters: Filters, key: FacetKey, value: string): Filters {
  const current = filters[key] ?? [];
  const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
  const copy = { ...filters };
  if (next.length) copy[key] = next; else delete copy[key];
  return copy;
}

export function activeFilterCount(filters: Filters, sizes: string[] = []): number {
  return Object.values(filters).reduce((sum, values) => sum + (values?.length ?? 0), 0) + sizes.length;
}

/**
 * Facet values with counts, keeping any selected value visible even when the
 * current results leave it at zero so it can still be unticked.
 */
export function facetOptions(counts: FacetValue[] | undefined, selected: string[] = []): FacetValue[] {
  const options = [...(counts ?? [])];
  for (const value of selected) if (!options.some((option) => option.value === value)) options.push({ value, count: 0 });
  return options;
}

// Size is not a server facet; the catalogue is small enough to bucket here.
export const SIZE_BUCKETS: { id: string; label: string; min: number; max: number }[] = [
  { id: "lt4", label: "Under 4 kb", min: 0, max: 4000 },
  { id: "4-6", label: "4–6 kb", min: 4000, max: 6000 },
  { id: "6-8", label: "6–8 kb", min: 6000, max: 8000 },
  { id: "8-10", label: "8–10 kb", min: 8000, max: 10000 },
  { id: "gt10", label: "Over 10 kb", min: 10000, max: Infinity },
];

export function sizeBucket(lengthBp: number): string {
  return (SIZE_BUCKETS.find((bucket) => lengthBp >= bucket.min && lengthBp < bucket.max) ?? SIZE_BUCKETS[SIZE_BUCKETS.length - 1]).id;
}

export function sizeCounts(vectors: Pick<LibraryVector, "lengthBp">[]): FacetValue[] {
  return SIZE_BUCKETS.map((bucket) => ({ value: bucket.id, count: vectors.filter((vector) => sizeBucket(vector.lengthBp) === bucket.id).length }));
}

export function filterBySize<T extends Pick<LibraryVector, "lengthBp">>(vectors: T[], selected: string[]): T[] {
  if (!selected.length) return vectors;
  return vectors.filter((vector) => selected.includes(sizeBucket(vector.lengthBp)));
}

export function formatBp(lengthBp: number | null | undefined): string {
  if (lengthBp == null || !Number.isFinite(lengthBp)) return "size unknown";
  return `${Math.round(lengthBp).toLocaleString("en-US")} bp`;
}

/** Tags in reading order, e.g. "6×His · Thrombin". */
export function vectorTagline(vector: Pick<LibraryVector, "nTags" | "cTags" | "proteaseSites">): string {
  const parts = [
    ...vector.nTags.map((tag) => `N-${tag}`),
    ...vector.proteaseSites,
    ...vector.cTags.map((tag) => `C-${tag}`),
  ];
  return parts.join(" · ");
}

// ---------------------------------------------------------------------------
// External sources
// ---------------------------------------------------------------------------

export type SourceStatus = "idle" | "waiting" | "searching" | "slow" | "done" | "offline" | "error";
export type SourceState = { status: SourceStatus; count: number; message: string };

export const idleSource: SourceState = { status: "idle", count: 0, message: "" };

/** How long before a search is called slow, and when it is abandoned. */
export const SLOW_AFTER_MS = 4000;
export const GIVE_UP_AFTER_MS = 30000;

/** The shortest query each source can usefully run. NCBI needs a real term. */
export function minimumQueryLength(sourceId: string): number {
  return sourceId === "ncbi" ? 3 : 2;
}

// Messages that mean the network or the remote service is unreachable rather
// than that the search itself was wrong.
const offlinePatterns = [/failed to fetch/i, /network/i, /timed? ?out/i, /unreachable/i, /urlopen/i, /name or service not known/i, /temporary failure/i, /connection/i, /offline/i, /\b50[234]\b/];

export function classifySourceError(message: string): "offline" | "error" {
  return offlinePatterns.some((pattern) => pattern.test(message)) ? "offline" : "error";
}

export function sourceStatusText(state: SourceState, sourceId: string): string {
  switch (state.status) {
    case "idle": return "Ready";
    case "waiting": return `Type ${minimumQueryLength(sourceId)}+ characters`;
    case "searching": return "Searching…";
    case "slow": return "Still searching…";
    case "done": return state.count === 1 ? "1 match" : `${state.count} matches`;
    case "offline": return "Offline";
    case "error": return "Search failed";
  }
}

// ---------------------------------------------------------------------------
// File import
// ---------------------------------------------------------------------------

export const IMPORT_EXTENSIONS = [".gb", ".gbk", ".genbank", ".ape", ".fa", ".fasta", ".fna", ".dna"];

/** How a dropped file travels to the engine: SnapGene files are binary. */
export function importEncoding(filename: string): "text" | "base64" | null {
  const lower = filename.toLowerCase();
  if (lower.endsWith(".dna")) return "base64";
  return IMPORT_EXTENSIONS.some((extension) => lower.endsWith(extension)) ? "text" : null;
}

// ---------------------------------------------------------------------------
// Mini map
// ---------------------------------------------------------------------------

export type MapFeature = {
  id?: string;
  name: string;
  type: string;
  start: number;
  end: number;
  strand?: number;
  qualifiers?: Record<string, string[]>;
};

export type FeatureKind = "promoter" | "cds" | "tag" | "protease" | "marker" | "origin" | "terminator" | "other";

// Colours stay distinct in greyscale by lightness as well as hue, and the
// dash pattern separates the regulatory kinds when printed.
export const KIND_STYLE: Record<FeatureKind, { label: string; color: string; dash?: string }> = {
  promoter: { label: "Promoter", color: "#1f7a3a", dash: "3 2" },
  cds: { label: "Coding sequence", color: "#d9831f" },
  tag: { label: "Tag", color: "#7a3fb8" },
  protease: { label: "Protease site", color: "#c2185b" },
  marker: { label: "Selection marker", color: "#2c5fb3" },
  origin: { label: "Origin", color: "#e3c84a" },
  terminator: { label: "Terminator", color: "#5b5b5b", dash: "1 2" },
  other: { label: "Other", color: "#a7b2b8" },
};

const markerWords = /resistan|amp|kan|neo|zeo|bla|cat\b|chloramphenicol|spectinomycin|streptomycin|aada|gentamicin|hygro|puro|blasticidin|bsd|tetracycline|tet[ar]?\b/i;
const tagWords = /\b(glutathione s-transferase|\d+ ?x ?his|his[- ]?tag|his6|hexahistidine|gst|mbp|flag|myc|ha tag|strep|avi|sumo|trx|thioredoxin|gfp|egfp|fgfp|mcherry|v5|s-tag|t7 tag|halo|snap)\b/i;
const proteaseWords = /\b(tev|thrombin|3c|prescission|enterokinase|factor xa|xa site|sumo protease|hrv)\b/i;

export function featureKind(feature: Pick<MapFeature, "name" | "type" | "qualifiers">): FeatureKind {
  const type = feature.type.toLowerCase();
  const name = feature.name;
  const regulatoryClass = (feature.qualifiers?.regulatory_class ?? []).join(" ").toLowerCase();
  if (type === "promoter" || regulatoryClass.includes("promoter") || /promoter/i.test(name)) return "promoter";
  if (type === "terminator" || regulatoryClass.includes("terminator") || /terminator/i.test(name)) return "terminator";
  if (type === "rep_origin" || /\bori\b|origin/i.test(name)) return "origin";
  if (proteaseWords.test(name) && /site|cleav|recogn|protease/i.test(name)) return "protease";
  if (markerWords.test(name)) return "marker";
  if (tagWords.test(name)) return "tag";
  if (type === "cds" || type === "gene") return "cds";
  return "other";
}

/** Fraction of the circle covered by a feature, honouring features that wrap the origin. */
export function featureSpan(start: number, end: number, lengthBp: number): number {
  if (lengthBp <= 0) return 0;
  const span = end >= start ? end - start : lengthBp - start + end;
  return Math.min(span, lengthBp);
}

/** SVG arc along a circle from base `start` to `end`, clockwise from 12 o'clock. */
export function arcPath(cx: number, cy: number, radius: number, start: number, end: number, lengthBp: number): string {
  const span = featureSpan(start, end, lengthBp);
  if (lengthBp <= 0 || span <= 0) return "";
  // A full-circle arc collapses to nothing in SVG, so stop just short.
  const sweep = Math.min(span / lengthBp, 0.9999) * 2 * Math.PI;
  const from = (start / lengthBp) * 2 * Math.PI;
  const to = from + sweep;
  const point = (angle: number) => [cx + radius * Math.sin(angle), cy - radius * Math.cos(angle)].map((value) => Math.round(value * 100) / 100);
  const [x1, y1] = point(from);
  const [x2, y2] = point(to);
  return `M ${x1} ${y1} A ${radius} ${radius} 0 ${sweep > Math.PI ? 1 : 0} 1 ${x2} ${y2}`;
}

/**
 * Assign each feature to the innermost ring where it does not overlap another,
 * so a dense map stacks outward instead of drawing features on top of each other.
 */
export function assignRings(features: Pick<MapFeature, "start" | "end">[], lengthBp: number, maxRings = 3): number[] {
  // Each ring holds the base intervals already drawn on it; wrapping features add two.
  const occupied: [number, number][][] = [];
  const intervals = (start: number, end: number): [number, number][] => end >= start ? [[start, end]] : [[start, lengthBp], [0, end]];
  const overlaps = ([s1, e1]: [number, number], own: [number, number][]) => own.some(([s2, e2]) => s1 < e2 && s2 < e1);
  const order = features.map((feature, index) => ({ index, span: featureSpan(feature.start, feature.end, lengthBp) })).sort((a, b) => b.span - a.span);
  const rings = new Array<number>(features.length).fill(0);
  for (const { index } of order) {
    const own = intervals(features[index].start, features[index].end);
    let ring = 0;
    while (ring < maxRings - 1 && (occupied[ring] ?? []).some((taken) => overlaps(taken, own))) ring += 1;
    (occupied[ring] ??= []).push(...own);
    rings[index] = ring;
  }
  return rings;
}

const kindPriority: FeatureKind[] = ["promoter", "tag", "protease", "cds", "marker", "origin", "terminator"];

/** The handful of features a scientist checks first, one per name, in map order within each kind. */
export function keyFeatures(features: MapFeature[], limit = 8): (MapFeature & { kind: FeatureKind })[] {
  const seen = new Set<string>();
  const picked: (MapFeature & { kind: FeatureKind })[] = [];
  for (const kind of kindPriority) {
    for (const feature of [...features].sort((a, b) => a.start - b.start)) {
      if (picked.length >= limit) return picked;
      const featureKindValue = featureKind(feature);
      const key = feature.name.toLowerCase();
      if (featureKindValue !== kind || seen.has(key)) continue;
      seen.add(key);
      picked.push({ ...feature, kind });
    }
  }
  return picked;
}
