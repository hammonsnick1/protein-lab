// What the panel actually renders. The first paint is what a student sees, so
// this checks the list, the highlights, the two diagrams, the operation chips
// and the honest notes where a predictor did not run.
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { SpaceGroupExplorer } from "./space-group-explorer.tsx";
import type { ProteinFacts } from "../../lib/protein-facts.ts";

const text = (html: string) => html.replace(/<[^>]+>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ");
const options = (html: string) => [...html.matchAll(/role="option"/g)].length;

/** A facts object with only the PDB hits filled in, as `proteinFacts` returns. */
function factsWithHits(hits: { pdbId: string; spaceGroup: string | null }[]): ProteinFacts {
  const missing = { status: "missing", producedBy: { jobId: "sequence", appType: "protein-planner", label: "Protein sequence" }, reason: "not run" } as const;
  return {
    sequence: missing, reference: missing, membrane: missing, disorder: missing,
    cofactors: missing, conservation: missing, alphaFoldModels: missing,
    pdbHits: {
      status: "known",
      sources: [],
      value: {
        searchedWithoutHits: false,
        hits: hits.map((hit) => ({
          pdbId: hit.pdbId, spaceGroup: hit.spaceGroup,
          unitCell: { a: 42.1, b: 41.4, c: 73.1, alpha: 90, beta: 90, gamma: 90 },
          crystalGrowth: [], entryUrl: `https://www.rcsb.org/structure/${hit.pdbId}`, fetchedAt: null,
          title: "", identity: null, coverage: null, method: "X-RAY DIFFRACTION", resolution: null,
          source: "pdb", accession: hit.pdbId, organism: "", length: null, description: "",
        })) as unknown as ProteinFacts["pdbHits"] extends { status: "known"; value: { hits: infer T } } ? T : never,
      },
    },
  } as unknown as ProteinFacts;
}

describe("the space-group explorer", () => {
  const plain = renderToStaticMarkup(<SpaceGroupExplorer proteinName="carbonic anhydrase II"/>);

  it("lists the 65 Sohncke groups and says why those are the ones", () => {
    assert.equal(options(plain), 65);
    assert.match(text(plain), /only the 65 Sohncke groups leave a protein's handedness alone/);
    assert.match(text(plain), /65 for proteins/);
    assert.match(text(plain), /All 230/);
    for (const system of ["Triclinic", "Monoclinic", "Orthorhombic", "Tetragonal", "Trigonal", "Hexagonal", "Cubic"]) {
      assert.match(text(plain), new RegExp(system), system);
    }
  });

  it("opens on P212121 with its facts, diagrams and operations", () => {
    const body = text(plain);
    assert.match(body, /Number 19 of 230/);
    assert.match(body, /Copies per cell 4/);
    assert.match(body, /Asymmetric unit 1\/4 of the cell/);
    assert.match(plain, /aria-label="Symmetry-element diagram of space group P2₁2₁2₁: \d+ elements in one unit cell"/);
    assert.match(plain, /aria-label="General-position diagram of space group P2₁2₁2₁: 4 copies of the asymmetric unit"/);
    assert.match(body, /Symmetry operations 4/);
    assert.match(body, /4 copies of carbonic anhydrase II in one cell/);
  });

  it("steps through the first screw axis in plain language", () => {
    const body = text(plain);
    assert.match(body, /Step 1: turn a half turn \(180°\) about c and slide ½ along c/);
    assert.match(body, /Step 1 of 2/);
    assert.match(body, /spiral staircase/);
  });

  it("says what is missing instead of inventing a prediction", () => {
    const body = text(plain);
    assert.match(body, /No saved PDB homologue records a space group yet/);
    assert.match(body, /no redistributable MASCL model ships with this installation/);
    assert.doesNotMatch(body, /\d+% likely|probability/);
  });

  it("flags and opens the group the saved homologues used", () => {
    const html = renderToStaticMarkup(<SpaceGroupExplorer
      proteinName="carbonic anhydrase II"
      facts={factsWithHits([{ pdbId: "1A42", spaceGroup: "P 1 21 1" }, { pdbId: "2CBA", spaceGroup: "P 1 21 1" }, { pdbId: "3KS3", spaceGroup: null }])}
    />);
    const body = text(html);
    assert.match(body, /Number 4 of 230/, "it opens on the homologues' group");
    assert.match(body, /2 PDB/, "the list flags it");
    assert.match(body, /2 saved PDB homologues crystallised in P21: 1A42, 2CBA/);
    assert.match(body, /Cell 42\.1 × 41\.4 × 73\.1 Å/);
  });

  it("passes a predictor's suggestion through with its source named", () => {
    const html = renderToStaticMarkup(<SpaceGroupExplorer
      suggestions={[{ symbol: "P 43 21 2", source: "MASCL", detail: "Best symmetrical-docking solution." }]}
      initialSymbol="P43212"
      predictorNote="MASCL ran on this installation."
    />);
    const body = text(html);
    assert.match(body, /MASCL suggests P43212\. Best symmetrical-docking solution\./);
    assert.match(body, /MASCL ran on this installation\./);
  });

  it("warns on an operation no protein can perform, in teaching mode's groups", () => {
    const html = renderToStaticMarkup(<SpaceGroupExplorer initialSymbol="P 1 m 1" proteinName="lysozyme"/>);
    const body = text(html);
    assert.match(body, /Protein crystals never adopt it/);
    assert.match(body, /lysozyme cannot do this/);
    assert.match(body, /mirror image/);
  });

  it("cites the Tables, the UCL diagrams and the table's source", () => {
    assert.match(plain, /id="ref-space-groups-ita2016"/);
    assert.match(plain, /id="ref-space-groups-ucl-sgp"/);
    assert.match(plain, /id="ref-space-groups-gemmi"/);
    assert.match(plain, /id="ref-space-groups-wukovitz1995"/);
    assert.match(text(plain), /Wukovitz/);
  });
});
