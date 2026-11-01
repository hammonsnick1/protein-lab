import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { initialPlan, planConfig } from "@/lib/construct-records";
import type { JsonObject } from "@/lib/protein-labs-api";

/** A saved Affinity capture job config. */
function saved(constructPlan: JsonObject | undefined, tag = "6×His"): JsonObject {
  return constructPlan ? { tag, constructPlan } : { tag };
}

describe("initialPlan", () => {
  it("starts a new His project from the house DYDIPTT + GA layout", () => {
    const plan = initialPlan(saved(undefined), "6×His");
    assert.equal(plan.tagId, "his6");
    assert.equal(plan.terminus, "N");
    assert.equal(plan.linkerId, "dydiptt");
    assert.equal(plan.junctionId, "ga");
  });

  it("starts a new GST project with no linker and no junction", () => {
    const plan = initialPlan(saved(undefined, "GST"), "GST");
    assert.equal(plan.tagId, "gst");
    assert.equal(plan.linkerId, "none");
    assert.equal(plan.junctionId, "none");
  });

  it("reopens a plan saved before the junction existed exactly as it was built", () => {
    // Written by the old code: the Gly-Ser default and no junction at all.
    // Filling the junction from the house default here would silently turn it
    // into M–His–GS–ENLYFQG–GA–target, which is neither construct.
    const plan = initialPlan(saved({ terminus: "N", initiatorMet: true, tagId: "his6", linkerId: "gs", cleavageId: "tev" }), "6×His");
    assert.equal(plan.linkerId, "gs");
    assert.equal(plan.junctionId, "none");
  });

  it("does not add a junction to an old plan that had no linker either", () => {
    const plan = initialPlan(saved({ tagId: "his6", linkerId: "none", cleavageId: "tev" }), "6×His");
    assert.equal(plan.linkerId, "none");
    assert.equal(plan.junctionId, "none");
  });

  it("keeps the house layout once it has been saved", () => {
    const plan = initialPlan(saved({ tagId: "his6", linkerId: "dydiptt", junctionId: "ga", cleavageId: "tev" }), "6×His");
    assert.equal(plan.linkerId, "dydiptt");
    assert.equal(plan.junctionId, "ga");
  });

  it("round-trips a plan through planConfig unchanged", () => {
    const first = initialPlan(saved(undefined), "6×His");
    const second = initialPlan(saved(planConfig(first)), "6×His");
    assert.deepEqual(second, first);
  });

  it("round-trips a hand-picked linker and junction", () => {
    const edited = { ...initialPlan(saved(undefined), "6×His"), linkerId: "ggggs", junctionId: "none" };
    const reopened = initialPlan(saved(planConfig(edited)), "6×His");
    assert.equal(reopened.linkerId, "ggggs");
    assert.equal(reopened.junctionId, "none");
  });
});
