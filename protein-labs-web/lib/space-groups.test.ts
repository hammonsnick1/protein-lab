// The generated table and the geometry read off it. Expected values come from
// International Tables for Crystallography Vol. A (2016), the same diagrams
// the UCL space-group pages draw.
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  CRYSTAL_SYSTEM_ORDER, DEN, SOHNCKE_GROUPS, SPACE_GROUPS,
  applyOperation, axisName, composeOperations, describeOperation, elementPosition, elementSentence,
  findSpaceGroup, fractionText, groupElements, groupOperations, matrixOrder, multiplicity,
  operationSteps, operationTriplet, parseOperation, searchSpaceGroups, spaceGroupByNumber,
  spaceGroupKey, spaceGroupSummary, symbolText, symbolTokens, type SpaceGroup, type SymmetryElement,
} from "./space-groups.ts";

const group = (symbol: string): SpaceGroup => {
  const found = findSpaceGroup(symbol);
  assert.ok(found, `no space group "${symbol}"`);
  return found;
};

/** The element of a group whose symbol and axis match, for the checks below. */
function elementOf(symbol: string, label: string, axis: string): SymmetryElement {
  const found = groupElements(group(symbol)).find((element) =>
    element.symbol === label && element.axis !== null && axisName(element.axis) === axis);
  assert.ok(found, `${symbol} has no ${label} along ${axis}`);
  return found;
}

describe("the generated space-group table", () => {
  it("holds all 230 settings with the 65 Sohncke groups flagged", () => {
    assert.equal(SPACE_GROUPS.length, 230);
    assert.deepEqual(SPACE_GROUPS.map((entry) => entry.n), Array.from({ length: 230 }, (_, index) => index + 1));
    assert.equal(SOHNCKE_GROUPS.length, 65);
    assert.equal(SPACE_GROUPS.filter((entry) => entry.pair !== null).length, 22);
    assert.deepEqual([...new Set(SPACE_GROUPS.map((entry) => entry.system))].sort(), [...CRYSTAL_SYSTEM_ORDER].sort());
  });

  it("names both members of every enantiomorphic pair", () => {
    for (const entry of SPACE_GROUPS) {
      if (entry.pair === null) continue;
      assert.equal(spaceGroupByNumber(entry.pair)?.pair, entry.n, `${entry.short} pairs with ${entry.pair}`);
    }
  });

  it("agrees with the groups a protein crystallographer meets", () => {
    assert.equal(group("P 21 21 21").n, 19);
    assert.equal(group("p212121").n, 19);
    assert.equal(group("19").n, 19);
    assert.equal(group("P1211").n, 4);
    assert.equal(group("P21").n, 4);
    assert.equal(group("C2").n, 5);
    assert.equal(group("H 3").short, "R3");
    assert.equal(group("H32").n, 155);
    assert.equal(findSpaceGroup("not a group"), null);
    assert.equal(spaceGroupKey("H 3 2"), "R32");
    assert.equal(multiplicity(group("P 21 21 21")), 4);
    assert.equal(multiplicity(group("F 41 3 2")), 96);
    assert.equal(multiplicity(group("R 3")), 9);
    assert.equal(multiplicity(group("P 1")), 1);
  });

  it("typesets the Hermann-Mauguin symbol with its subscripts and bars", () => {
    assert.deepEqual(symbolTokens(group("P 21 21 21")), [
      { text: "P" }, { text: "2", subscript: "1", bar: false },
      { text: "2", subscript: "1", bar: false }, { text: "2", subscript: "1", bar: false },
    ]);
    assert.deepEqual(symbolTokens(group("P 1 21 1")), [{ text: "P" }, { text: "2", subscript: "1", bar: false }]);
    assert.deepEqual(symbolTokens(group("P 1")), [{ text: "P" }, { text: "1", subscript: undefined, bar: false }]);
    assert.deepEqual(symbolTokens(group("I 41/a")), [
      { text: "I" }, { text: "4", subscript: "1", bar: false }, { text: "/" }, { text: "a" },
    ]);
    assert.deepEqual(symbolTokens(group("P n -3 n")), [
      { text: "P" }, { text: "n" }, { text: "3", subscript: undefined, bar: true }, { text: "n" },
    ]);
    assert.equal(symbolText(group("P 21 21 21")), "P2\u20812\u20812\u2081");
    assert.equal(symbolText(group("P 43 21 2")), "P4\u20832\u20812");
    assert.equal(symbolText(group("P n -3 n")), "Pn3\u0305n");
    // Every group must come out as something a reader can match to the table.
    for (const entry of SPACE_GROUPS) {
      assert.ok(symbolText(entry).replace(/[\u0305\u2080-\u2089]/g, "").length >= 2, entry.hm);
    }
  });

  it("searches by symbol, number, system and point group", () => {
    assert.deepEqual(searchSpaceGroups(SOHNCKE_GROUPS, "p21").map((entry) => entry.short), ["P21", "P21212", "P212121", "P213"]);
    assert.ok(searchSpaceGroups(SPACE_GROUPS, "cubic").every((entry) => entry.system === "cubic"));
    assert.deepEqual(searchSpaceGroups(SPACE_GROUPS, "19").map((entry) => entry.n), [19]);
    // "222" is a point group, part of several symbols, and group number 222.
    assert.deepEqual(searchSpaceGroups(SPACE_GROUPS, "222").filter((entry) => entry.pointGroup !== "222" && !entry.short.includes("222") && entry.n !== 222).map((entry) => entry.short), []);
    assert.ok(searchSpaceGroups(SPACE_GROUPS, "222").some((entry) => entry.short === "C222"));
    assert.equal(searchSpaceGroups(SOHNCKE_GROUPS, "  ").length, 65);
  });
});

describe("symmetry operations", () => {
  it("reads and writes every triplet in the table unchanged", () => {
    for (const entry of SPACE_GROUPS) {
      for (const triplet of entry.ops) {
        assert.equal(operationTriplet(parseOperation(triplet)), triplet, `${entry.short}: ${triplet}`);
      }
    }
  });

  it("reads a triplet into an exact matrix and translation", () => {
    assert.deepEqual(parseOperation("-x+1/2,-y,z+1/2"), {
      matrix: [[-1, 0, 0], [0, -1, 0], [0, 0, 1]],
      translation: [6, 0, 6],
    });
    assert.deepEqual(parseOperation("-y,x-y,z+2/3"), {
      matrix: [[0, -1, 0], [1, -1, 0], [0, 0, 1]],
      translation: [0, 0, 8],
    });
    assert.throws(() => parseOperation("x,y"));
  });

  it("moves a point the way the triplet says", () => {
    assert.deepEqual(applyOperation(parseOperation("-x+1/2,-y,z+1/2"), [0.1, 0.2, 0.3]), [0.4, -0.2, 0.8]);
  });

  it("builds the whole group, closed under composition", () => {
    for (const entry of [group("P 21 21 21"), group("C 1 2 1"), group("P 43 21 2"), group("R 3"), group("I 4 2 2")]) {
      const operations = groupOperations(entry);
      assert.equal(operations.length, multiplicity(entry));
      const keys = new Set(operations.map(operationTriplet));
      assert.equal(keys.size, operations.length, `${entry.short} repeats an operation`);
      for (const left of operations) {
        for (const right of operations) {
          const product = composeOperations(left, right);
          const reduced = {
            matrix: product.matrix,
            translation: product.translation.map((value) => ((value % DEN) + DEN) % DEN) as [number, number, number],
          };
          assert.ok(keys.has(operationTriplet(reduced)), `${entry.short} is not closed: ${operationTriplet(reduced)}`);
        }
      }
    }
  });

  it("keeps every intrinsic translation an exact number of twelfths", () => {
    for (const entry of SPACE_GROUPS) {
      for (const element of groupElements(entry)) {
        for (const value of element.intrinsic) {
          assert.ok(Math.abs(value - Math.round(value)) < 1e-9, `${entry.short}: intrinsic ${value}/12`);
        }
      }
    }
  });

  it("gives the order of a rotation part", () => {
    assert.equal(matrixOrder(parseOperation("x,y,z").matrix), 1);
    assert.equal(matrixOrder(parseOperation("-x,-y,z").matrix), 2);
    assert.equal(matrixOrder(parseOperation("-y,x,z").matrix), 4);
    assert.equal(matrixOrder(parseOperation("-y,x-y,z").matrix), 3);
    assert.equal(matrixOrder(parseOperation("x-y,x,z").matrix), 6);
  });

  it("writes twelfths as the fraction a reader expects", () => {
    assert.deepEqual([0, 3, 4, 6, 8, 9, 10, 12].map(fractionText), ["0", "1/4", "1/3", "1/2", "2/3", "3/4", "5/6", "1"]);
  });
});

describe("what each operation does", () => {
  it("places the three screw axes of P212121 where the Tables put them", () => {
    const elements = groupElements(group("P 21 21 21"));
    assert.equal(elements.length, 4);
    assert.deepEqual(elements.map((element) => element.kind), ["identity", "screw", "screw", "screw"]);
    assert.equal(elementPosition(elementOf("P 21 21 21", "2₁", "a")), "(x, ¼, 0)");
    assert.equal(elementPosition(elementOf("P 21 21 21", "2₁", "b")), "(0, y, ¼)");
    assert.equal(elementPosition(elementOf("P 21 21 21", "2₁", "c")), "(¼, 0, z)");
    for (const element of elements) assert.ok(element.rigid);
  });

  it("tells a pure rotation from a screw axis", () => {
    const rotation = elementOf("P 2 2 2", "2", "c");
    assert.equal(rotation.kind, "rotation");
    assert.equal(rotation.shift, 0);
    assert.equal(elementPosition(rotation), "(0, 0, z)");
    const screw = elementOf("P 21 21 21", "2₁", "c");
    assert.equal(screw.kind, "screw");
    assert.equal(screw.shift, 0.5);
    assert.deepEqual(screw.intrinsic, [0, 0, 6]);
  });

  it("labels 4-fold and 3-fold screws by how far they climb", () => {
    assert.equal(elementOf("P 41", "4₁", "c").shift, 0.25);
    assert.equal(elementOf("P 42", "4₂", "c").shift, 0.5);
    assert.equal(elementOf("P 43", "4₃", "c").shift, 0.75);
    assert.equal(elementOf("P 31", "3₁", "c").shift, 1 / 3);
    assert.equal(elementOf("P 65", "6₅", "c").shift, 5 / 6);
  });

  it("turns 31 and 32 the opposite way, which is what makes them a pair", () => {
    assert.equal(elementOf("P 31", "3₁", "c").sense, 1);
    assert.equal(elementOf("P 32", "3₂", "c").sense, 1);
    assert.equal(group("P 31").pair, 145);
    // A right-handed 31 and a left-handed 32 climb by different fractions.
    assert.equal(elementOf("P 32", "3₂", "c").shift, 2 / 3);
  });

  it("reads mirror and glide planes, and marks them as impossible for a protein", () => {
    const mirror = elementOf("P 1 m 1", "m", "b");
    assert.equal(mirror.kind, "mirror");
    assert.equal(mirror.rigid, false);
    assert.equal(elementPosition(mirror), "(x, 0, z)");
    const glide = elementOf("P 1 c 1", "c", "b");
    assert.equal(glide.kind, "glide");
    assert.deepEqual(glide.intrinsic, [0, 0, 6]);
    const diagonal = groupElements(group("P n n 2")).find((element) => element.kind === "glide");
    assert.equal(diagonal?.symbol, "n");
    const inversion = groupElements(group("P -1")).find((element) => element.kind === "inversion");
    assert.equal(inversion?.rigid, false);
    assert.equal(elementPosition(inversion!), "(0, 0, 0)");
  });

  it("holds the line that leaves exactly 65 groups for proteins", () => {
    for (const entry of SPACE_GROUPS) {
      const elements = groupElements(entry);
      assert.equal(elements.every((element) => element.rigid), entry.sohncke, entry.short);
    }
  });

  it("reads the centring translations as extra copies", () => {
    const centring = groupElements(group("C 1 2 1")).filter((element) => element.kind === "translation");
    assert.equal(centring.length, 1);
    assert.deepEqual(centring[0].intrinsic, [6, 6, 0]);
    assert.match(elementSentence(centring[0]), /lattice centring/);
    assert.equal(groupElements(group("R 3")).filter((element) => element.kind === "translation").length, 2);
  });

  it("names axis directions the way a crystallographer writes them", () => {
    assert.equal(axisName([0, 0, 1]), "c");
    assert.equal(axisName([1, 1, 0]), "[110]");
    assert.equal(axisName([1, -1, 0]), "[11\u03050]");
  });

  it("writes a sentence for every operation of every group", () => {
    for (const entry of SPACE_GROUPS) {
      for (const element of groupElements(entry)) {
        const sentence = elementSentence(element, { a: 38.2, b: 45.1, c: 62.7, alpha: 90, beta: 90, gamma: 90 });
        assert.ok(sentence.length > 20 && !sentence.includes("undefined") && !sentence.includes("NaN"), `${entry.short}: ${sentence}`);
      }
    }
  });

  it("summarises a group in a sentence a student can read", () => {
    const summary = spaceGroupSummary(group("P 21 21 21"));
    assert.match(summary.packing, /4 copies/);
    assert.match(summary.packing, /2₁/);
    assert.match(summary.handedness, /one of the 65/);
    assert.match(spaceGroupSummary(group("C 1 2 1")).packing, /C centring adds 1 more/);
  });

  // The packing numbers are read off the gemmi-generated table; the handedness
  // rule belongs to International Tables. The panel cites them separately, so
  // they have to stay in separate strings (HOM-362).
  it("keeps the packing facts and the handedness rule apart", () => {
    const summary = spaceGroupSummary(group("P 21 21 21"));
    assert.doesNotMatch(summary.packing, /handedness|Sohncke/);
    assert.doesNotMatch(summary.handedness, /No\. 19|asymmetric unit into one unit cell/);
  });

  // A racemic mixture of L- and D-chains really does crystallise in the
  // centrosymmetric groups, so no sentence may say proteins never do.
  it("scopes the centrosymmetric groups to natural L-protein instead of saying never", () => {
    const { handedness } = spaceGroupSummary(group("P m m m"));
    assert.match(handedness, /natural L-protein/);
    assert.match(handedness, /racemic/);
    for (const entry of SPACE_GROUPS) {
      assert.doesNotMatch(spaceGroupSummary(entry).handedness, /\bnever\b/, entry.short);
    }
  });

  it("says a protein cannot mirror without claiming it never happens", () => {
    for (const entry of SPACE_GROUPS) {
      for (const element of groupElements(entry)) {
        if (element.rigid) continue;
        const sentence = elementSentence(element);
        const where = `${entry.short} ${element.symbol}`;
        assert.doesNotMatch(sentence, /\bnever\b/, where);
        assert.match(sentence, /L-amino acid|L-protein/, where);
      }
    }
  });
});

describe("stepping through one operation", () => {
  it("walks a screw axis one turn at a time and lands a cell further on", () => {
    const steps = operationSteps(elementOf("P 21 21 21", "2₁", "c"), { a: 38.2, b: 45.1, c: 62.7, alpha: 90, beta: 90, gamma: 90 });
    assert.equal(steps.length, 2);
    assert.deepEqual(steps.map((step) => step.degrees), [180, 180]);
    assert.deepEqual(steps[0].slide, [0, 0, 0.5]);
    assert.match(steps[0].caption, /Step 1: turn a half turn \(180°\) about c and slide ½ along c \(31\.4 Å\)/);
    assert.match(steps[1].caption, /one whole cell along c/);
    const start: [number, number, number] = [0.22, 0.14, 0.12];
    assert.ok(steps[1].position.every((value, index) => Math.abs(value - (start[index] + (index === 2 ? 1 : 0))) < 1e-9));
  });

  it("gives an improper operation one step and says why it cannot be animated", () => {
    const mirror = groupElements(group("P 1 m 1")).find((element) => element.kind === "mirror")!;
    const steps = operationSteps(mirror);
    assert.equal(steps.length, 1);
    assert.equal(steps[0].mirrored, true);
    assert.equal(steps[0].degrees, 0);
    assert.match(steps[0].caption, /mirror image/);
  });

  it("gives a 3-fold three steps and a 6-fold six", () => {
    assert.equal(operationSteps(elementOf("P 31", "3₁", "c")).length, 3);
    assert.equal(operationSteps(elementOf("P 61", "6₁", "c")).length, 6);
    assert.equal(operationSteps(describeOperation(parseOperation("x,y,z"))).length, 1);
  });
});
