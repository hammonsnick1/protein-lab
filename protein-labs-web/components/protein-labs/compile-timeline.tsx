"use client";

import type { CSSProperties } from "react";
import { ArrowLeftRight, ArrowRight, Check, CircleCheck, CircleDot, CircleX, Clipboard, ClipboardList, Droplets, FlaskConical, Layers, LoaderCircle, Magnet, Scissors, ShieldCheck, Shrink, TriangleAlert, Zap, Funnel, type LucideIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StatusChip } from "@/components/ui/status-chip";
import { compileTimeline, revealDelayMs, stepKindLabels, type CheckLevel, type CompileCheck, type Finding, type StepKind, type TimelineLink, type WorkflowStep } from "@/lib/compile-timeline";

/** One icon per step type; each also gets its own short entrance motion in globals.css. */
const kindIcons: Record<StepKind, LucideIcon> = {
  expression: FlaskConical,
  lysis: Zap,
  affinity: Magnet,
  elution: Droplets,
  cleavage: Scissors,
  subtractive: Funnel,
  exchange: ArrowLeftRight,
  concentration: Shrink,
  sec: Layers,
  qc: ShieldCheck,
  step: CircleDot,
};

/** Blocking issues first, then warnings, then passes; one label and icon per level, so colour is never the only signal. */
const levels = [
  { level: "error", label: "Blocking", plural: "Blocking", Icon: CircleX },
  { level: "warning", label: "Warning", plural: "Warnings", Icon: TriangleAlert },
  { level: "pass", label: "Pass", plural: "Passed", Icon: CircleCheck },
] as const;
const levelInfo = (level: CheckLevel) => levels.find((value) => value.level === level)!;

function delay(index: number): CSSProperties {
  return { "--compile-delay": `${revealDelayMs(index)}ms` } as CSSProperties;
}

function linkSummary(link: TimelineLink) {
  const count = (level: CheckLevel) => link.findings.filter((item) => item.level === level).length;
  if (link.level === "error") return `${count("error")} blocking`;
  if (link.level === "warning") return `${count("warning")} warning${count("warning") === 1 ? "" : "s"}`;
  return "Compatible";
}

/**
 * Compile workflow: the generated bench plan as a timeline. Each step is a card
 * with its step-type icon; the connector between two steps carries the
 * compatibility checks for that hand-off, each with what is wrong and how to
 * fix it. Checks that belong to no single hand-off sit beside the timeline.
 */
export function CompileReview({ proteinName, checks, workflow, nothingSaved, busy, onCopy, onSave }: { proteinName: string; checks: CompileCheck[]; workflow: WorkflowStep[]; nothingSaved: boolean; busy: boolean; onCopy: () => void; onSave: () => void }) {
  const timeline = compileTimeline(checks, workflow);
  const count = (level: CheckLevel) => checks.filter((check) => check.level === level).length;
  const blocking = count("error");
  function showStep(index: number) {
    const target = document.getElementById(`compile-step-${index}`);
    if (!target) return;
    const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    target.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
    target.focus({ preventScroll: true });
  }
  return <div className="compile-review">
    <header className="compile-summary">
      <span className="compile-summary-text"><strong>Compatibility review and bench workflow</strong><small>{proteinName} · {workflow.length} steps · {blocking ? `${blocking} blocking issue${blocking === 1 ? "" : "s"} must be resolved before the plan is ready.` : "No blocking issues. Review any warnings before going to the bench."}</small></span>
      <span className="compile-metrics">{levels.map(({ level, plural, Icon }) => <span className={level} key={level}><Icon aria-hidden="true"/><b>{count(level)}</b><small>{plural}</small></span>)}</span>
      <span className="compile-actions"><StatusChip tone={blocking ? "error" : "pass"} label={blocking ? "Draft" : "Ready for review"}/><Button variant="outline" onClick={onCopy}><Clipboard/> Copy report</Button><Button disabled={busy} onClick={onSave}>{busy ? <LoaderCircle className="spin"/> : <Check/>}{blocking ? "Save draft" : "Save workflow"}</Button></span>
    </header>
    {nothingSaved && <div className="review-empty"><ClipboardList aria-hidden="true"/><span><strong>Nothing saved to compile yet</strong><small>Save Affinity capture, Subtractive cleanup, Cell lysis and SEC polishing first. Until then the steps below are generic placeholders.</small></span></div>}
    <nav className="compile-rail" aria-label="Workflow overview">
      {timeline.steps.map((step, index) => {
        const Icon = kindIcons[step.kind];
        const link = step.into;
        const LinkIcon = link?.level ? levelInfo(link.level).Icon : null;
        return <span className="compile-rail-item" key={index} style={delay(index)}>
          {link && <span className={`compile-rail-link ${link.level ?? "none"}`} title={link.level ? linkSummary(link) : "No checks on this hand-off"}>{LinkIcon && <><LinkIcon aria-hidden="true"/><span className="sr-only">{linkSummary(link)}</span></>}</span>}
          <button type="button" className="compile-rail-node" data-kind={step.kind} onClick={() => showStep(index)}><span className="compile-icon"><Icon aria-hidden="true"/></span><small><b>{index + 1}</b>{stepKindLabels[step.kind]}</small></button>
        </span>;
      })}
    </nav>
    <div className="compile-body">
      <ol className="compile-timeline" aria-label="Generated bench workflow">
        {timeline.steps.map((step, index) => {
          const Icon = kindIcons[step.kind];
          const previous = timeline.steps[index - 1];
          return <li className="compile-item" data-kind={step.kind} key={index} style={delay(index)}>
            {step.into && previous && step.into.findings.length > 0 && <CompatLink link={step.into} from={previous.title} to={step.title}/>}
            <article className="compile-step" id={`compile-step-${index}`} tabIndex={-1}>
              <span className="compile-node compile-icon"><Icon aria-hidden="true"/></span>
              <div>
                <small className="compile-step-kind"><b>Step {index + 1}</b>{stepKindLabels[step.kind]}</small>
                <strong>{step.title}</strong>
                <p>{step.instruction}</p>
                <small className="compile-record"><b>Record</b>{step.record}</small>
              </div>
            </article>
          </li>;
        })}
      </ol>
      <aside className="compile-aside">
        <section className="compile-general" style={delay(1)}>
          <header><strong>Across the workflow</strong><small>Checks that apply to every step rather than one hand-off.</small></header>
          {timeline.general.length ? <Findings findings={timeline.general}/> : <p className="compile-none">No workflow-wide checks.</p>}
        </section>
        <div className="guidance-card"><FlaskConical/><span><strong>Evidence basis</strong><small>Starting conditions synthesize official Cytiva, Thermo Fisher, NEB, and tag-specific manufacturer guidance. Reconcile this draft with exact product documentation.</small></span></div>
      </aside>
    </div>
  </div>;
}

/** The connector between two steps: its overall verdict and every check on that hand-off. */
function CompatLink({ link, from, to }: { link: TimelineLink; from: string; to: string }) {
  const level = link.level ?? "pass";
  const { Icon } = levelInfo(level);
  return <section className={`compile-link ${level}`} aria-label={`Hand-off from ${from} to ${to}: ${linkSummary(link)}`}>
    <span className="compile-link-mark"><Icon aria-hidden="true"/></span>
    <div className="compile-link-body">
      <header><span className="compile-link-route">{from}<ArrowRight aria-hidden="true"/>{to}</span><StatusChip tone={level} label={linkSummary(link)}/></header>
      <Findings findings={link.findings}/>
    </div>
  </section>;
}

/** Warnings and blocking issues in full with their fix; passes as compact one-line confirmations. */
function Findings({ findings }: { findings: Finding[] }) {
  return <ul className="compile-findings">{findings.map((finding, index) => {
    const { Icon, label } = levelInfo(finding.level);
    return <li className={`compile-finding ${finding.level}`} key={`${finding.title}-${index}`}>
      <Icon aria-hidden="true"/>
      <span>
        <strong><em>{label}</em>{finding.title}</strong>
        <small>{finding.detail}</small>
        {finding.fix && <small className="compile-fix"><b>How to fix</b>{finding.fix}</small>}
      </span>
    </li>;
  })}</ul>;
}
