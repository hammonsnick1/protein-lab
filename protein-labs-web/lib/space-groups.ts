// Space groups for the Crystallize job: the generated table, the symmetry
// operations behind each group, and what every operation does in plain words.
//
// A crystal is one copy of the protein (the asymmetric unit) repeated by a set
// of symmetry operations. The 230 space groups are every way that set can be
// built. Only 65 of them — the Sohncke groups — are made purely of rotations,
// screw axes and translations; the other 165 also mirror or invert, which no
// protein made of L-amino acids can do, so protein crystals are always in one
// of the 65. The table itself is generated from gemmi; this module reads it.
//
// Every operation is held exactly: the 3×3 part is integers and the
// translation is an integer count of twelfths of a cell edge, so composing
// operations and comparing them never drifts. International Tables Vol. A
// chapter 1.2 calls the pieces computed here the "geometric interpretation" of
// an operation: its order, axis or plane, where that sits in the cell, and the
// intrinsic translation (the screw or glide part).
//
// Only erasable TypeScript syntax is used, so the unit tests run under Node
// without a bundler.
import { SPACE_GROUP_ROWS, type SpaceGroupRow } from "./space-group-table.ts";

/** Translations are integer numerators over this denominator (twelfths). */
export const DEN = 12;

export type Triple = [number, number, number];
export type Mat3 = [Triple, Triple, Triple];

/** One symmetry operation: `matrix` rows act on (x, y, z), `translation` is over `DEN`. */
export type SymOp = { matrix: Mat3; translation: Triple };

export type CrystalSystem = SpaceGroupRow["system"];

export const CRYSTAL_SYSTEM_ORDER: readonly CrystalSystem[] = [
  "triclinic", "monoclinic", "orthorhombic", "tetragonal", "trigonal", "hexagonal", "cubic",
];

/** Plain-language note for each crystal system, shown beside the group list. */
export const CRYSTAL_SYSTEM_NOTES: Record<CrystalSystem, string> = {
  triclinic: "No symmetry to speak of: all three cell edges and all three angles are free.",
  monoclinic: "One special direction. Two angles are 90°, the third is free.",
  orthorhombic: "Three perpendicular special directions; all angles 90°, edges all different.",
  tetragonal: "A square base: a = b, all angles 90°, with a 4-fold axis along c.",
  trigonal: "A 3-fold axis along c; the base is a 120° rhombus (or a rhombohedron).",
  hexagonal: "A 6-fold axis along c on the same 120° base as trigonal.",
  cubic: "The most symmetric: a = b = c, all angles 90°, 3-fold axes along the body diagonals.",
};

// ── The table ───────────────────────────────────────────────────────────────

export type SpaceGroup = SpaceGroupRow;

export const SPACE_GROUPS: readonly SpaceGroup[] = SPACE_GROUP_ROWS;

/** The 65 groups a protein crystal can adopt, lowest number first. */
export const SOHNCKE_GROUPS: readonly SpaceGroup[] = SPACE_GROUPS.filter((group) => group.sohncke);

const byNumber = new Map(SPACE_GROUPS.map((group) => [group.n, group]));

export function spaceGroupByNumber(number: number): SpaceGroup | null {
  return byNumber.get(number) ?? null;
}

/**
 * A symbol written any of the usual ways, reduced to one key: spaces and case
 * dropped, and the CCP4 "H" spelling of the rhombohedral groups turned back
 * into "R". `"P 21 21 21"`, `"p212121"` and `"P212121"` all become `"P212121"`.
 */
export function spaceGroupKey(symbol: string): string {
  const compact = symbol.replace(/[\s_]+/g, "").toUpperCase();
  return /^H[0-9-]/.test(compact) ? `R${compact.slice(1)}` : compact;
}

const byKey = new Map<string, SpaceGroup>();
for (const group of SPACE_GROUPS) {
  for (const alias of [group.hm, group.short]) {
    const key = spaceGroupKey(alias);
    if (!byKey.has(key)) byKey.set(key, group);
  }
}
// "P 1 21 1" is how the PDB writes group 4, "P21" is how a person writes it;
// both already resolve. Monoclinic and trigonal groups also turn up with the
// interleaved 1s dropped, e.g. "C 2" for "C 1 2 1".
for (const group of SPACE_GROUPS) {
  const trimmed = group.hm.replace(/(^|\s)1(\s|$)/g, " ").replace(/\s+/g, " ").trim();
  const key = spaceGroupKey(trimmed);
  if (key && !byKey.has(key)) byKey.set(key, group);
}

/** Look a group up by any spelling of its symbol, or by its ITA number as text. */
export function findSpaceGroup(symbol: string): SpaceGroup | null {
  const text = symbol.trim();
  if (!text) return null;
  if (/^\d{1,3}$/.test(text)) return spaceGroupByNumber(Number(text));
  return byKey.get(spaceGroupKey(text)) ?? null;
}

/** How many copies of the protein one cell holds: operations × centrings. */
export function multiplicity(group: SpaceGroup): number {
  return group.ops.length * group.cen.length;
}

/** Groups matching a free-text query, searching symbol, number and system. */
export function searchSpaceGroups(groups: readonly SpaceGroup[], query: string): readonly SpaceGroup[] {
  const text = query.trim();
  if (!text) return groups;
  const key = spaceGroupKey(text);
  const loose = text.toLowerCase();
  return groups.filter((group) =>
    spaceGroupKey(group.short).includes(key) ||
    spaceGroupKey(group.hm).includes(key) ||
    String(group.n) === text ||
    group.system.startsWith(loose) ||
    group.pointGroup.toLowerCase() === loose);
}

// ── Operations ──────────────────────────────────────────────────────────────

const AXIS_INDEX: Record<string, number> = { x: 0, y: 1, z: 2 };

/** Read one "x+1/2,-y,-z+1/2" triplet into an exact operation. */
export function parseOperation(triplet: string): SymOp {
  const parts = triplet.split(",");
  if (parts.length !== 3) throw new Error(`Not a symmetry triplet: "${triplet}"`);
  const matrix: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const translation: Triple = [0, 0, 0];
  parts.forEach((part, row) => {
    for (const term of part.replace(/\s+/g, "").match(/[+-]?[^+-]+/g) ?? []) {
      const sign = term.startsWith("-") ? -1 : 1;
      const body = term.replace(/^[+-]/, "");
      const variable = AXIS_INDEX[body];
      if (variable !== undefined) {
        matrix[row][variable] += sign;
        continue;
      }
      const fraction = /^(\d+)\/(\d+)$/.exec(body);
      const value = fraction ? Number(fraction[1]) / Number(fraction[2]) : Number(body);
      if (!Number.isFinite(value)) throw new Error(`Cannot read "${term}" in "${triplet}"`);
      translation[row] += sign * value * DEN;
    }
    translation[row] = Math.round(translation[row]);
  });
  return { matrix, translation };
}

/** Write an operation back as a triplet, e.g. "-x+1/2,-y,z+1/2". */
export function operationTriplet(op: SymOp): string {
  return [0, 1, 2].map((row) => {
    let text = "";
    for (const column of [0, 1, 2]) {
      const value = op.matrix[row][column];
      if (value === 0) continue;
      text += `${value > 0 ? (text ? "+" : "") : "-"}${Math.abs(value) === 1 ? "" : Math.abs(value)}${"xyz"[column]}`;
    }
    const shift = modDen(op.translation[row]);
    if (shift !== 0) text += `+${fractionText(shift)}`;
    return text || "0";
  }).join(",");
}

function modDen(value: number): number {
  return ((value % DEN) + DEN) % DEN;
}

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

/** "1/2", "1/3", "5/12" — a count of twelfths as the smallest fraction. */
export function fractionText(twelfths: number): string {
  const sign = twelfths < 0 ? "-" : "";
  const value = Math.abs(twelfths);
  if (value === 0) return "0";
  if (value % DEN === 0) return `${sign}${value / DEN}`;
  const divisor = gcd(value, DEN);
  return `${sign}${value / divisor}/${DEN / divisor}`;
}

const VULGAR: Record<string, string> = {
  "1/2": "½", "1/3": "⅓", "2/3": "⅔", "1/4": "¼", "3/4": "¾", "1/6": "⅙", "5/6": "⅚",
};

/** The same fraction with ½ and ¾ as single characters, for labels. */
export function prettyFraction(twelfths: number): string {
  const text = fractionText(twelfths);
  return VULGAR[text] ?? text;
}

export function applyOperation(op: SymOp, point: Triple): Triple {
  return [0, 1, 2].map((row) =>
    op.matrix[row][0] * point[0] + op.matrix[row][1] * point[1] + op.matrix[row][2] * point[2] + op.translation[row] / DEN,
  ) as Triple;
}

/** `b` applied after `a`. */
export function composeOperations(a: SymOp, b: SymOp): SymOp {
  const matrix: Mat3 = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
  const translation: Triple = [0, 0, 0];
  for (const row of [0, 1, 2]) {
    for (const column of [0, 1, 2]) {
      matrix[row][column] = b.matrix[row][0] * a.matrix[0][column] + b.matrix[row][1] * a.matrix[1][column] + b.matrix[row][2] * a.matrix[2][column];
    }
    translation[row] = b.translation[row] + b.matrix[row][0] * a.translation[0] + b.matrix[row][1] * a.translation[1] + b.matrix[row][2] * a.translation[2];
  }
  return { matrix, translation };
}

export const IDENTITY: SymOp = { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [0, 0, 0] };

/** A translation-only operation, from a count of twelfths per axis. */
export function translationOperation(translation: Triple): SymOp {
  return { matrix: [[1, 0, 0], [0, 1, 0], [0, 0, 1]], translation: [...translation] };
}

/** The whole group: every coset representative combined with every centring. */
export function groupOperations(group: SpaceGroup): SymOp[] {
  const centrings = group.cen.map((triplet) => parseOperation(triplet));
  return group.ops.flatMap((triplet) => {
    const op = parseOperation(triplet);
    return centrings.map((centring) => ({
      matrix: op.matrix.map((row) => [...row]) as Mat3,
      translation: [0, 1, 2].map((index) => modDen(op.translation[index] + centring.translation[index])) as Triple,
    }));
  });
}

function matrixEquals(a: Mat3, b: Mat3): boolean {
  return a.every((row, index) => row.every((value, column) => value === b[index][column]));
}

function determinant(matrix: Mat3): number {
  const [[a, b, c], [d, e, f], [g, h, i]] = matrix;
  return a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
}

function trace(matrix: Mat3): number {
  return matrix[0][0] + matrix[1][1] + matrix[2][2];
}

function negate(matrix: Mat3): Mat3 {
  return matrix.map((row) => row.map((value) => -value)) as Mat3;
}

/** How many times the rotation part must be applied to come back to the start. */
export function matrixOrder(matrix: Mat3): number {
  let current = matrix;
  for (let order = 1; order <= 6; order += 1) {
    if (matrixEquals(current, IDENTITY.matrix)) return order;
    current = composeOperations({ matrix: current, translation: [0, 0, 0] }, { matrix, translation: [0, 0, 0] }).matrix;
  }
  throw new Error("A space-group matrix cannot have order above 6");
}

// ── Geometric interpretation ────────────────────────────────────────────────

export type SymmetryKind =
  | "identity" | "translation" | "rotation" | "screw"
  | "inversion" | "mirror" | "glide" | "rotoinversion";

/**
 * Change categories for colour, icon and legend. `rigid` kinds move the
 * protein without turning it into its mirror image; the rest cannot act on a
 * protein made of L-amino acids, which is what leaves only 65 groups.
 */
export type SymmetryCategory = "identity" | "rotation" | "screw" | "centring" | "inversion" | "reflection";

export type SymmetryElement = {
  op: SymOp;
  kind: SymmetryKind;
  category: SymmetryCategory;
  /** 2, 3, 4 or 6 for an axis; 2 for a mirror or inversion; 1 for identity and translations. */
  order: number;
  /** True when the operation is a rigid motion, so a real protein can do it. */
  rigid: boolean;
  /** Axis direction, or the normal of a mirror/glide plane, as small integers. */
  axis: Triple | null;
  /** A point on the axis, in the plane, or the inversion centre; twelfths. */
  point: Triple | null;
  /** The screw or glide part of the translation, in twelfths. */
  intrinsic: Triple;
  /** Screw or glide as a fraction of the repeat along the axis, e.g. 1/2 → 0.5. */
  shift: number;
  /** +1 anticlockwise about the axis by the right-hand rule, -1 clockwise, 0 if not applicable. */
  sense: number;
  /** Hermann–Mauguin label: "2", "2₁", "4₃", "m", "c", "n", "1̄", "4̄", "t". */
  symbol: string;
};

const SUBSCRIPT = ["₀", "₁", "₂", "₃", "₄", "₅", "₆"];

/** A direction as crystallographers write it: "a", "b", "c", "[110]", "[1̄10]". */
export function axisName(axis: Triple): string {
  const named: Record<string, string> = { "1,0,0": "a", "0,1,0": "b", "0,0,1": "c" };
  const key = axis.join(",");
  if (named[key]) return named[key];
  return `[${axis.map((value) => (value < 0 ? `${Math.abs(value)}̅` : String(value))).join("")}]`;
}

function reduce(vector: Triple): Triple {
  const divisor = vector.reduce((carry, value) => gcd(carry, value), 0) || 1;
  const reduced = vector.map((value) => value / divisor) as Triple;
  // Point the axis the same way every time, so two copies compare equal.
  const lead = reduced.find((value) => value !== 0) ?? 1;
  return lead < 0 ? (reduced.map((value) => -value) as Triple) : reduced;
}

/**
 * Exact solution of `matrix · x = rhs/DEN` with the free directions reported.
 * Returns a particular solution in twelfths plus a basis of the null space.
 */
function solve(matrix: Mat3, rhs: Triple): { point: Triple; nullSpace: Triple[] } {
  // Rational Gaussian elimination on [matrix | rhs], values kept as numerators
  // over a shared denominator so nothing rounds.
  const rows = matrix.map((row, index) => [...row.map((value) => value * DEN), rhs[index]]);
  const pivots: number[] = [];
  let row = 0;
  for (let column = 0; column < 3 && row < 3; column += 1) {
    const found = rows.findIndex((candidate, index) => index >= row && candidate[column] !== 0);
    if (found === -1) continue;
    [rows[row], rows[found]] = [rows[found], rows[row]];
    for (let other = 0; other < 3; other += 1) {
      if (other === row || rows[other][column] === 0) continue;
      const factor = rows[other][column] / rows[row][column];
      for (let index = 0; index < 4; index += 1) rows[other][index] -= factor * rows[row][index];
    }
    pivots.push(column);
    row += 1;
  }
  const point: Triple = [0, 0, 0];
  pivots.forEach((column, index) => {
    point[column] = rows[index][3] / rows[index][column] * DEN;
  });
  const free = [0, 1, 2].filter((column) => !pivots.includes(column));
  const nullSpace = free.map((column) => {
    const vector: Triple = [0, 0, 0];
    vector[column] = 1;
    pivots.forEach((pivot, index) => {
      vector[pivot] = -rows[index][column] / rows[index][pivot];
    });
    return reduce(vector.map((value) => Math.round(value * 12)) as Triple);
  });
  return { point: point.map((value) => Math.round(value)) as Triple, nullSpace };
}

/**
 * The directions an operation leaves alone: one vector for a rotation axis,
 * two spanning the plane of a mirror or glide, none for an inversion.
 */
export function operationInvariants(op: SymOp): Triple[] {
  const minusIdentity = op.matrix.map((row, index) => row.map((value, column) => value - (index === column ? 1 : 0))) as Mat3;
  return solve(minusIdentity, [0, 0, 0]).nullSpace;
}

function glideLetter(intrinsic: Triple, axis: Triple): string {
  const halves = intrinsic.map((value) => value / (DEN / 2));
  const half = halves.filter((value) => Math.abs(value - 1) < 1e-9).length;
  const quarter = intrinsic.filter((value) => Math.abs(Math.abs(value) - DEN / 4) < 1e-9).length;
  if (quarter > 0) return "d";
  if (half === 1) {
    const index = halves.findIndex((value) => Math.abs(value - 1) < 1e-9);
    // A glide along a cell edge takes that edge's letter; across the face, "n".
    return axis[index] === 0 ? "abc"[index] : "n";
  }
  return half > 1 ? "n" : "g";
}

/**
 * What one operation does, geometrically. See International Tables Vol. A
 * §1.2.2: the intrinsic translation is the part that survives applying the
 * operation `order` times, and the rest fixes where the element sits.
 */
function norm(vector: Triple): number {
  return Math.hypot(...vector);
}

/**
 * A screw or glide translation is only defined up to a lattice vector: the
 * same 2₁ axis seen one cell further along must still read as 2₁. Each
 * component is wrapped into one cell, then any centring vector that makes the
 * translation shorter is taken out as well.
 */
function reduceIntrinsic(intrinsic: Triple, lattice: readonly Triple[]): Triple {
  const wrap = (vector: Triple): Triple => vector.map((value) => modDen(Math.round(value))) as Triple;
  let best = wrap(intrinsic);
  for (const vector of lattice) {
    const candidate = wrap([intrinsic[0] - vector[0], intrinsic[1] - vector[1], intrinsic[2] - vector[2]]);
    if (norm(candidate) < norm(best) - 1e-9) best = candidate;
  }
  return best;
}

/**
 * What one operation does, geometrically. `lattice` carries the centring
 * translations of the group, which the intrinsic translation is reduced
 * against; pass none and only whole cells are taken out.
 */
export function describeOperation(op: SymOp, lattice: readonly Triple[] = []): SymmetryElement {
  const det = determinant(op.matrix);
  const order = matrixOrder(op.matrix);
  const shiftOf = (intrinsic: Triple, axis: Triple | null) => {
    if (!axis) return 0;
    const dot = intrinsic.reduce((carry, value, index) => carry + value * axis[index], 0);
    const length = axis.reduce((carry, value) => carry + value * value, 0);
    return dot / (length * DEN);
  };
  // Applying the operation `order` times leaves a pure translation behind: the
  // intrinsic translation is that, shared out over the cycle (ITA §1.2.2.4).
  let cycle = IDENTITY;
  for (let step = 0; step < order; step += 1) cycle = composeOperations(cycle, op);
  const raw = cycle.translation.map((value) => value / order) as Triple;
  const located: Triple = [0, 1, 2].map((index) => op.translation[index] - raw[index]) as Triple;
  const intrinsic = reduceIntrinsic(raw, lattice);

  if (matrixEquals(op.matrix, IDENTITY.matrix)) {
    const pure = op.translation.some((value) => modDen(value) !== 0);
    return {
      op, kind: pure ? "translation" : "identity", category: pure ? "centring" : "identity",
      order: 1, rigid: true, axis: null, point: null,
      intrinsic: op.translation.map(modDen) as Triple, shift: 0, sense: 0,
      symbol: pure ? "t" : "1",
    };
  }

  const rotation = det > 0 ? op.matrix : negate(op.matrix);
  const identityMinus = rotation.map((row, index) => row.map((value, column) => value - (index === column ? 1 : 0))) as Mat3;
  const axisSolution = solve(identityMinus, [0, 0, 0]);
  const axis = axisSolution.nullSpace.length === 1 ? axisSolution.nullSpace[0] : null;
  const where = solve(
    op.matrix.map((row, index) => row.map((value, column) => value - (index === column ? 1 : 0))) as Mat3,
    located.map((value) => -value) as Triple,
  );
  const shift = shiftOf(intrinsic, axis);
  let sense = 0;
  if (axis && order > 2) {
    const probe: Triple = axis[2] === 0 ? [0, 0, 1] : [1, 0, 0];
    const turned = [0, 1, 2].map((row) => rotation[row][0] * probe[0] + rotation[row][1] * probe[1] + rotation[row][2] * probe[2]) as Triple;
    const volume = determinant([axis, probe, turned] as Mat3);
    sense = Math.sign(volume);
  }

  if (det > 0) {
    const screwOrder = Math.round(Math.abs(shift) * order);
    const screw = Math.abs(shift) > 1e-9;
    return {
      op, kind: screw ? "screw" : "rotation", category: screw ? "screw" : "rotation",
      order, rigid: true, axis, point: where.point, intrinsic: intrinsic.map(Math.round) as Triple,
      shift, sense,
      symbol: screw ? `${order}${SUBSCRIPT[screwOrder] ?? ""}` : String(order),
    };
  }
  if (matrixEquals(op.matrix, negate(IDENTITY.matrix))) {
    return {
      op, kind: "inversion", category: "inversion", order: 2, rigid: false,
      axis: null, point: where.point, intrinsic: [0, 0, 0], shift: 0, sense: 0, symbol: "1̅",
    };
  }
  if (trace(op.matrix) === 1) {
    const glide = intrinsic.some((value) => Math.abs(value) > 1e-9);
    return {
      op, kind: glide ? "glide" : "mirror", category: "reflection", order: 2, rigid: false,
      axis, point: where.point, intrinsic: intrinsic.map(Math.round) as Triple, shift,
      sense: 0, symbol: glide && axis ? glideLetter(intrinsic.map(Math.abs) as Triple, axis) : "m",
    };
  }
  return {
    op, kind: "rotoinversion", category: "inversion", order, rigid: false,
    axis, point: where.point, intrinsic: intrinsic.map(Math.round) as Triple, shift, sense,
    symbol: `${order}̅`,
  };
}

/** The group's centring translations, in twelfths, without the origin. */
export function centringVectors(group: SpaceGroup): Triple[] {
  return group.cen.slice(1).map((triplet) => parseOperation(triplet).translation);
}

/** Every operation of a group, read geometrically, identity first. */
export function groupElements(group: SpaceGroup): SymmetryElement[] {
  const lattice = centringVectors(group);
  return groupOperations(group).map((op) => describeOperation(op, lattice));
}

// ── Plain language ──────────────────────────────────────────────────────────

export type UnitCell = { a: number; b: number; c: number; alpha: number; beta: number; gamma: number };

const ORDER_WORDS: Record<number, string> = { 2: "half turn (180°)", 3: "third of a turn (120°)", 4: "quarter turn (90°)", 6: "sixth of a turn (60°)" };

/** "(0, ¼, z)" — where an axis runs, with the axis direction left as a letter. */
export function elementPosition(element: SymmetryElement): string {
  if (!element.point) return "";
  const free = element.axis;
  const labels = [0, 1, 2].map((index) => {
    if (element.kind === "mirror" || element.kind === "glide") {
      return free && free[index] !== 0 ? prettyFraction(modDen(element.point![index])) : "xyz"[index];
    }
    if (free && free[index] !== 0) return "xyz"[index];
    return prettyFraction(modDen(element.point![index]));
  });
  return `(${labels.join(", ")})`;
}

/** Ångströms moved by an intrinsic translation, when the cell is known. */
export function shiftDistance(element: SymmetryElement, cell: UnitCell | null): number | null {
  if (!cell || !element.axis) return null;
  const edges = [cell.a, cell.b, cell.c];
  const vector = element.intrinsic.map((value, index) => (value / DEN) * edges[index]);
  return Math.hypot(...vector) || null;
}

/** One sentence a student can read: what this operation does to the protein. */
export function elementSentence(element: SymmetryElement, cell: UnitCell | null = null): string {
  const distance = shiftDistance(element, cell);
  const metres = distance ? ` (${distance.toFixed(1)} Å)` : "";
  switch (element.kind) {
    case "identity":
      return "The protein where you put it. Every other copy in the crystal comes from this one.";
    case "translation":
      return `Slide the protein by ${element.intrinsic.map((value) => prettyFraction(value)).join(", ")} of the cell edges${metres} without turning it. This is the lattice centring: an extra copy inside the cell.`;
    case "rotation":
      return `Turn the protein a ${ORDER_WORDS[element.order] ?? "turn"} about the ${axisName(element.axis ?? [0, 0, 1])} axis at ${elementPosition(element)}. Repeat ${element.order} times and it is back where it started.`;
    case "screw":
      return `Turn the protein a ${ORDER_WORDS[element.order] ?? "turn"} about the ${axisName(element.axis ?? [0, 0, 1])} axis at ${elementPosition(element)} and slide it ${prettyFraction(Math.round(Math.abs(element.shift) * DEN))} of the way along that axis${metres}. It climbs like a spiral staircase: ${element.order} steps take it one whole cell along ${axisName(element.axis ?? [0, 0, 1])}.`;
    case "mirror":
      return `Reflect the protein in the plane perpendicular to ${axisName(element.axis ?? [0, 0, 1])} at ${elementPosition(element)}. A reflection swaps left for right, so no protein built from L-amino acids can sit in a crystal with this operation.`;
    case "glide":
      return `Reflect the protein in the plane perpendicular to ${axisName(element.axis ?? [0, 0, 1])} at ${elementPosition(element)}, then slide it along that plane${metres}. The reflection still swaps left for right, so proteins never do this.`;
    case "inversion":
      return `Push every atom through the point ${elementPosition(element)} and out the other side. That turns the protein into its mirror image, which L-amino acids cannot be.`;
    default:
      return `Turn the protein a ${ORDER_WORDS[element.order] ?? "turn"} about the ${axisName(element.axis ?? [0, 0, 1])} axis at ${elementPosition(element)} and then invert it through a point on that axis. Inversion makes a mirror image, so proteins never do this.`;
  }
}

/** The group in one paragraph: what it is made of and what that means. */
export function spaceGroupSummary(group: SpaceGroup): string {
  const copies = multiplicity(group);
  const screws = new Set(groupElements(group).filter((element) => element.kind === "screw").map((element) => element.symbol));
  const screwText = screws.size > 0 ? ` Its screw axes (${[...screws].sort().join(", ")}) turn the protein and slide it along the axis at the same time.` : "";
  const centringText = group.cen.length > 1 ? ` The ${group.centring} centring adds ${group.cen.length - 1} more copies inside the cell by pure translation.` : "";
  const handed = group.sohncke
    ? "Every operation is a rotation, a screw or a translation, so a protein keeps its handedness: this group is one of the 65 a protein crystal can use."
    : "This group reflects or inverts the contents of the cell, which would turn L-amino acids into D-amino acids. Protein crystals never adopt it — it is here to show what the other 165 groups do.";
  return `${group.short} (No. ${group.n}, ${group.system}) packs ${copies} ${copies === 1 ? "copy" : "copies"} of the asymmetric unit into one unit cell.${screwText}${centringText} ${handed}`;
}

// ── Animation ───────────────────────────────────────────────────────────────

export type AnimationStep = {
  /** How many times the operation has been applied at the end of this step. */
  index: number;
  /** Turn in degrees during this step, about the element's axis. */
  degrees: number;
  /** Slide during this step, as a fraction of each cell edge. */
  slide: Triple;
  /** True when the step ends as a mirror image, so there is no rigid path to it. */
  mirrored: boolean;
  /** Where the copy sits once the step finishes, from a general starting point. */
  position: Triple;
  caption: string;
};

const SEED_POINT: Triple = [0.22, 0.14, 0.12];

/**
 * The operation applied again and again until the protein is back on a lattice
 * copy of where it started, one step per application. Improper operations get
 * a single step: there is no rigid path to a mirror image, which is the point.
 */
export function operationSteps(element: SymmetryElement, cell: UnitCell | null = null, seed: Triple = SEED_POINT): AnimationStep[] {
  const steps: AnimationStep[] = [];
  const turn = element.sense < 0 ? -360 / element.order : 360 / element.order;
  const count = element.rigid && element.kind !== "identity" ? element.order : 1;
  const turning = element.kind === "rotation" || element.kind === "screw" || element.kind === "rotoinversion";
  let position = seed;
  for (let index = 1; index <= count; index += 1) {
    const next = applyOperation(element.op, position);
    const slide = turning
      ? (element.intrinsic.map((value) => value / DEN) as Triple)
      : ([0, 1, 2].map((axis) => next[axis] - position[axis]) as Triple);
    steps.push({
      index,
      degrees: turning ? turn : 0,
      slide,
      mirrored: !element.rigid,
      position: next,
      caption: stepCaption(element, index, count, cell),
    });
    position = next;
  }
  return steps;
}

function stepCaption(element: SymmetryElement, index: number, count: number, cell: UnitCell | null): string {
  const last = index === count;
  const distance = shiftDistance(element, cell);
  const metres = distance ? ` (${distance.toFixed(1)} Å)` : "";
  if (element.kind === "identity") return "Nothing moves. This is the copy you started from.";
  if (element.kind === "translation") return `Slide one whole centring vector${metres}. The copy is identical and the same way up — only its position changed.`;
  if (!element.rigid) return `${element.kind === "inversion" ? "Invert" : "Reflect"} the protein. Watch the shape: it comes back as its mirror image, which is why this operation cannot appear in a protein crystal.`;
  const direction = axisName(element.axis ?? [0, 0, 1]);
  const words = ORDER_WORDS[element.order] ?? "turn";
  const climb = element.kind === "screw" ? ` and slide ${prettyFraction(Math.round(Math.abs(element.shift) * DEN))} along ${direction}${metres}` : "";
  const tail = last
    ? element.kind === "screw"
      ? ` That is ${count} steps: the protein has travelled one whole cell along ${direction} and is back the same way up.`
      : " That completes the cycle and the protein is back where it started."
    : ` Copy ${index + 1} of ${count} appears.`;
  return `Step ${index}: turn a ${words} about ${direction}${climb}.${tail}`;
}
