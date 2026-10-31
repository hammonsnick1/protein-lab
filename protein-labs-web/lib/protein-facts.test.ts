// Protein facts gathered from earlier jobs. Run with `npm run test`.
//
// Fixtures follow the writers: engine records are copied from a live
// P00918 (carbonic anhydrase II) project, and job configs carry exactly the
// keys their saving component writes.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { JsonObject, ProjectJob, ProteinBundle } from "./protein-labs-api.ts";
import type { ConservationJobSummary } from "./conservation.ts";
import { FACT_GUIDE, FACT_JOBS, missingFacts, proteinFacts } from "./protein-facts.ts";
import { workflowJobs } from "./workflow.ts";

const CA2 = "MSHHWGYGKHNGPEHWHKDFPIAKGERQSPVDIDTHTAKYDPSLKPLSVSYDQATSLRILNNGHAFNVEFDDSQDKAVLKGGPLDGTYRLIQFHFHWGSLDGQGSEHTVDKKKYAAELHLVHWNTKYGDFGKAVQQPDGLAVLGIFLKVGSAKPGLQKVVDVLDSIKTKGKSADFTNFDPRGLLPESLDYWTYPGSLTTPPLLECVTWIVLKEPISVSSEQVLKFRKLNFNGEGEPEELMVDNWRPAQPLKNRQIKASFK";

// `Database._uniprot` around `normalize_uniprot` (evidences trimmed). UniProt
// sends ChEBI as a cross-reference, so `chebiId` is empty in live records.
const uniprotP00918: JsonObject = {
  accession: "P00918", source: "UniProt accession", identity: null, queryCoverage: null, evalue: null, fetchedAt: "2026-10-31T22:37:01.371270+00:00",
  record: {
    accession: "P00918", entryId: "CAH2_HUMAN", reviewed: true, proteinName: "Carbonic anhydrase 2",
    organism: { scientificName: "Homo sapiens", commonName: "Human", taxonId: 9606 },
    postTranslationalModifications: [], transmembraneRegions: [], disorderedRegions: [],
    subcellularLocations: [{ location: "Cytoplasm", topology: "", orientation: "", evidences: [] }, { location: "Cell membrane", topology: "", orientation: "", evidences: [] }],
    cofactors: [{ name: "Zn(2+)", chebiId: "", evidences: [{ evidenceCode: "ECO:0000269", source: "PubMed", id: "11076507" }] }],
  },
};

// `normalize_uniprot` output for the membrane fixture in test_integrations.py.
const membraneRecord: JsonObject = {
  accession: "P54321", reviewed: true, proteinName: "",
  transmembraneRegions: [{ type: "Transmembrane", description: "Helical", location: { start: 20, end: 42 }, evidences: [], featureId: null }],
  disorderedRegions: [{ type: "Region", description: "Disordered", location: { start: 70, end: 95 }, evidences: [], featureId: null }],
  subcellularLocations: [{ location: "Cell membrane", topology: "Single-pass", orientation: "", evidences: [] }],
  cofactors: [{ name: "Heme", chebiId: "CHEBI:30413", evidences: [] }],
};

// `RCSBPDBClient.fetch_record` + `Database._pdb` (comparison and purification notes trimmed).
const pdb1EOU: JsonObject = {
  pdbId: "1EOU", entityId: "1", chainId: "A", chainIds: ["A"], score: 1.0, identity: 1.0, similarity: 1.0, coverage: 1.0, rcsbIdentity: 1.0, evalue: 6.257e-181, entitySequenceLength: 260,
  title: "CRYSTAL STRUCTURE OF HUMAN CARBONIC ANHYDRASE II COMPLEXED WITH AN ANTICONVULSANT SUGAR SULFAMATE", entityDescription: "CARBONIC ANHYDRASE II (CA II)", uniprotIds: ["P00918"],
  experimentalMethods: ["X-RAY DIFFRACTION"], resolutionAngstrom: [2.1], method: "X-RAY DIFFRACTION", resolution: 2.1, sourceOrganisms: ["Homo sapiens"],
  crystallizationConditions: { status: "reported", crystalGrowth: [{ crystal_id: "1", method: "VAPOR DIFFUSION, HANGING DROP", pH: "8.8", temp: "295", pdbx_details: "TRIS.HCl, smmonium sulfate, dithiothreitol, pH 8.8, VAPOR DIFFUSION, HANGING DROP, temperature 295K" }], components: [], nmrSampleConditions: [], evidence: [{ source: "PDB mmCIF", categories: ["_exptl_crystal_grow"] }] },
  source: { provider: "RCSB Protein Data Bank", entryUrl: "https://www.rcsb.org/structure/1EOU", mmcifUrl: "https://files.rcsb.org/download/1EOU.cif" },
  fetchedAt: "2026-10-31T22:37:09.345930+00:00",
};
const pdb1CA3: JsonObject = {
  pdbId: "1CA3", entityId: "1", chainId: "A", chainIds: ["A"], score: 1.0, identity: 1.0, similarity: 1.0, coverage: 1.0, evalue: 6.257e-181,
  title: "UNEXPECTED PH-DEPENDENT CONFORMATION OF HIS-64, THE PROTON SHUTTLE OF CARBONIC ANHYDRASE II.", entityDescription: "CARBONIC ANHYDRASE II",
  experimentalMethods: ["X-RAY DIFFRACTION"], resolutionAngstrom: [2.3], method: "X-RAY DIFFRACTION", resolution: 2.3,
  crystallizationConditions: { status: "not_reported", crystalGrowth: [], components: [], nmrSampleConditions: [], evidence: [] },
  source: { provider: "RCSB Protein Data Bank", entryUrl: "https://www.rcsb.org/structure/1CA3", mmcifUrl: "https://files.rcsb.org/download/1CA3.cif" },
  fetchedAt: "2026-10-31T22:37:09.330110+00:00",
};

// `Database._alphafold` for an AlphaFold DB fetch (prediction metadata trimmed).
const afP00918: JsonObject = {
  modelId: "AF-P00918-F1", proteinId: "p1", source: "AlphaFold DB", accession: "P00918", name: "Carbonic anhydrase 2", format: "cif",
  metadata: { toolUsed: "AlphaFold Monomer v2.0 pipeline", globalMetricValue: 97.38, uniprotAccession: "P00918", entryUrl: "https://alphafold.ebi.ac.uk/entry/AF-P00918-F1", meanPlddt: 96.9, residueCount: 260, chainCount: 1, sequenceMatch: { identity: 1, queryCoverage: 1, sequenceExact: true } },
  importedAt: "2026-10-31T22:37:02.589561+00:00",
};

// A ConSurf-DB lookup summary from `bundle.conservationJobs`.
const consurf: ConservationJobSummary = {
  id: "21ecf471-3774-410d-93ac-570961ad7842", proteinId: "p1", method: "consurf", source: "consurf-db", status: "complete", stage: "Pre-calculated ConSurf-DB analysis of 5Y2S chain A",
  pdbId: "1CA3", chain: "A", querySequence: CA2, residueCount: 260, error: "", createdAt: "2026-10-31T22:37:13.891575+00:00", updatedAt: "2026-10-31T22:37:13.891575+00:00",
  metadata: { matchedBy: "pdb", requestedPdbId: "1CA3", requestedChain: "A", identicalPdbId: "5Y2S", identicalChain: "A", entryUrl: "https://consurfdb.tau.ac.il/final_output/?pdb_id=1CA3&chain=A", meanGrade: 5.3, gradedSequence: CA2 },
};

// The config object literals of each saving component.
const referenceConfig: JsonObject = {
  selectedAccession: "P00918", selectedProteinName: "Carbonic anhydrase 2", selectedOrganism: "Homo sapiens", identity: null, queryCoverage: null, reviewed: true,
  evidenceSnapshot: { postTranslationalModifications: [], cofactors: (uniprotP00918.record as JsonObject).cofactors, subcellularLocations: [], transmembraneRegions: [], disorderedRegions: [] },
  selectedAt: "2026-10-31T22:40:00.000Z", savedByUser: true,
};
// protein-readiness-job.tsx `config()`. `cofactorDetails` is pre-filled from
// the reference as `[name, chebiId].filter(Boolean).join(" · ")`.
const readinessConfig: JsonObject = {
  reviewStatus: "reviewed", referenceAccession: "P00918", referenceProteinName: "Carbonic anhydrase 2", referenceIdentity: null, referenceQueryCoverage: null,
  membraneProtein: "No", membraneEvidence: "No transmembrane annotation in the selected reference or strong local hydrophobic segment was found. Absence of evidence is not proof that the protein is soluble.",
  cysteineCount: 1, hasCysteines: true, cellularLocation: "Cytoplasm; Cell membrane", extinctionThresholdM1Cm1: 10000, reducedExtinctionM1Cm1: 50420, oxidizedExtinctionM1Cm1: 50420, reducedExtinctionBelowThreshold: false,
  intrinsicallyDisordered: "No", disorderEvidence: "No disordered-region annotation in the selected reference or strong composition flag was found. This local screen is not a disorder predictor.",
  cofactorRequired: "Yes", cofactorDetails: "Zn(2+)", postTranslationalModification: "No", postTranslationalModificationDetails: "", notes: "",
  reviewedAt: "2026-10-31T22:45:00.000Z", savedByUser: true,
};
// The retired readiness form in job-workspace.tsx.
const legacyReadinessConfig: JsonObject = { membraneProtein: true, cysteineCount: 1, cellularLocation: "Cytosol", extinctionCoefficient: 50420, intrinsicallyDisordered: "review", cofactor: "None known", notes: "", checkedAt: "2026-09-01T10:00:00.000Z" };
// sequence-research-job.tsx after the PDB search.
const researchConfig: JsonObject = { savedSources: ["UniProt", "PDB"], updatedAt: "2026-10-31T22:37:09.400Z", savedByUser: true };

function job(appType: string, config: JsonObject, updatedAt = "2026-10-31T23:00:00.000Z", status: ProjectJob["status"] = "complete"): ProjectJob {
  return { id: `job-${appType}`, proteinId: "p1", name: appType, appType, status, config, createdAt: updatedAt, updatedAt };
}

function bundle(overrides: Partial<ProteinBundle> = {}): ProteinBundle {
  return {
    protein: { id: "p1", name: "Carbonic anhydrase II", sequence: CA2, organism: "Homo sapiens", geneName: "CA2", description: "", expressionSystem: "", notes: "", tags: [], externalIds: {}, updatedAt: "2026-10-31T22:36:59.891243+00:00" },
    protparam: null, blastJobs: [], uniprotMatches: [], pdbMatches: [], alphaFoldModels: [], conservationJobs: [], projectJobs: [], projectNotebook: null,
    ...overrides,
  };
}

const complete = () => bundle({
  uniprotMatches: [uniprotP00918],
  pdbMatches: [pdb1EOU, pdb1CA3],
  alphaFoldModels: [afP00918],
  conservationJobs: [consurf],
  projectJobs: [job("reference-match", referenceConfig), job("protein-readiness", readinessConfig), job("database-research", researchConfig), job("alphafold", { modelId: "AF-P00918-F1", source: "AlphaFold DB" })],
});

describe("proteinFacts on an empty project", () => {
  it("reports every fact as missing and names the job that produces it", () => {
    const facts = proteinFacts(bundle({ protein: { ...bundle().protein, sequence: "" } }));
    const missing = missingFacts(facts);
    assert.deepEqual(missing.map((item) => [item.key, item.producedBy.jobId]), [
      ["sequence", "sequence"], ["reference", "reference-match"], ["membrane", "readiness"], ["disorder", "readiness"],
      ["cofactors", "readiness"], ["pdbHits", "research"], ["conservation", "research"], ["alphaFoldModels", "structure"],
    ]);
    for (const item of missing) assert.match(item.reason, new RegExp(item.producedBy.label));
  });
});

describe("proteinFacts on a researched CA2 project", () => {
  const facts = proteinFacts(complete());

  it("finds every fact", () => {
    assert.deepEqual(missingFacts(facts), []);
  });

  it("dates the sequence from the protein record", () => {
    assert.equal(facts.sequence.status, "known");
    if (facts.sequence.status !== "known") return;
    assert.equal(facts.sequence.value.length, 260);
    assert.equal(facts.sequence.sources[0].date, "2026-10-31T22:36:59.891243+00:00");
  });

  it("reads the chosen reference with a citable UniProt link", () => {
    assert.equal(facts.reference.status, "known");
    if (facts.reference.status !== "known") return;
    assert.deepEqual(facts.reference.value, { accession: "P00918", proteinName: "Carbonic anhydrase 2", organism: "Homo sapiens", identity: null, queryCoverage: null, reviewed: true });
    assert.deepEqual(facts.reference.sources[0], { ...FACT_JOBS.reference, projectJobId: "job-reference-match", date: "2026-10-31T22:40:00.000Z", detail: "UniProt P00918", url: "https://www.uniprot.org/uniprotkb/P00918/entry" });
  });

  it("takes the scientist's 'No' for membrane and disorder, dated by the review", () => {
    for (const fact of [facts.membrane, facts.disorder]) {
      assert.equal(fact.status, "known");
      if (fact.status !== "known") continue;
      assert.equal(fact.value.verdict, "no");
      assert.deepEqual(fact.value.regions, []);
      assert.deepEqual(fact.sources.map((item) => [item.appType, item.date]), [["protein-readiness", "2026-10-31T22:45:00.000Z"]]);
    }
  });

  it("merges the reference's Zn(2+) and the readiness copy of it into one cofactor", () => {
    assert.equal(facts.cofactors.status, "known");
    if (facts.cofactors.status !== "known") return;
    assert.equal(facts.cofactors.value.required, "Yes");
    assert.deepEqual(facts.cofactors.value.cofactors.map((item) => [item.name, item.sources.map((from) => from.appType)]), [["Zn(2+)", ["reference-match", "protein-readiness"]]]);
  });

  it("lists PDB hits with crystal growth and no invented space group", () => {
    assert.equal(facts.pdbHits.status, "known");
    if (facts.pdbHits.status !== "known") return;
    const [first, second] = facts.pdbHits.value.hits;
    assert.equal(first.pdbId, "1EOU");
    assert.deepEqual(first.crystalGrowth, [{ method: "VAPOR DIFFUSION, HANGING DROP", pH: 8.8, temperatureK: 295, details: "TRIS.HCl, smmonium sulfate, dithiothreitol, pH 8.8, VAPOR DIFFUSION, HANGING DROP, temperature 295K" }]);
    assert.equal(first.spaceGroup, null);
    assert.equal(first.unitCell, null);
    assert.equal(first.entryUrl, "https://www.rcsb.org/structure/1EOU");
    assert.deepEqual(second.crystalGrowth, []);
    assert.equal(facts.pdbHits.sources[0].date, "2026-10-31T22:37:09.345930+00:00");
  });

  it("reads the ConSurf-DB run with its representative chain", () => {
    assert.equal(facts.conservation.status, "known");
    if (facts.conservation.status !== "known") return;
    assert.equal(facts.conservation.value.meanGrade, 5.3);
    assert.equal(facts.conservation.value.gradedSequence, CA2);
    assert.equal(facts.conservation.sources[0].detail, "ConSurf-DB · 5Y2S chain A");
    assert.equal(facts.conservation.sources[0].url, consurf.metadata.entryUrl);
  });

  it("reads the AlphaFold DB model and its confidence", () => {
    assert.equal(facts.alphaFoldModels.status, "known");
    if (facts.alphaFoldModels.status !== "known") return;
    assert.deepEqual(facts.alphaFoldModels.value, [{ modelId: "AF-P00918-F1", source: "AlphaFold DB", accession: "P00918", name: "Carbonic anhydrase 2", meanPlddt: 96.9, sequenceExact: true, url: "https://alphafold.ebi.ac.uk/entry/AF-P00918-F1", importedAt: "2026-10-31T22:37:02.589561+00:00" }]);
    assert.equal(facts.alphaFoldModels.sources[0].projectJobId, "job-alphafold");
  });
});

describe("membrane, disorder and cofactors from the reference alone", () => {
  const facts = proteinFacts(bundle({
    uniprotMatches: [{ accession: "P54321", identity: 0.98, queryCoverage: 0.95, record: membraneRecord }],
    projectJobs: [job("reference-match", { ...referenceConfig, selectedAccession: "P54321", selectedProteinName: "", identity: 0.98, queryCoverage: 0.95 })],
  }));

  it("reports the reference's regions, in reference numbering, before anyone reviews them", () => {
    assert.equal(facts.membrane.status, "known");
    if (facts.membrane.status !== "known") return;
    assert.equal(facts.membrane.value.verdict, "yes");
    assert.equal(facts.membrane.value.answer, "Not reviewed");
    assert.deepEqual(facts.membrane.value.regions, [{ type: "Transmembrane", description: "Helical", start: 20, end: 42 }]);
    assert.equal(facts.disorder.status === "known" && facts.disorder.value.regions[0].start, 70);
  });

  it("keeps the ChEBI ID the reference supplies", () => {
    assert.equal(facts.cofactors.status === "known" && facts.cofactors.value.cofactors[0].chebiId, "CHEBI:30413");
  });
});

describe("readiness answers and the snapshot fallback", () => {
  it("merges `Heme` with the readiness prefill `Heme · CHEBI:30413` and adds a second cofactor", () => {
    const facts = proteinFacts(bundle({
      uniprotMatches: [{ accession: "P54321", record: membraneRecord }],
      projectJobs: [job("reference-match", { ...referenceConfig, selectedAccession: "P54321" }), job("protein-readiness", { ...readinessConfig, cofactorDetails: "Heme · CHEBI:30413; Mg2+" })],
    }));
    assert.equal(facts.cofactors.status, "known");
    if (facts.cofactors.status !== "known") return;
    assert.deepEqual(facts.cofactors.value.cofactors.map((item) => [item.name, item.chebiId, item.sources.length]), [["Heme", "CHEBI:30413", 2], ["Mg2+", null, 1]]);
  });

  it("keeps a reviewed 'no cofactor' as a known answer", () => {
    const facts = proteinFacts(bundle({ projectJobs: [job("protein-readiness", { ...readinessConfig, cofactorRequired: "No", cofactorDetails: "" })] }));
    assert.equal(facts.cofactors.status, "known");
    if (facts.cofactors.status !== "known") return;
    assert.deepEqual([facts.cofactors.value.required, facts.cofactors.value.cofactors], ["No", []]);
    assert.deepEqual(facts.cofactors.sources.map((item) => item.appType), ["protein-readiness"]);
  });

  it("marks 'Needs follow-up' as uncertain", () => {
    const facts = proteinFacts(bundle({ projectJobs: [job("protein-readiness", { ...readinessConfig, membraneProtein: "Needs follow-up" })] }));
    assert.equal(facts.membrane.status === "known" && facts.membrane.value.verdict, "uncertain");
  });

  it("reads the retired readiness form without trusting its defaults", () => {
    const facts = proteinFacts(bundle({ projectJobs: [job("protein-readiness", legacyReadinessConfig)] }));
    assert.equal(facts.membrane.status, "known");
    if (facts.membrane.status === "known") {
      assert.equal(facts.membrane.value.verdict, "uncertain");
      assert.equal(facts.membrane.sources[0].date, "2026-09-01T10:00:00.000Z");
    }
    assert.equal(facts.disorder.status, "missing");
    assert.equal(facts.cofactors.status, "missing");
  });

  it("falls back to the saved evidence snapshot when the live match is gone", () => {
    const facts = proteinFacts(bundle({ projectJobs: [job("reference-match", referenceConfig)] }));
    assert.equal(facts.cofactors.status === "known" && facts.cofactors.value.cofactors[0].name, "Zn(2+)");
    assert.equal(facts.reference.status === "known" && facts.reference.value.proteinName, "Carbonic anhydrase 2");
  });

  it("says matches exist but none is chosen", () => {
    const facts = proteinFacts(bundle({ uniprotMatches: [uniprotP00918] }));
    assert.equal(facts.reference.status, "missing");
    if (facts.reference.status === "missing") assert.match(facts.reference.reason, /none has been chosen/);
  });
});

describe("PDB hits", () => {
  it("treats a search that found nothing as a known, empty result", () => {
    const facts = proteinFacts(bundle({ projectJobs: [job("database-research", researchConfig)] }));
    assert.equal(facts.pdbHits.status, "known");
    if (facts.pdbHits.status !== "known") return;
    assert.deepEqual([facts.pdbHits.value.hits, facts.pdbHits.value.searchedWithoutHits], [[], true]);
    assert.equal(facts.pdbHits.sources[0].date, "2026-10-31T22:37:09.400Z");
  });

  it("reads space group and cell from RCSB's entry fields when the engine passes them on", () => {
    const withSymmetry = { ...pdb1CA3, symmetry: { space_group_name_hm: "P 1 21 1" }, cell: { length_a: 42.7, length_b: 41.7, length_c: 73.0, angle_alpha: 90, angle_beta: 104.6, angle_gamma: 90 } };
    const facts = proteinFacts(bundle({ pdbMatches: [withSymmetry] }));
    assert.equal(facts.pdbHits.status, "known");
    if (facts.pdbHits.status !== "known") return;
    assert.equal(facts.pdbHits.value.hits[0].spaceGroup, "P 1 21 1");
    assert.deepEqual(facts.pdbHits.value.hits[0].unitCell, { a: 42.7, b: 41.7, c: 73.0, alpha: 90, beta: 104.6, gamma: 90 });
  });
});

describe("conservation and AlphaFold gaps", () => {
  it("does not count a ConSurf run without grades", () => {
    const pending = { ...consurf, status: "prepared", stage: "Ready to upload to ConSurf", residueCount: 0 };
    const facts = proteinFacts(bundle({ conservationJobs: [pending] }));
    assert.equal(facts.conservation.status, "missing");
    if (facts.conservation.status === "missing") assert.match(facts.conservation.reason, /Ready to upload to ConSurf/);
  });

  it("tolerates an engine that predates conservation runs", () => {
    const facts = proteinFacts({ ...bundle(), conservationJobs: undefined });
    assert.equal(facts.conservation.status, "missing");
  });

  it("says when an AlphaFold Server job is waiting for its result", () => {
    const facts = proteinFacts(bundle({ projectJobs: [job("alphafold", { source: "AlphaFold Server", submissionPath: "/tmp/x.json" }, undefined, "in_progress")] }));
    assert.equal(facts.alphaFoldModels.status, "missing");
    if (facts.alphaFoldModels.status === "missing") assert.match(facts.alphaFoldModels.reason, /no result has been imported/);
  });
});

describe("FACT_JOBS", () => {
  it("names real workflow jobs with their current titles", () => {
    for (const fact of Object.values(FACT_JOBS)) {
      const definition = workflowJobs.find((item) => item.id === fact.jobId);
      assert.ok(definition, fact.jobId);
      assert.equal(definition.appType, fact.appType);
      assert.equal(definition.label, fact.label);
    }
  });

  it("explains every fact", () => {
    for (const guide of Object.values(FACT_GUIDE)) assert.ok(guide.label && guide.explanation.length > 60);
  });
});
