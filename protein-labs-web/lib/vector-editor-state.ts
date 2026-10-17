// Pure state helpers for the vector editor: request ordering, undo history,
// and validation of engine responses whose shape depends on the engine version.

/**
 * Hands out a token per request so only the latest one may apply its result.
 * A slow response for a vector the user has already left is then ignored
 * instead of overwriting the newer vector's data.
 */
export function createRequestGate() {
  let latest = 0;
  return {
    begin(): number { latest += 1; return latest; },
    isCurrent(token: number): boolean { return token === latest; },
    cancel(): void { latest += 1; },
  };
}

/** Results tagged with what they were computed for, so a view can refuse a mismatch. */
export type Tagged<T> = { key: string; value: T };
export function valueFor<T>(tagged: Tagged<T> | null, key: string): T | null {
  return tagged && tagged.key === key ? tagged.value : null;
}

// ---------------------------------------------------------------------------
// Undo history
// ---------------------------------------------------------------------------

export type History<T> = { undo: T[]; redo: T[]; current: T };
const LIMIT = 100;

/** Record that `next` replaced the current construct (a local edit or a server commit). */
export function commit<T>(history: History<T>, next: T): History<T> {
  return { undo: [...history.undo, history.current].slice(-LIMIT), redo: [], current: next };
}

/** Step back to the previous construct; returns the same history when there is none. */
export function undoStep<T>(history: History<T>): History<T> {
  const previous = history.undo.at(-1);
  if (previous === undefined) return history;
  return { undo: history.undo.slice(0, -1), redo: [...history.redo, history.current], current: previous };
}

export function redoStep<T>(history: History<T>): History<T> {
  const next = history.redo.at(-1);
  if (next === undefined) return history;
  return { undo: [...history.undo, history.current], redo: history.redo.slice(0, -1), current: next };
}

// ---------------------------------------------------------------------------
// Engine response guards
// ---------------------------------------------------------------------------

type Screen = { risk: "low" | "moderate" | "high"; longestComplementaryRun: number; threePrimeComplementarity: number; limitation: string };
export type CheckedPrimer = {
  id: string; name: string; sequence: string; annealingSequence: string; overhang: string; start: number; end: number; strand: number;
  totalLength: number; gcPercent: number; tmCelsius: number; tmDeltaCelsius: number; tmMethod: string; withinGcLimits: boolean;
  hairpin: Screen; selfDimer: Screen; heteroDimer: Screen;
};

const finite = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value);
const isScreen = (value: unknown): value is Screen => {
  const screen = value as Partial<Screen> | null;
  return !!screen && typeof screen === "object" && (screen.risk === "low" || screen.risk === "moderate" || screen.risk === "high");
};

export const PRIMER_ENGINE_TOO_OLD = "The local engine designed primers the old way (length only, no Tm target or hairpin/dimer checks). Update the Protein Lab engine to use Tm-targeted primer design.";

/**
 * Read `designedPrimers` from a primer-design response. Older engines answer the
 * same endpoint successfully without it, so a missing or partial result is
 * reported as an incompatibility rather than rendered.
 */
export function readDesignedPrimers(response: unknown): { primers: CheckedPrimer[]; error: string } {
  const list = (response as { designedPrimers?: unknown } | null)?.designedPrimers;
  if (!Array.isArray(list) || !list.length) return { primers: [], error: PRIMER_ENGINE_TOO_OLD };
  const primers: CheckedPrimer[] = [];
  for (const raw of list) {
    const item = raw as Record<string, unknown>;
    const valid = typeof item?.sequence === "string" && finite(item.start) && finite(item.end) && finite(item.strand)
      && finite(item.tmCelsius) && finite(item.tmDeltaCelsius) && finite(item.gcPercent) && finite(item.totalLength)
      && isScreen(item.hairpin) && isScreen(item.selfDimer) && isScreen(item.heteroDimer);
    if (!valid) return { primers: [], error: PRIMER_ENGINE_TOO_OLD };
    primers.push({
      id: String(item.id ?? `${item.strand}-${item.start}`), name: String(item.name ?? ""), sequence: item.sequence as string,
      annealingSequence: typeof item.annealingSequence === "string" ? item.annealingSequence : item.sequence as string,
      overhang: typeof item.overhang === "string" ? item.overhang : "",
      start: item.start as number, end: item.end as number, strand: item.strand as number, totalLength: item.totalLength as number,
      gcPercent: item.gcPercent as number, tmCelsius: item.tmCelsius as number, tmDeltaCelsius: item.tmDeltaCelsius as number,
      tmMethod: String(item.tmMethod ?? ""), withinGcLimits: item.withinGcLimits !== false,
      hairpin: item.hairpin as Screen, selfDimer: item.selfDimer as Screen, heteroDimer: item.heteroDimer as Screen,
    });
  }
  return { primers, error: "" };
}
