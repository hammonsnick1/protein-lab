// Crystallization guidance tailored from protein facts. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { citations, citationScope, type CitationId } from "./citations.ts";
import {
  averageMassKDa, COMPONENT_ROLES, componentRolesFor, crystallizationProfile, DROP_CITATIONS, GUIDANCE_CITATIONS, ligandAdvice,
  membraneNote, PUBLISHED_STARTING_RANGE, READ_THE_FIRST_PLATE, SCREENS, startingConcentration, suggestScreens, tailoringNotes,
  type CrystallizationProfile,
} from "./crystallization-guidance.ts";
import type { FactJob, ProteinFacts, RegionFact } from "./protein-facts.ts";

const CA2 = "MSHHWGYGKHNGPEHWHKDFPIAKGERQSPVDIDTHTAKYDPSLKPLSVSYDQATSLRILNNGHAFNVEFDDSQDKAVLKGGPLDGTYRLIQFHFHWGSLDGQGSEHTVDKKKYAAELHLVHWNTKYGDFGKAVQQPDGLAVLGIFLKVGSAKPGLQKVVDVLDSIKTKGKSADFTNFDPRGLLPESLDYWTYPGSLTTPPLLECVTWIVLKEPISVSSEQVLKFRKLNFNGEGEPEELMVDNWRPAQPLKNRQIKASFK";
const job: FactJob = { jobId: "readiness", appType: "protein-readiness", label: "Protein readiness check" };
const missing = { status: "missing" as const, producedBy: job, reason: "not run" };
const region = (verdict: RegionFact["verdict"]) => ({ status: "known" as const, value: { verdict, answer: "Yes" as const, regions: [], evidence: "" }, sources: [] });

function facts(overrides: Partial<ProteinFacts> = {}): ProteinFacts {
  return {
    sequence: { status: "known", value: { sequence: CA2, length: CA2.length }, sources: [] },
    reference: missing, membrane: missing, disorder: missing, cofactors: missing,
    pdbHits: missing, conservation: missing, alphaFoldModels: missing,
    ...overrides,
  };
}

const profile = (overrides: Partial<CrystallizationProfile> = {}): CrystallizationProfile => ({
  residues: 260, massKDa: 29.2, membrane: "no", disorder: "no", ligands: [], cofactorReview: { status: "known", required: "No" }, pdbConditions: [], ...overrides,
});

describe("crystallization profile", () => {
  it("computes the average mass from the sequence", () => {
    // ExPASy ProtParam gives 29,245.9 Da for P00918 (CA II, 260 aa).
    assert.ok(Math.abs(averageMassKDa(CA2) - 29.246) < 0.01, String(averageMassKDa(CA2)));
  });

  it("reads membrane, disorder, ligands and deposited crystal growth from the facts", () => {
    const result = crystallizationProfile(facts({
      membrane: region("yes"),
      disorder: region("uncertain"),
      cofactors: { status: "known", value: { required: "Yes", cofactors: [{ name: "Zn(2+)", chebiId: null, key: "zn", sources: [] }] }, sources: [] },
      pdbHits: { status: "known", sources: [], value: { searchedWithoutHits: false, hits: [
        { pdbId: "1CA2", identity: 1, crystalGrowth: [{ method: "VAPOR DIFFUSION, HANGING DROP", pH: 8, temperatureK: 293, details: "2.5 M ammonium sulfate, 50 mM Tris pH 8" }, { method: null, pH: null, temperatureK: null, details: null }] },
      ] as never } },
    }));
    assert.equal(result.residues, 260);
    assert.equal(result.membrane, "yes");
    assert.equal(result.disorder, "uncertain");
    assert.deepEqual(result.ligands, ["Zn(2+)"]);
    assert.equal(result.pdbConditions.length, 1, "empty growth rows are dropped");
    assert.equal(result.pdbConditions[0].growth.pH, 8);
  });

  it("treats unreviewed facts as unknown rather than no", () => {
    const result = crystallizationProfile(facts({ sequence: { status: "missing", producedBy: job, reason: "" } }));
    assert.equal(result.membrane, "unknown");
    assert.equal(result.massKDa, null);
    assert.match(membraneNote(result) ?? "", /Protein readiness check/);
  });

  it("never reports a missing cofactor answer as none", () => {
    const reason = "No cofactor is recorded. Choose a UniProt reference, or answer “Requires a cofactor?” in Protein readiness check.";
    const ligands = (overrides: Partial<ProteinFacts>) => tailoringNotes(crystallizationProfile(facts(overrides))).find((note) => note.label === "Ligands and cofactors")?.value;
    assert.equal(ligands({ cofactors: { ...missing, reason } }), `Not answered yet — ${reason}`);
    assert.equal(ligands({ cofactors: { status: "known", value: { required: "No", cofactors: [] }, sources: [] } }), "None needed, by the scientist's review");
    assert.match(ligands({ cofactors: { status: "known", value: { required: "Yes", cofactors: [] }, sources: [] } }) ?? "", /none is named/);
    assert.equal(ligands({ cofactors: { status: "known", value: { required: "Not reviewed", cofactors: [{ name: "Zn(2+)", chebiId: null, key: "ion:ZN", sources: [] }] }, sources: [] } }), "Zn(2+)");
  });
});

describe("screen suggestions", () => {
  it("starts a soluble protein on broad sparse-matrix screens", () => {
    const first = suggestScreens(profile()).filter((item) => item.priority === "first").map((item) => item.screen.id);
    assert.deepEqual(first, ["jcsg-plus", "index"]);
  });

  it("puts MemGold first for a membrane protein and moves soluble screens later", () => {
    const list = suggestScreens(profile({ membrane: "yes" }));
    assert.equal(list[0].screen.id, "memgold");
    assert.equal(list.find((item) => item.screen.id === "index")?.priority, "later");
  });

  it("keeps MemGold in view while membrane status is open, and drops it for a soluble protein", () => {
    assert.equal(suggestScreens(profile({ membrane: "unknown" })).find((item) => item.screen.id === "memgold")?.priority, "later");
    assert.equal(suggestScreens(profile()).find((item) => item.screen.id === "memgold"), undefined);
  });

  it("promotes Morpheus and names the ligand when one is recorded", () => {
    const morpheus = suggestScreens(profile({ ligands: ["Heme"] })).find((item) => item.screen.id === "morpheus");
    assert.equal(morpheus?.priority, "first");
    assert.match(morpheus?.why.map((line) => line.text).join(" ") ?? "", /Heme/);
    assert.match(ligandAdvice(profile({ ligands: ["Heme"] })) ?? "", /co-crystallization/);
    assert.match(ligandAdvice(profile({ ligands: ["Heme"] })) ?? "", /Add it to/);
    assert.match(ligandAdvice(profile({ ligands: ["Heme", "Mg(2+)"] })) ?? "", /Add them to/);
  });

  it("gives every suggestion a reason, every reason a source and every screen a citation", () => {
    for (const membrane of ["yes", "no", "unknown"] as const) {
      for (const item of suggestScreens(profile({ membrane, ligands: membrane === "no" ? [] : ["Zn"] }))) {
        assert.ok(item.why.length > 0, item.screen.id);
        for (const line of item.why) assert.ok(line.citations.length > 0, line.text);
        assert.ok(item.screen.citations.length > 0, item.screen.id);
      }
    }
  });
});

describe("starting concentration", () => {
  it("scales with size", () => {
    assert.equal(startingConcentration(profile({ massKDa: 8 })).start, 20);
    assert.equal(startingConcentration(profile({ massKDa: 29 })).start, 10);
    assert.equal(startingConcentration(profile({ massKDa: 150 })).start, 5);
  });

  it("reports the start as molarity", () => {
    assert.ok(Math.abs((startingConcentration(profile({ massKDa: 25 })).startMicromolar ?? 0) - 400) < 1e-9);
  });

  it("keeps membrane proteins at the lower end and the range ordered", () => {
    const advice = startingConcentration(profile({ massKDa: 8, membrane: "yes" }));
    assert.ok(advice.low <= advice.start && advice.start <= advice.high);
    assert.ok(advice.high <= 15);
    assert.match(advice.why.map((line) => line.text).join(" "), /micelle/);
  });

  it("labels the size cut-offs as the app's own rule of thumb", () => {
    for (const massKDa of [null, 8, 29, 150]) {
      const [size] = startingConcentration(profile({ massKDa })).why;
      assert.ok(size.citations.includes("pl-crystal-rules"), String(massKDa));
    }
  });
});

describe("drop components", () => {
  it("only applies the detergent role to membrane proteins", () => {
    const soluble = componentRolesFor(profile()).find((item) => item.role.id === "detergent");
    const membrane = componentRolesFor(profile({ membrane: "yes" })).find((item) => item.role.id === "detergent");
    assert.equal(soluble?.applies, false);
    assert.equal(membrane?.applies, true);
  });

  it("reuses buffer-library entries where the component is the same", () => {
    const linked = COMPONENT_ROLES.flatMap((role) => role.examples).filter((example) => example.library).map((example) => example.library!.entry.id);
    assert.deepEqual(linked.sort(), ["ddm", "glycerol", "hepes", "mes", "nacl", "tcep", "tris"]);
  });

  it("sources every typical amount, tip and reused library caution", () => {
    for (const role of COMPONENT_ROLES) {
      assert.ok(role.tip.citations.length > 0, role.id);
      for (const example of role.examples) {
        assert.ok(example.citations.length > 0, example.name);
        if (example.library) assert.ok(example.library.citations.length > 0, example.name);
      }
    }
  });
});

describe("citations", () => {
  it("lists every cited source once, in the registry", () => {
    const used = new Set<CitationId>([
      ...Object.values(SCREENS).flatMap((screen) => screen.citations),
      ...COMPONENT_ROLES.flatMap((role) => role.citations),
      ...DROP_CITATIONS,
      ...COMPONENT_ROLES.flatMap((role) => [...role.tip.citations, ...role.examples.flatMap((example) => [...example.citations, ...example.library?.citations ?? []])]),
      ...[profile({ membrane: "yes", disorder: "yes" }), profile({ massKDa: 8 }), profile({ massKDa: 150 })].flatMap((item) => startingConcentration(item).why.flatMap((line) => line.citations)),
      ...[profile({ membrane: "yes", ligands: ["Zn"] }), profile({ membrane: "unknown" })].flatMap((item) => suggestScreens(item).flatMap((suggestion) => suggestion.why.flatMap((line) => line.citations))),
      ...PUBLISHED_STARTING_RANGE.citations, ...READ_THE_FIRST_PLATE.citations,
      "jancarik1991", "newman2005", "hassell2007", "dale2003", "asherie2004", "chayen2008", "pdb2000", "pl-crystal-rules",
    ]);
    const scope = citationScope("test", GUIDANCE_CITATIONS);
    for (const id of used) assert.doesNotThrow(() => scope.number(id), id);
    for (const id of GUIDANCE_CITATIONS) assert.ok(citations[id], id);
    assert.equal(new Set(GUIDANCE_CITATIONS).size, GUIDANCE_CITATIONS.length);
  });
});
