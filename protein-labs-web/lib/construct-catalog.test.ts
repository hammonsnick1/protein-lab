import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  assembleConstruct,
  defaultLayoutFor,
  junctionOptions,
  linkerOptions,
  type ConstructPlan,
} from "@/lib/construct-catalog";

const target = "MGSSKQEWTR";

function plan(overrides: Partial<ConstructPlan> = {}): ConstructPlan {
  return {
    terminus: "N",
    initiatorMet: true,
    tagId: "his6",
    linkerId: "dydiptt",
    junctionId: "ga",
    cleavageId: "tev",
    ...overrides,
  };
}

describe("house His construct layout", () => {
  it("builds M–His6–DYDIPTT–ENLYFQ↓G–GA–target", () => {
    const construct = assembleConstruct(target, plan());
    // Hand-assembled from the published parts: initiator Met, six His, the
    // DYDIPTT spacer, the rTEV site, the vector's Gly-Ala junction, target.
    assert.equal(construct.fusion, "M" + "HHHHHH" + "DYDIPTT" + "ENLYFQG" + "GA" + target);
    assert.equal(construct.fusion.length, 1 + 6 + 7 + 7 + 2 + target.length);
    assert.deepEqual(
      construct.segments.map((segment) => segment.sequence),
      ["M", "HHHHHH", "DYDIPTT", "ENLYFQ", "G", "GA", target],
    );
    assert.deepEqual(
      construct.segments.map((segment) => segment.kind),
      ["met", "tag", "linker", "site", "scar", "junction", "target"],
    );
  });

  it("leaves GGA on the protein after rTEV cleavage", () => {
    const construct = assembleConstruct(target, plan());
    assert.equal(construct.cleaves, true);
    // TEV cuts between Q and G, so its Gly plus the vector's Gly-Ala stay.
    assert.equal(construct.scar, "GGA");
    assert.equal(construct.cleaved, "GGA" + target);
    assert.equal(construct.released, "M" + "HHHHHH" + "DYDIPTT" + "ENLYFQ");
    assert.equal(construct.released.length + construct.cleaved.length, construct.fusion.length);
    assert.ok(construct.warnings.some((warning) => warning.includes("leaves GGA")));
  });

  it("keeps segment coordinates contiguous and absolute", () => {
    const construct = assembleConstruct(target, plan());
    let cursor = 0;
    for (const segment of construct.segments) {
      assert.equal(segment.start, cursor);
      assert.equal(segment.end, cursor + segment.sequence.length);
      assert.equal(construct.fusion.slice(segment.start, segment.end), segment.sequence);
      cursor = segment.end;
    }
    assert.equal(cursor, construct.fusion.length);
  });

  it("is the default layout for a poly-His tag, before and after choosing TEV", () => {
    assert.deepEqual(defaultLayoutFor("his6", "tev"), { linkerId: "dydiptt", junctionId: "ga" });
    assert.deepEqual(defaultLayoutFor("his10", ""), { linkerId: "dydiptt", junctionId: "ga" });
  });

  it("adds no linker or junction by default for other tags and proteases", () => {
    assert.deepEqual(defaultLayoutFor("gst", "tev"), { linkerId: "none", junctionId: "none" });
    assert.deepEqual(defaultLayoutFor("his6", "thrombin"), { linkerId: "none", junctionId: "none" });
    assert.deepEqual(defaultLayoutFor("his6", "retain"), { linkerId: "none", junctionId: "none" });
  });

  it("no longer defaults to a Gly-Ser linker, but keeps it selectable", () => {
    assert.notEqual(defaultLayoutFor("his6", "tev").linkerId, "gs");
    assert.ok(linkerOptions.some((option) => option.id === "gs" && option.sequence === "GS"));
    assert.ok(linkerOptions.some((option) => option.id === "dydiptt" && option.sequence === "DYDIPTT"));
    assert.ok(junctionOptions.some((option) => option.id === "ga" && option.sequence === "GA"));
  });
});

describe("other construct layouts still build", () => {
  it("builds a Strep-tag II construct with no junction residues", () => {
    const construct = assembleConstruct(target, {
      ...plan({ terminus: "C", tagId: "strep2", linkerId: "sggs", junctionId: "none", cleavageId: "thrombin" }),
    });
    assert.equal(construct.fusion, target + "LVPR" + "GS" + "SGGS" + "WSHPQFEK");
    assert.equal(construct.cleaved, target + "LVPR");
    assert.equal(construct.scar, "LVPR");
    assert.equal(construct.released, "GS" + "SGGS" + "WSHPQFEK");
  });

  it("puts the junction directly before the target for a C-terminal tag", () => {
    const construct = assembleConstruct(target, plan({ terminus: "C", tagId: "strep2", linkerId: "none", cleavageId: "retain" }));
    assert.equal(construct.fusion, "GA" + target + "WSHPQFEK");
    assert.equal(construct.cleaves, false);
    // Nothing is removed, so the "cleaved" product is the whole fusion.
    assert.equal(construct.cleaved, construct.fusion);
  });

  it("builds an uncleaved His construct without a stray protease site", () => {
    const construct = assembleConstruct(target, plan({ cleavageId: "retain", linkerId: "none", junctionId: "none" }));
    assert.equal(construct.fusion, "M" + "HHHHHH" + target);
    assert.equal(construct.scar, "");
  });

  it("reports the vector junction as a scar for a folded-domain protease", () => {
    const construct = assembleConstruct(target, plan({ tagId: "sumo", cleavageId: "ulp1", linkerId: "none" }));
    // SUMO has no hard-coded sequence, so only the junction and target build.
    assert.equal(construct.unresolvedTag?.id, "sumo");
    assert.equal(construct.scar, "GA");
    assert.equal(construct.cleaved, "GA" + target);
  });

  it("drops an initiator Met that the tag already supplies", () => {
    const construct = assembleConstruct(target, plan({ tagId: "t7-tag", linkerId: "none", junctionId: "none", cleavageId: "retain" }));
    assert.equal(construct.fusion, "MASMTGGQQMG" + target);
    assert.equal(construct.segments[0].kind, "tag");
  });
});
