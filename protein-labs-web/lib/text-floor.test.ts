// App-wide text floor. Run with `npm run test` in protein-labs-web.
// Interface text must be at least 12px. The only rules allowed below that are
// listed in EXEMPT, each with the reason it may stay smaller.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, it } from "vitest";

const FLOOR_PX = 12;
const root = new URL("..", import.meta.url).pathname;
// Every stylesheet under app/, so a new one is covered without editing a list.
const STYLESHEETS = readdirSync(join(root, "app")).filter((name) => name.endsWith(".css")).sort().map((name) => `app/${name}`);
const ROOT_FONT_PX = 16;

const EXEMPT: Record<string, string> = {
  // Chart axis ticks may stay at 11px.
  ".vmap-ruler text": "vector map ruler tick (SVG)",
  // SVG figure text placed in fixed geometry; a larger size makes labels collide.
  ".vmap-bar-label": "linear map feature label sized to its bar (SVG)",
  ".vmap-linear .vmap-enzyme-label, .vseq .vmap-enzyme-label": "enzyme labels stacked 12 units apart (SVG)",
  ".vseq-number": "sequence row number (SVG)",
  ".vseq-residue": "one residue per base position (SVG)",
  ".vseq-feature-name": "feature name beside its residues (SVG)",
  ".vgel-size, .vgel-lane": "virtual gel ladder and lane labels (SVG)",
  ".plasmid-map text": "legacy plasmid map, viewBox units (SVG)",
  ".restriction-label": "legacy plasmid map, viewBox units (SVG)",
  ".plasmid-map .restriction-label": "legacy plasmid map, viewBox units (SVG)",
  ".tree-preview text": "tile thumbnail drawn in viewBox units (SVG)",
  ".xtal-drop .xg-label.small": "hanging/sitting drop labels in viewBox units, drawn at 1.15× or more (SVG)",
  ".residue-structure text": "amino-acid skeletal drawing in viewBox units: 0.42 units at 34px per unit is 14px on screen (SVG)",
  // Decorative glyph, hidden from assistive technology.
  ".mascot-zzz span:nth-child(3)": "decorative sleeping glyph",
};

// Figures drawn at their export size. Their text is sized in SVG
// attributes rather than CSS, so the stylesheet scan never sees it, but the
// on-screen preview scales the whole figure down and the text falls below the
// floor at window widths of 1440px or less. The exported file is full size.
// Listed here like the plasmid map and tree thumbnail; each class must still
// be rendered somewhere, so an entry cannot outlive its figure.
const EXEMPT_FIGURES: Record<string, string> = {
  ".chromatogram-canvas.figure-mode": "Chromatogram Studio Figures tab, 1000×700: export-size figure preview; export output meets the floor",
  ".sec-curve-figure": "SEC calibration figure, 900×640: export-size figure preview; export output meets the floor",
};

interface SmallRule { file: string; line: number; selector: string; size: string }

/**
 * The size a font-size / font value sets when it is under the floor, else null.
 * px and rem resolve to pixels. em, % and the smaller / x-small / xx-small /
 * small keywords scale with the parent, so they cannot be shown to meet the
 * floor and count as under it unless wrapped in max(12px, …). A .72em
 * citation marker that rendered at 8.6–10px slipped past the px-only scan (HOM-401).
 */
function sizeBelowFloor(value: string): string | null {
  const floored = /max\(\s*(\d*\.?\d+)px\s*,/.exec(value);
  if (floored && Number(floored[1]) >= FLOOR_PX) return null;
  const size = /(?<![\w.-])(\d*\.?\d+)(px|rem|em|%)(?![\w-])|(?<![\w-])(smaller|x-small|xx-small|small)(?![\w-])/.exec(value);
  if (!size) return null;
  if (size[3]) return size[3];
  const amount = Number(size[1]);
  if (size[2] === "px") return amount < FLOOR_PX ? `${size[1]}px` : null;
  if (size[2] === "rem") return amount * ROOT_FONT_PX < FLOOR_PX ? `${size[1]}rem` : null;
  return `${size[1]}${size[2]}`;
}

/** Every font-size / font declaration under the floor, with the selector of its rule. */
function smallFontRules(file: string, source = readFileSync(join(root, file), "utf8")): SmallRule[] {
  const css = source.replace(/\/\*[\s\S]*?\*\//g, (comment) => comment.replace(/[^\n]/g, " "));
  const found: SmallRule[] = [];
  const selectors: string[] = [];
  let buffer = "";
  let line = 1;
  for (const char of css) {
    if (char === "\n") line += 1;
    if (char === "{") {
      selectors.push(buffer.trim().replace(/\s+/g, " "));
      buffer = "";
    } else if (char === "}" || char === ";") {
      const declaration = buffer.trim().replace(/\s+/g, " ");
      const match = /^(?:font-size|font)\s*:(.*)$/.exec(declaration);
      const size = match && sizeBelowFloor(match[1]);
      if (size) found.push({ file, line, selector: selectors.at(-1) ?? "", size });
      buffer = "";
      if (char === "}") selectors.pop();
    } else {
      buffer += char;
    }
  }
  return found;
}

function sourceFiles(dir: string): string[] {
  return readdirSync(join(root, dir)).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(join(root, path)).isDirectory()) return sourceFiles(path);
    return /\.tsx?$/.test(name) ? [path] : [];
  });
}

describe("app-wide text floor", () => {
  it("reads sizes from font-size, the font shorthand and nested rules", () => {
    const fixture = `.a { font-size: 11px; }\n/* .b { font-size: 9px; } */\n@media print {\n  .c, .d { font: 600 10.5px/1.4 var(--font-mono); }\n}\n.e { font-size: calc(11.5px * var(--k, 1)); }\n.f { font-size: 12px; letter-spacing: 1px; }`;
    assert.deepEqual(smallFontRules("fixture.css", fixture).map(({ line, selector, size }) => [line, selector, size]), [
      [1, ".a", "11px"],
      [4, ".c, .d", "10.5px"],
      [6, ".e", "11.5px"],
    ]);
  });

  it("counts rem against the root size and parent-relative sizes as under the floor", () => {
    const fixture = [
      ".a { font-size: .7rem; }", ".b { font-size: .75rem; }", ".c { font-size: .72em; }",
      ".d { font: 600 80%/1 serif; }", ".e { font-size: smaller; }", ".f { font: small-caps 13px serif; }",
      ".g { font-size: max(12px, .72em); }", ".h { font-size: max(10px, .9em); }", ".i { font: inherit; }",
    ].join("\n");
    assert.deepEqual(smallFontRules("fixture.css", fixture).map(({ selector, size }) => [selector, size]), [
      [".a", ".7rem"],
      [".c", ".72em"],
      [".d", "80%"],
      [".e", "smaller"],
      [".h", "10px"],
    ]);
  });

  it("keeps stylesheet text at 12px or more outside the listed exceptions", () => {
    const offenders = STYLESHEETS.flatMap((file) => smallFontRules(file))
      .filter((rule) => !(rule.selector in EXEMPT))
      .map((rule) => `${rule.file}:${rule.line} ${rule.selector} → ${rule.size}`);
    assert.deepEqual(offenders, [], `Text below ${FLOOR_PX}px; raise it or add the selector to EXEMPT with a reason`);
  });

  it("has no stale exceptions", () => {
    const small = new Set(STYLESHEETS.flatMap((file) => smallFontRules(file)).map((rule) => rule.selector));
    assert.deepEqual(Object.keys(EXEMPT).filter((selector) => !small.has(selector)), []);
  });

  it("uses no Tailwind arbitrary text size below 12px in components", () => {
    const offenders = ["app", "components"].flatMap(sourceFiles).flatMap((file) =>
      [...readFileSync(join(root, file), "utf8").matchAll(/text-\[([^\]\s]+)\]/g)]
        .filter((match) => sizeBelowFloor(match[1]) !== null)
        .map((match) => `${file}: ${match[0]}`));
    assert.deepEqual(offenders, []);
  });

  it("lists only export-size figures that are still rendered", () => {
    const sources = ["components"].flatMap(sourceFiles).map((file) => readFileSync(join(root, file), "utf8")).join("\n");
    const stale = Object.keys(EXEMPT_FIGURES).filter((selector) =>
      selector.split(".").filter(Boolean).some((name) => !new RegExp(`["\`\\s]${name}["\`\\s]`).test(sources)));
    assert.deepEqual(stale, []);
  });
});
