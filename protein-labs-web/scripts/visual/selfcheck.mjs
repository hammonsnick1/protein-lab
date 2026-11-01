// Does audit() actually catch the bug it missed?
//
// Drives fixtures/overflow-row.html — a standalone reproduction of the HOM-332
// space-group selector geometry — in real headless Chromium and asserts the
// findings. Run it after touching audit-core.mjs or audit.mjs:
//
//   node scripts/visual/selfcheck.mjs            # assert
//   node scripts/visual/selfcheck.mjs --shot     # also write a 2x crop
//
// Unlike the unit tests this exercises real layout, so it catches a collector
// that measures the wrong box as well as a rule that judges it wrongly.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { open } from "./cdp.mjs";
import { launchChromium } from "./launch.mjs";
import { runPorts, assertFree } from "./ports.mjs";
import { snapshot } from "./audit.mjs";
import { auditFindings, TEXT_FLOOR_PX } from "./audit-core.mjs";
import { SHOTS } from "./harness.mjs";

const FIXTURE = fileURLToPath(new URL("./fixtures/overflow-row.html", import.meta.url));

/**
 * The audit as it stood before HOM-341, re-derived from the same snapshot.
 *
 * Kept as the regression's control: both of its box checks were gated on
 * `own` (a direct text-node child), so a row whose text is entirely in child
 * <span>s was never measured, and `offscreen` only ever compared against the
 * window. If this ever starts reporting the badge row, the fixture has stopped
 * reproducing the bug.
 */
const legacyFindings = (snap) => {
  const out = [];
  for (const el of snap.elements) {
    if (el.hasOwnText && el.fontSize < TEXT_FLOOR_PX) out.push(`small ${el.cls} ${el.fontSize}`);
    if (el.hasOwnText && el.scrollWidth > el.clientWidth + 1 && !/auto|scroll/.test(el.overflowX) && el.textOverflow !== "ellipsis" && el.clientWidth > 0)
      out.push(`clip ${el.tag}.${el.cls}`);
    if (el.right > snap.page.width + 1) out.push(`offscreen ${el.tag}.${el.cls}`);
  }
  return [...new Set(out)];
};

const failures = [];
const expect = (label, ok) => {
  console.log(`${ok ? "  ok  " : " FAIL "} ${label}`);
  if (!ok) failures.push(label);
};
const has = (findings, pattern) => findings.some((finding) => pattern.test(finding));

const ports = runPorts();
await assertFree({ cdp: ports.cdp });
const chromium = await launchChromium({ port: ports.cdp });
try {
  const page = await open(ports.cdp);
  await page.size(1440, 1000, 1);
  await page.goto(`file://${FIXTURE}`);

  // What the fixture actually measures, so a shifted reproduction is obvious.
  const geometry = await page.eval(`(() => {
    const list = document.querySelector('.sg-list');
    const row = document.querySelector('.sg-list-system.overflowing');
    const badge = [...row.querySelectorAll('.sg-flag')].pop();
    return {
      listOverflowX: getComputedStyle(list).overflowX,
      list: [list.scrollWidth, list.clientWidth],
      row: [row.scrollWidth, row.clientWidth],
      rowHasOwnText: [...row.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim()),
      badgePastList: Math.round(badge.getBoundingClientRect().right - (list.getBoundingClientRect().left + list.clientWidth)),
    };
  })()`);
  console.log("fixture geometry", JSON.stringify(geometry));

  const snap = await snapshot(page, "body");
  const findings = auditFindings(snap, { limit: 50 });
  console.log(`\nnew audit — ${findings.length} finding(s)`);
  for (const finding of findings) console.log(`  - ${finding}`);
  const legacy = legacyFindings(snap);
  console.log(`legacy audit — ${legacy.length} finding(s): ${JSON.stringify(legacy)}\n`);

  // The fixture must still reproduce the shape the bug needed.
  expect("the overflowing row has no direct text node (the old gate's blind spot)", geometry.rowHasOwnText === false);
  expect("the list's computed overflow-x is auto because overflow-y is", geometry.listOverflowX === "auto");
  // Small on purpose: HOM-332's row was 3px over. An audit that only notices
  // gross overflow would have missed it too.
  expect("the row is 2-6px wider than its box, like the real bug", geometry.row[0] - geometry.row[1] > 1 && geometry.row[0] - geometry.row[1] <= 6);
  expect("the last badge hangs past the list's right edge", geometry.badgePastList > 1);

  // The HOM-332 case, as reported findings.
  expect("reports the over-wide badge row", has(findings, /^wide BUTTON\.sg-list-system/));
  expect("reports the list's unintended horizontal scrollbar", has(findings, /^hscroll UL\.sg-list /));
  expect("reports the badge escaping the narrow column", has(findings, /^overflow SPAN\.sg-flag \d+px past UL\.sg-list/));

  // The small-text check is unchanged.
  expect("still reports text below the floor", has(findings, /^small SPAN\.cite-marker 10px/));
  expect("does not blame the wrapper for its child's small text", !has(findings, /^small P\.wrapper/));

  // Quiet where it should be.
  expect("ignores an intentional ellipsis", !has(findings, /truncated/));
  expect("ignores an intentional horizontal scroller", !has(findings, /table-scroll|TABLE/));
  expect("ignores rows that fit", !has(findings, /ok-row|ok-column/));
  // Both of these produced phantom findings against the real dashboard before
  // the collector learned to skip them.
  expect("ignores the visually-hidden 1x1 idiom", !has(findings, /visually-hidden|screen readers/));
  expect("ignores the inert back face of a flip card", !has(findings, /flip-back|Hidden face/));
  expect("does not report a sideways-scrolling page", !has(findings, /^page scrollX/));

  // The control: the old gate saw none of it.
  expect("legacy audit missed the badge row entirely", !has(legacy, /sg-/) || !has(legacy, /^clip|^offscreen/));
  expect("legacy audit did catch the small text (that check is unchanged)", has(legacy, /small cite-marker/));

  if (process.argv.includes("--shot")) {
    mkdirSync(SHOTS, { recursive: true });
    await page.size(1440, 1000, 2);
    const box = await page.box(".sg-picker", 10);
    console.log("\nwrote", await page.shot(`${SHOTS}/audit-fixture.png`, box));
  }
  page.close();
} finally {
  chromium.stop();
}

console.log(failures.length ? `\n${failures.length} expectation(s) failed` : "\nall expectations held");
process.exit(failures.length ? 1 : 0);
