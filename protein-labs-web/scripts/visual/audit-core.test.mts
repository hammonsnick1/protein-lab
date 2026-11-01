import { describe, expect, it } from "vitest";
// The rules are plain JS so the harness can run them under bare `node` in the
// browser-driving scripts; the tests are the only typed consumer.
import { auditFindings, TEXT_FLOOR_PX } from "./audit-core.mjs";

type Record_ = Record<string, unknown>;

const VIEWPORT = { scrollWidth: 1440, width: 1440 };

/** One measured element, with the shape audit.mjs produces. */
const element = (over: Record_ = {}): Record_ => ({
  tag: "DIV",
  cls: "thing",
  text: "",
  fontSize: 13,
  overflowX: "visible",
  textOverflow: "clip",
  scrollWidth: 200,
  clientWidth: 200,
  right: 400,
  hasOwnText: false,
  hScrollAllowed: false,
  inHScroller: false,
  clip: null,
  parent: null,
  ...over,
});

const run = (elements: Record_[], page: Record_ = VIEWPORT) => auditFindings({ elements, page }, { limit: 50 });

describe("content wider than its box", () => {
  // The HOM-332 regression: a chip row whose text is entirely in child <span>s
  // has no direct text node, and the old audit's `own` gate skipped it.
  it("reports a row that overflows even though it owns no text node", () => {
    const findings = run([
      element({ tag: "BUTTON", cls: "sg-list-system", text: "P212121 predicted homologue", scrollWidth: 237, clientWidth: 234, hasOwnText: false }),
    ]);
    expect(findings).toEqual(["wide BUTTON.sg-list-system +3px P212121 predicted homologue"]);
  });

  it("calls it clipped when the box actually cuts the content off", () => {
    expect(run([element({ overflowX: "hidden", scrollWidth: 237, clientWidth: 234 })])).toEqual(["clip DIV.thing +3px"]);
  });

  it("reports an overflow of 2px but tolerates sub-pixel rounding", () => {
    expect(run([element({ scrollWidth: 202, clientWidth: 200 })])).toHaveLength(1);
    expect(run([element({ scrollWidth: 201, clientWidth: 200 })])).toEqual([]);
  });

  it("stays quiet when the author asked for an ellipsis", () => {
    expect(run([element({ overflowX: "hidden", scrollWidth: 260, clientWidth: 200, textOverflow: "ellipsis" })])).toEqual([]);
  });

  it("ignores a collapsed box with no width to overflow", () => {
    expect(run([element({ scrollWidth: 260, clientWidth: 0 })])).toEqual([]);
  });

  // A visible box's scrollWidth includes its descendants' overflow, so one
  // long label used to accuse every wrapper between it and the clipping box.
  // Boxes in such a chain all start at the same x and their content reaches
  // the same point, which is what identifies them as one problem.
  it("blames only the innermost wrapper in a chain", () => {
    const wrapper = (cls: string, parent: number | null) => element({ cls, parent, scrollWidth: 312, clientWidth: 200, reach: 312 });
    expect(run([wrapper("chain-a", null), wrapper("chain-b", 0), wrapper("chain-c", 1)])).toEqual(["wide DIV.chain-c +112px"]);
  });

  it("still names the box that does the clipping", () => {
    const findings = run([
      element({ cls: "col", overflowX: "hidden", scrollWidth: 312, clientWidth: 200, reach: 312 }),
      element({ cls: "inner", parent: 0, scrollWidth: 312, clientWidth: 200, reach: 312 }),
    ]);
    expect(findings).toEqual(["clip DIV.col +112px", "wide DIV.inner +112px"]);
  });

  it("yields a clipping box to a nested clipping box", () => {
    const findings = run([
      element({ cls: "outer", overflowX: "hidden", scrollWidth: 312, clientWidth: 200, reach: 312 }),
      element({ cls: "inner", overflowX: "hidden", parent: 0, scrollWidth: 312, clientWidth: 200, reach: 312 }),
    ]);
    expect(findings).toEqual(["clip DIV.inner +112px"]);
  });

  it("keeps a wrapper whose child overflows by less", () => {
    const findings = run([
      element({ cls: "outer", scrollWidth: 312, clientWidth: 200, reach: 312 }),
      element({ cls: "inner", parent: 0, scrollWidth: 204, clientWidth: 200, reach: 204 }),
    ]);
    expect(findings).toEqual(["wide DIV.outer +112px", "wide DIV.inner +4px"]);
  });

  // A chip that spills 73px *inside* a 200px row is not the reason the row is
  // 20px too wide. Comparing overflow amounts rather than reach lost the row
  // entirely — and a chip row is the shape this audit exists for.
  it("keeps a too-wide row whose chip spills further inside it", () => {
    const findings = run([
      element({ tag: "DIV", cls: "chips", scrollWidth: 220, clientWidth: 200, right: 200, reach: 220 }),
      element({ tag: "SPAN", cls: "chip-a", parent: 0, scrollWidth: 153, clientWidth: 80, right: 80, reach: 153 }),
    ]);
    expect(findings).toEqual(["wide DIV.chips +20px", "wide SPAN.chip-a +73px"]);
  });

  it("falls back to the overflow amount when a snapshot has no reach", () => {
    const findings = run([
      element({ cls: "outer", scrollWidth: 312, clientWidth: 200, right: 200 }),
      element({ cls: "inner", parent: 0, scrollWidth: 312, clientWidth: 200, right: 200 }),
    ]);
    expect(findings).toEqual(["wide DIV.inner +112px"]);
  });
});

describe("unintended horizontal scrollbars", () => {
  // `overflow-y: auto` alone computes overflow-x to `auto`, so a list meant to
  // scroll vertically silently gains a sideways scrollbar.
  it("reports a vertical list that scrolls sideways", () => {
    expect(run([element({ tag: "UL", cls: "sg-list", overflowX: "auto", scrollWidth: 227, clientWidth: 215 })])).toEqual([
      "hscroll UL.sg-list 227 vs 215",
    ]);
  });

  it("does not also call it clipped or wide", () => {
    const findings = run([element({ overflowX: "scroll", scrollWidth: 227, clientWidth: 215 })]);
    expect(findings.filter((f: string) => /^(clip|wide) /.test(f))).toEqual([]);
  });

  it("accepts a container that is meant to scroll sideways", () => {
    expect(run([element({ cls: "table-scroll", overflowX: "auto", scrollWidth: 420, clientWidth: 200, hScrollAllowed: true })])).toEqual([]);
  });
});

describe("escaping the clipping box", () => {
  const list = { kind: "element", label: "UL.sg-list", right: 436, hScrollAllowed: false };

  it("reports a badge hanging out of a narrow column inside a wide window", () => {
    expect(run([element({ tag: "SPAN", cls: "sg-flag", right: 448, clip: list })])).toEqual([
      "overflow SPAN.sg-flag 12px past UL.sg-list",
    ]);
  });

  it("still reports an element past the window edge", () => {
    expect(run([element({ right: 1460 })])).toEqual(["offscreen DIV.thing 20px past the viewport"]);
  });

  it("reports a window escape even when the clipping box is offscreen too", () => {
    // The old audit's only edge check was against the window; keep that reach.
    const offscreenBox = { kind: "element", label: "DIV.top-actions", right: 1600, hScrollAllowed: false };
    expect(run([element({ right: 1500, clip: offscreenBox })])).toEqual(["offscreen DIV.thing 60px past the viewport"]);
  });

  it("blames the outermost offender, not every descendant", () => {
    const findings = run([
      element({ tag: "SPAN", cls: "sg-flag", right: 448, clip: list, parent: null }),
      element({ tag: "SPAN", cls: "sg-flag-label", right: 444, clip: list, parent: 0 }),
    ]);
    expect(findings).toEqual(["overflow SPAN.sg-flag 12px past UL.sg-list"]);
  });

  it("says nothing about content inside a deliberate horizontal scroller", () => {
    const scroller = { kind: "element", label: "DIV.table-scroll", right: 400, hScrollAllowed: true };
    expect(run([element({ right: 1600, clip: scroller, inHScroller: true })])).toEqual([]);
  });
});

describe("the text floor", () => {
  // Unchanged by HOM-341: this check does need a direct text node, or every
  // ancestor of one small label would be reported too.
  it("reports small text the element owns", () => {
    expect(run([element({ tag: "SPAN", cls: "cite-marker", text: "12", fontSize: 8.64, hasOwnText: true })])).toEqual([
      "small SPAN.cite-marker 8.64px 12",
    ]);
  });

  it("does not report a wrapper whose small text lives in a child", () => {
    expect(run([element({ fontSize: 10, hasOwnText: false })])).toEqual([]);
  });

  it("treats the floor itself as acceptable", () => {
    expect(run([element({ fontSize: TEXT_FLOOR_PX, hasOwnText: true })])).toEqual([]);
    expect(run([element({ fontSize: TEXT_FLOOR_PX - 0.1, hasOwnText: true })])).toHaveLength(1);
  });
});

describe("the whole snapshot", () => {
  it("reports a sideways-scrolling page", () => {
    expect(run([], { scrollWidth: 1500, width: 1440 })).toEqual(["page scrollX 1500 vs 1440"]);
    expect(run([], VIEWPORT)).toEqual([]);
  });

  it("puts structural findings first so the limit keeps the worst", () => {
    const elements = [
      element({ cls: "small-one", fontSize: 10, hasOwnText: true, text: "tiny" }),
      element({ cls: "wide-one", scrollWidth: 240, clientWidth: 200 }),
      element({ cls: "far-one", right: 1600 }),
    ];
    expect(auditFindings({ elements, page: { scrollWidth: 1600, width: 1440 } }, { limit: 2 })).toEqual([
      "page scrollX 1600 vs 1440",
      "offscreen DIV.far-one 160px past the viewport",
    ]);
  });

  it("de-duplicates identical findings and honours the limit", () => {
    const row = () => element({ scrollWidth: 240, clientWidth: 200, text: "same" });
    expect(run([row(), row(), row()])).toHaveLength(1);
    const findings = auditFindings(
      { elements: Array.from({ length: 30 }, (_, i) => element({ cls: `row-${i}`, scrollWidth: 240, clientWidth: 200 })) },
      { limit: 4 },
    );
    expect(findings).toHaveLength(4);
  });

  it("survives an empty snapshot", () => {
    expect(auditFindings({})).toEqual([]);
  });
});
