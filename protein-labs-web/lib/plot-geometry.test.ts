// Chromatogram Studio plot geometry (HOM-79). Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import {
  clientToViewBox,
  FIGURE_SIZE,
  INTERACTIVE_SIZE,
  plotRole,
  plotViewBox,
  screenTextSize,
  withSvgNamespace,
} from "./plot-geometry.ts";

describe("plotRole", () => {
  it("keeps the figure mounted on the Export tab, so figure exports have an SVG to serialize", () => {
    assert.equal(plotRole("export"), "export-source");
  });

  it("draws the interactive plot on Analysis and the export figure on Figures", () => {
    assert.equal(plotRole("analysis"), "interactive");
    assert.equal(plotRole("figure"), "figure");
  });

  it("has no plot on the Data and Standard curve tabs", () => {
    assert.equal(plotRole("data"), "none");
    assert.equal(plotRole("standard"), "none");
  });
});

describe("plotViewBox", () => {
  it("keeps a figure at its fixed export size whatever its box", () => {
    assert.deepEqual(plotViewBox({ width: 400, height: 300 }, true), FIGURE_SIZE);
  });

  it("draws the interactive plot one unit per pixel when the box is narrower than 1000", () => {
    // 900×650 window: the plot box is about 410 px wide.
    assert.deepEqual(plotViewBox({ width: 410, height: 500 }, false), { width: 410, height: 500 });
  });

  it("caps the interactive plot at 1000 units, keeping the box's aspect ratio", () => {
    assert.deepEqual(plotViewBox({ width: 2000, height: 1100 }, false), { width: 1000, height: 550 });
  });

  it("falls back to the default size before the box is measured", () => {
    assert.deepEqual(plotViewBox(null, false), INTERACTIVE_SIZE);
    assert.deepEqual(plotViewBox({ width: 0, height: 0 }, false), INTERACTIVE_SIZE);
  });

  it("puts the default 11 px ticks at their real size at 1440 (plot box about 920 px)", () => {
    const box = { width: 920, height: 580 };
    const pxPerUnit = box.width / plotViewBox(box, false).width;
    assert.ok(screenTextSize(11, false) * pxPerUnit >= 12);
  });
});

describe("screenTextSize", () => {
  it("raises on-screen plot text to the 12 px floor", () => {
    assert.equal(screenTextSize(10, false), 12);
    assert.equal(screenTextSize(14, false), 14);
  });

  it("keeps the configured size in exported figures", () => {
    assert.equal(screenTextSize(10, true), 10);
  });
});

describe("clientToViewBox", () => {
  // A 1000×590 viewBox drawn in a 920×580 box at (220, 278): scaled 0.92 and
  // letterboxed 18.6 px down. Scaling by the bounding box would put the
  // pointer about 5 units off vertically.
  const scale = 0.92, left = 220, top = 278, offsetY = (580 - 590 * scale) / 2;
  const matrix = { a: scale, b: 0, c: 0, d: scale, e: left, f: top + offsetY };

  it("maps a pointer through the screen transform, letterboxing included", () => {
    const point = clientToViewBox(left + 500 * scale, top + offsetY + 300 * scale, matrix);
    assert.ok(Math.abs(point.x - 500) < 1e-9);
    assert.ok(Math.abs(point.y - 300) < 1e-9);
  });

  it("returns the origin when there is no usable transform", () => {
    assert.deepEqual(clientToViewBox(10, 10, null), { x: 0, y: 0 });
    assert.deepEqual(clientToViewBox(10, 10, { a: 0, b: 0, c: 0, d: 0, e: 0, f: 0 }), { x: 0, y: 0 });
  });
});

describe("withSvgNamespace", () => {
  it("adds the SVG namespace React leaves off, so the file and raster exports load as an image", () => {
    assert.equal(
      withSvgNamespace('<svg class="chromatogram-canvas" viewBox="0 0 1000 700"><text>1</text></svg>'),
      '<svg xmlns="http://www.w3.org/2000/svg" class="chromatogram-canvas" viewBox="0 0 1000 700"><text>1</text></svg>',
    );
  });

  it("leaves markup that already has the namespace unchanged", () => {
    const markup = '<svg viewBox="0 0 10 10" xmlns="http://www.w3.org/2000/svg"></svg>';
    assert.equal(withSvgNamespace(markup), markup);
  });
});
