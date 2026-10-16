// Run with `npm test`. The fixtures are real engine responses from
// protein_labs.chromatography.create_chromatography_run for the known answers
// in HOM-44 (2 mL x 10 mg/mL resin; load 10 mL, wash 5 mL, elute 10 mL at peak
// fraction 0.25 and 80 % recovery; 4 samples per mL to keep them small).
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { test } from "node:test";
import type { AffinityRunRequest, AffinityRunResult, AffinitySetup, AffinityState } from "./affinity-run.ts";
import {
  affinityOverlay,
  buildAffinityRequest,
  emptyAffinityState,
  loadAffinityState,
  loadMethod,
} from "./affinity-run.ts";

type Fixture = { request: AffinityRunRequest; response: AffinityRunResult };
const fixture = (mg: number): Fixture =>
  JSON.parse(readFileSync(new URL(`./fixtures/affinity-run-${mg}mg.json`, import.meta.url), "utf8"));

const setup = (proteinMassMg: number): AffinitySetup => ({
  resinName: "Ni Sepharose 6 FF",
  columnVolumeMl: 2,
  dynamicBindingCapacityMgPerMl: 10,
  proteinMassMg,
  load: { volumeMl: 10, buffer: "20 mM phosphate, pH 7.4" },
  wash: { volumeMl: 5, buffer: "20 mM phosphate, 20 mM imidazole" },
  elute: {
    volumeMl: 10,
    buffer: "20 mM phosphate, 300 mM imidazole",
    peakPositionFraction: 0.25,
    peakWidthFraction: 0.1,
    recoveryFraction: 0.8,
  },
});
const fractions = [{ id: "E1", name: "E1", start: 16, end: 20 }];

test("the studio sends the documented affinity request", () => {
  const { request, skipped } = buildAffinityRequest(setup(15), fractions);
  // The fixture asks for coarser sampling; the studio keeps the engine default.
  const documented: Partial<AffinityRunRequest & { sampling: unknown }> = { ...fixture(15).request };
  delete documented.sampling;
  assert.deepEqual(request, documented);
  assert.deepEqual(skipped, []);
});

test("fractions outside the run are named, not sent", () => {
  const { request, skipped } = buildAffinityRequest(setup(15), [
    ...fractions,
    { id: "late", name: "Fraction 2", start: 24, end: 30 },
  ]);
  assert.deepEqual(request.fractions.map((value) => value.id), ["E1"]);
  assert.deepEqual(skipped, ["Fraction 2"]);
});

test("a blank field reaches the engine as null for it to reject", () => {
  const { request } = buildAffinityRequest({ ...setup(15), columnVolumeMl: null }, []);
  assert.equal(request.column.columnVolumeMl, null);
});

test("known answers are drawn from the engine's run", () => {
  const run = fixture(15).response;
  assert.equal(run.massBalance.capacityMg, 20);
  assert.equal(run.massBalance.breakthroughMg, 0);
  assert.equal(run.massBalance.elutedMg, 12);
  assert.equal(run.massBalance.retainedMg, 3);
  assert.equal(run.massBalance.accountedMg, 15);
  assert.equal(run.massBalance.closes, true);
  const overlay = affinityOverlay(run, "trace-1");
  assert.deepEqual(overlay.boundaries, [0, 10, 15, 25]);
  assert.deepEqual(
    overlay.phases.map((phase) => [phase.label, phase.buffer]),
    [
      ["Load · 10 mL", "20 mM phosphate, pH 7.4"],
      ["Wash · 5 mL", "20 mM phosphate, 20 mM imidazole"],
      ["Elute · 10 mL", "20 mM phosphate, 300 mM imidazole"],
    ],
  );
  assert.deepEqual(
    overlay.peaks.map((peak) => [peak.kind, peak.apexX, peak.label]),
    [["elution", 17.5, "Elution · 12 mg"]],
  );
});

test("overload plots as breakthrough in the load phase, never a taller elution peak", () => {
  const atCapacity = fixture(20).response;
  const overloaded = fixture(25).response;
  const overlay = affinityOverlay(overloaded, "trace-1");
  const load = overlay.phases.find((phase) => phase.type === "load")!;
  const elute = overlay.phases.find((phase) => phase.type === "elute")!;
  const breakthrough = overlay.peaks.find((peak) => peak.kind === "breakthrough")!;
  const elution = overlay.peaks.find((peak) => peak.kind === "elution")!;
  assert.equal(overlay.peaks.length, 2);
  assert.equal(breakthrough.label, "Breakthrough · 5 mg");
  assert.ok(load.start <= breakthrough.start && breakthrough.end <= load.end);
  assert.ok(load.start <= breakthrough.apexX && breakthrough.apexX <= load.end);
  assert.ok(elute.start <= elution.start && elution.end <= elute.end);
  assert.equal(elution.label, "Elution · 16 mg");
  // The extra 5 mg changes nothing in the elute phase: same mass, same height,
  // same samples as a column loaded exactly to capacity.
  const elutionPeak = (run: AffinityRunResult) => run.peaks.find((peak) => peak.kind === "elution")!;
  assert.equal(elutionPeak(overloaded).massMg, elutionPeak(atCapacity).massMg);
  assert.equal(elutionPeak(overloaded).height, elutionPeak(atCapacity).height);
  const eluteSamples = (run: AffinityRunResult) =>
    run.points.filter((point) => point.x >= elute.start && point.x <= elute.end);
  assert.deepEqual(eluteSamples(overloaded), eluteSamples(atCapacity));
  // And the flow-through signal really is in the load phase of the trace.
  const loadSignal = overloaded.points.filter((point) => point.x < load.end && point.y > 0);
  assert.ok(loadSignal.length > 0);
  assert.ok(loadSignal.every((point) => point.x >= breakthrough.start));
});

test("an affinity project saves and reopens without loss", () => {
  const { request } = buildAffinityRequest(setup(25), fractions);
  const state: AffinityState = { setup: setup(25), traceId: "trace-1", request, run: fixture(25).response };
  const config = { schemaVersion: 13, method: "affinity", affinity: state, projectName: "His-tag capture" };
  const reopened = JSON.parse(JSON.stringify(config));
  assert.equal(loadMethod(reopened.method), "affinity");
  const restored = loadAffinityState(reopened.affinity);
  assert.deepEqual(restored, state);
  // Unchanged inputs rebuild the stored request exactly, so reopening shows
  // the saved run instead of asking the engine again.
  assert.equal(
    JSON.stringify(buildAffinityRequest(restored.setup, fractions).request),
    JSON.stringify(restored.request),
  );
});

test("an existing SEC project opens as SEC with no affinity run", () => {
  const legacy = JSON.parse(JSON.stringify({ schemaVersion: 12, projectName: "Superdex run", traces: [], vo: 8, vt: 24 }));
  assert.equal(loadMethod(legacy.method), "sec");
  assert.deepEqual(loadAffinityState(legacy.affinity), emptyAffinityState);
});
