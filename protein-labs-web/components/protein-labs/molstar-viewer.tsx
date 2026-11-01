"use client";

import { CSSProperties, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Camera, CircleAlert, CircleDot, Crosshair, LoaderCircle, Minus, Orbit, Plus, RotateCcw, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findStructurePalette, STRUCTURE_PALETTES, structurePaletteForKey, type StructurePaletteId } from "@/lib/structure-palettes";
import { HYDROPHOBICITY_SCALE, SECONDARY_STRUCTURE_LEGEND } from "@/lib/structure-legends";
import { coloringLegend, type ResidueColoring } from "@/lib/structure-coloring";
import { CONSERVATION_SOURCES, conservationColoring, INSUFFICIENT_COLOR, UNMAPPED_COLOR, type ChainSequence, type ConservationColoring, type ConservationSourceId, type ConservationSources } from "@/lib/conservation-coloring";
import { CONSERVATION_COLORS, MAX_GRADE } from "@/lib/conservation";
import { clampCutoff, DEFAULT_INTERFACE_CUTOFF, findInterfaces, formatCutoff, INTERFACE_CUTOFF_RANGE, interfaceChainColor, interfaceColoring, type InterfaceAtom, type InterfaceResult } from "@/lib/structure-interface";
import { residueKey, type LigandAddress, type ResidueAddress } from "@/lib/structure-regions";
import type { PickedLigandAtom } from "@/lib/ligand-depiction";
import type { MolstarStage, StageColor, StageRepresentation, StageResidue } from "./molstar-stage";

/** What the viewer should highlight: residues in label numbering, plus a ligand instance for binding sites. */
export type ViewerRegion = { id: string; residues: ResidueAddress[]; ligand: LigandAddress | null };
/** One atom of a ligand instance, named as in the deposited file. */
export type ViewerLigandAtom = { ligand: LigandAddress; atomName: string };

export type MolstarViewerProps = {
  structureText: string;
  label: string;
  paletteKey?: string;
  palette?: StructurePaletteId;
  autoRotate?: boolean;
  /** The structure carries per-residue pLDDT (AlphaFold). */
  confidence?: boolean;
  region?: ViewerRegion | null;
  /** Where to render the display and interface controls (the job's side panel); without one they sit beside the canvas. */
  controlsHost?: HTMLElement | null;
  /** Conservation sources for this protein; without them the Conservation panel is not shown. */
  conservation?: ConservationSources;
  /** Ligand atom picked in the 2D drawing: selected in 3D, and the camera turns to it when `focus` is set. */
  ligandAtom?: (ViewerLigandAtom & { focus: boolean }) | null;
  /** Ligand atom under the pointer in the 2D drawing. */
  hoveredLigandAtom?: ViewerLigandAtom | null;
  /** A ligand atom was clicked in 3D. */
  onLigandPick?: (atom: PickedLigandAtom) => void;
  /** The pointer moved onto (or off) a ligand atom in 3D. */
  onLigandHover?: (atom: PickedLigandAtom | null) => void;
  /** A polymer residue was clicked in 3D or in the sequence strip. */
  onResiduePick?: (residue: ResidueAddress) => void;
};

type Status = { state: "loading" | "ready" | "error"; message: string };

const REPRESENTATIONS: { id: StageRepresentation; label: string; icon: typeof Waves }[] = [
  { id: "cartoon", label: "Cartoon", icon: Waves },
  { id: "surface", label: "Surface", icon: Orbit },
  { id: "ball-and-stick", label: "Ball & stick", icon: CircleDot },
];
const COLORS: { id: StageColor; label: string }[] = [
  { id: "chain-id", label: "Colour by chain" },
  { id: "secondary-structure", label: "Secondary structure" },
  { id: "plddt-confidence", label: "pLDDT confidence" },
  { id: "hydrophobicity", label: "Hydrophobicity" },
];
// The trace viewer stores ribbon/surface/atoms under the same key; both read each other's choice.
const LEGACY_REPRESENTATION: Record<string, StageRepresentation> = { ribbon: "cartoon", surface: "surface", atoms: "ball-and-stick" };
const toLegacy = (value: StageRepresentation) => value === "cartoon" ? "ribbon" : value === "ball-and-stick" ? "atoms" : "surface";

const OPACITY_KEY = "protein-labs-structure-surface-opacity";

export function MolstarViewer({ structureText, label, paletteKey, palette, autoRotate = false, confidence = false, region = null, controlsHost, conservation, ligandAtom = null, hoveredLigandAtom = null, onLigandPick, onLigandHover, onResiduePick }: MolstarViewerProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<MolstarStage | null>(null);
  const [status, setStatus] = useState<Status>({ state: "loading", message: "Loading the 3D viewer…" });
  const [stageReady, setStageReady] = useState(false);
  const [loadedRevision, setLoadedRevision] = useState(0);
  const [residues, setResidues] = useState<StageResidue[]>([]);
  const [chainSequences, setChainSequences] = useState<ChainSequence[]>([]);
  const [conservationChoice, setConservationChoice] = useState<ConservationSourceId | null>(null);
  const [hasConfidence, setHasConfidence] = useState(false);
  const [representation, setRepresentation] = useState<StageRepresentation>("cartoon");
  const [colorChoice, setColorChoice] = useState<StageColor | null>(null);
  const [paletteChoice, setPaletteChoice] = useState<StructurePaletteId | "auto" | "theme">("auto");
  const [showLigands, setShowLigands] = useState(true);
  const [showWaters, setShowWaters] = useState(false);
  const [spin, setSpin] = useState(autoRotate);
  const [hovered, setHovered] = useState<string | null>(null);
  const [picked, setPicked] = useState<StageResidue | null>(null);
  const [pickedAtom, setPickedAtom] = useState<PickedLigandAtom | null>(null);
  // The stage subscribes once; these refs hand it the latest callbacks.
  const ligandPick = useRef(onLigandPick);
  const ligandHover = useRef(onLigandHover);
  const residuePick = useRef(onResiduePick);
  useEffect(() => { ligandPick.current = onLigandPick; ligandHover.current = onLigandHover; residuePick.current = onResiduePick; }, [onLigandPick, onLigandHover, onResiduePick]);
  const [saving, setSaving] = useState<string | null>(null);
  const [surfaceOpacity, setSurfaceOpacity] = useState(100);
  const [proteinAtoms, setProteinAtoms] = useState<InterfaceAtom[]>([]);
  // The structure revision the interface is shown for, so loading another structure switches it off.
  const [interfaceFor, setInterfaceFor] = useState<number | null>(null);
  const [cutoff, setCutoff] = useState(DEFAULT_INTERFACE_CUTOFF);
  const confidenceAvailable = confidence && hasConfidence;
  const color: StageColor = colorChoice === "plddt-confidence" && !confidenceAvailable ? "chain-id" : colorChoice ?? (confidenceAvailable ? "plddt-confidence" : "chain-id");
  const activePalette = paletteChoice === "theme" ? undefined : findStructurePalette(paletteChoice) ?? findStructurePalette(palette) ?? (paletteKey ? structurePaletteForKey(paletteKey) : undefined);
  const chainColors = useMemo(() => activePalette?.colors ?? themeChainColors(), [activePalette]);
  const regionKeys = useMemo(() => new Set(region?.residues.map((item) => residueKey(item.labelAsymId, item.labelSeqId)) ?? []), [region]);
  const paletteStyle = activePalette ? Object.fromEntries(activePalette.colors.map((value, index) => [`--structure-${index}`, value])) as CSSProperties : undefined;

  useEffect(() => {
    const saved = LEGACY_REPRESENTATION[localStorage.getItem("protein-labs-structure-representation") ?? ""];
    const savedColor = localStorage.getItem("protein-labs-structure-molstar-color");
    if (saved) queueMicrotask(() => setRepresentation(saved));
    if (COLORS.some((item) => item.id === savedColor)) queueMicrotask(() => setColorChoice(savedColor as StageColor));
    const savedOpacity = Number(localStorage.getItem(OPACITY_KEY) ?? "");
    if (localStorage.getItem(OPACITY_KEY) !== null && savedOpacity >= 0 && savedOpacity <= 100) queueMicrotask(() => setSurfaceOpacity(Math.round(savedOpacity)));
  }, []);
  useEffect(() => {
    if (!paletteKey) return;
    const storageKey = `protein-labs-structure-palette:${paletteKey}`;
    const update = () => { const saved = localStorage.getItem(storageKey); queueMicrotask(() => setPaletteChoice(saved === "theme" ? "theme" : findStructurePalette(saved)?.id ?? "auto")); };
    update();
    window.addEventListener("protein-labs-structure-palette", update);
    return () => window.removeEventListener("protein-labs-structure-palette", update);
  }, [paletteKey]);

  // Create the Mol* plugin once per mount; Mol* itself is fetched on first use.
  useEffect(() => {
    const element = host.current;
    if (!element) return;
    let cancelled = false;
    import("./molstar-stage").then(async ({ MolstarStage }) => {
      const stage = await MolstarStage.create(element, cssTheme());
      if (cancelled) { stage.dispose(); return; }
      stage.onHover((residue) => setHovered(residue ? residueKey(residue.labelAsymId, residue.labelSeqId) : null));
      stage.onClick((residue) => { setPicked(residue); if (residue) residuePick.current?.({ labelAsymId: residue.labelAsymId, labelSeqId: residue.labelSeqId }); });
      stage.onLigandClick((atom) => { setPickedAtom(atom); if (atom) ligandPick.current?.(atom); });
      stage.onLigandHover((atom) => ligandHover.current?.(atom));
      stageRef.current = stage;
      setStageReady(true);
    }).catch((reason: unknown) => { if (!cancelled) setStatus({ state: "error", message: messageOf(reason) }); });
    return () => { cancelled = true; stageRef.current?.dispose(); stageRef.current = null; };
  }, []);

  // (Re)load coordinates whenever the structure text changes.
  useEffect(() => {
    const stage = stageRef.current;
    if (!stage || !stageReady) return;
    let cancelled = false;
    queueMicrotask(() => { if (!cancelled) setStatus({ state: "loading", message: "Drawing the structure…" }); });
    stage.load(structureText, label).then((result) => {
      if (cancelled) return;
      setResidues(result.residues); setChainSequences(result.chains); setHasConfidence(result.hasConfidence); setPicked(null); setPickedAtom(null);
      // Mol* groups chains by entity (A, C, B, D for haemoglobin); list them by name instead.
      setProteinAtoms(stage.proteinHeavyAtoms().sort((one, other) => one.chain.localeCompare(other.chain, undefined, { numeric: true })));
      setLoadedRevision((value) => value + 1);
      setStatus({ state: "ready", message: "" });
    }).catch((reason: unknown) => { if (!cancelled) setStatus({ state: "error", message: `The structure file could not be read. ${messageOf(reason)}` }); });
    return () => { cancelled = true; };
    // label only names the Mol* data node; re-reading the coordinates for a new label is wasted work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureText, stageReady]);

  const ready = status.state === "ready" && loadedRevision > 0;
  const chainLabels = useMemo(() => new Map(residues.map((item) => [item.labelAsymId, item.authAsymId])), [residues]);
  const residueByKey = useMemo(() => new Map(residues.map((item) => [residueKey(item.labelAsymId, item.labelSeqId), item])), [residues]);
  const proteinChains = useMemo(() => new Set(proteinAtoms.map((atom) => atom.chain)).size, [proteinAtoms]);
  const interfaceOn = interfaceFor === loadedRevision && proteinChains > 1;
  const interfaces = useMemo<InterfaceResult | null>(() => interfaceOn ? findInterfaces(proteinAtoms, cutoff) : null, [interfaceOn, proteinAtoms, cutoff]);
  const conservationSource = conservationChoice ? conservation?.[conservationChoice] : undefined;
  const conservationProfile = conservationSource?.state === "ready" ? conservationSource.profile : null;
  const conservationResult = useMemo<ConservationColoring | null>(() => ready && conservationProfile ? conservationColoring(conservationProfile, chainSequences, residues) : null, [ready, conservationProfile, chainSequences, residues]);
  // Every colour layer goes through here. The interface and conservation layers are exclusive: choosing one switches the other off.
  const coloring = useMemo<ResidueColoring | null>(() => interfaces ? interfaceColoring(interfaces, (chain) => chainLabels.get(chain) ?? chain) : conservationResult?.coloring ?? null, [interfaces, chainLabels, conservationResult]);
  const fillStrip = !interfaces && Boolean(conservationResult);
  const coloredKeys = useMemo(() => new Map(coloring?.groups.flatMap((group) => group.residues.map((item) => [residueKey(item.labelAsymId, item.labelSeqId), group.color] as const)) ?? []), [coloring]);
  useEffect(() => {
    if (!ready) return;
    stageRef.current?.setStyle({ representation, color, showLigands, showWaters, spin }, chainColors).catch((reason: unknown) => setStatus({ state: "error", message: `This view could not be drawn. ${messageOf(reason)}` }));
  }, [ready, loadedRevision, representation, color, showLigands, showWaters, spin, chainColors]);
  useEffect(() => { if (ready) void stageRef.current?.setSurfaceOpacity(surfaceOpacity / 100); }, [ready, loadedRevision, surfaceOpacity]);
  useEffect(() => { if (ready) void stageRef.current?.setColoring(coloring); }, [ready, loadedRevision, coloring]);
  useEffect(() => {
    if (!ready) return;
    void stageRef.current?.showRegion(region?.residues ?? [], region?.ligand ?? null);
    const first = region?.residues[0];
    if (first) document.getElementById(cellId(residueKey(first.labelAsymId, first.labelSeqId)))?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [ready, loadedRevision, region]);
  useEffect(() => {
    if (hovered) document.getElementById(cellId(hovered))?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [hovered]);
  useEffect(() => {
    if (ready) void stageRef.current?.showLigandAtom(ligandAtom?.ligand ?? null, ligandAtom?.atomName ?? null, ligandAtom?.focus ?? false);
  }, [ready, loadedRevision, ligandAtom]);
  useEffect(() => {
    if (ready) stageRef.current?.hoverLigandAtom(hoveredLigandAtom?.ligand ?? null, hoveredLigandAtom?.atomName ?? null);
  }, [ready, hoveredLigandAtom]);

  function chooseRepresentation(value: StageRepresentation) { setRepresentation(value); localStorage.setItem("protein-labs-structure-representation", toLegacy(value)); }
  function chooseOpacity(value: number) { setSurfaceOpacity(value); localStorage.setItem(OPACITY_KEY, String(value)); }
  function focusResidues(items: StageResidue[]) { if (items.length === 1) setPicked(items[0]); stageRef.current?.focusResidues(items); }
  function chooseColor(value: StageColor) { setColorChoice(value); localStorage.setItem("protein-labs-structure-molstar-color", value); }
  function choosePalette(value: StructurePaletteId | "auto" | "theme") {
    setPaletteChoice(value);
    if (paletteKey) { localStorage.setItem(`protein-labs-structure-palette:${paletteKey}`, value); window.dispatchEvent(new Event("protein-labs-structure-palette")); }
  }
  async function saveImage() {
    const stage = stageRef.current;
    if (!stage) return;
    setSaving("Saving image…");
    try {
      const link = document.createElement("a");
      link.href = await stage.imageDataUri();
      link.download = `${label.replace(/[^A-Za-z0-9._-]+/g, "_") || "structure"}.png`;
      link.click();
      setSaving(`Image saved as ${link.download}`);
      window.setTimeout(() => setSaving(null), 4000);
    } catch (reason) { setSaving(`The image could not be saved. ${messageOf(reason)}`); }
  }
  function hoverFromStrip(residue: StageResidue | null) { setHovered(residue ? residueKey(residue.labelAsymId, residue.labelSeqId) : null); stageRef.current?.hoverResidue(residue); }
  function pickFromStrip(residue: StageResidue) { setPicked(residue); setPickedAtom(null); stageRef.current?.focusResidue(residue); residuePick.current?.({ labelAsymId: residue.labelAsymId, labelSeqId: residue.labelSeqId }); }

  const chainCount = new Set(residues.map((item) => item.labelAsymId)).size;
  const controls = <>
    <section className="lab-panel structure-display" id="structure-display" aria-labelledby="structure-display-title">
      <div className="panel-heading"><div><h2 id="structure-display-title">Display</h2><p>Representation, colours and what is drawn.</p></div></div>
      <div className="structure-segmented" role="group" aria-label="Structure representation">
        {REPRESENTATIONS.map(({ id, label: name, icon: Icon }) => <button key={id} type="button" aria-pressed={representation === id} className={representation === id ? "active" : ""} onClick={() => chooseRepresentation(id)}><Icon/>{name}</button>)}
      </div>
      <label className={`structure-range ${representation === "surface" ? "" : "disabled"}`}>
        <span className="structure-range-label">Surface opacity <output>{surfaceOpacity}%</output></span>
        <input type="range" min={0} max={100} step={5} value={surfaceOpacity} disabled={representation !== "surface"} aria-valuetext={`${surfaceOpacity}%`} onChange={(event) => chooseOpacity(Number(event.target.value))}/>
        {representation !== "surface" && <small>Applies to the Surface view.</small>}
      </label>
      <label className="lab-field"><span>Colour scheme</span>
        <select value={color} onChange={(event) => chooseColor(event.target.value as StageColor)}>
          {COLORS.map((item) => <option key={item.id} value={item.id} disabled={item.id === "plddt-confidence" && !confidenceAvailable}>{item.label}{item.id === "plddt-confidence" && !confidenceAvailable ? " (AlphaFold models only)" : ""}</option>)}
        </select>
        {coloring && <small className="structure-scheme-note">{coloring.title} is painted over this scheme. Switch it off to see the scheme again.</small>}
      </label>
      {color === "chain-id" && <label className="lab-field"><span>Chain palette</span><select value={paletteChoice} onChange={(event) => choosePalette(event.target.value as StructurePaletteId | "auto" | "theme")}><option value="auto">{paletteKey ? "Project palette" : "Automatic palette"}</option><option value="theme">App theme</option>{STRUCTURE_PALETTES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label>}
      <div className="structure-toggles" role="group" aria-label="Molecule display options">
        <button type="button" aria-pressed={showLigands} className={showLigands ? "active" : ""} onClick={() => setShowLigands((value) => !value)}>Ligands</button>
        <button type="button" aria-pressed={showWaters} className={showWaters ? "active" : ""} onClick={() => setShowWaters((value) => !value)}>Waters</button>
        <button type="button" aria-pressed={spin} className={spin ? "active" : ""} onClick={() => setSpin((value) => !value)}>Spin</button>
      </div>
    </section>
    {ready && proteinChains > 1 && <InterfacePanel result={interfaces} chainCount={proteinChains} cutoff={cutoff} chainLabels={chainLabels} residueByKey={residueByKey}
      onToggle={() => { if (!interfaceOn) setConservationChoice(null); setInterfaceFor(interfaceOn ? null : loadedRevision); }} onCutoff={(value) => setCutoff(clampCutoff(value))} onFocus={focusResidues}/>}
    {ready && conservation && <ConservationPanel sources={conservation} choice={conservationChoice} result={conservationResult}
      onChoose={(value) => { if (value) setInterfaceFor(null); setConservationChoice(value); }}/>}
  </>;
  return <div className={`structure-viewer molecular-viewer molstar-viewer representation-${representation}`} style={paletteStyle} data-structure-palette={activePalette?.id ?? "theme"}>
    <div className="molstar-stage">
      <div ref={host} className="molecular-webgl" aria-label="Interactive 3D structure. Drag to rotate, scroll to zoom." role="img"/>
      {status.state !== "ready" && <div className={`structure-overlay ${status.state}`} role={status.state === "error" ? "alert" : "status"}>
        {status.state === "loading" ? <LoaderCircle className="spin"/> : null}<strong>{status.state === "error" ? "The 3D view is unavailable" : status.message}</strong>{status.state === "error" && <small>{status.message}</small>}
      </div>}
      <div className="structure-controls"><Button variant="secondary" size="icon" title="Reset view" aria-label="Reset view" onClick={() => stageRef.current?.resetCamera()}><RotateCcw/></Button><Button variant="secondary" size="icon" title="Zoom in" aria-label="Zoom in" onClick={() => stageRef.current?.zoom(0.8)}><Plus/></Button><Button variant="secondary" size="icon" title="Zoom out" aria-label="Zoom out" onClick={() => stageRef.current?.zoom(1.25)}><Minus/></Button><Button variant="secondary" size="icon" title="Save image (PNG)" aria-label="Save image (PNG)" disabled={!ready || saving === "Saving image…"} onClick={() => void saveImage()}><Camera/></Button></div>
      <div className="molstar-footer">
        <span className="structure-badge">{label}{ready ? ` · ${residues.length} residues · ${chainCount || 1} chain${chainCount === 1 ? "" : "s"}` : ""}</span>
        <div className="confidence-legend molecular-status">
          {coloring?.id.startsWith("conservation-") ? <ConservationLegend title={coloring.title}/> : coloring ? <ColoringLegend coloring={coloring}/> : <ColourLegend color={color}/>}
          <small role="status">{saving ?? (pickedAtom ? `${pickedAtom.ccdId} ${pickedAtom.authSeqId}${pickedAtom.insertionCode ?? ""} · atom ${pickedAtom.atomName} · chain ${pickedAtom.chainId}` : picked ? `${threeLetter(picked.compId)} ${picked.authSeqId}${picked.insCode} · chain ${picked.authAsymId}` : "Drag to rotate · scroll to zoom · click a residue to identify it")}</small>
        </div>
      </div>
    </div>
    <SequenceStrip residues={residues} hovered={hovered} picked={picked} regionKeys={regionKeys} coloredKeys={coloredKeys} baseColor={fillStrip ? coloring?.base?.color ?? null : null} onHover={hoverFromStrip} onPick={pickFromStrip}/>
    {controlsHost ? createPortal(controls, controlsHost) : controlsHost === undefined ? <div className="molstar-inline-controls">{controls}</div> : null}
  </div>;
}

/** Legend for a residue colour layer (interface now; any later source uses the same shape). */
function ColoringLegend({ coloring }: { coloring: ResidueColoring }) {
  return <span className="legend-entries" aria-label={coloring.title}><span className="legend-title">{coloring.title}</span>{coloringLegend(coloring).map((entry) => <span key={entry.key}><i className="legend-swatch" style={{ background: entry.color }}/>{entry.label}</span>)}</span>;
}

/** ConSurf's scale as one strip, variable to conserved, then the two greys. */
function ConservationLegend({ title }: { title: string }) {
  return <span className="legend-entries conservation-legend" aria-label={`${title}: grade 1 variable to grade ${MAX_GRADE} conserved; grey for insufficient data and for residues not mapped`}>
    <span className="legend-title">{title}</span>
    <span>Variable<span className="conservation-scale" aria-hidden="true">{Array.from({ length: MAX_GRADE }, (_, index) => <i key={index} style={{ background: CONSERVATION_COLORS[String(index + 1)] }} title={`Grade ${index + 1}`}/>)}</span>Conserved</span>
    <span><i className="legend-swatch" style={{ background: INSUFFICIENT_COLOR }}/>Insufficient data</span>
    <span><i className="legend-swatch" style={{ background: UNMAPPED_COLOR }}/>Not mapped</span>
  </span>;
}

/** Colour by conservation: pick a source, see which chains it reached and how many residues it graded. */
function ConservationPanel({ sources, choice, result, onChoose }: { sources: ConservationSources; choice: ConservationSourceId | null; result: ConservationColoring | null; onChoose(value: ConservationSourceId | null): void }) {
  const active = choice && sources[choice].state === "ready" ? choice : null;
  const source = choice ? sources[choice] : null;
  const matching = result?.chains.filter((chain) => chain.matches) ?? [];
  return <section className="lab-panel structure-conservation" id="structure-conservation" aria-labelledby="structure-conservation-title">
    <div className="panel-heading"><div><h2 id="structure-conservation-title">Conservation</h2><p>Colour residues by how conserved they are across homologues, on ConSurf&apos;s 1–9 scale.</p></div></div>
    <div className="structure-segmented" role="group" aria-label="Conservation source">
      <button type="button" aria-pressed={!active} className={!active ? "active" : ""} onClick={() => onChoose(null)}>Off</button>
      {CONSERVATION_SOURCES.map((item) => {
        const state = sources[item.id];
        const disabled = state.state !== "ready";
        return <button key={item.id} type="button" aria-pressed={active === item.id} className={active === item.id ? "active" : ""} disabled={disabled}
          title={disabled ? `${item.label}: ${state.hint}` : item.label} aria-describedby={disabled ? `conservation-hint-${item.id}` : undefined} onClick={() => onChoose(item.id)}>
          {state.state === "loading" ? <LoaderCircle className="spin"/> : null}{item.short}
        </button>;
      })}
    </div>
    <ul className="conservation-hints">
      {CONSERVATION_SOURCES.map((item) => { const state = sources[item.id]; return state.state === "ready" ? null : <li key={item.id} id={`conservation-hint-${item.id}`} className={state.state === "error" ? "error" : ""}><strong>{item.label}:</strong> {state.hint}</li>; })}
    </ul>
    {source?.state === "ready" && result && <div className="conservation-summary" aria-live="polite">
      {source.profile.detail && <p className="structure-note">{source.profile.detail}</p>}
      {matching.length ? <>
        <p className="structure-note" role="status">{result.counts.graded} residue{result.counts.graded === 1 ? "" : "s"} graded · {result.counts.insufficient} with insufficient data · {result.counts.unmapped} not mapped</p>
        <ul className="conservation-chains">
          {result.chains.map((chain) => <li key={chain.labelAsymId}>
            <strong>Chain {chain.authAsymId}</strong>
            <small>{chain.matches ? `${chain.byLabelSeqId.size} positions aligned · ${Math.round(chain.identity * 100)}% identity` : "Not this protein; left grey"}</small>
          </li>)}
        </ul>
      </> : <div className="inline-message error"><CircleAlert/> No chain in this structure aligns to the graded sequence, so nothing is coloured.</div>}
    </div>}
  </section>;
}

/** One-click chain-interface highlight with the contacts listed per chain pair. */
function InterfacePanel({ result, chainCount, cutoff, chainLabels, residueByKey, onToggle, onCutoff, onFocus }: {
  result: InterfaceResult | null; chainCount: number; cutoff: number; chainLabels: Map<string, string>; residueByKey: Map<string, StageResidue>;
  onToggle(): void; onCutoff(value: number): void; onFocus(residues: StageResidue[]): void;
}) {
  const on = result !== null;
  const name = (chain: string) => chainLabels.get(chain) ?? chain;
  const lookup = (chain: string, seqs: number[]) => seqs.flatMap((seq) => residueByKey.get(residueKey(chain, seq)) ?? []);
  const total = result ? new Set(result.pairs.flatMap((pair) => pair.chains.flatMap((chain, side) => pair.residues[side].map((seq) => `${chain}:${seq}`)))).size : 0;
  return <section className="lab-panel structure-interface" id="structure-interface" aria-labelledby="structure-interface-title">
    <div className="panel-heading"><div><h2 id="structure-interface-title">Chain interface</h2><p>{chainCount} protein chains. Residues with any heavy atom within the contact distance of another chain.</p></div></div>
    <Button variant={on ? "default" : "outline"} className="wide" aria-pressed={on} onClick={onToggle}><Crosshair/> {on ? "Hide interface" : "Highlight interface"}</Button>
    <label className="structure-range">
      <span className="structure-range-label">Contact distance <output>{formatCutoff(cutoff)}</output></span>
      <input type="range" min={INTERFACE_CUTOFF_RANGE.min} max={INTERFACE_CUTOFF_RANGE.max} step={INTERFACE_CUTOFF_RANGE.step} value={cutoff} aria-valuetext={formatCutoff(cutoff)} onChange={(event) => onCutoff(Number(event.target.value))}/>
    </label>
    {result && (result.pairs.length ? <>
      <p className="structure-note" role="status">{total} interface residue{total === 1 ? "" : "s"} across {result.pairs.length} chain pair{result.pairs.length === 1 ? "" : "s"}.</p>
      <div className="interface-pairs">
        {result.pairs.map((pair) => {
          const sides = pair.chains.map((chain, side) => ({ chain, items: lookup(chain, pair.residues[side]) }));
          return <details key={pair.chains.join("-")} className="interface-pair">
            <summary><span>Chains {name(pair.chains[0])} – {name(pair.chains[1])}</span><small>{pair.residues[0].length} + {pair.residues[1].length} residues · closest {pair.minDistance.toFixed(1)} Å</small></summary>
            <Button variant="outline" size="sm" onClick={() => onFocus(sides.flatMap((side) => side.items))}><Crosshair/> Focus this interface</Button>
            {sides.map(({ chain, items }) => <div key={chain} className="interface-side">
              <span className="interface-side-title"><i className="legend-swatch" style={{ background: interfaceChainColor(result, chain) }}/>Chain {name(chain)}</span>
              <ul>{items.map((item) => <li key={item.labelSeqId}><button type="button" title={`Focus ${threeLetter(item.compId)} ${item.authSeqId}${item.insCode} of chain ${item.authAsymId}`} onClick={() => onFocus([item])}>{threeLetter(item.compId)} {item.authSeqId}{item.insCode}</button></li>)}</ul>
            </div>)}
          </details>;
        })}
      </div>
    </> : <p className="structure-note" role="status">No chains touch within {formatCutoff(result.cutoff)}. Try a longer contact distance.</p>)}
  </section>;
}

/** What the current colouring means; the swatches follow Mol*'s own colour themes. */
function ColourLegend({ color }: { color: StageColor }) {
  if (color === "plddt-confidence") return <><span><i className="very-high"/>Very high (&gt;90)</span><span><i className="confident"/>Confident</span><span><i className="low"/>Low</span><span><i className="very-low"/>Very low (&lt;50)</span></>;
  if (color === "secondary-structure") return <span className="legend-entries">{SECONDARY_STRUCTURE_LEGEND.map((entry) => <span key={entry.key}><i className="legend-swatch" style={{ background: entry.color }}/>{entry.label}</span>)}</span>;
  if (color === "hydrophobicity") return <span title={HYDROPHOBICITY_SCALE.source}>{HYDROPHOBICITY_SCALE.from}<i className="hydrophobicity-scale" style={{ background: `linear-gradient(90deg, ${HYDROPHOBICITY_SCALE.colors.join(", ")})` }}/>{HYDROPHOBICITY_SCALE.to}</span>;
  return <span className="comic-label">{COLORS.find((item) => item.id === color)?.label}</span>;
}

/** One cell per modelled polymer residue, grouped by chain, in sync with the 3D view. */
function SequenceStrip({ residues, hovered, picked, regionKeys, coloredKeys, baseColor, onHover, onPick }: { residues: StageResidue[]; hovered: string | null; picked: StageResidue | null; regionKeys: Set<string>; coloredKeys: Map<string, string>; /** Fill whole cells with the residue colour (conservation) instead of underlining them; residues no group claims take this colour. */ baseColor: string | null; onHover(residue: StageResidue | null): void; onPick(residue: StageResidue): void }) {
  const [cursor, setCursor] = useState(-1);
  const chains = useMemo(() => {
    const groups: { chain: string; label: string; items: { residue: StageResidue; index: number; gap: number }[] }[] = [];
    residues.forEach((residue, index) => {
      let group = groups.at(-1);
      if (!group || group.chain !== residue.labelAsymId) { group = { chain: residue.labelAsymId, label: residue.authAsymId, items: [] }; groups.push(group); }
      const previous = group.items.at(-1)?.residue;
      group.items.push({ residue, index, gap: previous ? residue.labelSeqId - previous.labelSeqId - 1 : 0 });
    });
    return groups;
  }, [residues]);
  if (!residues.length) return <div className="sequence-strip empty" aria-hidden="true"/>;
  const pickedKey = picked ? residueKey(picked.labelAsymId, picked.labelSeqId) : null;

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    const step = event.key === "ArrowRight" ? 1 : event.key === "ArrowLeft" ? -1 : event.key === "End" ? residues.length : event.key === "Home" ? -residues.length : 0;
    if (step) {
      event.preventDefault();
      const next = Math.max(0, Math.min(residues.length - 1, (cursor < 0 ? 0 : cursor) + step));
      setCursor(next); onHover(residues[next]);
    } else if ((event.key === "Enter" || event.key === " ") && cursor >= 0) { event.preventDefault(); onPick(residues[cursor]); }
  }
  const active = cursor >= 0 ? residues[cursor] : null;
  return <div className={`sequence-strip ${baseColor ? "fill-colors" : ""}`} role="listbox" tabIndex={0} aria-label="Sequence of the modelled residues. Use the arrow keys to move, Enter to focus a residue." aria-activedescendant={active ? cellId(residueKey(active.labelAsymId, active.labelSeqId)) : undefined} onKeyDown={onKeyDown} onMouseLeave={() => onHover(null)} onBlur={() => onHover(null)}>
    {chains.map((group) => <div className="sequence-chain" key={group.chain}>
      <span className="sequence-chain-label">Chain {group.label}</span>
      {group.items.map(({ residue, index, gap }) => {
        const key = residueKey(residue.labelAsymId, residue.labelSeqId);
        const fill = coloredKeys.get(key) ?? baseColor;
        return <span key={key} className="sequence-run">
          {gap > 0 && <span className="sequence-gap" title={`${gap} residue${gap === 1 ? "" : "s"} not modelled`}>···</span>}
          {(residue.authSeqId % 10 === 0) && <span className="sequence-number" aria-hidden="true">{residue.authSeqId}</span>}
          <span id={cellId(key)} role="option" aria-selected={key === pickedKey} aria-label={`${threeLetter(residue.compId)} ${residue.authSeqId}${residue.insCode} chain ${residue.authAsymId}`} title={`${threeLetter(residue.compId)} ${residue.authSeqId}${residue.insCode} · chain ${residue.authAsymId}`}
            className={["sequence-cell", regionKeys.has(key) ? "in-region" : "", fill ? "colored" : "", key === hovered ? "hovered" : "", key === pickedKey ? "picked" : "", index === cursor ? "cursor" : ""].filter(Boolean).join(" ")}
            style={fill ? { "--residue-color": fill, "--residue-ink": inkOn(fill) } as CSSProperties : undefined}
            onMouseEnter={() => onHover(residue)} onClick={() => { setCursor(index); onPick(residue); }}>{residue.code}</span>
        </span>;
      })}
    </div>)}
  </div>;
}

/** Dark ink on pale grades, white on the deep ones. */
function inkOn(color: string) {
  const value = parseInt(color.replace("#", ""), 16);
  const [r, g, b] = [(value >> 16) & 255, (value >> 8) & 255, value & 255];
  return 0.299 * r + 0.587 * g + 0.114 * b < 140 ? "#ffffff" : "#23272f";
}

const cellId = (key: string) => `seq-${key.replace(/[^A-Za-z0-9_-]/g, "_")}`;
const messageOf = (reason: unknown) => reason instanceof Error ? reason.message : String(reason);
const NAMES: Record<string, string> = { ALA: "Ala", ARG: "Arg", ASN: "Asn", ASP: "Asp", CYS: "Cys", GLN: "Gln", GLU: "Glu", GLY: "Gly", HIS: "His", ILE: "Ile", LEU: "Leu", LYS: "Lys", MET: "Met", PHE: "Phe", PRO: "Pro", SER: "Ser", THR: "Thr", TRP: "Trp", TYR: "Tyr", VAL: "Val" };
const threeLetter = (compId: string) => NAMES[compId] ?? compId;

function cssValue(name: string, fallback: string) {
  const value = typeof window === "undefined" ? "" : getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return /^#[0-9a-f]{6}$/i.test(value) ? value : fallback;
}
function themeChainColors() { return [0, 1, 2, 3].map((index) => cssValue(`--structure-${index}`, ["#25c7a8", "#78e4cf", "#7d8dff", "#efb25a"][index])); }
// Hover uses the accent, selection and region side chains the primary colour, as elsewhere in the app.
function cssTheme() { return { highlight: cssValue("--accent", "#f1c85d"), select: cssValue("--primary", "#dc5c48"), region: cssValue("--primary", "#dc5c48") }; }
