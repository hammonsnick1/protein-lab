// Highlights read from saved evidence. The hit shape is the one
// `lib/protein-facts.ts` produces from a saved PDB homologue search, including
// the symbol spellings the PDB actually deposits.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  hasPrediction, masclSuggestions, spaceGroupHighlights, startingGroup, unresolvedSpaceGroups, type SpaceGroupHit,
} from "./space-group-evidence.ts";
import type { SpaceGroupSuggestion } from "./crystallization.ts";

const cell = { a: 38.2, b: 45.1, c: 62.7, alpha: 90, beta: 90, gamma: 90 };

const hit = (pdbId: string, spaceGroup: string | null, unitCell = null as SpaceGroupHit["unitCell"]): SpaceGroupHit =>
  ({ pdbId, spaceGroup, unitCell });

describe("space groups from saved evidence", () => {
  it("flags the group each homologue crystallised in, counting the entries", () => {
    const highlights = spaceGroupHighlights([
      hit("1A42", "P 21 21 21", cell), hit("2CBA", "P 21 21 21"), hit("3KS3", "P 1 21 1"),
    ]);
    assert.deepEqual([...highlights.keys()].sort((left, right) => left - right), [4, 19]);
    const orthorhombic = highlights.get(19)!;
    assert.equal(orthorhombic.kind, "pdb");
    assert.deepEqual(orthorhombic.pdbIds, ["1A42", "2CBA"]);
    assert.equal(orthorhombic.unitCell, cell);
    assert.match(orthorhombic.detail, /2 saved homologues crystallised in P212121: 1A42, 2CBA/);
    assert.equal(highlights.get(4)!.symbol, "P21");
  });

  it("reads the PDB's own spellings, including H for the rhombohedral groups", () => {
    const highlights = spaceGroupHighlights([hit("1ABC", "H 3"), hit("2ABC", "C 1 2 1"), hit("3ABC", "P 43 21 2")]);
    assert.deepEqual([...highlights.values()].map((highlight) => highlight.symbol).sort(), ["C2", "P43212", "R3"]);
  });

  it("ignores hits with no space group and reports names it cannot resolve", () => {
    const hits = [hit("1AAA", null), hit("2AAA", "P 21 21 21"), hit("3AAA", "Z 9 9 9")];
    assert.deepEqual([...spaceGroupHighlights(hits).keys()], [19]);
    assert.deepEqual(unresolvedSpaceGroups(hits), ["Z 9 9 9"]);
    assert.deepEqual(unresolvedSpaceGroups([]), []);
  });

  it("keeps a predictor's suggestion separate from real crystal forms", () => {
    const highlights = spaceGroupHighlights(
      [hit("1A42", "P 21 21 21")],
      [{ symbol: "P 43 21 2", source: "MASCL", detail: "Top-ranked docking solution." }, { symbol: "not a group", source: "MASCL" }],
    );
    assert.equal(highlights.get(96)!.kind, "predictor");
    assert.equal(highlights.get(96)!.source, "MASCL");
    assert.equal(highlights.get(96)!.detail, "Top-ranked docking solution.");
    assert.equal(highlights.size, 2, "an unresolvable suggestion is dropped, not guessed");
  });

  it("lets evidence win when a predictor names the same group", () => {
    const highlights = spaceGroupHighlights([hit("1A42", "P 21 21 21")], [{ symbol: "P212121", source: "MASCL" }]);
    assert.equal(highlights.get(19)!.kind, "pdb");
    assert.deepEqual(highlights.get(19)!.pdbIds, ["1A42"]);
  });

  it("keeps the prediction on a group a homologue also used, rather than dropping it", () => {
    const highlights = spaceGroupHighlights(
      [hit("1ABC", "P 43 21 2", cell)],
      masclSuggestions([{ spaceGroup: "P 43 21 2", origin: "mascl", probability: 0.41, homologueCount: 1 }]),
    );
    const both = highlights.get(96)!;
    // The evidence leads: it is a fact about a real crystal.
    assert.equal(both.kind, "pdb");
    assert.deepEqual(both.pdbIds, ["1ABC"]);
    assert.equal(both.unitCell, cell);
    // …and the prediction survives, so the list can show both flags.
    assert.deepEqual(both.predictor, { source: "MASCL", detail: "MASCL probability 0.41." });
    assert.equal(hasPrediction(highlights), true);
  });

  it("sets predictor on a prediction-only group and leaves it off a homologue-only one", () => {
    const predicted = spaceGroupHighlights([], [{ symbol: "P 43 21 2", source: "MASCL", detail: "Top-ranked." }]);
    assert.deepEqual(predicted.get(96)!.predictor, { source: "MASCL", detail: "Top-ranked." });

    const evidenceOnly = spaceGroupHighlights([hit("1A42", "P 21 21 21")]);
    assert.equal(evidenceOnly.get(19)!.predictor, undefined);
    assert.equal(hasPrediction(evidenceOnly), false);
  });

  it("reports no prediction when every suggested symbol is unresolvable", () => {
    assert.equal(hasPrediction(spaceGroupHighlights([], [{ symbol: "not a group", source: "MASCL" }])), false);
    assert.equal(hasPrediction(new Map()), false);
  });

  it("opens on the group most homologues used, or P212121 with no evidence", () => {
    const many = spaceGroupHighlights([hit("1A", "P 21"), hit("2A", "C 1 2 1"), hit("3A", "C 1 2 1")]);
    assert.equal(startingGroup(many), "C2");
    assert.equal(startingGroup(new Map()), "P212121");
    assert.equal(startingGroup(many, "P 43 21 2"), "P43212", "an explicit choice wins");
    assert.equal(startingGroup(new Map(), "nonsense"), "P212121");
  });
});

// The Crystallize job hands the engine's `assessment.spaceGroups` to the
// selector through `masclSuggestions` (see `crystallize-job.tsx`).
describe("engine suggestions mapped for the selector", () => {
  const suggestion = (
    spaceGroup: string, origin: SpaceGroupSuggestion["origin"], probability: number | null, homologueCount = 0,
  ): SpaceGroupSuggestion => ({ spaceGroup, origin, probability, homologueCount });

  it("keeps only the predictions, and says the probability in the job's own format", () => {
    assert.deepEqual(masclSuggestions([suggestion("P 21 21 21", "mascl", 0.42)]), [
      { symbol: "P 21 21 21", source: "MASCL", detail: "MASCL probability 0.42." },
    ]);
  });

  it("drops the homologue reports, which arrive as evidence from the facts helper instead", () => {
    const mapped = masclSuggestions([
      suggestion("C 1 2 1", "homologue", null, 3),
      suggestion("P 43 21 2", "mascl", 0.18),
    ]);
    assert.deepEqual(mapped.map((entry) => entry.symbol), ["P 43 21 2"]);
  });

  it("keeps a prediction that has no probability, and says so", () => {
    const [mapped] = masclSuggestions([suggestion("P 31 2 1", "mascl", null, 2)]);
    assert.equal(mapped.detail, "Suggested by MASCL, which gave no probability.");
  });

  it("maps nothing when the engine suggested nothing", () => {
    assert.deepEqual(masclSuggestions([]), []);
    assert.deepEqual(masclSuggestions(), []);
  });

  it("produces symbols the table resolves, so the suggestion really flags a group", () => {
    const highlights = spaceGroupHighlights([], masclSuggestions([suggestion("P 21 21 21", "mascl", 0.42)]));
    assert.equal(highlights.get(19)!.kind, "predictor");
    assert.equal(highlights.get(19)!.detail, "MASCL probability 0.42.");
  });
});
