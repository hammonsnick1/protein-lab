"use client";

import { MouseEvent, useEffect, useMemo, useRef, useState } from "react";
import { CircleAlert, ExternalLink, LoaderCircle, RefreshCw, TriangleAlert, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Cite, CiteGroup, ReferenceList } from "@/components/ui/citations";
import { citationScope } from "@/lib/citations";
import { proteinLabsApi } from "@/lib/protein-labs-api";
import { depictionAtoms, depictionErrorHint, doubleBondLabels, ligandKey, ligandLabel, nearestAtom, svgDataUri, svgViewBox, type LigandDepiction, type LigandInstance } from "@/lib/ligand-depiction";

const REFS = citationScope("ligand-2d", ["rdkit", "ccd", "iupac2006stereo", "cip1966", "iupac2013", "hanson2018cip"]);
/** How far from an atom's centre a click still picks it, in drawing units (bonds are ~60 long). */
const HIT_RADIUS = 16;

type Load = { key: string; state: "loading" | "ready" | "error"; value: LigandDepiction | null; message: string };

export type Ligand2DPanelProps = {
  proteinId: string;
  structureId: string;
  ligands: LigandInstance[];
  ligand: LigandInstance;
  /** PDB atom name selected in either view. */
  atomName: string | null;
  /** PDB atom name under the pointer in the 3D view. */
  hoveredAtomName: string | null;
  onChooseLigand(ligand: LigandInstance): void;
  onPickAtom(atomName: string | null): void;
  onHoverAtom(atomName: string | null): void;
  onClose(): void;
};

/** The deposited ligand drawn in 2D by the engine, linked atom for atom to the 3D view. */
export function Ligand2DPanel({ proteinId, structureId, ligands, ligand, atomName, hoveredAtomName, onChooseLigand, onPickAtom, onHoverAtom, onClose }: Ligand2DPanelProps) {
  const key = `${structureId}|${ligandKey(ligand)}`;
  const [load, setLoad] = useState<Load>({ key, state: "loading", value: null, message: "" });
  const [reload, setReload] = useState(0);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setLoad({ key, state: "loading", value: null, message: "" }); });
    proteinLabsApi.getLigandDepiction(proteinId, structureId, ligand)
      .then((value) => { if (active) setLoad({ key, state: "ready", value, message: "" }); })
      .catch((reason: unknown) => { if (active) setLoad({ key, state: "error", value: null, message: reason instanceof Error ? reason.message : String(reason) }); });
    return () => { active = false; };
    // The key names the instance; the ligand object is rebuilt on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proteinId, key, reload]);
  // Until the new drawing arrives, never show the previous ligand under the new name.
  const current = load.key === key ? load : { key, state: "loading" as const, value: null, message: "" };
  const name = ligand.name ? titleCase(ligand.name) : null;

  return <section className="ligand-2d" aria-labelledby="ligand-2d-title">
    <header className="ligand-2d-head">
      <div>
        <h3 id="ligand-2d-title">2D drawing</h3>
        <p title={ligand.name ?? undefined}>{name ? `${name} · ` : ""}<a href={`https://www.rcsb.org/ligand/${encodeURIComponent(ligand.ccdId)}`} target="_blank" rel="noreferrer">{ligand.ccdId}<ExternalLink aria-hidden="true"/></a></p>
      </div>
      <Button variant="ghost" size="icon" title="Close the 2D drawing" aria-label="Close the 2D drawing" onClick={onClose}><X/></Button>
    </header>
    {ligands.length > 1 && <label className="lab-field ligand-2d-choice"><span>Ligand</span>
      <select value={ligandKey(ligand)} onChange={(event) => { const next = ligands.find((item) => ligandKey(item) === event.target.value); if (next) onChooseLigand(next); }}>
        {ligands.map((item) => <option key={ligandKey(item)} value={ligandKey(item)}>{ligandLabel(item)}{item.name ? ` · ${titleCase(item.name)}` : ""}</option>)}
      </select>
    </label>}
    {current.state === "loading" && <div className="ligand-2d-status" role="status"><LoaderCircle className="spin"/><strong>Drawing {ligandLabel(ligand)}…</strong><small>The engine reads the chemical definition from the PDB the first time; it can take a few seconds.</small></div>}
    {current.state === "error" && <div className="ligand-2d-status error" role="alert"><CircleAlert/><strong>{ligandLabel(ligand)} could not be drawn</strong>
      <small>{depictionErrorHint(current.message, null) ?? current.message}</small>
      {depictionErrorHint(current.message, null) && <small className="ligand-2d-detail">{current.message}</small>}
      <Button variant="outline" size="sm" onClick={() => setReload((value) => value + 1)}><RefreshCw/> Try again</Button>
    </div>}
    {current.state === "ready" && current.value && <Depiction depiction={current.value} atomName={atomName} hoveredAtomName={hoveredAtomName} onPickAtom={onPickAtom} onHoverAtom={onHoverAtom}/>}
    <ReadingHelp/>
    <ReferenceList scope={REFS} className="ligand-2d-refs"/>
  </section>;
}

function Depiction({ depiction, atomName, hoveredAtomName, onPickAtom, onHoverAtom }: { depiction: LigandDepiction; atomName: string | null; hoveredAtomName: string | null; onPickAtom(name: string | null): void; onHoverAtom(name: string | null): void }) {
  const atoms = useMemo(() => depictionAtoms(depiction), [depiction]);
  const box = useMemo(() => svgViewBox(depiction.svg), [depiction.svg]);
  const src = useMemo(() => svgDataUri(depiction.svg), [depiction.svg]);
  const overlay = useRef<SVGSVGElement | null>(null);
  const [pointer, setPointer] = useState<string | null>(null);
  const placed = atoms.some((atom) => Number.isFinite(atom.x));
  const selected = atoms.find((atom) => atom.name === atomName) ?? null;
  const centres = atoms.filter((atom) => atom.cip);
  const doubles = doubleBondLabels(depiction);
  const disagreements = depiction.stereo.ccdDisagreements;
  const hovered = pointer ?? hoveredAtomName;

  function atomAt(event: MouseEvent<SVGSVGElement>) {
    const matrix = overlay.current?.getScreenCTM();
    if (!matrix) return null;
    const point = new DOMPoint(event.clientX, event.clientY).matrixTransform(matrix.inverse());
    return nearestAtom(atoms, point.x, point.y, HIT_RADIUS);
  }
  function move(event: MouseEvent<SVGSVGElement>) {
    const name = atomAt(event)?.name ?? null;
    if (name !== pointer) { setPointer(name); onHoverAtom(name); }
  }
  function leave() { if (pointer) { setPointer(null); onHoverAtom(null); } }

  return <>
    <figure className="ligand-2d-figure">
      <div className={`ligand-2d-drawing ${hovered ? "pointing" : ""}`} style={{ aspectRatio: `${box.width} / ${box.height}` }}>
        <img src={src} alt={`2D structure of ${depiction.ligand.ccdId} drawn by RDKit, with wedge and hash bonds and R/S and E/Z labels`} draggable={false}/>
        {placed && <svg ref={overlay} viewBox={`0 0 ${box.width} ${box.height}`} aria-hidden="true" onMouseMove={move} onMouseLeave={leave} onClick={(event) => { const atom = atomAt(event); onPickAtom(atom && atom.name !== atomName ? atom.name : null); }}>
          {atoms.filter((atom) => Number.isFinite(atom.x) && (atom.name === hovered || atom.name === atomName)).map((atom) => <circle key={atom.index} cx={atom.x} cy={atom.y} r={13} className={atom.name === atomName ? "picked" : "hovered"}/>)}
        </svg>}
      </div>
      <figcaption>Drawn by RDKit<Cite scope={REFS} id="rdkit"/> from the PDB Chemical Component Dictionary<Cite scope={REFS} id="ccd"/>, using this instance&apos;s deposited coordinates for its stereochemistry. {placed ? "Click an atom to find it in 3D." : "Pick an atom from the list to find it in 3D."}</figcaption>
    </figure>
    <p className="ligand-2d-selected" role="status">{selected ? <>Atom <strong>{selected.name}</strong>{selected.cip ? <> · stereocentre <strong>{selected.cip}</strong></> : null} · selected in the 3D view</> : "No atom selected. Click one in either view."}</p>
    {disagreements.length > 0 && <div className="inline-message error"><TriangleAlert/> {disagreements.map((item) => `${item.pdbAtomName} is ${item.deposited ?? "unassigned"} in this model but ${item.ccd} in the CCD definition`).join("; ")}. The deposited geometry may be modelled wrongly here; check the density before trusting it.</div>}
    <dl className="ligand-2d-stereo">
      <dt>Stereocentres (R/S)</dt>
      <dd>{centres.length ? centres.map((atom) => <AtomChip key={atom.index} name={atom.name} tag={atom.cip} active={atom.name === atomName} onPick={onPickAtom} onHover={onHoverAtom}/>) : <span className="muted">None declared in the CCD</span>}</dd>
      <dt>Double bonds (E/Z)</dt>
      <dd>{doubles.length ? doubles.map((bond) => <span key={bond.atoms.join("=")} className="ligand-2d-bond">{bond.atoms[0]}={bond.atoms[1]} <strong>{bond.label}</strong></span>) : <span className="muted">None declared in the CCD</span>}</dd>
    </dl>
    <details className="ligand-2d-atoms">
      <summary>All {atoms.length} drawn atoms</summary>
      <div role="group" aria-label="Atoms of this ligand">{atoms.map((atom) => <AtomChip key={atom.index} name={atom.name} tag={atom.cip} active={atom.name === atomName} onPick={onPickAtom} onHover={onHoverAtom}/>)}</div>
    </details>
  </>;
}

function AtomChip({ name, tag, active, onPick, onHover }: { name: string; tag: string | null; active: boolean; onPick(name: string | null): void; onHover(name: string | null): void }) {
  return <button type="button" className={`ligand-2d-atom ${active ? "active" : ""}`} aria-pressed={active} title={active ? `Clear the selection of ${name}` : `Find ${name} in the 3D view`}
    onClick={() => onPick(active ? null : name)} onMouseEnter={() => onHover(name)} onMouseLeave={() => onHover(null)} onFocus={() => onHover(name)} onBlur={() => onHover(null)}>
    {name}{tag && <strong>{tag}</strong>}
  </button>;
}

/** Plain-language help for the notation in the drawing. */
function ReadingHelp() {
  return <details className="ligand-2d-help">
    <summary>How to read this drawing</summary>
    <dl>
      <dt>Lines and corners</dt>
      <dd>Every corner or line end without a letter is a carbon atom. Hydrogens on carbon are left out; each carbon has enough of them to make four bonds. Coloured letters are other elements: N nitrogen, O oxygen, P phosphorus, S sulfur.</dd>
      <dt>Wedge and hash bonds</dt>
      <dd>A plain line lies flat in the page. A solid wedge points <em>towards you</em>, out of the page; a hashed (striped) wedge points <em>away</em>, behind it. The narrow end sits on the stereocentre. Together they show the 3D shape on flat paper<Cite scope={REFS} id="iupac2006stereo"/>.</dd>
      <dt>R and S</dt>
      <dd>A stereocentre is an atom with four different groups attached, so it has a mirror image that cannot be laid on top of it, like a left and a right hand. Rank the four groups by the Cahn–Ingold–Prelog rules: the higher the atomic number of the first atom, the higher the priority, moving outwards to break ties. Turn the molecule so the lowest-ranked group points away from you. If the other three run clockwise from highest to lowest, the centre is <strong>R</strong> (Latin <em>rectus</em>, right); anticlockwise is <strong>S</strong> (<em>sinister</em>, left)<CiteGroup scope={REFS} ids={["cip1966", "iupac2013"]}/>.</dd>
      <dt>E and Z</dt>
      <dd>Atoms cannot rotate around a double bond, so groups on it stay on one side or the other. At each end, pick the higher-priority group by the same rules. If the two are on the same side the bond is <strong>Z</strong> (German <em>zusammen</em>, together); on opposite sides it is <strong>E</strong> (<em>entgegen</em>, opposite)<Cite scope={REFS} id="iupac2013"/>.</dd>
      <dt>Where the labels come from</dt>
      <dd>The engine reads R/S and E/Z from where the atoms sit in this deposited model, using RDKit&apos;s implementation of the current CIP rules<CiteGroup scope={REFS} ids={["rdkit", "hanson2018cip"]}/>. It labels only the centres and double bonds that the Chemical Component Dictionary says are stereo<Cite scope={REFS} id="ccd"/>. If the model disagrees with the dictionary, the panel says so: the ligand may be built wrongly in that entry.</dd>
    </dl>
  </details>;
}

/** CCD names arrive in capitals ("ADENOSINE-5'-TRIPHOSPHATE"); show them in sentence case. */
function titleCase(value: string) { return value === value.toUpperCase() ? value.charAt(0) + value.slice(1).toLowerCase() : value; }
