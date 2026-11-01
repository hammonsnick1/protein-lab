// Crystal lattices for the Crystallize job's "Lattice and packing" panel.
//
// Reads the protein atoms and the crystal cell from an mmCIF file, builds the
// symmetry copies a space group makes of them, and measures how those copies
// touch: contacts, clashes and possible hydrogen bonds. The copies are written
// back out as one mmCIF so Mol* draws exactly the coordinates that were
// measured. Pure, so it can be tested without WebGL.
//
// Coordinates follow the PDB convention for the cell axes (a along x, b in the
// xy plane), which is what almost every deposited file uses.
//
// Only erasable TypeScript syntax is used, so the unit tests run under Node
// without a bundler.
import { centringVectors, DEN, describeOperation, fractionText, groupOperations, type SpaceGroup, type SymOp, type SymmetryElement, type UnitCell } from "./space-groups.ts";
import { DEFAULT_INTERFACE_CUTOFF } from "./structure-interface.ts";

export type Vec3 = [number, number, number];
export type Matrix3 = [Vec3, Vec3, Vec3];

/** One heavy (non-hydrogen) polymer atom, in label numbering. */
export type LatticeAtom = {
  chain: string;
  authChain: string;
  seq: number;
  authSeq: string;
  insCode: string;
  comp: string;
  name: string;
  element: string;
  entity: string;
  /** B-factor column; AlphaFold models keep the pLDDT confidence here. */
  b: number;
  x: number;
  y: number;
  z: number;
};

export type ParsedStructure = {
  atoms: LatticeAtom[];
  /** The deposited cell, or null when the file has none or only the 1 Å placeholder NMR and cryo-EM entries carry. */
  cell: UnitCell | null;
  /** Hermann–Mauguin symbol as written in the file, e.g. "P 21 21 21". */
  spaceGroup: string | null;
};

// ── mmCIF reading ───────────────────────────────────────────────────────────

/** Split one CIF line into values; a quote only closes when whitespace follows it. */
export function cifTokens(line: string): string[] {
  const out: string[] = [];
  let index = 0;
  while (index < line.length) {
    const char = line[index];
    if (char === " " || char === "\t") { index += 1; continue; }
    if (char === "'" || char === "\"") {
      let end = index + 1;
      while (end < line.length && !(line[end] === char && (end + 1 === line.length || /\s/.test(line[end + 1])))) end += 1;
      out.push(line.slice(index + 1, end));
      index = end + 1;
      continue;
    }
    let end = index;
    while (end < line.length && !/\s/.test(line[end])) end += 1;
    out.push(line.slice(index, end));
    index = end;
  }
  return out;
}

const ITEMS = ["_cell.length_a", "_cell.length_b", "_cell.length_c", "_cell.angle_alpha", "_cell.angle_beta", "_cell.angle_gamma", "_symmetry.space_group_name_h-m", "_space_group.name_h-m_alt"];

/**
 * The polymer heavy atoms of the first model, plus the cell and space group.
 * Waters and ligands are left out (their `label_seq_id` is "."), as are
 * hydrogens and every alternate conformation after the first.
 */
export function parseMmcif(text: string): ParsedStructure {
  const lines = text.split(/\r?\n/);
  const items = new Map<string, string>();
  const atoms: LatticeAtom[] = [];
  let index = 0;
  const atEnd = () => index >= lines.length;

  while (!atEnd()) {
    const line = lines[index];
    const trimmed = line.trim();
    if (line.startsWith(";")) { index = skipTextField(lines, index); continue; }
    if (trimmed === "loop_") {
      index += 1;
      const columns: string[] = [];
      while (!atEnd() && lines[index].trim().startsWith("_")) { columns.push(lines[index].trim().split(/\s+/)[0].toLowerCase()); index += 1; }
      const isAtoms = columns[0]?.startsWith("_atom_site.");
      const values: string[] = [];
      while (!atEnd()) {
        const row = lines[index];
        const head = row.trim();
        if (head.startsWith("_") || head === "loop_" || head.startsWith("#") || head.startsWith("data_")) break;
        if (row.startsWith(";")) { const end = skipTextField(lines, index); values.push(lines.slice(index + 1, end - 1).join("\n")); index = end; continue; }
        if (isAtoms || columns.some((column) => ITEMS.includes(column))) values.push(...cifTokens(row));
        index += 1;
      }
      if (isAtoms) readAtomSite(columns, values, atoms);
      else if (columns.some((column) => ITEMS.includes(column)) && values.length >= columns.length) columns.forEach((column, at) => items.set(column, values[at]));
      continue;
    }
    if (trimmed.startsWith("_")) {
      const [key, ...rest] = cifTokens(trimmed);
      const name = key.toLowerCase();
      index += 1;
      if (rest.length) { items.set(name, rest[0]); continue; }
      // The value sits on the next line, quoted or as a text field.
      if (!atEnd() && lines[index].startsWith(";")) { const end = skipTextField(lines, index); items.set(name, lines.slice(index, end - 1).join("\n").slice(1).trim()); index = end; continue; }
      if (!atEnd()) { items.set(name, cifTokens(lines[index])[0] ?? ""); index += 1; }
      continue;
    }
    index += 1;
  }

  const number = (key: string) => { const value = Number.parseFloat(items.get(key) ?? ""); return Number.isFinite(value) ? value : null; };
  const lengths = [number("_cell.length_a"), number("_cell.length_b"), number("_cell.length_c")];
  const angles = [number("_cell.angle_alpha"), number("_cell.angle_beta"), number("_cell.angle_gamma")];
  const cell = lengths.every((value) => value !== null) && angles.every((value) => value !== null)
    ? { a: lengths[0]!, b: lengths[1]!, c: lengths[2]!, alpha: angles[0]!, beta: angles[1]!, gamma: angles[2]! }
    : null;
  const symbol = [items.get("_symmetry.space_group_name_h-m"), items.get("_space_group.name_h-m_alt")].map((value) => value?.trim()).find((value) => value && value !== "?" && value !== ".") ?? null;
  return { atoms, cell: cell && isRealCell(cell) ? cell : null, spaceGroup: symbol ? symbol.replace(/\s+/g, " ") : null };
}

function skipTextField(lines: string[], start: number) {
  let index = start + 1;
  while (index < lines.length && !lines[index].startsWith(";")) index += 1;
  return index + 1;
}

function readAtomSite(columns: string[], values: string[], atoms: LatticeAtom[]) {
  const col = (name: string) => columns.indexOf(`_atom_site.${name}`);
  const at = {
    element: col("type_symbol"), name: col("label_atom_id"), alt: col("label_alt_id"), comp: col("label_comp_id"),
    chain: col("label_asym_id"), entity: col("label_entity_id"), seq: col("label_seq_id"), ins: col("pdbx_pdb_ins_code"),
    x: col("cartn_x"), y: col("cartn_y"), z: col("cartn_z"), b: col("b_iso_or_equiv"), authSeq: col("auth_seq_id"), authChain: col("auth_asym_id"), model: col("pdbx_pdb_model_num"),
  };
  if (at.x < 0 || at.y < 0 || at.z < 0 || at.chain < 0 || at.seq < 0) return;
  const width = columns.length;
  let firstModel: string | null = null;
  // The first alternate conformation seen for each residue is the one kept.
  const altFor = new Map<string, string>();
  for (let row = 0; row + width <= values.length; row += width) {
    const value = (column: number) => column < 0 ? "" : values[row + column];
    const seq = Number.parseInt(value(at.seq), 10);
    if (!Number.isFinite(seq)) continue;
    const model = value(at.model);
    if (firstModel === null) firstModel = model;
    if (model !== firstModel) continue;
    const element = (value(at.element) || value(at.name).replace(/[^A-Za-z]/g, "").slice(0, 1)).toUpperCase();
    if (element === "H" || element === "D") continue;
    const chain = value(at.chain);
    const alt = value(at.alt);
    if (alt && alt !== "." && alt !== "?") {
      const key = `${chain}:${seq}`;
      const kept = altFor.get(key);
      if (kept === undefined) altFor.set(key, alt); else if (kept !== alt) continue;
    }
    const ins = value(at.ins);
    atoms.push({
      chain, authChain: value(at.authChain) || chain, seq, authSeq: value(at.authSeq) || String(seq), insCode: ins === "?" || ins === "." ? "" : ins,
      comp: value(at.comp), name: value(at.name), element, entity: value(at.entity) || "1", b: Number.parseFloat(value(at.b)) || 0,
      x: Number.parseFloat(value(at.x)), y: Number.parseFloat(value(at.y)), z: Number.parseFloat(value(at.z)),
    });
  }
}

/** NMR and cryo-EM files carry a 1 Å placeholder cell; a real protein cell is tens of Å on every edge. */
export function isRealCell(cell: UnitCell): boolean {
  const lengths = [cell.a, cell.b, cell.c];
  const angles = [cell.alpha, cell.beta, cell.gamma];
  return lengths.every((value) => Number.isFinite(value) && value >= 5) && angles.every((value) => Number.isFinite(value) && value > 20 && value < 160) && cellVolume(cell) > 0;
}

// ── Cell geometry ───────────────────────────────────────────────────────────

const radians = (degrees: number) => degrees * Math.PI / 180;

export function cellVolume(cell: UnitCell): number {
  const [ca, cb, cg] = [cell.alpha, cell.beta, cell.gamma].map((value) => Math.cos(radians(value)));
  const inner = 1 - ca * ca - cb * cb - cg * cg + 2 * ca * cb * cg;
  return inner > 0 ? cell.a * cell.b * cell.c * Math.sqrt(inner) : 0;
}

/** Fractional → Cartesian (Å), PDB convention: a along x, b in the xy plane. */
export function orthogonalisation(cell: UnitCell): Matrix3 {
  const [ca, cb, cg] = [cell.alpha, cell.beta, cell.gamma].map((value) => Math.cos(radians(value)));
  const sg = Math.sin(radians(cell.gamma));
  const volume = cellVolume(cell);
  return [
    [cell.a, cell.b * cg, cell.c * cb],
    [0, cell.b * sg, cell.c * (ca - cb * cg) / sg],
    [0, 0, volume / (cell.a * cell.b * sg)],
  ];
}

export function multiply(m: Matrix3, v: Vec3): Vec3 {
  return [0, 1, 2].map((row) => m[row][0] * v[0] + m[row][1] * v[1] + m[row][2] * v[2]) as Vec3;
}

function matmul(a: Matrix3, b: Matrix3): Matrix3 {
  return [0, 1, 2].map((row) => [0, 1, 2].map((col) => a[row][0] * b[0][col] + a[row][1] * b[1][col] + a[row][2] * b[2][col])) as Matrix3;
}

export function invert(m: Matrix3): Matrix3 {
  const [[a, b, c], [d, e, f], [g, h, i]] = m;
  const det = a * (e * i - f * h) - b * (d * i - f * g) + c * (d * h - e * g);
  return [
    [(e * i - f * h) / det, (c * h - b * i) / det, (b * f - c * e) / det],
    [(f * g - d * i) / det, (a * i - c * g) / det, (c * d - a * f) / det],
    [(d * h - e * g) / det, (b * g - a * h) / det, (a * e - b * d) / det],
  ];
}

export function centroid(atoms: readonly LatticeAtom[]): Vec3 {
  if (!atoms.length) return [0, 0, 0];
  const sum = atoms.reduce((total, atom) => { total[0] += atom.x; total[1] += atom.y; total[2] += atom.z; return total; }, [0, 0, 0] as Vec3);
  return sum.map((value) => value / atoms.length) as Vec3;
}

// ── Symmetry copies ─────────────────────────────────────────────────────────

/** One copy of the asymmetric unit: a symmetry operation plus a whole-cell shift, as a Cartesian motion. */
export type LatticeCopy = {
  /** 0 is the reference: the deposited (or placed) molecule itself. */
  index: number;
  op: SymOp;
  /** Whole cells moved along a, b and c after the operation. */
  shift: Vec3;
  rotation: Matrix3;
  translation: Vec3;
  element: SymmetryElement;
  /** "-x+1/2,-y,z+1/2", with any whole-cell shift folded in. */
  triplet: string;
};

export type Lattice = {
  cell: UnitCell;
  group: SpaceGroup;
  orth: Matrix3;
  frac: Matrix3;
  ops: SymOp[];
};

export function makeLattice(cell: UnitCell, group: SpaceGroup): Lattice {
  const orth = orthogonalisation(cell);
  return { cell, group, orth, frac: invert(orth), ops: groupOperations(group) };
}

function copyFor(lattice: Lattice, op: SymOp, shift: Vec3, index: number): LatticeCopy {
  const rotation = op.matrix.map((row) => row.map(Number)) as Matrix3;
  const fractional = [0, 1, 2].map((axis) => op.translation[axis] / DEN + shift[axis]) as Vec3;
  return {
    index, op, shift,
    rotation: matmul(matmul(lattice.orth, rotation), lattice.frac),
    translation: multiply(lattice.orth, fractional),
    element: describeOperation(op, centringVectors(lattice.group)),
    triplet: shiftedTriplet(op, shift),
  };
}

/** "-x+1/2,y+3/2,-z-1": the operation with the whole-cell shift added, as a crystallographer writes a symmetry mate. */
export function shiftedTriplet(op: SymOp, shift: Vec3): string {
  return [0, 1, 2].map((row) => {
    let text = "";
    for (const column of [0, 1, 2]) {
      const value = op.matrix[row][column];
      if (value === 0) continue;
      text += `${value > 0 ? (text ? "+" : "") : "-"}${Math.abs(value) === 1 ? "" : Math.abs(value)}${"xyz"[column]}`;
    }
    const constant = op.translation[row] + shift[row] * DEN;
    if (constant !== 0) text += `${constant > 0 ? "+" : ""}${fractionText(constant)}`;
    return text || "0";
  }).join(",");
}

export function applyCopy(copy: Pick<LatticeCopy, "rotation" | "translation">, point: Vec3): Vec3 {
  const turned = multiply(copy.rotation, point);
  return [turned[0] + copy.translation[0], turned[1] + copy.translation[1], turned[2] + copy.translation[2]];
}

export function referenceCopy(lattice: Lattice): LatticeCopy {
  return copyFor(lattice, lattice.ops[0], [0, 0, 0], 0);
}

/**
 * Every copy whose bounding sphere comes within `reach` Å of the reference's:
 * the candidates that might touch it. Exact contacts are measured afterwards.
 */
export function nearbyCopies(lattice: Lattice, atoms: readonly LatticeAtom[], reach = DEFAULT_INTERFACE_CUTOFF): LatticeCopy[] {
  const center = centroid(atoms);
  const radius = Math.sqrt(Math.max(0, ...atoms.map((atom) => (atom.x - center[0]) ** 2 + (atom.y - center[1]) ** 2 + (atom.z - center[2]) ** 2)));
  const limit = 2 * radius + reach;
  const centerFrac = multiply(lattice.frac, center);
  const out: LatticeCopy[] = [];
  lattice.ops.forEach((op, opIndex) => {
    const moved = applyFractional(op, centerFrac);
    // Search whole-cell shifts around the one that brings the copy's centre next to the reference.
    const base = [0, 1, 2].map((axis) => Math.round(centerFrac[axis] - moved[axis]));
    const span = [lattice.cell.a, lattice.cell.b, lattice.cell.c].map((edge) => Math.max(1, Math.ceil(limit / edge)));
    for (let i = -span[0]; i <= span[0]; i++) for (let j = -span[1]; j <= span[1]; j++) for (let k = -span[2]; k <= span[2]; k++) {
      const shift: Vec3 = [base[0] + i, base[1] + j, base[2] + k];
      if (opIndex === 0 && shift.every((value) => value === 0)) continue;
      const position = multiply(lattice.orth, [moved[0] + shift[0], moved[1] + shift[1], moved[2] + shift[2]]);
      const distance = Math.hypot(position[0] - center[0], position[1] - center[1], position[2] - center[2]);
      if (distance <= limit) out.push(copyFor(lattice, op, shift, out.length + 1));
    }
  });
  return out;
}

/** One copy per operation, moved by whole cells so its centre lies inside the unit cell: the cell's contents. */
export function unitCellCopies(lattice: Lattice, atoms: readonly LatticeAtom[]): LatticeCopy[] {
  const centerFrac = multiply(lattice.frac, centroid(atoms));
  return lattice.ops.map((op, opIndex) => {
    const moved = applyFractional(op, centerFrac);
    return copyFor(lattice, op, moved.map((value) => -Math.floor(value + 1e-9)) as Vec3, opIndex);
  });
}

function applyFractional(op: SymOp, point: Vec3): Vec3 {
  return [0, 1, 2].map((row) => op.matrix[row][0] * point[0] + op.matrix[row][1] * point[1] + op.matrix[row][2] * point[2] + op.translation[row] / DEN) as Vec3;
}

// ── Packing analysis ────────────────────────────────────────────────────────

/** Bondi's van der Waals radii (Å) for the heavy atoms of proteins. */
export const VDW_RADII: Record<string, number> = { C: 1.7, N: 1.55, O: 1.52, S: 1.8, SE: 1.9, P: 1.8 };
/** MolProbity calls an overlap of 0.4 Å or more between van der Waals spheres a serious clash. */
export const CLASH_OVERLAP = 0.4;
/** Nitrogen and oxygen atoms this far apart may share a hydrogen (a hydrogen bond or salt bridge); closer than the minimum they clash. */
export const HBOND_RANGE = { min: 2.2, max: 3.5 } as const;

export type ResidueRef = { chain: string; seq: number };
export type AtomPair = { reference: number; mate: number; distance: number };

export type PackingContact = {
  copy: LatticeCopy;
  /** Heavy-atom pairs within the contact distance. */
  atomContacts: number;
  /** Residue pairs (reference residue, mate residue) with at least one atom pair in contact. */
  residuePairs: number;
  clashes: AtomPair[];
  hbonds: AtomPair[];
  /** Residues of the reference, and of the mate (in the reference's numbering), at this contact. */
  referenceResidues: ResidueRef[];
  mateResidues: ResidueRef[];
  minDistance: number;
};

export type PackingSummary = {
  cutoff: number;
  contacts: PackingContact[];
  totals: { neighbours: number; atomContacts: number; residuePairs: number; clashes: number; hbonds: number; interfaceResidues: number };
};

const polar = (element: string) => element === "N" || element === "O";

/** Is this pair of atoms (at distance d) a clash, a possible hydrogen bond, or neither? */
export function classifyPair(a: string, b: string, distance: number): "clash" | "hbond" | null {
  if (polar(a) && polar(b)) {
    if (distance < HBOND_RANGE.min) return "clash";
    return distance <= HBOND_RANGE.max ? "hbond" : null;
  }
  const limit = (VDW_RADII[a] ?? 1.7) + (VDW_RADII[b] ?? 1.7) - CLASH_OVERLAP;
  return distance < limit ? "clash" : null;
}

/**
 * How each copy touches the reference. Copies that come no closer than
 * `cutoff` are dropped. Grid search, as in `structure-interface.ts`.
 */
export function analysePacking(atoms: readonly LatticeAtom[], copies: readonly LatticeCopy[], cutoff = DEFAULT_INTERFACE_CUTOFF): PackingSummary {
  const edge = Math.max(cutoff, HBOND_RANGE.max);
  const cell = (value: number) => Math.floor(value / edge);
  const grid = new Map<string, number[]>();
  atoms.forEach((atom, index) => {
    const key = `${cell(atom.x)},${cell(atom.y)},${cell(atom.z)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(index); else grid.set(key, [index]);
  });
  const limit = cutoff * cutoff;
  const contacts: PackingContact[] = [];

  for (const copy of copies) {
    let atomContacts = 0;
    let min = Infinity;
    const clashes: AtomPair[] = [];
    const hbonds: AtomPair[] = [];
    const pairs = new Set<string>();
    const refSide = new Set<number>();
    const mateSide = new Set<number>();
    atoms.forEach((source, mateIndex) => {
      const [x, y, z] = applyCopy(copy, [source.x, source.y, source.z]);
      const cx = cell(x), cy = cell(y), cz = cell(z);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const refIndex of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          const target = atoms[refIndex];
          const squared = (target.x - x) ** 2 + (target.y - y) ** 2 + (target.z - z) ** 2;
          if (squared > limit && squared > HBOND_RANGE.max ** 2) continue;
          const distance = Math.sqrt(squared);
          const kind = classifyPair(target.element, source.element, distance);
          if (kind === "clash") clashes.push({ reference: refIndex, mate: mateIndex, distance });
          else if (kind === "hbond") hbonds.push({ reference: refIndex, mate: mateIndex, distance });
          if (squared > limit) continue;
          atomContacts += 1;
          min = Math.min(min, distance);
          refSide.add(refIndex);
          mateSide.add(mateIndex);
          pairs.add(`${target.chain}:${target.seq}|${source.chain}:${source.seq}`);
        }
      }
    });
    if (!atomContacts && !clashes.length && !hbonds.length) continue;
    clashes.sort((a, b) => a.distance - b.distance);
    hbonds.sort((a, b) => a.distance - b.distance);
    contacts.push({
      copy, atomContacts, residuePairs: pairs.size, clashes, hbonds,
      referenceResidues: residuesOf(atoms, refSide), mateResidues: residuesOf(atoms, mateSide),
      minDistance: min === Infinity ? Math.min(...[...clashes, ...hbonds].map((pair) => pair.distance)) : min,
    });
  }

  // Worst first: clashes, then the biggest contact. Copies are renumbered 1, 2, 3… in that order.
  contacts.sort((a, b) => b.clashes.length - a.clashes.length || b.residuePairs - a.residuePairs || a.copy.index - b.copy.index);
  contacts.forEach((contact, order) => { contact.copy = { ...contact.copy, index: order + 1 }; });
  const interfaceResidues = new Set(contacts.flatMap((contact) => contact.referenceResidues.map((residue) => `${residue.chain}:${residue.seq}`)));
  return {
    cutoff, contacts,
    totals: {
      neighbours: contacts.filter((contact) => contact.atomContacts > 0).length,
      atomContacts: contacts.reduce((sum, contact) => sum + contact.atomContacts, 0),
      residuePairs: contacts.reduce((sum, contact) => sum + contact.residuePairs, 0),
      clashes: contacts.reduce((sum, contact) => sum + contact.clashes.length, 0),
      hbonds: contacts.reduce((sum, contact) => sum + contact.hbonds.length, 0),
      interfaceResidues: interfaceResidues.size,
    },
  };
}

function residuesOf(atoms: readonly LatticeAtom[], indices: Set<number>): ResidueRef[] {
  const seen = new Map<string, ResidueRef>();
  for (const index of indices) { const atom = atoms[index]; seen.set(`${atom.chain}:${atom.seq}`, { chain: atom.chain, seq: atom.seq }); }
  return [...seen.values()].sort((a, b) => a.chain.localeCompare(b.chain) || a.seq - b.seq);
}

// ── Hypothetical cells ──────────────────────────────────────────────────────

/**
 * Where a placed model's centre goes, in fractions of the cell: the point on a
 * 1/24 grid that lies farthest from all of its own symmetry images, so the
 * copies spread out instead of piling up on an axis.
 */
export function generalPosition(group: SpaceGroup, cell: UnitCell): Vec3 {
  const orth = orthogonalisation(cell);
  const ops = groupOperations(group).slice(1);
  if (!ops.length) return [0.5, 0.5, 0.5];
  let best: Vec3 = [0.5, 0.5, 0.5];
  let bestDistance = -1;
  const steps = 12;
  for (let i = 0; i < steps; i++) for (let j = 0; j < steps; j++) for (let k = 0; k < steps; k++) {
    const point: Vec3 = [(i + 0.5) / steps, (j + 0.5) / steps, (k + 0.5) / steps];
    let nearest = Infinity;
    for (const op of ops) {
      const image = applyFractional(op, point);
      const delta = [0, 1, 2].map((axis) => { const value = image[axis] - point[axis]; return value - Math.round(value); }) as Vec3;
      const [x, y, z] = multiply(orth, delta);
      nearest = Math.min(nearest, Math.hypot(x, y, z));
      if (nearest <= bestDistance) break;
    }
    if (nearest > bestDistance) { bestDistance = nearest; best = point; }
  }
  return best;
}

/** The model moved so its centre sits at the group's most general position in this cell. */
export function placeInCell(atoms: readonly LatticeAtom[], cell: UnitCell, group: SpaceGroup): LatticeAtom[] {
  const center = centroid(atoms);
  const target = multiply(orthogonalisation(cell), generalPosition(group, cell));
  const shift = [target[0] - center[0], target[1] - center[1], target[2] - center[2]];
  return atoms.map((atom) => ({ ...atom, x: atom.x + shift[0], y: atom.y + shift[1], z: atom.z + shift[2] }));
}

/** The cell edges and angles a crystal system forces: tetragonal a = b, cubic a = b = c, and so on. */
export function constrainCell(cell: UnitCell, system: SpaceGroup["system"]): UnitCell {
  const right = { alpha: 90, beta: 90, gamma: 90 };
  switch (system) {
    case "triclinic": return { ...cell };
    // The PDB writes monoclinic groups with b unique ("P 1 21 1"), so only β is free.
    case "monoclinic": return { ...cell, alpha: 90, gamma: 90 };
    case "orthorhombic": return { ...cell, ...right };
    case "tetragonal": return { ...cell, b: cell.a, ...right };
    case "trigonal":
    case "hexagonal": return { ...cell, b: cell.a, alpha: 90, beta: 90, gamma: 120 };
    case "cubic": return { ...cell, b: cell.a, c: cell.a, ...right };
  }
}

/** Which cell values a student may type for this system; the rest follow from them. */
export function freeCellFields(system: SpaceGroup["system"]): (keyof UnitCell)[] {
  switch (system) {
    case "triclinic": return ["a", "b", "c", "alpha", "beta", "gamma"];
    case "monoclinic": return ["a", "b", "c", "beta"];
    case "orthorhombic": return ["a", "b", "c"];
    case "tetragonal": case "trigonal": case "hexagonal": return ["a", "c"];
    case "cubic": return ["a"];
  }
}

/**
 * The smallest cell of this shape whose copies do not clash, so neighbours
 * just touch: scale the model's bounding box up or down by bisection. The
 * answer is one possibility for teaching, not a prediction of the real crystal.
 */
export function suggestCell(atoms: readonly LatticeAtom[], group: SpaceGroup, iterations = 14): { cell: UnitCell; clashes: number; steps: number } {
  const span = (axis: "x" | "y" | "z") => atoms.length ? Math.max(...atoms.map((atom) => atom[axis])) - Math.min(...atoms.map((atom) => atom[axis])) : 30;
  const box = { a: span("x") + 3, b: span("y") + 3, c: span("z") + 3 };
  const widest = Math.max(box.a, box.b);
  const shape = constrainCell(group.system === "trigonal" || group.system === "hexagonal" ? { ...box, a: widest * 1.15, alpha: 90, beta: 90, gamma: 120 }
    : group.system === "cubic" ? { a: Math.max(box.a, box.b, box.c), b: 0, c: 0, alpha: 90, beta: 90, gamma: 90 }
    : group.system === "tetragonal" ? { ...box, a: widest, alpha: 90, beta: 90, gamma: 90 }
    : { ...box, alpha: 90, beta: 90, gamma: 90 }, group.system);
  const at = (scale: number) => roundCell({ ...shape, a: shape.a * scale, b: shape.b * scale, c: shape.c * scale });
  const clashing = (cell: UnitCell) => {
    const placed = placeInCell(atoms, cell, group);
    return hasClash(placed, nearbyCopies(makeLattice(cell, group), placed, HBOND_RANGE.max));
  };
  let low = 0.3;
  let high = 3;
  if (clashing(at(high))) {
    const placed = placeInCell(atoms, at(high), group);
    return { cell: at(high), clashes: analysePacking(placed, nearbyCopies(makeLattice(at(high), group), placed), HBOND_RANGE.max).totals.clashes, steps: 1 };
  }
  for (let step = 0; step < iterations; step++) {
    const middle = (low + high) / 2;
    if (clashing(at(middle))) low = middle; else high = middle;
  }
  return { cell: at(high), clashes: 0, steps: iterations };
}

/** True as soon as any atom of any copy clashes with the reference; faster than a full analysis. */
export function hasClash(atoms: readonly LatticeAtom[], copies: readonly LatticeCopy[]): boolean {
  const edge = HBOND_RANGE.max;
  const cell = (value: number) => Math.floor(value / edge);
  const grid = new Map<string, number[]>();
  atoms.forEach((atom, index) => {
    const key = `${cell(atom.x)},${cell(atom.y)},${cell(atom.z)}`;
    const bucket = grid.get(key);
    if (bucket) bucket.push(index); else grid.set(key, [index]);
  });
  for (const copy of copies) {
    for (const source of atoms) {
      const [x, y, z] = applyCopy(copy, [source.x, source.y, source.z]);
      const cx = cell(x), cy = cell(y), cz = cell(z);
      for (let dx = -1; dx <= 1; dx++) for (let dy = -1; dy <= 1; dy++) for (let dz = -1; dz <= 1; dz++) {
        for (const refIndex of grid.get(`${cx + dx},${cy + dy},${cz + dz}`) ?? []) {
          const target = atoms[refIndex];
          const distance = Math.hypot(target.x - x, target.y - y, target.z - z);
          if (distance < edge && classifyPair(target.element, source.element, distance) === "clash") return true;
        }
      }
    }
  }
  return false;
}

function roundCell(cell: UnitCell): UnitCell {
  const half = (value: number) => Math.round(value * 2) / 2;
  return { a: half(cell.a), b: half(cell.b), c: half(cell.c), alpha: half(cell.alpha), beta: half(cell.beta), gamma: half(cell.gamma) };
}

/** AlphaFold keeps pLDDT in the B-factor column; below 50 the residue is likely disordered and would swell the cell. */
export const LOW_CONFIDENCE_PLDDT = 50;

export function confidentAtoms(atoms: readonly LatticeAtom[], threshold = LOW_CONFIDENCE_PLDDT): LatticeAtom[] {
  return atoms.filter((atom) => atom.b >= threshold);
}

// ── Output for Mol* ─────────────────────────────────────────────────────────

/** The chain ID a copy's atoms get in the lattice file: the reference keeps its own, copy n gets "A-n". */
export function copyChain(chain: string, copyIndex: number): string {
  return copyIndex === 0 ? chain : `${chain}-${copyIndex}`;
}

/** One mmCIF holding every copy as its own chains, so Mol* draws exactly what was measured. */
export function latticeMmcif(atoms: readonly LatticeAtom[], copies: readonly LatticeCopy[], title = "lattice"): string {
  const lines = [
    `data_${title.replace(/\W+/g, "_") || "lattice"}`, "#",
    "loop_",
    "_atom_site.group_PDB", "_atom_site.id", "_atom_site.type_symbol", "_atom_site.label_atom_id", "_atom_site.label_alt_id",
    "_atom_site.label_comp_id", "_atom_site.label_asym_id", "_atom_site.label_entity_id", "_atom_site.label_seq_id",
    "_atom_site.pdbx_PDB_ins_code", "_atom_site.Cartn_x", "_atom_site.Cartn_y", "_atom_site.Cartn_z",
    "_atom_site.occupancy", "_atom_site.B_iso_or_equiv", "_atom_site.auth_seq_id", "_atom_site.auth_asym_id", "_atom_site.pdbx_PDB_model_num",
  ];
  let id = 0;
  for (const copy of copies) {
    for (const atom of atoms) {
      const [x, y, z] = applyCopy(copy, [atom.x, atom.y, atom.z]);
      id += 1;
      const chain = copyChain(atom.chain, copy.index);
      const authChain = copyChain(atom.authChain, copy.index);
      lines.push(`ATOM ${id} ${atom.element} ${cifValue(atom.name)} . ${atom.comp} ${chain} ${atom.entity} ${atom.seq} ${atom.insCode || "?"} ${x.toFixed(3)} ${y.toFixed(3)} ${z.toFixed(3)} 1.00 ${atom.b.toFixed(2)} ${atom.authSeq} ${authChain} 1`);
    }
  }
  lines.push("#");
  return lines.join("\n");
}

function cifValue(value: string) {
  return /[\s'"]/.test(value) ? `"${value}"` : value;
}

/** How a copy was made, for a student: "2₁ screw axis along a, moved +b". */
export function copyLabel(copy: LatticeCopy): string {
  const element = copy.element;
  const motion = element.kind === "identity" ? (copy.index === 0 ? "Reference molecule" : "Same orientation")
    : element.kind === "translation" ? "Centring shift"
    : `${element.symbol} ${element.kind === "screw" ? "screw axis" : "rotation axis"} along ${axisText(element.axis)}`;
  const moves = copy.shift.map((value, axis) => value === 0 ? "" : `${value > 0 ? "+" : "−"}${Math.abs(value) === 1 ? "" : Math.abs(value)}${"abc"[axis]}`).filter(Boolean);
  return moves.length ? `${motion}, moved ${moves.join(" ")}` : motion;
}

function axisText(axis: SymmetryElement["axis"]): string {
  if (!axis) return "c";
  const named: Record<string, string> = { "1,0,0": "a", "0,1,0": "b", "0,0,1": "c" };
  return named[axis.join(",")] ?? named[axis.map((value) => -value).join(",")] ?? `[${axis.map((value) => (value < 0 ? `${Math.abs(value)}\u0305` : value)).join("")}]`;
}

/** Residues as the viewer addresses them in the lattice file. */
export function viewerResidues(residues: readonly ResidueRef[], copyIndex: number): { labelAsymId: string; labelSeqId: number }[] {
  return residues.map((residue) => ({ labelAsymId: copyChain(residue.chain, copyIndex), labelSeqId: residue.seq }));
}

/** Which copy a lattice chain ID belongs to, and the original chain; null for anything else. */
export function parseCopyChain(chain: string): { chain: string; copy: number } | null {
  const match = /^(.*)-(\d+)$/.exec(chain);
  return match ? { chain: match[1], copy: Number(match[2]) } : chain ? { chain, copy: 0 } : null;
}
