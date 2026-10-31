// Turning what a project already recorded into an AlphaFold Server job request.
//
// Nothing here is entered twice. The oligomeric state from the Protein
// properties job becomes the chain count, the cofactors and PTM/maturation
// features from the chosen UniProt reference become ligands, ions, glycans and
// modifications, and the readiness check's free-text cofactor notes are read
// as well. UniProt vocabulary is not AlphaFold Server vocabulary, so each
// annotation is translated through an explicit table and anything that has no
// translation is reported rather than guessed at.
//
// One honesty constraint shapes this file: an annotated position belongs to the
// reference sequence, not to the construct in front of the scientist. The
// positions are carried over unchanged and `buildAlphaFoldJob` keeps only the
// ones where the construct really has the matching residue, so a reference that
// is offset by a signal peptide drops its modifications instead of putting a
// phosphate on the wrong residue.
//
// Only erasable TypeScript syntax and type-only imports are used, so the unit
// tests run under Node's built-in type stripping.
import type { JsonObject, ProteinBundle } from "./protein-labs-api.ts";
import { readOligomericState, subunitCount } from "./oligomeric-state.ts";
import { recogniseMolecule } from "./alphafold-server-job.ts";
import type { AlphaFoldJobRequest, ExportWarning, GlycanRequest, ProteinChainRequest, PtmRequest, SmallMoleculeRequest } from "./alphafold-server-job.ts";

/** A partner chain the scientist adds in the export dialog. */
export type PartnerChain = { id: string; label: string; sequence: string; copies: number };

/**
 * UniProt modified-residue descriptions mapped to AlphaFold Server PTM codes.
 * A `note` marks a translation that is close but not exact, so the export can
 * say which way it rounded.
 */
const ptmDescriptions: Record<string, { code: string; note?: string }> = {
  "phosphoserine": { code: "SEP" },
  "phosphothreonine": { code: "TPO" },
  "phosphotyrosine": { code: "PTR" },
  "phosphohistidine": { code: "NEP", note: "the annotation does not say which imidazole nitrogen, so N1-phosphohistidine (CCD_NEP) was used rather than ND1 (CCD_HIP)" },
  "1'-phosphohistidine": { code: "NEP" },
  "3'-phosphohistidine": { code: "HIP" },
  "n6-acetyllysine": { code: "ALY" },
  "n6-methyllysine": { code: "MLZ" },
  "n6,n6-dimethyllysine": { code: "MLY" },
  "n6,n6,n6-trimethyllysine": { code: "M3L" },
  "symmetric dimethylarginine": { code: "2MR" },
  "asymmetric dimethylarginine": { code: "2MR" },
  "dimethylated arginine": { code: "2MR" },
  "omega-n-methylarginine": { code: "AGM", note: "AlphaFold Server offers only 5-methylarginine (CCD_AGM) for a singly methylated arginine" },
  "methylarginine": { code: "AGM", note: "AlphaFold Server offers only 5-methylarginine (CCD_AGM) for a singly methylated arginine" },
  "citrulline": { code: "CIR" },
  "4-hydroxyproline": { code: "HYP" },
  "3-hydroxyproline": { code: "HY3" },
  "5-hydroxylysine": { code: "LYZ" },
  "s-palmitoyl cysteine": { code: "P1L" },
  "s-palmitoylcysteine": { code: "P1L" },
  "s-nitrosocysteine": { code: "SNC" },
  "n6-crotonyllysine": { code: "KCR" },
  "n6-crotonyl-lysine": { code: "KCR" },
  "beta-hydroxyasparagine": { code: "AHB" },
  "(3r)-3-hydroxyasparagine": { code: "AHB" },
  "3-hydroxyasparagine": { code: "AHB" },
  "homocitrulline": { code: "YHA" },
  "n6-carbamoyllysine": { code: "YHA" },
  "n1-formyltryptophan": { code: "TRF" },
  "malonyl cysteine": { code: "MCS" },
  "s-malonylcysteine": { code: "MCS" },
  "deamidated asparagine": { code: "SNN", note: "modelled as the aminosuccinimide intermediate (CCD_SNN), the only deamidation product AlphaFold Server carries" },
};

/**
 * Sugar abbreviations in a UniProt glycosylation description, mapped to a CCD
 * code. Codes outside AlphaFold Server's set are still returned so the warning
 * can name the sugar that could not be modelled.
 */
const glycanSugars: Record<string, string> = {
  glcnac: "NAG", hexnac: "NAG", nag: "NAG",
  man: "MAN", bma: "BMA", glc: "GLC", bgc: "BGC", fuc: "FUC",
  gal: "GAL", galnac: "A2G", xyl: "XYS", glca: "BDP", hex: "GLC", neuac: "SIA", sia: "SIA",
};

/** Feature types that describe a chemical modification of a residue. */
const modificationTypes = ["mod_res", "modified residue", "lipid", "lipidation"];
const glycosylationTypes = ["carbohyd", "glycosylation"];

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function asObjects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function jobConfig(bundle: ProteinBundle, appType: string): JsonObject {
  return bundle.projectJobs.find((job) => job.appType === appType)?.config ?? {};
}

/** The 1-based start of a UniProt feature, or null when it has no position. */
export function featurePosition(feature: JsonObject): number | null {
  const location = asObject(feature.location);
  const raw = Number(feature.start ?? location.start ?? asObject(location.start).value);
  return Number.isInteger(raw) && raw >= 1 ? raw : null;
}

/** A description reduced to a lookup key: no evidence clause, no stereo prefix. */
export function descriptionKey(value: string): string {
  return value
    .split(";")[0]
    .replace(/\(\s*(complex|hybrid|high mannose|glycation|GPI-anchor amidated \w+)\s*\)/gi, " ")
    .replace(/\bl-\b/gi, " ")
    .replace(/-l-/gi, "-")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The AlphaFold Server PTM a UniProt description names, or null. */
export function recognisePtm(description: string): { code: string; note?: string } | null {
  const key = descriptionKey(description);
  if (!key) return null;
  if (Object.prototype.hasOwnProperty.call(ptmDescriptions, key)) return ptmDescriptions[key];
  const compact = key.replace(/[\s-]+/g, "");
  for (const [candidate, value] of Object.entries(ptmDescriptions)) {
    if (candidate.replace(/[\s-]+/g, "") === compact) return value;
  }
  return null;
}

/**
 * The CCD code for the sugar a glycosylation description names, or null when
 * the description names no sugar at all.
 */
export function recogniseGlycan(description: string): string | null {
  const bracketed = /\(([^)]+)\)/.exec(description);
  const token = (bracketed?.[1] ?? "").replace(/\.+$/, "").replace(/[^a-z]/gi, "").toLowerCase();
  if (!token) return null;
  return Object.prototype.hasOwnProperty.call(glycanSugars, token) ? glycanSugars[token] : token.toUpperCase();
}

/**
 * Free-text cofactor notes split into one entry per cofactor. Chemical names
 * carry their own punctuation, so a separator only counts where it cannot be
 * part of a name: `Zn2+` is one cofactor and so is `2,3-bisphosphoglycerate`,
 * while `ATP + Mg` and `heme, FAD` are two.
 */
export function splitCofactorText(value: string): string[] {
  return value
    .split(/[;\n]|\band\b|\s\+\s|(?<![0-9]),(?!\s*[0-9])/gi)
    .map((part) => part.trim())
    // Bare "NA" is "not applicable" far more often than it is sodium, and the
    // charge is what tells them apart: `Na+` and `sodium` still get through.
    .filter((part) => part.length > 0 && !/^(none|n\/a|na|no|unknown|not reviewed)$/i.test(part));
}

/** The reference record the project chose, preferring the live match over the snapshot. */
function referenceEvidence(bundle: ProteinBundle): { accession: string; features: JsonObject[]; cofactors: JsonObject[] } {
  const config = jobConfig(bundle, "reference-match");
  const accession = String(config.selectedAccession ?? "");
  const live = bundle.uniprotMatches
    .map((match) => {
      const record = asObject(match.record);
      return Object.keys(record).length ? record : match;
    })
    .find((record) => String(record.accession ?? "") === accession && accession !== "");
  const snapshot = asObject(config.evidenceSnapshot);
  const source = live && asObjects(live.postTranslationalModifications).length ? live : snapshot;
  return {
    accession,
    features: asObjects(source.postTranslationalModifications),
    cofactors: asObjects(source.cofactors).length ? asObjects(source.cofactors) : asObjects(snapshot.cofactors),
  };
}

/**
 * The key the export dialog removes a cofactor by: the entity AlphaFold Server
 * would model, not the text the cofactor was recorded as. `heme b` and
 * `heme b · CHEBI:60344` are one row in the preview and one `ligand:HEM` here,
 * so removing that row removes both annotations behind it.
 */
export function cofactorKey(name: string): string {
  const cleaned = name.trim();
  const match = recogniseMolecule(cleaned);
  return match ? `${match.kind}:${match.code}` : `text:${cleaned.toLowerCase()}`;
}

/**
 * The AlphaFold Server job request for a project: the construct as the required
 * chain, the recorded oligomeric state as its copy count, and every cofactor
 * and modification the chosen reference supports.
 *
 * `excluded` holds `cofactorKey` values the scientist removed in the export
 * dialog. They are dropped here rather than filtered out of the built job, so
 * the cofactor warnings below count what the job actually carries: a reference
 * heme the scientist has already removed should not still be described as
 * sitting in the job.
 */
export function alphaFoldRequestFor(
  bundle: ProteinBundle,
  partners: PartnerChain[] = [],
  excluded: readonly string[] = [],
): AlphaFoldJobRequest {
  const notes: ExportWarning[] = [];
  const state = readOligomericState(jobConfig(bundle, "protparam"));
  const copies = subunitCount(state);
  const evidence = referenceEvidence(bundle);

  if (!state || state.kind === "unknown") {
    notes.push({
      category: "approximation", severity: "adjusted", subject: "Oligomeric state",
      message: "No oligomeric state is recorded in Protein properties, so one copy of the chain was exported. Record the state there to model the assembly instead.",
    });
  } else if (copies === null) {
    notes.push({
      category: "approximation", severity: "adjusted", subject: "Oligomeric state",
      message: state.kind === "hetero-complex"
        ? `This project is recorded as a hetero-complex${state.complexNote ? ` (${state.complexNote})` : ""}. AlphaFold Server needs each partner's own sequence, so one copy of this chain was exported — add the partner chains below to model the complex.`
        : "The oligomeric state is a higher-order homo-oligomer with no subunit count, so one copy of the chain was exported.",
    });
  }

  const ptms: PtmRequest[] = [];
  const glycans: GlycanRequest[] = [];
  let unmapped = 0;

  for (const feature of evidence.features) {
    const type = String(feature.type ?? "").toLowerCase();
    const description = String(feature.description ?? "");
    const position = featurePosition(feature);
    const subject = `${description || "Modification"} at ${position ?? "?"}`;
    const isModification = modificationTypes.some((candidate) => type.includes(candidate));
    const isGlycosylation = glycosylationTypes.some((candidate) => type.includes(candidate));

    if (!isModification && !isGlycosylation) { unmapped += 1; continue; }
    if (position === null) {
      notes.push({
        category: "ptm-position", severity: "excluded", subject,
        message: `"${description || type}" has no residue position in the reference record, and AlphaFold Server needs one. It was left out.`,
      });
      continue;
    }

    if (isGlycosylation) {
      const sugar = recogniseGlycan(description);
      if (!sugar) {
        notes.push({
          category: "unsupported-glycan", severity: "excluded", subject,
          message: `"${description}" does not name a sugar, so no glycan could be built for position ${position}.`,
        });
        continue;
      }
      glycans.push({ residues: sugar, position, source: subject });
      continue;
    }

    const match = recognisePtm(description);
    if (!match) {
      notes.push({
        category: "unsupported-ptm", severity: "excluded", subject,
        message: `"${description || "an unnamed modification"}" has no AlphaFold Server equivalent among its 23 supported modifications, so it was left out.`,
      });
      continue;
    }
    if (match.note) {
      notes.push({ category: "approximation", severity: "adjusted", subject, message: `${subject}: ${match.note}.` });
    }
    ptms.push({ code: match.code, position, source: subject });
  }

  if (unmapped) {
    notes.push({
      category: "unsupported-ptm", severity: "excluded", subject: "Other annotated features",
      message: `${unmapped} other annotated feature${unmapped === 1 ? "" : "s"} from ${evidence.accession || "the reference"} (signal peptides, disulfide bonds, chains and the like) have no AlphaFold Server field and were not exported.`,
    });
  }
  if ((ptms.length || glycans.length) && evidence.accession) {
    notes.push({
      category: "approximation", severity: "adjusted", subject: "Annotated positions",
      message: `Modification positions come from ${evidence.accession}, not from this construct. Each one was kept only where the construct has the matching residue at that position — check the exported positions against your numbering before uploading.`,
    });
  }

  const cofactors: SmallMoleculeRequest[] = [];
  const seen = new Set<string>();
  const dropped = new Set<string>();
  const excludedKeys = new Set(excluded);
  // Dedupe on the entity AlphaFold Server will actually model, not on how the
  // cofactor was written down. The readiness check pre-fills its Cofactor
  // details from this same reference as `name · CHEBI:id`, so one heme reaches
  // us as both "heme b" and "heme b · CHEBI:60344"; keyed on the raw text those
  // are two cofactors, and the builder would merge them into `count: 2` and
  // model a monomer with two hemes. Anything unrecognised has no code to key
  // on, so it falls back to its text and still earns its own warning.
  const addCofactor = (name: string, source: string) => {
    const cleaned = name.trim();
    if (!cleaned) return;
    const key = cofactorKey(cleaned);
    if (excludedKeys.has(key)) {
      dropped.add(cleaned);
      return;
    }
    if (seen.has(key)) return;
    seen.add(key);
    cofactors.push({ code: cleaned, copies: 1, source });
  };
  for (const cofactor of evidence.cofactors) {
    const name = String(cofactor.name ?? "").trim();
    if (name) addCofactor(name, `${name} (${evidence.accession || "reference"})`);
  }
  const readiness = jobConfig(bundle, "protein-readiness");
  const cofactorAnswer = String(readiness.cofactorRequired ?? "");
  if (cofactorAnswer === "No") {
    // The scientist's own answer beats the homolog's annotation, but dropping a
    // haemoglobin's heme on the strength of one radio button would be worse
    // than carrying it, so the reference's cofactors stay and say so.
    //
    // "below" means the Ligands and ions rows, and a cofactor AlphaFold Server
    // cannot model never gets a row — it gets its own "left out" note instead.
    // Counting those here would promise a row that is not there and ask for it
    // to be removed with a button it does not have.
    const shown = cofactors.filter((entry) => recogniseMolecule(entry.code)).length;
    if (shown) {
      notes.push({
        category: "approximation", severity: "adjusted", subject: "Readiness check",
        message: `The readiness check answers "no" to requiring a cofactor, so its own notes were not read. ${shown === 1 ? "The cofactor" : `The ${shown} cofactors`} below still ${shown === 1 ? "comes" : "come"} from ${evidence.accession || "the reference"} — remove ${shown === 1 ? "it" : "them"} from the job if this construct really binds nothing.`,
      });
    }
  } else {
    for (const name of splitCofactorText(String(readiness.cofactorDetails ?? ""))) {
      addCofactor(name, `${name} (readiness check)`);
    }
  }
  if (dropped.size) {
    // Said out loud in the same list as everything else the job lost, so the
    // downloaded file and the notes beside it never disagree about what is in
    // it. Nothing is deleted from the project: the removals live in the dialog
    // and "Add back" restores them.
    const names = [...dropped].sort((left, right) => left.localeCompare(right));
    notes.push({
      category: "removed-by-hand", severity: "excluded", subject: "Removed here",
      message: `${names.join(", ")} ${names.length === 1 ? "was" : "were"} removed in this dialog, so ${names.length === 1 ? "it is" : "they are"} not in the job. The project still records ${names.length === 1 ? "it" : "them"} — use "Add back" to put ${names.length === 1 ? "it" : "them"} in again.`,
    });
  }

  const ptmAnswer = String(readiness.postTranslationalModification ?? "");
  const ptmDetails = String(readiness.postTranslationalModificationDetails ?? "").trim();
  if (ptmAnswer === "Yes" && ptmDetails && !ptms.length && !glycans.length) {
    notes.push({
      category: "ptm-position", severity: "excluded", subject: "Readiness check",
      message: `The readiness check records modifications ("${ptmDetails}") but without residue positions, and AlphaFold Server needs a position for each one. None were exported — add them as features on the reference match, or edit the positions into the JSON.`,
    });
  }

  const target: ProteinChainRequest = {
    label: bundle.protein.name || "Construct",
    sequence: bundle.protein.sequence ?? "",
    copies: copies ?? 1,
    required: true,
    ptms,
    glycans,
  };

  const partnerChains: ProteinChainRequest[] = partners
    .filter((partner) => partner.sequence.trim().length > 0)
    .map((partner, index) => ({
      label: partner.label.trim() || `Partner chain ${index + 1}`,
      sequence: partner.sequence,
      copies: partner.copies,
      required: false,
    }));

  return {
    jobName: bundle.protein.name || "Protein Lab job",
    proteins: [target, ...partnerChains],
    cofactors,
    notes,
  };
}
