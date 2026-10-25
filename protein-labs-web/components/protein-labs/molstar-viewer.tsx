"use client";

import { CSSProperties, KeyboardEvent, useEffect, useMemo, useRef, useState } from "react";
import { Camera, CircleDot, LoaderCircle, Minus, Orbit, Plus, RotateCcw, Waves } from "lucide-react";
import { Button } from "@/components/ui/button";
import { findStructurePalette, STRUCTURE_PALETTES, structurePaletteForKey, type StructurePaletteId } from "@/lib/structure-palettes";
import { HYDROPHOBICITY_SCALE, SECONDARY_STRUCTURE_LEGEND } from "@/lib/structure-legends";
import { residueKey, type LigandAddress, type ResidueAddress } from "@/lib/structure-regions";
import type { MolstarStage, StageColor, StageRepresentation, StageResidue } from "./molstar-stage";

/** What the viewer should highlight: residues in label numbering, plus a ligand instance for binding sites. */
export type ViewerRegion = { id: string; residues: ResidueAddress[]; ligand: LigandAddress | null };

export type MolstarViewerProps = {
  structureText: string;
  label: string;
  paletteKey?: string;
  palette?: StructurePaletteId;
  autoRotate?: boolean;
  /** The structure carries per-residue pLDDT (AlphaFold). */
  confidence?: boolean;
  region?: ViewerRegion | null;
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

export function MolstarViewer({ structureText, label, paletteKey, palette, autoRotate = false, confidence = false, region = null }: MolstarViewerProps) {
  const host = useRef<HTMLDivElement | null>(null);
  const stageRef = useRef<MolstarStage | null>(null);
  const [status, setStatus] = useState<Status>({ state: "loading", message: "Loading the 3D viewer…" });
  const [stageReady, setStageReady] = useState(false);
  const [loadedRevision, setLoadedRevision] = useState(0);
  const [residues, setResidues] = useState<StageResidue[]>([]);
  const [hasConfidence, setHasConfidence] = useState(false);
  const [representation, setRepresentation] = useState<StageRepresentation>("cartoon");
  const [colorChoice, setColorChoice] = useState<StageColor | null>(null);
  const [paletteChoice, setPaletteChoice] = useState<StructurePaletteId | "auto" | "theme">("auto");
  const [showLigands, setShowLigands] = useState(true);
  const [showWaters, setShowWaters] = useState(false);
  const [spin, setSpin] = useState(autoRotate);
  const [hovered, setHovered] = useState<string | null>(null);
  const [picked, setPicked] = useState<StageResidue | null>(null);
  const [saving, setSaving] = useState<string | null>(null);
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
      stage.onClick((residue) => setPicked(residue));
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
      setResidues(result.residues); setHasConfidence(result.hasConfidence); setPicked(null);
      setLoadedRevision((value) => value + 1);
      setStatus({ state: "ready", message: "" });
    }).catch((reason: unknown) => { if (!cancelled) setStatus({ state: "error", message: `The structure file could not be read. ${messageOf(reason)}` }); });
    return () => { cancelled = true; };
    // label only names the Mol* data node; re-reading the coordinates for a new label is wasted work.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureText, stageReady]);

  const ready = status.state === "ready" && loadedRevision > 0;
  useEffect(() => {
    if (!ready) return;
    stageRef.current?.setStyle({ representation, color, showLigands, showWaters, spin }, chainColors).catch((reason: unknown) => setStatus({ state: "error", message: `This view could not be drawn. ${messageOf(reason)}` }));
  }, [ready, loadedRevision, representation, color, showLigands, showWaters, spin, chainColors]);
  useEffect(() => {
    if (!ready) return;
    void stageRef.current?.showRegion(region?.residues ?? [], region?.ligand ?? null);
    const first = region?.residues[0];
    if (first) document.getElementById(cellId(residueKey(first.labelAsymId, first.labelSeqId)))?.scrollIntoView({ block: "nearest", inline: "center" });
  }, [ready, loadedRevision, region]);
  useEffect(() => {
    if (hovered) document.getElementById(cellId(hovered))?.scrollIntoView({ block: "nearest", inline: "nearest" });
  }, [hovered]);

  function chooseRepresentation(value: StageRepresentation) { setRepresentation(value); localStorage.setItem("protein-labs-structure-representation", toLegacy(value)); }
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
  function pickFromStrip(residue: StageResidue) { setPicked(residue); stageRef.current?.focusResidue(residue); }

  const chainCount = new Set(residues.map((item) => item.labelAsymId)).size;
  return <div className={`structure-viewer molecular-viewer molstar-viewer representation-${representation}`} style={paletteStyle} data-structure-palette={activePalette?.id ?? "theme"}>
    <div className="molstar-stage">
      <div ref={host} className="molecular-webgl" aria-label="Interactive 3D structure. Drag to rotate, scroll to zoom." role="img"/>
      {status.state !== "ready" && <div className={`structure-overlay ${status.state}`} role={status.state === "error" ? "alert" : "status"}>
        {status.state === "loading" ? <LoaderCircle className="spin"/> : null}<strong>{status.state === "error" ? "The 3D view is unavailable" : status.message}</strong>{status.state === "error" && <small>{status.message}</small>}
      </div>}
      <div className="structure-representation molecular-toolbar" role="toolbar" aria-label="Structure representation">
        {REPRESENTATIONS.map(({ id, label: name, icon: Icon }) => <button key={id} type="button" aria-pressed={representation === id} className={representation === id ? "active" : ""} onClick={() => chooseRepresentation(id)}><Icon/>{name}</button>)}
        <select aria-label="Colour scheme" value={color} onChange={(event) => chooseColor(event.target.value as StageColor)}>
          {COLORS.map((item) => <option key={item.id} value={item.id} disabled={item.id === "plddt-confidence" && !confidenceAvailable}>{item.label}{item.id === "plddt-confidence" && !confidenceAvailable ? " (AlphaFold models only)" : ""}</option>)}
        </select>
        {color === "chain-id" && <select aria-label="Chain palette" value={paletteChoice} onChange={(event) => choosePalette(event.target.value as StructurePaletteId | "auto" | "theme")}><option value="auto">{paletteKey ? "Project palette" : "Automatic palette"}</option><option value="theme">App theme</option>{STRUCTURE_PALETTES.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select>}
      </div>
      <div className="molecular-options" role="group" aria-label="Molecule display options">
        <button type="button" aria-pressed={showLigands} className={showLigands ? "active" : ""} onClick={() => setShowLigands((value) => !value)}>Ligands</button>
        <button type="button" aria-pressed={showWaters} className={showWaters ? "active" : ""} onClick={() => setShowWaters((value) => !value)}>Waters</button>
        <button type="button" aria-pressed={spin} className={spin ? "active" : ""} onClick={() => setSpin((value) => !value)}>Spin</button>
      </div>
      <div className="structure-controls"><Button variant="secondary" size="icon" title="Reset view" aria-label="Reset view" onClick={() => stageRef.current?.resetCamera()}><RotateCcw/></Button><Button variant="secondary" size="icon" title="Zoom in" aria-label="Zoom in" onClick={() => stageRef.current?.zoom(0.8)}><Plus/></Button><Button variant="secondary" size="icon" title="Zoom out" aria-label="Zoom out" onClick={() => stageRef.current?.zoom(1.25)}><Minus/></Button><Button variant="secondary" size="icon" title="Save image (PNG)" aria-label="Save image (PNG)" disabled={!ready || saving === "Saving image…"} onClick={() => void saveImage()}><Camera/></Button></div>
      <div className="molstar-footer">
        <span className="structure-badge">{label}{ready ? ` · ${residues.length} residues · ${chainCount || 1} chain${chainCount === 1 ? "" : "s"}` : ""}</span>
        <div className="confidence-legend molecular-status">
          <ColourLegend color={color}/>
          <small role="status">{saving ?? (picked ? `${threeLetter(picked.compId)} ${picked.authSeqId}${picked.insCode} · chain ${picked.authAsymId}` : "Drag to rotate · scroll to zoom · click a residue to identify it")}</small>
        </div>
      </div>
    </div>
    <SequenceStrip residues={residues} hovered={hovered} picked={picked} regionKeys={regionKeys} onHover={hoverFromStrip} onPick={pickFromStrip}/>
  </div>;
}

/** What the current colouring means; the swatches follow Mol*'s own colour themes. */
function ColourLegend({ color }: { color: StageColor }) {
  if (color === "plddt-confidence") return <><span><i className="very-high"/>Very high (&gt;90)</span><span><i className="confident"/>Confident</span><span><i className="low"/>Low</span><span><i className="very-low"/>Very low (&lt;50)</span></>;
  if (color === "secondary-structure") return <span className="legend-entries">{SECONDARY_STRUCTURE_LEGEND.map((entry) => <span key={entry.key}><i className="legend-swatch" style={{ background: entry.color }}/>{entry.label}</span>)}</span>;
  if (color === "hydrophobicity") return <span title={HYDROPHOBICITY_SCALE.source}>{HYDROPHOBICITY_SCALE.from}<i className="hydrophobicity-scale" style={{ background: `linear-gradient(90deg, ${HYDROPHOBICITY_SCALE.colors.join(", ")})` }}/>{HYDROPHOBICITY_SCALE.to}</span>;
  return <span className="comic-label">{COLORS.find((item) => item.id === color)?.label}</span>;
}

/** One cell per modelled polymer residue, grouped by chain, in sync with the 3D view. */
function SequenceStrip({ residues, hovered, picked, regionKeys, onHover, onPick }: { residues: StageResidue[]; hovered: string | null; picked: StageResidue | null; regionKeys: Set<string>; onHover(residue: StageResidue | null): void; onPick(residue: StageResidue): void }) {
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
  return <div className="sequence-strip" role="listbox" tabIndex={0} aria-label="Sequence of the modelled residues. Use the arrow keys to move, Enter to focus a residue." aria-activedescendant={active ? cellId(residueKey(active.labelAsymId, active.labelSeqId)) : undefined} onKeyDown={onKeyDown} onMouseLeave={() => onHover(null)} onBlur={() => onHover(null)}>
    {chains.map((group) => <div className="sequence-chain" key={group.chain}>
      <span className="sequence-chain-label">Chain {group.label}</span>
      {group.items.map(({ residue, index, gap }) => {
        const key = residueKey(residue.labelAsymId, residue.labelSeqId);
        return <span key={key} className="sequence-run">
          {gap > 0 && <span className="sequence-gap" title={`${gap} residue${gap === 1 ? "" : "s"} not modelled`}>···</span>}
          {(residue.authSeqId % 10 === 0) && <span className="sequence-number" aria-hidden="true">{residue.authSeqId}</span>}
          <span id={cellId(key)} role="option" aria-selected={key === pickedKey} aria-label={`${threeLetter(residue.compId)} ${residue.authSeqId}${residue.insCode} chain ${residue.authAsymId}`} title={`${threeLetter(residue.compId)} ${residue.authSeqId}${residue.insCode} · chain ${residue.authAsymId}`}
            className={["sequence-cell", regionKeys.has(key) ? "in-region" : "", key === hovered ? "hovered" : "", key === pickedKey ? "picked" : "", index === cursor ? "cursor" : ""].filter(Boolean).join(" ")}
            onMouseEnter={() => onHover(residue)} onClick={() => { setCursor(index); onPick(residue); }}>{residue.code}</span>
        </span>;
      })}
    </div>)}
  </div>;
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
