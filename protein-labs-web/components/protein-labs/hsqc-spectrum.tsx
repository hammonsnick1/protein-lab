"use client";

import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from "react";
import { Maximize, Minus, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  axisTicks, clampView, contourLevels, contourSegments, DEFAULT_VIEW, intensityGrid, panView, placeLabels, revealPoint, tickDecimals, zoomView,
  type Peak, type SpectrumView,
} from "@/lib/hsqc";

type Props = {
  peaks: Peak[];
  selectedId: string | null;
  onSelect: (peak: Peak | null) => void;
  view: SpectrumView;
  onView: (view: SpectrumView) => void;
  bounds: SpectrumView;
  rmse: { h: number | null; n: number | null };
  predictorLabel: string;
};

const MARGIN = { top: 12, right: 64, bottom: 46, left: 14 };
// Contour grid spacing in screen pixels: fine enough to resolve a 4-pixel-wide peak at full view.
const CELL = 1.5;
const LEVELS = contourLevels();
const HIT_RADIUS = 10;

/** A Sparky-style ¹H–¹⁵N contour map: reversed ppm axes, wheel zoom, drag to pan, click a peak to select it. */
export function HsqcSpectrum({ peaks, selectedId, onSelect, view, onView, bounds, rmse, predictorLabel }: Props) {
  const box = useRef<HTMLDivElement | null>(null);
  const svg = useRef<SVGSVGElement | null>(null);
  const clipId = useId();
  const helpId = useId();
  const [width, setWidth] = useState(720);
  const [hover, setHover] = useState<{ h: number; n: number; peak: Peak | null; count: number } | null>(null);
  const [showLabels, setShowLabels] = useState(true);
  const [showAllErrors, setShowAllErrors] = useState(false);
  const drag = useRef<{ x: number; y: number; view: SpectrumView; moved: boolean } | null>(null);

  useEffect(() => {
    const element = box.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.max(360, Math.round(entry.contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const height = Math.round(Math.min(620, Math.max(380, width * 0.7)));
  const plotW = width - MARGIN.left - MARGIN.right, plotH = height - MARGIN.top - MARGIN.bottom;

  // Reversed axes: high ¹H on the left, low ¹⁵N at the top.
  const x = (h: number) => MARGIN.left + ((view.h[1] - h) / (view.h[1] - view.h[0])) * plotW;
  const y = (n: number) => MARGIN.top + ((n - view.n[0]) / (view.n[1] - view.n[0])) * plotH;
  const ppmAt = (px: number, py: number) => ({ h: view.h[1] - ((px - MARGIN.left) / plotW) * (view.h[1] - view.h[0]), n: view.n[0] + ((py - MARGIN.top) / plotH) * (view.n[1] - view.n[0]) });

  const contours = useMemo(() => {
    const cols = Math.max(2, Math.round(plotW / CELL)), rows = Math.max(2, Math.round(plotH / CELL));
    const grid = intensityGrid(peaks, view, cols, rows);
    const sx = plotW / (cols - 1), sy = plotH / (rows - 1);
    return LEVELS.map((level) => {
      const segments = contourSegments(grid, level);
      let path = "";
      for (let index = 0; index < segments.length; index += 4) path += `M${(MARGIN.left + segments[index] * sx).toFixed(1)} ${(MARGIN.top + segments[index + 1] * sy).toFixed(1)}L${(MARGIN.left + segments[index + 2] * sx).toFixed(1)} ${(MARGIN.top + segments[index + 3] * sy).toFixed(1)}`;
      return path;
    });
  }, [peaks, view, plotW, plotH]);

  const visible = peaks.filter((peak) => peak.h >= view.h[0] && peak.h <= view.h[1] && peak.n >= view.n[0] && peak.n <= view.n[1]);
  const selected = peaks.find((peak) => peak.id === selectedId) ?? null;
  const labelled = useMemo(() => {
    if (!showLabels) return new Set<string>();
    const order = [...visible].sort((one, other) => (one.id === selectedId ? -1 : other.id === selectedId ? 1 : one.position - other.position));
    return placeLabels(order.map((peak) => ({ id: peak.id, x: x(peak.h) + 5, y: y(peak.n) - 16, width: peak.label.length * 7.4 + 4, height: 15 })));
    // x and y are derived from view and size, which are listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visible.length, view, plotW, plotH, selectedId, showLabels, peaks]);
  const hiddenLabels = showLabels ? visible.length - labelled.size : 0;
  const hTicks = axisTicks(view.h, Math.max(4, Math.round(plotW / 90))), nTicks = axisTicks(view.n, Math.max(4, Math.round(plotH / 60)));
  const hDecimals = tickDecimals(hTicks), nDecimals = tickDecimals(nTicks);
  const zoomed = view.h[0] !== DEFAULT_VIEW.h[0] || view.h[1] !== DEFAULT_VIEW.h[1] || view.n[0] !== DEFAULT_VIEW.n[0] || view.n[1] !== DEFAULT_VIEW.n[1];
  const hasErrors = rmse.h !== null && rmse.n !== null;

  function local(event: { clientX: number; clientY: number }) {
    const rect = svg.current!.getBoundingClientRect();
    return { px: event.clientX - rect.left, py: event.clientY - rect.top };
  }
  /** Peaks under the pointer, nearest first. */
  function under(px: number, py: number): Peak[] {
    return visible.map((peak) => ({ peak, d: Math.hypot(x(peak.h) - px, y(peak.n) - py) })).filter((item) => item.d <= HIT_RADIUS)
      .sort((one, other) => one.d - other.d || one.peak.position - other.peak.position).map((item) => item.peak);
  }
  /** Overlapping peaks: each click on the same spot selects the next one. */
  function pickAt(px: number, py: number): Peak | null {
    const hits = under(px, py);
    const index = hits.findIndex((peak) => peak.id === selectedId);
    return hits.length ? hits[(index + 1) % hits.length] : null;
  }
  const inPlot = (px: number, py: number) => px >= MARGIN.left && px <= MARGIN.left + plotW && py >= MARGIN.top && py <= MARGIN.top + plotH;

  // Wheel zoom needs a non-passive listener to stop the page scrolling.
  const wheel = useRef<(event: WheelEvent) => void>(() => undefined);
  useEffect(() => {
    wheel.current = (event: WheelEvent) => {
      const { px, py } = local(event);
      if (!inPlot(px, py)) return;
      event.preventDefault();
      onView(zoomView(view, event.deltaY > 0 ? 1.2 : 1 / 1.2, ppmAt(px, py), bounds));
    };
  });
  useEffect(() => {
    const element = svg.current;
    if (!element) return;
    const listener = (event: WheelEvent) => wheel.current(event);
    element.addEventListener("wheel", listener, { passive: false });
    return () => element.removeEventListener("wheel", listener);
  }, []);

  function pointerDown(event: PointerEvent<SVGSVGElement>) {
    if (event.button !== 0) return;
    const { px, py } = local(event);
    if (!inPlot(px, py)) return;
    drag.current = { x: event.clientX, y: event.clientY, view, moved: false };
    event.currentTarget.setPointerCapture(event.pointerId);
  }
  function pointerMove(event: PointerEvent<SVGSVGElement>) {
    const { px, py } = local(event);
    const start = drag.current;
    if (start) {
      const dx = event.clientX - start.x, dy = event.clientY - start.y;
      if (Math.hypot(dx, dy) > 3) start.moved = true;
      if (start.moved) onView(panView(start.view, (dx / plotW) * (start.view.h[1] - start.view.h[0]), -(dy / plotH) * (start.view.n[1] - start.view.n[0]), bounds));
      return;
    }
    const hits = inPlot(px, py) ? under(px, py) : [];
    setHover(inPlot(px, py) ? { ...ppmAt(px, py), peak: hits[0] ?? null, count: hits.length } : null);
  }
  function pointerUp(event: PointerEvent<SVGSVGElement>) {
    const start = drag.current;
    drag.current = null;
    if (!start || start.moved) return;
    const { px, py } = local(event);
    onSelect(pickAt(px, py));
  }

  function step(delta: 1 | -1) {
    if (!peaks.length) return;
    const order = [...peaks].sort((one, other) => one.position - other.position || one.id.localeCompare(other.id));
    const index = selected ? order.findIndex((peak) => peak.id === selected.id) : -1;
    const next = order[(index + delta + order.length) % order.length];
    onSelect(next);
    onView(revealPoint(view, next, bounds));
  }
  function zoomCentre(factor: number) { onView(zoomView(view, factor, { h: (view.h[0] + view.h[1]) / 2, n: (view.n[0] + view.n[1]) / 2 }, bounds)); }
  function keyDown(event: KeyboardEvent<SVGSVGElement>) {
    const panH = (view.h[1] - view.h[0]) * 0.1, panN = (view.n[1] - view.n[0]) * 0.1;
    const actions: Record<string, () => void> = {
      ArrowLeft: () => onView(panView(view, panH, 0, bounds)),
      ArrowRight: () => onView(panView(view, -panH, 0, bounds)),
      ArrowUp: () => onView(panView(view, 0, -panN, bounds)),
      ArrowDown: () => onView(panView(view, 0, panN, bounds)),
      "+": () => zoomCentre(1 / 1.4), "=": () => zoomCentre(1 / 1.4), "-": () => zoomCentre(1.4),
      "0": () => onView(clampView(DEFAULT_VIEW, bounds)),
      "]": () => step(1), "[": () => step(-1),
      Escape: () => onSelect(null),
    };
    const action = actions[event.key];
    if (action) { event.preventDefault(); action(); }
  }

  const describe = selected ? `Selected ${selected.description}, ¹H ${selected.h.toFixed(2)} ppm, ¹⁵N ${selected.n.toFixed(1)} ppm.` : "No peak selected.";
  return <div className="hsqc-spectrum">
    <div className="hsqc-toolbar" role="toolbar" aria-label="Spectrum view">
      <Button variant="secondary" size="icon" title="Zoom in" aria-label="Zoom in" onClick={() => zoomCentre(1 / 1.4)}><Plus/></Button>
      <Button variant="secondary" size="icon" title="Zoom out" aria-label="Zoom out" onClick={() => zoomCentre(1.4)}><Minus/></Button>
      <Button variant="secondary" size="icon" title="Show the full spectrum" aria-label="Show the full spectrum" disabled={!zoomed} onClick={() => onView(clampView(DEFAULT_VIEW, bounds))}><Maximize/></Button>
      <div className="structure-toggles" role="group" aria-label="Spectrum overlays">
        <button type="button" aria-pressed={showLabels} className={showLabels ? "active" : ""} onClick={() => setShowLabels((value) => !value)}>Labels</button>
        <button type="button" aria-pressed={showAllErrors} className={showAllErrors ? "active" : ""} disabled={!hasErrors} title={hasErrors ? undefined : `${predictorLabel} has no published error to draw`} onClick={() => setShowAllErrors((value) => !value)}>Error on every peak</button>
      </div>
      <span className="hsqc-readout" aria-live="off">{hover ? <>¹H {hover.h.toFixed(2)} · ¹⁵N {hover.n.toFixed(1)} ppm{hover.peak ? <b> · {hover.peak.label}{hover.count > 1 ? ` and ${hover.count - 1} more (click again for the next)` : ""}</b> : null}</> : `¹H ${view.h[1].toFixed(2)}–${view.h[0].toFixed(2)} · ¹⁵N ${view.n[0].toFixed(1)}–${view.n[1].toFixed(1)} ppm`}</span>
    </div>
    <div ref={box} className="hsqc-canvas">
      <svg ref={svg} width={width} height={height} tabIndex={0} role="img" aria-roledescription="interactive spectrum" aria-describedby={helpId}
        aria-label={`Predicted ¹H–¹⁵N HSQC spectrum, ${peaks.length} peaks, showing ¹H ${view.h[1].toFixed(2)} to ${view.h[0].toFixed(2)} ppm and ¹⁵N ${view.n[0].toFixed(1)} to ${view.n[1].toFixed(1)} ppm. ${describe}`}
        onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={pointerUp} onPointerLeave={() => setHover(null)} onKeyDown={keyDown}
        className={hover?.peak ? "over-peak" : ""}>
        <defs><clipPath id={clipId}><rect x={MARGIN.left} y={MARGIN.top} width={plotW} height={plotH}/></clipPath></defs>
        <rect className="hsqc-plot" x={MARGIN.left} y={MARGIN.top} width={plotW} height={plotH}/>
        {hTicks.map((tick) => <line key={`gh${tick}`} className="hsqc-grid" x1={x(tick)} x2={x(tick)} y1={MARGIN.top} y2={MARGIN.top + plotH}/>)}
        {nTicks.map((tick) => <line key={`gn${tick}`} className="hsqc-grid" x1={MARGIN.left} x2={MARGIN.left + plotW} y1={y(tick)} y2={y(tick)}/>)}
        <g clipPath={`url(#${clipId})`}>
          {contours.map((path, index) => path && <path key={index} className="hsqc-contour" d={path} style={{ opacity: 0.45 + (0.55 * index) / (LEVELS.length - 1) }}/>)}
          {hasErrors && (showAllErrors ? visible : selected ? [selected] : []).map((peak) => {
            const rx = Math.abs(x(peak.h + rmse.h!) - x(peak.h)), ry = Math.abs(y(peak.n + rmse.n!) - y(peak.n));
            return <g key={`e${peak.id}`} className={`hsqc-error-ellipse ${peak.id === selectedId ? "selected" : ""}`}>
              <ellipse cx={x(peak.h)} cy={y(peak.n)} rx={rx} ry={ry}/>
              {peak.id === selectedId && <ellipse className="outer" cx={x(peak.h)} cy={y(peak.n)} rx={rx * 2} ry={ry * 2}/>}
            </g>;
          })}
          {visible.map((peak) => <PeakMark key={peak.id} peak={peak} cx={x(peak.h)} cy={y(peak.n)} selected={peak.id === selectedId} hovered={hover?.peak?.id === peak.id}/>)}
          {visible.filter((peak) => labelled.has(peak.id)).map((peak) => <text key={`l${peak.id}`} className={`hsqc-label ${peak.id === selectedId ? "selected" : ""} ${peak.kind}`} x={x(peak.h) + 6} y={y(peak.n) - 5}>{peak.label}</text>)}
        </g>
        <rect className="hsqc-frame" x={MARGIN.left} y={MARGIN.top} width={plotW} height={plotH}/>
        {hTicks.map((tick) => <g key={`th${tick}`} className="hsqc-tick"><line x1={x(tick)} x2={x(tick)} y1={MARGIN.top + plotH} y2={MARGIN.top + plotH + 5}/><text x={x(tick)} y={MARGIN.top + plotH + 19} textAnchor="middle">{tick.toFixed(hDecimals)}</text></g>)}
        {nTicks.map((tick) => <g key={`tn${tick}`} className="hsqc-tick"><line x1={MARGIN.left + plotW} x2={MARGIN.left + plotW + 5} y1={y(tick)} y2={y(tick)}/><text x={MARGIN.left + plotW + 8} y={y(tick) + 4}>{tick.toFixed(nDecimals)}</text></g>)}
        <text className="hsqc-axis-title" x={MARGIN.left + plotW / 2} y={height - 6} textAnchor="middle">¹H chemical shift (ppm)</text>
        <text className="hsqc-axis-title" transform={`translate(${width - 8} ${MARGIN.top + plotH / 2}) rotate(90)`} textAnchor="middle">¹⁵N chemical shift (ppm)</text>
      </svg>
    </div>
    <div className="hsqc-legend">
      <span><svg width="14" height="14" aria-hidden="true"><path className="hsqc-mark folded" d="M3 7h8M7 3v8"/></svg>Folded residue</span>
      <span><svg width="14" height="14" aria-hidden="true"><circle className="hsqc-mark disordered" cx="7" cy="7" r="3.5"/></svg>Disordered</span>
      <span><svg width="14" height="14" aria-hidden="true"><path className="hsqc-mark ligand" d="M7 2.5l4.5 4.5L7 11.5 2.5 7z"/></svg>Near a ligand</span>
      <span><svg width="14" height="14" aria-hidden="true"><path className="hsqc-mark sidechain" d="M3 3l8 8M11 3l-8 8"/></svg>Side-chain N–H</span>
      {hasErrors && <span><svg width="18" height="14" aria-hidden="true"><ellipse className="hsqc-legend-ellipse" cx="9" cy="7" rx="7.5" ry="4.5"/></svg>Expected error (1 RMSE)</span>}
      {hiddenLabels > 0 && <span className="hsqc-hidden-labels">{hiddenLabels} labels hidden where peaks crowd; zoom in to see them.</span>}
    </div>
    <p id={helpId} className="hsqc-help">Scroll to zoom, drag to pan, click a peak to select it; where peaks overlap, click again to step through them. With the spectrum focused: arrow keys pan, + and − zoom, 0 shows the full spectrum, [ and ] step through peaks, Esc clears the selection.</p>
  </div>;
}

function PeakMark({ peak, cx, cy, selected, hovered }: { peak: Peak; cx: number; cy: number; selected: boolean; hovered: boolean }) {
  const kind = peak.kind === "sidechain" ? "sidechain" : peak.ligandAdjacent ? "ligand" : peak.disordered ? "disordered" : "folded";
  return <g className={`hsqc-peak ${selected ? "selected" : ""} ${hovered ? "hovered" : ""}`}>
    {selected && <circle className="hsqc-selected-ring" cx={cx} cy={cy} r={9}/>}
    {kind === "folded" && <path className="hsqc-mark folded" d={`M${cx - 3.5} ${cy}h7M${cx} ${cy - 3.5}v7`}/>}
    {kind === "disordered" && <circle className="hsqc-mark disordered" cx={cx} cy={cy} r={3}/>}
    {kind === "ligand" && <path className="hsqc-mark ligand" d={`M${cx} ${cy - 4}l4 4l-4 4l-4-4z`}/>}
    {kind === "sidechain" && <path className="hsqc-mark sidechain" d={`M${cx - 3} ${cy - 3}l6 6M${cx + 3} ${cy - 3}l-6 6`}/>}
  </g>;
}
