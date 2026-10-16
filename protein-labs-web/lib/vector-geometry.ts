// Pure coordinate, layout and sequence maths for the expression-vector editor.
// Everything here is framework-free so the map, linear and sequence views share
// one definition of a range and Node's test runner can check it directly.
//
// Coordinates are zero-based and half-open, matching the engine. On a circular
// sequence a range whose start is greater than its end wraps through the origin.

export type SeqRange = { start: number; end: number };

export type MapFeature = {
  id: string;
  name: string;
  type: string;
  start: number;
  end: number;
  strand: number;
  color?: string;
  customColor?: boolean;
  automatic?: boolean;
};

export type FeatureCategory =
  | "promoter" | "cds" | "orf" | "tag" | "cleavage" | "origin" | "marker"
  | "terminator" | "operator" | "rbs" | "primer" | "polya" | "misc";

/**
 * Colours chosen so that categories stay distinct in greyscale print: each
 * step in this list differs in lightness, not only in hue.
 */
export const CATEGORY_STYLE: Record<FeatureCategory, { color: string; label: string }> = {
  promoter: { color: "#2f8f46", label: "Promoter" },
  cds: { color: "#e8a33d", label: "Coding sequence" },
  marker: { color: "#b8572e", label: "Selection marker" },
  orf: { color: "#cfc8b8", label: "Detected ORF" },
  tag: { color: "#5b49b8", label: "Affinity / epitope tag" },
  cleavage: { color: "#d4547f", label: "Protease site" },
  origin: { color: "#f3dc5a", label: "Origin" },
  terminator: { color: "#6d2b2b", label: "Terminator" },
  operator: { color: "#3c9e9a", label: "Operator / binding site" },
  rbs: { color: "#8a6fd6", label: "RBS / Kozak" },
  primer: { color: "#8db6dd", label: "Primer site" },
  polya: { color: "#9b5a2a", label: "PolyA signal" },
  misc: { color: "#9aa0a8", label: "Other feature" },
};

const MARKER = /\b(amp|bla|kan|aph|neo|cat|cm|tet|hyg|zeo|ble|puro|pac|spec|aad|gent|bsd|nat|kanr|ampr|camr)\w*/i;
const TAG = /\b(\d*x?\s?his|his\d*|6xhis|8xhis|flag|strep|twin-?strep|gst|mbp|myc|ha tag|ha\b|v5|sumo|trx|thioredoxin|avi|halo|snap|s-?tag|t7 tag|nus|gfp|mcherry)\b/i;
const CLEAVAGE = /(cleavage|thrombin|tev|3c|prescission|enterokinase|factor xa|sumo protease|hrv)/i;

/** The display category of a feature, from its type and, where the type is vague, its name. */
export function featureCategory(feature: Pick<MapFeature, "type" | "name" | "automatic">): FeatureCategory {
  const type = String(feature.type ?? "").toLowerCase();
  const name = String(feature.name ?? "");
  if (/^orf\b/i.test(name)) return "orf";
  if (CLEAVAGE.test(name)) return "cleavage";
  if (type === "promoter") return "promoter";
  if (type === "terminator") return "terminator";
  if (type === "rep_origin" || /\bori\b|origin/i.test(name)) return "origin";
  if (type === "primer_bind") return "primer";
  if (type === "polya_signal") return "polya";
  if (type === "rbs" || /kozak|\brbs\b|shine/i.test(name)) return "rbs";
  if (type === "protein_bind" || /operator/i.test(name)) return "operator";
  // A CDS named after its fusion partner (e.g. "Klf4-2A-Myc") is still a CDS.
  if ((TAG.test(name) && type !== "cds" && type !== "gene") || /\btag\b/i.test(name)) return "tag";
  if (MARKER.test(name) && (type === "cds" || type === "gene" || type === "misc_feature")) return "marker";
  if (type === "cds" || type === "gene") return "cds";
  if (type === "mat_peptide" && TAG.test(name)) return "tag";
  return "misc";
}

/** The colour a feature is drawn in: its type colour unless the user picked one. */
export function featureColor(feature: MapFeature): string {
  if (feature.customColor && feature.color) return feature.color;
  return CATEGORY_STYLE[featureCategory(feature)].color;
}

/** Whether a fill colour needs dark or light text on top of it. */
export function inkOn(hex: string): string {
  const value = hex.replace("#", "");
  if (value.length !== 6) return "#111";
  const [r, g, b] = [0, 2, 4].map((offset) => parseInt(value.slice(offset, offset + 2), 16) / 255);
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.55 ? "#1b1b1b" : "#ffffff";
}

// ---------------------------------------------------------------------------
// Ranges
// ---------------------------------------------------------------------------

/** Wrap any integer position onto a sequence of the given length. */
export function wrap(position: number, length: number): number {
  if (length <= 0) return 0;
  return ((position % length) + length) % length;
}

/** Length of a range, counting through the origin when it wraps. */
export function rangeLength(range: SeqRange, length: number): number {
  if (range.end >= range.start) return range.end - range.start;
  return length - range.start + range.end;
}

/** Whether a base index lies inside a (possibly wrapping) range. */
export function rangeContains(range: SeqRange, position: number): boolean {
  if (range.end >= range.start) return position >= range.start && position < range.end;
  return position >= range.start || position < range.end;
}

/** The overlap of a range with a window [from, to), as zero, one or two linear pieces. */
export function clipRange(range: SeqRange, from: number, to: number, length: number): SeqRange[] {
  const pieces = range.end >= range.start
    ? [range]
    : [{ start: range.start, end: length }, { start: 0, end: range.end }];
  return pieces
    .map((piece) => ({ start: Math.max(piece.start, from), end: Math.min(piece.end, to) }))
    .filter((piece) => piece.end > piece.start);
}

/**
 * The range covered by a drag from one base to another. On a circular
 * sequence the drag is allowed to cross the origin when that is the shorter way.
 */
export function dragRange(anchor: number, head: number, length: number, circular: boolean): SeqRange {
  if (anchor === head) return { start: anchor, end: anchor };
  const forward = head > anchor;
  const linear = forward ? { start: anchor, end: head + 1 } : { start: head, end: anchor + 1 };
  if (!circular) return linear;
  const direct = linear.end - linear.start;
  if (direct <= length / 2) return linear;
  // Going the other way round the circle is shorter.
  return forward ? { start: head, end: anchor + 1 } : { start: anchor, end: head + 1 };
}

/** The bases of a (possibly wrapping) range. */
export function rangeSequence(sequence: string, range: SeqRange): string {
  if (range.end >= range.start) return sequence.slice(range.start, range.end);
  return sequence.slice(range.start) + sequence.slice(0, range.end);
}

/** Human 1-based, inclusive coordinates, as a scientist reads them. */
export function formatRange(range: SeqRange, length: number): string {
  const size = rangeLength(range, length);
  if (!size) return `after ${range.start.toLocaleString()}`;
  return `${(range.start + 1).toLocaleString()}–${range.end.toLocaleString()}`;
}

// ---------------------------------------------------------------------------
// Sequence helpers
// ---------------------------------------------------------------------------

const COMPLEMENT: Record<string, string> = { A: "T", T: "A", G: "C", C: "G", N: "N", U: "A" };

export function complement(sequence: string): string {
  let out = "";
  for (const base of sequence) out += COMPLEMENT[base] ?? "N";
  return out;
}

export function reverseComplement(sequence: string): string {
  return complement(sequence).split("").reverse().join("");
}

export function gcPercent(sequence: string): number {
  if (!sequence) return 0;
  let gc = 0;
  for (const base of sequence) if (base === "G" || base === "C") gc += 1;
  return (gc / sequence.length) * 100;
}

const CODONS: Record<string, string> = (() => {
  const bases = "TCAG";
  const amino = "FFLLSSSSYY**CC*WLLLLPPPPHHQQRRRRIIIMTTTTNNKKSSRRVVVVAAAADDEEGGGG";
  const table: Record<string, string> = {};
  let index = 0;
  for (const a of bases) for (const b of bases) for (const c of bases) table[a + b + c] = amino[index++];
  return table;
})();

/** Translate DNA in frame 0; incomplete trailing codons are dropped. */
export function translate(sequence: string): string {
  let protein = "";
  for (let index = 0; index + 3 <= sequence.length; index += 3) protein += CODONS[sequence.slice(index, index + 3)] ?? "X";
  return protein;
}

// Allawi & SantaLucia (1997) unified nearest-neighbour parameters (kcal/mol, cal/K·mol),
// the same table Biopython's Tm_NN uses by default.
const NN: Record<string, [number, number]> = {
  "AA/TT": [-7.9, -22.2], "AT/TA": [-7.2, -20.4], "TA/AT": [-7.2, -21.3],
  "CA/GT": [-8.5, -22.7], "GT/CA": [-8.4, -22.4], "CT/GA": [-7.8, -21.0],
  "GA/CT": [-8.2, -22.2], "CG/GC": [-10.6, -27.2], "GC/CG": [-9.8, -24.4],
  "GG/CC": [-8.0, -19.9],
};

/**
 * Nearest-neighbour melting temperature for a short oligo, at 50 mM Na⁺ and
 * 25 nM of each strand. These match Biopython's Tm_NN defaults, so the readout
 * agrees with the engine's reference values. Returns null outside 8–60 bases,
 * where a two-state NN model is not meaningful.
 */
export function oligoTm(sequence: string, sodiumMm = 50, strandNm = 25): number | null {
  const seq = sequence.toUpperCase();
  if (seq.length < 8 || seq.length > 60 || /[^ACGT]/.test(seq)) return null;
  const comp = complement(seq);
  let dh = 0, ds = 0;
  const ends = seq[0] + seq[seq.length - 1];
  const at = [...ends].filter((base) => base === "A" || base === "T").length;
  dh += 2.3 * at + 0.1 * (2 - at);
  ds += 4.1 * at - 2.8 * (2 - at);
  for (let index = 0; index < seq.length - 1; index += 1) {
    const key = `${seq.slice(index, index + 2)}/${comp.slice(index, index + 2)}`;
    const value = NN[key] ?? NN[key.split("").reverse().join("")];
    if (value) { dh += value[0]; ds += value[1]; }
  }
  // Like the engine (Biopython's default), strands are treated as non-self-complementary.
  const k = (strandNm - strandNm / 2) * 1e-9;
  ds += 0.368 * (seq.length - 1) * Math.log(sodiumMm / 1000);
  return (1000 * dh) / (ds + 1.987 * Math.log(k)) - 273.15;
}

// ---------------------------------------------------------------------------
// Circular map geometry
// ---------------------------------------------------------------------------

/** Angle in degrees for a base, with the origin at 12 o'clock and clockwise travel. */
export function baseAngle(position: number, length: number, rotation = 0): number {
  return (position / Math.max(1, length)) * 360 - 90 + rotation;
}

export function polar(cx: number, cy: number, radius: number, angle: number) {
  const radians = (angle * Math.PI) / 180;
  return { x: cx + Math.cos(radians) * radius, y: cy + Math.sin(radians) * radius };
}

/** Clockwise angular span from start to end in degrees, in (0, 360]. */
export function angularSpan(start: number, end: number, length: number): number {
  const bases = rangeLength({ start, end }, length);
  return (bases / Math.max(1, length)) * 360;
}

/** SVG path for a clockwise annular sector — the body of a feature arrow. */
export function arcBand(cx: number, cy: number, inner: number, outer: number, startAngle: number, span: number): string {
  const sweep = Math.min(359.99, Math.max(0.01, span));
  const end = startAngle + sweep;
  const large = sweep > 180 ? 1 : 0;
  const a = polar(cx, cy, outer, startAngle), b = polar(cx, cy, outer, end);
  const c = polar(cx, cy, inner, end), d = polar(cx, cy, inner, startAngle);
  return `M ${a.x} ${a.y} A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y} Z`;
}

/**
 * SVG path for a directional feature: a band with a pointed head at its 3' end.
 * Short features are drawn as a pure arrowhead so direction stays readable.
 */
export function featureArrow(cx: number, cy: number, radius: number, thickness: number, startAngle: number, span: number, strand: number): string {
  const half = thickness / 2;
  const inner = radius - half, outer = radius + half;
  const head = Math.min(span, Math.max(1.5, (thickness * 0.9 / radius) * (180 / Math.PI)));
  if (strand === 0 || span <= head) return arcBand(cx, cy, inner, outer, startAngle, span);
  const large = span - head > 180 ? 1 : 0;
  if (strand > 0) {
    const bodyEnd = startAngle + span - head;
    const a = polar(cx, cy, outer, startAngle), b = polar(cx, cy, outer, bodyEnd);
    const tip = polar(cx, cy, radius, startAngle + span);
    const c = polar(cx, cy, inner, bodyEnd), d = polar(cx, cy, inner, startAngle);
    return `M ${a.x} ${a.y} A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} L ${tip.x} ${tip.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y} Z`;
  }
  const bodyStart = startAngle + head, end = startAngle + span;
  const tip = polar(cx, cy, radius, startAngle);
  const a = polar(cx, cy, outer, bodyStart), b = polar(cx, cy, outer, end);
  const c = polar(cx, cy, inner, end), d = polar(cx, cy, inner, bodyStart);
  return `M ${tip.x} ${tip.y} L ${a.x} ${a.y} A ${outer} ${outer} 0 ${large} 1 ${b.x} ${b.y} L ${c.x} ${c.y} A ${inner} ${inner} 0 ${large} 0 ${d.x} ${d.y} Z`;
}

/** The base under a point on the circular map, given its centre and rotation. */
export function angleToBase(x: number, y: number, cx: number, cy: number, length: number, rotation = 0): number {
  const degrees = (Math.atan2(y - cy, x - cx) * 180) / Math.PI + 90 - rotation;
  const fraction = (((degrees % 360) + 360) % 360) / 360;
  return Math.min(length - 1, Math.floor(fraction * length));
}

/**
 * Assign features to concentric tracks so that no two features on a track
 * overlap. Longer features are placed first so they sit on the inner track.
 */
export function assignTracks<T extends { start: number; end: number }>(items: T[], length: number, circular: boolean): Map<T, number> {
  const tracks: SeqRange[][] = [];
  const result = new Map<T, number>();
  const order = [...items].sort((a, b) => rangeLength(b, length) - rangeLength(a, length) || a.start - b.start);
  const overlaps = (a: SeqRange, b: SeqRange) => {
    const left = circular ? clipRange(a, 0, length, length) : [a];
    const right = circular ? clipRange(b, 0, length, length) : [b];
    return left.some((p) => right.some((q) => p.start < q.end && q.start < p.end));
  };
  for (const item of order) {
    const range = item.end < item.start && !circular ? { start: item.end, end: item.start } : item;
    let track = tracks.findIndex((placed) => !placed.some((other) => overlaps(other, range)));
    if (track < 0) { track = tracks.length; tracks.push([]); }
    tracks[track].push(range);
    result.set(item, track);
  }
  return result;
}

export type LabelRequest = { key: string; angle: number; priority: number; width: number };
export type PlacedLabel = { key: string; x: number; y: number; anchorAngle: number; left: boolean; elbow: { x: number; y: number } };

/**
 * Place labels on both sides of a circular map without collisions.
 *
 * Labels keep the side they naturally fall on. Each side is resolved by
 * merging overlapping groups and centring each group on the mean of its ideal
 * positions, which keeps labels as close as possible to what they name. If a
 * side cannot fit every label, the lowest-priority labels are dropped and
 * reported, rather than overlapping.
 */
export function layoutCircularLabels(
  requests: LabelRequest[],
  options: { cx: number; cy: number; radius: number; top: number; bottom: number; lineHeight: number },
): { placed: PlacedLabel[]; hidden: string[] } {
  const { cx, cy, radius, top, bottom, lineHeight } = options;
  const capacity = Math.max(1, Math.floor((bottom - top) / lineHeight) + 1);
  const hidden: string[] = [];
  const placed: PlacedLabel[] = [];
  for (const left of [true, false]) {
    let side = requests.filter((request) => (Math.cos((request.angle * Math.PI) / 180) < 0) === left);
    if (side.length > capacity) {
      const keep = new Set([...side].sort((a, b) => b.priority - a.priority).slice(0, capacity).map((request) => request.key));
      for (const request of side) if (!keep.has(request.key)) hidden.push(request.key);
      side = side.filter((request) => keep.has(request.key));
    }
    const ideal = side.map((request) => ({ request, y: cy + Math.sin((request.angle * Math.PI) / 180) * radius }));
    ideal.sort((a, b) => a.y - b.y);
    const ys = spreadPositions(ideal.map((item) => item.y), lineHeight, top, bottom);
    ideal.forEach((item, index) => {
      const y = ys[index];
      // Labels follow the curve of the circle, which reads far better than a
      // fixed column and keeps leader lines short.
      const dy = Math.max(-radius, Math.min(radius, y - cy));
      const dx = Math.sqrt(Math.max(0, radius * radius - dy * dy));
      const x = left ? cx - Math.max(dx, radius * 0.35) : cx + Math.max(dx, radius * 0.35);
      const elbow = polar(cx, cy, radius - 14, item.request.angle);
      placed.push({ key: item.request.key, x, y, anchorAngle: item.request.angle, left, elbow });
    });
  }
  return { placed, hidden };
}

/**
 * Spread sorted 1-D positions apart so neighbours are at least `gap` apart,
 * moving each as little as possible, and keep them within [min, max].
 */
export function spreadPositions(sorted: number[], gap: number, min: number, max: number): number[] {
  type Group = { start: number; count: number; sum: number; position: number };
  const groups: Group[] = [];
  sorted.forEach((value, index) => {
    groups.push({ start: index, count: 1, sum: value, position: value });
    // Merge while the newest group overlaps the one before it.
    while (groups.length > 1) {
      const last = groups[groups.length - 1], previous = groups[groups.length - 2];
      if (previous.position + previous.count * gap <= last.position) break;
      previous.count += last.count;
      previous.sum += last.sum;
      // Centre the merged block on the mean of its members' ideal positions.
      const meanOffset = ((previous.count - 1) * gap) / 2;
      previous.position = previous.sum / previous.count - meanOffset;
      groups.pop();
    }
  });
  const out: number[] = [];
  for (const group of groups) for (let index = 0; index < group.count; index += 1) out.push(group.position + index * gap);
  // Clamp into the frame from both ends while preserving spacing.
  for (let index = 0; index < out.length; index += 1) out[index] = Math.max(out[index], min + index * gap);
  for (let index = out.length - 1; index >= 0; index -= 1) out[index] = Math.min(out[index], max - (out.length - 1 - index) * gap);
  return out;
}

// ---------------------------------------------------------------------------
// Linear map geometry
// ---------------------------------------------------------------------------

/** A visible window of the sequence, in bases, for zooming and panning. */
export type Viewport = { from: number; to: number };

/** Zoom a viewport about a focus base, keeping that base under the pointer. */
export function zoomViewport(view: Viewport, factor: number, focus: number, length: number, minimumBases = 60): Viewport {
  const span = view.to - view.from;
  const next = Math.max(Math.min(length, minimumBases), Math.min(length, span * factor));
  const ratio = span > 0 ? (focus - view.from) / span : 0.5;
  let from = focus - next * ratio;
  from = Math.max(0, Math.min(length - next, from));
  return { from, to: from + next };
}

/** Pan a viewport by a number of bases, stopping at the ends. */
export function panViewport(view: Viewport, delta: number, length: number): Viewport {
  const span = view.to - view.from;
  const from = Math.max(0, Math.min(length - span, view.from + delta));
  return { from, to: from + span };
}

/** A tick spacing that gives roughly `target` ticks across a span: 1, 2, 5 × 10ⁿ. */
export function niceTickStep(span: number, target = 8): number {
  const raw = span / Math.max(1, target);
  const power = Math.pow(10, Math.floor(Math.log10(Math.max(1, raw))));
  for (const step of [1, 2, 5, 10]) if (raw <= step * power) return step * power;
  return 10 * power;
}

// ---------------------------------------------------------------------------
// Enzymes
// ---------------------------------------------------------------------------

export type CutSite = { enzyme: string; cut: number; recognitionSite: string; cutCount: number };

/**
 * Restriction sites as stored on a vector. The engine reports Biopython's
 * 1-based cut position; the cut falls between bases `position - 1` and `position`.
 */
export function cutSitesFromRecord(sites: Record<string, unknown>[], length: number): CutSite[] {
  const counts = new Map<string, number>();
  for (const site of sites) {
    const name = String(site.enzyme ?? site.name ?? "");
    counts.set(name, (counts.get(name) ?? 0) + 1);
  }
  return sites.map((site) => {
    const enzyme = String(site.enzyme ?? site.name ?? "");
    return {
      enzyme,
      cut: wrap(Number(site.position ?? 0) - 1, Math.max(1, length)),
      recognitionSite: String(site.recognitionSite ?? ""),
      cutCount: Number(site.cutCount ?? counts.get(enzyme) ?? 1),
    };
  }).filter((site) => site.enzyme);
}

/**
 * The span of the multiple cloning site, if the vector annotates one, or else
 * the tightest window holding the most unique cutters. Used for "flanks the MCS".
 */
export function locateMcs(features: MapFeature[], cuts: CutSite[], length: number): SeqRange | null {
  const annotated = features.find((feature) => /\bmcs\b|multiple cloning|polylinker/i.test(feature.name));
  if (annotated) return { start: annotated.start, end: annotated.end };
  const unique = cuts.filter((site) => site.cutCount === 1).map((site) => site.cut).sort((a, b) => a - b);
  if (unique.length < 3) return null;
  const window = Math.max(60, Math.min(250, Math.round(length * 0.05)));
  let best: SeqRange | null = null, bestCount = 0;
  for (let index = 0; index < unique.length; index += 1) {
    let count = 0, last = unique[index];
    for (let other = index; other < unique.length && unique[other] - unique[index] <= window; other += 1) { count += 1; last = unique[other]; }
    if (count > bestCount) { bestCount = count; best = { start: unique[index], end: last + 1 }; }
  }
  return bestCount >= 3 ? best : null;
}

/** Cut sites from the engine's enzyme-sets rows, which also use 1-based cut positions. */
export function cutSitesFromEnzymeRows(rows: { enzyme: string; recognitionSite: string; cutPositions: number[] }[], length: number): CutSite[] {
  return rows.flatMap((row) => row.cutPositions.map((position) => ({
    enzyme: row.enzyme,
    cut: wrap(position - 1, Math.max(1, length)),
    recognitionSite: row.recognitionSite,
    cutCount: row.cutPositions.length,
  })));
}
