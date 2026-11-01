// Boot a visual check of the desktop bundle in headless Chromium.
//
// See README.md for the four services that have to line up (engine, static
// server, Chromium, seeded database). This module owns the browser side: it
// proves the served bundle is the build on disk, injects the preload bridge the
// Electron shell normally provides, and walks to a job screen.
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { open, sleep } from "./cdp.mjs";
import { runPorts } from "./ports.mjs";
import { assertServedBundle } from "./bundle.mjs";
import { audit } from "./audit.mjs";

export { sleep } from "./cdp.mjs";
export { audit, snapshot, collectExpression } from "./audit.mjs";
export { auditFindings, TEXT_FLOOR_PX } from "./audit-core.mjs";
export { runPorts, portsFromSeed, assertFree } from "./ports.mjs";
export { assertServedBundle } from "./bundle.mjs";

const WEB_ROOT = fileURLToPath(new URL("../../", import.meta.url));

/** Where screenshots land. Override with $VISUAL_SHOTS. */
export const SHOTS = process.env.VISUAL_SHOTS ?? `${WEB_ROOT}.visual-shots`;

/** The build the browser is expected to be served. Override with $VISUAL_DIST. */
export const DIST = process.env.VISUAL_DIST ?? `${WEB_ROOT}desktop-dist`;

// Stands in for the desktop app's preload bridge (desktop/electron/preload.cjs),
// which does not exist in a plain browser.
const DESKTOP_BRIDGE = `window.proteinLabDesktop = {
  getProjectDirectory: async () => ({ directory: "/home/researcher/Documents/Protein Lab", database: "/home/researcher/Documents/Protein Lab/protein-lab.sqlite3", isDefault: true, missing: null, canChange: true }),
  chooseProjectDirectory: async () => ({ status: "cancelled" }),
  openProjectDirectory: async () => "",
};`;

/**
 * Open the app and return the driven page.
 *
 * @param {object} [options]
 * @param {number} [options.width] viewport width (use 900x650 for the minimum window)
 * @param {number} [options.height] viewport height
 * @param {string} [options.theme] value for `protein-labs-visual-theme`
 * @param {number} [options.scale] device scale factor; 2 for close-up crops
 * @param {boolean} [options.reduced] emulate prefers-reduced-motion
 * @param {string} [options.base] origin serving the bundle
 * @param {string} [options.dist] build directory the origin must be serving
 * @param {string} [options.marker] string your change puts in the bundle
 * @param {boolean} [options.desktopBridge] inject the preload stub (default true)
 */
export async function start({
  width = 1440,
  height = 1000,
  theme = "paper",
  scale = 1,
  reduced = false,
  base = process.env.BASE ?? `http://127.0.0.1:${runPorts().http}/`,
  dist = DIST,
  marker = process.env.VISUAL_BUNDLE_MARKER,
  desktopBridge = true,
} = {}) {
  // Before anything else: the port may belong to another agent's run.
  const checked = await assertServedBundle({ base, dist, marker });
  mkdirSync(SHOTS, { recursive: true });

  const page = await open(runPorts().cdp);
  await page.size(width, height, scale);
  await page.send("Emulation.setEmulatedMedia", { features: [{ name: "prefers-reduced-motion", value: reduced ? "reduce" : "no-preference" }] });
  if (desktopBridge) await page.send("Page.addScriptToEvaluateOnNewDocument", { source: DESKTOP_BRIDGE });
  await page.goto(checked.base + "/");
  await page.eval(`localStorage.setItem("protein-labs-visual-theme", ${JSON.stringify(theme)}); location.reload()`);
  await sleep(1500);
  await page.waitFor("document.querySelector('.startup-button')", 20000);
  await page.eval("document.querySelector('.startup-button').click()");
  await sleep(4500);
  return page;
}

/** Click the first visible element matching `sel` whose text contains `text`. */
export const clickText = (page, text, sel = "button") =>
  page.eval(`(() => { const b = [...document.querySelectorAll(${JSON.stringify(sel)})].find(x => x.textContent.trim().toLowerCase().includes(${JSON.stringify(text.toLowerCase())}) && x.offsetParent); if (!b) return false; b.click(); return true; })()`);

export async function openProject(page, name = "Carbonic anhydrase II") {
  const ok = await page.eval(`(() => { const b = [...document.querySelectorAll('.project-tile')].find(x => x.textContent.includes(${JSON.stringify(name)})); if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`No project tile "${name}" — is the seeded database in place?`);
  await sleep(1800);
}

/** Open `project`, resume its workflow, and enter the job whose label starts with `label`. */
export async function toJob(page, label, project) {
  await openProject(page, project);
  if (!(await clickText(page, "Resume workflow"))) throw new Error("No “Resume workflow” button");
  await sleep(1500);
  const ok = await page.eval(`(() => { const b = [...document.querySelectorAll('.workflow-card-section button, .workflow-card button, button')].find(x => x.offsetParent && x.textContent.replace(/^\\d+/, '').trim().startsWith(${JSON.stringify(label)})); if (!b) return false; b.click(); return true; })()`);
  if (!ok) throw new Error(`No job "${label}"`);
  await sleep(2000);
}

export async function nextJob(page, times = 1) {
  for (let i = 0; i < times; i++) {
    await page.eval(`document.querySelector('.job-nav-corner.next .job-nav-tab').click()`);
    await sleep(2000);
  }
}

/** Audit and print; returns the findings so a script can assert on them. */
export async function reportAudit(page, rootSel = "body", options = {}) {
  const findings = await audit(page, rootSel, options);
  console.log(`audit(${rootSel}) ${findings.length} finding(s)`);
  for (const finding of findings) console.log(`  - ${finding}`);
  return findings;
}
