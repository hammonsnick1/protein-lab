import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cn } from "./utils.ts";

describe("cn", () => {
  it("lets caller classes override conflicting Tailwind defaults", () => {
    assert.equal(cn("px-2 py-1 text-sm", "px-4"), "py-1 text-sm px-4");
  });

  it("combines conditional classes without losing responsive variants", () => {
    assert.equal(
      cn("p-2 md:p-4", ["rounded", null], { hidden: false, flex: true }),
      "p-2 md:p-4 rounded flex",
    );
  });
});
