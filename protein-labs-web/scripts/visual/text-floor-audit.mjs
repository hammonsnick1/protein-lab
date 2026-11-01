// DOM text-floor audit for the screens that carry citation markers.
//
// lib/text-floor.test.ts reads the stylesheets; this reads what the browser
// actually renders. It opens the jobs whose citation markers broke the floor,
// walks each of their tabs, and fails on any text whose computed font-size is
// under 12px. It also fails a job that showed no markers at all, so a page
// that did not load cannot pass by showing nothing. HOM-401: the
// markers were set at .72em, which the stylesheet scan could not resolve, and
// rendered at 8.6–10px on Crystallize and HSQC.
//
//   PROJECT="Carbonic anhydrase II" node scripts/visual/text-floor-audit.mjs [--shot]
//
// Needs the built bundle, engine and Chromium from the README, and a database
// whose project has a sequence and saved structure matches.
import { start, toJob, clickText, audit, SHOTS, sleep } from "./harness.mjs";

const project = process.env.PROJECT ?? "Carbonic anhydrase II";
const shot = process.argv.includes("--shot");

// Each job, the root to audit, and the selector of its tabs (if it has any).
// The Structure Viewer's ligand panel also cites, but only once a PDB entry has
// downloaded, so it is left to a networked check.
const SURFACES = [
  { job: "Crystallize your protein", root: ".crystallize-workspace", tabs: ".crystallize-tabs [role=tab]" },
  { job: "Predict the ¹H–¹⁵N HSQC", root: ".hsqc-workspace" },
];

const failures = [];
for (const surface of SURFACES) {
  const page = await start({ width: 1440, height: 1000 });
  try {
    await toJob(page, surface.job, project);
    let seen = 0;
    const tabs = surface.tabs ? await page.eval(`[...document.querySelectorAll(${JSON.stringify(surface.tabs)})].map((tab) => tab.textContent.trim())`) : [null];
    for (const tab of tabs) {
      if (tab) {
        await clickText(page, tab, surface.tabs);
        await sleep(1500);
      }
      const label = tab ? `${surface.job} › ${tab}` : surface.job;
      const markers = await page.eval(`[...document.querySelectorAll(${JSON.stringify(surface.root)} + ' .cite-marker')].map((el) => getComputedStyle(el).fontSize)`);
      const small = (await audit(page, surface.root, { limit: 200 })).filter((finding) => finding.startsWith("small"));
      console.log(`${small.length ? "FAIL" : "  ok"}  ${label}: ${markers.length} citation marker(s) at ${[...new Set(markers)].join(", ") || "—"}`);
      for (const finding of small) console.log(`        - ${finding}`);
      seen += markers.length;
      if (small.length) failures.push(label);
      if (shot) await page.shot(`${SHOTS}/text-floor-${label.replace(/[^\w]+/g, "-").toLowerCase()}.png`);
    }
    if (!seen) {
      console.log(`FAIL  ${surface.job}: no citation markers rendered — did the job load?`);
      failures.push(surface.job);
    }
  } finally {
    page.close();
  }
}

console.log(failures.length ? `\ntext below 12px on ${failures.length} surface(s)` : "\nno text below 12px");
process.exit(failures.length ? 1 : 0);
