// What the job-page summary strip and tabs render: the ARIA tab wiring, and
// that inactive panels stay in the page (hidden) so their state survives a
// tab switch.
import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { JobSummary, JobTabs } from "./job-tabs.tsx";

const tabs = [
  { id: "resin", label: "Capture resin", hint: "His-Ni", content: <p>resin grid</p> },
  { id: "construct", label: "Construct", content: <p>construct designer</p> },
  { id: "buffers", label: "Buffers", content: <p>buffer composer</p> },
];

describe("JobTabs", () => {
  it("renders one tab per section, the active one selected and focusable", () => {
    const html = renderToStaticMarkup(<JobTabs label="Affinity capture" tabs={tabs} active="construct"/>);
    assert.match(html, /role="tablist" aria-label="Affinity capture"/);
    assert.equal([...html.matchAll(/role="tab"/g)].length, 3);
    assert.equal([...html.matchAll(/aria-selected="true"/g)].length, 1);
    assert.match(html, /aria-selected="true"[^>]*tabindex="0"[^>]*><strong>Construct<\/strong>/);
    assert.equal([...html.matchAll(/tabindex="-1"/g)].length, 2);
    assert.match(html, /<small>His-Ni<\/small>/);
  });

  it("keeps every panel mounted and hides the inactive ones", () => {
    const html = renderToStaticMarkup(<JobTabs label="Affinity capture" tabs={tabs} active="construct"/>);
    for (const text of ["resin grid", "construct designer", "buffer composer"]) assert.ok(html.includes(text), text);
    const panels = [...html.matchAll(/<div class="job-tab-panel" role="tabpanel" id="([^"]+)" aria-labelledby="([^"]+)"( hidden="")?>/g)];
    assert.equal(panels.length, 3);
    assert.deepEqual(panels.map((panel) => Boolean(panel[3])), [true, false, true]);
    // Each panel is labelled by its own tab, and each tab controls its own panel.
    for (const [, panelId, tabId] of panels) assert.match(html, new RegExp(`id="${tabId}" aria-selected="(true|false)" aria-controls="${panelId}"`));
  });

  it("falls back to the first tab when the requested one is missing", () => {
    const html = renderToStaticMarkup(<JobTabs label="Affinity capture" tabs={tabs} active="gone"/>);
    assert.match(html, /aria-selected="true"[^>]*><strong>Capture resin<\/strong>/);
  });
});

describe("JobSummary", () => {
  it("shows each item's value, detail and verdict, and the actions", () => {
    const html = renderToStaticMarkup(<JobSummary label="Affinity capture summary" items={[
      { label: "Capture resin", value: "His-Ni", detail: "His6 · Polyhistidine" },
      { label: "Compatibility", value: "1 blocking", status: { tone: "error", label: "Blocking" } },
    ]} note="Not saved to this project yet." actions={<button>Save</button>}/>);
    assert.match(html, /<section class="job-summary" aria-label="Affinity capture summary">/);
    assert.match(html, /<dt>Capture resin<\/dt><dd><span class="job-summary-value">His-Ni<\/span><small>His6 · Polyhistidine<\/small>/);
    assert.match(html, /class="status-chip error"/);
    assert.match(html, /Blocking/);
    assert.match(html, /role="status">Not saved to this project yet\.<\/div><button>Save<\/button>/);
  });
});
