// Job-page tabs: the keyboard model and which tab is shown. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { activeTabId, tabKeyTarget } from "./job-tabs.ts";

describe("tabKeyTarget", () => {
  it("moves with the arrows and wraps at both ends", () => {
    assert.equal(tabKeyTarget("ArrowRight", 0, 4), 1);
    assert.equal(tabKeyTarget("ArrowRight", 3, 4), 0);
    assert.equal(tabKeyTarget("ArrowLeft", 0, 4), 3);
    assert.equal(tabKeyTarget("ArrowLeft", 2, 4), 1);
  });
  it("jumps to the ends with Home and End", () => {
    assert.equal(tabKeyTarget("Home", 2, 4), 0);
    assert.equal(tabKeyTarget("End", 0, 4), 3);
  });
  it("leaves every other key, and an empty list, to the browser", () => {
    for (const key of ["Enter", " ", "Tab", "ArrowDown", "a"]) assert.equal(tabKeyTarget(key, 1, 4), null);
    assert.equal(tabKeyTarget("ArrowRight", 0, 0), null);
  });
});

describe("activeTabId", () => {
  it("shows the requested tab when it exists, else the first", () => {
    assert.equal(activeTabId(["run", "uniprot", "pdb"], "pdb"), "pdb");
    assert.equal(activeTabId(["run", "uniprot", "pdb"], "gone"), "run");
    assert.equal(activeTabId(["run", "uniprot"], null), "run");
    assert.equal(activeTabId([], "run"), "");
  });
});
