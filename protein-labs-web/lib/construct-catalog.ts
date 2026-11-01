/**
 * Fusion-construct assembly for purification planning.
 *
 * Choosing an affinity tag and a protease in the purification planner changes
 * the protein that is actually expressed, so the planner assembles the real
 * construct sequence and recalculates mass and extinction coefficient from it.
 * Three sequences matter and all three are derived here:
 *
 *   fusion   what the cell expresses, tag and cleavage site included
 *   cleaved  what survives tag removal, including any residual scar residues
 *   released the tag fragment the protease sets free
 *
 * Short peptide tags and protease sites carry their exact published sequences.
 * Large fusion partners (GST, MBP, SUMO, HaloTag…) deliberately do not: a
 * 370-residue sequence typed from memory would quietly corrupt every mass that
 * follows, so those tags are resolved from the selected vector's annotated CDS
 * or from a sequence the researcher supplies.
 */

export type TagTerminus = "N" | "C";

export type TagModule = {
  id: string;
  name: string;
  /** Exact tag peptide, or "" when it has to come from a vector or UniProt. */
  sequence: string;
  /** True when the sequence is too large to encode here and must be resolved. */
  requiresSource?: boolean;
  /** Approximate mass in kDa, shown while a large tag is unresolved. */
  approximateKDa?: number;
  terminus: TagTerminus;
  /** Lower-cased aliases matched against the affinity catalogue's tag text. */
  aliases: string[];
  note: string;
};

export type CleavageSite = {
  id: string;
  name: string;
  /** Peptide inserted between tag and target. Empty for folded-domain proteases. */
  site: string;
  /**
   * Index within `site` where the peptide bond is broken. Residues before it
   * stay with the tag; residues from it onward stay with the target, which is
   * what leaves a scar such as the Gly of TEV or the Gly-Pro of HRV 3C.
   */
  cutAfter: number;
  /** True when recognition is of a folded domain rather than a linear motif. */
  foldedDomain?: boolean;
  scarNote: string;
};

export type LinkerOption = { id: string; name: string; sequence: string; note: string };

/**
 * Residues the backbone contributes immediately before the target protein.
 *
 * These are not part of the tag or the protease site: they come from the
 * cloning junction itself, so they stay on the protein after cleavage and have
 * to be counted in the cleaved product's mass and pI. The in-house His vectors
 * leave Gly-Ala at that junction.
 */
export type JunctionOption = LinkerOption;

/** Short tags with exact, well-established published sequences. */
export const tagModules: TagModule[] = [
  { id: "his6", name: "6×His", sequence: "HHHHHH", terminus: "N", aliases: ["6×his", "6xhis", "his6", "polyhistidine", "his"], note: "Standard polyhistidine tag for IMAC." },
  { id: "his8", name: "8×His", sequence: "HHHHHHHH", terminus: "N", aliases: ["8×his", "8xhis", "his8"], note: "Longer polyhistidine tag; often improves capture of poorly accessible tags." },
  { id: "his10", name: "10×His", sequence: "HHHHHHHHHH", terminus: "N", aliases: ["10×his", "10xhis", "his10"], note: "Longest common polyhistidine tag; highest IMAC avidity." },
  { id: "hat", name: "HAT-tag", sequence: "KDHLIHNVHKEFHAHAHNK", terminus: "N", aliases: ["hat-tag", "hat tag", "hat"], note: "Natural histidine-rich sequence from chicken lactate dehydrogenase." },
  { id: "strep2", name: "Strep-tag II", sequence: "WSHPQFEK", terminus: "C", aliases: ["strep-tag ii", "strep-tag", "strep"], note: "Binds engineered streptavidin; small and mild to elute." },
  { id: "twin-strep", name: "Twin-Strep-tag", sequence: "WSHPQFEKGGGSGGGSGGSAWSHPQFEK", terminus: "C", aliases: ["twin-strep", "twin strep"], note: "Two Strep-tag II modules joined by a flexible linker." },
  { id: "avitag", name: "AviTag", sequence: "GLNDIFEAQKIEWHE", terminus: "C", aliases: ["avitag", "biotinylated", "biotin acceptor"], note: "BirA biotinylation acceptor peptide; the biotin itself adds ~244 Da." },
  { id: "flag", name: "FLAG", sequence: "DYKDDDDK", terminus: "N", aliases: ["flag"], note: "Hydrophilic epitope tag recognized by anti-FLAG antibodies." },
  { id: "flag3", name: "3×FLAG", sequence: "DYKDHDGDYKDHDIDYKDDDDK", terminus: "N", aliases: ["3×flag", "3xflag", "triple flag"], note: "Tandem FLAG epitopes for higher-sensitivity detection and capture." },
  { id: "ha", name: "HA", sequence: "YPYDVPDYA", terminus: "C", aliases: ["ha"], note: "Influenza haemagglutinin epitope tag." },
  { id: "myc", name: "c-Myc", sequence: "EQKLISEEDL", terminus: "C", aliases: ["c-myc", "myc"], note: "Human c-Myc epitope tag." },
  { id: "v5", name: "V5", sequence: "GKPIPNPLLGLDST", terminus: "C", aliases: ["v5"], note: "Paramyxovirus SV5 P/V epitope tag." },
  { id: "s-tag", name: "S-tag", sequence: "KETAAAKFERQHMDS", terminus: "N", aliases: ["s-tag"], note: "S-peptide of RNase A; binds immobilized S-protein." },
  { id: "t7-tag", name: "T7-tag", sequence: "MASMTGGQQMG", terminus: "N", aliases: ["t7-tag", "t7 tag"], note: "Leader peptide of T7 major capsid protein; includes its own initiator Met." },
  { id: "alfa", name: "ALFA-tag", sequence: "SRLEEELRRRLTE", terminus: "C", aliases: ["alfa-tag", "alfa"], note: "Helical tag captured by an anti-ALFA nanobody." },
  { id: "cbp", name: "Calmodulin-binding peptide", sequence: "KRRWKKNFIAVSAANRFKKISSSGAL", terminus: "C", aliases: ["calmodulin-binding", "cbp"], note: "Binds calmodulin in the presence of calcium." },
  { id: "protein-c", name: "Protein C tag", sequence: "EDQVDPRLIDGK", terminus: "N", aliases: ["protein c"], note: "HPC4 epitope; capture and release are calcium dependent." },
  { id: "rho1d4", name: "Rho1D4 tag", sequence: "TETSQVAPA", terminus: "C", aliases: ["rho1d4", "1d4"], note: "C-terminal rhodopsin epitope used for membrane proteins." },

  // Large fusion partners. Mass is listed for planning, but the sequence must
  // be resolved from a real source before any construct mass is reported.
  { id: "gst", name: "GST", sequence: "", requiresSource: true, approximateKDa: 26, terminus: "N", aliases: ["gst"], note: "Schistosoma japonicum glutathione S-transferase, ~220 residues. Resolve from the vector's annotated GST CDS." },
  { id: "mbp", name: "MBP", sequence: "", requiresSource: true, approximateKDa: 42, terminus: "N", aliases: ["mbp", "maltose binding", "maltose-binding"], note: "E. coli maltose-binding protein, ~370 residues. Resolve from the vector's annotated malE CDS." },
  { id: "sumo", name: "SUMO", sequence: "", requiresSource: true, approximateKDa: 11, terminus: "N", aliases: ["sumo", "smt3"], note: "SUMO/Smt3 solubility tag, ~98 residues. Resolve from the vector's annotated SUMO CDS." },
  { id: "halotag", name: "HaloTag", sequence: "", requiresSource: true, approximateKDa: 33, terminus: "N", aliases: ["halotag"], note: "Engineered dehalogenase, ~297 residues. Resolve from the vector's annotated HaloTag CDS." },
  { id: "snap", name: "SNAP-tag", sequence: "", requiresSource: true, approximateKDa: 20, terminus: "N", aliases: ["snap-tag", "snap"], note: "Engineered O6-alkylguanine transferase, ~182 residues. Resolve from the vector's annotated CDS." },
  { id: "protein-a", name: "Protein A / ZZ", sequence: "", requiresSource: true, approximateKDa: 15, terminus: "N", aliases: ["protein a", "zz tag", "zz"], note: "IgG-binding domains of staphylococcal protein A. Resolve from the vector's annotated CDS." },
  { id: "protein-g", name: "Protein G", sequence: "", requiresSource: true, approximateKDa: 22, terminus: "N", aliases: ["protein g"], note: "IgG-binding domains of streptococcal protein G. Resolve from the vector's annotated CDS." },
  { id: "fc", name: "Fc fusion", sequence: "", requiresSource: true, approximateKDa: 26, terminus: "C", aliases: ["fc fusion", "fc"], note: "Immunoglobulin Fc domain; species and subclass change the sequence. Resolve from the vector." },
  { id: "cbd-intein", name: "CBD–intein", sequence: "", requiresSource: true, approximateKDa: 28, terminus: "N", aliases: ["cbd", "intein", "chitin"], note: "Chitin-binding domain fused through a self-cleaving intein. Resolve from the vector." },
];

/** Protease sites, with the exact scar each one leaves on the target. */
export const cleavageSites: CleavageSite[] = [
  { id: "retain", name: "No cleavage site", site: "", cutAfter: 0, scarNote: "The tag stays on the purified protein." },
  { id: "tev", name: "TEV", site: "ENLYFQG", cutAfter: 6, scarNote: "Cleaves between Q and G, leaving a single Gly on the target. P1′ tolerates G, S, A, M, C or H." },
  { id: "hrv-3c", name: "HRV 3C / PreScission", site: "LEVLFQGP", cutAfter: 6, scarNote: "Cleaves between Q and G, leaving Gly-Pro on the target." },
  { id: "thrombin", name: "Thrombin", site: "LVPRGS", cutAfter: 4, scarNote: "Cleaves after Arg, leaving Gly-Ser on the target." },
  { id: "factor-xa", name: "Factor Xa", site: "IEGR", cutAfter: 4, scarNote: "Cleaves after Arg, leaving no extra residues." },
  { id: "enterokinase", name: "Enterokinase", site: "DDDDK", cutAfter: 5, scarNote: "Cleaves after Lys, leaving no extra residues." },
  { id: "tvmv", name: "TVMV", site: "ETVRFQS", cutAfter: 6, scarNote: "Cleaves between Q and S, leaving a single Ser on the target." },
  { id: "ulp1", name: "SUMO protease / Ulp1", site: "", cutAfter: 0, foldedDomain: true, scarNote: "Recognizes folded SUMO and cuts at its C-terminus, leaving no scar." },
  { id: "dub", name: "Ubiquitin hydrolase", site: "", cutAfter: 0, foldedDomain: true, scarNote: "Recognizes folded ubiquitin and cuts after its terminal Gly, leaving no scar." },
  { id: "intein", name: "Intein self-cleavage", site: "", cutAfter: 0, foldedDomain: true, scarNote: "Self-cleaves at the engineered junction; the scar depends on the system." },
];

export const linkerOptions: LinkerOption[] = [
  { id: "none", name: "No linker", sequence: "", note: "Tag and cleavage site sit directly against each other." },
  { id: "dydiptt", name: "DYDIPTT spacer", sequence: "DYDIPTT", note: "Charged, protease-accessible spacer between a poly-His tag and an rTEV site; the default His–TEV layout." },
  { id: "gs", name: "Short Gly-Ser", sequence: "GS", note: "Minimal spacer; common in commercial backbones." },
  { id: "sggs", name: "Flexible SGGS", sequence: "SGGS", note: "Adds flexibility so the protease can reach its site." },
  { id: "gsgsgs", name: "Flexible (GS)₃", sequence: "GSGSGS", note: "Longer flexible spacer for poorly accessible sites." },
  { id: "ggggs", name: "Flexible (G₄S)", sequence: "GGGGS", note: "Classic flexible fusion linker." },
];

export const junctionOptions: JunctionOption[] = [
  { id: "none", name: "No junction residues", sequence: "", note: "The protease site or tag runs straight into the target." },
  { id: "ga", name: "Gly-Ala junction", sequence: "GA", note: "Gly-Ala left by the vector's cloning junction, directly before the protein of interest." },
];

/** Poly-His tags, for which the house DYDIPTT–TEV–GA layout is the default. */
const polyHisTagIds = new Set(["his6", "his8", "his10"]);


export type ConstructPlan = {
  terminus: TagTerminus;
  /** Whether an initiator Met is prepended to an N-terminal construct. */
  initiatorMet: boolean;
  tagId: string;
  linkerId: string;
  /** Backbone residues directly before the target. Absent means none. */
  junctionId?: string;
  cleavageId: string;
  /** Resolved sequence for a large fusion partner, when one was supplied. */
  resolvedTagSequence?: string;
  resolvedTagSource?: string;
};

/**
 * The linker and junction a construct starts from.
 *
 * An N-terminal poly-His tag cleaved with TEV gets the house layout
 * `M–His–DYDIPTT–ENLYFQ↓G–GA–target`. Anything else, including a C-terminal
 * His tag, starts with no linker and no junction residues rather than a
 * Gly-Ser spacer nobody asked for; both remain selectable.
 *
 * An empty `cleavageId` means the protease stage has not been visited yet. The
 * tag is chosen first and TEV is the house protease, so a poly-His construct
 * starts from the house layout. This only decides the starting point: once a
 * plan is saved its linker and junction are kept as saved.
 */
export function defaultLayoutFor(
  tagId: string,
  cleavageId: string,
  terminus: TagTerminus = "N",
): { linkerId: string; junctionId: string } {
  const house = terminus === "N" && polyHisTagIds.has(tagId) && (cleavageId === "tev" || cleavageId === "");
  return house ? { linkerId: "dydiptt", junctionId: "ga" } : { linkerId: "none", junctionId: "none" };
}

/**
 * Change the tag or its terminus and carry the layout along with it.
 *
 * The linker and junction move to the new default only while they still match
 * the old one, so switching a His resin to GST drops DYDIPTT and GA, but a
 * linker or junction the researcher picked by hand is left alone.
 */
export function relayoutPlan(
  plan: ConstructPlan,
  patch: Partial<Pick<ConstructPlan, "tagId" | "terminus">>,
  cleavageId: string,
): ConstructPlan {
  const next = { ...plan, ...patch };
  if (patch.tagId !== undefined && patch.tagId !== plan.tagId) {
    next.resolvedTagSequence = "";
    next.resolvedTagSource = "";
  }
  const before = defaultLayoutFor(plan.tagId, cleavageId, plan.terminus);
  const after = defaultLayoutFor(next.tagId, cleavageId, next.terminus);
  if (plan.linkerId === before.linkerId) next.linkerId = after.linkerId;
  if ((plan.junctionId ?? "none") === before.junctionId) next.junctionId = after.junctionId;
  return next;
}

export type ConstructSegment = {
  kind: "met" | "tag" | "linker" | "site" | "target" | "scar" | "junction";
  label: string;
  sequence: string;
  start: number;
  end: number;
  /** True when the segment remains on the protein after tag cleavage. */
  retained: boolean;
};

export type AssembledConstruct = {
  fusion: string;
  cleaved: string;
  released: string;
  segments: ConstructSegment[];
  /** Set when a large fusion partner has no resolved sequence yet. */
  unresolvedTag: TagModule | null;
  cleaves: boolean;
  /**
   * Every residue the construct leaves on the purified protein: the protease's
   * P1′ residues plus any backbone junction residues, in construct order.
   */
  scar: string;
  warnings: string[];
};

export function findTagModule(id: string) {
  return tagModules.find((tag) => tag.id === id) ?? null;
}

/** Resolve the affinity catalogue's free-text tag label to a tag module. */
export function tagModuleForAffinityTag(affinityTag: string): TagModule | null {
  const text = affinityTag.toLowerCase();
  const matches = tagModules
    .map((tag) => {
      const alias = tag.aliases.find((value) => text.includes(value));
      return alias ? { tag, weight: alias.length } : null;
    })
    .filter((value): value is { tag: TagModule; weight: number } => value !== null);
  // Prefer the most specific alias so "twin-strep" never resolves to "strep".
  matches.sort((left, right) => right.weight - left.weight);
  return matches[0]?.tag ?? null;
}

export function cleavageSiteForProtease(proteaseId: string) {
  return cleavageSites.find((site) => site.id === proteaseId) ?? null;
}

/** Tag sequence to use, preferring a resolved sequence for large partners. */
export function tagSequenceFor(tag: TagModule | null, plan: Pick<ConstructPlan, "resolvedTagSequence">) {
  if (!tag) return "";
  if (!tag.requiresSource) return tag.sequence;
  return cleanPeptide(plan.resolvedTagSequence ?? "");
}

export function cleanPeptide(value: string) {
  return value.toUpperCase().replace(/[^ACDEFGHIKLMNPQRSTVWY]/g, "");
}

/**
 * Build the fusion, the cleaved product and the released tag fragment.
 *
 * Segments are returned in construct order with absolute coordinates so the
 * planner can draw the construct and highlight what survives cleavage.
 */
export function assembleConstruct(target: string, plan: ConstructPlan): AssembledConstruct {
  const cleanTarget = cleanPeptide(target);
  const tag = findTagModule(plan.tagId);
  const site = cleavageSiteForProtease(plan.cleavageId);
  const linker = linkerOptions.find((option) => option.id === plan.linkerId) ?? linkerOptions[0];
  const junction = junctionOptions.find((option) => option.id === plan.junctionId) ?? junctionOptions[0];
  const warnings: string[] = [];

  const tagSequence = tagSequenceFor(tag, plan);
  const unresolvedTag = tag?.requiresSource && !tagSequence ? tag : null;
  if (unresolvedTag) {
    warnings.push(
      `${unresolvedTag.name} is a ${unresolvedTag.approximateKDa ?? "large"} kDa fusion partner. ` +
      "Load its sequence from the vector annotation or paste it to calculate exact mass.",
    );
  }

  const siteSequence = site?.site ?? "";
  const cleaves = Boolean(site && site.id !== "retain");
  // A folded-domain protease needs no inserted peptide: the tag itself is the
  // recognition element, so cleavage happens exactly at the tag junction.
  const cutWithinSite = site?.foldedDomain ? 0 : site?.cutAfter ?? 0;

  const segments: ConstructSegment[] = [];
  let cursor = 0;
  const push = (kind: ConstructSegment["kind"], label: string, sequence: string, retained: boolean) => {
    if (!sequence) return;
    segments.push({ kind, label, sequence, start: cursor, end: cursor + sequence.length, retained });
    cursor += sequence.length;
  };

  if (plan.terminus === "N") {
    // An N-terminal tag that already starts with Met supplies its own initiator.
    const needsMet = plan.initiatorMet && !tagSequence.startsWith("M");
    if (needsMet) push("met", "Initiator Met", "M", false);
    push("tag", tag?.name ?? "Tag", tagSequence, false);
    push("linker", linker.name, linker.sequence, false);
    if (siteSequence) {
      push("site", `${site?.name ?? "Cleavage"} site`, siteSequence.slice(0, cutWithinSite), false);
      push("scar", "Retained scar", siteSequence.slice(cutWithinSite), true);
    }
    // The backbone's own residues sit between the site and the target, so they
    // survive cleavage even when the protease itself leaves nothing behind.
    push("junction", `${junction.name} (vector)`, junction.sequence, true);
    push("target", "Target protein", cleanTarget, true);
  } else {
    push("met", "Initiator Met", plan.initiatorMet && !cleanTarget.startsWith("M") ? "M" : "", true);
    push("junction", `${junction.name} (vector)`, junction.sequence, true);
    push("target", "Target protein", cleanTarget, true);
    if (siteSequence) {
      // For a C-terminal tag the target keeps everything before the cut.
      push("scar", "Retained scar", siteSequence.slice(0, cutWithinSite), true);
      push("site", `${site?.name ?? "Cleavage"} site`, siteSequence.slice(cutWithinSite), false);
    }
    push("linker", linker.name, linker.sequence, false);
    push("tag", tag?.name ?? "Tag", tagSequence, false);
  }

  const fusion = segments.map((segment) => segment.sequence).join("");
  const retained = segments.filter((segment) => segment.retained).map((segment) => segment.sequence).join("");
  const removed = segments.filter((segment) => !segment.retained).map((segment) => segment.sequence).join("");
  const cleaved = cleaves ? retained : fusion;
  const scar = segments
    .filter((segment) => segment.kind === "scar" || segment.kind === "junction")
    .map((segment) => segment.sequence)
    .join("");

  // A folded-domain protease leaves no scar of its own, but the vector's
  // junction residues still remain, so the warning depends only on the scar.
  if (cleaves && plan.terminus === "N" && scar) {
    warnings.push(`Tag removal leaves ${scar} at the new N-terminus, which changes the N-end-rule half-life estimate.`);
  }
  if (cleaves && site && !site.foldedDomain && siteSequence && cleanTarget.includes(siteSequence)) {
    warnings.push(`The target already contains ${siteSequence}; the protease would also cut inside the protein.`);
  }
  if (tag && !tag.requiresSource && plan.terminus !== tag.terminus) {
    warnings.push(`${tag.name} is usually placed at the ${tag.terminus} terminus. Confirm the construct really is ${plan.terminus}-terminal.`);
  }

  return {
    fusion,
    cleaved,
    released: cleaves ? removed : "",
    segments,
    unresolvedTag,
    cleaves,
    scar,
    warnings,
  };
}

/** Peptide features in a vector annotation that can supply a large tag. */
export function tagCandidatesFromVector(features: { name?: unknown; type?: unknown; qualifiers?: unknown }[]) {
  const candidates: { name: string; sequence: string }[] = [];
  for (const feature of features) {
    const qualifiers = feature.qualifiers as Record<string, unknown> | undefined;
    const translation = Array.isArray(qualifiers?.translation) ? String(qualifiers?.translation[0] ?? "") : "";
    const sequence = cleanPeptide(translation);
    if (sequence.length >= 20) candidates.push({ name: String(feature.name ?? "Annotated CDS"), sequence });
  }
  return candidates;
}
