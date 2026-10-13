import { describe, expect, it } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("lets caller classes override conflicting Tailwind defaults", () => {
    expect(cn("px-2 py-1 text-sm", "px-4")).toBe("py-1 text-sm px-4");
  });

  it("combines conditional classes without losing responsive variants", () => {
    expect(cn("p-2 md:p-4", ["rounded", null], { hidden: false, flex: true }))
      .toBe("p-2 md:p-4 rounded flex");
  });
});
