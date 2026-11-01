// The two diagrams, checked against the plates in International Tables Vol. A
// (the drawings the UCL space-group pages reproduce).
import assert from "node:assert/strict";
import { describe, it } from "vitest";
import {
  animationFrame, defaultCell, diagramFrame, elementDiagram, generalPositions,
} from "./space-group-diagram.ts";
import { SPACE_GROUPS, applyOperation, findSpaceGroup, groupElements, multiplicity, type SpaceGroup } from "./space-groups.ts";

const group = (symbol: string): SpaceGroup => {
  const found = findSpaceGroup(symbol);
  assert.ok(found, symbol);
  return found;
};

const frameFor = (symbol: string) => diagramFrame(defaultCell(group(symbol)));

describe("the drawn cell", () => {
  it("puts a down the page and b across it, with the origin at the top left", () => {
    const frame = diagramFrame({ a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 90 }, 200, 20);
    const near = (left: [number, number], right: [number, number]) =>
      assert.ok(Math.hypot(left[0] - right[0], left[1] - right[1]) < 1e-6, `${left} vs ${right}`);
    near(frame.corners[0], [20, 20]);
    const [, aCorner, , bCorner] = frame.corners;
    near(aCorner, [20, 220]);
    near(bCorner, [220, 20]);
    assert.equal(frame.width, 240);
    assert.equal(frame.height, 240);
  });

  it("leans a 120° cell the way the Tables print it, and still fits the box", () => {
    const frame = diagramFrame({ a: 1, b: 1, c: 1, alpha: 90, beta: 90, gamma: 120 }, 200, 20);
    const [, , , bCorner] = frame.corners;
    // b leans up and away from a, so its corner sits above the origin.
    assert.ok(bCorner[0] > 150, `b corner at ${bCorner}`);
    assert.ok(bCorner[1] < frame.corners[0][1] - 50, `b corner at ${bCorner}, origin at ${frame.corners[0]}`);
    for (const [x, y] of frame.corners) {
      assert.ok(x >= 0 && x <= frame.width && y >= 0 && y <= frame.height, `corner ${x},${y} outside ${frame.width}×${frame.height}`);
    }
  });

  it("uses a 120° cell for trigonal and hexagonal groups only", () => {
    assert.equal(defaultCell(group("P 31")).gamma, 120);
    assert.equal(defaultCell(group("P 61")).gamma, 120);
    assert.equal(defaultCell(group("R 3")).gamma, 120);
    assert.equal(defaultCell(group("P 21 21 21")).gamma, 90);
    assert.equal(defaultCell(group("P 43 21 2")).a, defaultCell(group("P 43 21 2")).b);
  });
});

describe("the symmetry-element diagram", () => {
  it("draws the four 2-fold axes of P2 at the cell corners and edge centres", () => {
    const frame = frameFor("P 1 2 1");
    const drawn = elementDiagram(group("P 1 2 1"), frame);
    assert.equal(drawn.length, 4, drawn.map((item) => item.id).join("\n"));
    assert.ok(drawn.every((item) => item.shape === "line" && item.symbol === "2"));
    // The axis runs along b, so every line is drawn across the page.
    for (const item of drawn) assert.ok(Math.abs(item.from![1] - item.to![1]) < 1e-9);
    assert.deepEqual([...new Set(drawn.map((item) => item.height ?? "0"))].sort(), ["0", "½"]);
  });

  it("draws the three screw axes of P212121, two in the page and one out of it", () => {
    const drawn = elementDiagram(group("P 21 21 21"), frameFor("P 21 21 21"));
    assert.ok(drawn.every((item) => item.symbol === "2₁" && item.shifted));
    const endOn = drawn.filter((item) => item.shape === "point");
    const inPage = drawn.filter((item) => item.shape === "line");
    assert.equal(endOn.length, 4, "four 2₁ axes along c inside one cell");
    assert.ok(endOn.every((item) => item.glyph === "lens"));
    assert.equal(inPage.length, 8, "four along a and four along b");
  });

  it("gives each axis order its own glyph", () => {
    const glyph = (symbol: string) => {
      const drawn = elementDiagram(group(symbol), frameFor(symbol));
      return drawn.find((item) => item.shape === "point" && item.order === Number(symbol.replace(/\D/g, "")[0]))?.glyph;
    };
    assert.equal(glyph("P 3"), "triangle");
    assert.equal(glyph("P 4"), "square");
    assert.equal(glyph("P 6"), "hexagon");
    assert.equal(elementDiagram(group("P 2 2 2"), frameFor("P 2 2 2")).find((item) => item.shape === "point")?.glyph, "lens");
  });

  it("draws a mirror plane as a line and a plane lying flat as a corner mark", () => {
    const mirror = elementDiagram(group("P 1 m 1"), frameFor("P 1 m 1"));
    assert.ok(mirror.every((item) => item.symbol === "m" && item.shape === "line"));
    assert.equal(mirror.length, 2, "planes at y = 0 and y = ½");
    const flat = elementDiagram(group("P 4/m"), frameFor("P 4/m")).filter((item) => item.shape === "face");
    assert.ok(flat.length > 0, "the m perpendicular to c lies flat on the page");
    assert.equal(flat[0].symbol, "m");
  });

  it("marks glide planes as shifted so they can be drawn dashed", () => {
    const drawn = elementDiagram(group("P 1 c 1"), frameFor("P 1 c 1"));
    assert.ok(drawn.length > 0);
    assert.ok(drawn.every((item) => item.symbol === "c" && item.shifted));
  });

  it("draws something for every one of the 230 groups without a bad coordinate", () => {
    for (const entry of SPACE_GROUPS) {
      const frame = diagramFrame(defaultCell(entry));
      const drawn = elementDiagram(entry, frame);
      assert.ok(drawn.length > 0 || entry.n === 1, `${entry.short} drew nothing`);
      for (const item of drawn) {
        const points = [item.at, item.from, item.to].filter(Boolean) as [number, number][];
        for (const [x, y] of points) assert.ok(Number.isFinite(x) && Number.isFinite(y), `${entry.short}: ${item.id}`);
        assert.ok(item.symbol.length > 0, `${entry.short}: ${item.kind} has no symbol`);
      }
    }
  });

  it("keeps the densest diagram inside a drawable number of elements", () => {
    const worst = SPACE_GROUPS.map((entry) => ({
      short: entry.short,
      count: elementDiagram(entry, diagramFrame(defaultCell(entry))).length,
    })).sort((left, right) => right.count - left.count)[0];
    // The cubic plates in the Tables are this dense as well: Fm-3c draws 506.
    assert.ok(worst.count <= 600, `${worst.short} draws ${worst.count} elements`);
  });
});

describe("the general-position diagram", () => {
  it("draws one copy per operation, all inside the cell", () => {
    for (const symbol of ["P 1", "P 21 21 21", "C 1 2 1", "P 43 21 2", "R 3", "P 61 2 2"]) {
      const entry = group(symbol);
      const positions = generalPositions(entry, frameFor(symbol));
      assert.equal(positions.length, multiplicity(entry), symbol);
      for (const position of positions) {
        assert.ok(position.point[0] >= 0 && position.point[0] < 1, symbol);
        assert.ok(position.point[1] >= 0 && position.point[1] < 1, symbol);
      }
    }
  });

  it("marks no copy as a mirror image in a Sohncke group, and half of them otherwise", () => {
    assert.ok(generalPositions(group("P 21 21 21"), frameFor("P 21 21 21")).every((position) => !position.mirrored));
    const centric = generalPositions(group("P -1"), frameFor("P -1"));
    assert.deepEqual(centric.map((position) => position.mirrored), [false, true]);
  });

  it("labels heights the way the Tables do", () => {
    const positions = generalPositions(group("P 21 21 21"), frameFor("P 21 21 21"));
    // International Tables, No. 19: x,y,z is +; -x+½,-y,z+½ is ½+;
    // x+½,-y+½,-z is −; -x,y+½,-z+½ is ½−.
    assert.deepEqual(positions.map((position) => position.height), ["+", "½+", "\u2212", "½\u2212"]);
    assert.deepEqual(generalPositions(group("P 1"), frameFor("P 1")).map((position) => position.height), ["+"]);
  });

  it("turns the motif with the operation and flips it for a mirror", () => {
    const [, turned] = generalPositions(group("P 4"), frameFor("P 4"));
    // A quarter turn about c in a square cell swaps the two screen axes.
    assert.ok(Math.abs(turned.transform.a) < 1e-9 && Math.abs(turned.transform.b) > 0.9);
    const [, mirrored] = generalPositions(group("P 1 m 1"), frameFor("P 1 m 1"));
    assert.ok(mirrored.transform.a * mirrored.transform.d - mirrored.transform.b * mirrored.transform.c < 0, "a reflection reverses the drawing");
  });

  it("writes each copy's coordinate triplet", () => {
    const positions = generalPositions(group("P 21 21 21"), frameFor("P 21 21 21"));
    assert.deepEqual(positions.map((position) => position.triplet), [
      "x, y, z", "-x+½, -y, z+½", "x+½, -y+½, -z", "-x, y+½, -z+½",
    ]);
  });
});

describe("stepping an operation on the diagram", () => {
  it("swings a copy round the axis and lands exactly on the next copy", () => {
    const entry = group("P 4");
    const frame = frameFor("P 4");
    const element = groupElements(entry).find((item) => item.order === 4)!;
    const end = animationFrame(element, 1, frame);
    // The arc has to end exactly where the operation sends the copy. The copy
    // may leave the cell: the diagram draws the lattice-equivalent one inside.
    const exact = frame.project(applyOperation(element.op, [0.22, 0.14, 0.12]));
    assert.ok(Math.hypot(end.at[0] - exact[0], end.at[1] - exact[1]) < 1e-6, `arc ended at ${end.at}, operation sends it to ${exact}`);
    const wrapped = generalPositions(entry, frame).some((position) =>
      Math.abs(position.point[0] - (end.point[0] - Math.floor(end.point[0]))) < 1e-9);
    assert.ok(wrapped, "the copy it lands on is one of the general positions");
    const middle = animationFrame(element, 0.5, frame);
    assert.ok(Math.abs(Math.abs(middle.degrees) - 45) < 1e-9, `half a quarter turn is 45°, got ${middle.degrees}`);
  });

  it("slides a screw axis along c while it turns", () => {
    const entry = group("P 61");
    const element = groupElements(entry).find((item) => item.kind === "screw")!;
    const end = animationFrame(element, 1, frameFor("P 61"));
    assert.ok(Math.abs(end.point[2] - (0.12 + 1 / 6)) < 1e-9, `height ${end.point[2]}`);
  });

  it("only turns a copy in the page when the axis comes out of the page", () => {
    const entry = group("P 1 21 1");
    const element = groupElements(entry).find((item) => item.kind === "screw")!;
    const end = animationFrame(element, 1, frameFor("P 1 21 1"));
    assert.equal(end.degrees, 0, "a 2₁ along b turns the protein through the page");
    assert.ok(Math.abs(end.point[1] - (0.14 + 0.5)) < 1e-9);
  });

  it("shows an improper operation as a flip once it is past half way", () => {
    const element = groupElements(group("P 1 m 1")).find((item) => item.kind === "mirror")!;
    const frame = frameFor("P 1 m 1");
    assert.equal(animationFrame(element, 0.2, frame).mirrored, false);
    assert.equal(animationFrame(element, 1, frame).mirrored, true);
  });
});
