// Crystallize job: reading the engine assessment and how earlier facts change
// the advice. Run with `npm run test`.
//
// `engineResponse` is the real output of `crystallization_assessment` (PR #80,
// CRYSTALLIZATION_API.md) for the fixture in test_crystallization.py; job
// configs carry exactly the keys their saving component writes.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { JsonObject, ProjectJob, ProteinBundle } from "./protein-labs-api.ts";
import { citations } from "./citations.ts";
import { proteinFacts } from "./protein-facts.ts";
import { crystallizeConfig, factInfluences, PREDICTOR_CITATIONS, readAssessment, scoreView, spaceGroupSymbol } from "./crystallization.ts";
import { CRYSTALLIZE_PANELS, panelState, selectedSpaceGroup, withPanelState } from "./crystallize-panels.ts";
import { definitionFor, workflowJobs, workflowSections } from "./workflow.ts";

const engineResponse: JsonObject = {
  proteinId: "p1",
  method: { name: "Protein Labs crystallization evidence combiner", version: "1.0", plainLanguage: "This combines facts already known about your protein with any available crystallization predictors. It cannot guarantee crystals." },
  score: { value: null, scale: "probability 0–1", status: "unavailable", plainLanguage: "A crystallization probability is unavailable because no validated Shoebill or PLM score was run in this installation." },
  uncertainty: { lower: null, upper: null, status: "not_quantified", plainLanguage: "There is no calibrated uncertainty interval without executed, validated predictor scores." },
  predictors: [
    { id: "shoebill", name: "Shoebill", score: null, status: "unavailable", source: { label: "Shoebill upstream repository", url: "https://github.com/KJ-Liao/Shoebill" }, reason: "Not run. The public repository contains no license file and the workflow requires an AlphaFold2 result plus external feature-extraction binaries." },
    { id: "plm", name: "Protein-language-model predictor", score: null, status: "unavailable", source: { label: "PLM crystallization predictor (Scientific Reports, 2025)", url: "https://doi.org/10.1038/s41598-025-86519-5" }, reason: "Not run. No redistributable implementation and model weights are bundled with this offline backend." },
    { id: "mascl", name: "MASCL space-group predictor", score: null, status: "unavailable", source: { label: "MASCL space-group predictor (Proteins, 2025)", url: "https://doi.org/10.1002/prot.26844" }, spaceGroups: [], reason: "Not run. A redistributable MASCL implementation/model has not been added to this backend." },
  ],
  spaceGroupSuggestions: [{ spaceGroup: "P 21 21 21", homologueCount: 1, source: "Saved PDB homologue crystal forms" }],
  explanations: [
    { direction: "caution", summary: "A saved UniProt annotation has transmembrane region(s); membrane-protein crystallization usually needs specialized detergent, lipidic-cubic-phase, or related screening.", source: "Saved UniProtKB match" },
    { direction: "caution", summary: "Saved disorder annotations cover 30% of the sequence; consider a construct boundary screen.", source: "Saved UniProtKB match" },
    { direction: "action", summary: "Saved UniProt evidence lists heme; test the relevant ligand or cofactor condition alongside apo protein.", source: "Saved UniProtKB match" },
    { direction: "support", summary: "1 saved PDB homologue record(s) include experimental crystal-form metadata.", source: "Saved PDB homologue search" },
  ],
  recommendation: "Prioritize a membrane-protein crystallization workflow and record detergent/lipid conditions; do not interpret this as a success prediction.",
};

/** The contract's shape once predictors run: a score with its range, features, and MASCL groups. */
const scoredResponse: JsonObject = {
  ...engineResponse,
  score: { value: 0.62, status: "combined", plainLanguage: "" },
  uncertainty: { lower: 0.55, upper: 0.7, status: "quantified", plainLanguage: "" },
  predictors: [
    { id: "shoebill", name: "Shoebill", score: 0.64, lower: 0.56, upper: 0.72, status: "ran", source: {}, reason: "", features: [{ name: "Mean pLDDT", value: "91", effect: "raises", plainLanguage: "A confident model" }, { name: "", value: "skipped" }] },
    { id: "mascl", name: "MASCL", score: 0.5, status: "ran", source: {}, spaceGroups: [{ spaceGroup: "P  21 21 21", probability: 0.4 }, "C 1 2 1"] },
  ],
};

const membraneRecord: JsonObject = {
  accession: "P54321", reviewed: true, proteinName: "Membrane fixture",
  transmembraneRegions: [{ type: "Transmembrane", description: "Helical", location: { start: 20, end: 42 }, evidences: [], featureId: null }],
  disorderedRegions: [{ type: "Region", description: "Disordered", location: { start: 70, end: 95 }, evidences: [], featureId: null }],
  cofactors: [{ name: "Heme", chebiId: "CHEBI:30413", evidences: [] }],
};

function job(appType: string, config: JsonObject): ProjectJob {
  return { id: `job-${appType}`, proteinId: "p1", name: appType, appType, status: "complete", config, createdAt: "2026-10-31T23:00:00.000Z", updatedAt: "2026-10-31T23:00:00.000Z" };
}

function bundle(overrides: Partial<ProteinBundle> = {}): ProteinBundle {
  return {
    protein: { id: "p1", name: "Fixture", sequence: "M".repeat(120), organism: "", geneName: "", description: "", expressionSystem: "", notes: "", tags: [], externalIds: {} },
    protparam: null, blastJobs: [], uniprotMatches: [], pdbMatches: [], alphaFoldModels: [], conservationJobs: [], projectJobs: [], projectNotebook: null,
    ...overrides,
  };
}

describe("readAssessment", () => {
  it("keeps an unavailable score unavailable, with the engine's reason", () => {
    const assessment = readAssessment(engineResponse);
    assert.equal(assessment.score.value, null);
    const view = scoreView(assessment);
    assert.equal(view.kind, "unavailable");
    if (view.kind === "unavailable") assert.match(view.reason, /no validated Shoebill or PLM score/);
    assert.deepEqual(assessment.predictors.map((item) => [item.id, item.status]), [["shoebill", "unavailable"], ["plm", "unavailable"], ["mascl", "unavailable"]]);
  });

  it("labels homologue space groups as reports, not predictions", () => {
    assert.deepEqual(readAssessment(engineResponse).spaceGroups, [{ spaceGroup: "P 21 21 21", origin: "homologue", probability: null, homologueCount: 1 }]);
  });

  it("shows a range when the engine sends one, and reads which side of 0.5 it falls", () => {
    const view = scoreView(readAssessment(scoredResponse));
    assert.deepEqual(view, { kind: "range", value: 0.62, lower: 0.55, upper: 0.7, reading: "The whole range is above 0.5: the predictors lean towards this protein forming crystals." });
    const spanning = scoreView(readAssessment({ ...scoredResponse, uncertainty: { lower: 0.4, upper: 0.7 } }));
    assert.match(spanning.kind === "range" ? spanning.reading : "", /cannot tell/);
  });

  it("warns when a value comes without a range, and never accepts out-of-range numbers", () => {
    assert.equal(scoreView(readAssessment({ ...scoredResponse, uncertainty: {} })).kind, "point");
    assert.equal(scoreView(readAssessment({ ...scoredResponse, score: { value: 7 }, uncertainty: { lower: -1, upper: 2 } })).kind, "unavailable");
  });

  it("puts MASCL's groups first and merges a group both sources name", () => {
    const assessment = readAssessment(scoredResponse);
    assert.deepEqual(assessment.spaceGroups, [
      { spaceGroup: "P 21 21 21", origin: "mascl", probability: 0.4, homologueCount: 1 },
      { spaceGroup: "C 1 2 1", origin: "mascl", probability: null, homologueCount: 0 },
    ]);
    assert.deepEqual(assessment.predictors[0].features, [{ name: "Mean pLDDT", value: "91", effect: "raises", plainLanguage: "A confident model" }]);
  });

  it("does not count a predictor as run without a score", () => {
    const assessment = readAssessment({ predictors: [{ id: "plm", status: "ran", score: null }] });
    assert.equal(assessment.predictors[0].status, "unavailable");
  });

  it("survives a malformed body", () => {
    const assessment = readAssessment("not json");
    assert.deepEqual([assessment.predictors, assessment.spaceGroups, assessment.explanations], [[], [], []]);
    assert.equal(scoreView(assessment).kind, "unavailable");
  });

  it("cites every predictor from the shared registry", () => {
    for (const id of Object.values(PREDICTOR_CITATIONS)) assert.ok(citations[id], id);
  });

  it("normalises space-group spacing", () => {
    assert.equal(spaceGroupSymbol(" P  1 21  1 "), "P 1 21 1");
  });
});

describe("factInfluences", () => {
  it("lists every fact once and sends the student to the job that fills a missing one", () => {
    const influences = factInfluences(proteinFacts(bundle()));
    assert.equal(influences.length, 8);
    const missing = influences.filter((item) => item.effect === "missing");
    assert.deepEqual(missing.map((item) => item.producedBy?.jobId), ["reference-match", "readiness", "readiness", "readiness", "research", "research", "structure"]);
    assert.ok(missing.every((item) => item.advice && item.citations.length === 0));
  });

  it("turns a reviewed membrane protein with disorder and heme into cautions and an action, each cited", () => {
    const facts = proteinFacts(bundle({
      uniprotMatches: [{ accession: "P54321", record: membraneRecord }],
      projectJobs: [
        job("reference-match", { selectedAccession: "P54321", selectedProteinName: "Membrane fixture", identity: 0.82, selectedAt: "2026-10-31T22:40:00.000Z", savedByUser: true }),
        job("protein-readiness", { membraneProtein: "Yes", intrinsicallyDisordered: "Yes", cofactorRequired: "Yes", cofactorDetails: "Heme · CHEBI:30413", reviewedAt: "2026-10-31T22:45:00.000Z", savedByUser: true }),
        job("database-research", { savedSources: ["PDB"], updatedAt: "2026-10-31T22:37:09.400Z", savedByUser: true }),
      ],
      pdbMatches: [{ pdbId: "1ABC", entityId: "1", identity: 0.6, method: "X-RAY DIFFRACTION", experimentalMethods: ["X-RAY DIFFRACTION"], spaceGroup: "P 21 21 21", source: { entryUrl: "https://www.rcsb.org/structure/1ABC" }, crystallizationConditions: { crystalGrowth: [{ method: "VAPOR DIFFUSION, HANGING DROP", pH: "7.5" }] } }],
    }));
    const byKey = Object.fromEntries(factInfluences(facts).map((item) => [item.key, item]));
    assert.equal(byKey.reference.finding, "UniProt P54321 (Membrane fixture) at 82% identity.");
    assert.equal(byKey.membrane.effect, "caution");
    assert.deepEqual(byKey.membrane.citations, ["caffrey2015"]);
    assert.equal(byKey.disorder.effect, "caution");
    assert.match(byKey.disorder.finding, /About 26 residues/);
    assert.equal(byKey.cofactors.effect, "action");
    assert.equal(byKey.cofactors.finding, "Binds Heme.");
    assert.equal(byKey.pdbHits.effect, "support");
    assert.equal(byKey.pdbHits.finding, "1 related structure solved from crystals (1 reports how the crystals were grown; space group P 21 21 21).");
    for (const item of Object.values(byKey)) for (const id of item.citations) assert.ok(citations[id], id);
  });

  it("reads a searched-but-empty PDB result as a real finding, not a gap", () => {
    const facts = proteinFacts(bundle({ projectJobs: [job("database-research", { savedSources: ["PDB"], updatedAt: "2026-10-31T22:37:09.400Z" })] }));
    const pdb = factInfluences(facts).find((item) => item.key === "pdbHits")!;
    assert.equal(pdb.effect, "neutral");
    assert.match(pdb.advice, /broad sparse-matrix screen/);
  });

  it("flags a low-confidence AlphaFold model", () => {
    const facts = proteinFacts(bundle({ alphaFoldModels: [{ modelId: "AF-X-F1", source: "AlphaFold DB", metadata: { meanPlddt: 58.2 }, importedAt: "2026-10-31T22:37:02Z" }] }));
    const model = factInfluences(facts).find((item) => item.key === "alphaFoldModels")!;
    assert.equal(model.effect, "caution");
    assert.equal(model.finding, "AlphaFold model with mean pLDDT 58.2.");
  });
});

describe("saved crystallization job", () => {
  it("records the assessment without dropping panel state", () => {
    const assessment = readAssessment(scoredResponse);
    const previous = withPanelState({ selectedSpaceGroup: "P 21 21 21" }, "space-groups", { teachingMode: true });
    const config = crystallizeConfig(previous, assessment, factInfluences(proteinFacts(bundle())), "2026-11-01T00:00:00.000Z");
    assert.equal(config.assessedAt, "2026-11-01T00:00:00.000Z");
    assert.deepEqual([config.scoreStatus, config.scoreLower, config.scoreUpper], ["range", 0.55, 0.7]);
    assert.deepEqual(config.predictorsRun, ["shoebill", "mascl"]);
    assert.deepEqual(panelState(config, "space-groups"), { teachingMode: true });
    assert.equal(selectedSpaceGroup(config), "P 21 21 21");
  });

  it("merges one panel's state without touching another's", () => {
    const first = withPanelState({}, "lattice", { cell: "experimental" });
    const second = withPanelState(first, "guidance", { screen: "MemGold" });
    assert.deepEqual(withPanelState(second, "lattice", { contacts: true }).panels, { lattice: { cell: "experimental", contacts: true }, guidance: { screen: "MemGold" } });
    assert.deepEqual(panelState(undefined, "guidance"), {});
    assert.equal(selectedSpaceGroup({ selectedSpaceGroup: "  " }), null);
  });

  it("is a workflow job in its own section, after the bench work", () => {
    const definition = definitionFor("crystallize");
    assert.equal(definition.appType, "crystallization");
    assert.equal(workflowJobs.at(-1)?.id, "crystallize");
    assert.equal(workflowSections.at(-1)?.id, definition.stage);
    assert.deepEqual(CRYSTALLIZE_PANELS.map((panel) => panel.id), ["propensity", "space-groups", "lattice", "guidance"]);
  });
});
