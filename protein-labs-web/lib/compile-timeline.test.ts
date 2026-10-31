// Compile workflow timeline: step types, where each check is shown, and its fix. Run with `npm run test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { bySeverity, compileTimeline, fixFor, MAX_REVEAL_DELAY_MS, REVEAL_MS, revealDelayMs, stepKindLabels, stepKinds, workflowStepKind, worstLevel, type CompileCheck, type WorkflowStep } from "./compile-timeline.ts";

const planner = readFileSync(new URL("../components/protein-labs/purification-planner-job.tsx", import.meta.url), "utf8");
/** The source of the checks the compile view shows: compileChecks and appendStageChecks. */
const compileSource = planner.slice(planner.indexOf("function compileChecks("), planner.indexOf("function compileWorkflow(")) + planner.slice(planner.indexOf("function appendStageChecks("), planner.indexOf("function stageFormula("));
const css = readFileSync(new URL("../app/compile-timeline.css", import.meta.url), "utf8");

const step = (title: string): WorkflowStep => ({ title, instruction: `${title} instruction`, record: `${title} record` });
/** The steps compileWorkflow generates when a protease removes the tag. */
const cleaved = ["Prepare material", "Lyse and clarify", "Equilibrate and capture", "Wash and elute", "Remove the affinity tag", "Subtractive cleanup", "SEC polish and final buffer exchange", "Quality control and storage"].map(step);
/** ... and when the tag is retained: no cleavage or cleanup. */
const retained = cleaved.filter((item) => !["Remove the affinity tag", "Subtractive cleanup"].includes(item.title));
const check = (level: CompileCheck["level"], title: string): CompileCheck => ({ level, title, detail: `${title} detail` });

describe("compile workflow step types", () => {
  it("gives every generated step its own type", () => {
    assert.deepEqual(cleaved.map((item) => workflowStepKind(item.title)), ["expression", "lysis", "affinity", "elution", "cleavage", "subtractive", "sec", "qc"]);
  });

  it("recognises the other purification step types", () => {
    assert.equal(workflowStepKind("Dialyse into storage buffer"), "exchange");
    assert.equal(workflowStepKind("Buffer exchange"), "exchange");
    assert.equal(workflowStepKind("Concentrate to 5 mg/mL"), "concentration");
    assert.equal(workflowStepKind("Induce expression"), "expression");
    assert.equal(workflowStepKind("Something new"), "step");
  });

  it("labels every type", () => {
    for (const kind of stepKinds) assert.ok(stepKindLabels[kind].length > 2, kind);
  });
});

describe("compile workflow fixes", () => {
  it("has a specific fix for every warning and blocking check the planner raises", () => {
    const titles = [...compileSource.matchAll(/\b(error|warning)\((["`])(.+?)\2/g)].map((match) => match[3].replace(/\$\{[^}]*\}/g, "X"));
    assert.ok(titles.length >= 15, `found only ${titles.length} titles`);
    for (const title of titles) {
      const fix = fixFor(check("error", title));
      assert.ok(fix && !fix.startsWith("Review the saved choices") && !fix.startsWith("Reopen"), `${title} has no specific fix`);
    }
  });

  it("names the job for a missing stage", () => {
    assert.equal(fixFor(check("error", "Cell lysis has not been saved")), "Open Cell lysis from the roadmap, choose an option and save it, or skip that job explicitly.");
  });

  it("sends a stage's own finding back to that stage", () => {
    assert.equal(fixFor(check("warning", "SEC polishing: Column load is high")), "Reopen SEC polishing and resolve this finding there.");
  });

  it("gives passes no fix", () => {
    assert.equal(fixFor(check("pass", "Capture chemistry selected")), null);
  });
});

describe("compile workflow timeline", () => {
  const checks = [
    check("pass", "Cell lysis selection saved"),
    check("warning", "Cell lysis: Lysozyme with a Gram-positive host"),
    check("pass", "Subtractive cleanup selection saved"),
    check("pass", "SEC polishing selection saved"),
    check("pass", "Capture chemistry selected"),
    check("error", "Chelator conflicts with IMAC capture"),
    check("warning", "IMAC elution mechanism is unclear"),
    check("pass", "Cleavage site recorded"),
    check("warning", "TEV reducing environment is not documented"),
    check("warning", "Buffer pH is close to predicted pI 6.10"),
    check("error", "Buffers are missing"),
  ];

  it("shows every check exactly once and none before the first step", () => {
    const timeline = compileTimeline(checks, cleaved);
    assert.equal(timeline.steps[0].into, null);
    const shown = [...timeline.steps.flatMap((item) => item.into?.findings ?? []), ...timeline.general];
    assert.equal(shown.length, checks.length);
    assert.deepEqual(new Set(shown.map((item) => item.title)), new Set(checks.map((item) => item.title)));
  });

  it("puts each check on the hand-off it governs", () => {
    const timeline = compileTimeline(checks, cleaved);
    const into = (title: string) => timeline.steps.find((item) => item.title === title)!.into!;
    assert.deepEqual(into("Lyse and clarify").findings.map((item) => item.title), ["Cell lysis: Lysozyme with a Gram-positive host", "Cell lysis selection saved"]);
    assert.deepEqual(into("Equilibrate and capture").findings.map((item) => item.title), ["Chelator conflicts with IMAC capture", "Capture chemistry selected"]);
    assert.deepEqual(into("Wash and elute").findings.map((item) => item.title), ["IMAC elution mechanism is unclear"]);
    assert.deepEqual(into("Remove the affinity tag").findings.map((item) => item.title), ["TEV reducing environment is not documented", "Cleavage site recorded"]);
    assert.deepEqual(into("Subtractive cleanup").findings.map((item) => item.title), ["Subtractive cleanup selection saved"]);
    assert.deepEqual(into("SEC polish and final buffer exchange").findings.map((item) => item.title), ["SEC polishing selection saved"]);
    assert.deepEqual(into("Quality control and storage").findings, []);
    assert.deepEqual(timeline.general.map((item) => item.title), ["Buffers are missing", "Buffer pH is close to predicted pI 6.10"]);
  });

  it("rates each hand-off by its worst check", () => {
    const timeline = compileTimeline(checks, cleaved);
    assert.deepEqual(timeline.steps.map((item) => item.into?.level ?? null), [null, "warning", "error", "warning", "warning", "pass", "pass", null]);
  });

  it("moves cleavage and cleanup checks to the SEC hand-off when the tag is retained", () => {
    const timeline = compileTimeline([check("pass", "Tag retention documented"), check("pass", "Subtractive cleanup is optional when the tag is retained")], retained);
    const sec = timeline.steps.find((item) => item.kind === "sec")!;
    assert.deepEqual(sec.into!.findings.map((item) => item.title), ["Tag retention documented", "Subtractive cleanup is optional when the tag is retained"]);
    assert.deepEqual(timeline.general, []);
  });

  it("keeps the steps' own text unchanged", () => {
    const timeline = compileTimeline([], cleaved);
    assert.deepEqual(timeline.steps.map(({ title, instruction, record }) => ({ title, instruction, record })), cleaved);
  });
});

describe("compile workflow ordering and motion", () => {
  it("orders blocking, warning, pass and keeps ties stable", () => {
    assert.deepEqual(bySeverity([check("pass", "a"), check("warning", "b"), check("error", "c"), check("warning", "d")]).map((item) => item.title), ["c", "b", "d", "a"]);
    assert.equal(worstLevel([]), null);
    assert.equal(worstLevel(["pass", "warning", "pass"]), "warning");
  });

  it("staggers reveals and caps the delay", () => {
    assert.equal(revealDelayMs(0), 0);
    assert.ok(revealDelayMs(1) > 0);
    assert.equal(revealDelayMs(100), MAX_REVEAL_DELAY_MS);
    assert.ok(REVEAL_MS <= 400);
  });

  it("keeps every animation at 400 ms or less", () => {
    const durations = [...css.matchAll(/animation:\s*[\w-]+\s+(\d+)ms/g)].map((match) => Number(match[1]));
    assert.ok(durations.length >= 2);
    for (const value of durations) assert.ok(value <= 400, `${value}ms is too long`);
    assert.match(css, new RegExp(`compile-reveal ${REVEAL_MS}ms`));
  });

  it("switches the motion off for reduced motion", () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.compile-review \*\s*\{\s*animation:\s*none !important;/);
  });
});
