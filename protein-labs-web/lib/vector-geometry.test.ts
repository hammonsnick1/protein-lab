// Tests for the vector editor's coordinate, layout and sequence maths.
// Run with `npm run test` in protein-labs-web (Node's built-in runner).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  angleToBase,
  assignTracks,
  clipRange,
  cutSitesFromEnzymeRows,
  cutSitesFromRecord,
  dragRange,
  featureCategory,
  featureColor,
  formatRange,
  layoutCircularLabels,
  locateMcs,
  niceTickStep,
  oligoTm,
  panViewport,
  rangeContains,
  rangeLength,
  rangeSequence,
  reverseComplement,
  spreadPositions,
  translate,
  zoomViewport,
} from "./vector-geometry.ts";

describe("ranges", () => {
  it("measures and tests ranges that wrap the origin", () => {
    assert.equal(rangeLength({ start: 10, end: 20 }, 100), 10);
    assert.equal(rangeLength({ start: 95, end: 5 }, 100), 10);
    assert.ok(rangeContains({ start: 95, end: 5 }, 98));
    assert.ok(rangeContains({ start: 95, end: 5 }, 2));
    assert.ok(!rangeContains({ start: 95, end: 5 }, 5));
    assert.ok(!rangeContains({ start: 95, end: 5 }, 50));
  });

  it("clips a wrapping range into the visible window", () => {
    assert.deepEqual(clipRange({ start: 95, end: 5 }, 0, 100, 100), [{ start: 95, end: 100 }, { start: 0, end: 5 }]);
    assert.deepEqual(clipRange({ start: 95, end: 5 }, 0, 50, 100), [{ start: 0, end: 5 }]);
    assert.deepEqual(clipRange({ start: 10, end: 20 }, 30, 40, 100), []);
  });

  it("reads the bases of a wrapping range in order", () => {
    assert.equal(rangeSequence("AACCGGTT", { start: 6, end: 2 }), "TTAA");
    assert.equal(rangeSequence("AACCGGTT", { start: 2, end: 4 }), "CC");
  });

  it("selects the shorter way round a circular plasmid when dragging", () => {
    assert.deepEqual(dragRange(10, 19, 100, true), { start: 10, end: 20 });
    assert.deepEqual(dragRange(19, 10, 100, true), { start: 10, end: 20 });
    // Dragging from base 95 to base 4 crosses the origin on a circle...
    assert.deepEqual(dragRange(95, 4, 100, true), { start: 95, end: 5 });
    // ...but never on a linear molecule.
    assert.deepEqual(dragRange(95, 4, 100, false), { start: 4, end: 96 });
    assert.deepEqual(dragRange(7, 7, 100, true), { start: 7, end: 7 });
  });

  it("prints 1-based inclusive coordinates", () => {
    assert.equal(formatRange({ start: 0, end: 10 }, 100), "1–10");
    assert.equal(formatRange({ start: 4, end: 4 }, 100), "after 4");
  });
});

describe("sequence helpers", () => {
  it("reverse complements and translates", () => {
    assert.equal(reverseComplement("GAATTCAAG"), "CTTGAATTC");
    assert.equal(translate("ATGAAATAGCC"), "MK*");
  });

  it("matches Biopython Tm_NN defaults to 0.01 °C", () => {
    // Reference values from Bio.SeqUtils.MeltingTemp.Tm_NN (50 mM Na+, 25 nM strands).
    const cases: [string, number][] = [
      ["CGTTCCAAAGATGTGGGCATGAGCTTAC", 60.32],
      ["ATGCGTACGTTAGC", 40.78],
      ["GAATTCGGATCCAAGCTT", 46.64],
      ["TTTTTTTTAAAAAAAA", 27.44],
    ];
    for (const [sequence, expected] of cases) {
      const value = oligoTm(sequence);
      assert.ok(value !== null);
      assert.ok(Math.abs(value - expected) < 0.01, `${sequence}: ${value} vs ${expected}`);
    }
  });

  it("declines to report a Tm outside the oligo range", () => {
    assert.equal(oligoTm("ACGT"), null);
    assert.equal(oligoTm("A".repeat(61)), null);
    assert.equal(oligoTm("ACGTNACGTAC"), null);
  });
});

describe("feature categories", () => {
  it("separates real CDS, markers, tags and auto-detected ORFs", () => {
    assert.equal(featureCategory({ type: "CDS", name: "ORF 122 aa" }), "orf");
    assert.equal(featureCategory({ type: "CDS", name: "aph(3')-Ia" }), "marker");
    assert.equal(featureCategory({ type: "CDS", name: "KanR" }), "marker");
    assert.equal(featureCategory({ type: "CDS", name: "lacI" }), "cds");
    assert.equal(featureCategory({ type: "mat_peptide", name: "6xHis tag" }), "tag");
    assert.equal(featureCategory({ type: "mat_peptide", name: "Thrombin cleavage site" }), "cleavage");
    assert.equal(featureCategory({ type: "rep_origin", name: "rep_origin" }), "origin");
    assert.equal(featureCategory({ type: "promoter", name: "T7 promoter" }), "promoter");
    assert.equal(featureCategory({ type: "regulatory", name: "Kozak consensus" }), "rbs");
  });

  it("only uses the stored colour when the user chose it", () => {
    const base = { id: "a", name: "T7 promoter", type: "promoter", start: 0, end: 10, strand: 1, color: "#43A047" };
    assert.notEqual(featureColor(base), "#43A047");
    assert.equal(featureColor({ ...base, customColor: true }), "#43A047");
  });
});

describe("circular map", () => {
  it("maps a point back to the base under it", () => {
    // 12 o'clock is base 0, 3 o'clock is a quarter of the way round.
    assert.equal(angleToBase(100, 0, 100, 100, 1000), 0);
    assert.equal(angleToBase(200, 100, 100, 100, 1000), 250);
    assert.equal(angleToBase(100, 200, 100, 100, 1000), 500);
  });

  it("puts overlapping features on separate tracks", () => {
    const a = { start: 0, end: 100 }, b = { start: 50, end: 150 }, c = { start: 200, end: 300 };
    const tracks = assignTracks([a, b, c], 1000, true);
    assert.notEqual(tracks.get(a), tracks.get(b));
    assert.equal(tracks.get(c), 0);
  });

  it("treats an origin-spanning feature as overlapping both ends", () => {
    const wrapAround = { start: 950, end: 50 }, early = { start: 10, end: 20 }, late = { start: 960, end: 970 };
    const tracks = assignTracks([wrapAround, early, late], 1000, true);
    assert.notEqual(tracks.get(wrapAround), tracks.get(early));
    assert.notEqual(tracks.get(wrapAround), tracks.get(late));
  });

  it("spreads crowded labels apart while staying near their anchors", () => {
    const out = spreadPositions([100, 101, 102, 103, 300], 12, 0, 500);
    for (let index = 1; index < out.length; index += 1) assert.ok(out[index] - out[index - 1] >= 12 - 1e-9);
    // The crowded block is centred on its members, not pushed only downward.
    assert.ok(out[0] < 100 && out[3] > 103);
    assert.equal(out[4], 300);
  });

  it("keeps spread labels inside the frame", () => {
    const out = spreadPositions([490, 495, 499], 12, 0, 500);
    assert.ok(out[2] <= 500 && out[0] >= 0);
  });

  it("never overlaps labels and drops the least important when a side is full", () => {
    const requests = Array.from({ length: 40 }, (_, index) => ({ key: `k${index}`, angle: 10 + index * 0.2, priority: index, width: 40 }));
    const { placed, hidden } = layoutCircularLabels(requests, { cx: 300, cy: 300, radius: 200, top: 100, bottom: 500, lineHeight: 13 });
    const right = placed.filter((label) => !label.left).sort((a, b) => a.y - b.y);
    for (let index = 1; index < right.length; index += 1) assert.ok(right[index].y - right[index - 1].y >= 13 - 1e-9);
    assert.equal(placed.length + hidden.length, 40);
    assert.ok(hidden.length > 0);
    // The lowest-priority labels are the ones hidden.
    assert.ok(hidden.includes("k0"));
    assert.ok(!hidden.includes("k39"));
  });
});

describe("linear map viewport", () => {
  it("zooms about the focus base and clamps to the sequence", () => {
    const zoomed = zoomViewport({ from: 0, to: 10000 }, 0.5, 5000, 10000);
    assert.deepEqual(zoomed, { from: 2500, to: 7500 });
    const edge = zoomViewport({ from: 0, to: 10000 }, 0.1, 0, 10000);
    assert.equal(edge.from, 0);
    assert.equal(edge.to, 1000);
    // Never zooms in past the minimum window.
    const tight = zoomViewport({ from: 100, to: 160 }, 0.1, 130, 10000, 60);
    assert.equal(tight.to - tight.from, 60);
  });

  it("pans without leaving the sequence", () => {
    assert.deepEqual(panViewport({ from: 9000, to: 10000 }, 500, 10000), { from: 9000, to: 10000 });
    assert.deepEqual(panViewport({ from: 100, to: 1100 }, -500, 10000), { from: 0, to: 1000 });
  });

  it("chooses round tick spacings", () => {
    assert.equal(niceTickStep(10000, 8), 2000);
    assert.equal(niceTickStep(6835, 8), 1000);
    assert.equal(niceTickStep(120, 8), 20);
  });
});

describe("enzymes", () => {
  it("converts the engine's 1-based cut position to a zero-based cut coordinate", () => {
    const [site] = cutSitesFromRecord([{ enzyme: "EcoRI", position: 397, recognitionSite: "GAATTC", cutCount: 1 }], 2686);
    assert.equal(site.cut, 396);
    assert.equal(site.cutCount, 1);
  });

  it("expands enzyme-set rows into one cut site per position", () => {
    const sites = cutSitesFromEnzymeRows([{ enzyme: "PstI", recognitionSite: "CTGCAG", cutPositions: [10, 2001] }, { enzyme: "PmeI", recognitionSite: "GTTTAAAC", cutPositions: [] }], 2000);
    assert.deepEqual(sites.map((site) => [site.enzyme, site.cut, site.cutCount]), [["PstI", 9, 2], ["PstI", 0, 2]]);
  });

  it("finds the MCS as the densest cluster of unique cutters", () => {
    const cuts = [10, 2000, 2010, 2020, 2035, 2050, 4000].map((cut, index) => ({ enzyme: `E${index}`, cut, recognitionSite: "", cutCount: 1 }));
    assert.deepEqual(locateMcs([], cuts, 5000), { start: 2000, end: 2051 });
    const annotated = locateMcs([{ id: "m", name: "MCS", type: "misc_feature", start: 5, end: 60, strand: 1 }], cuts, 5000);
    assert.deepEqual(annotated, { start: 5, end: 60 });
  });
});
