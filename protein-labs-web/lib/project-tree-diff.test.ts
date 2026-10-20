// Tests for the local project diff (HOM-137). The engine owns the real diff
// service; this file guards the browser fallback that renders the same shape.
// Run with `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  alignSequences,
  branchSummary,
  localProjectDiff,
  projectFacets,
  protparamDeltas,
  sequenceDiff,
  sequenceEdits,
  type DiffSource,
} from "./project-tree-diff.ts";
import type { JsonObject, ProjectJob, ProteinRecord } from "./protein-labs-api.ts";

function protein(id: string, sequence: string, fields: Partial<ProteinRecord> = {}): ProteinRecord {
  return {
    id, name: id, sequence, organism: "", geneName: "", description: "",
    expressionSystem: "", notes: "", tags: [], externalIds: {}, ...fields,
  };
}

function job(appType: string, config: JsonObject, status: ProjectJob["status"] = "complete"): ProjectJob {
  return { id: `${appType}-job`, proteinId: "p", name: appType, appType, status, config, createdAt: "", updatedAt: "" };
}

describe("alignSequences", () => {
  it("returns the inputs untouched when they are identical", () => {
    assert.deepEqual(alignSequences("MKV", "MKV"), { alignedBefore: "MKV", alignedAfter: "MKV" });
  });

  it("always returns two strings of equal length", () => {
    for (const [before, after] of [["MKVLA", "MKVLA"], ["MKVLA", "MKVA"], ["MKVA", "MKVLAA"], ["MK", ""], ["", "MK"]]) {
      const { alignedBefore, alignedAfter } = alignSequences(before, after);
      assert.equal(alignedBefore.length, alignedAfter.length, `${before} vs ${after}`);
    }
  });

  it("gaps the shorter sequence where residues were removed", () => {
    const { alignedBefore, alignedAfter } = alignSequences("MKVLAGG", "MKVGG");
    assert.equal(alignedBefore, "MKVLAGG");
    assert.equal(alignedAfter, "MKV--GG");
  });
});

describe("sequenceEdits", () => {
  it("labels a substitution with the parent position", () => {
    const edits = sequenceEdits({ alignedBefore: "MKVKLA", alignedAfter: "MKVALA" });
    assert.deepEqual(edits, [{ kind: "substitution", position: 4, before: "K", after: "A", label: "K4A" }]);
  });

  it("collapses a run of removed residues into one deletion", () => {
    const edits = sequenceEdits({ alignedBefore: "MKVLAGG", alignedAfter: "MKV--GG" });
    assert.equal(edits.length, 1);
    assert.deepEqual(edits[0], { kind: "deletion", position: 4, before: "LA", after: "", label: "Δ4-5" });
  });

  it("calls a removal at the C-terminus a truncation", () => {
    const edits = sequenceEdits({ alignedBefore: "MKVLA", alignedAfter: "MKV--" });
    assert.equal(edits[0].kind, "truncation");
  });

  it("calls an addition at the C-terminus an extension", () => {
    const edits = sequenceEdits({ alignedBefore: "MKV--", alignedAfter: "MKVHH" });
    assert.deepEqual(edits[0], { kind: "extension", position: 4, before: "", after: "HH", label: "4insHH" });
  });

  it("keeps counting parent positions after an insertion", () => {
    const edits = sequenceEdits({ alignedBefore: "MK-VKA", alignedAfter: "MKGVAA" });
    assert.deepEqual(edits.map((edit) => edit.label), ["3insG", "K4A"]);
  });
});

describe("sequenceDiff", () => {
  it("is null when nothing changed, so the branch shows no sequence chip", () => {
    assert.equal(sequenceDiff("MKV", "MKV"), null);
  });

  it("reports lengths and identity", () => {
    const diff = sequenceDiff("MKVLA", "MKVAA");
    assert.equal(diff?.lengthBefore, 5);
    assert.equal(diff?.lengthAfter, 5);
    assert.equal(diff?.identityPercent, 80);
    assert.deepEqual(diff?.edits.map((edit) => edit.label), ["L4A"]);
  });
});

describe("projectFacets", () => {
  it("reads the backbone, host, tag and purification choices out of saved jobs", () => {
    const facets = projectFacets({
      protein: protein("p1", "MKV", { expressionSystem: "E. coli" }),
      jobs: [
        job("expression-planning", { vectorName: "pET-28a" }),
        job("purification-affinity", { tagName: "His6", columnId: "nickel-nta" }),
        job("purification-sec", { columnName: "Superdex 200" }),
      ],
    });
    const value = (key: string) => facets.find((facet) => facet.key === key)?.value;
    assert.equal(value("vector"), "pET-28a");
    assert.equal(value("host"), "E. coli");
    assert.equal(value("tag"), "His6");
    assert.equal(value("capture"), "nickel-nta");
    assert.equal(value("polish"), "Superdex 200");
  });

  it("lists assays with their status rather than a single field", () => {
    const facets = projectFacets({
      protein: protein("p1", "MKV"),
      jobs: [job("gel-analysis", {}, "in_progress"), job("chromatogram-studio", {}, "complete")],
    });
    assert.equal(
      facets.find((facet) => facet.key === "assays")?.value,
      "chromatogram-studio (complete), gel-analysis (in progress)",
    );
  });
});

describe("protparamDeltas", () => {
  const source = (protparam: JsonObject | null): DiffSource => ({ protein: protein("p", "MKV"), protparam });

  it("flags the direction of each moved value and skips unchanged ones", () => {
    const deltas = protparamDeltas(
      source({ molecularWeight: 14000, theoreticalPi: 7.2 }),
      source({ molecularWeight: 16500, theoreticalPi: 7.2 }),
    );
    assert.deepEqual(deltas, [{ label: "Molecular weight", before: "14,000 Da", after: "16,500 Da", direction: "up" }]);
  });

  it("shows a dash when one side was never analysed", () => {
    const deltas = protparamDeltas(source(null), source({ gravy: -0.41 }));
    assert.deepEqual(deltas, [{ label: "GRAVY", before: "—", after: "-0.41", direction: "flat" }]);
  });
});

describe("localProjectDiff", () => {
  it("summarises a point mutation plus a vector swap the way the tree label reads", () => {
    const diff = localProjectDiff(
      { protein: protein("a", "MKVKLA"), jobs: [job("expression-planning", { vectorName: "pET-28a" })] },
      { protein: protein("b", "MKVALA"), jobs: [job("expression-planning", { vectorName: "pMAL-c5X" })] },
    );
    assert.equal(diff.summary, "K4A · pET-28a → pMAL-c5X");
    assert.deepEqual(diff.categories, ["sequence", "vector"]);
    assert.equal(diff.fromProjectId, "a");
    assert.equal(diff.toProjectId, "b");
    assert.ok(diff.sequence, "the residue strip has data");
  });

  it("says so plainly when two projects are identical", () => {
    const diff = localProjectDiff({ protein: protein("a", "MKV") }, { protein: protein("b", "MKV") });
    assert.equal(diff.summary, "No recorded differences");
    assert.deepEqual(diff.changes, []);
    assert.equal(diff.sequence, null);
  });

  it("gives a branch a ProtParam chip only when nothing else changed", () => {
    const shared = { protein: protein("a", "MKV"), protparam: { theoreticalPi: 6.1 } };
    const moved = { protein: protein("b", "MKV"), protparam: { theoreticalPi: 8.4 } };
    assert.deepEqual(localProjectDiff(shared, moved).categories, ["protparam"]);

    const withVector = localProjectDiff(
      { ...shared, jobs: [job("expression-planning", { vectorName: "pET-28a" })] },
      { ...moved, jobs: [job("expression-planning", { vectorName: "pGEX" })] },
    );
    assert.deepEqual(withVector.categories, ["vector"]);
    assert.ok(withVector.changes.some((change) => change.category === "protparam"), "the panel still lists it");
  });

  it("describes a field that was filled in rather than replaced", () => {
    const diff = localProjectDiff(
      { protein: protein("a", "MKV") },
      { protein: protein("b", "MKV"), jobs: [job("expression-system", { strainName: "BL21(DE3)" })] },
    );
    assert.equal(diff.summary, "BL21(DE3)");
    assert.equal(diff.changes[0].summary, "Expression host set to BL21(DE3).");
  });
});

describe("branchSummary", () => {
  const change = (field: string, before: string, after: string) =>
    ({ id: field, category: "vector" as const, field, before, after, summary: "" });

  it("keeps the line short and counts the rest", () => {
    const summary = branchSummary(null, [
      change("Backbone", "pET-28a", "pGEX"),
      change("Host", "BL21", "Rosetta"),
      change("Tag", "His6", "MBP"),
      change("Capture", "Ni-NTA", "Amylose"),
    ]);
    assert.equal(summary, "pET-28a → pGEX · BL21 → Rosetta · +2 more");
  });

  it("leads with the mutation labels and counts extra edits", () => {
    const summary = branchSummary(sequenceDiff("MKVKLAK", "MAVALAA"), []);
    assert.equal(summary, "K2A, K4A +1");
  });

  it("falls back to the length change when there is no residue-level label", () => {
    assert.equal(branchSummary({ identityPercent: 0, lengthBefore: 10, lengthAfter: 4, alignedBefore: "", alignedAfter: "", edits: [] }, []), "10 → 4 aa");
  });
});
