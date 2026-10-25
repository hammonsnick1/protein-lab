"use client";

import { useEffect, useState } from "react";
import { Check, CircleAlert, Search, Timer } from "lucide-react";
import { formatElapsed } from "@/lib/blast-alignment";

/** A search that is still running: named steps, a live elapsed clock and a
 *  scanning sequence motif. Steps carry the progress; the remote services do
 *  not report a percentage, so the bar fills by step, not by guess. */
export function ResearchProgress({ title, steps, active, detail, startedAt, motif, note, error, children }: {
  title: string;
  steps: readonly string[];
  active: number;
  detail: string;
  startedAt: number;
  motif: string;
  note?: string;
  error?: boolean;
  children?: React.ReactNode;
}) {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const last = steps.length - 1;
  const step = Math.min(Math.max(active, 0), last);
  // Half a step for the one under way, so the bar visibly moves on each stage.
  const percent = Math.round(((step >= last ? last + 1 : step + 0.5) / steps.length) * 100);
  const residues = (motif.replace(/[^A-Za-z]/g, "").toUpperCase() || "MVHLTPEEKSAVTALWGKVNVDEVGG").slice(0, 28).split("");
  return <section className={`research-progress${error ? " error" : ""}`} aria-label={`${title} in progress`}>
    <header>
      <span className="research-progress-orb" aria-hidden="true">{error ? <CircleAlert/> : <Search/>}</span>
      <div>
        <strong>{title}</strong>
        <small role="status">{detail}</small>
      </div>
      <span className="research-progress-clock" title="Elapsed time"><Timer aria-hidden="true"/><b>{formatElapsed(now - startedAt)}</b><span className="sr-only"> elapsed</span></span>
      {children && <span className="research-progress-actions">{children}</span>}
    </header>
    <div className="research-progress-motif" aria-hidden="true">
      {residues.map((residue, index) => <span key={index} style={{ "--i": index } as React.CSSProperties}>{residue}</span>)}
    </div>
    <div className="research-progress-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`Step ${step + 1} of ${steps.length}: ${steps[step]}`}>
      <span style={{ width: `${percent}%` }}/>
    </div>
    <ol className="research-progress-steps">
      {steps.map((label, index) => <li key={label} className={index < step ? "done" : index === step ? "active" : "pending"} aria-current={index === step ? "step" : undefined}>
        <span>{index < step ? <Check aria-hidden="true"/> : index + 1}</span>{label}
      </li>)}
    </ol>
    {note && <em>{note}</em>}
  </section>;
}
