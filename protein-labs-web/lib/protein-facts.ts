// What earlier jobs already found out about a protein, gathered in one place so
// a new job (Crystallize, HSQC, the 2D ligand view) never asks for it again.
//
// Every fact is either known, with the job and date it came from, or missing,
// with the job that would produce it and a plain-language reason. Project job
// configs are untyped, so each reader below follows the component that writes
// that config; the writer is named above each one. Older saved shapes are
// read too where a writer changed.
//
// Only erasable TypeScript syntax is used, so the unit tests run under Node
// without a bundler.
import type { JsonObject, ProjectJob, ProteinBundle } from "./protein-labs-api.ts";
import type { CitationId } from "./citations.ts";
import { cofactorKey, splitCofactorText } from "./alphafold-server-export.ts";
import { preferredJob, type ConservationJobSummary } from "./conservation.ts";
import { researchHits, type ResearchHit } from "./structure-hits.ts";

/** A workflow job that records facts: its id in `workflowJobs` and its title. */
export type FactJob = { jobId: string; appType: string; label: string };

export const FACT_JOBS = {
  sequence: { jobId: "sequence", appType: "protein-planner", label: "Protein sequence" },
  research: { jobId: "research", appType: "database-research", label: "Sequence research" },
  reference: { jobId: "reference-match", appType: "reference-match", label: "Choose reference match" },
  structure: { jobId: "structure", appType: "alphafold", label: "Structure Viewer" },
  readiness: { jobId: "readiness", appType: "protein-readiness", label: "Protein readiness check" },
} as const satisfies Record<string, FactJob>;

/** Where a known fact came from. `date` is ISO 8601, or null when nothing recorded one. */
export type FactSource = FactJob & {
  /** The saved project job, when the fact lives in one; engine tables have none. */
  projectJobId: string | null;
  date: string | null;
  /** What exactly was read, e.g. "UniProt P00918" or "ConSurf-DB · 5Y2S chain A". */
  detail: string;
  /** The public record behind the fact, for a visible citation. */
  url: string | null;
};

export type KnownFact<T> = { status: "known"; value: T; sources: FactSource[] };
export type MissingFact = { status: "missing"; producedBy: FactJob; reason: string };
export type Fact<T> = KnownFact<T> | MissingFact;

/** A saved readiness answer. Legacy saves are mapped onto these four. */
export type ReviewAnswer = "Yes" | "No" | "Needs follow-up" | "Not reviewed";

/** A UniProt feature as `normalize_uniprot` stores it; positions are on the reference, 1-based. */
export type ReferenceRegion = { type: string; description: string; start: number | null; end: number | null };

export type ReferenceFact = { accession: string; proteinName: string; organism: string; identity: number | null; queryCoverage: number | null; reviewed: boolean };

export type RegionFact = {
  /** `yes` / `no` from the scientist's review, else from reference regions; `uncertain` when flagged for follow-up. */
  verdict: "yes" | "no" | "uncertain";
  answer: ReviewAnswer;
  /** Regions the reference reports. Reference numbering: check offsets before mapping onto the construct. */
  regions: ReferenceRegion[];
  /** The readiness check's own explanation of the evidence, when saved. */
  evidence: string;
};

export type Cofactor = {
  name: string;
  chebiId: string | null;
  /** The `cofactorKey` the entries were merged on, so callers dedupe the same way. */
  key: string;
  sources: FactSource[];
};

export type CofactorFact = {
  /** The scientist's answer to "Requires a cofactor?" in the readiness check. */
  required: ReviewAnswer;
  cofactors: Cofactor[];
};

export type UnitCell = { a: number; b: number; c: number; alpha: number; beta: number; gamma: number };

/** One row of `_exptl_crystal_grow`, as reported in the deposited mmCIF. */
export type CrystalGrowth = { method: string | null; pH: number | null; temperatureK: number | null; details: string | null };

export type PdbHit = ResearchHit & {
  /** Hermann–Mauguin symbol, e.g. "P 1 21 1"; null until the engine records it. */
  spaceGroup: string | null;
  /** Ångström and degrees; null until the engine records it. */
  unitCell: UnitCell | null;
  crystalGrowth: CrystalGrowth[];
  entryUrl: string;
  fetchedAt: string | null;
};

export type PdbHitsFact = {
  hits: PdbHit[];
  /** True when the search ran and no entry matched: a real result, not a gap. */
  searchedWithoutHits: boolean;
};

export type ConservationFact = {
  runId: string;
  source: string;
  pdbId: string;
  chain: string;
  residueCount: number;
  meanGrade: number | null;
  /** The sequence the grades are numbered along (ConSurf-DB numbers the representative chain). */
  gradedSequence: string | null;
};

export type AlphaFoldModel = {
  modelId: string;
  source: string;
  accession: string;
  name: string;
  /** Mean predicted lDDT, 0–100; null when the engine could not read it. */
  meanPlddt: number | null;
  /** True only when AlphaFold DB's sequence matched the construct exactly. */
  sequenceExact: boolean | null;
  url: string | null;
  importedAt: string | null;
};

export type ProteinFacts = {
  sequence: Fact<{ sequence: string; length: number }>;
  reference: Fact<ReferenceFact>;
  membrane: Fact<RegionFact>;
  disorder: Fact<RegionFact>;
  cofactors: Fact<CofactorFact>;
  pdbHits: Fact<PdbHitsFact>;
  conservation: Fact<ConservationFact>;
  alphaFoldModels: Fact<AlphaFoldModel[]>;
};

export type FactKey = keyof ProteinFacts;

/**
 * A title and a one-paragraph student explanation for every fact, with the
 * sources behind any database, tool or rule of thumb the explanation names.
 */
export const FACT_GUIDE: Record<FactKey, { label: string; explanation: string; citations: CitationId[] }> = {
  sequence: { label: "Amino-acid sequence", explanation: "The chain of amino acids your construct is made of, written one letter per residue. Every other prediction starts from it.", citations: [] },
  reference: { label: "UniProt reference", explanation: "The UniProt entry you chose as the closest known relative of your protein. Its curated notes (cofactors, membrane segments, disordered stretches) are borrowed from it, so they are only as good as the match.", citations: ["uniprot2023"] },
  membrane: { label: "Membrane protein", explanation: "Membrane proteins sit partly inside the cell's oily lipid membrane. Their membrane-spanning stretches are greasy, so they need detergents or lipids to stay folded outside the cell, which changes how you purify, crystallise or measure them.", citations: ["caffrey2015"] },
  disorder: { label: "Disordered regions", explanation: "Some stretches of a protein never settle into a fixed shape. They are flexible, so they blur crystal packing and give sharp, crowded NMR peaks. Knowing where they are tells you what to trim or expect.", citations: ["dale2003"] },
  cofactors: { label: "Ligands and cofactors", explanation: "Small molecules or metal ions the protein binds to work, such as heme or zinc. A protein purified without its cofactor may be unstable or inactive, and the cofactor shows up in structures and spectra.", citations: [] },
  pdbHits: { label: "Experimental structures (PDB)", explanation: "Structures of this or a closely related protein already solved by X-ray crystallography, NMR or cryo-EM and deposited in the Protein Data Bank. Crystal entries record how the crystals were grown.", citations: ["pdb2000"] },
  conservation: { label: "Conservation (ConSurf)", explanation: "How much each position varies across related proteins in evolution, on ConSurf's 1 (variable) to 9 (conserved) scale. Conserved positions are usually important for folding or function.", citations: ["consurf2023"] },
  // pLDDT is defined by Jumper et al.; the "below about 50" band is from Tunyasuvunakool et al.
  alphaFoldModels: { label: "AlphaFold models", explanation: "Predicted 3D structures from AlphaFold. The pLDDT score (0–100) says how confident the prediction is at each residue; below about 50 a region is often disordered rather than wrongly predicted.", citations: ["alphafold2021", "tunyasuvunakool2021"] },
};

export function proteinFacts(bundle: ProteinBundle): ProteinFacts {
  const reference = referenceRecord(bundle);
  return {
    sequence: sequenceFact(bundle),
    reference: referenceFact(bundle, reference),
    membrane: regionFact(bundle, reference, "membraneProtein", "membraneEvidence", "transmembraneRegions", "membrane"),
    disorder: regionFact(bundle, reference, "intrinsicallyDisordered", "disorderEvidence", "disorderedRegions", "disorder"),
    cofactors: cofactorFact(bundle, reference),
    pdbHits: pdbHitsFact(bundle),
    conservation: conservationFact(bundle.conservationJobs ?? []),
    alphaFoldModels: alphaFoldFact(bundle),
  };
}

/** The facts no earlier job has produced yet, in display order, for a "still to do" list. */
export function missingFacts(facts: ProteinFacts): { key: FactKey; label: string; producedBy: FactJob; reason: string }[] {
  return (Object.keys(FACT_GUIDE) as FactKey[]).flatMap((key) => {
    const fact = facts[key];
    return fact.status === "missing" ? [{ key, label: FACT_GUIDE[key].label, producedBy: fact.producedBy, reason: fact.reason }] : [];
  });
}

// ── Sequence ────────────────────────────────────────────────────────────────
// Writer: the protein record itself (`job-workspace.tsx` SequenceJob), plus a
// `protein-planner` job `{ sequenceLength, savedByUser }` that dates the save.

function sequenceFact(bundle: ProteinBundle): ProteinFacts["sequence"] {
  const sequence = bundle.protein.sequence.replace(/\s+/g, "").toUpperCase();
  if (!sequence) return missing(FACT_JOBS.sequence, "No amino-acid sequence is saved for this project yet. Add it in Protein sequence.");
  const job = latestJob(bundle, FACT_JOBS.sequence.appType);
  return known({ sequence, length: sequence.length }, [source(FACT_JOBS.sequence, job, job?.updatedAt ?? bundle.protein.updatedAt ?? null, `${sequence.length} residues`, null)]);
}

// ── Reference match ─────────────────────────────────────────────────────────
// Writer: `reference-match-job.tsx` saves
//   { selectedAccession, selectedProteinName, selectedOrganism, identity,
//     queryCoverage, reviewed, evidenceSnapshot: { postTranslationalModifications,
//     cofactors, subcellularLocations, transmembraneRegions, disorderedRegions },
//     selectedAt, savedByUser }.
// The live UniProt record in `bundle.uniprotMatches` is preferred, as the
// readiness check does; the snapshot stands in once that match is gone.

type Reference = { job: ProjectJob | null; config: JsonObject; accession: string; record: JsonObject };

function referenceRecord(bundle: ProteinBundle): Reference {
  const job = latestJob(bundle, FACT_JOBS.reference.appType);
  const config = job?.config ?? {};
  const accession = text(config.selectedAccession);
  const live = accession ? bundle.uniprotMatches.map(recordFor).find((record) => text(record.accession) === accession) : undefined;
  return { job, config, accession, record: live && Object.keys(live).length ? live : asObject(config.evidenceSnapshot) };
}

function referenceFact(bundle: ProteinBundle, reference: Reference): ProteinFacts["reference"] {
  if (!reference.accession) {
    return missing(FACT_JOBS.reference, bundle.uniprotMatches.length
      ? "UniProt matches were found but none has been chosen as the reference. Pick one in Choose reference match."
      : "No UniProt reference has been chosen. Run the UniProt search in Sequence research, then pick a match in Choose reference match.");
  }
  const { config, record } = reference;
  const value: ReferenceFact = {
    accession: reference.accession,
    proteinName: text(config.selectedProteinName) || text(record.proteinName),
    organism: text(config.selectedOrganism) || text(asObject(record.organism).scientificName),
    identity: numberOrNull(config.identity),
    queryCoverage: numberOrNull(config.queryCoverage),
    reviewed: config.reviewed === true || record.reviewed === true,
  };
  return known(value, [referenceSource(reference)]);
}

function referenceSource(reference: Reference): FactSource {
  return source(FACT_JOBS.reference, reference.job, text(reference.config.selectedAt) || reference.job?.updatedAt || null, `UniProt ${reference.accession}`, uniProtUrl(reference.accession));
}

// ── Membrane and disorder ───────────────────────────────────────────────────
// Writer: `protein-readiness-job.tsx` saves `membraneProtein` /
// `intrinsicallyDisordered` as one of the four `ReviewAnswer`s, with
// `membraneEvidence` / `disorderEvidence` text and `reviewedAt`. The retired
// readiness form in `job-workspace.tsx` saved `membraneProtein` as a boolean
// from a hydrophobic-window screen, `intrinsicallyDisordered: "review"` and
// `checkedAt`; those still exist in older projects.

function regionFact(
  bundle: ProteinBundle,
  reference: Reference,
  answerKey: "membraneProtein" | "intrinsicallyDisordered",
  evidenceKey: "membraneEvidence" | "disorderEvidence",
  regionKey: "transmembraneRegions" | "disorderedRegions",
  topic: "membrane" | "disorder",
): Fact<RegionFact> {
  const readiness = latestJob(bundle, FACT_JOBS.readiness.appType);
  const config = readiness?.config ?? {};
  const answer = reviewAnswer(config[answerKey]);
  const regions = asObjects(reference.record[regionKey]).map(region);
  const sources: FactSource[] = [];
  if (answer !== "Not reviewed") sources.push(readinessSource(readiness));
  if (regions.length) sources.push(referenceSource(reference));
  if (!sources.length) {
    const subject = topic === "membrane" ? "whether this is a membrane protein" : "whether this protein has disordered regions";
    const hint = reference.accession
      ? `The reference ${reference.accession} reports no ${topic === "membrane" ? "membrane-spanning" : "disordered"} regions, which is not proof of absence.`
      : "No UniProt reference has been chosen either.";
    return missing(FACT_JOBS.readiness, `No one has reviewed ${subject}. ${hint} Answer it in Protein readiness check.`);
  }
  const verdict = answer === "Yes" ? "yes" : answer === "No" ? "no" : answer === "Needs follow-up" ? "uncertain" : "yes";
  return known({ verdict, answer, regions, evidence: text(config[evidenceKey]) }, sources);
}

function reviewAnswer(value: unknown): ReviewAnswer {
  // The retired form's boolean came from a composition screen, not a review:
  // true is a flag to follow up, false says nothing either way.
  if (value === true) return "Needs follow-up";
  const answer = text(value);
  return answer === "Yes" || answer === "No" || answer === "Needs follow-up" ? answer : "Not reviewed";
}

function region(feature: JsonObject): ReferenceRegion {
  // `normalize_uniprot` nests positions in `location`; hand-built snapshots flatten them.
  const location = asObject(feature.location);
  return { type: text(feature.type), description: text(feature.description), start: position(location.start ?? feature.start), end: position(location.end ?? feature.end) };
}

function readinessSource(job: ProjectJob | null): FactSource {
  const config = job?.config ?? {};
  return source(FACT_JOBS.readiness, job, text(config.reviewedAt) || text(config.checkedAt) || job?.updatedAt || null, "Scientist's review", null);
}

// ── Ligands and cofactors ───────────────────────────────────────────────────
// Writers: the reference's `cofactors` (`normalize_uniprot`: `{ name, chebiId,
// evidences }`), and the readiness check's `cofactorRequired` answer with
// free-text `cofactorDetails`. The readiness text is pre-filled from the
// reference as `name · CHEBI:id`, so entries are merged on `cofactorKey`, the
// molecule they resolve to, never on the raw text. The retired form saved a
// single free-text `cofactor` defaulting to "None known".

function cofactorFact(bundle: ProteinBundle, reference: Reference): ProteinFacts["cofactors"] {
  const readiness = latestJob(bundle, FACT_JOBS.readiness.appType);
  const config = readiness?.config ?? {};
  const required = reviewAnswer(config.cofactorRequired);
  const merged = new Map<string, Cofactor>();
  const add = (raw: string, chebi: string, from: FactSource) => {
    const [namePart, ...rest] = raw.split("·").map((part) => part.trim());
    const name = namePart.trim();
    if (!name) return;
    const chebiId = chebi || rest.find((part) => /^CHEBI:\d+$/i.test(part))?.toUpperCase() || null;
    const key = cofactorKey(name);
    const existing = merged.get(key);
    if (existing) {
      existing.chebiId ??= chebiId;
      if (!existing.sources.some((item) => item.appType === from.appType)) existing.sources.push(from);
      return;
    }
    merged.set(key, { name, chebiId, key, sources: [from] });
  };
  const referenceCofactors = asObjects(reference.record.cofactors);
  if (referenceCofactors.length) {
    const from = referenceSource(reference);
    for (const item of referenceCofactors) add(text(item.name), text(item.chebiId), from);
  }
  const legacy = text(config.cofactor);
  const details = text(config.cofactorDetails) || (legacy === "None known" ? "" : legacy);
  if (details) {
    const from = readinessSource(readiness);
    for (const part of splitCofactorText(details)) add(part, "", from);
  }
  const cofactors = [...merged.values()];
  if (!cofactors.length && required === "Not reviewed") {
    return missing(FACT_JOBS.readiness, reference.accession
      ? `The reference ${reference.accession} lists no cofactors and no one has reviewed whether one is needed. Answer it in Protein readiness check.`
      : "No cofactor is recorded. Choose a UniProt reference, or answer “Requires a cofactor?” in Protein readiness check.");
  }
  const sources = uniqueSources(cofactors.flatMap((item) => item.sources));
  if (required !== "Not reviewed" && !sources.some((item) => item.appType === FACT_JOBS.readiness.appType)) sources.unshift(readinessSource(readiness));
  return known({ required, cofactors }, sources);
}

// ── PDB hits ────────────────────────────────────────────────────────────────
// Writer: the engine's RCSB search (`RCSBPDBClient.fetch_record`), one record
// per matching entity, saved to `bundle.pdbMatches` with `fetchedAt`. The
// Sequence research job marks the search as run with
// `{ savedSources: [..., "PDB"], updatedAt, savedByUser }`.
// `spaceGroup` and `unitCell` are read when the engine provides them.

function pdbHitsFact(bundle: ProteinBundle): ProteinFacts["pdbHits"] {
  const research = latestJob(bundle, FACT_JOBS.research.appType);
  const searched = Array.isArray(research?.config.savedSources) && research.config.savedSources.map(String).includes("PDB");
  const records = bundle.pdbMatches.filter((record) => researchHits([record]).length);
  if (!records.length && !searched) return missing(FACT_JOBS.research, "No PDB search has been run for this sequence. Run the PDB search in Sequence research.");
  const byId = new Map<string, JsonObject[]>();
  for (const record of records) {
    const id = text(record.pdbId).toUpperCase();
    byId.set(id, [...(byId.get(id) ?? []), record]);
  }
  const hits: PdbHit[] = researchHits(records).map((hit) => {
    const entries = byId.get(hit.pdbId) ?? [];
    const first = entries[0] ?? {};
    return {
      ...hit,
      spaceGroup: entries.map((entry) => spaceGroup(entry)).find(Boolean) ?? null,
      unitCell: entries.map((entry) => unitCell(entry)).find(Boolean) ?? null,
      crystalGrowth: asObjects(asObject(first.crystallizationConditions).crystalGrowth).map(crystalGrowth),
      entryUrl: text(asObject(first.source).entryUrl) || `https://www.rcsb.org/structure/${hit.pdbId}`,
      fetchedAt: latest(entries.map((entry) => text(entry.fetchedAt))),
    };
  });
  const date = latest(hits.map((hit) => hit.fetchedAt ?? "")) ?? (text(research?.config.updatedAt) || research?.updatedAt || null);
  const detail = hits.length ? `RCSB PDB sequence search · ${hits.length} ${hits.length === 1 ? "entry" : "entries"}` : "RCSB PDB sequence search · no matching entries";
  return known({ hits, searchedWithoutHits: !hits.length }, [source(FACT_JOBS.research, research, date, detail, "https://www.rcsb.org/")]);
}

function spaceGroup(record: JsonObject): string | null {
  // Proposed engine field, with RCSB's own `symmetry.space_group_name_hm` as fallback.
  return text(record.spaceGroup) || text(asObject(record.symmetry).space_group_name_hm) || null;
}

function unitCell(record: JsonObject): UnitCell | null {
  const cell = asObject(record.unitCell ?? record.cell);
  const read = (...keys: string[]) => keys.map((key) => numberOrNull(cell[key])).find((value) => value !== null) ?? null;
  const value = { a: read("a", "length_a"), b: read("b", "length_b"), c: read("c", "length_c"), alpha: read("alpha", "angle_alpha"), beta: read("beta", "angle_beta"), gamma: read("gamma", "angle_gamma") };
  return Object.values(value).every((item) => item !== null) ? value as UnitCell : null;
}

function crystalGrowth(row: JsonObject): CrystalGrowth {
  return { method: text(row.method) || null, pH: numberOrNull(row.pH), temperatureK: numberOrNull(row.temp), details: text(row.pdbx_details) || null };
}

// ── Conservation ────────────────────────────────────────────────────────────
// Writer: the engine's conservation runs, summarised in
// `bundle.conservationJobs` (CONSERVATION_API.md). Only a complete run with
// grades counts; a pending submission is reported as missing.

function conservationFact(runs: ConservationJobSummary[]): ProteinFacts["conservation"] {
  const run = preferredJob(runs);
  if (!run || run.status !== "complete" || run.residueCount <= 0) {
    const reason = run
      ? `A ConSurf run exists but has no grades yet (${run.stage || run.status}). Finish or import it in the Conservation panel of Sequence research.`
      : "No conservation analysis has been run. Look up ConSurf-DB or import ConSurf grades in the Conservation panel of Sequence research.";
    return missing(FACT_JOBS.research, reason);
  }
  const chain = [run.metadata.identicalPdbId || run.pdbId, run.metadata.identicalChain || run.chain].filter(Boolean).join(" chain ");
  const detail = run.source === "consurf-db" ? `ConSurf-DB · ${chain || "pre-calculated"}` : run.source === "consurf-server-import" ? "ConSurf server · imported grades" : "ConSurf";
  return known({
    runId: run.id,
    source: run.source,
    pdbId: run.pdbId,
    chain: run.chain,
    residueCount: run.residueCount,
    meanGrade: numberOrNull(run.metadata.meanGrade),
    gradedSequence: run.metadata.gradedSequence || null,
  }, [source(FACT_JOBS.research, null, run.updatedAt || run.createdAt || null, detail, run.metadata.entryUrl || "https://consurf.tau.ac.il/")]);
}

// ── AlphaFold models ────────────────────────────────────────────────────────
// Writer: the engine's `alphafold_models` table (`Database._alphafold`):
// `{ modelId, source, accession, name, format, metadata, importedAt }`.
// AlphaFold DB metadata carries the prediction record plus `entryUrl`,
// `meanPlddt` and `sequenceMatch`; Server imports carry `meanPlddt` and
// `importedFile`. The Structure Viewer's `alphafold` job only notes the save.

function alphaFoldFact(bundle: ProteinBundle): ProteinFacts["alphaFoldModels"] {
  const models: AlphaFoldModel[] = bundle.alphaFoldModels.flatMap((raw) => {
    const modelId = text(raw.modelId);
    if (!modelId) return [];
    const metadata = asObject(raw.metadata);
    const match = asObject(metadata.sequenceMatch);
    return [{
      modelId,
      source: text(raw.source) || "AlphaFold",
      accession: text(raw.accession),
      name: text(raw.name) || modelId,
      meanPlddt: numberOrNull(metadata.meanPlddt ?? metadata.globalMetricValue),
      sequenceExact: typeof match.sequenceExact === "boolean" ? match.sequenceExact : null,
      url: text(metadata.entryUrl) || null,
      importedAt: text(raw.importedAt) || null,
    }];
  });
  if (!models.length) {
    const pending = latestJob(bundle, FACT_JOBS.structure.appType)?.status === "in_progress";
    return missing(FACT_JOBS.structure, pending
      ? "An AlphaFold Server job was prepared but no result has been imported. Import the result in Structure Viewer."
      : "No AlphaFold model is saved. Fetch the AlphaFold DB model, or import an AlphaFold Server result, in Structure Viewer.");
  }
  const job = latestJob(bundle, FACT_JOBS.structure.appType);
  const sources = models.map((model) => source(FACT_JOBS.structure, job, model.importedAt, `${model.source} · ${model.modelId}`, model.url));
  return known(models, sources);
}

// ── Shared readers ──────────────────────────────────────────────────────────

function known<T>(value: T, sources: FactSource[]): KnownFact<T> {
  return { status: "known", value, sources };
}

function missing(producedBy: FactJob, reason: string): MissingFact {
  return { status: "missing", producedBy, reason };
}

function source(job: FactJob, saved: ProjectJob | null, date: string | null, detail: string, url: string | null): FactSource {
  return { ...job, projectJobId: saved?.id ?? null, date, detail, url };
}

function uniqueSources(sources: FactSource[]) {
  const seen = new Set<string>();
  return sources.filter((item) => { const key = `${item.appType}:${item.detail}`; if (seen.has(key)) return false; seen.add(key); return true; });
}

/** The most recently updated job of a type; `ensureProjectJob` keeps one, but older projects can hold several. */
function latestJob(bundle: ProteinBundle, appType: string): ProjectJob | null {
  return bundle.projectJobs.filter((job) => job.appType === appType).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0] ?? null;
}

function latest(dates: string[]) {
  return dates.filter(Boolean).sort().at(-1) ?? null;
}

function recordFor(match: JsonObject): JsonObject {
  const record = asObject(match.record);
  return Object.keys(record).length ? record : match;
}

function uniProtUrl(accession: string) {
  return `https://www.uniprot.org/uniprotkb/${accession}/entry`;
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function asObjects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function text(value: unknown): string {
  return typeof value === "string" ? value.trim() : typeof value === "number" && Number.isFinite(value) ? String(value) : "";
}

function numberOrNull(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function position(value: unknown): number | null {
  const raw = Number(asObject(value).value ?? value);
  return Number.isInteger(raw) && raw >= 1 ? raw : null;
}
