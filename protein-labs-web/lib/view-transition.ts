import { flushSync } from "react-dom";

export type NavDirection = "forward" | "back";

type TransitionDocument = Document & { startViewTransition?: (update: () => void) => { finished: Promise<void> } };

/* Swaps workspace views with the browser's View Transitions API: the outgoing
   view is captured as a GPU snapshot and cross-slides against the incoming one,
   so heavy views mounting underneath never stall the animation. Falls back to
   an immediate update where unsupported or when reduced motion is requested. */
export function runViewTransition(update: () => void, direction: NavDirection = "forward") {
  const doc = document as TransitionDocument;
  if (!doc.startViewTransition || window.matchMedia("(prefers-reduced-motion: reduce)").matches) { update(); return; }
  const root = document.documentElement;
  root.dataset.navDirection = direction;
  const transition = doc.startViewTransition(() => flushSync(() => { update(); window.scrollTo(0, 0); }));
  transition.finished.finally(() => { if (root.dataset.navDirection === direction) delete root.dataset.navDirection; });
}
