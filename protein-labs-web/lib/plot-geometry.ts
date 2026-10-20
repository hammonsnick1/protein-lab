// Geometry for the Chromatogram Studio plot, kept free of React and the DOM so
// it can be tested with `npm run test`.

export type StudioTab = "data" | "analysis" | "standard" | "figure" | "export";
type Size = { width: number; height: number };
type Matrix = { a: number; b: number; c: number; d: number; e: number; f: number };

// The fixed size a figure is drawn and exported at.
export const FIGURE_SIZE: Size = { width: 1000, height: 700 };
// The interactive plot's fallback size before its box has been measured.
export const INTERACTIVE_SIZE: Size = { width: 1000, height: 590 };
// Interface text floor (HOM-99) applied to plot text drawn on screen.
export const SCREEN_TEXT_FLOOR_PX = 12;

/**
 * How a tab uses the plot. The Export tab keeps the figure mounted but hidden:
 * its SVG, PNG, TIFF, PDF and clipboard exports serialize that SVG, so without
 * it every figure export silently did nothing.
 */
export function plotRole(tab: StudioTab): "none" | "interactive" | "figure" | "export-source" {
  if (tab === "analysis") return "interactive";
  if (tab === "figure") return "figure";
  if (tab === "export") return "export-source";
  return "none";
}

/**
 * The plot's viewBox. A figure keeps its fixed export size. The interactive
 * plot follows its measured box, at no more than 1000 units wide, so on narrow
 * windows one unit is one pixel and text keeps its real size, and the drawing
 * has the box's aspect ratio, so it never letterboxes.
 */
export function plotViewBox(box: Size | null, figureMode: boolean): Size {
  if (figureMode) return FIGURE_SIZE;
  if (!box || box.width <= 0 || box.height <= 0) return INTERACTIVE_SIZE;
  const width = Math.round(Math.min(INTERACTIVE_SIZE.width, box.width));
  return { width, height: Math.round((width * box.height) / box.width) };
}

/** On screen, plot text never drops below the floor; figures keep their configured size. */
export function screenTextSize(size: number, figureMode: boolean): number {
  return figureMode ? size : Math.max(SCREEN_TEXT_FLOOR_PX, size);
}

/**
 * A pointer position in viewBox units, from the SVG's screen transform
 * (`getScreenCTM()`). Unlike scaling by the bounding box, this stays exact when
 * the drawing is letterboxed inside its box.
 */
export function clientToViewBox(clientX: number, clientY: number, matrix: Matrix | null): { x: number; y: number } {
  if (!matrix) return { x: 0, y: 0 };
  const { a, b, c, d, e, f } = matrix;
  const determinant = a * d - b * c;
  if (!determinant) return { x: 0, y: 0 };
  const dx = clientX - e, dy = clientY - f;
  return { x: (d * dx - c * dy) / determinant, y: (a * dy - b * dx) / determinant };
}

const SVG_NAMESPACE = "http://www.w3.org/2000/svg";

/**
 * Serialized SVG that stands alone: a saved .svg file or an <img> source is
 * only read as an image when the root carries the SVG namespace. Without it
 * every raster export failed with "The figure could not be rendered".
 */
export function withSvgNamespace(markup: string): string {
  return markup.replace(/^<svg\b(?![^>]*\sxmlns=)/, `<svg xmlns="${SVG_NAMESPACE}"`);
}
