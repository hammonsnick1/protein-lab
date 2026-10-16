// Affinity runs for Chromatogram Studio (the `method: "affinity"` branch of
// POST /v1/chromatogram/run in protein-labs/backend/CHROMATOGRAPHY_API.md).
// The engine models the run and owns every number. This module only shapes the
// request, keeps the project round trip lossless and tells the plot where the
// engine put each phase and peak. It must not import runtime code from the app,
// so the node tests can load it directly.

export type ChromatographyMethod = "sec" | "affinity";
export type AffinityPhaseType = "load" | "wash" | "elute";

// What the researcher typed. Numbers stay null when a field is blank, so the
// engine rejects the request with a readable error instead of the studio
// inventing a value.
export type AffinitySetup = {
  resinName: string;
  columnVolumeMl: number | null;
  dynamicBindingCapacityMgPerMl: number | null;
  proteinMassMg: number | null;
  load: { volumeMl: number | null; buffer: string };
  wash: { volumeMl: number | null; buffer: string };
  elute: {
    volumeMl: number | null;
    buffer: string;
    peakPositionFraction: number | null;
    peakWidthFraction: number | null;
    recoveryFraction: number | null;
  };
};

export type AffinityRunRequest = {
  schemaVersion: 1;
  method: "affinity";
  column: {
    resinName: string;
    columnVolumeMl: number | null;
    dynamicBindingCapacityMgPerMl: number | null;
  };
  load: { proteinMassMg: number | null };
  phases: [
    { type: "load"; volumeMl: number | null; buffer: string },
    { type: "wash"; volumeMl: number | null; buffer: string },
    {
      type: "elute";
      volumeMl: number | null;
      buffer: string;
      peakPositionFraction: number | null;
      peakWidthFraction: number | null;
      recoveryFraction: number | null;
    },
  ];
  fractions: { id: string; startVolumeMl: number; endVolumeMl: number }[];
};

export type AffinityPhaseMass = Record<string, number>;
export type AffinityPhase = {
  type: AffinityPhaseType;
  volumeMl: number;
  buffer: string;
  startVolumeMl: number;
  endVolumeMl: number;
  peakPositionFraction?: number;
  peakWidthFraction?: number;
  recoveryFraction?: number;
  mass: AffinityPhaseMass;
};
export type AffinityPeak = {
  id: string;
  kind: "breakthrough" | "elution";
  phase: AffinityPhaseType;
  start: number;
  end: number;
  apexX: number;
  response: number;
  height: number;
  area: number;
  massMg: number;
  fwhm: number | null;
  asymmetry10: number | null;
};
export type AffinityMassBalance = {
  status: "calculated";
  loadedMg: number;
  capacityMg: number;
  boundMg: number;
  breakthroughMg: number;
  washLossMg: number;
  elutedMg: number;
  retainedMg: number;
  recoveredMg: number;
  recoveryPercent: number;
  accountedMg: number;
  unaccountedMg: number;
  closes: boolean;
  traceAreaMg: number;
};
// The run object exactly as the engine returned it. It is stored whole so a
// reopened project shows the same numbers without asking the engine again.
export type AffinityRunResult = {
  schemaVersion: 1;
  method: "affinity";
  units: Record<string, string>;
  column: {
    resinName: string;
    columnVolumeMl: number;
    dynamicBindingCapacityMgPerMl: number;
    capacityMg: number;
  };
  phases: AffinityPhase[];
  points: { x: number; y: number }[];
  peaks: AffinityPeak[];
  fractions: { id: string; startVolumeMl: number; endVolumeMl: number; massMg: number }[];
  massBalance: AffinityMassBalance;
  methods: Record<string, string>;
};

export type AffinityState = {
  setup: AffinitySetup;
  // The studio trace that draws `run.points`, so styling, figures and exports
  // treat the modelled run like any other trace.
  traceId: string;
  // The request that produced `run`, kept so reopening a project does not
  // re-run an unchanged method and a changed one is never shown as current.
  request: AffinityRunRequest | null;
  run: AffinityRunResult | null;
};

export const defaultAffinitySetup: AffinitySetup = {
  resinName: "",
  columnVolumeMl: null,
  dynamicBindingCapacityMgPerMl: null,
  proteinMassMg: null,
  load: { volumeMl: null, buffer: "" },
  wash: { volumeMl: null, buffer: "" },
  elute: {
    volumeMl: null,
    buffer: "",
    peakPositionFraction: 0.5,
    peakWidthFraction: 0.1,
    recoveryFraction: 1,
  },
};

export const emptyAffinityState: AffinityState = {
  setup: defaultAffinitySetup,
  traceId: "",
  request: null,
  run: null,
};

type StudioFraction = { id: string; name: string; start: number; end: number };

/**
 * The run request for one setup. Studio fractions are sent when they lie on the
 * run's volume axis, so the engine integrates their mass; the rest are named in
 * `skipped` rather than silently dropped.
 */
export function buildAffinityRequest(setup: AffinitySetup, fractions: StudioFraction[]) {
  const volumes = [setup.load.volumeMl, setup.wash.volumeMl, setup.elute.volumeMl];
  const runEnd = volumes.every((value) => value !== null && value > 0)
    ? volumes.reduce<number>((sum, value) => sum + (value as number), 0)
    : null;
  const sent: AffinityRunRequest["fractions"] = [];
  const skipped: string[] = [];
  for (const fraction of fractions) {
    const start = Math.min(fraction.start, fraction.end);
    const end = Math.max(fraction.start, fraction.end);
    if (runEnd !== null && Number.isFinite(start) && Number.isFinite(end) && 0 <= start && start < end && end <= runEnd)
      sent.push({ id: fraction.id, startVolumeMl: start, endVolumeMl: end });
    else skipped.push(fraction.name);
  }
  const request: AffinityRunRequest = {
    schemaVersion: 1,
    method: "affinity",
    column: {
      resinName: setup.resinName,
      columnVolumeMl: setup.columnVolumeMl,
      dynamicBindingCapacityMgPerMl: setup.dynamicBindingCapacityMgPerMl,
    },
    load: { proteinMassMg: setup.proteinMassMg },
    phases: [
      { type: "load", volumeMl: setup.load.volumeMl, buffer: setup.load.buffer },
      { type: "wash", volumeMl: setup.wash.volumeMl, buffer: setup.wash.buffer },
      {
        type: "elute",
        volumeMl: setup.elute.volumeMl,
        buffer: setup.elute.buffer,
        peakPositionFraction: setup.elute.peakPositionFraction,
        peakWidthFraction: setup.elute.peakWidthFraction,
        recoveryFraction: setup.elute.recoveryFraction,
      },
    ],
    fractions: sent,
  };
  return { request, skipped };
}

/** A project with no method predates affinity runs and is an SEC project. */
export function loadMethod(value: unknown): ChromatographyMethod {
  return value === "affinity" ? "affinity" : "sec";
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}
function numberOrNull(value: unknown, fallback: number | null) {
  if (value === undefined) return fallback;
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}
function text(value: unknown) {
  return typeof value === "string" ? value : "";
}

export function loadAffinityState(value: unknown): AffinityState {
  const raw = record(value);
  const setup = record(raw.setup);
  const load = record(setup.load);
  const wash = record(setup.wash);
  const elute = record(setup.elute);
  const defaults = defaultAffinitySetup;
  const run = record(raw.run);
  const request = record(raw.request);
  return {
    setup: {
      resinName: text(setup.resinName),
      columnVolumeMl: numberOrNull(setup.columnVolumeMl, defaults.columnVolumeMl),
      dynamicBindingCapacityMgPerMl: numberOrNull(
        setup.dynamicBindingCapacityMgPerMl,
        defaults.dynamicBindingCapacityMgPerMl,
      ),
      proteinMassMg: numberOrNull(setup.proteinMassMg, defaults.proteinMassMg),
      load: { volumeMl: numberOrNull(load.volumeMl, null), buffer: text(load.buffer) },
      wash: { volumeMl: numberOrNull(wash.volumeMl, null), buffer: text(wash.buffer) },
      elute: {
        volumeMl: numberOrNull(elute.volumeMl, null),
        buffer: text(elute.buffer),
        peakPositionFraction: numberOrNull(elute.peakPositionFraction, defaults.elute.peakPositionFraction),
        peakWidthFraction: numberOrNull(elute.peakWidthFraction, defaults.elute.peakWidthFraction),
        recoveryFraction: numberOrNull(elute.recoveryFraction, defaults.elute.recoveryFraction),
      },
    },
    traceId: text(raw.traceId),
    // The stored run is the engine's object; it is kept verbatim, not rebuilt
    // field by field, so nothing it reported is lost on reopen.
    request: request.method === "affinity" ? (request as unknown as AffinityRunRequest) : null,
    run:
      run.method === "affinity" && Array.isArray(run.points) && Array.isArray(run.phases)
        ? (run as unknown as AffinityRunResult)
        : null,
  };
}

export type AffinityOverlay = {
  traceId: string;
  // Every distinct phase edge, in mL, from the engine's phase records.
  boundaries: number[];
  phases: { type: AffinityPhaseType; start: number; end: number; label: string; buffer: string }[];
  peaks: { id: string; kind: AffinityPeak["kind"]; start: number; end: number; apexX: number; label: string }[];
};

const phaseNames: Record<AffinityPhaseType, string> = { load: "Load", wash: "Wash", elute: "Elute" };

function formatNumber(value: number) {
  return Number.isInteger(value) ? String(value) : value.toPrecision(4).replace(/\.?0+$/, "");
}

/**
 * Where the engine put each phase and peak, for drawing over the run's trace.
 * Breakthrough and elution stay separate marks with their own masses, so an
 * overloaded column reads as flow-through in the load phase, never as a
 * taller elution peak.
 */
export function affinityOverlay(run: AffinityRunResult, traceId: string): AffinityOverlay {
  const x = run.units.x ?? "mL";
  const mass = run.units.mass ?? "mg";
  const boundaries = Array.from(
    new Set(run.phases.flatMap((phase) => [phase.startVolumeMl, phase.endVolumeMl])),
  ).sort((a, b) => a - b);
  return {
    traceId,
    boundaries,
    phases: run.phases.map((phase) => ({
      type: phase.type,
      start: phase.startVolumeMl,
      end: phase.endVolumeMl,
      label: `${phaseNames[phase.type]} · ${formatNumber(phase.volumeMl)} ${x}`,
      buffer: phase.buffer,
    })),
    peaks: run.peaks.map((peak) => ({
      id: peak.id,
      kind: peak.kind,
      start: peak.start,
      end: peak.end,
      apexX: peak.apexX,
      label: `${peak.kind === "breakthrough" ? "Breakthrough" : "Elution"} · ${formatNumber(peak.massMg)} ${mass}`,
    })),
  };
}
