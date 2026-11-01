// 2D ligand drawings from the engine (protein-labs/backend/STRUCTURE_API.md,
// "2D ligand depiction") and the pure logic that keeps them in sync with the
// 3D view. The engine draws the molecule, perceives R/S and E/Z, and maps every
// drawn atom to its deposited PDB atom name; nothing here re-derives those.

import type { StructureLigand, StructureRegion } from "./structure-regions.ts";

export type WedgeBond = { from: string; to: string; style: "wedge" | "hash" };
export type CcdDisagreement = { pdbAtomName: string; deposited: string | null; ccd: string };

export type LigandDepiction = {
  source: string;
  structureId: string;
  ligand: { ccdId: string; chainId: string; authSeqId: string; insertionCode: string | null };
  svg: string;
  /** RDKit atom index (as a string) → deposited `label_atom_id`. */
  atomIndexToPdbAtomName: Record<string, string>;
  /** RDKit atom index → [x, y] in the SVG viewBox. Engines before HOM-307 leave it out. */
  atomCoordinates?: Record<string, [number, number]>;
  bondIndexToPdbAtomNames: Record<string, [string, string]>;
  stereo: {
    method: string;
    cipLabels: Record<string, string>;
    doubleBondLabels: Record<string, string>;
    wedgeBonds: WedgeBond[];
    ccdDisagreements: CcdDisagreement[];
  };
  references?: { label: string; url: string }[];
};

/** One ligand instance, in author numbering as the engine and the PDB name it. */
export type LigandInstance = { ccdId: string; name: string | null; chainId: string; labelChainId: string; authSeqId: string; insertionCode: string | null };

/** What a click in the 3D view landed on, when it is an atom of a non-polymer residue. */
export type PickedLigandAtom = { chainId: string; authSeqId: string; insertionCode: string | null; ccdId: string; atomName: string };

export type DepictionAtom = { index: number; name: string; x: number; y: number; cip: string | null; disagreement: CcdDisagreement | null };

export function ligandKey(ligand: Pick<LigandInstance, "ccdId" | "chainId" | "authSeqId" | "insertionCode">) {
  return `${ligand.chainId}:${ligand.authSeqId}${ligand.insertionCode ?? ""}:${ligand.ccdId}`;
}

/** "HEM 154 · chain A", as the PDB labels a ligand instance. */
export function ligandLabel(ligand: Pick<LigandInstance, "ccdId" | "chainId" | "authSeqId" | "insertionCode">) {
  return `${ligand.ccdId} ${ligand.authSeqId}${ligand.insertionCode ?? ""} · chain ${ligand.chainId}`;
}

/** The query string the depiction endpoint expects for one instance. */
export function depictionQuery(ligand: Pick<LigandInstance, "ccdId" | "chainId" | "authSeqId" | "insertionCode">) {
  const query = new URLSearchParams({ chainId: ligand.chainId, authSeqId: ligand.authSeqId, ccdId: ligand.ccdId });
  if (ligand.insertionCode) query.set("insertionCode", ligand.insertionCode);
  return query.toString();
}

/** Ligands worth drawing: real ligands always, waters never, additives only when the user lists them. */
export function drawableLigands(ligands: StructureLigand[], options: { showAdditives?: boolean } = {}): LigandInstance[] {
  const seen = new Set<string>();
  const result: LigandInstance[] = [];
  for (const item of ligands) {
    if (item.classification === "water" || (item.classification !== "ligand" && !options.showAdditives)) continue;
    const ligand = { ccdId: item.ccdId, name: item.name ?? null, chainId: item.chainId, labelChainId: item.labelChainId, authSeqId: String(item.authSeqId), insertionCode: item.insertionCode || null };
    const key = ligandKey(ligand);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(ligand);
  }
  return result;
}

/** The ligand instance a binding-site region is about, or null for every other region. */
export function regionLigand(region: StructureRegion | null): LigandInstance | null {
  const meta = region?.metadata ?? {};
  if (region?.type !== "ligand_binding_site" || typeof meta.ccdId !== "string" || typeof meta.chainId !== "string" || meta.authSeqId == null) return null;
  return {
    ccdId: meta.ccdId, name: typeof meta.name === "string" ? meta.name : null, chainId: meta.chainId,
    labelChainId: typeof meta.labelChainId === "string" ? meta.labelChainId : meta.chainId,
    authSeqId: String(meta.authSeqId), insertionCode: typeof meta.insertionCode === "string" && meta.insertionCode ? meta.insertionCode : null,
  };
}

/** The binding-site region for a ligand instance, so picking it in 3D also highlights its contacts. */
export function regionForLigand(regions: StructureRegion[], ligand: LigandInstance): StructureRegion | null {
  const key = ligandKey(ligand);
  return regions.find((region) => { const item = regionLigand(region); return item !== null && ligandKey(item) === key; }) ?? null;
}

/** Matches a 3D click to a listed instance. Unlisted ones (waters, an entry the engine left out) are not drawn. */
export function ligandForPick(ligands: LigandInstance[], pick: PickedLigandAtom): LigandInstance | null {
  const key = ligandKey(pick);
  return ligands.find((ligand) => ligandKey(ligand) === key) ?? null;
}

/** Each drawn atom with its PDB name, its point in the drawing and any R/S label. */
export function depictionAtoms(depiction: LigandDepiction): DepictionAtom[] {
  const coordinates = depiction.atomCoordinates ?? {};
  const disagreements = new Map(depiction.stereo.ccdDisagreements.map((item) => [item.pdbAtomName, item]));
  return Object.entries(depiction.atomIndexToPdbAtomName)
    .map(([index, name]) => {
      const point = coordinates[index];
      return { index: Number(index), name, x: point?.[0] ?? Number.NaN, y: point?.[1] ?? Number.NaN, cip: depiction.stereo.cipLabels[index] ?? null, disagreement: disagreements.get(name) ?? null };
    })
    .sort((a, b) => a.index - b.index);
}

/** The atom nearest a point in drawing units, if one is within `radius`. */
export function nearestAtom(atoms: DepictionAtom[], x: number, y: number, radius: number): DepictionAtom | null {
  let best: DepictionAtom | null = null;
  let bestDistance = radius;
  for (const atom of atoms) {
    if (!Number.isFinite(atom.x)) continue;
    const distance = Math.hypot(atom.x - x, atom.y - y);
    if (distance <= bestDistance) { best = atom; bestDistance = distance; }
  }
  return best;
}

/** Double bonds with an E/Z label, named by their two PDB atoms. */
export function doubleBondLabels(depiction: LigandDepiction): { atoms: [string, string]; label: string }[] {
  return Object.entries(depiction.stereo.doubleBondLabels).flatMap(([index, label]) => {
    const atoms = depiction.bondIndexToPdbAtomNames[index];
    return atoms ? [{ atoms, label }] : [];
  });
}

/** The drawing's viewBox, so overlays share its coordinates. */
export function svgViewBox(svg: string): { width: number; height: number } {
  const match = /viewBox=['"]\s*[-\d.]+\s+[-\d.]+\s+([\d.]+)\s+([\d.]+)\s*['"]/.exec(svg);
  return match ? { width: Number(match[1]), height: Number(match[2]) } : { width: 500, height: 350 };
}

/** The SVG as an image source. An <img> never runs scripts, so the engine's markup is shown without being trusted. */
export function svgDataUri(svg: string) {
  return `data:image/svg+xml;charset=utf-8,${encodeURIComponent(svg)}`;
}

/** Short reason when the engine cannot draw an instance, in words a student can act on. */
export function depictionErrorHint(message: string, source: string | null) {
  if (source === "alphafold_db" || /alphafold/i.test(message)) return "AlphaFold models contain no ligands. Load an experimental PDB entry to draw one.";
  if (/missing|absent|no coordinates/i.test(message)) return "Some atoms of this ligand were not modelled in the deposited structure, so its stereochemistry cannot be read from it.";
  if (/no ligand instance matches/i.test(message)) return "This ligand instance is not in the deposited file the engine downloaded. Reload the structure and pick it again.";
  if (/no definition|not found|404/i.test(message)) return "The PDB Chemical Component Dictionary has no entry for this code, so there is no reference drawing.";
  if (/unavailable|timed out|502|connection/i.test(message)) return "The PDB Chemical Component Dictionary could not be reached. Check the internet connection and try again.";
  return null;
}
