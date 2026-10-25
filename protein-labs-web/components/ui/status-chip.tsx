import { CircleCheck, CircleHelp, CircleX, TriangleAlert } from "lucide-react";

export type StatusTone = "pass" | "attention" | "warning" | "review" | "error";

const icons = { pass: CircleCheck, attention: TriangleAlert, warning: TriangleAlert, review: CircleHelp, error: CircleX };

/** A check's verdict: colour, icon and label together, so colour is never the only signal. */
export function StatusChip({ tone, label, className = "" }: { tone: StatusTone; label: string; className?: string }) {
  const Icon = icons[tone];
  return <span className={`status-chip ${tone} ${className}`.trim()}><Icon aria-hidden="true"/>{label}</span>;
}
