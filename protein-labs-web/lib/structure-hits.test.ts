// Sequence research hits → Structure Viewer choices. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { choiceKey, defaultChoiceKey, mappedChainIds, nextChoiceKey, normalizePdbId, percentText, researchHits, structureChoices } from "./structure-hits.ts";
import type { StructureEntry } from "./structure-regions.ts";

// The record shape saved by older versions: methods and resolutions as lists, coverage inside `comparison`.
const legacy4hhb = { pdbId: "4HHB", entityId: "2", title: "THE CRYSTAL STRUCTURE OF HUMAN DEOXYHAEMOGLOBIN AT 1.74 ANGSTROMS RESOLUTION", entityDescription: "Hemoglobin subunit beta", experimentalMethods: ["X-RAY DIFFRACTION"], resolutionAngstrom: [1.74], identity: 1, similarity: 1, comparison: { queryCoverage: 1 } };
// The current shape: scalar method/resolution/coverage and author chain IDs.
const stable1a3n = { pdbId: "1a3n", entityId: "2", chainId: "B", chainIds: ["B", "D"], title: "DEOXY HUMAN HEMOGLOBIN", entityDescription: "HEMOGLOBIN (BETA CHAIN)", method: "X-RAY DIFFRACTION", resolution: 1.8, resolutionAngstrom: [1.8], identity: 0.993, coverage: 0.98 };

const alphaFold: StructureEntry = { id: "AF-P68871-F1", source: "alphafold_db", format: "cif", chains: [], ligands: [] };
const listed4hhb: StructureEntry = { id: "4HHB", source: "pdb", format: "cif", title: "Engine title", method: "X-RAY DIFFRACTION", resolutionAngstrom: 1.74, chains: [{ chainId: "B", labelChainId: "B", residueCount: 146, modeledResidueCount: 146 }], ligands: [], siftsAvailable: true, mappedChains: ["B", "D"] };
const listed2dn2: StructureEntry = { id: "2DN2", source: "pdb", format: "cif", chains: [], ligands: [] };

describe("researchHits", () => {
  it("reads the original and the stable record shapes", () => {
    const [a, b] = researchHits([legacy4hhb, stable1a3n]);
    assert.deepEqual(a, { pdbId: "4HHB", entityIds: ["2"], chainIds: [], title: legacy4hhb.title, description: "Hemoglobin subunit beta", method: "X-RAY DIFFRACTION", resolutionAngstrom: 1.74, identity: 1, coverage: 1 });
    assert.deepEqual(b, { pdbId: "1A3N", entityIds: ["2"], chainIds: ["B", "D"], title: "DEOXY HUMAN HEMOGLOBIN", description: "HEMOGLOBIN (BETA CHAIN)", method: "X-RAY DIFFRACTION", resolutionAngstrom: 1.8, identity: 0.993, coverage: 0.98 });
  });

  it("merges the entities of one entry, keeping research order and the best entity's metrics", () => {
    const hits = researchHits([
      { pdbId: "1ABC", entityId: "1", chainIds: ["A"], identity: 0.4, coverage: 0.5, entityDescription: "weak" },
      { pdbId: "2XYZ", entityId: "1", identity: 0.9 },
      { pdbId: "1abc", entityId: "2", chainIds: ["B", "A"], identity: 0.8, coverage: 0.9, entityDescription: "strong" },
    ]);
    assert.deepEqual(hits.map((hit) => hit.pdbId), ["1ABC", "2XYZ"]);
    assert.deepEqual(hits[0].entityIds, ["1", "2"]);
    assert.deepEqual(hits[0].chainIds, ["A", "B"]);
    assert.equal(hits[0].identity, 0.8);
    assert.equal(hits[0].coverage, 0.9);
    assert.equal(hits[0].description, "strong");
  });

  it("leaves unreported metrics null instead of showing 0", () => {
    const [hit] = researchHits([{ pdbId: "7XYZ", experimentalMethods: [], resolutionAngstrom: [], identity: null, comparison: null }]);
    assert.equal(hit.method, null);
    assert.equal(hit.resolutionAngstrom, null);
    assert.equal(hit.identity, null);
    assert.equal(hit.coverage, null);
  });

  it("takes the best of several resolutions and ignores nonsense values", () => {
    assert.equal(researchHits([{ pdbId: "1AAA", resolutionAngstrom: [2.5, 1.9, null] }])[0].resolutionAngstrom, 1.9);
    assert.equal(researchHits([{ pdbId: "1AAA", resolutionAngstrom: "n/a", identity: 87 }])[0].resolutionAngstrom, null);
    assert.equal(researchHits([{ pdbId: "1AAA", identity: 87 }])[0].identity, null);
  });

  it("skips records without a valid PDB ID", () => {
    assert.deepEqual(researchHits([null, "4HHB", {}, { pdbId: "" }, { pdbId: "HHB4" }, { pdbId: "4HHBX" }]), []);
    assert.deepEqual(researchHits(undefined), []);
  });
});

describe("normalizePdbId", () => {
  it("accepts four-character entry IDs in any case", () => {
    assert.equal(normalizePdbId(" 4hhb "), "4HHB");
    assert.equal(normalizePdbId("1A3N"), "1A3N");
  });
  it("rejects anything else", () => {
    for (const value of ["", "HHB4", "4HH", "4HHB1", "4H-B", "P68871"]) assert.equal(normalizePdbId(value), null, value);
  });
});

describe("structureChoices", () => {
  const hits = researchHits([stable1a3n, legacy4hhb]);

  it("lists AlphaFold, every research hit, other linked entries, then manual IDs, each once", () => {
    const choices = structureChoices([alphaFold, listed4hhb, listed2dn2], hits, ["6bb5", "1a3n", "bad"]);
    assert.deepEqual(choices.map((choice) => [choice.origin, choice.key]), [
      ["alphafold", "alphafold_db:AF-P68871-F1"],
      ["research", "pdb:1A3N"],
      ["research", "pdb:4HHB"],
      ["reference", "pdb:2DN2"],
      ["manual", "pdb:6BB5"],
    ]);
  });

  it("keeps the engine's details for a listed entry and adds the research metrics", () => {
    const choice = structureChoices([listed4hhb], hits).find((item) => item.key === "pdb:4HHB");
    assert.equal(choice?.entry, listed4hhb);
    assert.equal(choice?.hit?.identity, 1);
  });

  it("builds a loadable entry for a hit the engine did not list", () => {
    const choice = structureChoices([], hits)[0];
    assert.equal(choice.entry.id, "1A3N");
    assert.equal(choice.entry.source, "pdb");
    assert.equal(choice.entry.title, "DEOXY HUMAN HEMOGLOBIN");
    assert.equal(choice.entry.resolutionAngstrom, 1.8);
    assert.deepEqual(choice.entry.chains, []);
  });
});

describe("default and kept choice", () => {
  const hits = researchHits([stable1a3n, legacy4hhb]);
  it("still opens the AlphaFold model first", () => {
    const structures = [listed4hhb, alphaFold];
    assert.equal(defaultChoiceKey(structures, structureChoices(structures, hits)), "alphafold_db:AF-P68871-F1");
  });
  it("otherwise opens the engine's first entry, as before", () => {
    const structures = [listed2dn2, listed4hhb];
    assert.equal(defaultChoiceKey(structures, structureChoices(structures, hits)), "pdb:2DN2");
  });
  it("opens the best research hit when the engine lists nothing", () => {
    assert.equal(defaultChoiceKey([], structureChoices([], hits)), "pdb:1A3N");
    assert.equal(defaultChoiceKey([], []), "");
  });
  it("keeps the user's choice across a refresh while it still exists", () => {
    const structures = [alphaFold];
    assert.equal(nextChoiceKey("pdb:4HHB", structures, structureChoices(structures, hits)), "pdb:4HHB");
    assert.equal(nextChoiceKey("pdb:9ZZZ", structures, structureChoices(structures, hits)), "alphafold_db:AF-P68871-F1");
  });
  it("normalizes PDB keys so 1a3n and 1A3N are one choice", () => {
    assert.equal(choiceKey({ source: "pdb", id: "1a3n" }), "pdb:1A3N");
  });
});

describe("display helpers", () => {
  it("lists only chains the engine placed on UniProt numbering", () => {
    assert.deepEqual(mappedChainIds([
      { chainId: "B", labelSeqId: 1, uniprotPosition: 2 },
      { chainId: "B", labelSeqId: 2, uniprotPosition: 3 },
      { chainId: "A", labelSeqId: 1, uniprotPosition: null },
      { chainId: null, labelSeqId: null, uniprotPosition: 4 },
      { chainId: "D", labelSeqId: 5, uniprotPosition: 6 },
    ]), ["B", "D"]);
    assert.deepEqual(mappedChainIds(undefined), []);
  });
  it("formats fractions as percentages", () => {
    assert.equal(percentText(1), "100%");
    assert.equal(percentText(0.993), "99.3%");
    assert.equal(percentText(0.5), "50%");
    assert.equal(percentText(null), "—");
  });
});
