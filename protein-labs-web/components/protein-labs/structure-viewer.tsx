"use client";

import { CSSProperties, PointerEvent, WheelEvent, useEffect, useId, useMemo, useRef, useState } from "react";
import { CircleDot, Minus, Orbit, Plus, RotateCcw, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JsonObject } from "@/lib/protein-labs-api";
import { findStructurePalette, STRUCTURE_PALETTES, structurePaletteForKey, type StructurePaletteId } from "@/lib/structure-palettes";
import { MolstarViewer, type MolstarViewerProps, type ViewerRegion } from "@/components/protein-labs/molstar-viewer";
import type { ConservationSources } from "@/lib/conservation-coloring";

type AtomPoint = { x: number; y: number; z: number; chain: string; plddt: number | null };
type Projected = AtomPoint & { px: number; py: number; depth: number; scale: number };
type Representation = "ribbon" | "surface" | "atoms";
type ColorMode = "theme" | "confidence";
type StructureViewerProps = { geometry: JsonObject | null; compact?: boolean; autoRotate?: boolean; hologram?: boolean; label?: string; paletteKey?: string; palette?: StructurePaletteId; /** Fixes the colouring, ignoring the user's saved choice. */ colorMode?: ColorMode; /** Wraps the ribbon in a translucent molecular surface. */ envelope?: boolean; /** Residues to highlight and focus in the full (Mol*) viewer. */ region?: ViewerRegion | null; /** Side panel to hold the full viewer's controls. */ controlsHost?: HTMLElement | null; /** The model carries per-residue pLDDT. */ confidence?: boolean; /** Conservation sources to colour the full viewer by. */ conservation?: ConservationSources } & Pick<MolstarViewerProps, "ligandAtom" | "hoveredLigandAtom" | "onLigandPick" | "onLigandHover">;

export function StructureViewer(props: StructureViewerProps) {
  const structureText = typeof props.geometry?.structureText === "string" ? props.geometry.structureText : "";
  // Full views of real coordinates use Mol*; compact cards and Cα-only traces keep the lightweight SVG trace.
  if (!props.compact && structureText) return <MolstarViewer structureText={structureText} label={props.label ?? "Structure"} paletteKey={props.paletteKey} palette={props.palette} autoRotate={props.autoRotate} confidence={props.confidence ?? props.geometry?.source !== "pdb"} region={props.region} controlsHost={props.controlsHost} conservation={props.conservation} ligandAtom={props.ligandAtom} hoveredLigandAtom={props.hoveredLigandAtom} onLigandPick={props.onLigandPick} onLigandHover={props.onLigandHover}/>;
  return <TraceStructureViewer {...props} />;
}

function TraceStructureViewer({ geometry, compact = false, autoRotate = false, hologram = false, label = "Predicted structure", paletteKey, palette, colorMode: fixedColorMode, envelope = false }: StructureViewerProps) {
  const [yaw, setYaw] = useState(-.65);
  const [pitch, setPitch] = useState(.35);
  const [zoom, setZoom] = useState(1);
  const [representation, setRepresentation] = useState<Representation>("ribbon");
  const [savedColorMode, setColorMode] = useState<ColorMode>("theme");
  const colorMode = fixedColorMode ?? savedColorMode;
  const [paletteChoice, setPaletteChoice] = useState<StructurePaletteId | "auto" | "theme">("auto");
  const drag = useRef<{ x: number; y: number; yaw: number; pitch: number } | null>(null);
  const rawId = useId();
  const filterId = `protein-surface-${rawId.replaceAll(":", "")}`;
  const envelopeId = `protein-envelope-${rawId.replaceAll(":", "")}`;
  const points = useMemo(() => parsePoints(geometry?.points), [geometry]);
  const projected = useMemo(() => project(points, yaw, pitch, zoom), [points, yaw, pitch, zoom]);
  const activePalette = paletteChoice === "theme" ? undefined : findStructurePalette(paletteChoice) ?? findStructurePalette(palette) ?? (paletteKey ? structurePaletteForKey(paletteKey) : undefined);
  const paletteStyle = activePalette ? Object.fromEntries([
    ...activePalette.colors.map((value, index) => [`--structure-${index}`, value]),
    ["--structure-bond", activePalette.bond],
  ]) as CSSProperties : undefined;

  useEffect(() => {
    const saved = localStorage.getItem("protein-labs-structure-representation");
    const savedColor = localStorage.getItem("protein-labs-structure-colors");
    if (saved === "ribbon" || saved === "surface" || saved === "atoms") queueMicrotask(() => setRepresentation(saved));
    if (savedColor === "theme" || savedColor === "confidence") queueMicrotask(() => setColorMode(savedColor));
  }, []);
  useEffect(() => {
    if (!paletteKey) return;
    const storageKey = `protein-labs-structure-palette:${paletteKey}`;
    const update = () => {
      const saved = localStorage.getItem(storageKey);
      queueMicrotask(() => setPaletteChoice(saved === "theme" ? "theme" : findStructurePalette(saved)?.id ?? "auto"));
    };
    update();
    window.addEventListener("protein-labs-structure-palette", update);
    return () => window.removeEventListener("protein-labs-structure-palette", update);
  }, [paletteKey]);
  useEffect(() => {
    if (!autoRotate || !points.length) return;
    // Frame-synced and time-based (same ~.18 rad/s as before), capped near 30 fps
    // so several viewers on one screen stay cheap while rotating evenly.
    let frame = 0, last = performance.now();
    const tick = (time: number) => { const elapsed = time - last; if (elapsed >= 30) { last = time; setYaw((value) => value + Math.min(100, elapsed) * .000178); } frame = window.requestAnimationFrame(tick); };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [autoRotate, points.length]);

  function reset() { setYaw(-.65); setPitch(.35); setZoom(1); }
  function chooseRepresentation(value: Representation) { setRepresentation(value); localStorage.setItem("protein-labs-structure-representation", value); }
  function chooseColors(value: ColorMode) { setColorMode(value); localStorage.setItem("protein-labs-structure-colors", value); }
  function choosePalette(value: StructurePaletteId | "auto" | "theme") {
    setPaletteChoice(value);
    if (paletteKey) {
      localStorage.setItem(`protein-labs-structure-palette:${paletteKey}`, value);
      window.dispatchEvent(new Event("protein-labs-structure-palette"));
    }
  }
  function pointerDown(event: PointerEvent<SVGSVGElement>) { if (event.button !== 0) return; drag.current = { x: event.clientX, y: event.clientY, yaw, pitch }; event.currentTarget.setPointerCapture(event.pointerId); }
  function pointerMove(event: PointerEvent<SVGSVGElement>) { if (!drag.current) return; setYaw(drag.current.yaw + (event.clientX - drag.current.x) * .012); setPitch(Math.max(-Math.PI / 2, Math.min(Math.PI / 2, drag.current.pitch + (event.clientY - drag.current.y) * .012))); }
  function wheel(event: WheelEvent<SVGSVGElement>) { event.preventDefault(); setZoom((value) => Math.max(.35, Math.min(5, value * Math.exp(-event.deltaY * .001)))); }
  const color = (point: Projected, index: number) => colorMode === "confidence" ? confidenceColor(point.plddt ?? 75) : `var(--structure-${index % 4})`;
  const sampleEvery = Math.max(1, Math.floor(projected.length / (representation === "atoms" ? 260 : 190)));

  return <div className={`structure-viewer ${compact ? "compact" : ""} ${hologram ? "hologram" : ""} representation-${representation}`} style={paletteStyle} data-structure-palette={activePalette?.id ?? "theme"}>
    {points.length ? <svg viewBox="0 0 800 600" onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} onWheel={wheel} onDoubleClick={reset}>
      <defs><filter id={filterId} x="-35%" y="-35%" width="170%" height="170%"><feGaussianBlur stdDeviation="7"/><feColorMatrix values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9"/></filter>
        {envelope && <filter id={envelopeId} x="-35%" y="-35%" width="170%" height="170%">
          {/* Blur the residues into one blob, keep it faintly filled, and trace its edge as a rim. */}
          <feGaussianBlur stdDeviation="10" result="blur"/>
          <feColorMatrix in="blur" values="1 0 0 0 0  0 1 0 0 0  0 0 1 0 0  0 0 0 22 -9" result="blob"/>
          <feMorphology in="blob" operator="erode" radius="2.5" result="inner"/>
          <feComposite in="blob" in2="inner" operator="out" result="rim"/>
          <feComponentTransfer in="blob" result="fill"><feFuncA type="linear" slope=".2"/></feComponentTransfer>
          <feComponentTransfer in="rim" result="edge"><feFuncA type="linear" slope=".6"/></feComponentTransfer>
          <feMerge><feMergeNode in="fill"/><feMergeNode in="edge"/></feMerge>
        </filter>}</defs>
      {hologram && Array.from({ length: 30 }, (_, index) => <line key={index} x1="0" x2="800" y1={index * 20} y2={index * 20} className="holo-scanline" style={{ stroke: "var(--structure-0)" }}/>)}
      {representation === "ribbon" && <>
        {envelope && <g filter={`url(#${envelopeId})`}>{projected.map((point, index) => index % sampleEvery === 0 ? <circle key={`e-${index}`} cx={point.px} cy={point.py} r={Math.max(18, 30 * point.scale)} fill={color(point, index)}/> : null)}</g>}
        {projected.slice(1).map((point, index) => { const previous = projected[index]; if (previous.chain !== point.chain) return null; const width = Math.max(4, 12 * (previous.scale + point.scale) / 2); return <g key={index}><line className="comic-ink" x1={previous.px} y1={previous.py} x2={point.px} y2={point.py} strokeWidth={width + 5}/><line x1={previous.px} y1={previous.py} x2={point.px} y2={point.py} stroke={color(point, index)} strokeWidth={width} strokeLinecap="round" opacity={Math.max(.58, Math.min(1, .74 + point.depth * .002))}/></g>; })}
        {projected.map((point, index) => index % sampleEvery === 0 ? <circle key={`p-${index}`} cx={point.px} cy={point.py} r={Math.max(2, 3.8 * point.scale)} fill={color(point, index)} stroke="var(--comic-ink)" strokeWidth="1.5"/> : null)}
      </>}
      {representation === "surface" && <>
        <g opacity=".94" filter={`url(#${filterId})`}>{projected.map((point, index) => index % sampleEvery === 0 ? <circle key={`s-${index}`} cx={point.px} cy={point.py} r={Math.max(13, 23 * point.scale)} fill={color(point, index)}/> : null)}</g>
        {projected.map((point, index) => index % (sampleEvery * 2) === 0 ? <circle className="surface-ink" key={`si-${index}`} cx={point.px} cy={point.py} r={Math.max(10, 18 * point.scale)} fill="none"/> : null)}
      </>}
      {representation === "atoms" && <>
        {projected.slice(1).map((point, index) => { const previous = projected[index]; if (previous.chain !== point.chain) return null; return <g key={`b-${index}`}><line className="comic-ink" x1={previous.px} y1={previous.py} x2={point.px} y2={point.py} strokeWidth="7"/><line x1={previous.px} y1={previous.py} x2={point.px} y2={point.py} stroke="var(--structure-bond)" strokeWidth="3.5"/></g>; })}
        {[...projected].sort((a, b) => a.depth - b.depth).map((point, index) => index % sampleEvery === 0 ? <circle key={`a-${index}`} cx={point.px} cy={point.py} r={Math.max(5, 8.5 * point.scale)} fill={color(point, index)} stroke="var(--comic-ink)" strokeWidth="2.5"/> : null)}
      </>}
    </svg> : <div className="structure-empty"><strong>Protein needs to be predicted</strong><small>Retrieve an AlphaFold DB model or import an AlphaFold Server result.</small></div>}
    <span className="structure-badge">{points.length ? `${label} · ${points.length} residues` : label}</span>
    {!compact && <>
      <div className="structure-representation" aria-label="Structure representation"><button className={representation === "ribbon" ? "active" : ""} onClick={() => chooseRepresentation("ribbon")}><Waves/>Ribbon</button><button className={representation === "surface" ? "active" : ""} onClick={() => chooseRepresentation("surface")}><Orbit/>Surface</button><button className={representation === "atoms" ? "active" : ""} onClick={() => chooseRepresentation("atoms")}><CircleDot/>Atoms</button><select aria-label="Structure color mode" value={colorMode} onChange={(event) => chooseColors(event.target.value as ColorMode)}><option value="theme">Decorative colors</option><option value="confidence">pLDDT confidence</option></select><select aria-label="Protein color palette" disabled={colorMode === "confidence"} value={paletteChoice} onChange={(event) => choosePalette(event.target.value as StructurePaletteId | "auto" | "theme")}><option value="auto">{paletteKey ? "Project palette" : "Automatic palette"}</option><option value="theme">App theme</option>{STRUCTURE_PALETTES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></div>
      <div className="structure-controls"><Button variant="secondary" size="icon" onClick={reset}><RotateCcw/></Button><Button variant="secondary" size="icon" onClick={() => setZoom((value) => Math.min(5, value * 1.2))}><Plus/></Button><Button variant="secondary" size="icon" onClick={() => setZoom((value) => Math.max(.35, value / 1.2))}><Minus/></Button></div>
      <div className="confidence-legend">{colorMode === "confidence" ? <><span><i className="very-high"/>Very high</span><span><i className="confident"/>Confident</span><span><i className="low"/>Low</span><span><i className="very-low"/>Very low</span></> : <span className="comic-label">Comic ink · {activePalette ? `${activePalette.name} palette` : "theme-matched palette"}</span>}<small>Drag to rotate · scroll to zoom · double-click to reset</small></div>
    </>}
  </div>;
}

function parsePoints(value: unknown): AtomPoint[] { return Array.isArray(value) ? value.flatMap((item) => { if (!item || typeof item !== "object" || Array.isArray(item)) return []; const point = item as JsonObject; const x = Number(point.x), y = Number(point.y), z = Number(point.z); if (![x, y, z].every(Number.isFinite)) return []; const confidence = Number(point.plddt); return [{ x, y, z, chain: String(point.chain ?? "A"), plddt: Number.isFinite(confidence) ? confidence : null }]; }) : []; }
function project(points: AtomPoint[], yaw: number, pitch: number, zoom: number): Projected[] { if (!points.length) return []; const cx = mean(points.map((point) => point.x)), cy = mean(points.map((point) => point.y)), cz = mean(points.map((point) => point.z)); const cosY = Math.cos(yaw), sinY = Math.sin(yaw), cosP = Math.cos(pitch), sinP = Math.sin(pitch); const rotated = points.map((point) => { const x = point.x - cx, y = point.y - cy, z = point.z - cz; const rx = x * cosY + z * sinY, rz = -x * sinY + z * cosY, ry = y * cosP - rz * sinP, depth = y * sinP + rz * cosP; return { ...point, rx, ry, depth }; }); const span = Math.max(1, ...rotated.flatMap((point) => [Math.abs(point.rx), Math.abs(point.ry)])); return rotated.map((point) => { const perspective = 1 + point.depth / Math.max(200, span * 18); const scale = Math.max(.55, Math.min(1.6, perspective)); return { ...point, px: 400 + point.rx / span * 230 * zoom * scale, py: 300 + point.ry / span * 230 * zoom * scale, scale }; }); }
function mean(values: number[]) { return values.reduce((sum, value) => sum + value, 0) / Math.max(1, values.length); }
function confidenceColor(value: number) { return value >= 90 ? "#0053d6" : value >= 70 ? "#65cbf3" : value >= 50 ? "#ffd65a" : "#ff7d45"; }
