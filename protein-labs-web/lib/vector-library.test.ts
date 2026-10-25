// Tests for the vector library browser's search, facet, size and map helpers.
// Run with `npm run test` in protein-labs-web (Vitest).
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  activeFilterCount,
  arcPath,
  assignRings,
  classifySourceError,
  facetOptions,
  featureKind,
  featureSpan,
  filterBySize,
  formatBp,
  importEncoding,
  keyFeatures,
  librarySearchParams,
  sizeBucket,
  sizeCounts,
  sourceStatusText,
  toggleFilter,
  vectorTagline,
} from "./vector-library.ts";

describe("librarySearchParams", () => {
  it("repeats facet values so a value containing a comma is not split", () => {
    const params = new URLSearchParams(librarySearchParams({ query: " T7 ", filters: { host: ["Escherichia coli"], selectionMarker: ["Kanamycin; Neomycin", "Ampicillin"] } }));
    assert.equal(params.get("q"), "T7");
    assert.deepEqual(params.getAll("host"), ["Escherichia coli"]);
    assert.deepEqual(params.getAll("selectionMarker"), ["Kanamycin; Neomycin", "Ampicillin"]);
    assert.equal(params.get("limit"), "500");
    assert.equal(params.has("favorite"), false);
  });

  it("omits an empty query and sends the favourite flag when asked", () => {
    const params = new URLSearchParams(librarySearchParams({ query: "  ", filters: {}, favorite: true, limit: 20 }));
    assert.equal(params.has("q"), false);
    assert.equal(params.get("favorite"), "true");
    assert.equal(params.get("limit"), "20");
  });
});

describe("filters", () => {
  it("toggles a value on and off and drops empty facets", () => {
    const on = toggleFilter({}, "host", "Escherichia coli");
    assert.deepEqual(on, { host: ["Escherichia coli"] });
    assert.deepEqual(toggleFilter(on, "host", "Escherichia coli"), {});
  });

  it("counts selected values across facets and size ranges", () => {
    assert.equal(activeFilterCount({ host: ["a", "b"], promoter: ["T7"] }, ["4-6"]), 4);
  });

  it("keeps a selected value visible when its count falls to zero", () => {
    assert.deepEqual(facetOptions([{ value: "T7", count: 2 }], ["CMV"]), [{ value: "T7", count: 2 }, { value: "CMV", count: 0 }]);
  });
});

describe("size ranges", () => {
  it("puts boundaries in the upper range", () => {
    assert.equal(sizeBucket(3999), "lt4");
    assert.equal(sizeBucket(4000), "4-6");
    assert.equal(sizeBucket(7328), "6-8");
    assert.equal(sizeBucket(10000), "gt10");
  });

  it("counts and filters by range", () => {
    const vectors = [{ lengthBp: 3494 }, { lengthBp: 4982 }, { lengthBp: 4542 }, { lengthBp: 7328 }];
    assert.deepEqual(sizeCounts(vectors).map((entry) => entry.count), [1, 2, 1, 0, 0]);
    assert.equal(filterBySize(vectors, []).length, 4);
    assert.deepEqual(filterBySize(vectors, ["lt4", "6-8"]).map((vector) => vector.lengthBp), [3494, 7328]);
  });

  it("formats lengths with separators and copes with unknown sizes", () => {
    assert.equal(formatBp(7328), "7,328 bp");
    assert.equal(formatBp(null), "size unknown");
  });
});

describe("source status", () => {
  it("tells an unreachable source from a failed search", () => {
    assert.equal(classifySourceError("Failed to fetch"), "offline");
    assert.equal(classifySourceError("<urlopen error [Errno -3] Temporary failure in name resolution>"), "offline");
    assert.equal(classifySourceError("Protein Lab returned 502"), "offline");
    assert.equal(classifySourceError("Unknown vector source: foo"), "error");
  });

  it("describes each state in words", () => {
    assert.equal(sourceStatusText({ status: "done", count: 1, message: "" }, "ncbi"), "1 match");
    assert.equal(sourceStatusText({ status: "done", count: 12, message: "" }, "ncbi"), "12 matches");
    assert.equal(sourceStatusText({ status: "waiting", count: 0, message: "" }, "ncbi"), "Type 3+ characters");
    assert.equal(sourceStatusText({ status: "slow", count: 0, message: "" }, "addgene"), "Still searching…");
  });
});

describe("importEncoding", () => {
  it("sends SnapGene files as base64 and text formats as text", () => {
    assert.equal(importEncoding("pET-28a.DNA"), "base64");
    assert.equal(importEncoding("pET-28a.gb"), "text");
    assert.equal(importEncoding("insert.fasta"), "text");
    assert.equal(importEncoding("notes.docx"), null);
  });
});

describe("feature kinds", () => {
  it("reads the kind from type, regulatory class and name", () => {
    assert.equal(featureKind({ name: "promoter", type: "regulatory", qualifiers: { regulatory_class: ["promoter"] } }), "promoter");
    assert.equal(featureKind({ name: "terminator", type: "regulatory", qualifiers: { regulatory_class: ["terminator"] } }), "terminator");
    assert.equal(featureKind({ name: "pBR322 origin", type: "rep_origin" }), "origin");
    assert.equal(featureKind({ name: "zeocin resistance marker", type: "CDS" }), "marker");
    assert.equal(featureKind({ name: "6xHis tag", type: "misc_feature" }), "tag");
    assert.equal(featureKind({ name: "TEV recognition site", type: "misc_feature" }), "protease");
    assert.equal(featureKind({ name: "lacI", type: "CDS" }), "cds");
    assert.equal(featureKind({ name: "start codon", type: "misc_feature" }), "other");
  });

  it("picks one feature per name, promoters and tags first", () => {
    const features = [
      { name: "pBR322 origin", type: "rep_origin", start: 4254, end: 4928 },
      { name: "PmeI recognition site", type: "misc_feature", start: 2006, end: 2014 },
      { name: "6xHis tag", type: "misc_feature", start: 956, end: 974 },
      { name: "promoter", type: "regulatory", start: 0, end: 944, qualifiers: { regulatory_class: ["promoter"] } },
      { name: "6xHis tag", type: "misc_feature", start: 1956, end: 1974 },
    ];
    assert.deepEqual(keyFeatures(features).map((feature) => `${feature.kind}:${feature.name}`), ["promoter:promoter", "tag:6xHis tag", "origin:pBR322 origin"]);
    assert.equal(keyFeatures(features, 1).length, 1);
  });
});

describe("mini map geometry", () => {
  it("measures spans that wrap the origin", () => {
    assert.equal(featureSpan(100, 300, 1000), 200);
    assert.equal(featureSpan(900, 100, 1000), 200);
  });

  it("draws a quarter arc from 12 to 3 o'clock", () => {
    assert.equal(arcPath(50, 50, 40, 0, 250, 1000), "M 50 10 A 40 40 0 0 1 90 50");
  });

  it("uses the large-arc flag past half the circle and never closes a full circle", () => {
    assert.match(arcPath(50, 50, 40, 0, 750, 1000), / 0 1 1 /);
    const full = arcPath(50, 50, 40, 0, 1000, 1000);
    assert.ok(full.length > 0);
    assert.notEqual(full.split(" ").slice(1, 3).join(" "), full.split(" ").slice(-2).join(" "));
    assert.equal(arcPath(50, 50, 40, 10, 10, 1000), "");
  });

  it("stacks overlapping features on separate rings, including across the origin", () => {
    const rings = assignRings([
      { start: 0, end: 500 },
      { start: 400, end: 600 },
      { start: 700, end: 800 },
      { start: 950, end: 50 },
    ], 1000);
    assert.equal(rings[0], 0);
    assert.equal(rings[1], 1);
    assert.equal(rings[2], 0);
    assert.equal(rings[3], 1);
  });

  it("caps the ring count", () => {
    const rings = assignRings([{ start: 0, end: 100 }, { start: 0, end: 100 }, { start: 0, end: 100 }, { start: 0, end: 100 }], 1000, 2);
    assert.ok(rings.every((ring) => ring <= 1));
  });
});

describe("vectorTagline", () => {
  it("lists tags in reading order", () => {
    assert.equal(vectorTagline({ nTags: ["6×His"], proteaseSites: ["Thrombin"], cTags: ["Strep"] }), "N-6×His · Thrombin · C-Strep");
  });
});
