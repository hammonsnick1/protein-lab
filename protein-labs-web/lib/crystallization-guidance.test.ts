// Crystallization guidance tailored from protein facts. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { citations, citationScope, type CitationId } from "./citations.ts";
import {
  averageMassKDa, COMPONENT_ROLES, componentRolesFor, crystallizationProfile, DROP_CITATIONS, GUIDANCE_CITATIONS, ligandAdvice,
  membraneNote, SCREENS, startingConcentration, suggestScreens, type CrystallizationProfile,
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
  residues: 260, massKDa: 29.2, membrane: "no", disorder: "no", ligands: [], pdbConditions: [], ...overrides,
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
    assert.match(morpheus?.why.join(" ") ?? "", /Heme/);
    assert.match(ligandAdvice(profile({ ligands: ["Heme"] })) ?? "", /co-crystallization/);
  });

  it("gives every suggestion a reason and every screen a citation", () => {
    for (const item of suggestScreens(profile({ membrane: "yes", ligands: ["Zn"] }))) {
      assert.ok(item.why.length > 0, item.screen.id);
      assert.ok(item.screen.citations.length > 0, item.screen.id);
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
    assert.match(advice.why.join(" "), /micelle/);
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
    const linked = COMPONENT_ROLES.flatMap((role) => role.examples).filter((example) => example.library).map((example) => example.library!.id);
    assert.deepEqual(linked.sort(), ["ddm", "glycerol", "hepes", "mes", "mgcl2", "nacl", "tcep", "tris"]);
  });
});

describe("citations", () => {
  it("lists every cited source once, in the registry", () => {
    const used = new Set<CitationId>([
      ...Object.values(SCREENS).flatMap((screen) => screen.citations),
      ...COMPONENT_ROLES.flatMap((role) => role.citations),
      ...DROP_CITATIONS,
      ...startingConcentration(profile({ membrane: "yes" })).citations,
      "jancarik1991", "newman2005", "hassell2007", "dale2003", "asherie2004", "chayen2008",
    ]);
    const scope = citationScope("test", GUIDANCE_CITATIONS);
    for (const id of used) assert.doesNotThrow(() => scope.number(id), id);
    for (const id of GUIDANCE_CITATIONS) assert.ok(citations[id], id);
    assert.equal(new Set(GUIDANCE_CITATIONS).size, GUIDANCE_CITATIONS.length);
  });
});
