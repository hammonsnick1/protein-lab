// The oligomeric state recorded in Protein properties (HOM-193). Run with
// `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { ProjectJob, ProteinBundle } from "./protein-labs-api.ts";
import { assemblyValue, oligomericLabel, oligomericStateConfig, oligomericStateProblem, oligomericSummary, readOligomericState, subunitCount, unknownState, type OligomericState } from "./oligomeric-state.ts";
import { proteinProperties, reportHtml, reportMarkdown, type ReportPage } from "./report-export.ts";

const state = (patch: Partial<OligomericState>): OligomericState => ({ ...unknownState, ...patch });

/** What a save then a reload hands back: the config goes through JSON, as it does via the engine. */
function roundTrip(value: OligomericState) {
  return readOligomericState(JSON.parse(JSON.stringify({ reviewStatus: "calculated", oligomericState: oligomericStateConfig(value) })));
}

describe("oligomeric state save and load", () => {
  it("round-trips every kind with its notes and evidence", () => {
    const cases: OligomericState[] = [
      state({ kind: "monomer" }),
      state({ kind: "homodimer", evidence: "SEC", notes: "Dimer above 1 mg/mL" }),
      state({ kind: "homotrimer" }),
      state({ kind: "homotetramer", evidence: "Crystal structure" }),
      state({ kind: "homo-oligomer", subunits: 12, evidence: "Cryo-EM structure" }),
      state({ kind: "hetero-complex", complexNote: "α2β2 with HBA1", evidence: "Literature" }),
      state({ kind: "unknown" }),
    ];
    for (const value of cases) assert.deepEqual(roundTrip(value), value, value.kind);
  });

  it("trims text and drops fields that do not apply to the kind", () => {
    const saved = oligomericStateConfig(state({ kind: "homodimer", subunits: 9, complexNote: "stale", notes: "  ", evidence: " SEC " }));
    assert.deepEqual(saved, { kind: "homodimer", evidence: "SEC" });
  });

  it("returns null when nothing was recorded or the saved value is unreadable", () => {
    assert.equal(readOligomericState(undefined), null);
    assert.equal(readOligomericState({}), null);
    assert.equal(readOligomericState({ oligomericState: "dimer" }), null);
    assert.equal(readOligomericState({ oligomericState: { kind: "pentamer" } }), null);
  });

  it("ignores an invalid higher-order subunit count", () => {
    for (const subunits of [4, 6.5, -8, "x"]) assert.equal(readOligomericState({ oligomericState: { kind: "homo-oligomer", subunits } })?.subunits, null, String(subunits));
    assert.equal(readOligomericState({ oligomericState: { kind: "homo-oligomer", subunits: "6" } })?.subunits, 6);
  });

  it("asks for the subunit count or complex composition before saving", () => {
    assert.match(oligomericStateProblem(state({ kind: "homo-oligomer" })) ?? "", /number of identical subunits/);
    assert.match(oligomericStateProblem(state({ kind: "hetero-complex", complexNote: " " })) ?? "", /Describe the hetero-complex/);
    assert.equal(oligomericStateProblem(state({ kind: "homo-oligomer", subunits: 6 })), null);
    assert.equal(oligomericStateProblem(state({ kind: "unknown" })), null);
  });
});

describe("oligomeric scaling", () => {
  it("counts identical subunits only where the sequence defines them", () => {
    assert.equal(subunitCount(state({ kind: "monomer" })), 1);
    assert.equal(subunitCount(state({ kind: "homotetramer" })), 4);
    assert.equal(subunitCount(state({ kind: "homo-oligomer", subunits: 24 })), 24);
    assert.equal(subunitCount(state({ kind: "hetero-complex", complexNote: "α2β2" })), null);
    assert.equal(subunitCount(state({ kind: "unknown" })), null);
    assert.equal(subunitCount(null), null);
  });

  it("scales a monomer value by the subunit count for homo-oligomers only", () => {
    assert.equal(assemblyValue(15998.2064, state({ kind: "homodimer" })), 31996.4128);
    assert.equal(assemblyValue(15470, state({ kind: "homo-oligomer", subunits: 6 })), 92820);
    assert.equal(assemblyValue(15998.2064, state({ kind: "monomer" })), null);
    assert.equal(assemblyValue(15998.2064, state({ kind: "hetero-complex", complexNote: "α2β2" })), null);
    assert.equal(assemblyValue(undefined, state({ kind: "homodimer" })), null);
  });

  it("labels each kind for the report", () => {
    assert.equal(oligomericLabel(state({ kind: "homo-oligomer", subunits: 12 })), "Homo-12-mer");
    assert.equal(oligomericLabel(state({ kind: "hetero-complex", complexNote: "α2β2" })), "Hetero-complex — α2β2");
    assert.equal(oligomericSummary(state({ kind: "homotetramer", evidence: "SEC" })), "Homotetramer · 4 identical subunits · evidence: SEC");
    assert.equal(oligomericSummary(state({ kind: "monomer" })), "Monomer");
  });
});

// Human haemoglobin β with the engine's ProtParam output, as in report-export.test.ts.
function bundle(oligomericState?: OligomericState): ProteinBundle {
  const protparam: ProjectJob = { id: "pp", proteinId: "p1", name: "Protein properties", appType: "protparam", status: "complete", config: oligomericState ? { reviewStatus: "calculated", oligomericState: oligomericStateConfig(oligomericState) } : { reviewStatus: "calculated" }, createdAt: "", updatedAt: "" };
  return {
    protein: { id: "p1", name: "Hemoglobin subunit beta", sequence: "M".repeat(147), organism: "Homo sapiens", geneName: "HBB", description: "", expressionSystem: "", notes: "", tags: [], externalIds: {} },
    protparam: { result: { molecularWeightDa: 15998.206400000001, theoreticalPI: 6.744537544250489, extinctionCoefficient280: { reducedMolarM1Cm1: 15470, oxidizedMolarM1Cm1: 15595 } }, analyzedAt: "" },
    blastJobs: [], uniprotMatches: [], pdbMatches: [], alphaFoldModels: [], projectJobs: [protparam], projectNotebook: null,
  };
}
const page: ReportPage = { id: "properties", templateId: "properties", title: "Protein properties", subtitle: "", content: "", hidden: false, showFacts: true, figures: [] };

describe("oligomeric state in the report", () => {
  it("says the state was not recorded and keeps the monomer labels", () => {
    const rows = new Map(proteinProperties(bundle()).properties);
    assert.equal(rows.get("Oligomeric state"), "Not recorded");
    assert.equal(rows.get("Molecular weight"), "15,998.21 Da");
    assert.ok(![...rows.keys()].some((label) => label.includes("× monomer")));
  });

  it("shows monomer and labelled assembly values for a homodimer", () => {
    const rows = new Map(proteinProperties(bundle(state({ kind: "homodimer", evidence: "SEC", notes: "PDB 2HHB" }))).properties);
    assert.equal(rows.get("Oligomeric state"), "Homodimer · 2 identical subunits · evidence: SEC");
    assert.equal(rows.get("Monomer molecular weight"), "15,998.21 Da");
    assert.equal(rows.get("Homodimer molecular weight (2 × monomer)"), "31,996.41 Da");
    assert.equal(rows.get("Monomer ε₂₈₀ (reduced cysteines)"), "15,470 M⁻¹cm⁻¹");
    assert.equal(rows.get("Homodimer ε₂₈₀ (reduced cysteines, 2 × monomer)"), "30,940 M⁻¹cm⁻¹");
    assert.equal(rows.get("Homodimer ε₂₈₀ (cystines formed, 2 × monomer)"), "31,190 M⁻¹cm⁻¹");
    assert.equal(rows.get("Oligomeric-state notes"), "PDB 2HHB");
  });

  it("does not scale a hetero-complex", () => {
    const rows = new Map(proteinProperties(bundle(state({ kind: "hetero-complex", complexNote: "α2β2 with HBA1" }))).properties);
    assert.equal(rows.get("Oligomeric state"), "Hetero-complex — α2β2 with HBA1");
    assert.equal(rows.get("Molecular weight"), "15,998.21 Da");
    assert.ok(![...rows.keys()].some((label) => label.includes("× monomer")));
  });

  it("carries the state and assembly values into both exports", () => {
    const value = bundle(state({ kind: "homo-oligomer", subunits: 6, evidence: "Literature" }));
    const markdown = reportMarkdown(value, "Report", "Summary", [page]);
    const html = reportHtml(value, "Report", "Summary", [page], []);
    assert.match(markdown, /\| Oligomeric state \| Homo-6-mer · 6 identical subunits · evidence: Literature \|/);
    assert.match(markdown, /\| Homo-6-mer molecular weight \(6 × monomer\) \| 95,989\.24 Da \|/);
    assert.match(html, /<dt>Monomer molecular weight<\/dt><dd>15,998\.21 Da<\/dd>/);
    assert.match(html, /<dt>Homo-6-mer ε₂₈₀ \(reduced cysteines, 6 × monomer\)<\/dt><dd>92,820 M⁻¹cm⁻¹<\/dd>/);
  });
});
