"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties, PointerEvent as ReactPointerEvent, ReactNode, WheelEvent as ReactWheelEvent } from "react";
import { Copy, Maximize2, Minus, Plus, ScanSearch } from "lucide-react";
import type { CutSite, FeatureCategory, MapFeature, SeqRange, StackedLabel, Viewport } from "@/lib/vector-geometry";
import {
  CATEGORY_STYLE, angleToBase, angularSpan, arcBand, assignTracks, baseAngle, clipRange, dragRange, featureArrow,
  featureCategory, featureColor, fitLabel, formatRange, gcPercent, inkOn, layoutCircularLabels, mapTextScale, niceTickStep, oligoTm, polar,
  rangeLength, rangeSequence, reverseComplement, complement, stackEnzymeLabels, translate, zoomViewport, panViewport,
} from "@/lib/vector-geometry";

/** The construct as every view sees it. */
export type ViewVector = { name: string; sequence: string; circular: boolean; features: MapFeature[]; cuts: CutSite[] };

/**
 * The one selection every view shares. `source` names the view that set it,
 * so the others know to scroll it into sight while the source stays put.
 */
export type VectorSelection = { range: SeqRange; featureId?: string; enzyme?: string; source?: "circular" | "linear" | "sequence" | "list" } | null;

type ViewProps = {
  vector: ViewVector;
  selection: VectorSelection;
  onSelect: (selection: VectorSelection) => void;
  showOrfs: boolean;
};

/** Legibility floor for map text on screen, and the smallest circular-map font in user units (the length). */
const MIN_TEXT_PX = 10.6;
const CIRCULAR_SMALLEST_TEXT = 11.5;

function visibleFeatures(vector: ViewVector, showOrfs: boolean) {
  return vector.features.filter((feature) => showOrfs || featureCategory(feature) !== "orf");
}

function featurePriority(feature: MapFeature, length: number) {
  const category = featureCategory(feature);
  const base = category === "orf" ? 0 : category === "misc" ? 1 : 3;
  return base + Math.min(0.99, rangeLength(feature, length) / Math.max(1, length));
}

// ---------------------------------------------------------------------------
// Circular map
// ---------------------------------------------------------------------------

export function CircularMap({ vector, selection, onSelect, showOrfs }: ViewProps) {
  const length = Math.max(1, vector.sequence.length);
  const width = 860, height = 500, cx = width / 2, cy = height / 2, radius = 150;
  const svgRef = useRef<SVGSVGElement>(null);
  const [boxRef, box] = useBox<HTMLDivElement>();
  // The drawing scales with its box; text grows in user units so it stays legible on small windows.
  const textScale = mapTextScale(box, { width, height }, CIRCULAR_SMALLEST_TEXT, MIN_TEXT_PX);
  const [drag, setDrag] = useState<number | null>(null);
  const features = useMemo(() => visibleFeatures(vector, showOrfs), [vector, showOrfs]);
  const tracks = useMemo(() => assignTracks(features, length, vector.circular), [features, length, vector.circular]);
  const trackRadius = (track: number) => radius - 16 - Math.min(track, 5) * 15;

  const layout = useMemo(() => {
    const requests = [
      ...features.map((feature) => {
        const span = angularSpan(feature.start, feature.end, length);
        return { key: `f:${feature.id}`, angle: baseAngle(feature.start, length) + span / 2, priority: featurePriority(feature, length), width: feature.name.length * 6 };
      }),
      ...vector.cuts.map((site) => ({ key: `e:${site.enzyme}:${site.cut}`, angle: baseAngle(site.cut, length), priority: site.cutCount === 1 ? 2.5 : 1.5, width: site.enzyme.length * 6 })),
    ];
    return layoutCircularLabels(requests, { cx, cy, radius: radius + 50, top: 12 * textScale, bottom: height - 8, lineHeight: 14 * textScale });
  }, [features, vector.cuts, length, cx, cy, textScale]);
  // Room between a label's anchor and the edge of the drawing, in characters of the label font.
  const labelText = (text: string, x: number, left: boolean, fontUnits: number) => fitLabel(text, (left ? x : width - x) - 4, fontUnits * 0.62 * textScale);
  const labels = useMemo(() => new Map(layout.placed.map((label) => [label.key, label])), [layout]);

  function baseAt(event: ReactPointerEvent) {
    const svg = svgRef.current;
    if (!svg) return 0;
    const point = svg.createSVGPoint();
    point.x = event.clientX; point.y = event.clientY;
    const local = point.matrixTransform(svg.getScreenCTM()?.inverse());
    return angleToBase(local.x, local.y, cx, cy, length);
  }

  const range = selection?.range;
  const selectionSpan = range ? angularSpan(range.start, range.end, length) : 0;

  return <div className={`vmap-circular${layout.hidden.length ? " has-note" : ""}`} ref={boxRef}>
    <svg ref={svgRef} viewBox={`0 0 ${width} ${height}`} role="img" aria-label={`Circular map of ${vector.name}`} style={{ "--vmap-text": textScale } as CSSProperties}>
      <circle cx={cx} cy={cy} r={radius} className="vmap-backbone" />
      <circle cx={cx} cy={cy} r={radius - 4} className="vmap-backbone-inner" />
      {/* Drag anywhere on the ring to select a range; it may cross the origin. */}
      <path
        d={arcBand(cx, cy, radius - 110, radius + 16, -90, 359.99)}
        className="vmap-hit"
        onPointerDown={(event) => { (event.target as Element).setPointerCapture(event.pointerId); const base = baseAt(event); setDrag(base); onSelect({ range: { start: base, end: base }, source: "circular" }); }}
        onPointerMove={(event) => { if (drag === null) return; onSelect({ range: dragRange(drag, baseAt(event), length, vector.circular), source: "circular" }); }}
        onPointerUp={() => setDrag(null)}
      />
      {range && selectionSpan > 0 && <path d={arcBand(cx, cy, radius - 108, radius + 14, baseAngle(range.start, length), selectionSpan)} className="vmap-selection" />}
      {range && <line {...lineAt(cx, cy, radius - 108, radius + 14, baseAngle(range.start, length))} className="vmap-caret" />}
      {range && selectionSpan > 0 && <line {...lineAt(cx, cy, radius - 108, radius + 14, baseAngle(range.end, length))} className="vmap-caret" />}

      {/* Quarter ticks only: numbers here collided with the name in the centre and with labels outside. */}
      {[0, 0.25, 0.5, 0.75].map((fraction) => {
        const angle = fraction * 360 - 90, inner = polar(cx, cy, radius + 3, angle), outer = polar(cx, cy, radius - 6, angle);
        return <g key={fraction} className="vmap-ruler"><line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} /></g>;
      })}

      {features.map((feature) => {
        const track = tracks.get(feature) ?? 0;
        const r = trackRadius(track);
        const span = angularSpan(feature.start, feature.end, length);
        const color = featureColor(feature);
        const selected = selection?.featureId === feature.id;
        const label = labels.get(`f:${feature.id}`);
        const mid = baseAngle(feature.start, length) + span / 2;
        const anchor = polar(cx, cy, r + 6, mid);
        return <g key={feature.id} className={`vmap-feature${selected ? " selected" : ""}${featureCategory(feature) === "orf" ? " orf" : ""}`} onClick={() => onSelect({ range: { start: feature.start, end: feature.end }, featureId: feature.id, source: "circular" })}>
          <title>{`${feature.name} · ${CATEGORY_STYLE[featureCategory(feature)].label} · ${formatRange(feature, length)} (${rangeLength(feature, length)} bp)`}</title>
          <path d={featureArrow(cx, cy, r, 11, baseAngle(feature.start, length), span, feature.strand)} fill={color} className="vmap-arrow" />
          {label && <>
            <polyline points={`${anchor.x},${anchor.y} ${label.x + (label.left ? 4 : -4)},${label.y}`} className="vmap-leader" />
            <text x={label.x} y={label.y + 3.5} textAnchor={label.left ? "end" : "start"} className="vmap-label">{labelText(feature.name, label.x, label.left, 13)}</text>
          </>}
        </g>;
      })}

      {vector.cuts.map((site) => {
        const angle = baseAngle(site.cut, length);
        const inner = polar(cx, cy, radius - 4, angle), outer = polar(cx, cy, radius + 12, angle);
        const label = labels.get(`e:${site.enzyme}:${site.cut}`);
        const selected = selection?.enzyme === site.enzyme;
        const position = (site.cut + 1).toLocaleString();
        // Drop the position before shortening the enzyme name when the label runs out of room.
        const withPosition = !!label && labelText(`${site.enzyme} (${position})`, label.x, label.left, 12).endsWith(")");
        return <g key={`${site.enzyme}:${site.cut}`} className={`vmap-enzyme${selected ? " selected" : ""}`} onClick={() => onSelect({ range: { start: site.cut, end: site.cut }, enzyme: site.enzyme, source: "circular" })}>
          <title>{`${site.enzyme} cuts after ${site.cut.toLocaleString()} · ${site.recognitionSite} · ${site.cutCount === 1 ? "unique cutter" : `${site.cutCount} sites`}`}</title>
          <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} className="vmap-cut" />
          {label && <>
            <polyline points={`${outer.x},${outer.y} ${label.x + (label.left ? 4 : -4)},${label.y}`} className="vmap-leader enzyme" />
            <text x={label.x} y={label.y + 3.5} textAnchor={label.left ? "end" : "start"} className="vmap-enzyme-label">
              {withPosition ? <>{site.enzyme}<tspan className="vmap-position"> ({position})</tspan></> : labelText(site.enzyme, label.x, label.left, 12)}
            </text>
          </>}
        </g>;
      })}

      <text x={cx} y={cy - 8 * textScale} textAnchor="middle" className="vmap-name">{fitLabel(vector.name, 2 * (radius - 62), 18 * 0.62 * textScale)}</text>
      <text x={cx} y={cy + 13 * textScale} textAnchor="middle" className="vmap-length">{length.toLocaleString()} bp</text>
      {range && rangeLength(range, length) > 0 && <text x={cx} y={cy + 32 * textScale} textAnchor="middle" className="vmap-length">{formatRange(range, length)} · {rangeLength(range, length).toLocaleString()} bp</text>}
    </svg>
    {layout.hidden.length > 0 && <p className="vmap-note">{layout.hidden.length} label{layout.hidden.length === 1 ? "" : "s"} hidden to avoid overlap. Zoom the linear map or hover a feature to read it.</p>}
  </div>;
}

function lineAt(cx: number, cy: number, inner: number, outer: number, angle: number) {
  const a = polar(cx, cy, inner, angle), b = polar(cx, cy, outer, angle);
  return { x1: a.x, y1: a.y, x2: b.x, y2: b.y };
}

/** A small read-only circular map, used to preview cloning products. */
export function MiniMap({ vector, highlight }: { vector: ViewVector; highlight?: SeqRange | null }) {
  const length = Math.max(1, vector.sequence.length);
  const size = 220, c = size / 2, radius = 78;
  const tracks = assignTracks(vector.features, length, vector.circular);
  return <svg viewBox={`0 0 ${size} ${size}`} className="vmap-mini" role="img" aria-label={`Preview map of ${vector.name}`}>
    <circle cx={c} cy={c} r={radius} className="vmap-backbone" />
    {highlight && rangeLength(highlight, length) > 0 && <path d={arcBand(c, c, radius - 40, radius + 12, baseAngle(highlight.start, length), angularSpan(highlight.start, highlight.end, length))} className="vmap-selection" />}
    {vector.features.filter((feature) => featureCategory(feature) !== "orf").map((feature) => {
      const r = radius - 9 - Math.min(tracks.get(feature) ?? 0, 3) * 9;
      return <path key={feature.id} d={featureArrow(c, c, r, 7, baseAngle(feature.start, length), angularSpan(feature.start, feature.end, length), feature.strand)} fill={featureColor(feature)} className="vmap-arrow"><title>{feature.name}</title></path>;
    })}
    <text x={c} y={c - 2} textAnchor="middle" className="vmap-mini-name">{vector.name}</text>
    <text x={c} y={c + 13} textAnchor="middle" className="vmap-length">{length.toLocaleString()} bp</text>
  </svg>;
}

// ---------------------------------------------------------------------------
// Linear map
// ---------------------------------------------------------------------------

function useBox<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [box, setBox] = useState({ width: 0, height: 0 });
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => { const { width, height } = entries[0].contentRect; setBox({ width, height }); });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, box] as const;
}

function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null);
  const [width, setWidth] = useState(800);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const observer = new ResizeObserver((entries) => setWidth(Math.max(320, Math.floor(entries[0].contentRect.width))));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  return [ref, width] as const;
}

export function LinearMap({ vector, selection, onSelect, showOrfs, viewport, onViewport, compact = false }: ViewProps & { viewport: Viewport; onViewport: (view: Viewport) => void; compact?: boolean }) {
  const length = Math.max(1, vector.sequence.length);
  const [ref, width] = useWidth<HTMLDivElement>();
  const svgRef = useRef<SVGSVGElement>(null);
  const [drag, setDrag] = useState<{ anchor: number; pan: boolean; x: number; view: Viewport } | null>(null);
  const pad = 14, inner = width - pad * 2;
  const span = Math.max(1, viewport.to - viewport.from);
  const scale = inner / span;
  const xOf = (base: number) => pad + (base - viewport.from) * scale;

  const features = useMemo(() => visibleFeatures(vector, showOrfs), [vector, showOrfs]);
  // Pieces of each feature inside the view; origin-spanning features split in two.
  const pieces = useMemo(() => features.flatMap((feature) => clipRange(feature, Math.floor(viewport.from), Math.ceil(viewport.to), length).map((piece, index) => ({ feature, piece, key: `${feature.id}:${index}` }))), [features, viewport, length]);
  const tracks = useMemo(() => assignTracks(pieces.map((item) => ({ ...item.piece, item })), length, false), [pieces, length]);
  const trackOf = new Map([...tracks].map(([entry, track]) => [entry.item.key, track]));
  const trackCount = Math.min(compact ? 2 : 6, Math.max(1, ...[...tracks.values()].map((track) => track + 1)));

  const cuts = vector.cuts.filter((site) => site.cut >= viewport.from && site.cut <= viewport.to);
  // Enzyme labels are stacked into rows so no label overlaps another label or another site's cut line.
  const sortedCuts = [...cuts].sort((a, b) => a.cut - b.cut);
  const stacked = stackEnzymeLabels(sortedCuts.map((site) => ({ x: xOf(site.cut), width: site.enzyme.length * 6.6 + 2 })), compact ? 2 : 4, { min: 0, max: width });
  const enzymeRows = sortedCuts.map((site, index) => ({ site, row: stacked[index].row, anchor: stacked[index].anchor, x: xOf(site.cut) }));
  const enzymeBand = (Math.max(0, ...enzymeRows.map((entry) => entry.row + 1))) * 12 + (cuts.length ? 6 : 0);
  const rulerY = enzymeBand + 14;
  const trackTop = rulerY + 17;
  const height = trackTop + trackCount * 17 + 8;
  const step = niceTickStep(span, Math.max(4, Math.round(inner / 90)));
  const ticks: number[] = [];
  for (let tick = Math.ceil(viewport.from / step) * step; tick <= viewport.to; tick += step) ticks.push(tick);

  function baseAt(clientX: number) {
    const box = svgRef.current?.getBoundingClientRect();
    if (!box) return 0;
    return Math.max(0, Math.min(length - 1, Math.floor(viewport.from + (clientX - box.left - pad) / scale)));
  }
  function wheel(event: ReactWheelEvent) {
    if (event.shiftKey || Math.abs(event.deltaX) > Math.abs(event.deltaY)) {
      onViewport(panViewport(viewport, ((event.deltaX || event.deltaY) / inner) * span, length));
    } else {
      onViewport(zoomViewport(viewport, event.deltaY > 0 ? 1.25 : 0.8, baseAt(event.clientX), length));
    }
  }
  const range = selection?.range;
  const zoomed = span < length - 1;

  return <div className={`vmap-linear${compact ? " compact" : ""}`} ref={ref}>
    <div className="vmap-linear-tools">
      <span>{Math.round(viewport.from + 1).toLocaleString()}–{Math.round(viewport.to).toLocaleString()} of {length.toLocaleString()} bp</span>
      <button type="button" title="Zoom out (−)" onClick={() => onViewport(zoomViewport(viewport, 1.6, (viewport.from + viewport.to) / 2, length))}><Minus /></button>
      <button type="button" title="Zoom in (+)" onClick={() => onViewport(zoomViewport(viewport, 0.625, (viewport.from + viewport.to) / 2, length))}><Plus /></button>
      <button type="button" title="Zoom to selection (Z)" disabled={!range || rangeLength(range, length) === 0} onClick={() => range && onViewport(fitRange(range, length))}><ScanSearch /></button>
      <button type="button" title="Show whole sequence (0)" disabled={!zoomed} onClick={() => onViewport({ from: 0, to: length })}><Maximize2 /></button>
    </div>
    <svg
      ref={svgRef}
      width={width}
      height={height}
      onWheel={wheel}
      onPointerDown={(event) => {
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
        const pan = event.altKey || event.button === 1;
        const anchor = baseAt(event.clientX);
        setDrag({ anchor, pan, x: event.clientX, view: viewport });
        if (!pan) onSelect({ range: { start: anchor, end: anchor }, source: "linear" });
      }}
      onPointerMove={(event) => {
        if (!drag) return;
        if (drag.pan) onViewport(panViewport(drag.view, -(event.clientX - drag.x) / scale, length));
        else onSelect({ range: dragRange(drag.anchor, baseAt(event.clientX), length, false), source: "linear" });
      }}
      onPointerUp={() => setDrag(null)}
      role="img"
      aria-label={`Linear map of ${vector.name}`}
    >
      {range && clipRange(range, viewport.from, viewport.to, length).map((piece, index) => <rect key={index} x={xOf(piece.start)} y={rulerY - 8} width={Math.max(1.5, (piece.end - piece.start) * scale)} height={height - rulerY + 4} className="vmap-selection" />)}
      {range && rangeLength(range, length) === 0 && <line x1={xOf(range.start)} x2={xOf(range.start)} y1={rulerY - 10} y2={height} className="vmap-caret" />}
      <line x1={xOf(0)} x2={xOf(length)} y1={rulerY} y2={rulerY} className="vmap-linear-backbone" />
      {ticks.map((tick) => <g key={tick} className="vmap-ruler">
        <line x1={xOf(tick)} x2={xOf(tick)} y1={rulerY} y2={rulerY + 5} />
        <text x={xOf(tick)} y={rulerY + 13} textAnchor="middle">{tick === 0 ? 1 : tick.toLocaleString()}</text>
      </g>)}
      {enzymeRows.map(({ site, row, anchor, x }) => <g key={`${site.enzyme}:${site.cut}`} className={`vmap-enzyme${selection?.enzyme === site.enzyme ? " selected" : ""}`} onPointerDown={(event) => { event.stopPropagation(); onSelect({ range: { start: site.cut, end: site.cut }, enzyme: site.enzyme, source: "linear" }); }}>
        <title>{`${site.enzyme} cuts after ${site.cut.toLocaleString()} · ${site.recognitionSite}`}</title>
        <line x1={x} x2={x} y1={row < 0 ? rulerY - 6 : enzymeBand - row * 12 - 2} y2={rulerY + 3} className="vmap-cut thin" />
        {row >= 0 && <text x={x + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0)} y={enzymeBand - row * 12 - 4} textAnchor={anchor} className="vmap-enzyme-label">{site.enzyme}</text>}
      </g>)}
      {pieces.map(({ feature, piece, key }) => {
        const track = Math.min(trackCount - 1, trackOf.get(key) ?? 0);
        const x = xOf(piece.start), w = Math.max(2, (piece.end - piece.start) * scale);
        const y = trackTop + track * 17;
        const color = featureColor(feature);
        const headLeft = feature.strand < 0 && piece.start === feature.start, headRight = feature.strand > 0 && piece.end === feature.end;
        const head = Math.min(7, w / 2);
        const path = `M ${x + (headLeft ? head : 0)} ${y} L ${x + w - (headRight ? head : 0)} ${y} L ${x + w} ${y + 6.5} L ${x + w - (headRight ? head : 0)} ${y + 13} L ${x + (headLeft ? head : 0)} ${y + 13} L ${x} ${y + 6.5} Z`;
        const selected = selection?.featureId === feature.id;
        const fits = feature.name.length * 6 + 10 < w;
        return <g key={key} className={`vmap-feature${selected ? " selected" : ""}`} onPointerDown={(event) => { event.stopPropagation(); onSelect({ range: { start: feature.start, end: feature.end }, featureId: feature.id, source: "linear" }); }}>
          <title>{`${feature.name} · ${formatRange(feature, length)} (${rangeLength(feature, length)} bp)`}</title>
          <path d={path} fill={color} className="vmap-arrow" />
          {fits && <text x={x + w / 2} y={y + 10} textAnchor="middle" fill={inkOn(color)} className="vmap-bar-label">{feature.name}</text>}
        </g>;
      })}
    </svg>
    {zoomed && <div className="vmap-overview" aria-hidden><i style={{ left: `${(viewport.from / length) * 100}%`, width: `${(span / length) * 100}%` }} /></div>}
  </div>;
}

/** A viewport framing a range with a little context either side. */
export function fitRange(range: SeqRange, length: number): Viewport {
  const size = rangeLength(range, length);
  if (range.end < range.start) return { from: 0, to: length };
  const margin = Math.max(10, size * 0.15);
  const from = Math.max(0, range.start - margin), to = Math.min(length, range.end + margin);
  return to - from < 60 ? zoomViewport({ from, to }, 60 / Math.max(1, to - from), (from + to) / 2, length) : { from, to };
}

// ---------------------------------------------------------------------------
// Sequence view
// ---------------------------------------------------------------------------

const CHAR = 8.6;
const GUTTER = 66;

type RowLayout = { start: number; end: number; top: number; height: number; cuts: CutSite[]; labels: StackedLabel[]; labelRows: number; bars: { feature: MapFeature; piece: SeqRange; track: number }[]; tracks: number };

/**
 * Double-stranded sequence with ruler, enzyme sites, feature bars and the
 * translation of coding features. Rows are virtualised so a 13 kb plasmid
 * scrolls as smoothly as a 3 kb one.
 */
export function SequenceView({ vector, selection, onSelect, showOrfs }: ViewProps) {
  const length = vector.sequence.length;
  const [ref, width] = useWidth<HTMLDivElement>();
  const scroller = useRef<HTMLDivElement>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewHeight, setViewHeight] = useState(600);
  const [anchor, setAnchor] = useState<number | null>(null);
  const perRow = Math.max(30, Math.floor((width - GUTTER - 24) / CHAR / 10) * 10);
  const features = useMemo(() => visibleFeatures(vector, showOrfs), [vector, showOrfs]);
  const complementStrand = useMemo(() => complement(vector.sequence), [vector.sequence]);

  const rows = useMemo(() => {
    const out: RowLayout[] = [];
    let top = 6;
    for (let start = 0; start < length; start += perRow) {
      const end = Math.min(length, start + perRow);
      const cuts = vector.cuts.filter((site) => site.cut >= start && site.cut < end).sort((a, b) => a.cut - b.cut);
      // Nearby sites (SmaI and XmaI share CCCGGG) stack their labels instead of overprinting.
      const labels = stackEnzymeLabels(cuts.map((site) => ({ x: GUTTER + (site.cut - start) * CHAR, width: site.enzyme.length * 6.6 + 4 })), 3, { min: 0, max: GUTTER + perRow * CHAR + 20 });
      const labelRows = cuts.length ? Math.max(1, ...labels.map((label) => label.row + 1)) : 0;
      const pieces = features.flatMap((feature) => clipRange(feature, start, end, length).map((piece) => ({ feature, piece })));
      const assigned = assignTracks(pieces.map((item) => ({ ...item.piece, item })), length, false);
      const bars = [...assigned].map(([entry, track]) => ({ ...entry.item, track }));
      const tracks = bars.length ? Math.max(...bars.map((bar) => bar.track)) + 1 : 0;
      const height = (cuts.length ? 2 + labelRows * 12 : 0) + 36 + tracks * 17 + 12;
      out.push({ start, end, top, height, cuts, labels, labelRows, bars, tracks });
      top += height;
    }
    return { rows: out, total: top + 6 };
  }, [length, perRow, vector.cuts, features]);

  useEffect(() => {
    const element = scroller.current;
    if (!element) return;
    const observer = new ResizeObserver(() => setViewHeight(element.clientHeight));
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  // Bring a selection made in another view into sight.
  const range = selection?.range;
  useEffect(() => {
    const element = scroller.current;
    if (!element || !range || selection?.source === "sequence") return;
    const row = rows.rows.find((entry) => range.start >= entry.start && range.start < entry.end) ?? rows.rows.find((entry) => range.start === entry.end);
    if (!row) return;
    if (row.top < element.scrollTop || row.top + row.height > element.scrollTop + element.clientHeight) element.scrollTo({ top: Math.max(0, row.top - 40), behavior: "smooth" });
  }, [range, selection?.source, rows]);

  function locate(event: ReactPointerEvent) {
    const box = scroller.current?.getBoundingClientRect();
    if (!box || !scroller.current) return 0;
    const y = event.clientY - box.top + scroller.current.scrollTop;
    const row = rows.rows.find((entry) => y >= entry.top && y < entry.top + entry.height) ?? rows.rows[rows.rows.length - 1];
    if (!row) return 0;
    const column = Math.floor((event.clientX - box.left - GUTTER) / CHAR);
    return Math.max(row.start, Math.min(row.end - 1, row.start + column));
  }

  if (!length) return <div className="vseq-empty">No sequence yet. Paste DNA, import a file, or load a backbone.</div>;

  const visible = rows.rows.filter((row) => row.top + row.height >= scrollTop - 200 && row.top <= scrollTop + viewHeight + 200);

  return <div className="vseq" ref={ref}>
    <div
      className="vseq-scroll"
      ref={scroller}
      onScroll={(event) => setScrollTop(event.currentTarget.scrollTop)}
      onPointerDown={(event) => {
        if (event.button !== 0) return;
        (event.currentTarget as Element).setPointerCapture(event.pointerId);
        const base = locate(event);
        if (event.shiftKey && range) { onSelect({ range: dragRange(range.start, base, length, false), source: "sequence" }); return; }
        setAnchor(base);
        onSelect({ range: { start: base, end: base }, source: "sequence" });
      }}
      onPointerMove={(event) => { if (anchor !== null) onSelect({ range: dragRange(anchor, locate(event), length, false), source: "sequence" }); }}
      onPointerUp={() => setAnchor(null)}
    >
      <svg width={GUTTER + perRow * CHAR + 20} height={rows.total} className="vseq-svg">
        {visible.map((row) => <SequenceRow key={row.start} row={row} vector={vector} complementStrand={complementStrand} selection={selection} onSelect={onSelect} />)}
      </svg>
    </div>
  </div>;
}

function SequenceRow({ row, vector, complementStrand, selection, onSelect }: { row: RowLayout; vector: ViewVector; complementStrand: string; selection: VectorSelection; onSelect: (selection: VectorSelection) => void }) {
  const length = vector.sequence.length;
  const count = row.end - row.start;
  const xOf = (base: number) => GUTTER + (base - row.start) * CHAR;
  const enzymeY = row.top + (row.cuts.length ? row.labelRows * 12 - 1 : 0);
  const forwardY = enzymeY + 14, reverseY = forwardY + 15;
  const barsTop = reverseY + 8;
  const range = selection?.range;
  const highlight = range ? clipRange(range, row.start, row.end, length) : [];
  return <g>
    <text x={GUTTER - 10} y={forwardY} textAnchor="end" className="vseq-number">{(row.start + 1).toLocaleString()}</text>
    {highlight.map((piece, index) => <rect key={index} x={xOf(piece.start)} y={forwardY - 11} width={(piece.end - piece.start) * CHAR} height={reverseY - forwardY + 15} className="vseq-selection" />)}
    {range && rangeLength(range, length) === 0 && range.start >= row.start && range.start < row.end && <line x1={xOf(range.start)} x2={xOf(range.start)} y1={forwardY - 12} y2={reverseY + 4} className="vmap-caret" />}
    {row.cuts.map((site, index) => {
      const { row: level, anchor } = row.labels[index];
      return <g key={`${site.enzyme}:${site.cut}`} className={`vmap-enzyme${selection?.enzyme === site.enzyme ? " selected" : ""}`} onPointerDown={(event) => { event.stopPropagation(); onSelect({ range: { start: site.cut, end: site.cut }, enzyme: site.enzyme, source: "sequence" }); }}>
        <title>{`${site.enzyme} cuts after ${site.cut.toLocaleString()} · ${site.recognitionSite}`}</title>
        <line x1={xOf(site.cut)} x2={xOf(site.cut)} y1={enzymeY + 1 - Math.max(0, level) * 12} y2={forwardY - 10} className="vmap-cut thin" />
        {level >= 0 && <text x={xOf(site.cut) + (anchor === "start" ? 2 : anchor === "end" ? -2 : 0)} y={enzymeY - 1 - level * 12} textAnchor={anchor} className="vmap-enzyme-label">{site.enzyme}</text>}
      </g>;
    })}
    <text x={GUTTER} y={forwardY} textLength={count * CHAR} lengthAdjust="spacing" className="vseq-bases">{vector.sequence.slice(row.start, row.end)}</text>
    <text x={GUTTER} y={reverseY} textLength={count * CHAR} lengthAdjust="spacing" className="vseq-bases reverse">{complementStrand.slice(row.start, row.end)}</text>
    {Array.from({ length: Math.floor((count - 1) / 10) }, (_, index) => {
      const base = row.start + (index + 1) * 10;
      return <line key={base} x1={xOf(base)} x2={xOf(base)} y1={reverseY + 3} y2={reverseY + 6} className="vseq-tick" />;
    })}
    {row.bars.map(({ feature, piece, track }) => {
      const y = barsTop + track * 17;
      const color = featureColor(feature);
      const ink = inkOn(color);
      const category: FeatureCategory = featureCategory(feature);
      const coding = ["cds", "orf", "marker", "tag"].includes(category) && feature.end > feature.start;
      const residues = coding ? codingResidues(vector.sequence, feature, piece) : [];
      const selected = selection?.featureId === feature.id;
      return <g key={`${feature.id}:${piece.start}`} className={`vmap-feature${selected ? " selected" : ""}`} onPointerDown={(event) => { event.stopPropagation(); onSelect({ range: { start: feature.start, end: feature.end }, featureId: feature.id, source: "sequence" }); }}>
        <title>{`${feature.name} · ${formatRange(feature, length)}`}</title>
        <rect x={xOf(piece.start)} y={y} width={(piece.end - piece.start) * CHAR} height={14} rx={3} fill={color} className="vmap-arrow" />
        {residues.length > 0
          ? residues.map((residue) => <text key={residue.at} x={xOf(residue.at)} y={y + 10.5} textAnchor="middle" fill={ink} className="vseq-residue">{residue.aa}</text>)
          : <text x={xOf(piece.start) + 4} y={y + 10.5} fill={ink} className="vmap-bar-label">{piece.start === feature.start || piece.start === row.start ? feature.name : ""}</text>}
        {residues.length > 0 && piece.start === feature.start && <text x={xOf(piece.start) - 3} y={y + 10.5} textAnchor="end" className="vseq-feature-name">{feature.name}</text>}
      </g>;
    })}
  </g>;
}

/** One-letter residues for the codons of a coding feature that fall in a row, centred on each codon. */
function codingResidues(sequence: string, feature: MapFeature, piece: SeqRange): { at: number; aa: string }[] {
  const out: { at: number; aa: string }[] = [];
  const forward = feature.strand >= 0;
  for (let offset = 0; offset + 3 <= feature.end - feature.start; offset += 3) {
    const codonStart = forward ? feature.start + offset : feature.end - offset - 3;
    const middle = codonStart + 1.5;
    if (middle < piece.start || middle >= piece.end) continue;
    const codon = sequence.slice(codonStart, codonStart + 3);
    out.push({ at: middle, aa: translate(forward ? codon : reverseComplement(codon)) });
  }
  return out;
}

// ---------------------------------------------------------------------------
// Selection bar
// ---------------------------------------------------------------------------

/** Length, coordinates, GC and Tm for whatever is selected, in every view. */
export function SelectionBar({ vector, selection, onFind, children }: { vector: ViewVector; selection: VectorSelection; onFind: (motif: string) => string; children?: ReactNode }) {
  const length = vector.sequence.length;
  const [motif, setMotif] = useState("");
  const [findNote, setFindNote] = useState("");
  const range = selection?.range;
  const size = range ? rangeLength(range, length) : 0;
  const bases = range && size ? rangeSequence(vector.sequence, range) : "";
  const tm = bases ? oligoTm(bases) : null;
  const feature = selection?.featureId ? vector.features.find((item) => item.id === selection.featureId) : undefined;
  return <div className="vsel-bar" role="status" aria-live="polite">
    <span className="vsel-summary">
      {!range && "Click or drag on any view to select"}
      {range && size === 0 && <>Caret after base <b>{range.start.toLocaleString()}</b>{selection?.enzyme && <> · <b>{selection.enzyme}</b> cut</>}</>}
      {range && size > 0 && <>
        <b>{formatRange(range, length)}</b>
        <span>{size.toLocaleString()} bp</span>
        <span>GC {gcPercent(bases).toFixed(1)}%</span>
        <span title="Nearest-neighbour Tm at 50 mM Na⁺, 25 nM each strand (8–60 bp)">{tm === null ? (size > 60 ? "Tm: select ≤ 60 bp" : "Tm —") : `Tm ${tm.toFixed(1)} °C`}</span>
        {feature && <span className="vsel-feature"><i style={{ background: featureColor(feature) }} />{feature.name}</span>}
        <button type="button" title="Copy selected sequence (Ctrl+C)" onClick={() => void navigator.clipboard?.writeText(bases)}><Copy /></button>
      </>}
    </span>
    {children}
    <form className="vsel-find" onSubmit={(event) => { event.preventDefault(); setFindNote(onFind(motif)); }}>
      <input id="vector-find" value={motif} placeholder="Find DNA (Ctrl+F)" onChange={(event) => { setMotif(event.target.value.toUpperCase().replace(/[^ACGTN]/g, "")); setFindNote(""); }} />
      {findNote && <small>{findNote}</small>}
    </form>
  </div>;
}

/** The colour key for the categories present in a construct. */
export function FeatureLegend({ features }: { features: MapFeature[] }) {
  const present = [...new Set(features.map((feature) => featureCategory(feature)))];
  return <div className="vmap-legend">{present.map((category) => <span key={category}><i style={{ background: CATEGORY_STYLE[category].color }} />{CATEGORY_STYLE[category].label}</span>)}</div>;
}
