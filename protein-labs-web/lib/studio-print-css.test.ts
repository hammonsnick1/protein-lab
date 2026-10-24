// Layout and print rules fixed in the HOM-79 final check. Run with
// `npm run test`. Each rule is read from app/globals.css.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8")
  .replace(/\/\*[\s\S]*?\*\//g, "");

/** Declarations of every rule with exactly this selector, in `scope` if given. */
function declarations(selector: string, scope = css): string {
  const found: string[] = [];
  const pattern = /([^{}]+)\{([^{}]*)\}/g;
  for (const match of scope.matchAll(pattern)) {
    if (match[1].trim().replace(/\s+/g, " ") === selector) found.push(match[2]);
  }
  return found.join(";");
}

/** The body of the first `@media print` block that styles the report sheets. */
function reportPrintBlock(): string {
  for (const match of css.matchAll(/@media print\s*\{/g)) {
    let depth = 1, index = match.index + match[0].length;
    const start = index;
    while (depth && index < css.length) {
      if (css[index] === "{") depth += 1;
      if (css[index] === "}") depth -= 1;
      index += 1;
    }
    const body = css.slice(start, index - 1);
    if (body.includes(".report-sheet")) return body;
  }
  return "";
}

describe("studio layout", () => {
  it("does not assume a fixed job-header height", () => {
    assert.doesNotMatch(css, /100vh - 181px|top:\s*181px/);
  });

  it("lets the gel and chromatogram studios fill the space under the header", () => {
    for (const studio of [".gel-analysis-full", ".chrom-studio"]) {
      const rule = declarations(`.job-surface:has(${studio})`);
      assert.match(rule, /flex:\s*1/, studio);
      assert.match(rule, /min-height:\s*0/, studio);
      assert.match(declarations(studio), /position:\s*relative/, studio);
    }
  });

  it("keeps the figure mounted but hidden on the chromatogram Export tab", () => {
    assert.match(declarations(".chrom-center:has(.export-workspace) .chromatogram-canvas"), /display:\s*none/);
  });

  it("gives the studio message its own space instead of covering the plot", () => {
    const rule = declarations(".chrom-message");
    assert.match(rule, /position:\s*sticky/);
    assert.doesNotMatch(rule, /position:\s*absolute/);
  });

  it("keeps the standards table rows on shared column widths", () => {
    assert.match(declarations('.standard-table > div > input:not([type="checkbox"])'), /min-width:\s*0/);
  });

  it("keeps the roadmap menu scrollable inside the window", () => {
    assert.match(declarations(".roadmap-context-menu"), /max-height:/);
  });
});

describe("report headings and print", () => {
  it("lets report headings wrap instead of clipping", () => {
    assert.match(declarations(".report-title-input, .report-page-title, .report-page-subtitle"), /field-sizing:\s*content/);
  });

  it("keeps the page number at the right edge of the sheet header", () => {
    assert.match(declarations(".report-sheet-header > .report-page-number"), /flex:\s*none/);
  });

  it("keeps the case of units in the expressed-construct headings", () => {
    assert.doesNotMatch(declarations(".report-construct th"), /text-transform:\s*uppercase/);
  });

  it("does not print writing prompts as if they were content", () => {
    assert.match(declarations(".report-sheet ::placeholder", reportPrintBlock()), /color:\s*transparent/);
  });
});
