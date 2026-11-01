// Reading an annotated construct from a saved vector and the purification plan it implies. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { chooseSecColumn, expectedElutionMl, findAnnotatedConstruct, pHAwayFromPI, planFromConstruct, proteaseForFeatureName, readAnnotatedConstruct, savedConstructUpdate, tagForFeatureName, type SavedPlan } from "./construct-plan-update.ts";
import { secColumns } from "./sec-column-catalog.ts";
import { reverseComplement } from "./vector-geometry.ts";
import type { JsonObject } from "./protein-labs-api.ts";

// One codon per residue is enough: the reader translates, it never back-translates.
const codon: Record<string, string> = { A: "GCT", C: "TGT", D: "GAT", E: "GAA", F: "TTT", G: "GGT", H: "CAT", I: "ATT", K: "AAA", L: "CTG", M: "ATG", N: "AAC", P: "CCG", Q: "CAG", R: "CGT", S: "TCT", T: "ACC", V: "GTT", W: "TGG", Y: "TAT", "*": "TAA" };
const dnaOf = (peptide: string) => [...peptide].map((residue) => codon[residue]).join("");

// Human ubiquitin (76 aa) stands in for the protein of interest.
const POI = "MQIFVKTLTGKTITLEVEPSDTIENVKAKIQDKEGIPPDQQRLIFAGKQLEDGRTLSDYNIQKESTLHLVLRLRGG";
// Backbone: an upstream stretch with in-frame stops, and a downstream one.
const UPSTREAM = "TAATTAGTGATCCCGCGAAATTAATACGACTCACTATAGGGGAATTGTGAGCGGATAACAATTCCCCTCTAGAAATAATTTTGTTTAACTTTAAGAAGGAGATATACC";
const DOWNSTREAM = "TAAGCGGCCGCACTCGAGCACCACCACCACCACCACTGAGATCCGGCTGCTAACAAAGCCCGAAAGGAAGCTGAGTTGGCTGCTGCCACCGCTGAGCAATAACTAGC";

type Piece = { name: string; peptide: string; notes?: string; insert?: boolean };
/** A vector whose features sit exactly over each named piece of the ORF. */
function vector(name: string, pieces: Piece[], options: { reverse?: boolean; id?: string } = {}): JsonObject {
  let cursor = UPSTREAM.length;
  const features: JsonObject[] = [{ id: "t7", name: "T7 promoter", type: "promoter", start: 15, end: 34, strand: 1 }];
  for (const piece of pieces) {
    const length = piece.peptide.length * 3;
    if (piece.name) features.push({ id: piece.name, name: piece.name, type: piece.insert ? "CDS" : "misc_feature", start: cursor, end: cursor + length, strand: 1, notes: piece.notes ?? "", ...(piece.insert ? { isInsert: true } : {}) });
    cursor += length;
  }
  const sequence = UPSTREAM + dnaOf(pieces.map((piece) => piece.peptide).join("")) + DOWNSTREAM;
  if (!options.reverse) return { id: options.id ?? name, name, sequence, circular: true, features };
  const length = sequence.length;
  return { id: options.id ?? name, name, sequence: reverseComplement(sequence), circular: true, features: features.map((feature) => ({ ...feature, start: length - Number(feature.end), end: length - Number(feature.start), strand: -1 })) };
}

// The in-house layout from HOM-371: His – DYDIPTT – TEV – GA – POI. The GA is not annotated.
const hisTev = () => vector("pHis-TEV-GA", [
  { name: "", peptide: "M" },
  { name: "6xHis", peptide: "HHHHHH", notes: "N-terminal His tag" },
  { name: "", peptide: "DYDIPTT" },
  { name: "TEV site", peptide: "ENLYFQG", notes: "Removes the His tag" },
  { name: "", peptide: "GA" },
  { name: "Ubiquitin", peptide: POI.slice(1) + "*", insert: true },
]);
const empty: SavedPlan = { affinity: {}, cleavage: {}, subtractive: {}, sec: {} };
const metrics = (sequence: string, pI = 6.4) => ({ lengthAa: sequence.length, massDa: sequence.length * 113, pI, extinctionReduced: 1490 });
const at = "2026-11-01T12:00:00.000Z";

describe("feature names", () => {
  it("name tags by whole words, so a T7 phage promoter is never an HA tag", () => {
    assert.equal(tagForFeatureName("6xHis")?.id, "his6");
    assert.equal(tagForFeatureName("His-tag")?.id, "his6");
    assert.equal(tagForFeatureName("Twin-Strep-tag")?.id, "twin-strep");
    assert.equal(tagForFeatureName("malE")?.id, "mbp");
    assert.equal(tagForFeatureName("T7 phage promoter"), null);
    assert.equal(tagForFeatureName("Shine-Dalgarno"), null);
  });

  it("name protease sites, including SUMO for Ulp1", () => {
    assert.equal(proteaseForFeatureName("TEV site"), "tev");
    assert.equal(proteaseForFeatureName("TEV protease recognition sequence"), "tev");
    assert.equal(proteaseForFeatureName("PreScission site"), "hrv-3c");
    assert.equal(proteaseForFeatureName("thrombin site"), "thrombin");
    assert.equal(proteaseForFeatureName("Factor Xa site"), "factor-xa");
    assert.equal(proteaseForFeatureName("SUMO"), "ulp1");
    assert.equal(proteaseForFeatureName("lac operator"), null);
  });
});

describe("readAnnotatedConstruct", () => {
  it("reads His – DYDIPTT – TEV – GA – POI from the annotation, with the unannotated residues from the DNA", () => {
    const construct = readAnnotatedConstruct(hisTev(), POI, "Ubiquitin")!;
    assert.equal(construct.tag.id, "his6");
    assert.equal(construct.tagFeature, "6xHis");
    assert.equal(construct.terminus, "N");
    assert.equal(construct.proteaseId, "tev");
    assert.equal(construct.layout, "M – 6xHis – DYDIPTT – TEV site – GA – Ubiquitin");
    assert.equal(construct.fusion, `MHHHHHHDYDIPTTENLYFQGGA${POI.slice(1)}`);
    // TEV cuts ENLYFQ↓G: the G and the junction's GA stay on the product.
    assert.equal(construct.scar, "GGA");
    assert.equal(construct.cleaved, `GGA${POI.slice(1)}`);
    assert.equal(construct.released, "MHHHHHHDYDIPTTENLYFQ");
    assert.match(construct.siteEvidence, /^TEV site annotated at bp \d+–\d+ of pHis-TEV-GA; ENLYFQ↓G is cut, leaving GGA on the product\.$/);
    assert.deepEqual(construct.warnings, []);
  });

  it("does not hard-code the layout: a pET-28-style His–thrombin–T7 construct reads too", () => {
    const pet = vector("pET-28a(+)-UBQ", [
      { name: "", peptide: "MGSS" },
      { name: "6xHis", peptide: "HHHHHH" },
      { name: "", peptide: "SSG" },
      { name: "thrombin site", peptide: "LVPRGS" },
      { name: "", peptide: "H" },
      { name: "T7 tag", peptide: "MASMTGGQQMG" },
      { name: "", peptide: "RGS" },
      { name: "", peptide: POI + "*" },
    ]);
    const construct = readAnnotatedConstruct(pet, POI, "Ubiquitin")!;
    // The T7 tag stays on after cleavage, so the His tag the protease removes is the capture tag.
    assert.equal(construct.tag.id, "his6");
    assert.equal(construct.proteaseId, "thrombin");
    assert.equal(construct.scar, "GSHMASMTGGQQMGRGS");
    assert.equal(construct.cleaved, `GSHMASMTGGQQMGRGS${POI}`);
    // No insert feature: the target is found by translation and named after the protein.
    assert.equal(construct.layout, "MGSS – 6xHis – SSG – thrombin site – H – T7 tag – RGS – Ubiquitin");
  });

  it("reads a construct on the reverse strand", () => {
    const construct = readAnnotatedConstruct(vector("pRev", [{ name: "", peptide: "M" }, { name: "6xHis", peptide: "HHHHHH" }, { name: "TEV site", peptide: "ENLYFQG" }, { name: "", peptide: POI.slice(1) + "*" }], { reverse: true }), POI)!;
    assert.equal(construct.proteaseId, "tev");
    assert.equal(construct.cleaved, `G${POI.slice(1)}`);
    assert.match(construct.siteEvidence, /^TEV site annotated at bp \d+–\d+ of pRev/);
  });

  it("keeps a C-terminal Strep tag with no protease site on the protein", () => {
    const construct = readAnnotatedConstruct(vector("pStrep", [{ name: "", peptide: POI + "SA" }, { name: "Strep-tag II", peptide: "WSHPQFEK" }, { name: "", peptide: "*" }]), POI)!;
    assert.equal(construct.tag.id, "strep2");
    assert.equal(construct.terminus, "C");
    assert.equal(construct.proteaseId, null);
    assert.equal(construct.cleaves, false);
    assert.equal(construct.cleaved, `${POI}SAWSHPQFEK`);
  });

  it("refuses to guess the cut when the site feature does not carry the motif", () => {
    const construct = readAnnotatedConstruct(vector("pBadSite", [{ name: "", peptide: "M" }, { name: "6xHis", peptide: "HHHHHH" }, { name: "TEV site", peptide: "GSGSGSG" }, { name: "", peptide: POI.slice(1) + "*" }]), POI)!;
    assert.equal(construct.proteaseId, null);
    assert.equal(construct.cleaves, false);
    assert.match(construct.warnings[0], /recognition motif is not in the translated construct/);
  });

  it("returns null for a vector that does not encode the protein, or carries no capturable tag", () => {
    assert.equal(readAnnotatedConstruct(hisTev(), "MKTAYIAKQRQISFVKSHFSRQ"), null);
    assert.equal(readAnnotatedConstruct(vector("pBare", [{ name: "", peptide: POI + "*" }]), POI), null);
    assert.equal(findAnnotatedConstruct([vector("pBare", [{ name: "", peptide: POI + "*" }]), hisTev()], POI)?.vectorName, "pHis-TEV-GA");
  });
});

describe("planFromConstruct", () => {
  const construct = () => readAnnotatedConstruct(hisTev(), POI, "Ubiquitin")!;
  const products = () => ({ fusion: metrics(construct().fusion), cleaved: metrics(construct().cleaved) });

  it("sets affinity capture, TEV + reverse Ni-NTA, and SEC from the cleaved product, and says so", () => {
    const update = planFromConstruct(construct(), products(), empty, { subunits: null, appliedAt: at });
    assert.deepEqual(update.changes.map((change) => [change.stage, change.changed]), [["affinity", true], ["cleavage", true], ["subtractive", true], ["sec", true]]);
    assert.equal(update.configs.affinity!.columnId, "his-ni");
    assert.equal(update.configs.cleavage!.proteaseId, "tev");
    assert.equal(update.configs.subtractive!.columnId, "his-ni");
    assert.equal(update.configs.subtractive!.collect, "flow-through");
    assert.match(String(update.configs.subtractive!.removes), /^the released 6xHis, the uncleaved fusion and the His-tagged TEV protease$/);
    // Ubiquitin + GGA scar is about 9 kDa: Superdex 75 Increase, not the 10–600 kDa S200.
    assert.equal(update.configs.sec!.columnId, "s75-10-300");
    assert.equal(update.configs.sec!.expectedMassKDa, 8.8);
    const summary = update.summary;
    assert.match(summary, /^Updated from construct Ubiquitin in vector pHis-TEV-GA: affinity capture → Ni-NTA \/ Ni Sepharose \/ HisTrap; subtractive cleanup → TEV protease, then reverse Ni²⁺ IMAC; SEC → S75 Increase 10\/300, 8\.8 kDa, elutes near \d+\.\d mL\.$/);
    // Every updated job carries the notice, and the construct as the report reads it.
    for (const stage of ["affinity", "cleavage", "subtractive", "sec"] as const) assert.equal((update.configs[stage]!.updatedFromConstruct as JsonObject).summary, summary);
    const saved = update.configs.cleavage!.construct as JsonObject;
    assert.equal(saved.cleavedSequence, `GGA${POI.slice(1)}`);
    assert.equal(saved.cleavedMassDa, products().cleaved.massDa);
    assert.equal(saved.layout, "M – 6xHis – DYDIPTT – TEV site – GA – Ubiquitin");
  });

  it("puts TCEP in the reverse-IMAC buffer and the capture buffers at 1 mM", () => {
    const update = planFromConstruct(construct(), products(), empty, { subunits: null, appliedAt: at });
    const tcep = (step: { components: { name: string; concentration: string | number }[] }) => step.components.find((item) => item.name === "TCEP")?.concentration;
    assert.equal(tcep(update.bufferSteps.cleavage), 1);
    assert.equal(tcep(update.bufferSteps.binding), 1);
    assert.equal(tcep(update.bufferSteps.storage), 1);
  });

  it("changes nothing the second time: applying is idempotent, so the planner stops offering it", () => {
    const first = planFromConstruct(construct(), products(), empty, { subunits: null, appliedAt: at });
    const second = planFromConstruct(construct(), products(), first.configs as SavedPlan, { subunits: null, appliedAt: at });
    assert.deepEqual(second.changes.filter((change) => change.changed), []);
  });

  it("keeps a saved resin that already captures the tag", () => {
    const update = planFromConstruct(construct(), products(), { ...empty, affinity: { columnId: "his-co", columnName: "TALON / cobalt IMAC" } }, { subunits: null, appliedAt: at });
    assert.equal(update.changes[0].changed, false);
    assert.equal(update.configs.affinity!.columnId, "his-co");
    assert.deepEqual(Object.keys(update.bufferSteps).sort(), ["cleavage", "storage"]);
  });

  it("switches a resin that cannot capture the annotated tag, and records what it was", () => {
    const update = planFromConstruct(construct(), products(), { ...empty, affinity: { columnId: "gst", columnName: "Glutathione Sepharose / GSTrap" } }, { subunits: null, appliedAt: at });
    assert.deepEqual([update.changes[0].before, update.changes[0].after], ["Glutathione Sepharose / GSTrap (GST)", "Ni-NTA / Ni Sepharose / HisTrap for 6xHis"]);
  });

  it("sizes SEC for the oligomer and moves buffer pH off the cleaved product's pI", () => {
    const update = planFromConstruct(construct(), { fusion: metrics(construct().fusion), cleaved: metrics(construct().cleaved, 7.6) }, empty, { subunits: 4, appliedAt: at });
    assert.equal(update.configs.sec!.expectedMassKDa, 35.3);
    assert.match(update.changes[3].after, /35\.3 kDa \(4 × 8\.8 kDa\)/);
    // pH 7.5 is 0.1 from pI 7.6. SEC moves to the nearer side a full unit away (6.6);
    // reverse IMAC must stay at pH 7 or above, so it goes up to 8.6.
    assert.equal(update.bufferSteps.cleavage.pH, "8.6");
    assert.equal(update.bufferSteps.storage.pH, "6.6");
    assert.match(update.changes[2].detail, /Buffer pH moved to 8\.6 to stay clear of pI 7\.60\./);
  });

  it("skips subtractive cleanup when no protease site is annotated", () => {
    const strep = readAnnotatedConstruct(vector("pStrep", [{ name: "", peptide: POI + "SA" }, { name: "Strep-tag II", peptide: "WSHPQFEK" }, { name: "", peptide: "*" }]), POI)!;
    const update = planFromConstruct(strep, { fusion: metrics(strep.fusion), cleaved: null }, empty, { subunits: null, appliedAt: at });
    assert.equal(update.configs.affinity!.columnId, "strep-ii");
    assert.equal(update.configs.cleavage!.proteaseId, "retain");
    assert.equal(update.configs.subtractive, undefined);
    assert.match(update.summary, /subtractive cleanup → not needed, the tag is kept/);
  });

  it("finds the latest saved notice across the jobs", () => {
    assert.equal(savedConstructUpdate({ affinity: {}, sec: { updatedFromConstruct: { appliedAt: "2026-10-01", summary: "old" } }, cleavage: { updatedFromConstruct: { appliedAt: "2026-11-01", summary: "new" } } })?.summary, "new");
    assert.equal(savedConstructUpdate(empty), null);
  });
});

describe("SEC helpers", () => {
  const column = (id: string) => secColumns.find((value) => value.id === id)!;
  it("keeps a column the mass fits comfortably, else picks the narrowest fitting range on the same bed", () => {
    assert.equal(chooseSecColumn(150, column("s200-10-300")).id, "s200-10-300");
    assert.equal(chooseSecColumn(17, column("s200-10-300")).id, "s75-10-300");
    assert.equal(chooseSecColumn(17, column("hiload16-s200")).id, "hiload16-s75");
    assert.equal(chooseSecColumn(2000).id, "superose6-10-300");
  });
  it("estimates a later elution for a smaller protein", () => {
    const s200 = column("s200-10-300");
    assert.ok(expectedElutionMl(s200, 20)! > expectedElutionMl(s200, 300)!);
    assert.equal(expectedElutionMl(s200, 600), 8);
    assert.equal(expectedElutionMl(column("custom"), 20), null);
  });
  it("moves pH at least one unit from the pI, as little as possible", () => {
    assert.equal(pHAwayFromPI(7.5, 6.0), null);
    assert.equal(pHAwayFromPI(7.5, 6.5), null);
    // 0.7 unit away is a warning now, so it moves too.
    assert.equal(pHAwayFromPI(7.5, 6.8), 7.8);
    assert.equal(pHAwayFromPI(7.5, 7.3), 8.3);
    assert.equal(pHAwayFromPI(7.5, 7.6, 7), 8.6);
    // IMAC binding stays at pH 7 or above, even when going down would be the smaller move.
    assert.equal(pHAwayFromPI(6.8, 7.0, 7), 8.0);
    assert.equal(pHAwayFromPI(6.8, 7.0), 6.0);
    assert.equal(pHAwayFromPI(7.5, null), null);
  });
});
