// Layout guarantees for the project tree view.
// Run with `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  DEFAULT_LAYOUT, LABEL_HEIGHT, LABEL_WIDTH,
  canReparent, descendantsOf, fitToViewport, labelRowOffset, layoutProjectTree, type GraphEdgeInput,
} from "./project-tree-layout.ts";

const edge = (id: string, from: string, to: string): GraphEdgeInput => ({ id, fromProjectId: from, toProjectId: to });

/** Every pair of nodes sharing a layer, left to right. */
function layerPairs(nodes: { id: string; x: number; depth: number }[]) {
  const layers = new Map<number, { id: string; x: number }[]>();
  for (const node of nodes) layers.set(node.depth, [...(layers.get(node.depth) ?? []), node]);
  const pairs: [{ id: string; x: number }, { id: string; x: number }][] = [];
  for (const layer of layers.values()) {
    const sorted = [...layer].sort((a, b) => a.x - b.x);
    for (let index = 1; index < sorted.length; index += 1) pairs.push([sorted[index - 1], sorted[index]]);
  }
  return pairs;
}

describe("layoutProjectTree", () => {
  it("places a lone root at the origin", () => {
    const layout = layoutProjectTree("root", []);
    assert.deepEqual(layout.nodes.map((node) => [node.id, node.x, node.y, node.depth]), [["root", 0, 0, 0]]);
    assert.equal(layout.width, DEFAULT_LAYOUT.nodeWidth);
    assert.equal(layout.layerCount, 1);
  });

  it("returns an empty layout when there is nothing to draw", () => {
    assert.deepEqual(layoutProjectTree("", []).nodes, []);
  });

  it("puts children one layer below and centres the parent over them", () => {
    const layout = layoutProjectTree("root", [edge("1", "root", "a"), edge("2", "root", "b")]);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    assert.equal(byId.get("a")?.depth, 1);
    assert.equal(byId.get("b")?.depth, 1);
    assert.equal(byId.get("root")?.y, 0);
    assert.equal(byId.get("a")?.y, DEFAULT_LAYOUT.nodeHeight + DEFAULT_LAYOUT.gapY);
    const centre = ((byId.get("a") as { x: number }).x + (byId.get("b") as { x: number }).x) / 2;
    assert.ok(Math.abs((byId.get("root") as { x: number }).x - centre) < 1, "root sits between its children");
  });

  it("drops a node below both of its parents when a project has two", () => {
    // root → a, root → b, a → d, b → d: the classic diamond.
    const layout = layoutProjectTree("root", [
      edge("1", "root", "a"), edge("2", "root", "b"), edge("3", "a", "d"), edge("4", "b", "d"),
    ]);
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    assert.equal(byId.get("d")?.depth, 2);
    assert.deepEqual(byId.get("d")?.parents, ["a", "b"]);
    // Only the second parent link is dashed; the first reads as the main line.
    const secondary = layout.edges.filter((item) => item.secondary).map((item) => item.id);
    assert.deepEqual(secondary, ["4"]);
  });

  it("marks a layer-skipping edge as secondary", () => {
    const layout = layoutProjectTree("root", [
      edge("1", "root", "a"), edge("2", "a", "b"), edge("3", "root", "b"),
    ]);
    assert.equal(layout.edges.find((item) => item.id === "3")?.secondary, true);
  });

  it("drops self links, duplicates and links that would close a cycle", () => {
    const layout = layoutProjectTree("root", [
      edge("self", "a", "a"),
      edge("1", "root", "a"),
      edge("dup", "root", "a"),
      edge("2", "a", "b"),
      edge("cycle", "b", "root"),
    ]);
    assert.deepEqual(layout.droppedEdgeIds.sort(), ["cycle", "dup", "self"]);
    assert.deepEqual(layout.edges.map((item) => item.id), ["1", "2"]);
  });

  it("reports projects that no longer hang off the root", () => {
    // `b → c` with `b` unreachable still lays out, because both are roots of
    // their own component; a true orphan only appears when a cycle isolates it.
    const layout = layoutProjectTree("root", [edge("1", "b", "c")]);
    assert.deepEqual(layout.orphanIds, []);
    assert.deepEqual(layout.nodes.filter((node) => node.depth === 0).map((node) => node.id).sort(), ["b", "root"]);
  });

  it("never overlaps nodes, at 2 projects or at 30", () => {
    for (const count of [2, 30]) {
      const branches: GraphEdgeInput[] = [];
      for (let index = 1; index < count; index += 1) {
        // A bushy tree: each node parents up to three children.
        branches.push(edge(`e${index}`, `p${Math.floor((index - 1) / 3)}`, `p${index}`));
      }
      const layout = layoutProjectTree("p0", branches);
      assert.equal(layout.nodes.length, count, `${count} projects all placed`);
      for (const [left, right] of layerPairs(layout.nodes)) {
        assert.ok(
          right.x - left.x >= DEFAULT_LAYOUT.nodeWidth,
          `${count} projects: ${left.id} and ${right.id} overlap (${left.x} → ${right.x})`,
        );
      }
    }
  });

  it("never overlaps nodes in a wide fan", () => {
    const branches = Array.from({ length: 29 }, (_, index) => edge(`e${index}`, "root", `leaf${index}`));
    const layout = layoutProjectTree("root", branches);
    for (const [left, right] of layerPairs(layout.nodes)) {
      assert.ok(right.x - left.x >= DEFAULT_LAYOUT.nodeWidth, `${left.id}/${right.id} overlap`);
    }
    assert.ok(layout.width >= 29 * DEFAULT_LAYOUT.nodeWidth);
  });

  it("staggers branch labels that would sit on top of each other", () => {
    const branches = Array.from({ length: 6 }, (_, index) => edge(`e${index}`, "root", `leaf${index}`));
    // A label wider than the node pitch: neighbours cannot share a row.
    const layout = layoutProjectTree("root", branches, { labelWidth: 400 });
    const sorted = [...layout.edges].sort((a, b) => a.labelX - b.labelX);
    assert.ok(new Set(sorted.map((item) => item.labelRow)).size > 1, "labels use more than one stagger row");
    for (let index = 1; index < sorted.length; index += 1) {
      assert.notEqual(
        sorted[index].labelRow,
        sorted[index - 1].labelRow,
        `${sorted[index].id} shares a row with its neighbour`,
      );
    }
  });

  it("keeps narrow labels on one row", () => {
    const branches = Array.from({ length: 6 }, (_, index) => edge(`e${index}`, "root", `leaf${index}`));
    const layout = layoutProjectTree("root", branches, { labelWidth: 40 });
    assert.deepEqual([...new Set(layout.edges.map((item) => item.labelRow))], [0]);
  });

  it("anchors each branch label on the midpoint of its connector", () => {
    const layout = layoutProjectTree("root", [edge("1", "root", "a")]);
    const [connector] = layout.edges;
    const byId = new Map(layout.nodes.map((node) => [node.id, node]));
    const from = byId.get("root") as { x: number; y: number };
    const to = byId.get("a") as { x: number; y: number };
    assert.equal(connector.labelX, (from.x + to.x) / 2 + DEFAULT_LAYOUT.nodeWidth / 2);
    assert.equal(connector.labelY, (from.y + DEFAULT_LAYOUT.nodeHeight + to.y) / 2);
  });
});

describe("drag to re-parent", () => {
  const branches = [edge("1", "root", "a"), edge("2", "root", "b"), edge("3", "a", "c"), edge("4", "c", "d")];

  it("collects a whole subtree", () => {
    assert.deepEqual([...descendantsOf("a", branches)].sort(), ["c", "d"]);
    assert.deepEqual([...descendantsOf("d", branches)], []);
  });

  it("allows a move to an unrelated branch", () => {
    assert.equal(canReparent(branches[2], "b", branches), true);
  });

  it("refuses a move that would create a cycle", () => {
    // Re-parenting `a → c` onto `d` would put `c` under its own descendant.
    assert.equal(canReparent(branches[2], "d", branches), false);
  });

  it("refuses a no-op and a self-parent", () => {
    assert.equal(canReparent(branches[2], "a", branches), false);
    assert.equal(canReparent(branches[2], "c", branches), false);
    assert.equal(canReparent(branches[2], "", branches), false);
  });
});

describe("fitToViewport", () => {
  it("never scales a small tree above 1:1", () => {
    const fit = fitToViewport({ width: 200, height: 100 }, { width: 1200, height: 800 });
    assert.equal(fit.scale, 1);
    assert.equal(fit.offsetX, 500);
  });

  it("shrinks a wide tree to fit and keeps it centred", () => {
    const fit = fitToViewport({ width: 4000, height: 500 }, { width: 1000, height: 600 }, 50);
    assert.ok(fit.scale < 1 && fit.scale > 0.2);
    assert.ok(Math.abs(fit.offsetX - (1000 - 4000 * fit.scale) / 2) < 0.001);
  });

  it("clamps at the minimum scale so nodes never become unreadable", () => {
    const fit = fitToViewport({ width: 100000, height: 500 }, { width: 900, height: 650 });
    assert.equal(fit.scale, 0.2);
  });

  it("survives an empty tree", () => {
    const fit = fitToViewport({ width: 0, height: 0 }, { width: 900, height: 650 });
    assert.equal(fit.scale, 1);
  });
});

describe("labels never cover anything", () => {
  /** Rendered geometry of one branch label, matching the view's inline style. */
  function labelBox(edge: { labelX: number; labelY: number; labelRow: number }, rows: number) {
    const top = edge.labelY + labelRowOffset(edge.labelRow, rows) - LABEL_HEIGHT / 2;
    return { left: edge.labelX - LABEL_WIDTH / 2, right: edge.labelX + LABEL_WIDTH / 2, top, bottom: top + LABEL_HEIGHT };
  }
  const overlaps = (a: { left: number; right: number; top: number; bottom: number },
                    b: { left: number; right: number; top: number; bottom: number }) =>
    a.left < b.right && b.left < a.right && a.top < b.bottom && b.top < a.bottom;

  // A tree with a bushy middle, a two-parent node and a layer-skipping link —
  // all three are what used to push a label onto a node.
  const branches = [
    edge("1", "root", "a"), edge("2", "root", "b"), edge("3", "root", "c"),
    edge("4", "a", "d"), edge("5", "b", "d"), edge("6", "b", "e"), edge("7", "c", "f"),
    edge("8", "root", "f"), edge("9", "d", "g"), edge("10", "e", "g"),
  ];
  const layout = layoutProjectTree("root", branches);

  it("keeps every label clear of every node", () => {
    for (const item of layout.edges) {
      const box = labelBox(item, layout.labelRows);
      for (const node of layout.nodes) {
        const nodeBox = {
          left: node.x, right: node.x + DEFAULT_LAYOUT.nodeWidth,
          top: node.y, bottom: node.y + DEFAULT_LAYOUT.nodeHeight,
        };
        assert.ok(!overlaps(box, nodeBox), `label ${item.id} covers node ${node.id}`);
      }
    }
  });

  it("keeps labels in the same band clear of each other", () => {
    for (const a of layout.edges) {
      for (const b of layout.edges) {
        if (a.id >= b.id) continue;
        assert.ok(
          !overlaps(labelBox(a, layout.labelRows), labelBox(b, layout.labelRows)),
          `labels ${a.id} and ${b.id} overlap`,
        );
      }
    }
  });
});
