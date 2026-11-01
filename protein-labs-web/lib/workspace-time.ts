/** Time spent in Protein Lab, counted for the whole session.
 *
 *  The dashboard used to run the counter itself, so the clock only advanced
 *  while the start screen was on screen: a researcher who spent an hour inside
 *  the workflow came back to "Hours in Protein Lab 0m". The ticker now belongs
 *  to the app shell, which stays mounted, and the dashboard only reads it.
 */
const KEY = "protein-labs-workspace-seconds";
const TICK_SECONDS = 30;

const listeners = new Set<(seconds: number) => void>();
let timer = 0;
let seconds = 0;

export function readWorkspaceSeconds() {
  try { return Number(window.localStorage.getItem(KEY)) || 0; } catch { return 0; }
}

/** Starts the one shared ticker. Safe to call more than once; returns the stop
 *  function so a React effect can tear it down. */
export function startWorkspaceClock() {
  if (timer) return () => stopWorkspaceClock();
  seconds = readWorkspaceSeconds();
  timer = window.setInterval(() => {
    // A hidden window is not time at the bench.
    if (document.hidden) return;
    seconds += TICK_SECONDS;
    try { window.localStorage.setItem(KEY, String(seconds)); } catch { /* Counting must not break the app. */ }
    for (const listener of listeners) listener(seconds);
  }, TICK_SECONDS * 1000);
  return () => stopWorkspaceClock();
}

export function stopWorkspaceClock() {
  if (!timer) return;
  window.clearInterval(timer);
  timer = 0;
}

export function onWorkspaceSeconds(listener: (seconds: number) => void) {
  listeners.add(listener);
  return () => { listeners.delete(listener); };
}
