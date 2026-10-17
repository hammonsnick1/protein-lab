// Tests for the vector editor's request ordering, undo history and response guards.
// Run with `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { PRIMER_ENGINE_TOO_OLD, commit, createRequestGate, readDesignedPrimers, redoStep, undoStep, valueFor } from "./vector-editor-state.ts";

describe("request gate", () => {
  it("ignores a slow response that resolves after a newer request", async () => {
    const gate = createRequestGate();
    let shown: string | null = null;
    const request = (label: string, delay: number) => {
      const token = gate.begin();
      return new Promise<void>((resolve) => setTimeout(() => { if (gate.isCurrent(token)) shown = label; resolve(); }, delay));
    };
    // Vector A is slow; the user switches to vector B, which answers first.
    const a = request("rows for A", 30);
    const b = request("rows for B", 5);
    await Promise.all([a, b]);
    assert.equal(shown, "rows for B");
  });

  it("can cancel the in-flight request outright", () => {
    const gate = createRequestGate();
    const token = gate.begin();
    gate.cancel();
    assert.equal(gate.isCurrent(token), false);
  });

  it("refuses results tagged for a different vector", () => {
    const rows = { key: "vector-a", value: ["EcoRI"] };
    assert.deepEqual(valueFor(rows, "vector-a"), ["EcoRI"]);
    assert.equal(valueFor(rows, "vector-b"), null);
  });
});

describe("undo history", () => {
  it("undoes a server commit back to the construct before it", () => {
    let history = { undo: [] as string[], redo: [] as string[], current: "backbone" };
    history = commit(history, "backbone + insert");
    history = undoStep(history);
    assert.equal(history.current, "backbone");
    history = redoStep(history);
    assert.equal(history.current, "backbone + insert");
  });

  it("does nothing when there is nothing to undo", () => {
    const history = { undo: [] as string[], redo: [] as string[], current: "only" };
    assert.equal(undoStep(history), history);
    assert.equal(redoStep(history), history);
  });

  it("clears redo when a new change is made", () => {
    let history = { undo: [] as string[], redo: [] as string[], current: "a" };
    history = undoStep(commit(history, "b"));
    history = commit(history, "c");
    assert.deepEqual(history.redo, []);
    assert.deepEqual(history.undo, ["a"]);
  });
});

describe("primer response guard", () => {
  const screen = { risk: "low", longestComplementaryRun: 3, threePrimeComplementarity: 1, limitation: "" };
  const designed = { id: "f", name: "PCR forward", sequence: "ACGT", annealingSequence: "ACGT", overhang: "", start: 0, end: 4, strand: 1, totalLength: 4, gcPercent: 50, tmCelsius: 60.1, tmDeltaCelsius: 0.1, tmMethod: "NN", withinGcLimits: true, hairpin: screen, selfDimer: screen, heteroDimer: screen };

  it("reports an older engine's successful legacy response as incompatible", () => {
    // The pre-HOM-49 engine saves primers and returns the vector, with no designedPrimers.
    const legacy = { id: "v1", name: "pUC19", primers: [{ id: "p1", name: "Insert PCR forward", sequence: "ACGT", start: 0, end: 4, strand: 1, tmCelsius: 52, gcPercent: 50 }] };
    assert.deepEqual(readDesignedPrimers(legacy), { primers: [], error: PRIMER_ENGINE_TOO_OLD });
  });

  it("rejects a partial primer rather than rendering missing fields", () => {
    const partial = { designedPrimers: [{ ...designed, tmDeltaCelsius: undefined, hairpin: undefined }] };
    assert.equal(readDesignedPrimers(partial).error, PRIMER_ENGINE_TOO_OLD);
  });

  it("accepts the HOM-49 primer shape", () => {
    const result = readDesignedPrimers({ designedPrimers: [designed, { ...designed, id: "r", strand: -1 }] });
    assert.equal(result.error, "");
    assert.equal(result.primers.length, 2);
    assert.equal(result.primers[0].tmDeltaCelsius, 0.1);
  });
});
