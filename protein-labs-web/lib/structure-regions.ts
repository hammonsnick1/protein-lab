// Structure Viewer data from the engine (HOM-126, protein-labs/backend/STRUCTURE_API.md)
// and the pure logic that turns it into the regions-of-interest dropdown and
// into residue selections for the 3D view. The engine computes every region
// and residue mapping; nothing here infers a position the engine left null.

export type StructureSource = "pdb" | "alphafold_db";

export type StructureApiError = { source: string; code: string; message: string; retryable: boolean };

export type StructureChain = { chainId: string; labelChainId: string; residueCount: number; modeledResidueCount: number };

export type StructureLigand = { ccdId: string; name?: string | null; chainId: string; labelChainId: string; authSeqId: string; insertionCode: string | null; classification: string };

export type StructureEntry = {
  id: string;
  source: StructureSource;
  format: string;
  title?: string | null;
  method?: string | null;
  resolutionAngstrom?: number | null;
  chains: StructureChain[];
  ligands: StructureLigand[];
  accession?: string | null;
  siftsAvailable?: boolean;
  mappedChains?: string[];
  sourceUrl?: string | null;
};

export type StructureListResponse = { proteinId: string; referenceAccession: string | null; structures: StructureEntry[]; errors: StructureApiError[] };

/** One residue in construct, UniProt and structure numbering. Unmapped values are null. */
export type MappedResidue = {
  constructPosition: number | null;
  uniprotPosition: number | null;
  chainId: string | null;
  labelChainId: string | null;
  labelSeqId: number | null;
  authSeqId: string | null;
  insertionCode: string | null;
  constructResidue?: string | null;
  uniprotResidue?: string | null;
  structureResidue?: string | null;
  modeled?: boolean;
  mismatch?: boolean;
};

export type StructureDetail = StructureEntry & { structureText: string; mapping?: { residues: MappedResidue[] } };

export type RegionType =
  | "cysteines" | "disulfide"
  | "hydrophobic_sequence" | "hydrophobic_surface"
  | "disorder_uniprot" | "disorder_low_plddt"
  | "ligand_binding_site"
  | "reference_ptm" | "reference_binding_site" | "reference_domain" | "reference_transmembrane";

export type StructureRegion = {
  id: string;
  type: RegionType | string;
  label: string;
  description: string;
  defaultVisible: boolean;
  residues: MappedResidue[];
  metadata: Record<string, unknown>;
};

export type RegionsResponse = { parameters?: Record<string, unknown>; groups: StructureRegion[]; errors: StructureApiError[] };

/** Dropdown sections, in the order a scientist usually works through them. */
export const REGION_SECTIONS: { key: string; label: string; types: string[] }[] = [
  { key: "cysteines", label: "Cysteines and disulfides", types: ["cysteines", "disulfide"] },
  { key: "ligands", label: "Ligand binding sites", types: ["ligand_binding_site"] },
  { key: "hydrophobic", label: "Hydrophobic regions", types: ["hydrophobic_sequence", "hydrophobic_surface"] },
  { key: "disorder", label: "Disordered regions", types: ["disorder_uniprot", "disorder_low_plddt"] },
  { key: "reference", label: "Reference match features", types: ["reference_ptm", "reference_binding_site", "reference_domain", "reference_transmembrane"] },
];

export type RegionSection = { key: string; label: string; regions: StructureRegion[] };

const HIDDEN_LIGAND_CLASSES = new Set(["water", "common_additive"]);

/** True for waters and crystallisation additives, which the engine lists but marks off by default. */
export function isAdditive(region: StructureRegion) {
  return region.type === "ligand_binding_site" && HIDDEN_LIGAND_CLASSES.has(String(region.metadata?.classification ?? ""));
}

/** Groups engine regions into dropdown sections; empty sections are dropped. */
export function regionSections(regions: StructureRegion[], options: { showAdditives?: boolean } = {}): RegionSection[] {
  const visible = regions.filter((region) => options.showAdditives || !isAdditive(region));
  const sections = REGION_SECTIONS.map((section) => ({ key: section.key, label: section.label, regions: visible.filter((region) => section.types.includes(region.type)) }));
  const known = new Set(REGION_SECTIONS.flatMap((section) => section.types));
  const other = visible.filter((region) => !known.has(region.type));
  if (other.length) sections.push({ key: "other", label: "Other regions", regions: other });
  return sections.filter((section) => section.regions.length > 0);
}

/** The id of the region `delta` steps from `currentId` in dropdown order, wrapping at both ends. */
export function stepRegion(sections: RegionSection[], currentId: string | null, delta: 1 | -1): string | null {
  const order = sections.flatMap((section) => section.regions.map((region) => region.id));
  if (!order.length) return null;
  const index = currentId ? order.indexOf(currentId) : -1;
  if (index < 0) return delta > 0 ? order[0] : order[order.length - 1];
  return order[(index + delta + order.length) % order.length];
}

/** A residue address the 3D view can select without ambiguity: mmCIF label_asym_id + label_seq_id. */
export type ResidueAddress = { labelAsymId: string; labelSeqId: number };
/** A ligand instance. Non-polymer residues have no label_seq_id, so they are addressed by auth_seq_id. */
export type LigandAddress = { labelAsymId: string; authSeqId: string; insertionCode: string | null; compId: string };

export type RegionSelection = {
  residues: ResidueAddress[];
  ligand: LigandAddress | null;
  /** "mapped": every listed residue is in the model. "partial": some positions are not. "unmapped": nothing to highlight. */
  status: "mapped" | "partial" | "unmapped";
  /** Positions the engine reported as outside the model or in an alignment gap. */
  unmappedCount: number;
};

export function residueKey(labelAsymId: string, labelSeqId: number) { return `${labelAsymId}:${labelSeqId}`; }

/** Converts an engine region into the residues to highlight. Residues without structure numbering are never guessed. */
export function regionSelection(region: StructureRegion): RegionSelection {
  const seen = new Set<string>();
  const residues: ResidueAddress[] = [];
  let unaddressable = 0;
  for (const row of region.residues ?? []) {
    if (row.modeled === false || !row.labelChainId || typeof row.labelSeqId !== "number") { unaddressable += 1; continue; }
    const key = residueKey(row.labelChainId, row.labelSeqId);
    if (seen.has(key)) continue;
    seen.add(key);
    residues.push({ labelAsymId: row.labelChainId, labelSeqId: row.labelSeqId });
  }
  const meta = region.metadata ?? {};
  const ligand = region.type === "ligand_binding_site" && typeof meta.labelChainId === "string" && meta.authSeqId != null && typeof meta.ccdId === "string"
    ? { labelAsymId: meta.labelChainId, authSeqId: String(meta.authSeqId), insertionCode: typeof meta.insertionCode === "string" && meta.insertionCode ? meta.insertionCode : null, compId: meta.ccdId }
    : null;
  // The engine drops unmodelled rows today; `unmappedPositions` is the field
  // requested on HOM-126 so a partly mapped region can say what it left out.
  const reported = Array.isArray(meta.unmappedPositions) ? meta.unmappedPositions.length : 0;
  const unmappedCount = unaddressable + reported;
  const status = !residues.length && !ligand ? "unmapped" : unmappedCount > 0 ? "partial" : "mapped";
  return { residues, ligand, status, unmappedCount };
}

const THREE_LETTER: Record<string, string> = { A: "Ala", R: "Arg", N: "Asn", D: "Asp", C: "Cys", E: "Glu", Q: "Gln", G: "Gly", H: "His", I: "Ile", L: "Leu", K: "Lys", M: "Met", F: "Phe", P: "Pro", S: "Ser", T: "Thr", W: "Trp", Y: "Tyr", V: "Val" };

/** "Cys 42A · chain B" in the structure's author numbering, as scientists read it on the PDB. */
export function residueLabel(row: MappedResidue) {
  const name = THREE_LETTER[String(row.structureResidue ?? "").toUpperCase()] ?? (row.structureResidue || "Residue");
  return `${name} ${row.authSeqId ?? "?"}${row.insertionCode ?? ""}${row.chainId ? ` · chain ${row.chainId}` : ""}`;
}

/** Short title for the structure picker. */
export function structureOptionLabel(entry: StructureEntry) {
  if (entry.source === "alphafold_db") return `AlphaFold model · ${entry.id}`;
  const parts = [entry.id, entry.method ? readableMethod(entry.method) : "", typeof entry.resolutionAngstrom === "number" ? `${entry.resolutionAngstrom.toFixed(2)} Å` : ""];
  const ligands = entry.ligands.filter((ligand) => !HIDDEN_LIGAND_CLASSES.has(ligand.classification));
  if (ligands.length) parts.push(`${ligands.length} ligand${ligands.length === 1 ? "" : "s"}`);
  return parts.filter(Boolean).join(" · ");
}

/** RCSB methods arrive upper-case ("X-RAY DIFFRACTION"); mixed-case names such as AlphaFold stay as they are. */
export function readableMethod(value: string) { return value === value.toUpperCase() ? value.charAt(0) + value.slice(1).toLowerCase() : value; }
