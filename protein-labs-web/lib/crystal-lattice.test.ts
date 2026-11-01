import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import {
  analysePacking, applyCopy, cifTokens, classifyPair, confidentAtoms, constrainCell, copyLabel, freeCellFields, invert, isRealCell, latticeMmcif,
  generalPosition, makeLattice, multiply, nearbyCopies, orthogonalisation, parseCopyChain, parseMmcif, placeInCell, referenceCopy, shiftedTriplet, suggestCell,
  unitCellCopies, viewerResidues, type LatticeAtom,
} from "./crystal-lattice.ts";
import { findSpaceGroup, multiplicity, parseOperation } from "./space-groups.ts";
import { CRYSTAL_EXAMPLES } from "./crystal-examples.ts";
import { citations } from "./citations.ts";

// Crambin, PDB 1CRN (Teeter 1984): cell, space group and atom_site only.
// PDB data are released under CC0 1.0 (https://www.wwpdb.org/about/usage-policies).
const crambin = parseMmcif(readFileSync(new URL("./crystal-lattice.1crn.cif", import.meta.url), "utf8"));
const P21 = findSpaceGroup("P 1 21 1")!;

const atom = (fields: Partial<LatticeAtom>): LatticeAtom => ({ chain: "A", authChain: "A", seq: 1, authSeq: "1", insCode: "", comp: "GLY", name: "CA", element: "C", entity: "1", b: 90, x: 0, y: 0, z: 0, ...fields });

describe("reading mmCIF", () => {
  it("splits values, keeping quoted ones whole", () => {
    assert.deepEqual(cifTokens(`_symmetry.space_group_name_H-M   'P 21 21 21'`), ["_symmetry.space_group_name_H-M", "P 21 21 21"]);
    assert.deepEqual(cifTokens(`ATOM 1 O "O5'" . DG`), ["ATOM", "1", "O", "O5'", ".", "DG"]);
    assert.deepEqual(cifTokens(`'it's fine' x`), ["it's fine", "x"]);
  });

  it("reads crambin's protein atoms, cell and space group", () => {
    assert.equal(crambin.spaceGroup, "P 1 21 1");
    assert.deepEqual(crambin.cell, { a: 40.96, b: 18.65, c: 22.52, alpha: 90, beta: 90.77, gamma: 90 });
    assert.equal(new Set(crambin.atoms.map((item) => item.seq)).size, 46);
    assert.ok(crambin.atoms.every((item) => item.element !== "H"));
    // Residues 22 and 25 are modelled twice (Pro/Ser and Leu/Ile); only the first form is kept.
    assert.equal(crambin.atoms.filter((item) => item.seq === 22).map((item) => item.comp).filter((comp, index, all) => all.indexOf(comp) === index).length, 1);
  });

  it("drops waters, ligands, later models and the placeholder cell of NMR and cryo-EM files", () => {
    const text = [
      "data_x", "_cell.length_a 1.000", "_cell.length_b 1.000", "_cell.length_c 1.000",
      "_cell.angle_alpha 90", "_cell.angle_beta 90", "_cell.angle_gamma 90", "_symmetry.space_group_name_H-M 'P 1'", "#", "loop_",
      ...["group_PDB", "id", "type_symbol", "label_atom_id", "label_alt_id", "label_comp_id", "label_asym_id", "label_entity_id", "label_seq_id", "Cartn_x", "Cartn_y", "Cartn_z", "pdbx_PDB_model_num"].map((name) => `_atom_site.${name}`),
      "ATOM 1 N N . GLY A 1 1 0 0 0 1",
      "ATOM 2 H H . GLY A 1 1 0 0 1 1",
      "HETATM 3 O O . HOH B 2 . 5 5 5 1",
      "HETATM 4 SE SE . MSE A 1 2 1 1 1 1",
      "ATOM 5 N N . GLY A 1 1 9 9 9 2",
      "#",
    ].join("\n");
    const parsed = parseMmcif(text);
    assert.deepEqual(parsed.atoms.map((item) => `${item.comp}:${item.name}`), ["GLY:N", "MSE:SE"]);
    assert.equal(parsed.cell, null);
    assert.equal(isRealCell({ a: 40, b: 40, c: 40, alpha: 90, beta: 90, gamma: 90 }), true);
  });
});

describe("cell geometry", () => {
  it("turns fractions into ångströms and back", () => {
    const cell = { a: 27.283, b: 31.98, c: 34.291, alpha: 88.53, beta: 108.57, gamma: 111.85 };
    const orth = orthogonalisation(cell);
    const back = multiply(invert(orth), multiply(orth, [0.3, -0.2, 0.7]));
    [0.3, -0.2, 0.7].forEach((value, index) => assert.ok(Math.abs(back[index] - value) < 1e-9));
    // a runs along x, and every edge keeps its length.
    assert.deepEqual(multiply(orth, [1, 0, 0]), [cell.a, 0, 0]);
    assert.ok(Math.abs(Math.hypot(...multiply(orth, [0, 1, 0])) - cell.b) < 1e-9);
    assert.ok(Math.abs(Math.hypot(...multiply(orth, [0, 0, 1])) - cell.c) < 1e-9);
  });

  it("holds each crystal system to its rules", () => {
    const free = { a: 50, b: 60, c: 70, alpha: 80, beta: 100, gamma: 110 };
    assert.deepEqual(constrainCell(free, "monoclinic"), { a: 50, b: 60, c: 70, alpha: 90, beta: 100, gamma: 90 });
    assert.deepEqual(constrainCell(free, "tetragonal"), { a: 50, b: 50, c: 70, alpha: 90, beta: 90, gamma: 90 });
    assert.deepEqual(constrainCell(free, "hexagonal"), { a: 50, b: 50, c: 70, alpha: 90, beta: 90, gamma: 120 });
    assert.deepEqual(constrainCell(free, "cubic"), { a: 50, b: 50, c: 50, alpha: 90, beta: 90, gamma: 90 });
    assert.deepEqual(freeCellFields("orthorhombic"), ["a", "b", "c"]);
    assert.deepEqual(freeCellFields("trigonal"), ["a", "c"]);
  });
});

describe("symmetry copies", () => {
  it("fills one cell with as many copies as the group has operations", () => {
    for (const [symbol, count] of [["P 1 21 1", 2], ["P 21 21 21", 4], ["P 43 21 2", 8], ["I 2 2 2", 8], ["H 3", 9]] as const) {
      const group = findSpaceGroup(symbol)!;
      const cell = constrainCell({ a: 60, b: 70, c: 80, alpha: 90, beta: 95, gamma: 90 }, group.system);
      const placed = placeInCell(crambin.atoms, cell, group);
      const copies = unitCellCopies(makeLattice(cell, group), placed);
      assert.equal(copies.length, count, symbol);
      // Every copy's centre lies inside the cell.
      const lattice = makeLattice(cell, group);
      const center = placed.reduce((sum, item) => [sum[0] + item.x, sum[1] + item.y, sum[2] + item.z], [0, 0, 0]).map((value) => value / placed.length) as [number, number, number];
      for (const copy of copies) for (const value of multiply(lattice.frac, applyCopy(copy, center))) assert.ok(value >= -1e-6 && value < 1 + 1e-6, `${symbol} ${value}`);
    }
  });

  it("moves atoms as the symmetry operation says", () => {
    const lattice = makeLattice(crambin.cell!, P21);
    const screw = nearbyCopies(lattice, crambin.atoms).find((copy) => copy.triplet === "-x,y+1/2,-z")!;
    const point: [number, number, number] = [0.1, 0.2, 0.3];
    const moved = multiply(lattice.frac, applyCopy(screw, multiply(lattice.orth, point)));
    [-0.1, 0.7, -0.3].forEach((value, index) => assert.ok(Math.abs(moved[index] - value) < 1e-9));
    assert.equal(copyLabel(screw), "2₁ screw axis along b");
    assert.equal(copyLabel(referenceCopy(lattice)), "Reference molecule");
  });

  it("writes whole-cell shifts into the operation", () => {
    assert.equal(shiftedTriplet(parseOperation("-x,y+1/2,-z"), [1, -1, 0]), "-x+1,y-1/2,-z");
    assert.equal(shiftedTriplet(parseOperation("x,y,z"), [0, 0, 2]), "x,y,z+2");
  });
});

describe("packing analysis", () => {
  const lattice = makeLattice(crambin.cell!, P21);
  const summary = analysePacking(crambin.atoms, nearbyCopies(lattice, crambin.atoms));

  it("finds crambin's ten neighbours, each paired with the copy made by the inverse move", () => {
    assert.equal(summary.totals.neighbours, 10);
    const counts = summary.contacts.map((contact) => contact.atomContacts).sort((a, b) => a - b);
    for (let index = 0; index < counts.length; index += 2) assert.equal(counts[index], counts[index + 1]);
  });

  it("agrees with gemmi's ContactSearch (4.5 Å, contacts with symmetry-related copies)", () => {
    // gemmi 0.7 lists each pair once and skips copies that are only whole-cell
    // translations; it finds 86 atom pairs for 1CRN.
    const symmetryOnly = summary.contacts.filter((contact) => contact.copy.element.kind !== "identity");
    assert.equal(symmetryOnly.reduce((sum, contact) => sum + contact.atomContacts, 0) / 2, 86);
  });

  it("calls overlapping atoms clashes and close N/O pairs possible hydrogen bonds", () => {
    assert.equal(classifyPair("C", "C", 2.9), "clash");
    assert.equal(classifyPair("C", "C", 3.1), null);
    assert.equal(classifyPair("N", "O", 2.9), "hbond");
    assert.equal(classifyPair("O", "O", 2.0), "clash");
    assert.equal(classifyPair("N", "O", 3.6), null);
    assert.ok(summary.totals.hbonds > 0);
  });

  it("counts interface residues on both sides", () => {
    const biggest = summary.contacts.find((contact) => contact.atomContacts > 0)!;
    assert.ok(biggest.referenceResidues.length > 0 && biggest.mateResidues.length > 0);
    assert.deepEqual(viewerResidues([{ chain: "A", seq: 7 }], 3), [{ labelAsymId: "A-3", labelSeqId: 7 }]);
    assert.deepEqual(parseCopyChain("A-3"), { chain: "A", copy: 3 });
    assert.deepEqual(parseCopyChain("A"), { chain: "A", copy: 0 });
  });
});

describe("hypothetical cells", () => {
  it("grows the cell until the copies stop clashing", () => {
    const group = findSpaceGroup("P 21 21 21")!;
    const { cell, clashes } = suggestCell(crambin.atoms, group);
    assert.equal(clashes, 0);
    assert.deepEqual([cell.alpha, cell.beta, cell.gamma], [90, 90, 90]);
    const placed = placeInCell(crambin.atoms, cell, group);
    assert.equal(analysePacking(placed, nearbyCopies(makeLattice(cell, group), placed)).totals.clashes, 0);
  });

  it("puts the model where its own copies are farthest away", () => {
    // P 43 21 2 has two-fold axes on the cell diagonals; the chosen point keeps clear of all of them.
    const group = findSpaceGroup("P 43 21 2")!;
    const cell = { a: 60, b: 60, c: 70, alpha: 90, beta: 90, gamma: 90 };
    const lattice = makeLattice(cell, group);
    const point = multiply(lattice.orth, generalPosition(group, cell));
    for (const copy of unitCellCopies(lattice, [atom({ x: point[0], y: point[1], z: point[2] })]).slice(1)) {
      const image = applyCopy(copy, point);
      assert.ok(Math.hypot(image[0] - point[0], image[1] - point[1], image[2] - point[2]) > 12);
    }
  });

  it("can leave out AlphaFold's low-confidence residues", () => {
    assert.deepEqual(confidentAtoms([atom({ b: 92 }), atom({ b: 31 })]).map((item) => item.b), [92]);
  });
});

describe("the lattice file for Mol*", () => {
  it("holds every copy as its own chains", () => {
    const lattice = makeLattice(crambin.cell!, P21);
    const copies = [referenceCopy(lattice), ...unitCellCopies(lattice, crambin.atoms).slice(1)];
    const reread = parseMmcif(latticeMmcif(crambin.atoms, copies, "1CRN"));
    assert.equal(reread.atoms.length, crambin.atoms.length * 2);
    assert.deepEqual([...new Set(reread.atoms.map((item) => item.chain))], ["A", "A-1"]);
    assert.equal(reread.atoms[0].x, Number(crambin.atoms[0].x.toFixed(3)));
  });
});

describe("learning examples", () => {
  it("name real space groups, the right number of copies, and a registered paper", () => {
    for (const example of CRYSTAL_EXAMPLES) {
      const group = findSpaceGroup(example.spaceGroup);
      assert.ok(group?.sohncke, example.pdbId);
      assert.equal(multiplicity(group!), example.copiesPerCell, example.pdbId);
      assert.ok(citations[example.citation], example.pdbId);
    }
    for (const symbol of ["P 21 21 21", "I 2 2 2", "P 41 21 2"]) assert.ok(CRYSTAL_EXAMPLES.some((example) => example.spaceGroup === symbol), symbol);
  });
});
