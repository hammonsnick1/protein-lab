// Reads an expression construct that is already annotated in a saved vector
// (affinity tag, protease site and insert features) and works out the
// purification plan it implies:
//
//   affinity capture     the resin that matches the annotated tag
//   subtractive cleanup  the annotated protease, then a reverse pass on the
//                        same resin; the cleaved product flows through
//   SEC polishing        a column sized from the cleaved product's mass and
//                        oligomeric state, with a rough elution volume
//
// The construct layout is read from the annotation, never assumed: features
// are mapped onto the translated reading frame that encodes the target, and
// any residues between features (a linker, the GA after a TEV site) come from
// the DNA itself. Nothing here saves anything; the planner shows every change
// before it is applied and keeps a record of what it changed.
//
// Pure module: no runtime `@/` imports, so the tests load it directly.
import { cleanPeptide, cleavageSites, tagModules, type TagModule } from "./construct-catalog.ts";
import { affinityColumns, bufferPresets, cloneSteps, proteases, type AffinityColumn, type BufferStep } from "./purification-catalog.ts";
import { cleanupBuffers, secBuffers, type StageBuffer } from "./purification-stage-catalog.ts";
import { PI_WARN_DISTANCE, pIDistanceLevel } from "./pi-distance.ts";
import { secColumns, type SecColumn } from "./sec-column-catalog.ts";
import { loadStageBufferStep, presetBufferStep, stepPH } from "./stage-buffer.ts";
import { reverseComplement, translate } from "./vector-geometry.ts";
import type { JsonObject } from "./protein-labs-api.ts";

export type ConstructPart = {
  kind: "tag" | "site" | "target" | "other" | "gap";
  label: string;
  sequence: string;
  /** Residue range in the expressed polypeptide, zero-based and half-open. */
  start: number;
  end: number;
};

export type AnnotatedConstruct = {
  vectorId: string;
  vectorName: string;
  /** The insert feature's name, or the protein's name when the insert is not annotated. */
  constructName: string;
  tag: TagModule;
  tagFeature: string;
  terminus: "N" | "C";
  proteaseId: string | null;
  siteFeature: string;
  siteEvidence: string;
  parts: ConstructPart[];
  /** The parts in order, e.g. "M – 6xHis – DYDIPTT – TEV site – GA – POI". */
  layout: string;
  fusion: string;
  cleaved: string;
  released: string;
  /** Residues the cut leaves on the target beyond the protein's own sequence. */
  scar: string;
  cleaves: boolean;
  warnings: string[];
};

export type ProductMetrics = { lengthAa: number; massDa: number; pI: number; extinctionReduced: number };
export type StageId = "affinity" | "cleavage" | "subtractive" | "sec";
export type PlanChange = { stage: StageId; label: string; before: string; after: string; changed: boolean; detail: string };
export type SavedPlan = Record<StageId, JsonObject>;
export type ConstructUpdate = {
  construct: AnnotatedConstruct;
  changes: PlanChange[];
  /** Complete job configs to save, keyed by stage; a stage is absent when it is left alone. */
  configs: Partial<Record<StageId, JsonObject>>;
  /** Steps to merge into the shared purification-buffer record. */
  bufferSteps: Record<string, BufferStep>;
  /** The notice saved on every updated job, so the planner can say what was done. */
  record: JsonObject;
  summary: string;
};

export const appTypes: Record<StageId, string> = {
  affinity: "purification-affinity",
  cleavage: "purification-cleavage",
  subtractive: "purification-subtractive",
  sec: "purification-sec",
};
export const stageLabels: Record<StageId, string> = { affinity: "Affinity capture", cleavage: "Tag cleavage", subtractive: "Subtractive cleanup", sec: "SEC polishing" };

/** The capture resin for each tag module; tags without one cannot drive affinity capture. */
const captureColumnForTag: Record<string, string> = {
  his6: "his-ni", his8: "his-ni", his10: "his-ni", hat: "hat-ni",
  strep2: "strep-ii", "twin-strep": "twin-strep-xt", avitag: "avitag-streptavidin",
  flag: "flag", flag3: "flag", ha: "ha", myc: "myc", v5: "v5", "s-tag": "s-tag", "t7-tag": "t7-tag", alfa: "alfa",
  cbp: "cbp", "protein-c": "protein-c", rho1d4: "rho1d4",
  gst: "gst", mbp: "mbp-amylose", halotag: "halotag", snap: "snap-tag",
  "protein-a": "protein-a", "protein-g": "protein-g", fc: "fc-protein-a", "cbd-intein": "cbd-intein",
};
/** Feature names SnapGene and Addgene use that the tag catalogue does not list. */
const extraTagAliases: Record<string, string[]> = { mbp: ["male"], gst: ["glutathione s-transferase"], his6: ["6xhis tag", "his-tag", "his tag"] };
/** Protease-site feature names. SUMO is listed because Ulp1 recognizes the folded SUMO domain itself. */
const sitePatterns: [string, RegExp][] = [
  ["tvmv", /\btvmv\b/],
  ["tev", /\btev\b|tobacco etch/],
  ["hrv-3c", /\b3c\b|prescission|\bhrv\b/],
  ["thrombin", /thrombin/],
  ["factor-xa", /factor ?xa|\bf ?xa\b/],
  ["enterokinase", /enterokinase|\bek\b/],
  ["ulp1", /\bsumo\b|\bsmt3\b|\bulp1\b/],
];
/** Proteases commonly supplied with an affinity handle, so the reverse pass removes them too. */
const proteaseHandles: Record<string, string[]> = { tev: ["his"], "hrv-3c": ["gst", "his"], ulp1: ["his"], tvmv: ["his"], dub: ["his"] };

type Feature = { name: string; text: string; start: number; end: number; strand: 1 | -1; isInsert: boolean };

function readFeatures(vector: JsonObject): Feature[] {
  const raw = Array.isArray(vector.features) ? vector.features : [];
  return raw.flatMap((item) => {
    if (!item || typeof item !== "object" || Array.isArray(item)) return [];
    const feature = item as JsonObject;
    const start = Number(feature.start), end = Number(feature.end);
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return [];
    const name = String(feature.name ?? feature.label ?? "").trim();
    // Notes are left out: a TEV site's note that it "removes the His tag" must not make it a His tag.
    const text = `${feature.name ?? ""} ${feature.label ?? ""}`.toLowerCase();
    return [{ name, text, start, end, strand: Number(feature.strand) < 0 ? -1 : 1, isInsert: feature.isInsert === true } as Feature];
  });
}

function aliasIn(text: string, alias: string) {
  const escaped = alias.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}([^a-z0-9]|$)`).test(text);
}

/** The tag module a feature name names, preferring the most specific alias ("twin-strep" over "strep"). */
export function tagForFeatureName(text: string): TagModule | null {
  const lower = text.toLowerCase();
  let best: { tag: TagModule; weight: number } | null = null;
  for (const tag of tagModules) {
    for (const alias of [...tag.aliases, ...(extraTagAliases[tag.id] ?? [])]) {
      if (aliasIn(lower, alias) && (!best || alias.length > best.weight)) best = { tag, weight: alias.length };
    }
  }
  return best?.tag ?? null;
}

export function proteaseForFeatureName(text: string): string | null {
  const lower = text.toLowerCase();
  return sitePatterns.find(([, pattern]) => pattern.test(lower))?.[0] ?? null;
}

/** The residues before the cut for each linear protease site. */
function siteMotifs(proteaseId: string): string[] {
  if (proteaseId === "factor-xa") return ["IEGR", "IDGR"];
  const site = cleavageSites.find((value) => value.id === proteaseId);
  return site && site.site && !site.foldedDomain ? [site.site.slice(0, site.cutAfter)] : [];
}

type Frame = { aa: string; strand: 1 | -1; frame: number; targetAt: number; targetLength: number };

/** The strand and frame whose translation contains the target protein. */
function locateTarget(dna: string, target: string): Frame | null {
  const variants = target.startsWith("M") && target.length > 1 ? [target, target.slice(1)] : [target];
  for (const strand of [1, -1] as const) {
    const oriented = strand > 0 ? dna : reverseComplement(dna);
    for (const frame of [0, 1, 2]) {
      const aa = translate(oriented.slice(frame));
      for (const variant of variants) {
        const at = aa.indexOf(variant);
        if (at >= 0) return { aa, strand, frame, targetAt: at, targetLength: variant.length };
      }
    }
  }
  return null;
}

/**
 * The construct annotated in one vector, or null when the vector does not
 * encode the target or carries no affinity tag the catalogue can capture.
 */
export function readAnnotatedConstruct(vector: JsonObject, targetSequence: string, proteinName = "Target protein"): AnnotatedConstruct | null {
  const target = cleanPeptide(targetSequence);
  const dna = String(vector.sequence ?? "").toUpperCase().replace(/[^ACGTN]/g, "");
  if (target.length < 10 || dna.length < target.length * 3) return null;
  const located = locateTarget(dna, target);
  if (!located) return null;
  const { aa, strand, frame, targetAt, targetLength } = located;
  const targetEnd = targetAt + targetLength;
  const regionStart = aa.lastIndexOf("*", targetAt - 1) + 1;
  const stop = aa.indexOf("*", targetEnd);
  const regionEnd = stop < 0 ? aa.length : stop;

  // Features on the coding strand, in residue coordinates of this frame.
  const length = dna.length;
  const mapped = readFeatures(vector).filter((feature) => feature.strand === strand).map((feature) => {
    const from = strand > 0 ? feature.start : length - feature.end;
    const to = strand > 0 ? feature.end : length - feature.start;
    return { ...feature, from: Math.floor((from - frame) / 3), to: Math.ceil((to - frame) / 3) };
  }).filter((feature) => feature.to > regionStart && feature.from < regionEnd);
  const insert = mapped.find((feature) => feature.isInsert || (feature.from <= targetAt + 2 && feature.to >= targetEnd - 2 && feature.to - feature.from <= targetLength + 4));
  // Pieces: tags and sites by name, everything else that sits clear of the target.
  const pieces = mapped.filter((feature) => feature !== insert && (feature.to <= targetAt || feature.from >= targetEnd)).map((feature) => {
    const proteaseId = proteaseForFeatureName(feature.text);
    const tag = proteaseId ? null : tagForFeatureName(feature.text);
    return { ...feature, proteaseId, tag };
  }).sort((left, right) => left.from - right.from);

  // The polypeptide starts at the Met nearest upstream of the first tag or site,
  // so a stray in-frame ATG further up the 5′ UTR is not taken as the start.
  const firstPiece = pieces.find((piece) => piece.from < targetAt && (piece.tag || piece.proteaseId));
  const anchor = Math.max(regionStart, Math.min(firstPiece?.from ?? targetAt, targetAt));
  const nearMet = aa.lastIndexOf("M", anchor), firstMet = aa.indexOf("M", regionStart);
  const orfStart = nearMet >= regionStart ? nearMet : firstMet >= 0 && firstMet <= targetAt ? firstMet : regionStart;
  const fusion = aa.slice(orfStart, regionEnd);
  const shift = (value: number) => Math.max(0, Math.min(fusion.length, value - orfStart));
  const t0 = shift(targetAt), t1 = shift(targetEnd);

  // Pieces inside the expressed polypeptide; operators and RBS features upstream of the start drop out.
  const placed = pieces.filter((piece) => piece.from >= orfStart - 1 && piece.to <= regionEnd + 1).map((piece) => ({ ...piece, from: shift(piece.from), to: shift(piece.to) })).filter((piece) => piece.to > piece.from);
  const capturable = placed.filter((piece) => piece.tag && captureColumnForTag[piece.tag.id]);
  if (!capturable.length) return null;
  const warnings: string[] = [];

  // The protease: an annotated site, preferring one between a tag and the target.
  const sites = placed.filter((piece) => piece.proteaseId);
  const site = sites.find((piece) => piece.to <= t0) ?? sites.find((piece) => piece.from >= t1) ?? null;
  let cut: number | null = null;
  let motifUsed = "";
  if (site?.proteaseId === "ulp1") {
    cut = site.to <= t0 ? site.to : site.from;
    motifUsed = "the folded SUMO domain";
  } else if (site?.proteaseId) {
    for (const motif of siteMotifs(site.proteaseId)) {
      const windowStart = Math.max(0, site.from - 4);
      const near = fusion.indexOf(motif, windowStart);
      const hit = near >= 0 && near <= site.to + 4 ? near : -1;
      if (hit >= 0) { cut = hit + motif.length; motifUsed = motif; break; }
    }
    if (cut === null) warnings.push(`${site.name} is annotated as a ${proteaseName(site.proteaseId)} site, but its recognition motif is not in the translated construct there; the cleaved product was not calculated.`);
  }
  const proteaseId = cut === null ? null : site?.proteaseId ?? null;
  const nTerminalCut = cut !== null && cut <= t0;

  // Capture tag: one the protease removes, outermost first; otherwise the outermost tag.
  const removed = cut === null ? [] : capturable.filter((piece) => (nTerminalCut ? piece.to <= cut! : piece.from >= cut!));
  const pool = removed.length ? removed : capturable;
  const tagPiece = pool.reduce((best, piece) => {
    const nPiece = piece.to <= t0, nBest = best.to <= t0;
    if (nPiece !== nBest) return nPiece ? piece : best;
    return nPiece ? (piece.from < best.from ? piece : best) : (piece.to > best.to ? piece : best);
  });
  const terminus = tagPiece.to <= t0 ? "N" : "C";

  const cleaves = cut !== null;
  const cleaved = !cleaves ? fusion : nTerminalCut ? fusion.slice(cut!) : fusion.slice(0, cut!);
  const released = !cleaves ? "" : nTerminalCut ? fusion.slice(0, cut!) : fusion.slice(cut!);
  const scar = !cleaves ? "" : nTerminalCut ? fusion.slice(cut!, t0) : fusion.slice(t1, cut!);
  if (cleaves && motifUsed && !motifUsed.includes(" ") && target.includes(motifUsed)) warnings.push(`The target itself contains ${motifUsed}; ${proteaseName(proteaseId!)} may also cut inside the protein.`);

  // Every residue in order: annotated pieces, the target, and unannotated stretches by sequence.
  const constructName = insert?.name || proteinName;
  const parts: ConstructPart[] = [];
  let cursor = 0;
  const gap = (until: number) => {
    if (until > cursor) parts.push({ kind: "gap", label: residues(fusion.slice(cursor, until)), sequence: fusion.slice(cursor, until), start: cursor, end: until });
    cursor = Math.max(cursor, until);
  };
  for (const piece of [...placed, { name: constructName, from: t0, to: t1, tag: null, proteaseId: null, target: true }].sort((left, right) => left.from - right.from)) {
    if (piece.from < cursor) continue;
    gap(piece.from);
    const kind = "target" in piece ? "target" : piece.proteaseId ? "site" : piece.tag ? "tag" : "other";
    parts.push({ kind, label: piece.name || (kind === "target" ? "Target" : "Feature"), sequence: fusion.slice(piece.from, piece.to), start: piece.from, end: piece.to });
    cursor = piece.to;
  }
  gap(fusion.length);

  const vectorName = String(vector.name ?? "Untitled vector");
  const bp = (piece: { from: number; to: number }) => {
    const ntFrom = (orfStart + piece.from) * 3 + frame, ntTo = (orfStart + piece.to) * 3 + frame;
    const [start, end] = strand > 0 ? [ntFrom, ntTo] : [length - ntTo, length - ntFrom];
    return `bp ${start + 1}–${end}`;
  };
  const siteEvidence = site && proteaseId
    ? `${site.name} annotated at ${bp(site)} of ${vectorName}; ${proteaseId === "ulp1" ? "Ulp1 cuts after the folded SUMO domain" : `${motifUsed}↓${fusion[cut!] ?? ""} is cut`}, leaving ${scar ? scar : "no extra residues"} on the product.`
    : "";

  return {
    vectorId: String(vector.id ?? ""),
    vectorName,
    constructName,
    tag: tagPiece.tag!,
    tagFeature: tagPiece.name,
    terminus,
    proteaseId,
    siteFeature: site && proteaseId ? site.name : "",
    siteEvidence,
    parts,
    layout: parts.map((part) => part.label).join(" – "),
    fusion,
    cleaved,
    released,
    scar,
    cleaves,
    warnings,
  };
}

function residues(sequence: string) { return sequence.length <= 12 ? sequence : `${sequence.length} aa`; }
function proteaseName(id: string) { return proteases.find((value) => value.id === id)?.name ?? id; }

/** The first saved vector that carries an annotated construct for the target. */
export function findAnnotatedConstruct(vectors: JsonObject[], targetSequence: string, proteinName?: string): AnnotatedConstruct | null {
  for (const vector of vectors) {
    const construct = readAnnotatedConstruct(vector, targetSequence, proteinName);
    if (construct) return construct;
  }
  return null;
}

/** Whether a resin captures the tag: the same tag module, or the same polyhistidine family. */
function capturesTag(column: AffinityColumn | undefined, tag: TagModule) {
  if (!column) return false;
  const wanted = captureColumnForTag[tag.id];
  if (column.id === wanted) return true;
  const his = (id: string) => ["his-ni", "his-co", "his-excel"].includes(id);
  return his(column.id) && his(wanted);
}

/**
 * A SEC column for the expected native mass. The saved column is kept when
 * the mass sits comfortably inside its range; otherwise the narrowest range
 * that does is chosen from columns of the same bed size (10/300 by default).
 */
export function chooseSecColumn(massKDa: number, saved?: SecColumn | null): SecColumn {
  const inRange = (column: SecColumn) => column.minKDa !== null && column.maxKDa !== null && massKDa >= column.minKDa && massKDa <= column.maxKDa;
  const comfortable = (column: SecColumn) => {
    if (!inRange(column)) return false;
    const relative = (massKDa - column.minKDa!) / (column.maxKDa! - column.minKDa!);
    return relative >= .08 && relative <= .92;
  };
  if (saved && saved.id !== "custom" && comfortable(saved)) return saved;
  const bed = saved && saved.id !== "custom" ? saved.vt : 24;
  const pool = secColumns.filter((column) => column.id !== "custom" && column.vt === bed);
  const narrowest = (columns: SecColumn[]) => [...columns].sort((left, right) => left.maxKDa! / left.minKDa! - right.maxKDa! / right.minKDa!)[0];
  return narrowest(pool.filter(comfortable)) ?? narrowest(pool.filter(inRange)) ?? narrowest(secColumns.filter((column) => column.id !== "custom" && comfortable(column))) ?? saved ?? secColumns.find((column) => column.id === "s200-10-300")!;
}

/**
 * A rough elution volume from the column's fractionation range: Kav falls
 * linearly with log mass from 1 at the lower limit to 0 at the upper limit,
 * with the void volume taken as a third of Vt. A calibration run in
 * Chromatogram Studio replaces this.
 */
export function expectedElutionMl(column: SecColumn, massKDa: number): number | null {
  if (column.minKDa === null || column.maxKDa === null || !(massKDa > 0)) return null;
  const kav = Math.min(1, Math.max(0, (Math.log10(column.maxKDa) - Math.log10(massKDa)) / (Math.log10(column.maxKDa) - Math.log10(column.minKDa))));
  const v0 = column.vt / 3;
  const ve = v0 + kav * (column.vt - v0);
  return column.vt >= 50 ? Math.round(ve) : Math.round(ve * 10) / 10;
}

/** A buffer pH at least one unit from the pI (the warning line in pi-distance), moved as little as possible; IMAC binding stays at pH 7 or above. */
export function pHAwayFromPI(pH: number | null, pI: number | null, floor = 6): number | null {
  if (pH === null || pI === null || !Number.isFinite(pI) || pIDistanceLevel(pH, pI) === "pass") return null;
  // toFixed first: (7.3 + .5) * 10 is 78.00000000000001, which would ceil to 7.9.
  const tenths = (value: number) => Number((value * 10).toFixed(6));
  const up = Math.ceil(tenths(pI + PI_WARN_DISTANCE)) / 10, down = Math.floor(tenths(pI - PI_WARN_DISTANCE)) / 10;
  const options = [up, down].filter((value) => value >= floor && value <= 9).sort((left, right) => Math.abs(left - pH) - Math.abs(right - pH));
  return options[0] ?? null;
}

function presetSteps(presetId: string): Record<string, BufferStep> {
  const preset = bufferPresets.find((value) => value.id === presetId) ?? bufferPresets[1];
  const steps = cloneSteps(preset.steps);
  return Object.fromEntries(["binding", "wash", "elution"].filter((id) => steps[id]).map((id) => [id, steps[id]]));
}
function bufferFields(buffer: StageBuffer, step: BufferStep, edited: boolean): JsonObject {
  return { bufferId: buffer.id, bufferName: buffer.name, bufferPH: stepPH(step) ?? step.pH, bufferComponents: step.components, bufferStep: step, bufferEdited: edited, bufferDescription: buffer.description, bufferPros: buffer.pros, bufferCons: buffer.cons };
}
function kDa(massDa: number) { return Math.round(massDa / 100) / 10; }
const reviewCheck = [{ level: "warning", title: "Updated from the construct annotation", detail: "Open this job and save it to re-run its compatibility checks against the new choices." }];

/**
 * The purification plan the annotated construct implies, compared with what
 * is saved. `products` are the engine's ProtParam results for the fusion and
 * the cleaved product; without them the mass is estimated from length.
 */
export function planFromConstruct(
  construct: AnnotatedConstruct,
  products: { fusion: ProductMetrics | null; cleaved: ProductMetrics | null },
  saved: SavedPlan,
  options: { subunits: number | null; appliedAt: string },
): ConstructUpdate {
  const changes: PlanChange[] = [];
  const configs: Partial<Record<StageId, JsonObject>> = {};
  const bufferSteps: Record<string, BufferStep> = {};
  const { tag } = construct;
  const product = construct.cleaves ? products.cleaved : products.fusion;
  const massDa = product?.massDa && product.massDa > 0 ? product.massDa : construct.cleaved.length * 110 + 18;
  const approximate = !(product?.massDa && product.massDa > 0);
  const pI = product?.pI && product.pI > 0 ? product.pI : null;
  const productText = `${approximate ? "≈" : ""}${kDa(massDa)} kDa${pI !== null ? `, pI ${pI.toFixed(2)}` : ""}`;
  const productLabel = construct.cleaves ? "cleaved product" : "fusion protein";

  // Affinity capture: the resin for the annotated tag, unless the saved one already captures it.
  const savedColumn = affinityColumns.find((column) => column.id === String(saved.affinity.columnId ?? ""));
  const keepColumn = capturesTag(savedColumn, tag);
  const column = keepColumn ? savedColumn! : affinityColumns.find((value) => value.id === captureColumnForTag[tag.id])!;
  changes.push({
    stage: "affinity", label: stageLabels.affinity,
    before: savedColumn ? `${savedColumn.name} (${savedColumn.tag})` : "Not chosen",
    after: `${column.name} for ${construct.tagFeature}`,
    changed: !keepColumn,
    detail: keepColumn ? `${column.shortName} already captures the annotated ${construct.tagFeature}.` : `The construct carries ${construct.tagFeature} (${tag.name}), which ${column.shortName} captures.`,
  });

  // Tag cleavage: the annotated protease and the scar it leaves.
  const protease = construct.proteaseId ? proteases.find((value) => value.id === construct.proteaseId) : proteases.find((value) => value.id === "retain");
  const savedProteaseId = String(saved.cleavage.proteaseId ?? "");
  const proteaseId = protease?.id ?? "retain";
  changes.push({
    stage: "cleavage", label: stageLabels.cleavage,
    before: savedProteaseId ? String(saved.cleavage.proteaseName ?? savedProteaseId) : "Not chosen",
    after: construct.proteaseId ? `${protease!.name}${construct.scar ? `, leaving ${construct.scar}` : ""}` : "Keep the tag (no protease site annotated)",
    changed: savedProteaseId !== proteaseId,
    detail: construct.proteaseId ? construct.siteEvidence : "The construct has no annotated protease site, so the tag stays on the purified protein.",
  });

  // Subtractive cleanup: a reverse pass on the capture resin collects the cleaved product.
  const handles = proteaseHandles[proteaseId] ?? [];
  const handle = /his|hat/i.test(column.tag) ? "his" : /gst/i.test(column.tag) ? "gst" : "";
  const proteaseRemoved = handles.includes(handle);
  let subtractiveAfter = "";
  if (construct.proteaseId) {
    const savedSubtractive = affinityColumns.find((value) => value.id === String(saved.subtractive.columnId ?? ""));
    const sameResin = String(saved.subtractive.columnId ?? "") === column.id;
    const preset = handle === "his" ? cleanupBuffers.find((value) => value.id === "cleanup-imac")! : /calcium|protein c/i.test(`${column.tag} ${column.binding}`) ? cleanupBuffers.find((value) => value.id === "cleanup-calcium")! : cleanupBuffers.find((value) => value.id === "cleanup-neutral")!;
    const savedPreset = cleanupBuffers.find((value) => value.id === saved.subtractive.bufferId);
    const startStep = sameResin && (saved.subtractive.bufferStep || saved.subtractive.bufferComponents) ? loadStageBufferStep(saved.subtractive, cleanupBuffers, preset.id, "Cleavage") : presetBufferStep(preset, "Cleavage");
    const pH = pHAwayFromPI(stepPH(startStep), pI, handle === "his" ? 7 : 6);
    const step = pH === null ? startStep : { ...startStep, pH: String(pH) };
    const buffer = sameResin && savedPreset ? savedPreset : preset;
    const removed = [`the released ${construct.tagFeature}`, "the uncleaved fusion", proteaseRemoved ? `the ${handle === "his" ? "His" : "GST"}-tagged ${protease!.name}` : ""].filter(Boolean);
    const removes = `${removed.slice(0, -1).join(", ")} and ${removed[removed.length - 1]}`;
    subtractiveAfter = `${protease!.name}, then reverse ${column.shortName}`;
    const before = savedSubtractive ? `${String(saved.subtractive.proteaseName ?? saved.cleavage.proteaseName ?? "No protease")}, then reverse ${savedSubtractive.shortName}` : "Not chosen";
    changes.push({
      stage: "subtractive", label: stageLabels.subtractive, before, after: subtractiveAfter,
      changed: !sameResin || String(saved.subtractive.proteaseId ?? "") !== proteaseId || pH !== null,
      detail: `Cleave with ${protease!.name}, then pass the digest over ${column.shortName} again: ${removes} bind${proteaseRemoved ? "" : `; remove ${protease!.name} separately (${protease!.removal.replace(/\.$/, "")})`}. Collect the ${productLabel} (${productText}) in the flow-through.${pH !== null ? ` Buffer pH moved to ${pH} to stay clear of pI ${pI!.toFixed(2)}.` : ""}`,
    });
    configs.subtractive = {
      ...saved.subtractive, ...bufferFields(buffer, step, pH !== null || buffer.id !== preset.id),
      compatibilityChecks: reviewCheck, compatibilityStatus: "review", savedByUser: true, guidanceOnly: true, savedAt: options.appliedAt,
      proteaseId, proteaseName: protease!.name, columnId: column.id, columnName: column.name, shortName: column.shortName, tag: column.tag, category: column.category, ligand: column.ligand, binding: column.binding, wash: column.wash, elution: column.elution, strengths: column.strengths, cautions: column.cautions, reference: column.reference,
      collect: "flow-through", removes, targetProduct: { sequence: construct.cleaved, massDa, pI, approximate },
    };
    bufferSteps.cleavage = step;
  } else {
    changes.push({ stage: "subtractive", label: stageLabels.subtractive, before: saved.subtractive.columnId ? String(saved.subtractive.columnName ?? saved.subtractive.columnId) : "Not chosen", after: saved.subtractive.columnId ? "Unchanged" : "Not needed", changed: false, detail: "No protease site is annotated, so there is no cleaved tag to subtract." });
  }

  // SEC polishing: the cleaved product times the oligomeric state.
  const subunits = options.subunits && options.subunits > 1 ? options.subunits : 1;
  const nativeKDa = Math.round(massDa * subunits / 100) / 10;
  const savedSec = secColumns.find((value) => value.id === String(saved.sec.columnId ?? "")) ?? null;
  const sec = chooseSecColumn(nativeKDa, savedSec);
  const elution = expectedElutionMl(sec, nativeKDa);
  const secStart = loadStageBufferStep(saved.sec, secBuffers, "sec-hepes", "SEC / storage");
  const secPH = pHAwayFromPI(stepPH(secStart), pI);
  const secStep = secPH === null ? secStart : { ...secStart, pH: String(secPH) };
  const secBuffer = secBuffers.find((value) => value.id === saved.sec.bufferId) ?? secBuffers[0];
  const sizeText = subunits > 1 ? `${nativeKDa} kDa (${subunits} × ${kDa(massDa)} kDa)` : `${nativeKDa} kDa`;
  const secAfter = `${sec.shortName}, ${sizeText}${elution !== null ? `, elutes near ${elution} mL` : ""}`;
  const sampleVolume = Math.min(Number(saved.sec.sampleVolumeMl ?? .25) || .25, sec.sampleMaxMl ?? Infinity);
  changes.push({
    stage: "sec", label: stageLabels.sec,
    before: savedSec ? `${savedSec.shortName}${saved.sec.expectedMassKDa ? `, ${saved.sec.expectedMassKDa} kDa` : ""}` : "Not chosen",
    after: secAfter,
    changed: savedSec?.id !== sec.id || Number(saved.sec.expectedMassKDa) !== nativeKDa || secPH !== null,
    detail: `Sized from the ${productLabel} (${productText})${subunits > 1 ? ` as a ${subunits}-subunit assembly` : ""}; ${sec.minKDa}–${sec.maxKDa} kDa range. The elution volume is a rough estimate from the column range (Vo taken as a third of Vt); calibrate in Chromatogram Studio.${secPH !== null ? ` Buffer pH moved to ${secPH} to stay clear of pI ${pI!.toFixed(2)}.` : ""}`,
  });
  configs.sec = {
    ...saved.sec, ...bufferFields(secBuffer, secStep, Boolean(saved.sec.bufferEdited) || secPH !== null),
    compatibilityChecks: reviewCheck, compatibilityStatus: "review", savedByUser: true, guidanceOnly: true, savedAt: options.appliedAt,
    columnId: sec.id, columnName: sec.name, shortName: sec.shortName, format: sec.format, vt: sec.vt, minKDa: sec.minKDa, maxKDa: sec.maxKDa,
    sampleVolumeMl: sampleVolume, expectedMassKDa: nativeKDa, expectedElutionMl: elution, subunits, recommendedFlowMlMin: sec.recommendedFlowMlMin,
    description: sec.description, bestFor: sec.bestFor, strengths: sec.strengths, cautions: sec.cautions, reference: sec.reference,
  };
  bufferSteps.storage = secStep;

  // The construct as later jobs and the report read it.
  const metrics = (value: ProductMetrics | null) => value ? { lengthAa: value.lengthAa, massDa: value.massDa, pI: value.pI, extinctionReduced: value.extinctionReduced } : null;
  const cutAt = construct.cleaves ? (construct.terminus === "N" ? construct.fusion.length - construct.cleaved.length : construct.cleaved.length) : 0;
  const summary: JsonObject = {
    source: "vector-annotation", vectorId: construct.vectorId, vectorName: construct.vectorName, constructName: construct.constructName, layout: construct.layout,
    terminus: construct.terminus, tagId: tag.id, tagName: construct.tagFeature, cleavageId: proteaseId, cleaves: construct.cleaves, scar: construct.scar,
    fusionSequence: construct.fusion, cleavedSequence: construct.cleaved, releasedSequence: construct.released,
    segments: construct.parts.map((part) => ({ label: part.label, kind: part.kind, sequence: part.sequence, start: part.start, end: part.end, retained: !construct.cleaves || (construct.terminus === "N" ? part.start >= cutAt : part.end <= cutAt) })),
    warnings: construct.warnings,
    fusionProperties: metrics(products.fusion), cleavedProperties: construct.cleaves ? metrics(products.cleaved) : null, releasedProperties: null,
    fusionLength: construct.fusion.length, fusionMassDa: products.fusion?.massDa ?? null, fusionExtinction: products.fusion?.extinctionReduced ?? null,
    ...(construct.cleaves ? { cleavedLength: construct.cleaved.length, cleavedMassDa: products.cleaved?.massDa ?? null, cleavedExtinction: products.cleaved?.extinctionReduced ?? null } : {}),
  };
  const constructPlan = { ...(saved.affinity.constructPlan as JsonObject | undefined ?? {}), terminus: construct.terminus, tagId: tag.id, cleavageId: proteaseId };

  configs.affinity = keepColumn
    ? { ...saved.affinity, constructPlan, construct: summary }
    : {
      ...saved.affinity, columnId: column.id, columnName: column.name, shortName: column.shortName, tag: column.tag, category: column.category, ligand: column.ligand, binding: column.binding, wash: column.wash, elution: column.elution, bestFor: column.bestFor, strengths: column.strengths, cautions: column.cautions,
      presetId: column.presetId, bufferPresetId: column.presetId, buffers: presetSteps(column.presetId), reference: column.reference,
      compatibilityChecks: reviewCheck, compatibilityStatus: "review", constructPlan, construct: summary, savedByUser: true,
    };
  if (!keepColumn) Object.assign(bufferSteps, presetSteps(column.presetId));
  configs.cleavage = {
    ...saved.cleavage, proteaseId, proteaseName: protease?.name ?? "Retain the affinity tag", category: protease?.category, recognition: protease?.recognition, enzymeClass: protease?.enzymeClass,
    conditions: protease?.conditions, siteEvidence: construct.siteEvidence, removal: protease?.removal, cautions: protease?.cautions, reference: protease?.reference,
    constructPlan, construct: summary, savedByUser: true,
  };

  const afterFor = (stage: StageId) => changes.find((change) => change.stage === stage)!.after;
  const text = `Updated from construct ${construct.constructName} in vector ${construct.vectorName}: affinity capture → ${column.name}; subtractive cleanup → ${construct.proteaseId ? subtractiveAfter : "not needed, the tag is kept"}; SEC → ${afterFor("sec")}.`;
  const record: JsonObject = {
    vectorId: construct.vectorId, vectorName: construct.vectorName, constructName: construct.constructName, layout: construct.layout,
    appliedAt: options.appliedAt, summary: text, changes: changes.map((change) => ({ ...change })), product: { sequence: construct.cleaved, massDa, pI, approximate, scar: construct.scar },
  };
  for (const stage of Object.keys(configs) as StageId[]) configs[stage] = { ...configs[stage], updatedFromConstruct: record };
  return { construct, changes, configs, bufferSteps, record, summary: text };
}

/** The most recent construct update saved on any purification job, if there is one. */
export function savedConstructUpdate(saved: Partial<SavedPlan>): JsonObject | null {
  const records = Object.values(saved).map((config) => config?.updatedFromConstruct).filter((value): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value));
  return records.sort((left, right) => String(right.appliedAt ?? "").localeCompare(String(left.appliedAt ?? "")))[0] ?? null;
}
