// The measuring half of the layout audit: walks the rendered DOM in the page
// and writes down one record per visible element. It makes no judgements — the
// rules live in audit-core.mjs so they can be unit-tested and so a snapshot can
// be stored and re-audited later.
import { auditFindings, H_SCROLL_ALLOWED, SKIP_SUBTREES } from "./audit-core.mjs";

/**
 * Build the in-page expression that measures `rootSel` and returns a snapshot.
 * Exported separately so a caller can run it through any CDP/Playwright eval.
 */
export const collectExpression = (
  rootSel = "body",
  { allow = H_SCROLL_ALLOWED, skip = SKIP_SUBTREES, maxElements = 5000, textChars = 36 } = {},
) => `(() => {
  const root = document.querySelector(${JSON.stringify(rootSel)}) || document.body;
  const ALLOW = ${JSON.stringify(allow)}, SKIP = ${JSON.stringify(skip)}, CHARS = ${textChars};
  const cache = new Map();
  const style = (el) => { let s = cache.get(el); if (!s) { s = getComputedStyle(el); cache.set(el, s); } return s; };
  // A computed overflow-x of anything but 'visible' clips or scrolls. Note that
  // 'overflow-y: auto' on its own makes the computed overflow-x 'auto' too, so
  // a box meant to scroll vertically also clips horizontally.
  const clips = (el) => style(el).overflowX !== 'visible';
  const contentRight = (el) => { const r = el.getBoundingClientRect(); return r.left + parseFloat(style(el).borderLeftWidth || 0) + el.clientWidth; };
  const label = (el) => { const c = typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3).join('.') : ''; return c ? el.tagName + '.' + c : el.tagName; };

  const kept = [], index = new Map(), faded = new Set();
  for (const el of [root, ...root.querySelectorAll('*')]) {
    if (kept.length >= ${maxElements}) break;
    const cs = style(el);
    if (cs.display === 'none' || cs.visibility === 'hidden') continue;
    // Opacity does not inherit, so a transparent panel's children each report
    // opacity 1 while being just as invisible: skip the whole subtree. (The
    // walk is in document order, so a faded ancestor is always seen first.)
    if (cs.opacity === '0') { faded.add(el); continue; }
    let transparent = false;
    for (let p = el.parentElement; p && !transparent; p = p.parentElement) transparent = faded.has(p);
    if (transparent) continue;
    const rect = el.getBoundingClientRect();
    // Anything a pixel thin is either a hairline rule or the visually-hidden
    // idiom (1x1 box, overflow hidden) that screen readers use; neither has
    // layout worth auditing, and the latter "overflows" by definition.
    if (rect.width < 2 || rect.height < 2) continue;
    if (SKIP && el.closest(SKIP)) continue;
    index.set(el, kept.length);
    kept.push({ el, rect, cs });
  }

  const elements = kept.map(({ el, rect, cs }) => {
    let parent = el.parentElement, clip = null;
    while (parent) {
      if (clips(parent)) { clip = { kind: 'element', label: label(parent), right: contentRight(parent), hScrollAllowed: !!(ALLOW && parent.matches(ALLOW)) }; break; }
      parent = parent.parentElement;
    }
    if (!clip) clip = { kind: 'viewport', label: 'the viewport', right: document.documentElement.clientWidth, hScrollAllowed: false };
    // Nearest *kept* ancestor, so the rules can tell a chain of nested
    // offenders from a single one.
    let own;
    for (let p = el.parentElement; p && own === undefined; p = p.parentElement) own = index.get(p);
    return {
      tag: el.tagName,
      cls: typeof el.className === 'string' ? el.className.trim().split(/\\s+/).filter(Boolean).slice(0, 3).join('.') : '',
      text: (el.textContent || '').trim().replace(/\\s+/g, ' ').slice(0, CHARS),
      fontSize: Math.round(parseFloat(cs.fontSize) * 100) / 100,
      overflowX: cs.overflowX,
      textOverflow: cs.textOverflow,
      scrollWidth: el.scrollWidth,
      clientWidth: el.clientWidth,
      right: Math.round(rect.right * 100) / 100,
      // How far the box's *content* reaches, which is not where the box ends.
      // Two boxes in a chain reach the same point; a child spilling inside a
      // wider parent does not.
      reach: Math.round((rect.left + parseFloat(cs.borderLeftWidth || 0) + el.scrollWidth) * 100) / 100,
      hasOwnText: [...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
      hScrollAllowed: !!(ALLOW && el.matches(ALLOW)),
      inHScroller: !!(ALLOW && el.closest(ALLOW)),
      clip: { ...clip, right: Math.round(clip.right * 100) / 100 },
      parent: own === undefined ? null : own,
    };
  });

  return { elements, page: { scrollWidth: document.scrollingElement.scrollWidth, width: document.documentElement.clientWidth }, root: ${JSON.stringify(rootSel)} };
})()`;

/** Measure `rootSel` in the page and return the snapshot, unjudged. */
export const snapshot = (page, rootSel = "body", options = {}) => page.eval(collectExpression(rootSel, options));

/**
 * Measure `rootSel` and return the findings.
 *
 * Reports: text below the 12px floor, content clipped by its own box,
 * unintended horizontal scrollbars, elements hanging out of their clipping
 * box (not just out of the window), and a sideways-scrolling page.
 */
export async function audit(page, rootSel = "body", options = {}) {
  return auditFindings(await snapshot(page, rootSel, options), options);
}

export { auditFindings } from "./audit-core.mjs";
