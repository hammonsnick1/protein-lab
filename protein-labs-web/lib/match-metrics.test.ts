import { describe, expect, it } from "vitest";
import { matchMetric, metricLabel } from "./match-metrics";

describe("match metrics", () => {
  it("keeps a missing value missing instead of reading it as 0", () => {
    for (const value of [null, undefined, "", "n/a", Number.NaN]) expect(matchMetric(value)).toBeNull();
    expect(metricLabel(null, "identity")).toBe("identity not calculated");
    expect(metricLabel(undefined, "query coverage")).toBe("query coverage not calculated");
  });

  it("formats real values, including a genuine 0", () => {
    expect(metricLabel(1, "identity")).toBe("100.0% identity");
    expect(metricLabel("0.9962", "identity")).toBe("99.6% identity");
    expect(matchMetric(0)).toBe(0);
    expect(metricLabel(0, "coverage")).toBe("0.0% coverage");
  });
});
