// Layout-audit rules, as pure functions over a measured snapshot.
//
// The browser half of the audit (`audit.mjs`) only measures: it walks the DOM
// and writes down numbers. Every decision about what counts as a finding lives
// here, so the rules can be unit-tested (`audit-core.test.mts`) without a
// layout engine, and so a saved snapshot can be re-audited after the fact.
//
// History: the original harness gated both the small-text and the clipping
// check on whether an element had a direct text-node child. That hid a whole
// class of bug — a chip/badge row whose text lives entirely in child <span>s
// has no direct text node, so its overflow was never measured. See HOM-341.

/** The app-wide minimum readable size; mirrors lib/text-floor.test.ts. */
export const TEXT_FLOOR_PX = 12;

/**
 * Elements that are *meant* to scroll sideways. A horizontal scrollbar on one
 * of these is the design, not a finding, and content extending past its right
 * edge is expected. Everything else that scrolls sideways gets reported.
 */
export const H_SCROLL_ALLOWED = ".table-scroll, [data-h-scroll]";

/**
 * Subtrees to leave alone: internal SVG/canvas geometry is not CSS layout,
 * and `inert` marks the parts of the page not being presented — the hidden
 * face of a flip card, the content behind a modal.
 */
export const SKIP_SUBTREES = "svg, canvas, .molecular-webgl, .sr-only, [inert]";

/** Findings are grouped so the worst survive the limit on a busy screen. */
const ORDER = ["page", "offscreen", "overflow", "hscroll", "clip", "wide", "small"];

const scrollsX = (element) => /auto|scroll/.test(element.overflowX);

const clipsX = (element) => /hidden|clip/.test(element.overflowX);

const describe = (element) => (element.cls ? `${element.tag}.${element.cls}` : element.tag);

const withText = (label, text) => (text ? `${label} ${text}` : label);

/**
 * Turn a measured snapshot into a list of human-readable findings.
 *
 * Each finding starts with its kind:
 *   page      the document itself scrolls sideways
 *   offscreen an element reaches past the right edge of the window
 *   overflow  an element reaches past its nearest clipping ancestor
 *   hscroll   a box has a horizontal scrollbar it probably did not want
 *   clip      a box cuts its own content off
 *   wide      content is wider than its box and spills into what is beside it
 *   small     text below the 12px floor
 *
 * @param {object} snapshot `{ elements: [...], page?: { scrollWidth, width } }`
 * @param {object} [options]
 * @param {number} [options.limit] maximum findings to return
 * @returns {string[]} de-duplicated findings, most structural first
 */
export function auditFindings(snapshot, { limit = 25 } = {}) {
  const elements = snapshot?.elements ?? [];
  const found = new Map(ORDER.map((kind) => [kind, []]));
  const add = (kind, line) => found.get(kind).push(line);

  const page = snapshot?.page;
  if (page && page.scrollWidth > page.width + 1) {
    add("page", `page scrollX ${page.scrollWidth} vs ${page.width}`);
  }

  // How each box overflows itself, worked out before anything is reported:
  // a `visible` box's scrollWidth includes its descendants' overflow, so one
  // long label makes every wrapper up to the clipping box look guilty. Only
  // the innermost box in such a chain is worth a line.
  const boxes = elements.map((element) => {
    const by = Math.round(element.scrollWidth - element.clientWidth);
    if (!(element.clientWidth > 0 && by > 1)) return null;
    if (scrollsX(element)) return element.hScrollAllowed ? null : { kind: "hscroll", by };
    if (element.textOverflow === "ellipsis") return null;
    return { kind: clipsX(element) ? "clip" : "wide", by };
  });
  const children = elements.map(() => []);
  elements.forEach((element, index) => {
    if (typeof element.parent === "number" && elements[element.parent]) children[element.parent].push(index);
  });
  // `wide` yields to a child that is wide or clipped; `clip` only to a child
  // that clips, so the box where content actually disappears is still named.
  //
  // A child has to match its parent on two counts to stand in for it:
  //
  //   reach  — where the content's right edge lands. A chip spilling 73px
  //            inside a 200px row is not why the row is 20px too wide.
  //   amount — how far past its own box the content goes. Equal reach only
  //            says the child holds the far edge; if the child's *box* is
  //            itself poking out of the parent (pushed right by a sibling),
  //            it overflows by less and is not the whole story.
  //
  // In a true wrapper chain the child's box sits inside the parent and both
  // match, so the outer wrappers collapse. Either test alone loses a real
  // row — both halves were found by review, one each.
  const reachOf = (index) => (typeof elements[index].reach === "number" ? elements[index].reach : elements[index].right + boxes[index].by);
  const innermost = (index) => {
    const box = boxes[index];
    const yieldsTo = box.kind === "clip" ? ["clip"] : ["clip", "wide"];
    return !children[index].some(
      (child) =>
        boxes[child] &&
        yieldsTo.includes(boxes[child].kind) &&
        boxes[child].by >= box.by - 1 &&
        reachOf(child) >= reachOf(index) - 1,
    );
  };

  for (const [index, element] of elements.entries()) {
    const name = describe(element);

    // Text floor. This one keeps the own-text-node gate: a wrapper's computed
    // font-size says nothing about text it does not itself hold, so reporting
    // it would fire on every ancestor of one small label.
    if (element.hasOwnText && element.fontSize < TEXT_FLOOR_PX) {
      add("small", withText(`small ${name} ${element.fontSize}px`, element.text));
    }

    // Content wider than the box. Deliberately *not* gated on own text:
    // overflow is a box property and does not need a text node.
    const box = boxes[index];
    if (box) {
      if (box.kind === "hscroll") {
        // A horizontal scrollbar nobody asked for: `overflow-y: auto` alone
        // computes overflow-x to `auto`, so a box meant to scroll vertically
        // silently gains one. Report it and let a human decide.
        add("hscroll", withText(`hscroll ${name} ${element.scrollWidth} vs ${element.clientWidth}`, element.text));
      } else if (innermost(index)) {
        // Cut off here, or spilling into whatever sits beside it.
        add(box.kind, withText(`${box.kind} ${name} +${box.by}px`, element.text));
      }
    }

    // Reaching out of the box that is supposed to contain it. Only the
    // outermost offender in a chain is interesting: if the parent escapes the
    // same box by at least as much, this element is just its content. (A
    // child that overflows by less than the parent's right border width is
    // shadowed too; that is a pixel or two, and worth the quieter output.)
    const parent = typeof element.parent === "number" ? elements[element.parent] : undefined;
    const shadowed = (edge) => parent && parent.right >= element.right && parent.right > edge + 1;

    const clip = element.clip;
    if (clip && clip.kind === "element" && !clip.hScrollAllowed && element.right > clip.right + 1 && !shadowed(clip.right)) {
      add("overflow", `overflow ${name} ${Math.round(element.right - clip.right)}px past ${clip.label}`);
    }

    // Past the window edge. Checked independently of the clipping box: a
    // container can be offscreen itself, and then nothing inside it escapes
    // *it* while the whole lot is still unreachable.
    const viewport = page?.width;
    if (viewport && !element.inHScroller && element.right > viewport + 1 && !shadowed(viewport)) {
      add("offscreen", `offscreen ${name} ${Math.round(element.right - viewport)}px past the viewport`);
    }
  }

  return [...new Set(ORDER.flatMap((kind) => found.get(kind)))].slice(0, limit);
}
