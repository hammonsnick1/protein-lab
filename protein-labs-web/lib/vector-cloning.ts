// Client-side preview of placing an insert into a backbone, mirroring the
// engine's insert_target_sequence so the product shown before commit is the
// product the engine will save. Pure, so it is unit-tested directly.
import { reverseComplement, translate } from "./vector-geometry.ts";

export type PreviewFeature = { id: string; name: string; type: string; start: number; end: number; strand: number; color?: string; customColor?: boolean; automatic?: boolean };
export type PreviewSite = { start: number; end: number; strand: number; replaceRegion: boolean; frame: { inFrame: boolean; offset: number; padding: number; referenceName: string } | null };
export type PreviewWarning = { level: "error" | "warning" | "info"; message: string };
export type InsertPreview = {
  sequence: string;
  features: PreviewFeature[];
  insertRange: { start: number; end: number };
  paddingBases: number;
  lostFeatures: string[];
  translation: string;
  warnings: PreviewWarning[];
};

export function previewInsert(
  backbone: { sequence: string; features: PreviewFeature[] },
  site: PreviewSite,
  insertDna: string,
  options: { keepFrame: boolean; name: string },
): InsertPreview {
  const sequence = backbone.sequence;
  const fragment = insertDna.toUpperCase().replace(/[^ACGTN]/g, "");
  const start = Math.max(0, Math.min(site.start, sequence.length));
  const stop = Math.max(start, Math.min(site.replaceRegion ? site.end : site.start, sequence.length));
  const padding = options.keepFrame && site.frame && !site.frame.inFrame ? "G".repeat(site.frame.padding) : "";
  const forward = site.strand >= 0;
  const oriented = forward ? fragment : reverseComplement(fragment);
  const insert = forward ? padding + oriented : oriented + padding;
  const delta = insert.length - (stop - start);

  const kept: PreviewFeature[] = [];
  const lostFeatures: string[] = [];
  for (const feature of backbone.features) {
    if (feature.end <= start) kept.push(feature);
    else if (feature.start >= stop) kept.push({ ...feature, start: feature.start + delta, end: feature.end + delta });
    else lostFeatures.push(feature.name);
  }
  const insertFeature: PreviewFeature = { id: "preview-insert", name: options.name, type: "CDS", start, end: start + insert.length, strand: forward ? 1 : -1 };
  const features = [...kept, insertFeature].sort((a, b) => a.start - b.start || a.end - b.end);

  const translation = translate(oriented.slice(0, Math.floor(oriented.length / 3) * 3));
  const warnings: PreviewWarning[] = [];
  if (!fragment) warnings.push({ level: "error", message: "The insert has no DNA sequence." });
  if (fragment.length % 3) warnings.push({ level: "warning", message: `The insert is ${fragment.length} bp, not a whole number of codons.` });
  const internalStops = [...translation.slice(0, -1)].flatMap((residue, index) => residue === "*" ? [index + 1] : []);
  if (internalStops.length) warnings.push({ level: "error", message: `Internal stop codon at residue ${internalStops.join(", ")}.` });
  if (fragment && translation[0] !== "M") warnings.push({ level: "info", message: "The insert does not start with Met; fine for a fusion, not for a standalone ORF." });
  if (site.frame && !site.frame.inFrame && !padding) warnings.push({ level: "error", message: `${site.frame.offset} nt out of frame with ${site.frame.referenceName}; the fusion will not translate.` });
  if (padding) warnings.push({ level: "info", message: `${padding.length} G base${padding.length === 1 ? "" : "s"} added to restore the frame with ${site.frame?.referenceName}.` });
  if (!site.frame) warnings.push({ level: "info", message: "No upstream reading frame was found to check the junction against." });
  if (lostFeatures.length) warnings.push({ level: "warning", message: `Replaced backbone feature${lostFeatures.length === 1 ? "" : "s"}: ${lostFeatures.join(", ")}.` });

  return {
    sequence: sequence.slice(0, start) + insert + sequence.slice(stop),
    features,
    insertRange: { start, end: start + insert.length },
    paddingBases: padding.length,
    lostFeatures,
    translation,
    warnings,
  };
}

/** Sites that describe the same cut, keeping the most specific label. */
export function dedupeSites<T extends { start: number; end: number; strand: number; replaceRegion: boolean; label: string }>(sites: T[]): T[] {
  const best = new Map<string, T>();
  const vague = (label: string) => /misc_feature|feature\b/i.test(label);
  for (const site of sites) {
    const key = `${site.start}:${site.replaceRegion ? site.end : site.start}:${site.strand}`;
    const current = best.get(key);
    if (!current || (vague(current.label) && !vague(site.label))) best.set(key, site);
  }
  return sites.filter((site) => best.get(`${site.start}:${site.replaceRegion ? site.end : site.start}:${site.strand}`) === site);
}
