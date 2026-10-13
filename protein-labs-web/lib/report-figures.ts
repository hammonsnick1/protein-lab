import type { PrintFigure, PrintFigureKind } from "@/lib/report-print";

/** A captured figure before the report assigns it a number. */
export type CapturedFigure = Omit<PrintFigure, "number">;

/**
 * Lifting a figure out of the live report and into the exported document.
 *
 * The report draws its chromatograms, plasmid maps, and structure panels as
 * SVG, so the export keeps them as SVG: a chromatogram stays sharp at any zoom
 * and prints as vector lines rather than a screenshot. The one thing that has
 * to travel is colour — the workspace figures take their colours from theme
 * custom properties and `currentColor`, which do not exist in a standalone
 * document, so the serialiser resolves every painted property to the value the
 * screen is actually showing.
 */

const PAINTED_PROPERTIES = [
  "fill", "fill-opacity", "fill-rule",
  "stroke", "stroke-opacity", "stroke-width", "stroke-linecap", "stroke-linejoin", "stroke-dasharray",
  // Without paint-order a haloed label exports with its halo painted over the
  // glyphs, which turns a readable label into a white smear.
  "paint-order",
  "opacity", "color", "filter",
  "font-size", "font-weight", "font-style", "text-anchor", "dominant-baseline", "letter-spacing",
];

export function flattenSvg(svg: SVGSVGElement): string {
  const clone = svg.cloneNode(true) as SVGSVGElement;
  const originals: Element[] = [svg, ...Array.from(svg.querySelectorAll("*"))];
  const clones: Element[] = [clone, ...Array.from(clone.querySelectorAll("*"))];
  const count = Math.min(originals.length, clones.length);
  for (let index = 0; index < count; index += 1) {
    const computed = window.getComputedStyle(originals[index]);
    const declarations: string[] = [];
    for (const property of PAINTED_PROPERTIES) {
      const value = computed.getPropertyValue(property);
      // The document's own serif supplies the family, so a figure's text
      // matches the report rather than the running application.
      if (value) declarations.push(`${property}:${value}`);
    }
    clones[index].setAttribute("style", declarations.join(";"));
    clones[index].removeAttribute("class");
  }
  clone.removeAttribute("style");
  clone.setAttribute("xmlns", "http://www.w3.org/2000/svg");
  clone.removeAttribute("width");
  clone.removeAttribute("height");
  return new XMLSerializer().serializeToString(clone);
}

/**
 * Read one placed figure out of the rendered report.
 *
 * Frames are tagged with `data-report-figure` so the export does not have to
 * rebuild the figures it is exporting; whatever the reader can see on screen is
 * what goes into the document.
 */
export function captureFigure(id: string, caption: string): CapturedFigure {
  const host = document.querySelector(`[data-report-figure="${cssEscape(id)}"]`);
  if (!host) {
    return { id, caption, kind: "missing", markup: "", note: "This figure was not rendered when the report was exported." };
  }
  const svg = host.querySelector("svg");
  if (svg) return { id, caption, kind: "vector", markup: flattenSvg(svg as SVGSVGElement) };
  const image = host.querySelector("img");
  if (image instanceof HTMLImageElement && image.src) {
    return { id, caption, kind: "raster", markup: `<img src="${image.src}" alt=""/>` };
  }
  const canvas = host.querySelector("canvas");
  if (canvas instanceof HTMLCanvasElement) {
    try {
      return { id, caption, kind: "raster", markup: `<img src="${canvas.toDataURL("image/png")}" alt=""/>` };
    } catch {
      // A canvas that refuses to be read is reported as missing rather than
      // silently dropped, so the reader knows a figure was meant to be here.
    }
  }
  const note = host.textContent?.trim();
  return {
    id,
    caption,
    kind: "missing" as PrintFigureKind,
    markup: "",
    note: note || "This figure has no saved data in the project.",
  };
}

function cssEscape(value: string) {
  return value.replace(/["\\]/g, "\\$&");
}
