// Tests for the dashboard statistics. Run with `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { completedByStage, jobStatusRows, niceMax, perWeek, projectsOverTime, weekStart } from "./dashboard-stats.ts";
import type { ProjectJob, ProteinRecord } from "./protein-labs-api.ts";

function job(status: ProjectJob["status"], appType: string, createdAt = "2026-10-14T10:00:00"): ProjectJob {
  return { id: `${appType}-${status}-${createdAt}`, proteinId: "p", name: appType, appType, status, config: {}, createdAt, updatedAt: createdAt };
}
function protein(createdAt?: string): ProteinRecord {
  return { id: createdAt ?? "undated", name: "P", sequence: "MK", organism: "", geneName: "", description: "", expressionSystem: "", notes: "", tags: [], externalIds: {}, createdAt };
}

// Saturday 17 October 2026, midday local time.
const now = new Date(2026, 9, 17, 12);

describe("dashboard stats", () => {
  it("counts jobs by status in a fixed order", () => {
    const rows = jobStatusRows([job("complete", "a"), job("complete", "b"), job("ready", "c")]);
    assert.deepEqual(rows.map((row) => [row.key, row.value]), [["complete", 2], ["in_progress", 0], ["ready", 1]]);
  });

  it("counts only completed jobs on the roadmap, per stage", () => {
    const stages = [{ id: "plan", label: "Plan" }, { id: "analysis", label: "Analysis" }];
    const stageOf = (appType: string) => ({ "purification-sec": "plan", "gel-analysis": "analysis" } as Record<string, string>)[appType];
    const rows = completedByStage([job("complete", "gel-analysis"), job("in_progress", "gel-analysis"), job("complete", "purification-sec"), job("complete", "unknown")], stages, stageOf);
    assert.deepEqual(rows.map((row) => row.value), [1, 1]);
  });

  it("starts weeks on Monday", () => {
    assert.equal(weekStart(now).getDay(), 1);
    assert.equal(weekStart(now).getDate(), 12);
    assert.equal(weekStart(new Date(2026, 9, 12)).getDate(), 12);
  });

  it("buckets timestamps into the last weeks, current week last", () => {
    const rows = perWeek(["2026-10-12T00:30:00", "2026-10-11T23:00:00", "2026-08-01T00:00:00", "not a date", undefined], now, 4);
    assert.equal(rows.length, 4);
    assert.deepEqual(rows.map((row) => row.value), [0, 0, 1, 1]);
    assert.equal(rows[3].start.getDate(), 12);
  });

  it("keeps a running project total, counting undated projects throughout", () => {
    const rows = projectsOverTime([protein("2026-10-13T09:00:00"), protein("2026-09-30T09:00:00"), protein()], now, 3);
    assert.deepEqual(rows.map((row) => row.value), [2, 2, 3]);
  });

  it("rounds axis maxima up to 1, 2, 5 steps", () => {
    assert.deepEqual([0, 1, 3, 7, 12, 50, 51].map(niceMax), [1, 1, 5, 10, 20, 50, 100]);
  });
});
