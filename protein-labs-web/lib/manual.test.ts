// In-app user manual parser. Run with `npm run test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { parseInline, parseManual, searchManual, slugify } from "./manual.ts";

describe("parseInline", () => {
  it("splits bold, code, keys, links and emphasis from plain text", () => {
    assert.deepEqual(parseInline("Press <kbd>Ctrl+Shift+L</kbd> or open **File** → `Set project directory…`, see [docs](https://example.org) *now*."), [
      { kind: "text", text: "Press " },
      { kind: "kbd", text: "Ctrl+Shift+L" },
      { kind: "text", text: " or open " },
      { kind: "strong", text: "File" },
      { kind: "text", text: " → " },
      { kind: "code", text: "Set project directory…" },
      { kind: "text", text: ", see " },
      { kind: "link", text: "docs", href: "https://example.org" },
      { kind: "text", text: " " },
      { kind: "em", text: "now" },
      { kind: "text", text: "." },
    ]);
  });

  it("keeps markup-looking text as text instead of HTML", () => {
    assert.deepEqual(parseInline("<script>alert(1)</script>"), [{ kind: "text", text: "<script>alert(1)</script>" }]);
  });
});

describe("parseManual", () => {
  const manual = parseManual([
    "# Protein Lab user manual",
    "<!-- Authoring note: hidden",
    "across lines -->",
    "Welcome to the lab.",
    "",
    "## Getting started",
    "Open the app and",
    "press Start.",
    "",
    "![The dashboard](manual/dashboard.webp)",
    "*The dashboard after Start.*",
    "",
    "1. Create a project.",
    "2. Paste a sequence",
    "   that wraps.",
    "- A bullet",
    "",
    "> **Tip:** Projects save automatically.",
    "",
    "### Shortcuts",
    "| Keys | Action |",
    "| --- | --- |",
    "| <kbd>Ctrl+Shift+L</kbd> | Vector library |",
    "",
    "## Getting started",
  ].join("\n"));

  it("takes the title from the H1 and keeps text before the first section as the intro", () => {
    assert.equal(manual.title, "Protein Lab user manual");
    assert.deepEqual(manual.intro, [{ kind: "paragraph", content: [{ kind: "text", text: "Welcome to the lab." }] }]);
  });

  it("gives every section a unique anchor", () => {
    assert.deepEqual(manual.sections.map((section) => section.id), ["getting-started", "getting-started-2"]);
  });

  it("parses figures with captions, lists, notes and tables", () => {
    const [paragraph, figure, ordered, bullets, note, heading, table] = manual.sections[0].blocks;
    assert.deepEqual(paragraph, { kind: "paragraph", content: [{ kind: "text", text: "Open the app and press Start." }] });
    assert.deepEqual(figure, { kind: "figure", src: "manual/dashboard.webp", alt: "The dashboard", caption: [{ kind: "text", text: "The dashboard after Start." }] });
    assert.equal(ordered.kind === "list" && ordered.ordered, true);
    assert.deepEqual(ordered.kind === "list" && ordered.items[1], [{ kind: "text", text: "Paste a sequence that wraps." }]);
    assert.equal(bullets.kind === "list" && bullets.ordered, false);
    assert.deepEqual(note, { kind: "note", tone: "tip", content: [{ kind: "text", text: "Projects save automatically." }] });
    assert.deepEqual(heading, { kind: "heading", level: 3, id: "shortcuts", text: "Shortcuts" });
    assert.equal(table.kind === "table" && table.rows.length, 1);
    assert.deepEqual(table.kind === "table" && table.rows[0][0], [{ kind: "kbd", text: "Ctrl+Shift+L" }]);
  });

  it("finds sections by every search term", () => {
    assert.deepEqual(searchManual(manual, "vector LIBRARY").map((section) => section.id), ["getting-started"]);
    assert.deepEqual(searchManual(manual, "chromatogram"), []);
    assert.equal(searchManual(manual, "  ").length, 2);
  });

  it("parses the shipped manual and every figure points at a bundled image", () => {
    const source = readFileSync(new URL("../docs/user-manual.md", import.meta.url), "utf8");
    const shipped = parseManual(source);
    assert.ok(shipped.sections.length >= 3);
    const figures = shipped.sections.flatMap((section) => section.blocks).filter((block) => block.kind === "figure");
    assert.ok(figures.length > 0);
    for (const figure of figures) {
      assert.ok(figure.kind === "figure" && figure.alt.trim(), "every figure needs alt text");
      if (figure.kind === "figure") readFileSync(new URL(`../desktop/public/${figure.src}`, import.meta.url));
    }
  });
});

describe("slugify", () => {
  it("makes stable anchors", () => assert.equal(slugify("Set the project directory!"), "set-the-project-directory"));
});
