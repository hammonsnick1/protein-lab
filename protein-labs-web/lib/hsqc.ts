// Predict the ¹H–¹⁵N HSQC spectrum: the engine's per-residue shift prediction
// read into typed values, turned into peaks on a structure, and drawn as a
// Sparky-style contour map.
//
// The engine contract is `protein-labs/backend/NMR_API.md`. The engine picks
// the predictor and says when only its random-coil fallback ran; nothing here
// invents a shift. Residue numbering on the structure comes from the engine's
// residue mapping (`StructureDetail.mapping`), never from guessing, and the
// disorder and ligand-contact positions sent with the request come from the
// engine's structure regions.
//
// The contour map is a picture of the predicted peak positions. Each peak is a
// 2D Gaussian with a typical linewidth; the linewidths are illustrative, not
// predicted, and the screen says so.
//
// Only erasable TypeScript syntax is used, so the unit tests run under Node
// without a bundler.
import type { JsonObject } from "./protein-labs-api.ts";
import type { CitationId } from "./citations.ts";
import { isAdditive, type MappedResidue, type ResidueAddress, type StructureDetail, type StructureRegion } from "./structure-regions.ts";

export const HSQC_APP_TYPE = "hsqc-prediction";

// ── Engine prediction ───────────────────────────────────────────────────────

export type HsqcFlags = {
  prolineNoHnPeak: boolean;
  disordered: boolean;
  ligandAdjacent: boolean;
  /** Disordered residue whose amide sits in the crowded 7.8–8.5 ppm ¹H band. */
  collapsedAmideRegion: boolean;
  /** Folded residue shown at its random-coil value because no structure-aware predictor ran. */
  structurePredictionUnavailable: boolean;
};

export type HsqcResidue = {
  /** 1-based position on the saved construct sequence. */
  position: number;
  residue: string;
  h: number | null;
  n: number | null;
  hasHnPeak: boolean;
  flags: HsqcFlags;
};

export type SideChainShift = { position: number; atom: string; shift: number };

export type HsqcPredictor = {
  id: string;
  label: string;
  reference: string;
  /** Published backbone RMSE against experiment, ppm; null when the authors give none. */
  rmse: { h: number | null; n: number | null };
};

export type HsqcPrediction = {
  status: "structure_aware" | "limited_random_coil_only";
  predictor: HsqcPredictor;
  residues: HsqcResidue[];
  sideChains: SideChainShift[];
  warnings: string[];
  method: { deterministic: boolean; determinismScope: string; disorderTreatment: string; ligandContactTreatment: string };
};

/** Where each predictor the engine can name is cited in the app. */
export const PREDICTOR_CITATIONS: Record<string, CitationId> = {
  ucbshift2: "ucbshift2",
  legolas: "legolas2025",
  shiftx2: "shiftx2",
  random_coil: "wishart1995",
};

/** What each predictor is, in one line a student can follow. */
export const PREDICTOR_ROLES: Record<string, string> = {
  ucbshift2: "A machine-learning model that reads the 3D structure around each residue, trained on thousands of assigned spectra.",
  legolas: "A neural network that predicts shifts from the 3D structure, built to be fast enough for whole simulations.",
  shiftx2: "Combines a machine-learned structure model with matches to proteins of similar sequence whose shifts are known.",
  random_coil: "Average shifts of each amino acid in short unfolded peptides. They ignore the 3D fold, so folded residues bunch together.",
};

export function readHsqcPrediction(body: JsonObject): HsqcPrediction {
  const predictor = asObject(body.predictor);
  const rmse = asObject(predictor.publishedExpectedRmsePpm);
  const method = asObject(body.method);
  return {
    status: body.predictionStatus === "structure_aware" ? "structure_aware" : "limited_random_coil_only",
    predictor: { id: text(predictor.id) || "random_coil", label: text(predictor.label) || "Random-coil fallback", reference: text(predictor.reference), rmse: { h: positive(rmse.H), n: positive(rmse.N) } },
    residues: asObjects(body.residues).flatMap((row) => {
      const position = integer(row.sequencePosition);
      if (position === null) return [];
      const flags = asObject(row.flags);
      return [{
        position, residue: text(row.residue).toUpperCase(), h: finite(row.hShiftPpm), n: finite(row.nShiftPpm), hasHnPeak: row.hasHnPeak !== false,
        flags: { prolineNoHnPeak: flags.prolineNoHnPeak === true, disordered: flags.disordered === true, ligandAdjacent: flags.ligandAdjacent === true, collapsedAmideRegion: flags.collapsedAmideRegion === true, structurePredictionUnavailable: flags.structurePredictionUnavailable === true },
      }];
    }),
    sideChains: asObjects(body.sideChainPeaks).flatMap((row) => {
      const position = integer(row.sequencePosition), shift = finite(row.chemicalShiftPpm);
      return position === null || shift === null ? [] : [{ position, atom: text(row.atomType).toUpperCase(), shift }];
    }),
    warnings: Array.isArray(body.warnings) ? body.warnings.map(String).filter(Boolean) : [],
    method: { deterministic: method.deterministic === true, determinismScope: text(method.determinismScope), disorderTreatment: text(method.disorderTreatment), ligandContactTreatment: text(method.ligandContactTreatment) },
  };
}

// ── Request inputs ──────────────────────────────────────────────────────────

const DISORDER_TYPES = new Set(["disorder_uniprot", "disorder_low_plddt"]);

/** Construct positions the engine's structure regions mark, sorted and unique. */
function regionPositions(regions: StructureRegion[], keep: (region: StructureRegion) => boolean): number[] {
  const positions = new Set<number>();
  for (const region of regions) if (keep(region)) for (const row of region.residues ?? []) if (typeof row.constructPosition === "number") positions.add(row.constructPosition);
  return [...positions].sort((one, other) => one - other);
}

/**
 * True when the structure's author numbering is the construct numbering on
 * every mapped residue, so a predictor's per-residue output (numbered from the
 * file) lands on the right construct position. The engine has no renumbering
 * step for predictor output yet, so any other structure goes as sequence only.
 *
 * The engine also keys predictor output by residue number alone, not by chain.
 * So a modelled residue outside the construct (a partner protein's chain, or a
 * tag) whose author number is also a construct position, 1 to `length`, would
 * overwrite the construct's shift there; such a file is refused too.
 */
export function numberingMatchesConstruct(mapping: MappedResidue[] | undefined, length: number): boolean {
  const modelled = (mapping ?? []).filter((row) => row.authSeqId != null && row.modeled !== false);
  const rows = modelled.filter((row) => typeof row.constructPosition === "number");
  const collides = modelled.some((row) => typeof row.constructPosition !== "number" && /^\d+$/.test(String(row.authSeqId)) && Number(row.authSeqId) >= 1 && Number(row.authSeqId) <= length);
  return rows.length > 0 && !collides && rows.every((row) => String(row.authSeqId) === String(row.constructPosition) && !row.insertionCode);
}

export type HsqcInputs = {
  request: JsonObject;
  disordered: number[];
  ligandAdjacent: number[];
  /** Whether the coordinates were sent, and why not when they were not. */
  structure: { sent: true } | { sent: false; reason: "none" | "numbering" };
};

/** The body for `POST /v1/nmr/hsqc/predict`: the saved sequence, plus what the chosen structure's regions know. */
export function hsqcInputs(sequence: string, detail: StructureDetail | null, regions: StructureRegion[]): HsqcInputs {
  const disordered = regionPositions(regions, (region) => DISORDER_TYPES.has(region.type));
  const ligandAdjacent = regionPositions(regions, (region) => region.type === "ligand_binding_site" && !isAdditive(region));
  const request: JsonObject = { sequence, predictor: "auto", disorderedPositions: disordered, ligandAdjacentPositions: ligandAdjacent };
  if (!detail?.structureText) return { request, disordered, ligandAdjacent, structure: { sent: false, reason: "none" } };
  if (!numberingMatchesConstruct(detail.mapping?.residues, sequence.length)) return { request, disordered, ligandAdjacent, structure: { sent: false, reason: "numbering" } };
  return { request: { ...request, structureText: detail.structureText, structureFormat: detail.format ?? "cif" }, disordered, ligandAdjacent, structure: { sent: true } };
}

// ── Peaks ───────────────────────────────────────────────────────────────────

const THREE_LETTER: Record<string, string> = { A: "Ala", R: "Arg", N: "Asn", D: "Asp", C: "Cys", E: "Glu", Q: "Gln", G: "Gly", H: "His", I: "Ile", L: "Leu", K: "Lys", M: "Met", F: "Phe", P: "Pro", S: "Ser", T: "Thr", W: "Trp", Y: "Tyr", V: "Val" };
export function threeLetter(code: string) { return THREE_LETTER[code] ?? code; }

/** Side-chain NH groups that give HSQC peaks, named the way spectra are labelled. */
const SIDE_CHAIN_NH: Record<string, { residue: string; name: string; hAtoms: string[] }> = {
  NE1: { residue: "W", name: "Nε1–Hε1 (indole)", hAtoms: ["HE1"] },
  ND2: { residue: "N", name: "Nδ2–Hδ2 (amide NH₂)", hAtoms: ["HD21", "HD22"] },
  NE2: { residue: "Q", name: "Nε2–Hε2 (amide NH₂)", hAtoms: ["HE21", "HE22"] },
};
const H_ATOM_SUFFIX: Record<string, string> = { HE1: "ε1", HD21: "δ21", HD22: "δ22", HE21: "ε21", HE22: "ε22" };

export type Peak = {
  /** Stable id: `bb-<position>` for a backbone amide, `sc-<position>-<H atom>` for a side chain. */
  id: string;
  position: number;
  residue: string;
  /** Spectrum label in the usual one-letter style, e.g. "K48" or "W28ε1". */
  label: string;
  h: number;
  n: number;
  kind: "backbone" | "sidechain";
  /** What the peak is, for screen readers and the details panel. */
  description: string;
  disordered: boolean;
  ligandAdjacent: boolean;
  crowded: boolean;
};

export type NoPeak = { position: number; residue: string; reason: "proline" | "no_shift" };

/** Every peak the prediction places, plus each residue that has none and why. */
export function hsqcPeaks(prediction: HsqcPrediction): { peaks: Peak[]; noPeak: NoPeak[] } {
  const peaks: Peak[] = [];
  const noPeak: NoPeak[] = [];
  for (const row of prediction.residues) {
    if (!row.hasHnPeak) { noPeak.push({ position: row.position, residue: row.residue, reason: "proline" }); continue; }
    if (row.h === null || row.n === null) { noPeak.push({ position: row.position, residue: row.residue, reason: "no_shift" }); continue; }
    peaks.push({ id: `bb-${row.position}`, position: row.position, residue: row.residue, label: `${row.residue}${row.position}`, h: row.h, n: row.n, kind: "backbone", description: `${threeLetter(row.residue)} ${row.position} backbone N–H`, disordered: row.flags.disordered, ligandAdjacent: row.flags.ligandAdjacent, crowded: row.flags.collapsedAmideRegion });
  }
  // Side-chain NH: pair each predicted H with the N of the same group. The
  // engine repeats side-chain rows once per chain of a homo-oligomer; keep the first.
  const byResidue = new Map(prediction.residues.map((row) => [row.position, row]));
  const sideChains = [...new Map(prediction.sideChains.map((item) => [`${item.position}:${item.atom}`, item] as const).reverse()).values()].reverse();
  for (const [nAtom, group] of Object.entries(SIDE_CHAIN_NH)) {
    for (const nRow of sideChains.filter((item) => item.atom === nAtom)) {
      const residue = byResidue.get(nRow.position);
      if (residue && residue.residue !== group.residue) continue;
      for (const hRow of sideChains.filter((item) => item.position === nRow.position && group.hAtoms.includes(item.atom))) {
        const suffix = H_ATOM_SUFFIX[hRow.atom];
        peaks.push({ id: `sc-${nRow.position}-${hRow.atom}`, position: nRow.position, residue: group.residue, label: `${group.residue}${nRow.position}${suffix}`, h: hRow.shift, n: nRow.shift, kind: "sidechain", description: `${threeLetter(group.residue)} ${nRow.position} side-chain ${group.name}`, disordered: residue?.flags.disordered ?? false, ligandAdjacent: residue?.flags.ligandAdjacent ?? false, crowded: false });
      }
    }
  }
  return { peaks, noPeak };
}

/** Every modelled copy of one construct position in the structure (one per chain of a homo-oligomer). */
export function residuesAt(mapping: MappedResidue[] | undefined, position: number): ResidueAddress[] {
  const seen = new Set<string>();
  const found: ResidueAddress[] = [];
  for (const row of mapping ?? []) {
    if (row.constructPosition !== position || row.modeled === false || !row.labelChainId || typeof row.labelSeqId !== "number") continue;
    const key = `${row.labelChainId}:${row.labelSeqId}`;
    if (!seen.has(key)) { seen.add(key); found.push({ labelAsymId: row.labelChainId, labelSeqId: row.labelSeqId }); }
  }
  return found;
}

/** The construct position of a residue clicked in 3D, or null when the engine mapped it to none. */
export function positionAt(mapping: MappedResidue[] | undefined, address: ResidueAddress): number | null {
  const row = (mapping ?? []).find((item) => item.labelChainId === address.labelAsymId && item.labelSeqId === address.labelSeqId);
  return typeof row?.constructPosition === "number" ? row.constructPosition : null;
}

// ── Line shapes ─────────────────────────────────────────────────────────────

/** The field the display assumes: a 600 MHz spectrometer, where ¹⁵N resonates at 60.8 MHz. */
export const SPECTROMETER_MHZ = { h: 600, n: 60.8 };

/**
 * Illustrative peak widths at half height, in Hz. Folded residues of a
 * medium-sized protein give lines of roughly 15–30 Hz in ¹H; flexible,
 * disordered residues tumble on their own and give much sharper lines.
 */
export const LINEWIDTH_HZ = { folded: { h: 20, n: 12 }, disordered: { h: 8, n: 5 } };

const FWHM_TO_SIGMA = 1 / (2 * Math.sqrt(2 * Math.log(2)));

export type LineShape = { sigmaH: number; sigmaN: number; height: number };

/** A peak's Gaussian in ppm. Every peak has the same volume (one N–H each), so sharper peaks stand taller. */
export function lineShape(peak: Pick<Peak, "disordered">): LineShape {
  const width = peak.disordered ? LINEWIDTH_HZ.disordered : LINEWIDTH_HZ.folded;
  const sigmaH = (width.h / SPECTROMETER_MHZ.h) * FWHM_TO_SIGMA;
  const sigmaN = (width.n / SPECTROMETER_MHZ.n) * FWHM_TO_SIGMA;
  const folded = LINEWIDTH_HZ.folded;
  return { sigmaH, sigmaN, height: (folded.h * folded.n) / (width.h * width.n) };
}

// ── View window ─────────────────────────────────────────────────────────────

/** ppm ranges; the axes are drawn reversed (high ppm on the left and top), as NMR spectra are. */
export type SpectrumView = { h: [number, number]; n: [number, number] };

export const DEFAULT_VIEW: SpectrumView = { h: [6, 11], n: [100, 135] };
const MIN_SPAN = { h: 0.15, n: 1 };

/** How far the user may pan or zoom out: the default window, widened to hold every peak. */
export function viewBounds(peaks: Pick<Peak, "h" | "n">[]): SpectrumView {
  const hs = peaks.map((peak) => peak.h), ns = peaks.map((peak) => peak.n);
  return {
    h: [Math.min(DEFAULT_VIEW.h[0], ...hs.map((value) => value - 0.3)), Math.max(DEFAULT_VIEW.h[1], ...hs.map((value) => value + 0.3))],
    n: [Math.min(DEFAULT_VIEW.n[0], ...ns.map((value) => value - 2)), Math.max(DEFAULT_VIEW.n[1], ...ns.map((value) => value + 2))],
  };
}

function clampAxis(range: [number, number], bound: [number, number], minSpan: number): [number, number] {
  const span = Math.min(Math.max(range[1] - range[0], minSpan), bound[1] - bound[0]);
  let low = range[0] + (range[1] - range[0] - span) / 2;
  low = Math.min(Math.max(low, bound[0]), bound[1] - span);
  return [low, low + span];
}

export function clampView(view: SpectrumView, bounds: SpectrumView): SpectrumView {
  return { h: clampAxis(view.h, bounds.h, MIN_SPAN.h), n: clampAxis(view.n, bounds.n, MIN_SPAN.n) };
}

/** Zoom by `factor` (<1 zooms in) keeping the point (h, n) where it is on screen. */
export function zoomView(view: SpectrumView, factor: number, at: { h: number; n: number }, bounds: SpectrumView): SpectrumView {
  const scale = (range: [number, number], centre: number): [number, number] => [centre - (centre - range[0]) * factor, centre + (range[1] - centre) * factor];
  return clampView({ h: scale(view.h, at.h), n: scale(view.n, at.n) }, bounds);
}

/** Shift the window by ppm amounts. */
export function panView(view: SpectrumView, dh: number, dn: number, bounds: SpectrumView): SpectrumView {
  return clampView({ h: [view.h[0] + dh, view.h[1] + dh], n: [view.n[0] + dn, view.n[1] + dn] }, bounds);
}

/** The same window, moved so (h, n) is in the middle, unless it is already well inside. */
export function revealPoint(view: SpectrumView, at: { h: number; n: number }, bounds: SpectrumView): SpectrumView {
  const inside = (range: [number, number], value: number) => { const margin = (range[1] - range[0]) * 0.08; return value >= range[0] + margin && value <= range[1] - margin; };
  if (inside(view.h, at.h) && inside(view.n, at.n)) return view;
  const half = (range: [number, number]) => (range[1] - range[0]) / 2;
  return clampView({ h: [at.h - half(view.h), at.h + half(view.h)], n: [at.n - half(view.n), at.n + half(view.n)] }, bounds);
}

/** Round-number tick positions for one axis. */
export function axisTicks(range: [number, number], target = 8): number[] {
  const raw = (range[1] - range[0]) / target;
  const magnitude = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 5, 10].map((value) => value * magnitude).find((value) => value >= raw) ?? 10 * magnitude;
  const ticks: number[] = [];
  for (let value = Math.ceil(range[0] / step) * step; value <= range[1] + step * 1e-9; value += step) ticks.push(Number(value.toFixed(6)));
  return ticks;
}

export function tickDecimals(ticks: number[]) {
  const step = ticks.length > 1 ? ticks[1] - ticks[0] : 1;
  return step >= 1 ? 0 : step >= 0.1 ? 1 : 2;
}

// ── Contours ────────────────────────────────────────────────────────────────

/** A sampled intensity map over the view: `cols × rows` points, column 0 at the left (high ¹H ppm), row 0 at the top (low ¹⁵N ppm). */
export type IntensityGrid = { cols: number; rows: number; values: Float32Array; max: number };

/** Sum every peak's Gaussian over the view. Peaks only touch points within four standard deviations. */
export function intensityGrid(peaks: Pick<Peak, "h" | "n" | "disordered">[], view: SpectrumView, cols: number, rows: number): IntensityGrid {
  const values = new Float32Array(cols * rows);
  const dh = (view.h[1] - view.h[0]) / (cols - 1), dn = (view.n[1] - view.n[0]) / (rows - 1);
  const column = (h: number) => (view.h[1] - h) / dh;
  const row = (n: number) => (n - view.n[0]) / dn;
  let max = 0;
  for (const peak of peaks) {
    const shape = lineShape(peak);
    const reachH = 4 * shape.sigmaH, reachN = 4 * shape.sigmaN;
    const c0 = Math.max(0, Math.floor(column(peak.h + reachH))), c1 = Math.min(cols - 1, Math.ceil(column(peak.h - reachH)));
    const r0 = Math.max(0, Math.floor(row(peak.n - reachN))), r1 = Math.min(rows - 1, Math.ceil(row(peak.n + reachN)));
    for (let r = r0; r <= r1; r++) {
      const n = view.n[0] + r * dn;
      const along = Math.exp(-((n - peak.n) ** 2) / (2 * shape.sigmaN ** 2));
      for (let c = c0; c <= c1; c++) {
        const h = view.h[1] - c * dh;
        const index = r * cols + c;
        values[index] += shape.height * along * Math.exp(-((h - peak.h) ** 2) / (2 * shape.sigmaH ** 2));
        if (values[index] > max) max = values[index];
      }
    }
  }
  return { cols, rows, values, max };
}

/** Sparky-style contour levels: the lowest at a fixed share of one folded peak's height, each next one `factor` higher. */
export function contourLevels(count = 8, lowest = 0.12, factor = 1.4): number[] {
  return Array.from({ length: count }, (_, index) => lowest * factor ** index);
}

/**
 * Marching squares: the line segments where the grid crosses `level`, as
 * flat [x1, y1, x2, y2, …] in grid units (column, row).
 */
export function contourSegments(grid: IntensityGrid, level: number): number[] {
  const { cols, rows, values } = grid;
  const out: number[] = [];
  const at = (c: number, r: number) => values[r * cols + c];
  const lerp = (a: number, b: number) => (level - a) / (b - a);
  for (let r = 0; r < rows - 1; r++) {
    for (let c = 0; c < cols - 1; c++) {
      const tl = at(c, r), tr = at(c + 1, r), br = at(c + 1, r + 1), bl = at(c, r + 1);
      const code = (tl >= level ? 8 : 0) | (tr >= level ? 4 : 0) | (br >= level ? 2 : 0) | (bl >= level ? 1 : 0);
      if (code === 0 || code === 15) continue;
      // Edge crossing points: top, right, bottom, left.
      const top = () => [c + lerp(tl, tr), r];
      const right = () => [c + 1, r + lerp(tr, br)];
      const bottom = () => [c + lerp(bl, br), r + 1];
      const left = () => [c, r + lerp(tl, bl)];
      const pairs: (() => number[])[][] = [];
      switch (code) {
        case 1: case 14: pairs.push([left, bottom]); break;
        case 2: case 13: pairs.push([bottom, right]); break;
        case 3: case 12: pairs.push([left, right]); break;
        case 4: case 11: pairs.push([top, right]); break;
        case 6: case 9: pairs.push([top, bottom]); break;
        case 7: case 8: pairs.push([left, top]); break;
        case 5: { // Saddle: decide by the centre value.
          const centre = (tl + tr + br + bl) / 4;
          if (centre >= level) { pairs.push([left, top], [bottom, right]); } else { pairs.push([left, bottom], [top, right]); }
          break;
        }
        case 10: {
          const centre = (tl + tr + br + bl) / 4;
          if (centre >= level) { pairs.push([left, bottom], [top, right]); } else { pairs.push([left, top], [bottom, right]); }
          break;
        }
      }
      for (const [one, other] of pairs) out.push(...one(), ...other());
    }
  }
  return out;
}

// ── Labels ──────────────────────────────────────────────────────────────────

export type LabelBox = { id: string; x: number; y: number; width: number; height: number };

/**
 * Greedy label placement: labels go in the given order (put the selected peak
 * first) and a label that would overlap one already placed is left out.
 */
export function placeLabels(candidates: LabelBox[]): Set<string> {
  const placed: LabelBox[] = [];
  const shown = new Set<string>();
  for (const box of candidates) {
    if (placed.some((other) => box.x < other.x + other.width && other.x < box.x + box.width && box.y < other.y + other.height && other.y < box.y + box.height)) continue;
    placed.push(box);
    shown.add(box.id);
  }
  return shown;
}

// ── Saved job ───────────────────────────────────────────────────────────────

/** The job config the HSQC job saves: what ran, on which structure, and the peak list a report can redraw. */
export function hsqcConfig(prediction: HsqcPrediction, peaks: Peak[], structure: { source: string; id: string } | null, predictedAt: string): JsonObject {
  return {
    predictedAt,
    predictionStatus: prediction.status,
    predictor: { id: prediction.predictor.id, label: prediction.predictor.label, rmseH: prediction.predictor.rmse.h, rmseN: prediction.predictor.rmse.n },
    structure,
    peakCount: peaks.filter((peak) => peak.kind === "backbone").length,
    peaks: peaks.map((peak) => ({ label: peak.label, position: peak.position, residue: peak.residue, kind: peak.kind, hPpm: peak.h, nPpm: peak.n })),
  };
}

// ── Readers ─────────────────────────────────────────────────────────────────

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}

function asObjects(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}

function text(value: unknown) { return typeof value === "string" ? value : ""; }
function finite(value: unknown) { return typeof value === "number" && Number.isFinite(value) ? value : null; }
function positive(value: unknown) { const number = finite(value); return number !== null && number > 0 ? number : null; }
function integer(value: unknown) { return typeof value === "number" && Number.isInteger(value) && value > 0 ? value : null; }
