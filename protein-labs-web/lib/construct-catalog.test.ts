import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  assembleConstruct,
  defaultLayoutFor,
  junctionOptions,
  linkerOptions,
  relayoutPlan,
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

  it("uses the house layout only for an N-terminal His tag", () => {
    // A C-terminal His tag is not the house construct, so it gets neither the
    // spacer nor a junction that would otherwise land at the far end.
    assert.deepEqual(defaultLayoutFor("his6", "tev", "C"), { linkerId: "none", junctionId: "none" });
    assert.deepEqual(defaultLayoutFor("his6", "tev", "N"), { linkerId: "dydiptt", junctionId: "ga" });
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

  it("drops the junction from a C-terminal His construct built from the default", () => {
    // The scar must not mix residues from both ends of the protein.
    const layout = defaultLayoutFor("his6", "tev", "C");
    const construct = assembleConstruct(target, plan({ terminus: "C", ...layout }));
    // TEV cuts between Q and G, so a C-terminal site leaves ENLYFQ behind and
    // the Gly leaves with the tag. Nothing from the N-terminus joins that.
    assert.equal(construct.scar, "ENLYFQ");
    assert.equal(construct.cleaved, target + "ENLYFQ");
    assert.ok(!construct.scar.includes("GA"));
  });

  it("drops an initiator Met that the tag already supplies", () => {
    const construct = assembleConstruct(target, plan({ tagId: "t7-tag", linkerId: "none", junctionId: "none", cleavageId: "retain" }));
    assert.equal(construct.fusion, "MASMTGGQQMG" + target);
    assert.equal(construct.segments[0].kind, "tag");
  });
});

describe("changing the tag carries the layout with it", () => {
  it("drops DYDIPTT and GA when a His resin is swapped for GST", () => {
    const next = relayoutPlan(plan(), { tagId: "gst" }, "tev");
    assert.equal(next.tagId, "gst");
    assert.equal(next.linkerId, "none");
    assert.equal(next.junctionId, "none");
    // The resolved sequence of the old tag must not follow the new one.
    assert.equal(next.resolvedTagSequence, "");
    const construct = assembleConstruct(target, { ...next, resolvedTagSequence: "SPILGYWKIK" });
    assert.ok(!construct.fusion.includes("DYDIPTT"));
    assert.equal(construct.scar, "G");
  });

  it("restores the house layout when the tag goes back to poly-His", () => {
    const gst = relayoutPlan(plan(), { tagId: "gst" }, "tev");
    const his = relayoutPlan(gst, { tagId: "his8" }, "tev");
    assert.equal(his.linkerId, "dydiptt");
    assert.equal(his.junctionId, "ga");
  });

  it("keeps a linker the researcher chose by hand", () => {
    const next = relayoutPlan(plan({ linkerId: "ggggs" }), { tagId: "gst" }, "tev");
    assert.equal(next.linkerId, "ggggs");
    // The junction was still the house default, so it follows the new tag.
    assert.equal(next.junctionId, "none");
  });

  it("keeps a junction the researcher chose by hand", () => {
    const next = relayoutPlan(plan({ junctionId: "none" }), { tagId: "his6", terminus: "C" }, "tev");
    assert.equal(next.junctionId, "none");
  });

  it("drops the house layout when the His tag moves to the C terminus", () => {
    const next = relayoutPlan(plan(), { terminus: "C" }, "tev");
    assert.equal(next.terminus, "C");
    assert.equal(next.linkerId, "none");
    assert.equal(next.junctionId, "none");
  });

  it("leaves a non-TEV construct's layout alone when the tag changes", () => {
    const thrombin = plan({ cleavageId: "thrombin", linkerId: "none", junctionId: "none" });
    const next = relayoutPlan(thrombin, { tagId: "his10" }, "thrombin");
    assert.equal(next.linkerId, "none");
    assert.equal(next.junctionId, "none");
  });
});
