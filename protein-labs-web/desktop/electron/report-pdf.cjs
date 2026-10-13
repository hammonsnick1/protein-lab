const { BrowserWindow } = require("electron");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");

/**
 * The purification report's PDF writer.
 *
 * The report is printed by Chromium's PDF writer in an offscreen window rather
 * than through the print dialog. That keeps the text selectable, turns the
 * report's inline SVG figures into vector paths, and lets the repeating header
 * and the page numbers come from print templates.
 *
 * It lives apart from the window and menu code so the same function that ships
 * can be run headlessly against a rendered report.
 */

const HEADER_FOOTER_STYLE =
  "font:8px Georgia,'Times New Roman',serif;color:#5c656b;width:100%;" +
  "padding:0 16mm;-webkit-print-color-adjust:exact;";

function escapeTemplate(value) {
  return String(value).replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character]));
}

/** A title a reader can find again on disk, not a UUID. */
function reportFilename(value) {
  const safe = String(value || "")
    .trim()
    .replace(/[^a-z0-9._-]+/gi, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 120)
    .toLowerCase();
  return `${safe || "purification-report"}.pdf`;
}

/**
 * Print a report document to PDF bytes.
 *
 * The document is written to a temporary file rather than loaded from a data
 * URL: a report that embeds a gel photograph is far larger than a URL can
 * carry.
 */
async function renderReportPdf(html, { header = "", footer = "" } = {}) {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "protein-labs-report-"));
  const source = path.join(scratch, "report.html");
  let worker;
  try {
    fs.writeFileSync(source, html, "utf8");
    worker = new BrowserWindow({
      show: false,
      webPreferences: {
        offscreen: true,
        // The report embeds figure markup lifted from the live workspace, so
        // scripting stays off in the window that renders it.
        javascript: false,
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    });
    await worker.loadFile(source);
    return await worker.webContents.printToPDF({
      pageSize: "A4",
      printBackground: true,
      // 18 mm top and bottom, 16 mm left and right, matching the @page margins
      // in the report stylesheet so the PDF and the HTML break alike.
      margins: { marginType: "custom", top: 0.71, bottom: 0.71, left: 0.63, right: 0.63 },
      displayHeaderFooter: true,
      headerTemplate: `<div style="${HEADER_FOOTER_STYLE}border-bottom:0.4px solid #e4e7e9;padding-bottom:2mm;">${escapeTemplate(header)}</div>`,
      footerTemplate: `<div style="${HEADER_FOOTER_STYLE}display:flex;justify-content:space-between;">`
        + `<span>${escapeTemplate(footer)}</span>`
        + `<span>Page <span class="pageNumber"></span> of <span class="totalPages"></span></span></div>`,
      generateTaggedPDF: true,
      generateDocumentOutline: true,
    });
  } finally {
    if (worker && !worker.isDestroyed()) worker.destroy();
    fs.rmSync(scratch, { recursive: true, force: true });
  }
}

module.exports = { renderReportPdf, reportFilename };
