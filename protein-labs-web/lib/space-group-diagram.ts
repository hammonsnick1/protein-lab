// Geometry for the two diagrams the Crystallize job draws for a space group,
// modelled on the International Tables plates that the UCL space-group pages
// reproduce (http://img.chem.ucl.ac.uk/sgp/mainmenu.htm):
//
//  - the symmetry-element diagram: where the axes and planes of the group sit
//    in one unit cell, seen down c with a down the page and b across it;
//  - the general-position diagram: one copy of the asymmetric unit per
//    operation, each labelled with its height and marked when it is a mirror
//    image of the one you started from.
//
// Everything here is pure geometry in fractional cell coordinates, turned into
// SVG coordinates by `diagramFrame`. The drawing itself lives in
// `components/protein-labs/space-group-explorer.tsx`.
//
// Only erasable TypeScript syntax is used, so the unit tests run under Node
// without a bundler.
import {
  DEN, applyOperation, centringVectors, describeOperation, groupOperations, operationInvariants, prettyFraction,
  type SpaceGroup, type SymOp, type SymmetryCategory, type SymmetryElement, type Triple, type UnitCell,
} from "./space-groups.ts";

/** A cell to draw when none is known, by crystal system; lengths are relative. */
export function defaultCell(group: SpaceGroup): UnitCell {
  const hexagonal = group.system === "hexagonal" || group.system === "trigonal";
  if (hexagonal) return { a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 120 };
  if (group.system === "cubic") return { a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90 };
  if (group.system === "tetragonal") return { a: 1, b: 1, c: 1.3, alpha: 90, beta: 90, gamma: 90 };
  if (group.system === "monoclinic") return { a: 1, b: 1.15, c: 0.9, alpha: 90, beta: 105, gamma: 90 };
  if (group.system === "triclinic") return { a: 1, b: 1.1, c: 0.9, alpha: 95, beta: 102, gamma: 96 };
  return { a: 1, b: 1.2, c: 0.95, alpha: 90, beta: 90, gamma: 90 };
}

/**
 * The drawn cell. The projection is down c in the Tables' orientation: the
 * origin at the top left, a down the page, b to the right, so a 120° cell
 * leans the way it does in the printed plates.
 */
export type DiagramFrame = {
  width: number;
  height: number;
  gamma: number;
  /** The four cell corners in SVG coordinates, starting at the origin. */
  corners: [number, number][];
  /** Fractional cell coordinates to SVG coordinates, projected down c. */
  project: (point: Triple) => [number, number];
  /** The 2×2 part of `project`, for rotating a drawn motif with the cell. */
  basis: { ax: number; ay: number; bx: number; by: number };
  /** Where to put the a and b axis labels. */
  labels: { a: [number, number]; b: [number, number]; origin: [number, number] };
};

export function diagramFrame(cell: UnitCell, size = 260, margin = 26): DiagramFrame {
  const radians = (cell.gamma * Math.PI) / 180;
  // a points down the page, b is turned away from it by gamma.
  const aDir: [number, number] = [0, 1];
  const bDir: [number, number] = [Math.sin(radians), Math.cos(radians)];
  const longest = Math.max(cell.a, cell.b);
  const aLength = (cell.a / longest) * size;
  const bLength = (cell.b / longest) * size;
  const raw: [number, number][] = [
    [0, 0],
    [aDir[0] * aLength, aDir[1] * aLength],
    [aDir[0] * aLength + bDir[0] * bLength, aDir[1] * aLength + bDir[1] * bLength],
    [bDir[0] * bLength, bDir[1] * bLength],
  ];
  const minX = Math.min(...raw.map((corner) => corner[0]));
  const minY = Math.min(...raw.map((corner) => corner[1]));
  const maxX = Math.max(...raw.map((corner) => corner[0]));
  const maxY = Math.max(...raw.map((corner) => corner[1]));
  const originX = margin - minX;
  const originY = margin - minY;
  const project = (point: Triple): [number, number] => [
    originX + point[0] * aDir[0] * aLength + point[1] * bDir[0] * bLength,
    originY + point[0] * aDir[1] * aLength + point[1] * bDir[1] * bLength,
  ];
  return {
    width: maxX - minX + margin * 2,
    height: maxY - minY + margin * 2,
    gamma: cell.gamma,
    corners: raw.map((corner) => [corner[0] + originX, corner[1] + originY]),
    project,
    basis: { ax: aDir[0] * aLength, ay: aDir[1] * aLength, bx: bDir[0] * bLength, by: bDir[1] * bLength },
    labels: {
      origin: project([-0.085, -0.075, 0]),
      a: project([0.5, -0.1, 0]),
      b: project([-0.1, 0.5, 0]),
    },
  };
}

// ── Symmetry-element diagram ────────────────────────────────────────────────

/** The end-on glyph for an axis: the Tables' lens, triangle, square, hexagon. */
export type AxisGlyph = "lens" | "triangle" | "square" | "hexagon";

export type DiagramElement = {
  id: string;
  kind: SymmetryElement["kind"];
  category: SymmetryCategory;
  /** "2₁", "3", "m", "c" — drawn next to the glyph and read out for screen readers. */
  symbol: string;
  order: number;
  /** True for a screw axis or a glide plane: the element also translates. */
  shifted: boolean;
  /** How the element meets the page. */
  shape: "point" | "line" | "face";
  /** Point glyphs: an axis coming straight out of the page. */
  at?: [number, number];
  glyph?: AxisGlyph;
  /** Line glyphs: an axis lying in the page, or a plane seen edge-on. */
  from?: [number, number];
  to?: [number, number];
  /** Height above the page, when it is not zero, e.g. "¼". */
  height?: string;
  /**
   * Extra screen offsets to draw the same element at. An element on a cell
   * edge belongs to the cell next door as well, and the Tables draw it on
   * both, so a 4-fold axis at the origin appears at all four corners.
   */
  repeats: [number, number][];
  /** The sentence shown when the element is selected. */
  element: SymmetryElement;
};

const GLYPHS: Record<number, AxisGlyph> = { 2: "lens", 3: "triangle", 4: "square", 6: "hexagon" };

function reduceVector(vector: Triple): Triple {
  const divisor = vector.reduce((carry, value) => {
    const next = Math.abs(value);
    return next === 0 ? carry : carry === 0 ? next : gcd(carry, next);
  }, 0) || 1;
  const scaled = vector.map((value) => value / divisor) as Triple;
  const lead = scaled.find((value) => value !== 0) ?? 1;
  return lead < 0 ? (scaled.map((value) => -value) as Triple) : scaled;
}

function gcd(a: number, b: number): number {
  return b === 0 ? Math.abs(a) : gcd(b, a % b);
}

function fraction(value: number): number {
  const wrapped = value - Math.floor(value);
  return Math.abs(wrapped - 1) < 1e-6 ? 0 : wrapped;
}

/** The point with the free direction taken out, so repeats of one element agree. */
function canonicalPoint(point: Triple, free: Triple[]): Triple {
  let result: Triple = [...point];
  for (const direction of free) {
    const length = direction.reduce((carry, value) => carry + value * value, 0);
    if (length === 0) continue;
    const dot = result.reduce((carry, value, index) => carry + value * direction[index], 0);
    const scale = dot / length;
    result = result.map((value, index) => value - scale * direction[index]) as Triple;
  }
  return result.map((value) => Math.round(fraction(value) * 24) / 24) as Triple;
}

/**
 * The in-page direction of a plane standing on the page, or null when the
 * plane lies flat on it. A plane with its normal along c lies flat; any other
 * plane contains c, so it is seen edge-on as a line along the invariant
 * direction that stays in the page.
 */
function planeDirection(invariants: Triple[], normal: Triple | null): Triple | null {
  if (!normal || (normal[0] === 0 && normal[1] === 0)) return null;
  const flat = invariants.find((vector) => vector[2] === 0);
  return flat ? reduceVector(flat) : null;
}

const LATTICE_SHIFTS: Triple[] = [];
for (const i of [-1, 0, 1]) for (const j of [-1, 0, 1]) for (const k of [-1, 0, 1]) LATTICE_SHIFTS.push([i, j, k]);

/**
 * Every symmetry element of the group that falls inside one cell, ready to
 * draw. Elements repeat with the lattice, so each operation is also taken one
 * cell either way and the copies that land inside the drawn cell are kept.
 */
export function elementDiagram(group: SpaceGroup, frame: DiagramFrame): DiagramElement[] {
  const seen = new Map<string, DiagramElement>();
  const lattice = centringVectors(group);
  for (const base of groupOperations(group)) {
    for (const shift of LATTICE_SHIFTS) {
      const op: SymOp = {
        matrix: base.matrix.map((row) => [...row]) as SymOp["matrix"],
        translation: base.translation.map((value, index) => value + shift[index] * DEN) as Triple,
      };
      const element = describeOperation(op, lattice);
      if (element.kind === "identity" || element.kind === "translation") continue;
      const invariants = operationInvariants(op);
      // `element.point` counts twelfths of a cell edge; the diagram works in
      // fractions of the cell.
      const point = (element.point ?? [0, 0, 0]).map((value) => value / DEN) as Triple;
      // Wrapping each coordinate into the cell adds a lattice vector, which
      // maps an element onto an equivalent one, so copies collapse by key.
      const canonical = canonicalPoint(point, invariants);
      const key = `${element.kind}|${element.symbol}|${element.axis?.join(",") ?? "-"}|${canonical.join(",")}`;
      if (seen.has(key)) continue;
      const drawn = drawElement(element, canonical, invariants, frame, key);
      if (drawn) seen.set(key, drawn);
    }
  }
  return [...seen.values()].sort((left, right) => order(left) - order(right));
}

function order(element: DiagramElement): number {
  const ranks: Record<DiagramElement["shape"], number> = { face: 0, line: 1, point: 2 };
  return ranks[element.shape] * 10 - element.order;
}

/** An element sitting on a cell edge is drawn on the opposite edge too. */
function edgeRepeats(canonical: Triple, frame: DiagramFrame, along: Triple | null): [number, number][] {
  const { ax, ay, bx, by } = frame.basis;
  const parallel = (axis: Triple | null, index: number) =>
    axis !== null && axis[index] !== 0 && axis.filter((value) => value !== 0).length === 1;
  const onA = canonical[0] < 1e-6 && !parallel(along, 0);
  const onB = canonical[1] < 1e-6 && !parallel(along, 1);
  const repeats: [number, number][] = [];
  if (onA) repeats.push([ax, ay]);
  if (onB) repeats.push([bx, by]);
  if (onA && onB) repeats.push([ax + bx, ay + by]);
  return repeats;
}

function drawElement(element: SymmetryElement, canonical: Triple, invariants: Triple[], frame: DiagramFrame, id: string): DiagramElement | null {
  const shared = {
    id, kind: element.kind, category: element.category, symbol: element.symbol, order: element.order,
    shifted: element.kind === "screw" || element.kind === "glide", element,
  };
  const height = fraction(canonical[2]);
  const heightText = height > 1e-6 ? prettyFraction(Math.round(height * DEN)) : undefined;

  if (element.kind === "mirror" || element.kind === "glide") {
    const direction = planeDirection(invariants, element.axis);
    if (!direction) {
      return { ...shared, shape: "face", at: frame.project([0.06, 0.06, 0]), height: heightText, repeats: [] };
    }
    const start: Triple = [canonical[0], canonical[1], 0];
    const end: Triple = [canonical[0] + direction[0], canonical[1] + direction[1], 0];
    return {
      ...shared, shape: "line", from: frame.project(start), to: frame.project(end), height: heightText,
      repeats: edgeRepeats(canonical, frame, direction),
    };
  }
  if (element.kind === "inversion") {
    return { ...shared, shape: "point", at: frame.project(canonical), glyph: undefined, height: heightText, repeats: edgeRepeats(canonical, frame, null) };
  }
  const axis = element.axis;
  if (!axis) return null;
  if (axis[0] === 0 && axis[1] === 0) {
    // Straight out of the page: the Tables' end-on glyph.
    return {
      ...shared, shape: "point", at: frame.project(canonical),
      glyph: GLYPHS[element.order] ?? "lens", repeats: edgeRepeats(canonical, frame, null),
    };
  }
  const start: Triple = [canonical[0], canonical[1], 0];
  const end: Triple = [canonical[0] + axis[0], canonical[1] + axis[1], 0];
  if (Math.abs(start[0] - end[0]) < 1e-9 && Math.abs(start[1] - end[1]) < 1e-9) return null;
  return {
    ...shared, shape: "line", from: frame.project(start), to: frame.project(end), height: heightText,
    repeats: edgeRepeats(canonical, frame, axis),
  };
}

// ── General-position diagram ────────────────────────────────────────────────

export type GeneralPosition = {
  id: string;
  /** Fractional coordinates of this copy, x and y wrapped into the cell. */
  point: Triple;
  at: [number, number];
  /** True when this copy is the mirror image of the one you started from. */
  mirrored: boolean;
  /** The Tables' height label: "+", "−", "½+", or a number for mixed axes. */
  height: string;
  /** The 2×2 screen transform for drawing a motif turned the way this copy is. */
  transform: { a: number; b: number; c: number; d: number };
  triplet: string;
  op: SymOp;
};

const SEED: Triple = [0.22, 0.14, 0.12];

/** One copy of the asymmetric unit per operation, as the Tables draw them. */
export function generalPositions(group: SpaceGroup, frame: DiagramFrame, seed: Triple = SEED): GeneralPosition[] {
  const seen = new Set<string>();
  const positions: GeneralPosition[] = [];
  for (const op of groupOperations(group)) {
    const moved = applyOperation(op, seed);
    const point: Triple = [fraction(moved[0]), fraction(moved[1]), moved[2]];
    const key = point.map((value) => Math.round(fraction(value) * 1000)).join(",");
    if (seen.has(key)) continue;
    seen.add(key);
    const determinant = op.matrix[0][0] * (op.matrix[1][1] * op.matrix[2][2] - op.matrix[1][2] * op.matrix[2][1])
      - op.matrix[0][1] * (op.matrix[1][0] * op.matrix[2][2] - op.matrix[1][2] * op.matrix[2][0])
      + op.matrix[0][2] * (op.matrix[1][0] * op.matrix[2][1] - op.matrix[1][1] * op.matrix[2][0]);
    positions.push({
      id: key,
      point,
      at: frame.project(point),
      mirrored: determinant < 0,
      height: heightLabel(op, point),
      transform: operationTransform(op, frame),
      triplet: tripletOf(op),
      op,
    });
  }
  return positions;
}

function tripletOf(op: SymOp): string {
  return [0, 1, 2].map((row) => {
    let text = "";
    for (const column of [0, 1, 2]) {
      const value = op.matrix[row][column];
      if (value === 0) continue;
      text += `${value > 0 ? (text ? "+" : "") : "-"}${"xyz"[column]}`;
    }
    const shift = ((op.translation[row] % DEN) + DEN) % DEN;
    return (text || "0") + (shift ? `+${prettyFraction(shift)}` : "");
  }).join(", ");
}

/** "+", "−", "½+", "½−" as the Tables label heights, or the value itself. */
function heightLabel(op: SymOp, point: Triple): string {
  const row = op.matrix[2];
  const shift = ((op.translation[2] % DEN) + DEN) % DEN;
  const prefix = shift ? prettyFraction(shift) : "";
  if (row[0] === 0 && row[1] === 0 && row[2] === 1) return `${prefix}+`;
  if (row[0] === 0 && row[1] === 0 && row[2] === -1) return `${prefix}−`;
  return fraction(point[2]).toFixed(2).replace(/^0/, "");
}

/**
 * How a motif drawn at this copy must be turned. The in-page part of the
 * operation is taken into the frame's basis, so the drawing follows the cell
 * even when it is not rectangular. Operations that mix c into a and b (the
 * cubic 3-fold axes) have no 2D equivalent, so the motif is left upright and
 * the height label carries the information instead.
 */
export function operationTransform(op: SymOp, frame: DiagramFrame): GeneralPosition["transform"] {
  const { ax, ay, bx, by } = frame.basis;
  const [[xx, xy], [yx, yy]] = [op.matrix[0], op.matrix[1]];
  if (op.matrix[0][2] !== 0 || op.matrix[1][2] !== 0 || op.matrix[2][0] !== 0 || op.matrix[2][1] !== 0) {
    return { a: 1, b: 0, c: 0, d: 1 };
  }
  // J · W · J⁻¹ with J the (a, b) → screen basis.
  const determinant = ax * by - bx * ay;
  if (Math.abs(determinant) < 1e-9) return { a: 1, b: 0, c: 0, d: 1 };
  const inverse = { a: by / determinant, b: -bx / determinant, c: -ay / determinant, d: ax / determinant };
  const left = { a: ax * xx + bx * yx, b: ax * xy + bx * yy, c: ay * xx + by * yx, d: ay * xy + by * yy };
  return {
    a: left.a * inverse.a + left.b * inverse.c,
    b: left.a * inverse.b + left.b * inverse.d,
    c: left.c * inverse.a + left.d * inverse.c,
    d: left.c * inverse.b + left.d * inverse.d,
  };
}

// ── Animation ───────────────────────────────────────────────────────────────

export type AnimationFrame = {
  /** Fractional coordinates of the moving copy. */
  point: Triple;
  at: [number, number];
  /** Degrees the motif has turned in the page so far. */
  degrees: number;
  /** True once the motif has been turned into its mirror image. */
  mirrored: boolean;
};

/**
 * Where the moving copy is part-way through one application of an operation.
 * `progress` runs 0 → 1. A rotation about an axis in the page cannot be drawn
 * as a turn in the page, so the copy swings across the axis and its height
 * label is what shows it passing through the page.
 */
export function animationFrame(element: SymmetryElement, progress: number, frame: DiagramFrame, seed: Triple = SEED): AnimationFrame {
  const axis = element.axis ?? [0, 0, 1];
  const perpendicular = axis[0] === 0 && axis[1] === 0;
  const start = seed;
  const end = applyOperation(element.op, seed);
  const point: Triple = [0, 1, 2].map((index) => start[index] + (end[index] - start[index]) * progress) as Triple;
  if (perpendicular && (element.kind === "rotation" || element.kind === "screw")) {
    // Turn about the projected axis point, so the path is the real arc.
    const centre = element.point ?? [0, 0, 0];
    const turn = (360 / element.order) * progress * screenRotation(frame, element.sense < 0 ? -1 : 1);
    const angle = (turn * Math.PI) / 180;
    const [cx, cy] = frame.project([centre[0] / DEN, centre[1] / DEN, 0]);
    const [sx, sy] = frame.project(start);
    const [dx, dy] = [sx - cx, sy - cy];
    return {
      point,
      at: [cx + dx * Math.cos(angle) - dy * Math.sin(angle), cy + dx * Math.sin(angle) + dy * Math.cos(angle)],
      degrees: turn,
      mirrored: false,
    };
  }
  return {
    point,
    at: frame.project(point),
    degrees: 0,
    mirrored: !element.rigid && progress > 0.5,
  };
}

/**
 * Which way round a positive turn about c appears on the page. The projection
 * puts a down and b to the right, which is a left-handed pair on screen, so a
 * right-handed turn about c is drawn clockwise.
 */
function screenRotation(frame: DiagramFrame, sense: number): number {
  const handed = frame.basis.ax * frame.basis.by - frame.basis.bx * frame.basis.ay;
  return (handed >= 0 ? 1 : -1) * sense;
}
