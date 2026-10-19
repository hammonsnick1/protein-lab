"use client";

import { useEffect, useId, useRef, useState } from "react";
import { RotateCcw, RotateCw, type LucideIcon } from "lucide-react";

/**
 * A dashboard tile that shows an overview on its front and flips to the full
 * list on its back. The whole front is one button (click, Enter or Space);
 * the back returns with its Back control, its title, or Escape. Focus follows
 * the visible face, and the hidden face is inert so Tab never lands on it.
 * Under reduced motion the CSS swaps the 3D turn for a cross-fade.
 */
export function FlipTile({ className, icon: Icon, title, subtitle, front, back, actions, backSubtitle }: {
  className: string;
  icon: LucideIcon;
  title: string;
  subtitle: string;
  front: React.ReactNode;
  back: React.ReactNode;
  actions?: React.ReactNode;
  backSubtitle?: string;
}) {
  const [flipped, setFlipped] = useState(false);
  const moved = useRef(false);
  const frontRef = useRef<HTMLButtonElement>(null);
  const backRef = useRef<HTMLButtonElement>(null);
  const backId = useId();

  useEffect(() => {
    // Only move focus after the reader has flipped, not on first render.
    if (!moved.current) return;
    (flipped ? backRef : frontRef).current?.focus({ preventScroll: true });
  }, [flipped]);

  function flip(value: boolean) { moved.current = true; setFlipped(value); }

  return <article className={`flip-tile ${className}-tile ${flipped ? "is-flipped" : ""}`}>
    <button ref={frontRef} className={`flip-face flip-front dashboard-card ${className}`} onClick={() => flip(true)} aria-expanded={flipped} aria-controls={backId} inert={flipped}>
      <span className="flip-front-head">
        <Icon/>
        <span><strong>{title}</strong><small>{subtitle}</small></span>
        <em className="flip-hint"><RotateCw/><span>Show all</span></em>
      </span>
      <span className="flip-front-body">{front}</span>
    </button>
    <section id={backId} className={`flip-face flip-back dashboard-card ${className}`} aria-label={title} inert={!flipped} onKeyDown={(event) => { if (event.key === "Escape") { event.stopPropagation(); flip(false); } }}>
      <header className="dashboard-card-header flip-back-header">
        <button className="flip-back-title" onClick={() => flip(false)} title={`Back to the ${title.toLowerCase()} overview`}>
          <Icon/>
          <span><strong>{title}</strong><small>{backSubtitle ?? subtitle}</small></span>
        </button>
        <div>
          {actions}
          <button ref={backRef} className="flip-back-button" onClick={() => flip(false)} aria-label={`Back to the ${title.toLowerCase()} overview`}><RotateCcw/><span>Back</span></button>
        </div>
      </header>
      <div className="flip-back-body">{back}</div>
    </section>
  </article>;
}

/** The headline on a tile's front: one large figure, its label, and a line of context. */
export function TileHeadline({ value, label, detail }: { value: React.ReactNode; label: string; detail?: React.ReactNode }) {
  return <span className="tile-headline"><strong>{value}</strong><span><b>{label}</b>{detail && <small>{detail}</small>}</span></span>;
}
