/**
 * Presentation of the Protein readiness checkpoint: how the seven
 * checks are grouped, ordered, counted and scored. The rules that decide a
 * check's tone live with the check itself; nothing here changes a verdict, it
 * only arranges what the rules produced.
 *
 * Pure module: no `@/` runtime imports, so `node --test` can load it directly.
 */

export type ReadinessTone = "pass" | "attention" | "review";
export type ReadinessGroupId = "sequence" | "expression" | "purification" | "quantitation";

export interface ReadinessCheck {
  /** Stable key, used for React keys and for the expanded-details set. */
  id: string;
  title: string;
  /** The short answer, e.g. "Yes · 2" or "15,470 M⁻¹ cm⁻¹". */
  value: string;
  /** The sentence explaining what the answer is based on. May be long. */
  detail: string;
  tone: ReadinessTone;
  group: ReadinessGroupId;
}

export interface ToneCounts {
  pass: number;
  attention: number;
  review: number;
}

export interface ReadinessGroup {
  id: ReadinessGroupId;
  label: string;
  hint: string;
  checks: ReadinessCheck[];
  counts: ToneCounts;
}

export interface ReadinessVerdict {
  /** Drives the ring colour; matches the StatusChip tones. */
  tone: ReadinessTone;
  label: string;
  hint: string;
}

/** Canonical order and copy of the four checkpoint sections. */
export const READINESS_GROUPS: { id: ReadinessGroupId; label: string; hint: string }[] = [
  { id: "sequence", label: "Sequence", hint: "What this construct's own residues say." },
  { id: "expression", label: "Expression", hint: "Where and how the host must make it." },
  { id: "purification", label: "Purification", hint: "What the chemistry demands of the buffers and columns." },
  { id: "quantitation", label: "Quantitation", hint: "Whether concentration can be measured by A₂₈₀." },
];

/** Attention first, then unanswered checks, then settled ones. */
const TONE_RANK: Record<ReadinessTone, number> = { attention: 0, review: 1, pass: 2 };

/** A check's weight toward the readiness score: a flagged risk counts half. */
const TONE_WEIGHT: Record<ReadinessTone, number> = { pass: 1, attention: 0.5, review: 0 };

/** Details longer than this get a disclosure button instead of a wall of text. */
export const DETAIL_DISCLOSURE_CHARS = 115;

export function countTones(checks: readonly ReadinessCheck[]): ToneCounts {
  const counts: ToneCounts = { pass: 0, attention: 0, review: 0 };
  for (const check of checks) counts[check.tone] += 1;
  return counts;
}

/**
 * Percent of the checkpoint that is settled. A passing check counts fully, a
 * flagged risk counts half (it is understood but still costs you something),
 * and an unanswered check counts nothing. Always 0 when there are no checks.
 */
export function readinessScore(checks: readonly ReadinessCheck[]): number {
  if (!checks.length) return 0;
  const weighted = checks.reduce((total, check) => total + TONE_WEIGHT[check.tone], 0);
  return Math.round((weighted / checks.length) * 100);
}

/** The headline above the ring. Unanswered checks outrank flagged risks. */
export function readinessVerdict(checks: readonly ReadinessCheck[]): ReadinessVerdict {
  const counts = countTones(checks);
  if (!checks.length) return { tone: "review", label: "Nothing to review", hint: "No checks were produced for this construct." };
  if (counts.review) return { tone: "review", label: "Review needed", hint: `${plural(counts.review, "check")} still unanswered before planning.` };
  if (counts.attention) return { tone: "attention", label: "Ready with flagged risks", hint: `${plural(counts.attention, "check")} need a plan in expression or purification.` };
  return { tone: "pass", label: "Ready to plan", hint: "Every check is settled for this construct." };
}

/**
 * Checks arranged into their sections. Sections with no checks are dropped,
 * the worst section comes first, and inside a section attention items lead.
 * Ties keep the order the checks were declared in, so the layout only moves
 * when a verdict actually changes.
 */
export function groupReadinessChecks(checks: readonly ReadinessCheck[]): ReadinessGroup[] {
  const groups: ReadinessGroup[] = [];
  for (const definition of READINESS_GROUPS) {
    const members = checks
      .map((check, index) => ({ check, index }))
      .filter((entry) => entry.check.group === definition.id)
      .sort((a, b) => TONE_RANK[a.check.tone] - TONE_RANK[b.check.tone] || a.index - b.index)
      .map((entry) => entry.check);
    if (members.length) groups.push({ ...definition, checks: members, counts: countTones(members) });
  }
  return groups
    .map((group, index) => ({ group, index }))
    .sort((a, b) => worstTone(a.group.checks) - worstTone(b.group.checks) || a.index - b.index)
    .map((entry) => entry.group);
}

/** True when the detail is long enough to deserve a "Details" disclosure. */
export function needsDisclosure(detail: string): boolean {
  return detail.trim().length > DETAIL_DISCLOSURE_CHARS;
}

function worstTone(checks: readonly ReadinessCheck[]): number {
  return Math.min(...checks.map((check) => TONE_RANK[check.tone]));
}

function plural(count: number, noun: string): string {
  return `${count} ${noun}${count === 1 ? "" : "s"}`;
}
