import { describe, expect, it } from "vitest";
import { portsFromSeed } from "./ports.mjs";

describe("portsFromSeed", () => {
  it("is stable for a seed, so a second script finds the first one's services", () => {
    expect(portsFromSeed("a1da13b4-1773-4e09-ad6f-8f14446829f8")).toEqual(portsFromSeed("a1da13b4-1773-4e09-ad6f-8f14446829f8"));
  });

  it("separates concurrent runs", () => {
    const mine = portsFromSeed("run-one");
    const theirs = portsFromSeed("run-two");
    expect(new Set([...Object.values(mine), ...Object.values(theirs)]).size).toBe(6);
  });

  it("stays in the usable range, below the ephemeral ports Linux hands out", () => {
    for (const seed of ["", "x", "run-three", "0".repeat(64)]) {
      for (const port of Object.values(portsFromSeed(seed)) as number[]) {
        expect(port).toBeGreaterThanOrEqual(20000);
        expect(port).toBeLessThan(40003);
        expect(Number.isInteger(port)).toBe(true);
      }
    }
  });

  it("gives the three services distinct ports", () => {
    const { engine, http, cdp } = portsFromSeed("run-four");
    expect(new Set([engine, http, cdp]).size).toBe(3);
  });
});
