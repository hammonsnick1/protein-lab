import { formatMass, formatNumber, type MethodBlock, type ReportData, type ReportFlag } from "@/lib/report-data";

/**
 * The printable purification report.
 *
 * One document builder serves both exports. In `pdf` mode the Electron main
 * process prints this markup with Chromium's PDF writer, which keeps the text
 * selectable and turns every inline SVG into vector paths; the repeating
 * header and page numbers come from the print header and footer templates in
 * `desktop/electron/main.cjs`. In `html` mode the same markup is written to a
 * standalone file and carries its own fixed running header, so the file prints
 * sensibly from any browser.
 *
 * Figures arrive as markup captured from the live report, so what the reader
 * sees in the PDF is exactly the figure the workspace drew — as vectors.
 */

export type PrintFigureKind = "vector" | "raster" | "missing";
/**
 * Figure numbers are assigned once, by the workspace, in report order, so the
 * number beside a caption on screen is the number the printed figure carries.
 */
export type PrintFigure = { id: string; number: number; caption: string; kind: PrintFigureKind; markup: string; note?: string };

export type PrintBlock =
  | { kind: "facts"; title: string; rows: [string, string][] }
  | { kind: "properties"; rows: [string, string][]; figure: PrintFigure | null }
  | { kind: "construct"; header: string[]; rows: string[][]; facts: [string, string][] }
  | { kind: "vector"; figure: PrintFigure | null; facts: [string, string][]; note: string }
  | { kind: "yield" }
  | { kind: "purity" }
  | { kind: "sec" }
  | { kind: "methods" }
  | { kind: "flags" }
  | { kind: "prose"; text: string };

export type PrintPage = {
  id: string;
  title: string;
  subtitle: string;
  blocks: PrintBlock[];
  figures: PrintFigure[];
};

export type PrintInput = {
  mode: "pdf" | "html";
  title: string;
  summary: string;
  preparedOn: string;
  protein: { name: string; length: number; organism: string; geneName: string };
  data: ReportData;
  pages: PrintPage[];
};

/** Running header text, shared by the fixed HTML header and the PDF template. */
export function runningHeader(title: string, proteinName: string) {
  return `${title} · ${proteinName}`;
}

export function reportDocumentHtml(input: PrintInput) {
  const pages = input.pages.map((page) => {
    const blocks = page.blocks.map((block) => renderBlock(block, input)).filter(Boolean).join("\n");
    const figures = page.figures.map((figure) => renderFigure(figure)).join("\n");
    return `<section class="page">
      <header class="page-head">
        <div><h2>${escapeHtml(page.title)}</h2>${page.subtitle ? `<p class="page-sub">${escapeHtml(page.subtitle)}</p>` : ""}</div>
      </header>
      ${blocks}
      ${figures}
    </section>`;
  }).join("\n");

  const running = runningHeader(input.title, input.protein.name);
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"/>
<title>${escapeHtml(input.title)}</title>
<style>${documentCss(input.mode)}</style>
</head><body>
${input.mode === "html" ? `<div class="running-head" aria-hidden="true">${escapeHtml(running)}</div>
<div class="running-foot" aria-hidden="true">${escapeHtml(input.preparedOn)}</div>` : ""}
<section class="page cover">
  <p class="kicker">Protein Lab · Purification record</p>
  <h1>${escapeHtml(input.title)}</h1>
  <p class="lede">${escapeHtml(input.summary)}</p>
  <dl class="facts cover-facts">
    ${factRow("Construct", input.protein.name)}
    ${factRow("Length", `${input.protein.length} aa`)}
    ${factRow("Organism", input.protein.organism || "Not recorded")}
    ${factRow("Gene", input.protein.geneName || "Not recorded")}
    ${factRow("Prepared", input.preparedOn)}
    ${factRow("Sections", String(input.pages.length))}
  </dl>
  ${input.data.flags.length ? `<div class="cover-caveats">
    <h3>Caveats carried in this report</h3>
    <p>${countFlags(input.data.flags)}</p>
  </div>` : ""}
</section>
${pages}
</body></html>`;
}

/* ========================================================================
   Blocks
   ======================================================================== */

function renderBlock(block: PrintBlock, input: PrintInput): string {
  if (block.kind === "prose") {
    return block.text.trim() ? `<div class="prose">${paragraphs(block.text)}</div>` : "";
  }
  if (block.kind === "facts") {
    if (!block.rows.length) return "";
    return `<section class="block"><h3>${escapeHtml(block.title)}</h3>
      <dl class="facts">${block.rows.map(([label, value]) => factRow(label, value)).join("")}</dl></section>`;
  }
  if (block.kind === "properties") {
    const figure = block.figure && block.figure.kind !== "missing"
      ? `<div class="property-figure">${renderFigure(block.figure)}</div>`
      : "";
    return `<section class="block property-block">${figure}
      <dl class="facts">${block.rows.map(([label, value]) => factRow(label, value)).join("")}</dl></section>`;
  }
  if (block.kind === "construct") {
    return `<section class="block"><h3>Expressed construct</h3>
      ${table(block.header, block.rows, [false, true, true, true])}
      <dl class="facts">${block.facts.map(([label, value]) => factRow(label, value)).join("")}</dl></section>`;
  }
  if (block.kind === "vector") {
    const figure = block.figure && block.figure.kind !== "missing"
      ? `<div class="vector-figure">${renderFigure(block.figure)}</div>`
      : `<p class="missing">${escapeHtml(block.note)}</p>`;
    return `<section class="block">${figure}
      <dl class="facts">${block.facts.map(([label, value]) => factRow(label, value)).join("")}</dl></section>`;
  }
  if (block.kind === "yield") return renderYield(input.data);
  if (block.kind === "purity") return renderPurity(input.data);
  if (block.kind === "sec") return renderSec(input.data);
  if (block.kind === "methods") return renderMethods(input.data);
  if (block.kind === "flags") return renderFlags(input.data.flags);
  return "";
}

function renderYield(data: ReportData) {
  if (!data.yieldRows.length) {
    return `<p class="missing">No purification stages are recorded for this project yet. Build the purification roadmap and the yield table fills in.</p>`;
  }
  const rows = data.yieldRows.map((row) => [
    escapeHtml(row.stage) + (row.flags.length ? ` <span class="flag-mark">${flagMark(row.flags)}</span>` : ""),
    formatNumber(row.volumeMl, 1),
    formatNumber(row.concentrationMgMl, 2),
    formatNumber(row.totalProteinMg, 2),
    row.stepRecoveryPercent === null ? "—" : `${row.stepRecoveryPercent.toFixed(0)}%`,
    row.overallRecoveryPercent === null ? "—" : `${row.overallRecoveryPercent.toFixed(0)}%`,
    row.purityPercent === null ? "—" : `${row.purityPercent.toFixed(1)}%`,
  ]);
  const methods = data.yieldRows.filter((row) => row.yieldMethod || row.purityMethod || row.note);
  return `<section class="block"><h3>Yield across the purification</h3>
    ${table(["Stage", "Volume (mL)", "Concentration (mg/mL)", "Total protein (mg)", "Step recovery", "Overall recovery", "Purity"], rows, [false, true, true, true, true, true, true])}
    ${methods.length ? `<dl class="facts narrow">${methods.map((row) => factRow(row.stage,
      [row.yieldMethod && `protein by ${row.yieldMethod}`, row.purityMethod && `purity by ${row.purityMethod}`, row.note]
        .filter(Boolean).join(" · "))).join("")}</dl>` : ""}
    <p class="table-note">Recovery is calculated against the first and the preceding quantified stage. A dash means the measurement was not recorded, not that it was zero.</p>
  </section>`;
}

function renderPurity(data: ReportData) {
  const purity = data.purity;
  if (!purity) {
    return `<p class="missing">No gel densitometry has been saved for this project, so per-stage purity is not reported. Quantify a gel in Gel densitometry and save it.</p>`;
  }
  const rows = purity.rows.filter((row) => !row.isLadder).map((row) => [
    escapeHtml(row.lane) + (row.flags.length ? ` <span class="flag-mark">${flagMark(row.flags)}</span>` : ""),
    escapeHtml(row.targetBand || "Not marked"),
    row.targetMwKDa === null ? "—" : formatMass(row.targetMwKDa),
    String(row.bandCount),
    row.purityPercent === null ? "—" : `${row.purityPercent.toFixed(1)}%`,
  ]);
  return `<section class="block"><h3>Purity by stage</h3>
    ${rows.length ? table(["Lane / stage", "Target band", "Apparent mass", "Bands detected", "Lane purity"], rows, [false, false, true, true, true])
      : `<p class="missing">The saved gel has no quantified sample lanes.</p>`}
    <dl class="facts narrow">
      ${factRow("Method", purity.method)}
      ${factRow("Ladder", purity.ladderPreset)}
      ${factRow("Ladder calibration", purity.calibration
        ? `log₁₀(Mr) = ${purity.calibration.slope.toFixed(4)} Rf + ${purity.calibration.intercept.toFixed(4)}, R² ${purity.calibration.r2.toFixed(4)}`
        : "Not calibrated")}
    </dl>
    <p class="table-note">Lane purity is the integrated density of the target band as a fraction of all detected bands in that lane.</p>
  </section>`;
}

function renderSec(data: ReportData) {
  const sec = data.sec;
  if (!sec) {
    return `<p class="missing">No chromatogram has been saved for this project, so no size-exclusion molecular mass is reported.</p>`;
  }
  const rows = sec.peaks.map((peak) => [
    escapeHtml(peak.name) + (peak.flags.length ? ` <span class="flag-mark">${flagMark(peak.flags)}</span>` : ""),
    formatNumber(peak.veMl, 2),
    peak.kav === null ? "—" : peak.kav.toFixed(3),
    peak.mwKDa === null ? "Not assigned" : formatMass(peak.mwKDa),
    peak.areaPercent === null ? "—" : `${peak.areaPercent.toFixed(1)}%`,
    escapeHtml(peak.fraction || "—"),
  ]);
  return `<section class="block"><h3>Size-exclusion molecular mass</h3>
    <dl class="facts narrow">
      ${factRow("Column", sec.columnName)}
      ${factRow("Void volume V₀", sec.voMl === null ? "" : `${formatNumber(sec.voMl, 2)} mL`)}
      ${factRow("Total column volume Vt", sec.vtMl === null ? "" : `${formatNumber(sec.vtMl, 2)} mL`)}
      ${factRow("Flow rate", sec.flowMlMin === null ? "" : `${formatNumber(sec.flowMlMin, 2)} mL/min`)}
      ${factRow("Injection volume", sec.sampleVolumeMl === null ? "" : `${formatNumber(sec.sampleVolumeMl, 3)} mL`)}
      ${factRow("Expected native mass", sec.expectedMassKDa === null ? "" : formatMass(sec.expectedMassKDa))}
      ${factRow("Calibration", sec.fit
        ? `Kav = ${sec.fit.slope.toFixed(4)} log₁₀(Mr) + ${sec.fit.intercept.toFixed(4)}`
        : "Not calibrated")}
      ${factRow("Fit quality", sec.fit ? `R² ${sec.fit.r2.toFixed(4)} from ${sec.fit.standards} standard${sec.fit.standards === 1 ? "" : "s"}` : "")}
      ${factRow("Calibrated mass range", sec.calibratedRangeKDa ? `${formatMass(sec.calibratedRangeKDa[0])} – ${formatMass(sec.calibratedRangeKDa[1])}` : "")}
    </dl>
    ${rows.length ? table(["Peak", "Vₑ (mL)", "Kav", "Apparent mass", "Area", "Fraction"], rows, [false, true, true, true, true, false])
      : `<p class="missing">No peaks were integrated on the saved chromatogram.</p>`}
    <p class="table-note">Apparent mass is calculated from the Kav against log₁₀(Mr) calibration and refers to globular standards; it is not a mass measurement.</p>
  </section>`;
}

function renderMethods(data: ReportData) {
  if (!data.methods.length) {
    return `<p class="missing">No purification steps have been planned for this project yet, so there is nothing to describe as a method.</p>`;
  }
  return data.methods.map((block: MethodBlock) => `<section class="block method-block">
    <h3>${escapeHtml(block.title)}</h3>
    ${block.summary ? `<p class="method-summary">${escapeHtml(block.summary)}</p>` : ""}
    <dl class="facts narrow">${block.lines.map((line) => factRow(line.label, line.value)).join("")}</dl>
  </section>`).join("\n");
}

function renderFlags(flags: ReportFlag[]) {
  if (!flags.length) {
    return `<p class="missing">The analysis engines raised no flags on the numbers in this report.</p>`;
  }
  const unique = dedupe(flags);
  return `<section class="block"><h3>Caveats and engine flags</h3>
    <ul class="flag-list">
      ${unique.map((item) => `<li class="flag-${item.level}">
        <p class="flag-head"><span class="flag-level">${escapeHtml(levelLabel(item.level))}</span> ${escapeHtml(item.scope)}</p>
        <p class="flag-title">${escapeHtml(item.title)}</p>
        ${item.detail ? `<p class="flag-detail">${escapeHtml(item.detail)}</p>` : ""}
      </li>`).join("")}
    </ul>
  </section>`;
}

function renderFigure(figure: PrintFigure) {
  const body = figure.kind === "missing"
    ? `<p class="missing">${escapeHtml(figure.note ?? "This figure is no longer saved in the project.")}</p>`
    : figure.markup;
  return `<figure class="report-figure">
    <div class="figure-frame">${body}</div>
    <figcaption><b>Figure ${figure.number}.</b> ${escapeHtml(figure.caption)}${figure.kind === "raster" ? ` <span class="figure-kind">Raster image as captured.</span>` : ""}</figcaption>
  </figure>`;
}

/* ========================================================================
   Markup helpers
   ======================================================================== */

function table(header: string[], rows: string[][], numeric: boolean[]) {
  return `<table>
    <thead><tr>${header.map((cell, index) => `<th${numeric[index] ? ' class="num"' : ""}>${escapeHtml(cell)}</th>`).join("")}</tr></thead>
    <tbody>${rows.map((row) => `<tr>${row.map((cell, index) => `<td${numeric[index] ? ' class="num"' : ""}>${cell}</td>`).join("")}</tr>`).join("")}</tbody>
  </table>`;
}

function factRow(label: string, value: string) {
  if (!value) return "";
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function paragraphs(text: string) {
  return text.trim().split(/\n{2,}/).map((block) => `<p>${escapeHtml(block).replace(/\n/g, "<br/>")}</p>`).join("");
}

function flagMark(flags: ReportFlag[]) {
  return flags.some((item) => item.level === "warning") ? "▲" : "△";
}

function levelLabel(level: ReportFlag["level"]) {
  return level === "warning" ? "Flag" : level === "caution" ? "Caution" : "Note";
}

function countFlags(flags: ReportFlag[]) {
  const unique = dedupe(flags);
  const warnings = unique.filter((item) => item.level === "warning").length;
  const cautions = unique.filter((item) => item.level === "caution").length;
  const notes = unique.length - warnings - cautions;
  const parts = [
    warnings ? `${warnings} engine flag${warnings === 1 ? "" : "s"}` : "",
    cautions ? `${cautions} caution${cautions === 1 ? "" : "s"}` : "",
    notes ? `${notes} note${notes === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return `${parts.join(", ")}. Every one is listed in full with the measurement it applies to; a flagged number is marked ▲ or △ in the tables.`;
}

export function dedupe(flags: ReportFlag[]) {
  const seen = new Set<string>();
  const order: Record<ReportFlag["level"], number> = { warning: 0, caution: 1, note: 2 };
  return flags
    .filter((item) => (seen.has(item.id) ? false : seen.add(item.id)))
    .sort((a, b) => order[a.level] - order[b.level]);
}

export function escapeHtml(value: string) {
  return value.replace(/[&<>"']/g, (character) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[character] ?? character
  ));
}

/* ========================================================================
   Print stylesheet
   ======================================================================== */

function documentCss(mode: PrintInput["mode"]) {
  // 18 mm page margins match the margins the PDF writer is given, so the
  // standalone HTML and the PDF break in the same places.
  return `
@page { size: A4; margin: 18mm 16mm; }
:root { --ink: #16191c; --muted: #5c656b; --rule: #c9ced2; --hair: #e4e7e9; }
* { box-sizing: border-box; }
html { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
body {
  margin: 0;
  color: var(--ink);
  background: #fff;
  font: 400 10.2pt/1.5 "Charter", Georgia, "Times New Roman", serif;
  font-variant-numeric: tabular-nums lining-nums;
  orphans: 3;
  widows: 3;
}
${mode === "html" ? `
body { padding: 18mm 16mm; max-width: 210mm; margin: 0 auto; }
.running-head, .running-foot { display: none; }
@media print {
  body { padding: 0; max-width: none; }
  .running-head, .running-foot {
    display: block;
    position: fixed;
    left: 0; right: 0;
    font: 400 7.6pt/1.2 "Charter", Georgia, serif;
    letter-spacing: .04em;
    color: var(--muted);
  }
  .running-head { top: -11mm; border-bottom: .4pt solid var(--hair); padding-bottom: 2.4mm; }
  .running-foot { bottom: -11mm; text-align: right; }
}` : ""}

h1 { font: 700 23pt/1.15 inherit; margin: 10pt 0 6pt; letter-spacing: -.2pt; }
h2 { font: 700 14pt/1.2 inherit; margin: 0; }
h3 {
  font: 700 8pt/1.2 inherit;
  letter-spacing: .1em;
  text-transform: uppercase;
  color: var(--muted);
  margin: 0 0 5pt;
}
p { margin: 0 0 7pt; }

/* A page per stage, and never a heading alone at the foot of one. */
.page { break-before: page; }
.page:first-of-type { break-before: auto; }
.page-head { display: flex; align-items: baseline; justify-content: space-between; gap: 10pt; border-bottom: 1.4pt solid var(--ink); padding-bottom: 5pt; margin-bottom: 11pt; break-after: avoid; }
.page-sub { margin: 2pt 0 0; font-size: 9pt; font-style: italic; color: var(--muted); }
h1, h2, h3, .page-head, .method-summary { break-after: avoid; }
.block { margin: 0 0 13pt; }
.block > h3 + * { break-before: avoid; }

.kicker { font: 600 7.6pt/1 inherit; letter-spacing: .18em; text-transform: uppercase; color: var(--muted); margin: 0; }
.lede { font-size: 11pt; color: #3d464b; margin: 0 0 16pt; }
.cover { padding-top: 6mm; }
.cover-facts { margin-top: 10pt; }
.cover-caveats { margin-top: 16pt; border: .6pt solid var(--rule); border-left: 2.4pt solid var(--ink); padding: 9pt 11pt; break-inside: avoid; }
.cover-caveats h3 { margin-bottom: 4pt; }
.cover-caveats p { margin: 0; font-size: 9.2pt; }

dl.facts { display: grid; grid-template-columns: 1fr 1fr; gap: 0 22pt; margin: 0; }
dl.facts.narrow { grid-template-columns: 1fr; }
dl.facts > div { display: flex; align-items: baseline; justify-content: space-between; gap: 10pt; border-bottom: .4pt solid var(--hair); padding: 3.4pt 0; break-inside: avoid; }
dt { font-size: 8.6pt; color: var(--muted); }
dd { margin: 0; font-size: 9pt; font-weight: 600; text-align: right; }

table { width: 100%; border-collapse: collapse; margin: 0 0 7pt; }
/* The header repeats on every page a long table runs onto, and no row is
   allowed to break across the fold. */
thead { display: table-header-group; }
tbody { break-inside: auto; }
tr { break-inside: avoid; break-after: auto; }
th, td { text-align: left; font-size: 8.8pt; padding: 4pt 6pt 4pt 0; border-bottom: .4pt solid var(--hair); vertical-align: top; }
th { font-size: 7.6pt; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); border-bottom: 1pt solid var(--ink); font-weight: 700; }
td.num, th.num { text-align: right; padding-right: 0; padding-left: 6pt; }
.table-note { font-size: 8pt; font-style: italic; color: var(--muted); margin: 4pt 0 0; }

.prose { margin: 0 0 12pt; font-size: 10pt; }
.prose p { margin: 0 0 7pt; }
.method-block { break-inside: avoid; }
.method-summary { font-size: 9pt; color: var(--muted); margin: 0 0 5pt; }

.report-figure { margin: 0 0 14pt; break-inside: avoid; }
.figure-frame { border: .5pt solid var(--rule); padding: 7pt; background: #fff; text-align: center; }
.figure-frame svg { width: 100%; height: auto; max-height: 112mm; display: block; margin: 0 auto; color: var(--ink); }
.figure-frame img { max-width: 100%; max-height: 112mm; height: auto; display: block; margin: 0 auto; }
figcaption { font-size: 8.4pt; line-height: 1.45; color: var(--muted); margin-top: 5pt; text-align: left; }
figcaption b { color: var(--ink); }
.figure-kind { font-style: italic; }
.property-block { display: grid; grid-template-columns: 58mm 1fr; gap: 14pt; align-items: start; }
.property-block dl.facts { grid-template-columns: 1fr; }
.property-figure .report-figure { margin: 0; }
.property-figure .figure-frame svg, .property-figure .figure-frame img { max-height: 58mm; }
.vector-figure { margin-bottom: 10pt; }
.vector-figure .report-figure { margin: 0 auto; max-width: 120mm; }

.missing { font-size: 9pt; font-style: italic; color: var(--muted); }
.flag-mark { font-size: 8pt; }
.flag-list { list-style: none; margin: 0; padding: 0; }
.flag-list li { border-left: 2.4pt solid var(--rule); padding: 0 0 0 9pt; margin: 0 0 9pt; break-inside: avoid; }
.flag-list li.flag-warning { border-left-color: #16191c; }
.flag-head { margin: 0; font-size: 7.6pt; letter-spacing: .07em; text-transform: uppercase; color: var(--muted); }
.flag-level { font-weight: 700; color: var(--ink); }
.flag-title { margin: 1pt 0 2pt; font-size: 9.4pt; font-weight: 700; }
.flag-detail { margin: 0; font-size: 8.8pt; color: #3d464b; }
`;
}
