import { test } from "vitest";
import assert from "node:assert/strict";
import {
  DETAIL_DISCLOSURE_CHARS,
  READINESS_GROUPS,
  type ReadinessCheck,
  type ReadinessGroupId,
  type ReadinessTone,
  countTones,
  groupReadinessChecks,
  needsDisclosure,
  readinessScore,
  readinessVerdict,
} from "./readiness-summary.ts";

function check(id: string, tone: ReadinessTone, group: ReadinessGroupId): ReadinessCheck {
  return { id, title: id, value: "", detail: "", tone, group };
}

test("tones are counted per checkpoint", () => {
  const counts = countTones([check("a", "pass", "sequence"), check("b", "attention", "sequence"), check("c", "pass", "expression")]);
  assert.deepEqual(counts, { pass: 2, attention: 1, review: 0 });
  assert.deepEqual(countTones([]), { pass: 0, attention: 0, review: 0 });
});

test("the score counts a pass fully, a flagged risk half and an unanswered check not at all", () => {
  assert.equal(readinessScore([check("a", "pass", "sequence")]), 100);
  assert.equal(readinessScore([check("a", "attention", "sequence")]), 50);
  assert.equal(readinessScore([check("a", "review", "sequence")]), 0);
  assert.equal(readinessScore([check("a", "pass", "sequence"), check("b", "review", "sequence")]), 50);
  assert.equal(readinessScore([]), 0);
});

test("an unanswered check outranks a flagged risk in the verdict", () => {
  const checks = [check("a", "pass", "sequence"), check("b", "attention", "purification"), check("c", "review", "expression")];
  assert.equal(readinessVerdict(checks).tone, "review");
  assert.match(readinessVerdict(checks).hint, /1 check still unanswered/);
  assert.equal(readinessVerdict(checks.slice(0, 2)).tone, "attention");
  assert.equal(readinessVerdict(checks.slice(0, 1)).tone, "pass");
  assert.equal(readinessVerdict([]).label, "Nothing to review");
});

test("the verdict hint keeps its plural honest", () => {
  assert.match(readinessVerdict([check("a", "review", "sequence"), check("b", "review", "sequence")]).hint, /2 checks/);
});

test("groups keep the canonical sections and drop the empty ones", () => {
  const groups = groupReadinessChecks([check("a", "pass", "quantitation"), check("b", "pass", "sequence")]);
  assert.deepEqual(groups.map((group) => group.id), ["sequence", "quantitation"]);
  assert.deepEqual(groups.map((group) => group.label), ["Sequence", "Quantitation"]);
  assert.deepEqual(groups[0].counts, { pass: 1, attention: 0, review: 0 });
});

test("the section with the worst check comes first, attention before unanswered", () => {
  const groups = groupReadinessChecks([
    check("seq", "pass", "sequence"),
    check("expr", "review", "expression"),
    check("pur", "attention", "purification"),
  ]);
  assert.deepEqual(groups.map((group) => group.id), ["purification", "expression", "sequence"]);
});

test("inside a section attention leads and ties keep the declared order", () => {
  const groups = groupReadinessChecks([
    check("first-pass", "pass", "sequence"),
    check("risk", "attention", "sequence"),
    check("second-pass", "pass", "sequence"),
    check("unanswered", "review", "sequence"),
  ]);
  assert.deepEqual(groups[0].checks.map((item) => item.id), ["risk", "unanswered", "first-pass", "second-pass"]);
});

test("every declared group id has copy, and grouping never loses a check", () => {
  const ids = READINESS_GROUPS.map((group) => group.id);
  assert.equal(new Set(ids).size, ids.length);
  for (const group of READINESS_GROUPS) assert.ok(group.label && group.hint);
  const checks = ids.map((id, index) => check(`c${index}`, "pass", id));
  assert.equal(groupReadinessChecks(checks).flatMap((group) => group.checks).length, checks.length);
});

test("only long explanations get a disclosure button", () => {
  assert.equal(needsDisclosure("No cysteines occur in the current construct."), false);
  assert.equal(needsDisclosure(" ".repeat(400)), false);
  assert.equal(needsDisclosure("x".repeat(DETAIL_DISCLOSURE_CHARS)), false);
  assert.equal(needsDisclosure("x".repeat(DETAIL_DISCLOSURE_CHARS + 1)), true);
});
