// HSQC job: reading the engine prediction, turning it into peaks on a
// structure, and the geometry behind the contour map. Run with `npm run test`.
//
// Both engine responses are real `predict_hsqc` output (NMR_API.md) for the
// sequence MKPWNGS with positions 6–7 disordered and 2 next to a ligand: the
// first with no predictor installed, the second with a stub UCBShift command
// that prints known shifts, so the structure-aware path is exercised too.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { JsonObject } from "./protein-labs-api.ts";
import type { MappedResidue, StructureDetail, StructureRegion } from "./structure-regions.ts";
import { citations } from "./citations.ts";
import {
  axisTicks, contourLevels, contourSegments, DEFAULT_VIEW, hsqcConfig, hsqcInputs, hsqcPeaks, intensityGrid, lineShape, numberingMatchesConstruct, placeLabels,
  positionAt, PREDICTOR_CITATIONS, readHsqcPrediction, residuesAt, revealPoint, viewBounds, zoomView,
} from "./hsqc.ts";
import { definitionFor, workflowJobs, workflowSections } from "./workflow.ts";

const randomCoil: JsonObject = {"predictionStatus": "limited_random_coil_only", "predictor": {"id": "random_coil", "label": "Random-coil fallback", "reference": "Wishart et al., J Biomol NMR (1995), doi:10.1007/BF00172291", "publishedExpectedRmsePpm": {"H": null, "N": null}}, "residues": [{"sequencePosition": 1, "residue": "M", "hShiftPpm": 8.2, "nShiftPpm": 120.0, "hasHnPeak": true, "flags": {"prolineNoHnPeak": false, "disordered": false, "ligandAdjacent": false, "collapsedAmideRegion": false, "structurePredictionUnavailable": true}}, {"sequencePosition": 2, "residue": "K", "hShiftPpm": 8.2, "nShiftPpm": 120.0, "hasHnPeak": true, "flags": {"prolineNoHnPeak": false, "disordered": false, "ligandAdjacent": true, "collapsedAmideRegion": false, "structurePredictionUnavailable": true}}, {"sequencePosition": 3, "residue": "P", "hShiftPpm": null, "nShiftPpm": null, "hasHnPeak": false, "flags": {"prolineNoHnPeak": true, "disordered": false, "ligandAdjacent": false, "collapsedAmideRegion": false, "structurePredictionUnavailable": true}}, {"sequencePosition": 4, "residue": "W", "hShiftPpm": 8.2, "nShiftPpm": 120.0, "hasHnPeak": true, "flags": {"prolineNoHnPeak": false, "disordered": false, "ligandAdjacent": false, "collapsedAmideRegion": false, "structurePredictionUnavailable": true}}, {"sequencePosition": 5, "residue": "N", "hShiftPpm": 8.2, "nShiftPpm": 120.0, "hasHnPeak": true, "flags": {"prolineNoHnPeak": false, "disordered": false, "ligandAdjacent": false, "collapsedAmideRegion": false, "structurePredictionUnavailable": true}}, {"sequencePosition": 6, "residue": "G", "hShiftPpm": 8.32, "nShiftPpm": 109.8, "hasHnPeak": true, "flags": {"prolineNoHnPeak": false, "disordered": true, "ligandAdjacent": false, "collapsedAmideRegion": true, "structurePredictionUnavailable": false}}, {"sequencePosition": 7, "residue": "S", "hShiftPpm": 8.26, "nShiftPpm": 115.7, "hasHnPeak": true, "flags": {"prolineNoHnPeak": false, "disordered": true, "ligandAdjacent": false, "collapsedAmideRegion": true, "structurePredictionUnavailable": false}}], "sideChainPeaks": [], "warnings": ["No configured structure-aware predictor was available; folded residues are shown only as a random-coil guide, not a structural assignment prediction."], "method": {"deterministic": true, "determinismScope": "Built-in random-coil fallback is deterministic.", "disorderTreatment": "Random-coil shifts are used for supplied disordered positions.", "ligandContactTreatment": "Supplied ligand-adjacent positions are flagged; their shifts are not corrected."}};

const structureAware: JsonObject = {"predictionStatus": "structure_aware", "predictor": {"id": "ucbshift2", "label": "UCBShift 2.0", "reference": "Ptaszek et al., JACS (2024), doi:10.1021/jacs.4c10474", "publishedExpectedRmsePpm": {"H": 0.31, "N": 1.81}}, "residues": [{"sequencePosition": 1, "residue": "M", "hShiftPpm": 8.45, "nShiftPpm": 123.1, "hasHnPeak": true, "flags": {"prolineNoHnPeak": false, "disordered": false, "ligandAdjacent": false, "collapsedAmideRegion": false, "structurePredictionUnavailable": false}}, {"sequencePosition": 2, "residue": "K", "hShiftPpm": 9.12, "nShiftPpm": 128.4, "hasHnPeak": true, "flags": {"prolineNoHnPeak": false, "disordered": false, "ligandAdjacent": true, "collapsedAmideRegion": false, "structurePredictionUnavailable": false}}, {"sequencePosition": 3, "residue": "P", "hShiftPpm": null, "nShiftPpm": null, "hasHnPeak": false, "flags": {"prolineNoHnPeak": true, "disordered": false, "ligandAdjacent": false, "collapsedAmideRegion": false, "structurePredictionUnavailable": false}}, {"sequencePosition": 4, "residue": "W", "hShiftPpm": 7.31, "nShiftPpm": 115.2, "hasHnPeak": true, "flags": {"prolineNoHnPeak": false, "disordered": false, "ligandAdjacent": false, "collapsedAmideRegion": false, "structurePredictionUnavailable": false}}, {"sequencePosition": 5, "residue": "N", "hShiftPpm": 8.77, "nShiftPpm": 117.9, "hasHnPeak": true, "flags": {"prolineNoHnPeak": false, "disordered": false, "ligandAdjacent": false, "collapsedAmideRegion": false, "structurePredictionUnavailable": false}}, {"sequencePosition": 6, "residue": "G", "hShiftPpm": 8.32, "nShiftPpm": 109.8, "hasHnPeak": true, "flags": {"prolineNoHnPeak": false, "disordered": true, "ligandAdjacent": false, "collapsedAmideRegion": true, "structurePredictionUnavailable": false}}, {"sequencePosition": 7, "residue": "S", "hShiftPpm": 8.26, "nShiftPpm": 115.7, "hasHnPeak": true, "flags": {"prolineNoHnPeak": false, "disordered": true, "ligandAdjacent": false, "collapsedAmideRegion": true, "structurePredictionUnavailable": false}}], "sideChainPeaks": [{"sequencePosition": 4, "atomType": "NE1", "chemicalShiftPpm": 129.6}, {"sequencePosition": 4, "atomType": "HE1", "chemicalShiftPpm": 10.12}, {"sequencePosition": 5, "atomType": "ND2", "chemicalShiftPpm": 112.6}, {"sequencePosition": 5, "atomType": "HD21", "chemicalShiftPpm": 7.58}, {"sequencePosition": 5, "atomType": "HD22", "chemicalShiftPpm": 6.88}], "warnings": ["External predictor command output is not asserted reproducible by this adapter; rerun before using it as a quantitative reference."], "method": {"deterministic": false, "determinismScope": "External command determinism is unknown; command version, model weights, and seed are not controlled by this adapter.", "disorderTreatment": "Random-coil shifts are used for supplied disordered positions.", "ligandContactTreatment": "Supplied ligand-adjacent positions are flagged; their shifts are not corrected."}};

const row = (constructPosition: number, labelChainId: string, labelSeqId: number | null, authSeqId: string | null, extra: Partial<MappedResidue> = {}): MappedResidue =>
  ({ constructPosition, uniprotPosition: constructPosition, chainId: labelChainId, labelChainId, labelSeqId, authSeqId, insertionCode: null, modeled: labelSeqId !== null, ...extra });

const region = (id: string, type: string, positions: number[], metadata: Record<string, unknown> = {}): StructureRegion =>
  ({ id, type, label: id, description: "", defaultVisible: false, residues: positions.map((position) => row(position, "A", position, String(position))), metadata });

describe("reading the engine prediction", () => {
  it("keeps the fallback honest: random-coil predictor, no error, every flag the engine set", () => {
    const prediction = readHsqcPrediction(randomCoil);
    assert.equal(prediction.status, "limited_random_coil_only");
    assert.deepEqual(prediction.predictor.rmse, { h: null, n: null });
    assert.equal(prediction.predictor.id, "random_coil");
    assert.equal(prediction.residues[2].hasHnPeak, false);
    assert.equal(prediction.residues[1].flags.ligandAdjacent, true);
    assert.equal(prediction.residues[5].flags.collapsedAmideRegion, true);
    assert.equal(prediction.method.deterministic, true);
    assert.match(prediction.warnings[0], /random-coil guide/);
  });

  it("reads the published error and side-chain shifts of a structure-aware run", () => {
    const prediction = readHsqcPrediction(structureAware);
    assert.equal(prediction.status, "structure_aware");
    assert.deepEqual(prediction.predictor.rmse, { h: 0.31, n: 1.81 });
    assert.equal(prediction.sideChains.length, 5);
    assert.equal(prediction.method.deterministic, false);
  });

  it("cites every predictor the engine can name", () => {
    for (const id of ["ucbshift2", "legolas", "shiftx2", "random_coil"]) assert.ok(citations[PREDICTOR_CITATIONS[id]], id);
  });
});

describe("peaks", () => {
  it("gives one backbone peak per non-proline residue and says why proline has none", () => {
    const { peaks, noPeak } = hsqcPeaks(readHsqcPrediction(randomCoil));
    assert.deepEqual(peaks.map((peak) => peak.label), ["M1", "K2", "W4", "N5", "G6", "S7"]);
    assert.deepEqual(noPeak, [{ position: 3, residue: "P", reason: "proline" }]);
    assert.equal(peaks.find((peak) => peak.label === "K2")?.ligandAdjacent, true);
    assert.equal(peaks.find((peak) => peak.label === "G6")?.disordered, true);
  });

  it("keeps one side-chain peak per atom when the engine repeats rows for each chain", () => {
    const body = structuredClone(structureAware);
    body.sideChainPeaks = [...(body.sideChainPeaks as JsonObject[]), { sequencePosition: 4, atomType: "NE1", chemicalShiftPpm: 131 }, { sequencePosition: 4, atomType: "HE1", chemicalShiftPpm: 10.5 }];
    const side = hsqcPeaks(readHsqcPrediction(body)).peaks.filter((peak) => peak.kind === "sidechain");
    assert.equal(new Set(side.map((peak) => peak.id)).size, side.length);
    assert.deepEqual(side.filter((peak) => peak.label === "W4ε1").map((peak) => [peak.h, peak.n]), [[10.12, 129.6]]);
  });

  it("pairs side-chain N and H into Trp indole and Asn amide peaks", () => {
    const { peaks } = hsqcPeaks(readHsqcPrediction(structureAware));
    const side = peaks.filter((peak) => peak.kind === "sidechain").map((peak) => [peak.label, peak.h, peak.n]);
    assert.deepEqual(side, [["W4ε1", 10.12, 129.6], ["N5δ21", 7.58, 112.6], ["N5δ22", 6.88, 112.6]]);
  });
});

describe("request inputs", () => {
  const regions = [region("dis", "disorder_low_plddt", [6, 7]), region("zn", "ligand_binding_site", [2], { classification: "metal" }), region("gol", "ligand_binding_site", [4], { classification: "common_additive" }), region("cys", "cysteines", [1])];
  const detail = (mapping: MappedResidue[]): StructureDetail => ({ structureText: "data_x", format: "cif", mapping: { residues: mapping } });

  it("sends the engine's disorder and binding-site positions, leaving out additives", () => {
    const inputs = hsqcInputs("MKPWNGS", null, regions);
    assert.deepEqual(inputs.disordered, [6, 7]);
    assert.deepEqual(inputs.ligandAdjacent, [2]);
    assert.equal(inputs.request.structureText, undefined);
    assert.deepEqual(inputs.structure, { sent: false, reason: "none" });
  });

  it("sends the coordinates only when the file numbers residues as the construct does", () => {
    const same = hsqcInputs("MKPWNGS", detail([1, 2, 3].map((position) => row(position, "A", position, String(position)))), []);
    assert.equal(same.request.structureText, "data_x");
    assert.deepEqual(same.structure, { sent: true });
    const shifted = hsqcInputs("MKPWNGS", detail([1, 2, 3].map((position) => row(position, "A", position, String(position + 20)))), []);
    assert.equal(shifted.request.structureText, undefined);
    assert.deepEqual(shifted.structure, { sent: false, reason: "numbering" });
    assert.equal(numberingMatchesConstruct([], 7), false);
  });

  it("refuses a complex whose partner chain reuses construct numbers, since the engine keys shifts by number alone", () => {
    const construct = [1, 2, 3].map((position) => row(position, "A", position, String(position)));
    const partner = (auth: string): MappedResidue => ({ ...row(0, "B", 1, auth), constructPosition: null, uniprotPosition: null });
    assert.equal(numberingMatchesConstruct([...construct, partner("2")], 3), false);
    assert.equal(numberingMatchesConstruct([...construct, partner("201")], 3), true);
    assert.equal(numberingMatchesConstruct([...construct, { ...partner("2"), modeled: false }], 3), true);
    // A second copy of the construct (homo-dimer) numbers the same and is fine.
    assert.equal(numberingMatchesConstruct([...construct, ...[1, 2, 3].map((position) => row(position, "B", position, String(position)))], 3), true);
    const complex = hsqcInputs("MKP", detail([...construct, partner("1")]), []);
    assert.deepEqual(complex.structure, { sent: false, reason: "numbering" });
  });
});

describe("linking peaks and residues", () => {
  const mapping = [row(1, "A", 1, "1"), row(2, "A", 2, "2"), row(2, "B", 2, "2"), row(3, "A", null, null, { modeled: false }), row(4, "C", 9, "9")];

  it("finds every modelled copy of a position and none for a gap", () => {
    assert.deepEqual(residuesAt(mapping, 2), [{ labelAsymId: "A", labelSeqId: 2 }, { labelAsymId: "B", labelSeqId: 2 }]);
    assert.deepEqual(residuesAt(mapping, 3), []);
    assert.deepEqual(residuesAt(undefined, 1), []);
  });

  it("maps a clicked residue back to its construct position", () => {
    assert.equal(positionAt(mapping, { labelAsymId: "C", labelSeqId: 9 }), 4);
    assert.equal(positionAt(mapping, { labelAsymId: "C", labelSeqId: 10 }), null);
  });
});

describe("line shapes and contours", () => {
  it("draws disordered peaks sharper and taller with the same volume", () => {
    const folded = lineShape({ disordered: false }), flexible = lineShape({ disordered: true });
    assert.ok(flexible.sigmaH < folded.sigmaH && flexible.sigmaN < folded.sigmaN);
    assert.equal(folded.height, 1);
    assert.ok(Math.abs(flexible.height * flexible.sigmaH * flexible.sigmaN - folded.height * folded.sigmaH * folded.sigmaN) < 1e-12);
  });

  it("puts the grid maximum at the peak and closes a contour ring around it", () => {
    const view = { h: [8, 8.4] as [number, number], n: [118, 122] as [number, number] };
    const grid = intensityGrid([{ h: 8.2, n: 120, disordered: false }], view, 81, 81);
    const peakIndex = grid.values.indexOf(grid.max);
    assert.deepEqual([peakIndex % 81, Math.floor(peakIndex / 81)], [40, 40]);
    assert.ok(Math.abs(grid.max - 1) < 1e-6);
    const segments = contourSegments(grid, 0.5);
    assert.ok(segments.length > 0 && segments.length % 4 === 0);
    // Every crossing at half height lies about one half-width from the centre.
    for (let index = 0; index < segments.length; index += 2) {
      const dh = ((segments[index] - 40) / 80) * 0.4, dn = ((segments[index + 1] - 40) / 80) * 4;
      const shape = lineShape({ disordered: false });
      const radius = Math.sqrt((dh / shape.sigmaH) ** 2 + (dn / shape.sigmaN) ** 2);
      assert.ok(Math.abs(radius - Math.sqrt(2 * Math.log(2))) < 0.25, String(radius));
    }
  });

  it("spaces contour levels geometrically, Sparky-style", () => {
    const levels = contourLevels(4, 0.1, 2);
    assert.deepEqual(levels.map((value) => Number(value.toFixed(6))), [0.1, 0.2, 0.4, 0.8]);
  });
});

describe("view window", () => {
  const bounds = viewBounds([{ h: 10.12, n: 129.6 }, { h: 6.88, n: 99 }]);

  it("opens on the conventional window and widens only to hold peaks outside it", () => {
    assert.deepEqual(DEFAULT_VIEW, { h: [6, 11], n: [100, 135] });
    assert.deepEqual(bounds.h, [6, 11]);
    assert.deepEqual(bounds.n, [97, 135]);
  });

  it("zooms about the pointer and refuses to zoom past the limits", () => {
    const zoomed = zoomView(DEFAULT_VIEW, 0.5, { h: 8, n: 120 }, bounds);
    assert.deepEqual(zoomed, { h: [7, 9.5], n: [110, 127.5] });
    const out = zoomView(DEFAULT_VIEW, 4, { h: 8, n: 120 }, bounds);
    assert.deepEqual(out, bounds);
  });

  it("moves the window to a peak only when it is off screen", () => {
    const view = { h: [7, 8] as [number, number], n: [110, 120] as [number, number] };
    assert.equal(revealPoint(view, { h: 7.5, n: 115 }, bounds), view);
    assert.deepEqual(revealPoint(view, { h: 9.5, n: 125 }, bounds), { h: [9, 10], n: [120, 130] });
  });

  it("ticks fall on round numbers", () => {
    assert.deepEqual(axisTicks([6, 11], 5), [6, 7, 8, 9, 10, 11]);
    assert.deepEqual(axisTicks([100, 135], 7), [100, 105, 110, 115, 120, 125, 130, 135]);
  });
});

describe("labels and saving", () => {
  it("skips labels that would overlap one already placed, keeping the first", () => {
    const shown = placeLabels([{ id: "a", x: 0, y: 0, width: 20, height: 10 }, { id: "b", x: 10, y: 5, width: 20, height: 10 }, { id: "c", x: 40, y: 0, width: 20, height: 10 }]);
    assert.deepEqual([...shown], ["a", "c"]);
  });

  it("saves what ran and the peak list, under the key the workflow checks", () => {
    const prediction = readHsqcPrediction(structureAware);
    const { peaks } = hsqcPeaks(prediction);
    const config = hsqcConfig(prediction, peaks, { source: "alphafold_db", id: "AF-P00918-F1" }, "2026-10-31T12:00:00.000Z");
    assert.equal(config.peakCount, 6);
    assert.equal((config.peaks as JsonObject[]).length, 9);
    assert.deepEqual(config.predictor, { id: "ucbshift2", label: "UCBShift 2.0", rmseH: 0.31, rmseN: 1.81 });
    const job = definitionFor("hsqc");
    assert.equal(job?.appType, "hsqc-prediction");
    assert.ok(config[job!.requiredKey!]);
    assert.ok(workflowSections.some((section) => section.id === job?.stage));
    assert.equal(workflowJobs.filter((item) => item.appType === "hsqc-prediction").length, 1);
  });
});
