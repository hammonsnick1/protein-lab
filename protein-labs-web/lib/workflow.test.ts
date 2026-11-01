// Tests for the workflow progress selectors. Run with `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { JsonObject, ProjectJob, ProteinBundle } from "./protein-labs-api.ts";
import { buildSkipConfig, cardFor, cardStages, definitionFor, progressPercent, workflowCards, workflowJobs, workflowProgress, workflowProgressTotals } from "./workflow.ts";

/** A saved job record the way the job components write one: `savedByUser`,
 *  `complete`, and whatever key the card's definition requires. */
function savedJob(appType: string, extra: JsonObject = {}, status: ProjectJob["status"] = "complete"): ProjectJob {
  const definition = workflowJobs.find((job) => job.appType === appType);
  const required = definition?.requiredKey ? { [definition.requiredKey]: "saved" } : {};
  return {
    id: `${appType}-job`, proteinId: "p1", name: `${appType} record`, appType, status,
    config: { savedByUser: true, ...required, ...extra },
    createdAt: "2026-10-30T09:00:00", updatedAt: "2026-10-30T09:00:00",
  };
}

function bundle(jobs: ProjectJob[], { sequence = "MKWVTFISLL", protparam = true } = {}): ProteinBundle {
  return {
    protein: { id: "p1", name: "CA2", sequence, organism: "", geneName: "", description: "", expressionSystem: "", notes: "", tags: [], externalIds: {} },
    protparam: protparam ? { result: {}, analyzedAt: "2026-10-30T09:00:00" } : null,
    blastJobs: [], uniprotMatches: [], pdbMatches: [], alphaFoldModels: [],
    projectJobs: jobs, projectNotebook: null,
  };
}

describe("workflow progress", () => {
  it("counts against the workflow definition, not the saved records", () => {
    // The old counter divided saved jobs by saved jobs and always read 100 %.
    const progress = workflowProgress(bundle([savedJob("protparam"), savedJob("database-research")]));
    assert.equal(progress.total, workflowCards.length);
    assert.equal(progress.complete, 3); // sequence, properties, research
    assert.ok(progress.percent > 0 && progress.percent < 100);
    assert.equal(progress.remaining, workflowCards.length - 3);
  });

  it("measures a project against the cards the workflow screen draws", () => {
    // The purify and analysis jobs are opened from the roadmap once there is
    // bench data; they are not cards a project can be behind on.
    assert.deepEqual([...new Set(workflowCards.map((definition) => definition.stage))].sort(), [...cardStages].sort());
    assert.ok(workflowCards.length < workflowJobs.length);
    assert.ok(workflowJobs.filter((definition) => !workflowCards.includes(definition)).every((definition) => definition.stage === "purify" || definition.stage === "analysis"));
  });

  it("names the first open card as the next step", () => {
    const progress = workflowProgress(bundle([]));
    assert.equal(progress.next?.id, "properties");
    assert.equal(progress.complete, 1); // the sequence itself
  });

  it("reads 100 % only when every card is complete or skipped", () => {
    const jobs = workflowCards
      .filter((definition) => definition.appType !== "protein-planner")
      .map((definition, index) => (index % 2
        ? savedJob(definition.appType)
        : savedJob(definition.appType, buildSkipConfig())));
    const progress = workflowProgress(bundle(jobs));
    assert.equal(progress.complete, progress.total);
    assert.equal(progress.remaining, 0);
    assert.equal(progress.percent, 100);
    assert.equal(progress.next, null);
  });

  it("does not count a draft that never reached complete", () => {
    const draft = savedJob("purification-affinity", {}, "in_progress");
    const progress = workflowProgress(bundle([draft]));
    assert.equal(progress.complete, 1); // the sequence; the draft does not count
    assert.ok(progress.next);
    assert.notEqual(progress.next?.appType, "protein-planner");
  });

  it("treats a project with no saved step as not started", () => {
    // A freshly branched project: a sequence, nothing saved. The tile used to
    // read "0/0 jobs · 0 %" for it.
    const fresh = workflowProgress(bundle([], { protparam: false }));
    assert.equal(fresh.started, false);
    assert.ok(fresh.total > 0);
    assert.equal(workflowProgress(bundle([savedJob("protparam")])).started, true);
  });

  it("adds the counts up across projects", () => {
    const totals = workflowProgressTotals([bundle([savedJob("protparam")]), bundle([])]);
    assert.equal(totals.projects, 2);
    assert.equal(totals.total, workflowCards.length * 2);
    assert.equal(totals.complete, 2 + 1); // two cards in the first project, the sequence in the second
  });

  it("never rounds a percentage to 0 or 100 while it is neither", () => {
    assert.equal(progressPercent(0, 18), 0);
    assert.equal(progressPercent(18, 18), 100);
    assert.equal(progressPercent(17, 18), 94);
    assert.equal(progressPercent(999, 1000), 99);
    assert.equal(progressPercent(1, 1000), 1);
    assert.equal(progressPercent(0, 0), 0);
  });
});

describe("saved records and their cards", () => {
  it("has no card for the roadmap, which saves a record on every visit", () => {
    assert.equal(cardFor("purification-roadmap"), null);
    // definitionFor still has to return something for job routing.
    assert.equal(definitionFor("purification-roadmap").id, workflowJobs[0].id);
  });

  it("maps folded-in records onto the card that holds them", () => {
    assert.equal(cardFor("purification-cleavage")?.id, "purification-subtractive");
    assert.equal(cardFor("purification-buffer")?.id, "purification-sec");
    assert.equal(cardFor("gel-analysis")?.id, "gel");
  });
});
