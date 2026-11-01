// Presentation model for the Compile workflow job: the generated bench steps as
// a timeline, with each compatibility check placed on the hand-off it governs
// and a concrete fix attached to every warning and blocking issue. The checks
// and steps themselves are computed in purification-planner-job.tsx; nothing
// here changes what is checked, only where it is shown.

export type CheckLevel = "pass" | "warning" | "error";
export type CompileCheck = { level: CheckLevel; title: string; detail: string };
export type WorkflowStep = { title: string; instruction: string; record: string };

export const stepKinds = ["expression", "lysis", "affinity", "elution", "cleavage", "subtractive", "exchange", "concentration", "sec", "qc", "step"] as const;
export type StepKind = (typeof stepKinds)[number];

/** Each step type's label, shown above the step title and on the overview rail. */
export const stepKindLabels: Record<StepKind, string> = {
  expression: "Expression and harvest",
  lysis: "Lysis",
  affinity: "Affinity capture",
  elution: "Wash and elution",
  cleavage: "Tag cleavage",
  subtractive: "Subtractive cleanup",
  exchange: "Buffer exchange",
  concentration: "Concentration",
  sec: "Size exclusion",
  qc: "QC and storage",
  step: "Step",
};

/** Matched in order, so "SEC polish and final buffer exchange" is SEC, not buffer exchange. */
const kindRules: [StepKind, RegExp][] = [
  ["sec", /\bsec\b|size[- ]exclusion|gel filtration/i],
  ["subtractive", /subtractive|reverse[- ]affinity/i],
  ["cleavage", /cleav|remove the (affinity )?tag|protease/i],
  ["lysis", /\blys(e|is)\b|clarif/i],
  ["elution", /\belut|\bwash/i],
  ["affinity", /captur|affinity|equilibrate/i],
  ["exchange", /dialys|buffer exchange|desalt/i],
  ["concentration", /concentrat/i],
  ["qc", /quality|storage|aliquot/i],
  ["expression", /prepare material|harvest|express|culture|induc/i],
];

export function workflowStepKind(title: string): StepKind {
  return kindRules.find(([, pattern]) => pattern.test(title))?.[0] ?? "step";
}

/**
 * The step a check belongs in front of, most specific first. A check sits on
 * the connector leading into the first step of that kind; when the workflow
 * has no such step (a retained tag drops cleavage and cleanup) the next kind
 * is tried, and a check with no step at all goes to "Across the workflow".
 */
const anchorRules: [RegExp, StepKind[]][] = [
  [/^cell lysis\b/i, ["lysis"]],
  [/^subtractive cleanup\b/i, ["subtractive", "sec"]],
  [/^sec polishing\b/i, ["sec"]],
  [/affinity capture has not|capture chemistry|affinity tag|tag is not annotated|tag was not found|expression vector|chelator|biotin is present|protein c capture/i, ["affinity"]],
  [/elution/i, ["elution"]],
  [/cleavage|tag retention|protease inhibitor|cysteine-protease|\btev\b/i, ["cleavage", "sec"]],
];

function anchorFor(title: string): StepKind[] {
  return anchorRules.find(([pattern]) => pattern.test(title))?.[1] ?? [];
}

/** How to resolve each warning or blocking issue the compile review can raise. */
const fixRules: [RegExp, string | ((title: string) => string)][] = [
  [/^(.+?) has not been saved$/i, (title) => `Open ${title.replace(/ has not been saved$/i, "")} from the roadmap, choose an option and save it, or skip that job explicitly.`],
  [/affinity capture has not been selected/i, "Open Affinity capture, choose a tag and resin, and save."],
  [/no (saved )?expression vector/i, "Save the construct in Expression vector design so the tag can be checked against its annotations."],
  [/tag is not annotated|tag was not found/i, "Annotate the tag in the vector, or choose the resin that matches the tag the construct actually carries."],
  [/cleavage strategy is missing/i, "In Subtractive cleanup, choose a protease, or choose to keep the tag."],
  [/cleavage site has not been verified/i, "Record the recognition site with the cleavage choice, or annotate it in the vector."],
  [/buffers are missing/i, "Save Affinity capture, Subtractive cleanup, Cell lysis and SEC polishing; each one saves its own buffers."],
  [/chelator conflicts/i, "Remove EDTA, EGTA and citrate from the lysis, binding and wash buffers, or move to a chelator-tolerant resin."],
  [/imac elution/i, "Add imidazole to the elution buffer, or record a validated low-pH elution."],
  [/biotin is present/i, "Remove biotin and desthiobiotin from the lysis, binding and wash buffers."],
  [/strep elution/i, "Add desthiobiotin or biotin to the elution buffer at the resin maker's concentration."],
  [/gst elution/i, "Add reduced glutathione to the elution buffer."],
  [/mbp elution/i, "Add maltose to the elution buffer."],
  [/protein c capture/i, "Add calcium chloride to the lysis, binding and wash buffers."],
  [/protease inhibitor blocks/i, "Leave PMSF, AEBSF and aprotinin out of the cleavage buffer, or exchange them out before adding the protease."],
  [/cysteine-protease inhibitor/i, "Leave E-64 and iodoacetamide out of the cleavage buffer, or exchange them out before adding the protease."],
  [/tev reducing/i, "Add 1–5 mM TCEP to the cleavage buffer; it keeps TEV active and does not reduce the Ni²⁺ in the reverse-IMAC pass that follows."],
  [/reductant can reduce the imac metal/i, "Swap DTT or β-mercaptoethanol for 1–5 mM TCEP in the lysis, binding, wash and elution buffers."],
  [/close to predicted pi/i, "Move the listed buffers at least 0.5 pH unit away from the pI, or raise their salt to limit aggregation."],
  [/reducing agent with a cysteine-rich/i, "Decide whether the disulfides must survive; if so, leave DTT, TCEP and β-mercaptoethanol out of those buffers."],
];

/** The fix shown under a warning or blocking issue; passes have none. */
export function fixFor(check: CompileCheck): string | null {
  if (check.level === "pass") return null;
  for (const [pattern, fix] of fixRules) if (pattern.test(check.title)) return typeof fix === "string" ? fix : fix(check.title);
  const stage = /^([^:]+):/.exec(check.title)?.[1];
  return stage ? `Reopen ${stage} and resolve this finding there.` : "Review the saved choices this check reads, then compile again.";
}

export type Finding = CompileCheck & { fix: string | null };
/** The hand-off from the previous step into this one, with the checks that govern it. */
export type TimelineLink = { level: CheckLevel | null; findings: Finding[] };
export type TimelineStep = WorkflowStep & { kind: StepKind; into: TimelineLink | null };
export type Timeline = { steps: TimelineStep[]; general: Finding[] };

const severity: Record<CheckLevel, number> = { error: 0, warning: 1, pass: 2 };

/** The worst level present, or null when there is nothing to judge. */
export function worstLevel(levels: CheckLevel[]): CheckLevel | null {
  return levels.reduce<CheckLevel | null>((worst, level) => worst === null || severity[level] < severity[worst] ? level : worst, null);
}

/** Blocking issues first, then warnings, then passes; ties keep their order. */
export function bySeverity<T extends { level: CheckLevel }>(items: T[]): T[] {
  return items.map((item, index) => ({ item, index })).sort((a, b) => severity[a.item.level] - severity[b.item.level] || a.index - b.index).map(({ item }) => item);
}

/** Place every check exactly once: on a step's incoming connector, or across the workflow. */
export function compileTimeline(checks: CompileCheck[], workflow: WorkflowStep[]): Timeline {
  const kinds = workflow.map((step) => workflowStepKind(step.title));
  const buckets: Finding[][] = workflow.map(() => []);
  const general: Finding[] = [];
  for (const check of checks) {
    const finding = { ...check, fix: fixFor(check) };
    const index = anchorFor(check.title).map((kind) => kinds.indexOf(kind)).find((value) => value > 0);
    if (index === undefined) general.push(finding);
    else buckets[index].push(finding);
  }
  return {
    steps: workflow.map((step, index) => ({ ...step, kind: kinds[index], into: index === 0 ? null : { level: worstLevel(buckets[index].map((item) => item.level)), findings: bySeverity(buckets[index]) } })),
    general: bySeverity(general),
  };
}

/** Each timeline item fades in over REVEAL_MS, STAGGER_MS after the one before, capped so long plans don't lag. */
export const REVEAL_MS = 320;
export const STAGGER_MS = 60;
export const MAX_REVEAL_DELAY_MS = 600;
export function revealDelayMs(index: number): number {
  return Math.min(Math.max(index, 0) * STAGGER_MS, MAX_REVEAL_DELAY_MS);
}
