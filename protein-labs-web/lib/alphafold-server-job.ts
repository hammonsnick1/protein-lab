// The AlphaFold Server job JSON this project exports, and the validation that
// decides what can go in it.
//
// AlphaFold Server accepts a narrow slice of chemistry: 20 standard amino
// acids, 19 ligand CCD codes, 10 ions, 23 protein PTMs, 6 glycan residues and
// 5,000 tokens per job. Anything a project records outside that slice cannot be
// modelled, so the builder leaves it out and says so rather than emitting a
// file the server rejects. Every exclusion becomes a warning naming the thing
// that was dropped and why.
//
// The vocabulary tables below are transcribed from
// google-deepmind/alphafold `server/README.md`. Parent residues and heavy-atom
// counts are from the wwPDB Chemical Component Dictionary
// (`mon_nstd_parent_comp_id` and `formula`), not from memory: the parent
// residue is what makes "PTM on the wrong residue" checkable, and the atom
// count is what makes the token estimate meaningful, because AlphaFold tokenises
// a ligand or a non-standard residue per atom rather than per residue.
//
// Only erasable TypeScript syntax and type-only imports are used, so the unit
// tests run under Node's built-in type stripping.

/** Tokens allowed in one AlphaFold Server job. */
export const tokenLimit = 5000;

/** Glycan residues allowed across one job. */
export const glycanResidueLimit = 8;

/** The 20 standard amino acids, the only residues a protein chain may contain. */
export const standardResidues = "ACDEFGHIKLMNPQRSTVWY";

/** Allowed ligand CCD codes, mapped to heavy-atom count (one token per atom). */
export const ligandAtoms: Record<string, number> = {
  ADP: 27, ATP: 31, AMP: 23, GTP: 32, GDP: 28,
  FAD: 53, NAD: 44, NAP: 48, NDP: 48,
  HEM: 43, HEC: 43,
  PLM: 18, OLA: 20, MYR: 16, CIT: 13,
  CLA: 65, CHL: 66, BCL: 66, BCB: 66,
};

/** Allowed ion CCD codes. Every one is a single atom, so one token each. */
export const ionCodes = ["MG", "ZN", "CL", "CA", "NA", "MN", "K", "FE", "CU", "CO"];

export type PtmDefinition = {
  /** One-letter code of the amino acid this modification is made from. */
  residue: string;
  /** Heavy atoms in the modified residue; it costs this many tokens, not one. */
  atoms: number;
  name: string;
};

/** Allowed protein PTM CCD codes, with the residue each one modifies. */
export const ptmDefinitions: Record<string, PtmDefinition> = {
  SEP: { residue: "S", atoms: 11, name: "Phosphoserine" },
  TPO: { residue: "T", atoms: 12, name: "Phosphothreonine" },
  PTR: { residue: "Y", atoms: 17, name: "O-phosphotyrosine" },
  NEP: { residue: "H", atoms: 15, name: "N1-phosphonohistidine" },
  HIP: { residue: "H", atoms: 15, name: "ND1-phosphonohistidine" },
  ALY: { residue: "K", atoms: 13, name: "N6-acetyllysine" },
  MLY: { residue: "K", atoms: 12, name: "N6,N6-dimethyllysine" },
  M3L: { residue: "K", atoms: 13, name: "N6,N6,N6-trimethyllysine" },
  MLZ: { residue: "K", atoms: 11, name: "N6-methyllysine" },
  "2MR": { residue: "R", atoms: 14, name: "N3,N4-dimethylarginine" },
  AGM: { residue: "R", atoms: 13, name: "5-methylarginine" },
  MCS: { residue: "C", atoms: 13, name: "Malonyl cysteine" },
  HYP: { residue: "P", atoms: 9, name: "4-hydroxyproline" },
  HY3: { residue: "P", atoms: 9, name: "3-hydroxyproline" },
  LYZ: { residue: "K", atoms: 11, name: "5-hydroxylysine" },
  AHB: { residue: "N", atoms: 10, name: "Beta-hydroxyasparagine" },
  P1L: { residue: "C", atoms: 24, name: "S-palmitoyl cysteine" },
  SNN: { residue: "N", atoms: 8, name: "L-3-aminosuccinimide" },
  SNC: { residue: "C", atoms: 9, name: "S-nitrosocysteine" },
  TRF: { residue: "W", atoms: 17, name: "N1-formyltryptophan" },
  KCR: { residue: "K", atoms: 15, name: "N6-crotonyllysine" },
  CIR: { residue: "R", atoms: 12, name: "Citrulline" },
  YHA: { residue: "K", atoms: 13, name: "Homocitrulline" },
};

/** Allowed glycan residues, mapped to heavy-atom count. */
export const glycanAtoms: Record<string, number> = { NAG: 15, BMA: 12, MAN: 12, GLC: 12, BGC: 12, FUC: 11 };

/**
 * Glycan residues each attachment site accepts. Asparagine takes the five
 * hexoses and GlcNAc; serine and threonine additionally take fucose.
 */
export const glycanSites: Record<string, string[]> = {
  N: ["BGC", "BMA", "GLC", "MAN", "NAG"],
  S: ["BGC", "BMA", "GLC", "MAN", "NAG", "FUC"],
  T: ["BGC", "BMA", "GLC", "MAN", "NAG", "FUC"],
};

/** Allowed DNA modification CCD codes. */
export const dnaModificationCodes = ["5CM", "C34", "5HC", "6OG", "6MA", "1CC", "8OG", "5FC", "3DR"];

/** Allowed RNA modification CCD codes. */
export const rnaModificationCodes = ["PSU", "5MC", "OMC", "4OC", "5MU", "OMU", "UR3", "A2M", "MA6", "6MZ", "2MG", "OMG", "7MG", "RSQ"];

// --- The job JSON, exactly as AlphaFold Server reads it ------------------

export type AlphaFoldGlycan = { residues: string; position: number };
/**
 * A protein modification. The README's prose calls the second field
 * `position`, but its own example and the server's own
 * `<job>_job_request.json` both emit `ptmPosition`, so that is what is written.
 */
export type AlphaFoldModification = { ptmType: string; ptmPosition: number };
/** Nucleic modifications use different field names from protein PTMs. */
export type AlphaFoldBaseModification = { modificationType: string; basePosition: number };

export type AlphaFoldProteinChain = { sequence: string; count: number; glycans?: AlphaFoldGlycan[]; modifications?: AlphaFoldModification[] };
export type AlphaFoldNucleicChain = { sequence: string; count: number; modifications?: AlphaFoldBaseModification[] };
export type AlphaFoldLigand = { ligand: string; count: number };
export type AlphaFoldIon = { ion: string; count: number };

export type AlphaFoldEntity =
  | { proteinChain: AlphaFoldProteinChain }
  | { dnaSequence: AlphaFoldNucleicChain }
  | { rnaSequence: AlphaFoldNucleicChain }
  | { ligand: AlphaFoldLigand }
  | { ion: AlphaFoldIon };

export type AlphaFoldJob = {
  name: string;
  modelSeeds: string[];
  sequences: AlphaFoldEntity[];
  dialect: "alphafoldserver";
  version: 1;
};

// --- What the builder is given -------------------------------------------

export type PtmRequest = {
  /** CCD code, with or without the `CCD_` prefix. */
  code: string;
  /** 1-based position in the chain's sequence. */
  position: number;
  /** Where this came from, quoted back in any warning. */
  source?: string;
};

export type GlycanRequest = {
  /** Glycan in AlphaFold Server's nested form, e.g. `NAG(NAG)(BMA)`. */
  residues: string;
  /** 1-based position of the attachment residue. */
  position: number;
  source?: string;
};

export type ProteinChainRequest = {
  /** Shown in the preview and in warnings. */
  label: string;
  sequence: string;
  /** Identical copies of this chain. Defaults to 1. */
  copies?: number;
  /** False for a partner chain, so token trimming may drop it. */
  required?: boolean;
  ptms?: PtmRequest[];
  glycans?: GlycanRequest[];
};

export type NucleicChainRequest = { label: string; sequence: string; kind: "dna" | "rna"; copies?: number; modifications?: PtmRequest[] };

export type SmallMoleculeRequest = {
  /** A CCD code, or raw text to be recognised (`Zn(2+)`, `heme b`). */
  code: string;
  copies?: number;
  source?: string;
};

export type AlphaFoldJobRequest = {
  jobName: string;
  proteins: ProteinChainRequest[];
  nucleics?: NucleicChainRequest[];
  /** Known to be a ligand; a code AlphaFold Server treats as an ion is noted. */
  ligands?: SmallMoleculeRequest[];
  /** Known to be an ion; a code AlphaFold Server treats as a ligand is noted. */
  ions?: SmallMoleculeRequest[];
  /** Recorded only as "a cofactor"; wherever AlphaFold Server puts it is right. */
  cofactors?: SmallMoleculeRequest[];
  /** Warnings the caller already knows about, kept at the top of the list. */
  notes?: ExportWarning[];
};

// --- What it produces ----------------------------------------------------

export type WarningCategory =
  | "no-sequence" | "invalid-residue" | "empty-job"
  | "unsupported-ligand" | "reclassified" | "removed-by-hand"
  | "unsupported-ptm" | "ptm-position" | "ptm-residue" | "duplicate-ptm" | "approximation"
  | "unsupported-glycan" | "glycan-site" | "glycan-position" | "glycan-limit"
  | "token-limit";

/**
 * `excluded` — left out of the job. `adjusted` — in the job, but changed from
 * what the project recorded. `blocking` — AlphaFold Server will reject the job.
 */
export type WarningSeverity = "excluded" | "adjusted" | "blocking";

export type ExportWarning = { category: WarningCategory; severity: WarningSeverity; subject: string; message: string };

export type ChainSummary = {
  label: string;
  kind: "protein" | "dna" | "rna";
  length: number;
  count: number;
  tokens: number;
  ptms: { code: string; position: number; name: string }[];
  glycans: { residues: string; position: number }[];
};

export type MoleculeSummary = { kind: "ligand" | "ion"; code: string; count: number; tokens: number; name: string };

export type AlphaFoldExport = {
  /** The file's top-level list. One job, but the format requires a list. */
  jobs: AlphaFoldJob[];
  /** The file body, pretty-printed. */
  json: string;
  summary: {
    jobName: string;
    chains: ChainSummary[];
    molecules: MoleculeSummary[];
    tokens: number;
    tokenLimit: number;
    glycanResidues: number;
  };
  warnings: ExportWarning[];
  /** False when there is nothing AlphaFold Server could model. */
  canExport: boolean;
  /** False when the job is over the token limit and nothing could be dropped. */
  fitsTokenLimit: boolean;
};

// --- Vocabulary recognition ----------------------------------------------

/** `ccd_atp`, `CCD_ATP` and `atp` all mean `ATP`. */
export function bareCcdCode(value: string): string {
  const trimmed = value.trim().toUpperCase();
  return trimmed.startsWith("CCD_") ? trimmed.slice(4) : trimmed;
}

type MoleculeMatch = { kind: "ligand" | "ion"; code: string; note?: string };

/**
 * Names a project records for a cofactor, mapped to the CCD code AlphaFold
 * Server uses. Charge notation is stripped before the lookup, so `Zn(2+)` and
 * `zinc` reach the same entry. A `note` marks a substitution that is not an
 * exact chemical match, so the export can say so.
 */
const moleculeAliases: Record<string, MoleculeMatch> = {
  zinc: { kind: "ion", code: "ZN" }, zn: { kind: "ion", code: "ZN" },
  magnesium: { kind: "ion", code: "MG" }, mg: { kind: "ion", code: "MG" },
  calcium: { kind: "ion", code: "CA" }, ca: { kind: "ion", code: "CA" },
  manganese: { kind: "ion", code: "MN" }, mn: { kind: "ion", code: "MN" },
  iron: { kind: "ion", code: "FE" }, fe: { kind: "ion", code: "FE" },
  potassium: { kind: "ion", code: "K" }, k: { kind: "ion", code: "K" },
  sodium: { kind: "ion", code: "NA" }, na: { kind: "ion", code: "NA" },
  copper: { kind: "ion", code: "CU" }, cu: { kind: "ion", code: "CU" },
  cobalt: { kind: "ion", code: "CO" }, co: { kind: "ion", code: "CO" },
  chloride: { kind: "ion", code: "CL" }, chlorine: { kind: "ion", code: "CL" }, cl: { kind: "ion", code: "CL" },
  atp: { kind: "ligand", code: "ATP" }, adp: { kind: "ligand", code: "ADP" }, amp: { kind: "ligand", code: "AMP" },
  gtp: { kind: "ligand", code: "GTP" }, gdp: { kind: "ligand", code: "GDP" },
  fad: { kind: "ligand", code: "FAD" }, "flavin adenine dinucleotide": { kind: "ligand", code: "FAD" },
  nad: { kind: "ligand", code: "NAD" }, "nicotinamide adenine dinucleotide": { kind: "ligand", code: "NAD" },
  nadh: { kind: "ligand", code: "NAD", note: "AlphaFold Server has no reduced NAD; oxidised CCD_NAD was used" },
  nadp: { kind: "ligand", code: "NAP" }, nadph: { kind: "ligand", code: "NDP" },
  heme: { kind: "ligand", code: "HEM" }, haem: { kind: "ligand", code: "HEM" },
  "heme b": { kind: "ligand", code: "HEM" }, "haem b": { kind: "ligand", code: "HEM" },
  "protoporphyrin ix": { kind: "ligand", code: "HEM" },
  "heme c": { kind: "ligand", code: "HEC" }, "haem c": { kind: "ligand", code: "HEC" },
  palmitate: { kind: "ligand", code: "PLM" }, "palmitic acid": { kind: "ligand", code: "PLM" },
  oleate: { kind: "ligand", code: "OLA" }, "oleic acid": { kind: "ligand", code: "OLA" },
  myristate: { kind: "ligand", code: "MYR" }, "myristic acid": { kind: "ligand", code: "MYR" },
  citrate: { kind: "ligand", code: "CIT" }, "citric acid": { kind: "ligand", code: "CIT" },
  "chlorophyll a": { kind: "ligand", code: "CLA" }, "chlorophyll b": { kind: "ligand", code: "CHL" },
  "bacteriochlorophyll a": { kind: "ligand", code: "BCL" }, "bacteriochlorophyll b": { kind: "ligand", code: "BCB" },
};

/**
 * The lookup key for a recorded cofactor name: charge notation, a trailing
 * ChEBI identifier and punctuation removed.
 */
export function moleculeKey(value: string): string {
  return value
    .split("·")[0]
    .replace(/\bCHEBI:\s*\d+/gi, " ")
    .replace(/\(\s*\d*\s*[+-]\s*\)/g, " ")
    .replace(/\d*\s*[+-]\s*$/g, " ")
    .replace(/\b(ions?|cations?|anions?)\b/gi, " ")
    .replace(/[^a-z0-9 ]+/gi, " ")
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

/** The AlphaFold Server entity a recorded cofactor maps to, or null. */
export function recogniseMolecule(value: string): MoleculeMatch | null {
  const code = bareCcdCode(value.split("·")[0]);
  if (Object.prototype.hasOwnProperty.call(ligandAtoms, code)) return { kind: "ligand", code };
  if (ionCodes.includes(code)) return { kind: "ion", code };
  const key = moleculeKey(value);
  if (!key) return null;
  return Object.prototype.hasOwnProperty.call(moleculeAliases, key) ? moleculeAliases[key] : null;
}

/** Residues in a nested glycan string, or null when the string is malformed. */
export function parseGlycan(spec: string): string[] | null {
  const residues: string[] = [];
  let depth = 0;
  let token = "";
  const flush = () => { if (token) { residues.push(token.toUpperCase()); token = ""; } };
  for (const character of spec.trim()) {
    if (character === "(") { flush(); depth += 1; }
    else if (character === ")") { flush(); depth -= 1; if (depth < 0) return null; }
    else if (/[A-Za-z0-9]/.test(character)) token += character;
    else if (/\s/.test(character)) flush();
    else return null;
  }
  flush();
  if (depth !== 0 || !residues.length) return null;
  return residues;
}

// --- The builder ---------------------------------------------------------

/** Whitespace and FASTA line numbers removed, uppercased. */
export function cleanSequence(value: string): string {
  return value.replace(/[\s\d]+/g, "").toUpperCase();
}

function copiesOf(value: number | undefined): number {
  const count = Math.trunc(Number(value ?? 1));
  return Number.isFinite(count) && count >= 1 ? count : 1;
}

function uniqueLetters(value: string): string {
  return [...new Set(value)].join(", ");
}

/**
 * The job AlphaFold Server will accept, the preview that explains it, and a
 * warning for everything that had to be left out or changed on the way.
 */
export function buildAlphaFoldJob(request: AlphaFoldJobRequest): AlphaFoldExport {
  const warnings: ExportWarning[] = [...(request.notes ?? [])];
  const chains: ChainSummary[] = [];
  const molecules: MoleculeSummary[] = [];
  // Entities are collected with their token cost and whether they may be
  // dropped, so an over-limit job can be trimmed before the JSON is written.
  const entries: { entity: AlphaFoldEntity; tokens: number; label: string; required: boolean; summary: ChainSummary | MoleculeSummary }[] = [];
  let glycanBudget = glycanResidueLimit;

  for (const [index, protein] of request.proteins.entries()) {
    const sequence = cleanSequence(protein.sequence ?? "");
    const label = protein.label || `Chain ${index + 1}`;
    if (!sequence) {
      warnings.push({ category: "no-sequence", severity: "excluded", subject: label, message: `${label} has no sequence, so it was left out.` });
      continue;
    }
    const invalid = [...sequence].filter((residue) => !standardResidues.includes(residue));
    if (invalid.length) {
      warnings.push({
        category: "invalid-residue", severity: "excluded", subject: label,
        message: `${label} contains ${uniqueLetters(invalid.join(""))}, which AlphaFold Server does not accept — it models only the 20 standard amino acids. The chain was left out.`,
      });
      continue;
    }

    const count = copiesOf(protein.copies);
    const modifications: AlphaFoldModification[] = [];
    const ptmSummary: ChainSummary["ptms"] = [];
    const taken = new Set<number>();
    let modifiedAtoms = 0;

    for (const ptm of protein.ptms ?? []) {
      const code = bareCcdCode(ptm.code ?? "");
      const subject = ptm.source || `${code || "modification"} at ${ptm.position}`;
      const definition = Object.prototype.hasOwnProperty.call(ptmDefinitions, code) ? ptmDefinitions[code] : null;
      if (!definition) {
        warnings.push({
          category: "unsupported-ptm", severity: "excluded", subject,
          message: `${subject} is not one of the 23 modifications AlphaFold Server supports, so it was left out of ${label}.`,
        });
        continue;
      }
      if (!Number.isInteger(ptm.position) || ptm.position < 1 || ptm.position > sequence.length) {
        warnings.push({
          category: "ptm-position", severity: "excluded", subject,
          message: `${subject} is outside ${label}, which is ${sequence.length} residues long. The modification was left out.`,
        });
        continue;
      }
      const actual = sequence[ptm.position - 1];
      if (actual !== definition.residue) {
        warnings.push({
          category: "ptm-residue", severity: "excluded", subject,
          message: `${subject} is a modified ${definition.residue}, but ${label} has ${actual} at position ${ptm.position}. Annotated positions follow the reference sequence, not this construct, so the modification was left out.`,
        });
        continue;
      }
      if (taken.has(ptm.position)) {
        warnings.push({
          category: "duplicate-ptm", severity: "excluded", subject,
          message: `${label} already carries a modification at position ${ptm.position}; ${subject} was left out because a residue can only be modified once.`,
        });
        continue;
      }
      taken.add(ptm.position);
      modifications.push({ ptmType: `CCD_${code}`, ptmPosition: ptm.position });
      ptmSummary.push({ code, position: ptm.position, name: definition.name });
      modifiedAtoms += definition.atoms;
    }

    const glycans: AlphaFoldGlycan[] = [];
    const glycanSummary: ChainSummary["glycans"] = [];
    let glycanAtomTotal = 0;

    for (const glycan of protein.glycans ?? []) {
      const subject = glycan.source || `${glycan.residues} at ${glycan.position}`;
      if (!Number.isInteger(glycan.position) || glycan.position < 1 || glycan.position > sequence.length) {
        warnings.push({
          category: "glycan-position", severity: "excluded", subject,
          message: `${subject} is outside ${label}, which is ${sequence.length} residues long. The glycan was left out.`,
        });
        continue;
      }
      const site = sequence[glycan.position - 1];
      const allowed = Object.prototype.hasOwnProperty.call(glycanSites, site) ? glycanSites[site] : null;
      if (!allowed) {
        warnings.push({
          category: "glycan-site", severity: "excluded", subject,
          message: `${label} has ${site} at position ${glycan.position}; AlphaFold Server attaches glycans only to N, S or T. The glycan was left out.`,
        });
        continue;
      }
      const canonical = (glycan.residues ?? "").replace(/\s+/g, "").toUpperCase();
      const residues = parseGlycan(glycan.residues ?? "");
      if (!residues) {
        warnings.push({
          category: "unsupported-glycan", severity: "excluded", subject,
          message: `"${glycan.residues}" is not a readable glycan — AlphaFold Server writes them as nested codes such as NAG(NAG)(BMA). It was left out of ${label}.`,
        });
        continue;
      }
      const rejected = [...new Set(residues.filter((residue) => !allowed.includes(residue)))];
      if (rejected.length) {
        warnings.push({
          category: "unsupported-glycan", severity: "excluded", subject,
          message: `${rejected.join(", ")} cannot be attached to ${site}${glycan.position} — AlphaFold Server allows ${allowed.join(", ")} there. ${subject} was left out.`,
        });
        continue;
      }
      if (residues.length > glycanBudget) {
        warnings.push({
          category: "glycan-limit", severity: "excluded", subject,
          message: `A job may carry ${glycanResidueLimit} glycan residues in total. ${subject} would need ${residues.length} more than remain, so it was left out.`,
        });
        continue;
      }
      glycanBudget -= residues.length;
      glycans.push({ residues: canonical, position: glycan.position });
      glycanSummary.push({ residues: canonical, position: glycan.position });
      glycanAtomTotal += residues.reduce((total, residue) => total + glycanAtoms[residue], 0);
    }

    // A standard residue is one token; a modified or glycosylated one is
    // tokenised per atom, so it costs its atom count instead.
    const tokens = count * (sequence.length - modifications.length + modifiedAtoms + glycanAtomTotal);
    const chain: AlphaFoldProteinChain = { sequence, count };
    if (glycans.length) chain.glycans = glycans;
    if (modifications.length) chain.modifications = modifications;
    const summary: ChainSummary = { label, kind: "protein", length: sequence.length, count, tokens, ptms: ptmSummary, glycans: glycanSummary };
    chains.push(summary);
    entries.push({ entity: { proteinChain: chain }, tokens, label, required: protein.required !== false, summary });
  }

  for (const [index, nucleic] of (request.nucleics ?? []).entries()) {
    const label = nucleic.label || `${nucleic.kind.toUpperCase()} ${index + 1}`;
    const sequence = cleanSequence(nucleic.sequence ?? "");
    const alphabet = nucleic.kind === "dna" ? "ATGC" : "AUGC";
    if (!sequence) {
      warnings.push({ category: "no-sequence", severity: "excluded", subject: label, message: `${label} has no sequence, so it was left out.` });
      continue;
    }
    const invalid = [...sequence].filter((base) => !alphabet.includes(base));
    if (invalid.length) {
      warnings.push({
        category: "invalid-residue", severity: "excluded", subject: label,
        message: `${label} contains ${uniqueLetters(invalid.join(""))}; an AlphaFold Server ${nucleic.kind.toUpperCase()} chain allows only ${alphabet.split("").join(", ")}. The chain was left out.`,
      });
      continue;
    }
    const count = copiesOf(nucleic.copies);
    const allowedCodes = nucleic.kind === "dna" ? dnaModificationCodes : rnaModificationCodes;
    const modifications: AlphaFoldBaseModification[] = [];
    for (const modification of nucleic.modifications ?? []) {
      const code = bareCcdCode(modification.code ?? "");
      const subject = modification.source || `${code || "modification"} at ${modification.position}`;
      if (!allowedCodes.includes(code)) {
        warnings.push({
          category: "unsupported-ptm", severity: "excluded", subject,
          message: `${subject} is not an AlphaFold Server ${nucleic.kind.toUpperCase()} modification, so it was left out of ${label}.`,
        });
        continue;
      }
      if (!Number.isInteger(modification.position) || modification.position < 1 || modification.position > sequence.length) {
        warnings.push({
          category: "ptm-position", severity: "excluded", subject,
          message: `${subject} is outside ${label}, which is ${sequence.length} bases long. The modification was left out.`,
        });
        continue;
      }
      modifications.push({ modificationType: `CCD_${code}`, basePosition: modification.position });
    }
    const tokens = count * sequence.length;
    const chain: AlphaFoldNucleicChain = { sequence, count };
    if (modifications.length) chain.modifications = modifications;
    const summary: ChainSummary = { label, kind: nucleic.kind, length: sequence.length, count, tokens, ptms: [], glycans: [] };
    chains.push(summary);
    entries.push({
      entity: nucleic.kind === "dna" ? { dnaSequence: chain } : { rnaSequence: chain },
      tokens, label, required: false, summary,
    });
  }

  // Ligands and ions are merged by code, so two annotations naming the same
  // cofactor become one entity with a higher count.
  const merged = new Map<string, { kind: "ligand" | "ion"; code: string; count: number }>();
  const addMolecule = (requested: SmallMoleculeRequest, declared: "ligand" | "ion" | null) => {
    const raw = (requested.code ?? "").trim();
    const subject = requested.source || raw || "unnamed cofactor";
    if (!raw) return;
    const match = recogniseMolecule(raw);
    if (!match) {
      // The allowed vocabulary is long and the same every time, so it is spelled
      // out once rather than repeated under every cofactor that missed it.
      const first = !warnings.some((warning) => warning.category === "unsupported-ligand");
      warnings.push({
        category: "unsupported-ligand", severity: "excluded", subject,
        message: `AlphaFold Server cannot model "${subject}", so it was left out.${first ? ` It accepts ${Object.keys(ligandAtoms).length} ligands (${Object.keys(ligandAtoms).join(", ")}) and ${ionCodes.length} ions (${ionCodes.join(", ")}).` : ""}`,
      });
      return;
    }
    if (declared && match.kind !== declared) {
      warnings.push({
        category: "reclassified", severity: "adjusted", subject,
        message: `${subject} was recorded as a ${declared} but AlphaFold Server models ${match.code} as ${match.kind === "ion" ? "an ion" : "a ligand"}, so it was exported that way.`,
      });
    }
    if (match.note) {
      warnings.push({ category: "approximation", severity: "adjusted", subject, message: `${subject}: ${match.note}.` });
    }
    const key = `${match.kind}:${match.code}`;
    const existing = merged.get(key);
    const copies = copiesOf(requested.copies);
    if (existing) existing.count += copies;
    else merged.set(key, { kind: match.kind, code: match.code, count: copies });
  };

  for (const cofactor of request.cofactors ?? []) addMolecule(cofactor, null);
  for (const ligand of request.ligands ?? []) addMolecule(ligand, "ligand");
  for (const ion of request.ions ?? []) addMolecule(ion, "ion");

  for (const molecule of merged.values()) {
    const atoms = molecule.kind === "ligand" ? ligandAtoms[molecule.code] : 1;
    const tokens = atoms * molecule.count;
    const summary: MoleculeSummary = {
      kind: molecule.kind, code: molecule.code, count: molecule.count, tokens,
      name: molecule.kind === "ligand" ? `${atoms} atoms per copy` : "single atom",
    };
    molecules.push(summary);
    entries.push({
      entity: molecule.kind === "ligand" ? { ligand: { ligand: `CCD_${molecule.code}`, count: molecule.count } } : { ion: { ion: molecule.code, count: molecule.count } },
      tokens, label: molecule.code, required: false, summary,
    });
  }

  // Trim to the token limit by dropping optional entities, newest first. The
  // required chains are never dropped and counts are never reduced: silently
  // turning a homodimer into a monomer would change the question being asked.
  // Trimming only starts when it can actually succeed — throwing away the
  // cofactors of a job that is over the limit on its chains alone would cost
  // the scientist their ligands and still leave them with an invalid job.
  const dropped = new Set<number>();
  let tokens = entries.reduce((total, entry) => total + entry.tokens, 0);
  const requiredTokens = entries.reduce((total, entry) => total + (entry.required ? entry.tokens : 0), 0);
  for (let index = entries.length - 1; index >= 0 && tokens > tokenLimit && requiredTokens <= tokenLimit; index -= 1) {
    if (entries[index].required) continue;
    const entry = entries[index];
    dropped.add(index);
    tokens -= entry.tokens;
    warnings.push({
      category: "token-limit", severity: "excluded", subject: entry.label,
      message: `${entry.label} was left out to bring the job under AlphaFold Server's ${tokenLimit.toLocaleString("en-US")}-token limit. It cost ${entry.tokens.toLocaleString("en-US")} ${entry.tokens === 1 ? "token" : "tokens"}.`,
    });
  }

  const kept = entries.filter((_entry, index) => !dropped.has(index));
  const keptSummaries = new Set(kept.map((entry) => entry.summary));
  const finalChains = chains.filter((chain) => keptSummaries.has(chain));
  const finalMolecules = molecules.filter((molecule) => keptSummaries.has(molecule));
  const fitsTokenLimit = tokens <= tokenLimit;

  if (!fitsTokenLimit) {
    warnings.push({
      category: "token-limit", severity: "blocking", subject: "Token limit",
      message: `This job needs about ${tokens.toLocaleString("en-US")} tokens and AlphaFold Server allows ${tokenLimit.toLocaleString("en-US")}. Nothing optional was left to drop, so shorten the construct or model fewer copies before uploading.`,
    });
  }
  if (!kept.length) {
    warnings.push({
      category: "empty-job", severity: "blocking", subject: "Job",
      message: "Nothing in this project can be modelled by AlphaFold Server yet, so there is no job to export.",
    });
  }

  const job: AlphaFoldJob = {
    name: cleanJobName(request.jobName),
    modelSeeds: [],
    sequences: kept.map((entry) => entry.entity),
    dialect: "alphafoldserver",
    version: 1,
  };
  const jobs = [job];

  return {
    jobs,
    json: `${JSON.stringify(jobs, null, 2)}\n`,
    summary: {
      jobName: job.name,
      chains: finalChains,
      molecules: finalMolecules,
      tokens,
      tokenLimit,
      glycanResidues: glycanResidueLimit - glycanBudget,
    },
    warnings,
    canExport: kept.length > 0,
    fitsTokenLimit,
  };
}

/** A job name AlphaFold Server will show intact in its history table. */
export function cleanJobName(value: string | undefined): string {
  const cleaned = (value ?? "").replace(/[\r\n\t]+/g, " ").replace(/\s+/g, " ").trim();
  return (cleaned || "Protein Lab job").slice(0, 120);
}

/** `<project>-af-server.json`, safe on every platform the desktop app runs on. */
export function alphaFoldFileName(projectName: string): string {
  const stem = projectName.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "protein-project";
  return `${stem}-af-server.json`;
}
