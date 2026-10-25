// Tests for the cloning preview. Run with `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { dedupeSites, junctionSegments, previewInsert } from "./vector-cloning.ts";

const backbone = {
  sequence: "AAAAACCCCCGGGGGTTTTT",
  features: [
    { id: "a", name: "left", type: "misc_feature", start: 0, end: 5, strand: 1 },
    { id: "b", name: "middle", type: "misc_feature", start: 6, end: 9, strand: 1 },
    { id: "c", name: "right", type: "misc_feature", start: 15, end: 20, strand: 1 },
  ],
};

describe("previewInsert", () => {
  it("inserts at a point and shifts downstream features", () => {
    const preview = previewInsert(backbone, { start: 10, end: 10, strand: 1, replaceRegion: false, frame: null }, "ATGAAATAA", { keepFrame: true, name: "Target" });
    assert.equal(preview.sequence, "AAAAACCCCCATGAAATAAGGGGGTTTTT");
    assert.deepEqual(preview.insertRange, { start: 10, end: 19 });
    assert.equal(preview.features.find((feature) => feature.id === "c")?.start, 24);
    assert.equal(preview.translation, "MK*");
    assert.ok(!preview.warnings.some((warning) => warning.level === "error"));
  });

  it("drops features the insert replaces and says so", () => {
    const preview = previewInsert(backbone, { start: 5, end: 10, strand: 1, replaceRegion: true, frame: null }, "ATG", { keepFrame: true, name: "Target" });
    assert.equal(preview.sequence, "AAAAAATGGGGGGTTTTT");
    assert.deepEqual(preview.lostFeatures, ["middle"]);
    assert.ok(preview.warnings.some((warning) => warning.message.includes("middle")));
  });

  it("pads with G to restore the frame, exactly like the engine", () => {
    const site = { start: 10, end: 10, strand: 1, replaceRegion: false, frame: { inFrame: false, offset: 1, padding: 2, referenceName: "6xHis" } };
    const padded = previewInsert(backbone, site, "ATGAAA", { keepFrame: true, name: "T" });
    assert.equal(padded.sequence.slice(10, 18), "GGATGAAA");
    assert.equal(padded.paddingBases, 2);
    const unpadded = previewInsert(backbone, site, "ATGAAA", { keepFrame: false, name: "T" });
    assert.ok(unpadded.warnings.some((warning) => warning.level === "error" && warning.message.includes("out of frame")));
  });

  it("reverse complements an insert placed on the reverse strand", () => {
    const preview = previewInsert(backbone, { start: 10, end: 10, strand: -1, replaceRegion: false, frame: null }, "ATGC", { keepFrame: true, name: "T" });
    assert.equal(preview.sequence.slice(10, 14), "GCAT");
    assert.equal(preview.features.find((feature) => feature.id === "preview-insert")?.strand, -1);
  });

  it("flags internal stops and partial codons", () => {
    const preview = previewInsert(backbone, { start: 0, end: 0, strand: 1, replaceRegion: false, frame: null }, "ATGTAAAAAG", { keepFrame: true, name: "T" });
    const messages = preview.warnings.map((warning) => warning.message).join(" ");
    assert.match(messages, /Internal stop codon at residue 2/);
    assert.match(messages, /not a whole number of codons/);
  });
});

describe("dedupeSites", () => {
  it("keeps one site per cut, preferring a named feature over misc_feature", () => {
    const sites = [
      { id: "1", label: "Directly after misc_feature", start: 5128, end: 5128, strand: 1, replaceRegion: false },
      { id: "2", label: "Directly after Thrombin cleavage site", start: 5128, end: 5128, strand: 1, replaceRegion: false },
      { id: "3", label: "SmaI site", start: 1071, end: 1071, strand: 1, replaceRegion: false },
    ];
    assert.deepEqual(dedupeSites(sites).map((site) => site.id), ["2", "3"]);
  });
});

describe("junctionSegments", () => {
  const site = (strand: number) => ({ start: 10, end: 10, strand, replaceRegion: false, frame: { inFrame: false, offset: 1, padding: 2, referenceName: "6xHis" } });

  it("shows forward padding before the insert, matching the product", () => {
    const preview = previewInsert(backbone, site(1), "ATGAAATAA", { keepFrame: true, name: "T" });
    const segments = junctionSegments(preview, 1);
    assert.deepEqual(segments.map((segment) => segment.kind), ["backbone", "padding", "insert", "backbone"]);
    assert.equal(segments.map((segment) => segment.text).join(""), preview.sequence);
    assert.equal(segments[2].text, "ATGAAATAA");
  });

  it("shows reverse-strand padding after the reverse-complemented insert", () => {
    const preview = previewInsert(backbone, site(-1), "ATGAAATAA", { keepFrame: true, name: "T" });
    const segments = junctionSegments(preview, -1);
    assert.deepEqual(segments.map((segment) => segment.kind), ["backbone", "insert", "padding", "backbone"]);
    // Every base of the product appears once, in order, with nothing skipped.
    assert.equal(segments.map((segment) => segment.text).join(""), preview.sequence);
    assert.equal(segments[1].text, "TTATTTCAT");
    assert.equal(segments[2].text, "GG");
  });

  it("elides the middle of a long insert without dropping its ends", () => {
    const insert = "ATG" + "GCT".repeat(20) + "TAA";
    const preview = previewInsert(backbone, { ...site(1), frame: null }, insert, { keepFrame: true, name: "T" });
    const inserts = junctionSegments(preview, 1, 18, 6).filter((segment) => segment.kind === "insert").map((segment) => segment.text);
    assert.deepEqual(inserts, [insert.slice(0, 6), insert.slice(-6)]);
  });
});
