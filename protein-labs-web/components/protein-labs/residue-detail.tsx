"use client";

import { ChevronLeft, ChevronRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AminoAcid, locationLabels, ResidueStructure, sideChainClassLabels, sideChainClassOrder, SideChainClass, StructureAtom, waterMassDa } from "@/lib/amino-acids";

/** One composition row: the residue and this protein's count and share. */
export type ResidueShare = { acid: AminoAcid; count: number; percent: number };

const UNIT = 34;

/** Where a bond leaves an atom's text label, so lines stop short of the letters. */
function labelTrim(atom: StructureAtom, dx: number, dy: number) {
  if (!atom.label) return 0;
  const halfWidth = 0.13 * atom.label.length + 0.08, halfHeight = 0.24;
  return Math.min(dx ? halfWidth / Math.abs(dx) : Infinity, dy ? halfHeight / Math.abs(dy) : Infinity);
}

/** A 2D skeletal drawing: backbone in ink, the side chain in its class colour over a halo. */
export function ResidueStructureDrawing({ structure, title }: { structure: ResidueStructure; title: string }) {
  const atoms = new Map(structure.atoms.map((atom) => [atom.id, atom]));
  const xs = structure.atoms.map((atom) => atom.x), ys = structure.atoms.map((atom) => atom.y);
  const pad = 0.75;
  const minX = Math.min(...xs) - pad, minY = Math.min(...ys) - pad;
  const width = Math.max(...xs) + pad - minX, height = Math.max(...ys) + pad - minY;
  const lines = structure.bonds.map((bond) => {
    const a = atoms.get(bond.from)!, b = atoms.get(bond.to)!;
    const length = Math.hypot(b.x - a.x, b.y - a.y), dx = (b.x - a.x) / length, dy = (b.y - a.y) / length;
    const start = labelTrim(a, dx, dy), end = labelTrim(b, dx, dy);
    const x1 = a.x + dx * start, y1 = a.y + dy * start, x2 = b.x - dx * end, y2 = b.y - dy * end;
    const side = Boolean(a.sideChain || b.sideChain);
    const key = `${bond.from}-${bond.to}`;
    const segments: [number, number, number, number][] = [];
    if (bond.order !== 2) segments.push([x1, y1, x2, y2]);
    else if (bond.inside) {
      // Ring double bond: the main line on the ring, a shorter one inside it.
      const [cx, cy] = bond.inside, mx = (a.x + b.x) / 2, my = (a.y + b.y) / 2;
      const toward = Math.sign((cx - mx) * -dy + (cy - my) * dx) || 1, ox = -dy * 0.15 * toward, oy = dx * 0.15 * toward;
      segments.push([x1, y1, x2, y2], [x1 + dx * 0.16 + ox, y1 + dy * 0.16 + oy, x2 - dx * 0.16 + ox, y2 - dy * 0.16 + oy]);
    } else {
      const ox = -dy * 0.07, oy = dx * 0.07;
      segments.push([x1 + ox, y1 + oy, x2 + ox, y2 + oy], [x1 - ox, y1 - oy, x2 - ox, y2 - oy]);
    }
    return { key, side, halo: [a.x, a.y, b.x, b.y], segments };
  });
  return <svg className="residue-structure" viewBox={`${minX} ${minY} ${width} ${height}`} width={width * UNIT} height={height * UNIT} role="img" aria-label={title}>
    <g className="residue-structure-halo">{lines.filter((line) => line.side).map(({ key, halo: [x1, y1, x2, y2] }) => <line key={key} x1={x1} y1={y1} x2={x2} y2={y2}/>)}</g>
    {lines.map(({ key, side, segments }) => <g key={key} className={side ? "residue-structure-side" : "residue-structure-backbone"}>{segments.map(([x1, y1, x2, y2], index) => <line key={index} x1={x1} y1={y1} x2={x2} y2={y2}/>)}</g>)}
    {structure.atoms.filter((atom) => atom.label).map((atom) => <text key={atom.id} x={atom.x} y={atom.y} className={atom.sideChain ? "residue-structure-side" : undefined}>{atom.label}</text>)}
  </svg>;
}

/** A value on a fixed scale with its neutral reference marked, e.g. Chou–Fasman 1.00. */
function ScaleBar({ label, value, min, max, reference, display }: { label: string; value: number; min: number; max: number; reference: number; display: string }) {
  const position = (x: number) => `${((x - min) / (max - min)) * 100}%`;
  const from = Math.min(value, reference), to = Math.max(value, reference);
  return <div className="residue-scale">
    <span><b>{label}</b><small>{display}</small></span>
    <i aria-hidden="true"><em style={{ left: position(from), width: `calc(${position(to)} - ${position(from)})` }}/><u style={{ left: position(reference) }}/></i>
  </div>;
}

function ClassChip({ value }: { value: SideChainClass }) {
  return <span className={`residue-class-chip aa-family-${value}`}><i aria-hidden="true"/>{sideChainClassLabels[value]}</span>;
}

/** The residue detail window opened from the composition table; one residue at a time. */
export function ResidueDetailDialog({ rows, index, onIndexChange, onClose, onReturnFocus }: { rows: ResidueShare[]; index: number | null; onIndexChange: (index: number) => void; onClose: () => void; onReturnFocus?: (code: string) => void }) {
  const row = index === null ? undefined : rows[index];
  const step = (by: number) => { if (index !== null && rows.length) onIndexChange((index + by + rows.length) % rows.length); };
  const previous = index === null ? undefined : rows[(index - 1 + rows.length) % rows.length];
  const next = index === null ? undefined : rows[(index + 1) % rows.length];
  return <Dialog open={Boolean(row)} onOpenChange={(open) => { if (!open) onClose(); }}>
    {row && <DialogContent className="residue-dialog" onCloseAutoFocus={(event) => {
      // Back to the row of the residue last shown, which may differ from the one opened.
      if (onReturnFocus) { event.preventDefault(); onReturnFocus(row.acid.code); }
    }} onKeyDown={(event) => {
      if (event.target instanceof HTMLElement && event.target.closest("input, textarea, select")) return;
      if (event.key === "ArrowLeft") { event.preventDefault(); step(-1); }
      if (event.key === "ArrowRight") { event.preventDefault(); step(1); }
    }}>
      <ResidueDetail row={row}/>
      <DialogFooter className="residue-dialog-footer">
        <small>← → to step through residues · Esc to close</small>
        <Button variant="outline" onClick={() => step(-1)} aria-label={`Previous residue: ${previous?.acid.name}`}><ChevronLeft/> {previous?.acid.three}</Button>
        <Button variant="outline" onClick={() => step(1)} aria-label={`Next residue: ${next?.acid.name}`}>{next?.acid.three} <ChevronRight/></Button>
      </DialogFooter>
    </DialogContent>}
  </Dialog>;
}

function ResidueDetail({ row: { acid, count, percent } }: { row: ResidueShare }) {
  const { helix, sheet, turn } = acid.chouFasman;
  return <div className={`residue-detail aa-family-${acid.family}`}>
    <DialogHeader className="residue-detail-header">
      <span className="residue-letter" aria-hidden="true">{acid.code}</span>
      <div>
        <DialogTitle>{acid.name}</DialogTitle>
        <DialogDescription>{acid.three} · {acid.code}</DialogDescription>
        <div className="residue-class-chips">{sideChainClassOrder.filter((value) => acid.classes.includes(value)).map((value) => <ClassChip key={value} value={value}/>)}</div>
      </div>
    </DialogHeader>
    <div className="residue-detail-body">
      <figure className="residue-structure-card">
        <ResidueStructureDrawing structure={acid.structure} title={`Skeletal structure of ${acid.name}; the side chain is highlighted`}/>
        <figcaption><span className="residue-structure-key" aria-hidden="true"/>Side chain highlighted · neutral form</figcaption>
      </figure>
      <div className="residue-facts">
        <dl className="residue-numbers">
          <div><dt>In this protein</dt><dd>{count} <small>{count === 1 ? "residue" : "residues"}</small> · {percent.toFixed(2)}%</dd></div>
          <div><dt>Residue mass</dt><dd>{acid.residueMassDa.toFixed(2)} <small>Da</small></dd></div>
          <div><dt>Free amino acid</dt><dd>{(acid.residueMassDa + waterMassDa).toFixed(2)} <small>Da</small></dd></div>
          <div><dt>Side-chain pKa</dt><dd>{acid.pKaSideChain === null ? <span className="residue-none">none</span> : <>{acid.pKaSideChain.toFixed(2)} <small>{acid.sideChainGroup}</small></>}</dd></div>
          <div><dt>α-COOH / α-NH₃⁺ pKa</dt><dd>{acid.pKaCarboxyl.toFixed(2)} / {acid.pKaAmino.toFixed(2)}</dd></div>
          <div><dt>Typical location</dt><dd className="residue-text">{locationLabels[acid.location]}</dd></div>
        </dl>
        <p className="residue-location-note">{acid.locationNote}</p>
        <section aria-label="Hydropathy">
          <h3>Hydropathy <small>Kyte–Doolittle, −4.5 (polar) to +4.5 (hydrophobic)</small></h3>
          <ScaleBar label={acid.kyteDoolittle > 0 ? "Hydrophobic" : "Hydrophilic"} value={acid.kyteDoolittle} min={-4.5} max={4.5} reference={0} display={`${acid.kyteDoolittle > 0 ? "+" : ""}${acid.kyteDoolittle.toFixed(1)}`}/>
        </section>
        <section aria-label="Secondary-structure preference">
          <h3>Secondary-structure preference <small>Chou–Fasman, 1.00 = average residue</small></h3>
          <ScaleBar label="α-helix" value={helix} min={0} max={2} reference={1} display={helix.toFixed(2)}/>
          <ScaleBar label="β-strand" value={sheet} min={0} max={2} reference={1} display={sheet.toFixed(2)}/>
          <ScaleBar label="Turn / loop" value={turn} min={0} max={2} reference={1} display={turn.toFixed(2)}/>
        </section>
      </div>
    </div>
    <section className="residue-fun-facts" aria-label="Fun facts">
      <h3>Good to know</h3>
      <ul>{acid.facts.map((fact) => <li key={fact}>{fact}</li>)}</ul>
    </section>
    <p className="residue-sources">pKa: free amino acid at 25 °C (Lehninger, Table 3-1). Hydropathy: Kyte & Doolittle 1982. Propensities: Chou & Fasman 1978. Masses: average, as used by ProtParam.</p>
  </div>;
}

/** Colour key for the composition bars: swatch plus label, never colour alone. */
export function ResidueClassLegend({ present }: { present: Set<SideChainClass | "other"> }) {
  return <ul className="residue-class-legend" aria-label="Side-chain classes">
    {sideChainClassOrder.map((value) => <li key={value} className={`aa-family-${value}${present.has(value) ? "" : " is-absent"}`}><i aria-hidden="true"/>{sideChainClassLabels[value]}</li>)}
    {present.has("other") && <li className="aa-family-other"><i aria-hidden="true"/>Non-standard</li>}
  </ul>;
}
