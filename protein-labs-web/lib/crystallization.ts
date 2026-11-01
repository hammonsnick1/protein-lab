// Crystallize your protein: the engine's crystallization assessment read into
// typed values, and how each fact from an earlier job changes the advice.
//
// The engine contract is `protein-labs/backend/CRYSTALLIZATION_API.md`. The
// engine never invents a score: while Shoebill, the PLM predictor and MASCL
// are not bundled, `score.value` is null and the uncertainty is not
// quantified. The readers below accept the fields the contract promises for
// executed predictors too (a score with `lower`/`upper`, explaining
// `features`, MASCL `spaceGroups`), so the screen needs no change when a
// predictor starts running.
//
// The facts come from the shared protein-facts helper, never from a form, so
// the scientist is not asked again for what an earlier job already knows.
//
// Only erasable TypeScript syntax is used, so the unit tests run under Node
// without a bundler.
import type { JsonObject } from "./protein-labs-api.ts";
import type { CitationId } from "./citations.ts";
import { FACT_GUIDE, type FactJob, type FactKey, type FactSource, type ProteinFacts } from "./protein-facts.ts";

// ── Engine assessment ───────────────────────────────────────────────────────

export type PredictorStatus = "ran" | "unavailable";

/** One input a predictor weighed, as the engine explains it. */
export type PredictorFeature = {
  name: string;
  /** The value as the engine formats it, e.g. "0.42" or "12 residues". */
  value: string;
  /** Which way it pushed the score. */
  effect: "raises" | "lowers" | "neutral";
  plainLanguage: string;
};

export type SpaceGroupGuess = { spaceGroup: string; probability: number | null };

export type Predictor = {
  id: string;
  name: string;
  status: PredictorStatus;
  /** Probability 0–1, only when the predictor actually ran. */
  score: number | null;
  lower: number | null;
  upper: number | null;
  /** Why it did or did not run, in the engine's words. */
  reason: string;
  sourceLabel: string;
  sourceUrl: string;
  features: PredictorFeature[];
  /** MASCL only: predicted space groups, most likely first. */
  spaceGroups: SpaceGroupGuess[];
};

/** A space group to look at first, and where the suggestion came from. */
export type SpaceGroupSuggestion = {
  /** Hermann–Mauguin symbol with single spaces, e.g. "P 21 21 21". */
  spaceGroup: string;
  origin: "mascl" | "homologue";
  /** MASCL's probability for this group; null for homologue reports. */
  probability: number | null;
  /** How many saved PDB homologues crystallised in it; 0 for MASCL-only groups. */
  homologueCount: number;
};

export type AdviceDirection = "caution" | "action" | "support" | "missing_evidence";

export type Assessment = {
  proteinId: string;
  method: { name: string; version: string; plainLanguage: string };
  score: { value: number | null; status: string; plainLanguage: string };
  uncertainty: { lower: number | null; upper: number | null; status: string; plainLanguage: string };
  predictors: Predictor[];
  spaceGroups: SpaceGroupSuggestion[];
  explanations: { direction: AdviceDirection; summary: string; source: string }[];
  recommendation: string;
};

/** The registry entry each known predictor is cited with. */
export const PREDICTOR_CITATIONS: Record<string, CitationId> = { shoebill: "shoebill2026", plm: "mall2025plm", mascl: "mascl2025" };

/** Read an engine response; anything malformed falls back to "not available", never to a number. */
export function readAssessment(raw: unknown): Assessment {
  const body = asObject(raw);
  const method = asObject(body.method);
  const score = asObject(body.score);
  const uncertainty = asObject(body.uncertainty);
  const predictors = asObjects(body.predictors).map(readPredictor);
  return {
    proteinId: text(body.proteinId),
    method: { name: text(method.name) || "Crystallization evidence combiner", version: text(method.version), plainLanguage: text(method.plainLanguage) },
    score: { value: probability(score.value), status: text(score.status) || "unavailable", plainLanguage: text(score.plainLanguage) },
    uncertainty: { lower: probability(uncertainty.lower), upper: probability(uncertainty.upper), status: text(uncertainty.status) || "not_quantified", plainLanguage: text(uncertainty.plainLanguage) },
    predictors,
    spaceGroups: mergeSpaceGroups(predictors.find((item) => item.id === "mascl")?.spaceGroups ?? [], asObjects(body.spaceGroupSuggestions)),
    explanations: asObjects(body.explanations).flatMap((item) => {
      const summary = text(item.summary);
      const direction = text(item.direction);
      return summary ? [{ direction: (["caution", "action", "support"].includes(direction) ? direction : "missing_evidence") as AdviceDirection, summary, source: text(item.source) }] : [];
    }),
    recommendation: text(body.recommendation),
  };
}

function readPredictor(raw: JsonObject): Predictor {
  const source = asObject(raw.source);
  const score = probability(raw.score);
  return {
    id: text(raw.id),
    name: text(raw.name) || text(raw.id),
    // A predictor only counts as run when it returned a score.
    status: text(raw.status) === "ran" && score !== null ? "ran" : "unavailable",
    score,
    lower: probability(raw.lower),
    upper: probability(raw.upper),
    reason: text(raw.reason),
    sourceLabel: text(source.label),
    sourceUrl: text(source.url),
    features: asObjects(raw.features).flatMap((item) => {
      const name = text(item.name);
      const effect = text(item.effect);
      return name ? [{ name, value: text(item.value), effect: (effect === "raises" || effect === "lowers" ? effect : "neutral") as PredictorFeature["effect"], plainLanguage: text(item.plainLanguage) }] : [];
    }),
    spaceGroups: (Array.isArray(raw.spaceGroups) ? raw.spaceGroups : []).flatMap((item): SpaceGroupGuess[] => {
      const entry = typeof item === "string" ? { spaceGroup: item } : asObject(item);
      const symbol = spaceGroupSymbol(entry.spaceGroup);
      return symbol ? [{ spaceGroup: symbol, probability: probability(entry.probability ?? entry.score) }] : [];
    }),
  };
}

/** MASCL's groups first, in its order; homologue reports after, most common first. A group in both keeps both. */
function mergeSpaceGroups(mascl: SpaceGroupGuess[], reported: JsonObject[]): SpaceGroupSuggestion[] {
  const merged = new Map<string, SpaceGroupSuggestion>();
  for (const guess of mascl) if (!merged.has(guess.spaceGroup)) merged.set(guess.spaceGroup, { spaceGroup: guess.spaceGroup, origin: "mascl", probability: guess.probability, homologueCount: 0 });
  const counts = reported.flatMap((item) => {
    const symbol = spaceGroupSymbol(item.spaceGroup);
    const count = Number(item.homologueCount);
    return symbol ? [{ symbol, count: Number.isInteger(count) && count > 0 ? count : 1 }] : [];
  }).sort((a, b) => b.count - a.count);
  for (const { symbol, count } of counts) {
    const existing = merged.get(symbol);
    if (existing) existing.homologueCount += count;
    else merged.set(symbol, { spaceGroup: symbol, origin: "homologue", probability: null, homologueCount: count });
  }
  return [...merged.values()];
}

/** "P212121" and "P 21 21 21" are the same group; RCSB writes the spaced form. */
export function spaceGroupSymbol(value: unknown): string {
  return text(value).replace(/\s+/g, " ");
}

// ── Headline score ──────────────────────────────────────────────────────────

/**
 * What the headline shows. A range is the honest form of a prediction; a bare
 * value is shown only with a warning that its uncertainty is unknown, and no
 * value at all is shown as unavailable, with the engine's reason.
 */
export type ScoreView =
  | { kind: "range"; value: number | null; lower: number; upper: number; reading: string }
  | { kind: "point"; value: number; reading: string }
  | { kind: "unavailable"; reason: string };

export function scoreView(assessment: Assessment): ScoreView {
  const { value } = assessment.score;
  const { lower, upper } = assessment.uncertainty;
  if (lower !== null && upper !== null && lower <= upper) return { kind: "range", value, lower, upper, reading: rangeReading(lower, upper) };
  if (value !== null) return { kind: "point", value, reading: "Treat this as a rough guide: the engine did not say how uncertain it is." };
  const ran = assessment.predictors.filter((item) => item.status === "ran").length;
  return { kind: "unavailable", reason: assessment.score.plainLanguage || (ran ? "The predictors ran but did not return a combined probability." : "No crystallization predictor ran in this installation, so there is no probability to show.") };
}

/** A probability above 0.5 means crystals are more likely than not; the range decides how firm that is. */
function rangeReading(lower: number, upper: number) {
  if (lower > 0.5) return "The whole range is above 0.5: the predictors lean towards this protein forming crystals.";
  if (upper < 0.5) return "The whole range is below 0.5: the predictors lean against this protein forming crystals as it is.";
  return "The range spans 0.5: the predictors cannot tell whether this protein will crystallise.";
}

export function formatProbability(value: number) {
  return value.toFixed(2);
}

// ── How earlier-job facts change the advice ─────────────────────────────────

export type InfluenceEffect = "caution" | "action" | "support" | "neutral" | "missing";

export type FactInfluence = {
  key: FactKey;
  label: string;
  effect: InfluenceEffect;
  /** What the earlier job found, in one line. */
  finding: string;
  /** How that changes the crystallization advice. */
  advice: string;
  sources: FactSource[];
  /** The job that would fill a missing fact. */
  producedBy: FactJob | null;
  citations: CitationId[];
};

export const INFLUENCE_LABELS: Record<InfluenceEffect, string> = {
  caution: "Raises a caution",
  action: "Adds a step",
  support: "Supports",
  neutral: "No change",
  missing: "Not known yet",
};

/** One row per fact, in the helper's display order, so nothing known is silently ignored. */
export function factInfluences(facts: ProteinFacts): FactInfluence[] {
  return (Object.keys(FACT_GUIDE) as FactKey[]).map((key) => {
    const fact = facts[key];
    const label = FACT_GUIDE[key].label;
    if (fact.status === "missing") {
      return { key, label, effect: "missing", finding: fact.reason, advice: MISSING_ADVICE[key], sources: [], producedBy: fact.producedBy, citations: [] };
    }
    return { key, label, ...knownInfluence(key, facts), sources: fact.sources, producedBy: null };
  });
}

const MISSING_ADVICE: Record<FactKey, string> = {
  sequence: "Nothing can be assessed without the sequence.",
  reference: "Membrane, disorder and cofactor notes are borrowed from the reference, so the advice below has less to go on.",
  membrane: "The advice assumes a soluble protein. If it sits in a membrane, the screens are very different.",
  disorder: "Flexible stretches that could spoil packing are not accounted for.",
  cofactors: "The advice cannot say whether to add a ligand or cofactor to the drops.",
  pdbHits: "Without related structures there is no known crystal form or growth condition to start from.",
  conservation: "Conservation would only help pick construct ends to trim; the score does not use it.",
  alphaFoldModels: "Low-confidence regions in a model would hint at flexible parts; Shoebill also needs an AlphaFold2 model to run.",
};

type KnownInfluence = Pick<FactInfluence, "effect" | "finding" | "advice" | "citations">;

function knownInfluence(key: FactKey, facts: ProteinFacts): KnownInfluence {
  switch (key) {
    case "sequence": {
      const fact = facts.sequence;
      const length = fact.status === "known" ? fact.value.length : 0;
      return { effect: "neutral", finding: `${length} residues saved.`, advice: "Every predictor starts from this sequence. A change to the construct means a new assessment.", citations: [] };
    }
    case "reference": {
      const fact = facts.reference;
      if (fact.status !== "known") break;
      const identity = fact.value.identity === null ? "" : ` at ${Math.round(fact.value.identity * 100)}% identity`;
      return { effect: "neutral", finding: `UniProt ${fact.value.accession}${fact.value.proteinName ? ` (${fact.value.proteinName})` : ""}${identity}.`, advice: "The membrane, disorder and cofactor notes below come from this entry, so they are only as close as the match.", citations: ["uniprot2023"] };
    }
    case "membrane": {
      const fact = facts.membrane;
      if (fact.status !== "known") break;
      const spans = fact.value.regions.length ? ` ${fact.value.regions.length} membrane-spanning ${fact.value.regions.length === 1 ? "region" : "regions"} reported.` : "";
      if (fact.value.verdict === "yes") return { effect: "caution", finding: `Membrane protein.${spans}`, advice: "Standard soluble-protein screens rarely work. Keep it in detergent and plan a membrane-protein screen, or grow crystals in lipidic cubic phase (in meso).", citations: ["caffrey2015"] };
      if (fact.value.verdict === "uncertain") return { effect: "caution", finding: `Possibly a membrane protein; flagged for follow-up.${spans}`, advice: "Settle this in Protein readiness check first: a membrane protein needs detergent or lipidic-cubic-phase screens instead of soluble ones.", citations: ["caffrey2015"] };
      return { effect: "neutral", finding: "Not a membrane protein, by the scientist's review.", advice: "Standard soluble-protein screens apply; no detergent or lipid phase is needed.", citations: ["caffrey2015"] };
    }
    case "disorder": {
      const fact = facts.disorder;
      if (fact.status !== "known") break;
      const residues = fact.value.regions.reduce((sum, item) => sum + (item.start !== null && item.end !== null && item.end >= item.start ? item.end - item.start + 1 : 0), 0);
      const extent = residues ? ` About ${residues} residues of the reference are in disordered regions.` : "";
      if (fact.value.verdict === "yes") return { effect: "caution", finding: `Has disordered regions.${extent}`, advice: "Floppy stretches stop molecules packing in a regular lattice. Consider a construct that trims disordered ends before screening.", citations: ["dale2003"] };
      if (fact.value.verdict === "uncertain") return { effect: "caution", finding: `Disorder flagged for follow-up.${extent}`, advice: "Check where the flexible parts are; trimmed constructs often crystallise when the full-length protein does not.", citations: ["dale2003"] };
      return { effect: "support", finding: "No disordered regions, by the scientist's review.", advice: "A compact, ordered protein packs more readily, so no construct trimming is suggested on these grounds.", citations: ["dale2003"] };
    }
    case "cofactors": {
      const fact = facts.cofactors;
      if (fact.status !== "known") break;
      const names = fact.value.cofactors.map((item) => item.name);
      if (names.length) return { effect: "action", finding: `Binds ${listText(names)}.`, advice: `Include ${names.length === 1 ? "it" : "them"} in the protein sample, and compare drops with and without: a bound cofactor or ligand often locks one shape and helps crystals form.`, citations: ["dale2003"] };
      if (fact.value.required === "Yes" || fact.value.required === "Needs follow-up") return { effect: "action", finding: "Needs a cofactor, but none is named.", advice: "Name the cofactor in Protein readiness check so it can be added to the drops.", citations: ["dale2003"] };
      return { effect: "neutral", finding: "No cofactor needed, by the scientist's review.", advice: "Nothing extra to add to the protein sample.", citations: [] };
    }
    case "pdbHits": {
      const fact = facts.pdbHits;
      if (fact.status !== "known") break;
      if (fact.value.searchedWithoutHits) return { effect: "neutral", finding: "The PDB search found no related structures.", advice: "There is no known crystal form to copy, so start from a broad sparse-matrix screen.", citations: ["pdb2000", "jancarik1991"] };
      const crystal = fact.value.hits.filter((hit) => /x-ray|crystal/i.test(hit.method ?? ""));
      const grown = crystal.filter((hit) => hit.crystalGrowth.length).length;
      const groups = new Set(crystal.map((hit) => spaceGroupSymbol(hit.spaceGroup)).filter(Boolean));
      if (!crystal.length) return { effect: "neutral", finding: `${fact.value.hits.length} related ${plural(fact.value.hits.length, "structure")}, none solved by X-ray crystallography.`, advice: "These were solved without crystals, so they give no crystal form or growth condition to start from.", citations: ["pdb2000"] };
      const details = [grown ? `${grown} ${grown === 1 ? "reports" : "report"} how the crystals were grown` : "", groups.size ? `space ${plural(groups.size, "group")} ${[...groups].join(", ")}` : ""].filter(Boolean).join("; ");
      return { effect: "support", finding: `${crystal.length} related ${plural(crystal.length, "structure")} solved from crystals${details ? ` (${details})` : ""}.`, advice: "Related proteins have crystallised. Their growth conditions and space groups are the first things to try.", citations: ["pdb2000"] };
    }
    case "conservation": {
      const fact = facts.conservation;
      if (fact.status !== "known") break;
      const mean = fact.value.meanGrade === null ? "" : `, mean grade ${fact.value.meanGrade.toFixed(1)} on the 1–9 scale`;
      return { effect: "neutral", finding: `ConSurf grades for ${fact.value.residueCount} residues${mean}.`, advice: "The score does not use conservation. Variable (low-grade) ends are good candidates to trim if the full-length protein will not crystallise.", citations: ["consurf2023", "dale2003"] };
    }
    case "alphaFoldModels": {
      const fact = facts.alphaFoldModels;
      if (fact.status !== "known") break;
      const scored = fact.value.filter((model) => model.meanPlddt !== null);
      if (!scored.length) return { effect: "neutral", finding: `${fact.value.length} AlphaFold ${plural(fact.value.length, "model")} saved, without a confidence score.`, advice: "Shoebill reads AlphaFold2 models; confidence would show which parts may be flexible.", citations: ["alphafold2021", "shoebill2026"] };
      const best = Math.max(...scored.map((model) => model.meanPlddt ?? 0));
      const plddt = `mean pLDDT ${best.toFixed(1)}`;
      if (best < 70) return { effect: "caution", finding: `AlphaFold model with ${plddt}.`, advice: "Much of the model is below 70, AlphaFold's threshold for a confident backbone. Low-confidence parts are often flexible and may need trimming.", citations: ["alphafold2021"] };
      return { effect: "support", finding: `AlphaFold model with ${plddt}.`, advice: "Most of the model is above 70, AlphaFold's threshold for a confident backbone, consistent with a well-folded protein. Shoebill reads models like this one.", citations: ["alphafold2021", "shoebill2026"] };
    }
  }
  return { effect: "neutral", finding: "", advice: "", citations: [] };
}

// ── Saved job ───────────────────────────────────────────────────────────────

export const CRYSTALLIZE_APP_TYPE = "crystallization";

/** The `crystallization` project job config. Panel state lives under `panels`, one key per panel, so panels never overwrite each other. */
export function crystallizeConfig(previous: JsonObject | undefined, assessment: Assessment, influences: FactInfluence[], savedAt: string): JsonObject {
  const view = scoreView(assessment);
  return {
    ...(previous ?? {}),
    assessedAt: savedAt,
    engineMethod: [assessment.method.name, assessment.method.version].filter(Boolean).join(" "),
    scoreStatus: view.kind,
    score: assessment.score.value,
    scoreLower: view.kind === "range" ? view.lower : null,
    scoreUpper: view.kind === "range" ? view.upper : null,
    predictorsRun: assessment.predictors.filter((item) => item.status === "ran").map((item) => item.id),
    spaceGroups: assessment.spaceGroups.map((item) => item.spaceGroup),
    recommendation: assessment.recommendation,
    factEffects: Object.fromEntries(influences.map((item) => [item.key, item.effect])),
    savedByUser: true,
  };
}

// ── Shared readers ──────────────────────────────────────────────────────────

function listText(values: string[]) {
  return values.length < 3 ? values.join(" and ") : `${values.slice(0, -1).join(", ")} and ${values.at(-1)}`;
}

function plural(count: number, word: string) {
  return count === 1 ? word : `${word}s`;
}

function probability(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) && number >= 0 && number <= 1 ? number : null;
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
