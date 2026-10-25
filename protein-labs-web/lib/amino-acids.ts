// Reference data for the 20 standard amino acids, shown when a residue is
// clicked in the Protein properties composition table (HOM-213).
//
// Sources:
// - Average residue masses: Biopython's IUPAC average masses, the values the
//   engine's ProtParam sums (free amino acid = residue + H2O).
// - Hydropathy: Kyte J, Doolittle RF (1982) J Mol Biol 157:105–132.
// - pKa values of the free amino acids at 25 °C: Nelson DL, Cox MM,
//   Lehninger Principles of Biochemistry, Table 3-1.
// - Secondary-structure propensities Pα, Pβ, Pturn: Chou PY, Fasman GD
//   (1978) Adv Enzymol 47:45–148. 1.00 is the average residue.
// - 280 nm molar absorptivities quoted in the facts: Pace CN et al. (1995)
//   Protein Sci 4:2411–2423.
//
// Structures are 2D skeletal drawings on a unit bond length, neutral forms,
// laid out on a hexagonal grid: backbone across the top, side chain below.

export type SideChainClass = "aliphatic" | "aromatic" | "polar" | "acidic" | "basic" | "sulfur" | "special";
export type TypicalLocation = "buried" | "surface" | "either";

export const sideChainClassLabels: Record<SideChainClass, string> = {
  aliphatic: "Aliphatic",
  aromatic: "Aromatic",
  polar: "Polar uncharged",
  acidic: "Acidic",
  basic: "Basic",
  sulfur: "Sulfur-containing",
  special: "Special (G/P)",
};
/** Legend and colour order for the composition bars. */
export const sideChainClassOrder: SideChainClass[] = ["aliphatic", "aromatic", "polar", "acidic", "basic", "sulfur", "special"];

export const locationLabels: Record<TypicalLocation, string> = {
  buried: "Mostly buried in the core",
  surface: "Mostly on the surface",
  either: "Both buried and exposed",
};

export type StructureAtom = {
  id: string;
  x: number;
  y: number;
  /** Heteroatom or terminal group text; carbons are bare vertices. */
  label?: string;
  sideChain?: boolean;
};
export type StructureBond = {
  from: string;
  to: string;
  order?: 1 | 2;
  /** A ring centre: the second line of a double bond is drawn toward it. */
  inside?: [number, number];
};
export type ResidueStructure = { atoms: StructureAtom[]; bonds: StructureBond[] };

export type AminoAcid = {
  code: string;
  three: string;
  name: string;
  /** Primary class, used to colour the composition bars. */
  family: SideChainClass;
  classes: SideChainClass[];
  /** Average mass of the residue in a chain (Da). */
  residueMassDa: number;
  kyteDoolittle: number;
  pKaCarboxyl: number;
  pKaAmino: number;
  /** Side-chain pKa of the free amino acid; null when the side chain does not ionize. */
  pKaSideChain: number | null;
  sideChainGroup?: string;
  location: TypicalLocation;
  locationNote: string;
  chouFasman: { helix: number; sheet: number; turn: number };
  facts: string[];
  structure: ResidueStructure;
};

/** Average mass of water (Da): a free amino acid weighs its residue mass plus one water. */
export const waterMassDa = 18.01528;

const h = 0.866;
const backbone = (nLabel = "H₂N"): StructureAtom[] => [
  { id: "N", x: -1, y: 0, label: nLabel },
  { id: "CA", x: 0, y: 0 },
  { id: "C", x: 0.5, y: -h },
  { id: "O", x: 1.5, y: -h, label: "O" },
  { id: "OXT", x: 0, y: -2 * h, label: "OH" },
];
const backboneBonds: StructureBond[] = [
  { from: "N", to: "CA" },
  { from: "CA", to: "C" },
  { from: "C", to: "O", order: 2 },
  { from: "C", to: "OXT" },
];
/** A residue built on the standard backbone; the side chain hangs from Cα. */
function residue(side: StructureAtom[], sideBonds: StructureBond[]): ResidueStructure {
  return {
    atoms: [...backbone(), ...side.map((atom) => ({ ...atom, sideChain: true }))],
    bonds: [...backboneBonds, ...sideBonds],
  };
}
const cb: StructureAtom = { id: "CB", x: 0.5, y: h };
const cg: StructureAtom = { id: "CG", x: 0, y: 2 * h };
const caCb: StructureBond = { from: "CA", to: "CB" };
const cbCg: StructureBond = { from: "CB", to: "CG" };

// Six-membered ring hanging from CG (Phe, Tyr), centre one bond further on.
const benzeneCentre: [number, number] = [-0.5, 3 * h];
const benzene: StructureAtom[] = [
  { id: "CD1", x: 0.5, y: 3 * h },
  { id: "CE1", x: 0, y: 4 * h },
  { id: "CZ", x: -1, y: 4 * h },
  { id: "CE2", x: -1.5, y: 3 * h },
  { id: "CD2", x: -1, y: 2 * h },
];
const benzeneBonds: StructureBond[] = [
  { from: "CG", to: "CD1", order: 2, inside: benzeneCentre },
  { from: "CD1", to: "CE1" },
  { from: "CE1", to: "CZ", order: 2, inside: benzeneCentre },
  { from: "CZ", to: "CE2" },
  { from: "CE2", to: "CD2", order: 2, inside: benzeneCentre },
  { from: "CD2", to: "CG" },
];
// Five-membered ring hanging from CG (His, Trp): a regular pentagon, edge 1.
const pentagonCentre: [number, number] = [-0.4253, 2.4687];
const pentagon = { right: [0.4067, 2.6457], bottom: [-0.3364, 3.3147], left: [-1.2024, 2.8147], top: [-0.9945, 1.8365] } as const;
// Benzene fused on Trp's CD2–CE2 edge.
const indoleCentre: [number, number] = [0.6146, 3.6237];

const proline: ResidueStructure = {
  atoms: [
    ...backbone("HN"),
    { id: "CB", x: 0.309, y: 0.9511, sideChain: true },
    { id: "CG", x: -0.5, y: 1.5389, sideChain: true },
    { id: "CD", x: -1.309, y: 0.9511, sideChain: true },
  ],
  bonds: [...backboneBonds, caCb, cbCg, { from: "CG", to: "CD" }, { from: "CD", to: "N" }],
};

export const aminoAcids: AminoAcid[] = [
  {
    code: "A", three: "Ala", name: "Alanine", family: "aliphatic", classes: ["aliphatic"],
    residueMassDa: 71.0779, kyteDoolittle: 1.8,
    pKaCarboxyl: 2.34, pKaAmino: 9.69, pKaSideChain: null,
    location: "either", locationNote: "Small enough to sit comfortably in the core or on the surface.",
    chouFasman: { helix: 1.42, sheet: 0.83, turn: 0.66 },
    facts: [
      "One of the strongest helix formers; a methyl side chain adds no bulk or charge.",
      "Alanine scanning mutates residues one at a time to Ala to find which side chains matter for binding.",
      "Made from pyruvate in one transamination step, linking it directly to glycolysis.",
    ],
    structure: residue([cb], [caCb]),
  },
  {
    code: "C", three: "Cys", name: "Cysteine", family: "sulfur", classes: ["sulfur", "polar"],
    residueMassDa: 103.1429, kyteDoolittle: 2.5,
    pKaCarboxyl: 1.96, pKaAmino: 10.28, pKaSideChain: 8.18, sideChainGroup: "thiol",
    location: "buried", locationNote: "Usually buried; surface cysteines are reactive and often paired in disulfides.",
    chouFasman: { helix: 0.70, sheet: 1.19, turn: 1.19 },
    facts: [
      "Two cysteines oxidize to a disulfide bond (cystine) that staples extracellular proteins together.",
      "A cystine adds about 125 M⁻¹ cm⁻¹ to the 280 nm extinction coefficient; reduced cysteine adds almost nothing.",
      "Its thiol reacts with maleimides and iodoacetamide, the usual handle for site-specific labelling.",
    ],
    structure: residue([cb, { id: "SG", x: 0, y: 2 * h, label: "SH" }], [caCb, { from: "CB", to: "SG" }]),
  },
  {
    code: "D", three: "Asp", name: "Aspartic acid", family: "acidic", classes: ["acidic"],
    residueMassDa: 115.0874, kyteDoolittle: -3.5,
    pKaCarboxyl: 1.88, pKaAmino: 9.60, pKaSideChain: 3.65, sideChainGroup: "β-carboxyl",
    location: "surface", locationNote: "Negatively charged at pH 7, so it faces the solvent or pairs with a cation.",
    chouFasman: { helix: 1.01, sheet: 0.54, turn: 1.46 },
    facts: [
      "The aspartate of the Ser–His–Asp catalytic triad orients the histidine in serine proteases.",
      "Asp–Pro peptide bonds are unusually acid-labile, so they can break during harsh sample prep.",
      "The sweetener aspartame is the methyl ester of the dipeptide Asp–Phe.",
    ],
    structure: residue([cb, cg, { id: "OD1", x: 0.5, y: 3 * h, label: "O" }, { id: "OD2", x: -1, y: 2 * h, label: "OH" }], [caCb, cbCg, { from: "CG", to: "OD1", order: 2 }, { from: "CG", to: "OD2" }]),
  },
  {
    code: "E", three: "Glu", name: "Glutamic acid", family: "acidic", classes: ["acidic"],
    residueMassDa: 129.114, kyteDoolittle: -3.5,
    pKaCarboxyl: 2.19, pKaAmino: 9.67, pKaSideChain: 4.25, sideChainGroup: "γ-carboxyl",
    location: "surface", locationNote: "Charged and flexible; one of the most common residues on protein surfaces.",
    chouFasman: { helix: 1.51, sheet: 0.37, turn: 0.74 },
    facts: [
      "Has the highest helix propensity in the Chou–Fasman table (Pα 1.51).",
      "Sickle-cell haemoglobin is a single Glu → Val change at position 6 of β-globin.",
      "Free glutamate is the main excitatory neurotransmitter and the taste behind umami.",
    ],
    structure: residue([cb, cg, { id: "CD", x: 0.5, y: 3 * h }, { id: "OE1", x: 1.5, y: 3 * h, label: "O" }, { id: "OE2", x: 0, y: 4 * h, label: "OH" }], [caCb, cbCg, { from: "CG", to: "CD" }, { from: "CD", to: "OE1", order: 2 }, { from: "CD", to: "OE2" }]),
  },
  {
    code: "F", three: "Phe", name: "Phenylalanine", family: "aromatic", classes: ["aromatic"],
    residueMassDa: 147.1738, kyteDoolittle: 2.8,
    pKaCarboxyl: 1.83, pKaAmino: 9.13, pKaSideChain: null,
    location: "buried", locationNote: "A bulky hydrophobic ring that packs into the core.",
    chouFasman: { helix: 1.13, sheet: 1.38, turn: 0.60 },
    facts: [
      "Absorbs near 257 nm, so it adds almost nothing to the 280 nm extinction coefficient.",
      "Phenylketonuria (PKU) is the inability to hydroxylate Phe to Tyr, hence the warning on aspartame labels.",
      "Phe rings stack face-to-edge in protein cores, adding stability beyond plain hydrophobicity.",
    ],
    structure: residue([cb, cg, ...benzene], [caCb, cbCg, ...benzeneBonds]),
  },
  {
    code: "G", three: "Gly", name: "Glycine", family: "special", classes: ["special"],
    residueMassDa: 57.0513, kyteDoolittle: -0.4,
    pKaCarboxyl: 2.34, pKaAmino: 9.60, pKaSideChain: null,
    location: "either", locationNote: "Found anywhere, but concentrated in tight turns and flexible loops.",
    chouFasman: { helix: 0.57, sheet: 0.75, turn: 1.56 },
    facts: [
      "The only achiral standard amino acid: its side chain is a single hydrogen.",
      "It can adopt backbone angles no other residue can, which is why it sits in tight turns.",
      "Every third residue of collagen is Gly (Gly–X–Y repeats), letting three chains pack into a triple helix.",
    ],
    structure: residue([{ id: "HA", x: 0.5, y: h, label: "H" }], [{ from: "CA", to: "HA" }]),
  },
  {
    code: "H", three: "His", name: "Histidine", family: "basic", classes: ["basic", "aromatic"],
    residueMassDa: 137.1393, kyteDoolittle: -3.2,
    pKaCarboxyl: 1.82, pKaAmino: 9.17, pKaSideChain: 6.00, sideChainGroup: "imidazole",
    location: "either", locationNote: "Often on the surface, and common in active sites and metal-binding sites.",
    chouFasman: { helix: 1.00, sheet: 0.87, turn: 0.95 },
    facts: [
      "Its imidazole pKa of about 6 sits near physiological pH, making it the classic acid–base catalyst.",
      "A His-tag (6×His) binds Ni²⁺–NTA resin for IMAC purification.",
      "His-tagged proteins are eluted with imidazole, which is the histidine side chain on its own.",
    ],
    structure: residue([cb, cg,
      { id: "ND1", x: pentagon.top[0], y: pentagon.top[1], label: "N" },
      { id: "CE1", x: pentagon.left[0], y: pentagon.left[1] },
      { id: "NE2", x: pentagon.bottom[0], y: pentagon.bottom[1], label: "NH" },
      { id: "CD2", x: pentagon.right[0], y: pentagon.right[1] },
    ], [caCb, cbCg,
      { from: "CG", to: "ND1" },
      { from: "ND1", to: "CE1", order: 2, inside: pentagonCentre },
      { from: "CE1", to: "NE2" },
      { from: "NE2", to: "CD2" },
      { from: "CD2", to: "CG", order: 2, inside: pentagonCentre },
    ]),
  },
  {
    code: "I", three: "Ile", name: "Isoleucine", family: "aliphatic", classes: ["aliphatic"],
    residueMassDa: 113.1576, kyteDoolittle: 4.5,
    pKaCarboxyl: 2.36, pKaAmino: 9.68, pKaSideChain: null,
    location: "buried", locationNote: "The most hydrophobic residue on the Kyte–Doolittle scale; a core residue.",
    chouFasman: { helix: 1.08, sheet: 1.60, turn: 0.47 },
    facts: [
      "Same mass as leucine (113.16 Da), so an intact mass cannot tell Ile from Leu.",
      "Branched at Cβ, which favours extended β-strands over helices.",
      "Has two stereocentres (Cα and Cβ); only one of the four isomers is used in proteins.",
    ],
    structure: residue([cb, { id: "CG2", x: 1.5, y: h }, { id: "CG1", x: 0, y: 2 * h }, { id: "CD1", x: 0.5, y: 3 * h }], [caCb, { from: "CB", to: "CG2" }, { from: "CB", to: "CG1" }, { from: "CG1", to: "CD1" }]),
  },
  {
    code: "K", three: "Lys", name: "Lysine", family: "basic", classes: ["basic"],
    residueMassDa: 128.1723, kyteDoolittle: -3.9,
    pKaCarboxyl: 2.18, pKaAmino: 8.95, pKaSideChain: 10.53, sideChainGroup: "ε-amino",
    location: "surface", locationNote: "A long, charged side chain that almost always reaches the solvent.",
    chouFasman: { helix: 1.16, sheet: 0.74, turn: 1.01 },
    facts: [
      "Ubiquitin is attached through an isopeptide bond to a lysine ε-amino group.",
      "Trypsin cuts after Lys and Arg (unless the next residue is Pro).",
      "Acetylation and methylation of histone lysines help switch genes on and off.",
    ],
    structure: residue([cb, cg, { id: "CD", x: 0.5, y: 3 * h }, { id: "CE", x: 0, y: 4 * h }, { id: "NZ", x: 0.5, y: 5 * h, label: "NH₂" }], [caCb, cbCg, { from: "CG", to: "CD" }, { from: "CD", to: "CE" }, { from: "CE", to: "NZ" }]),
  },
  {
    code: "L", three: "Leu", name: "Leucine", family: "aliphatic", classes: ["aliphatic"],
    residueMassDa: 113.1576, kyteDoolittle: 3.8,
    pKaCarboxyl: 2.36, pKaAmino: 9.60, pKaSideChain: null,
    location: "buried", locationNote: "A core residue, and the most common residue in proteins overall.",
    chouFasman: { helix: 1.21, sheet: 1.30, turn: 0.59 },
    facts: [
      "Usually the most abundant residue in proteins, close to 10% of all residues.",
      "Leucine zippers place a Leu every seventh residue so two helices zip into a coiled coil.",
      "Isobaric with isoleucine; MS/MS side-chain fragments are needed to tell them apart.",
    ],
    structure: residue([cb, cg, { id: "CD1", x: 0.5, y: 3 * h }, { id: "CD2", x: -1, y: 2 * h }], [caCb, cbCg, { from: "CG", to: "CD1" }, { from: "CG", to: "CD2" }]),
  },
  {
    code: "M", three: "Met", name: "Methionine", family: "sulfur", classes: ["sulfur"],
    residueMassDa: 131.196, kyteDoolittle: 1.9,
    pKaCarboxyl: 2.28, pKaAmino: 9.21, pKaSideChain: null,
    location: "buried", locationNote: "A flexible hydrophobic thioether that packs into the core.",
    chouFasman: { helix: 1.45, sheet: 1.05, turn: 0.60 },
    facts: [
      "Encoded by the AUG start codon, so translation begins with Met (formyl-Met in bacteria).",
      "Methionine aminopeptidase removes the initiator Met when the next residue is small.",
      "Easily oxidized to methionine sulfoxide (+16 Da), a common artefact in mass spectra.",
    ],
    structure: residue([cb, cg, { id: "SD", x: 0.5, y: 3 * h, label: "S" }, { id: "CE", x: 0, y: 4 * h }], [caCb, cbCg, { from: "CG", to: "SD" }, { from: "SD", to: "CE" }]),
  },
  {
    code: "N", three: "Asn", name: "Asparagine", family: "polar", classes: ["polar"],
    residueMassDa: 114.1026, kyteDoolittle: -3.5,
    pKaCarboxyl: 2.02, pKaAmino: 8.80, pKaSideChain: null,
    location: "surface", locationNote: "A polar amide on the surface, frequent in turns.",
    chouFasman: { helix: 0.67, sheet: 0.89, turn: 1.56 },
    facts: [
      "The first amino acid ever isolated, from asparagus juice in 1806.",
      "N-linked glycans attach to Asn in the sequon Asn–X–Ser/Thr (X not Pro).",
      "Asn–Gly sequences deamidate to Asp and isoAsp over time, a common cause of protein ageing.",
    ],
    structure: residue([cb, cg, { id: "OD1", x: -1, y: 2 * h, label: "O" }, { id: "ND2", x: 0.5, y: 3 * h, label: "NH₂" }], [caCb, cbCg, { from: "CG", to: "OD1", order: 2 }, { from: "CG", to: "ND2" }]),
  },
  {
    code: "P", three: "Pro", name: "Proline", family: "special", classes: ["special", "aliphatic"],
    residueMassDa: 97.1152, kyteDoolittle: -1.6,
    pKaCarboxyl: 1.99, pKaAmino: 10.96, pKaSideChain: null,
    location: "surface", locationNote: "Mostly in exposed loops and turns, and at the start of helices.",
    chouFasman: { helix: 0.57, sheet: 0.55, turn: 1.52 },
    facts: [
      "Its side chain loops back onto the backbone nitrogen, so it has no N–H to donate to a helix.",
      "Bonds before Pro are cis about 5% of the time; prolyl isomerases speed the slow cis/trans switch in folding.",
      "Collagen is rich in Pro and hydroxyproline, which stiffen its triple helix.",
    ],
    structure: proline,
  },
  {
    code: "Q", three: "Gln", name: "Glutamine", family: "polar", classes: ["polar"],
    residueMassDa: 128.1292, kyteDoolittle: -3.5,
    pKaCarboxyl: 2.17, pKaAmino: 9.13, pKaSideChain: null,
    location: "surface", locationNote: "A polar amide that usually faces the solvent.",
    chouFasman: { helix: 1.11, sheet: 1.10, turn: 0.98 },
    facts: [
      "The most abundant free amino acid in human blood plasma.",
      "An N-terminal Gln cyclizes to pyroglutamate (−17 Da), which blocks Edman sequencing.",
      "Expanded CAG repeats make long polyglutamine tracts, the cause of Huntington's disease.",
    ],
    structure: residue([cb, cg, { id: "CD", x: 0.5, y: 3 * h }, { id: "OE1", x: 1.5, y: 3 * h, label: "O" }, { id: "NE2", x: 0, y: 4 * h, label: "NH₂" }], [caCb, cbCg, { from: "CG", to: "CD" }, { from: "CD", to: "OE1", order: 2 }, { from: "CD", to: "NE2" }]),
  },
  {
    code: "R", three: "Arg", name: "Arginine", family: "basic", classes: ["basic"],
    residueMassDa: 156.1857, kyteDoolittle: -4.5,
    pKaCarboxyl: 2.17, pKaAmino: 9.04, pKaSideChain: 12.48, sideChainGroup: "guanidinium",
    location: "surface", locationNote: "The least hydrophobic residue on the Kyte–Doolittle scale; nearly always exposed.",
    chouFasman: { helix: 0.98, sheet: 0.93, turn: 0.95 },
    facts: [
      "Its guanidinium stays protonated at any pH a protein survives, and forms strong salt bridges with phosphates.",
      "The AGA and AGG codons are rare in E. coli and can stall expression of human genes; Rosetta strains add the tRNAs.",
      "Nitric oxide synthase turns arginine into the signalling gas NO.",
    ],
    structure: residue([cb, cg, { id: "CD", x: 0.5, y: 3 * h }, { id: "NE", x: 0, y: 4 * h, label: "NH" }, { id: "CZ", x: 0.5, y: 5 * h }, { id: "NH1", x: 1.5, y: 5 * h, label: "NH₂" }, { id: "NH2", x: 0, y: 6 * h, label: "NH" }], [caCb, cbCg, { from: "CG", to: "CD" }, { from: "CD", to: "NE" }, { from: "NE", to: "CZ" }, { from: "CZ", to: "NH1" }, { from: "CZ", to: "NH2", order: 2 }]),
  },
  {
    code: "S", three: "Ser", name: "Serine", family: "polar", classes: ["polar"],
    residueMassDa: 87.0773, kyteDoolittle: -0.8,
    pKaCarboxyl: 2.21, pKaAmino: 9.15, pKaSideChain: null,
    location: "surface", locationNote: "Small and polar; common on the surface and in turns.",
    chouFasman: { helix: 0.77, sheet: 0.75, turn: 1.43 },
    facts: [
      "The nucleophile of serine proteases such as trypsin and chymotrypsin.",
      "The most frequently phosphorylated residue in eukaryotic proteins.",
      "Named from the Latin sericum, silk: it was first isolated from the silk protein sericin.",
    ],
    structure: residue([cb, { id: "OG", x: 0, y: 2 * h, label: "OH" }], [caCb, { from: "CB", to: "OG" }]),
  },
  {
    code: "T", three: "Thr", name: "Threonine", family: "polar", classes: ["polar"],
    residueMassDa: 101.1039, kyteDoolittle: -0.7,
    pKaCarboxyl: 2.11, pKaAmino: 9.62, pKaSideChain: null,
    location: "either", locationNote: "Polar but with a methyl group; found both on the surface and partly buried.",
    chouFasman: { helix: 0.83, sheet: 1.19, turn: 0.96 },
    facts: [
      "The last of the 20 standard amino acids to be discovered, by William Rose in 1935.",
      "Branched at Cβ like Val and Ile, so it prefers β-strands.",
      "A phosphorylation and O-glycosylation site, with two stereocentres.",
    ],
    structure: residue([cb, { id: "OG1", x: 1.5, y: h, label: "OH" }, { id: "CG2", x: 0, y: 2 * h }], [caCb, { from: "CB", to: "OG1" }, { from: "CB", to: "CG2" }]),
  },
  {
    code: "V", three: "Val", name: "Valine", family: "aliphatic", classes: ["aliphatic"],
    residueMassDa: 99.131, kyteDoolittle: 4.2,
    pKaCarboxyl: 2.32, pKaAmino: 9.62, pKaSideChain: null,
    location: "buried", locationNote: "A compact hydrophobic residue of the core.",
    chouFasman: { helix: 1.06, sheet: 1.70, turn: 0.50 },
    facts: [
      "Has the highest β-strand propensity in the Chou–Fasman table (Pβ 1.70).",
      "The Val that replaces Glu6 in sickle-cell haemoglobin makes a sticky patch that polymerizes deoxy-HbS.",
      "Named after the valerian plant, through valeric acid.",
    ],
    structure: residue([cb, { id: "CG1", x: 0, y: 2 * h }, { id: "CG2", x: 1.5, y: h }], [caCb, { from: "CB", to: "CG1" }, { from: "CB", to: "CG2" }]),
  },
  {
    code: "W", three: "Trp", name: "Tryptophan", family: "aromatic", classes: ["aromatic"],
    residueMassDa: 186.2099, kyteDoolittle: -0.9,
    pKaCarboxyl: 2.38, pKaAmino: 9.39, pKaSideChain: null,
    location: "buried", locationNote: "Largely buried, and common at membrane–water interfaces.",
    chouFasman: { helix: 1.08, sheet: 1.37, turn: 0.96 },
    facts: [
      "The largest residue and one of the rarest, at about 1.3% of residues.",
      "Dominates absorbance at 280 nm: about 5,500 M⁻¹ cm⁻¹ per Trp, against 1,490 for Tyr.",
      "Its fluorescence (excite at 295 nm, emission near 350 nm) shifts as a protein folds.",
    ],
    structure: residue([cb, cg,
      { id: "CD1", x: pentagon.top[0], y: pentagon.top[1] },
      { id: "NE1", x: pentagon.left[0], y: pentagon.left[1], label: "NH" },
      { id: "CE2", x: pentagon.bottom[0], y: pentagon.bottom[1] },
      { id: "CD2", x: pentagon.right[0], y: pentagon.right[1] },
      { id: "CE3", x: 1.3577, y: 2.9546 },
      { id: "CZ3", x: 1.5657, y: 3.9327 },
      { id: "CH2", x: 0.8225, y: 4.6018 },
      { id: "CZ2", x: -0.1285, y: 4.2928 },
    ], [caCb, cbCg,
      { from: "CG", to: "CD1", order: 2, inside: pentagonCentre },
      { from: "CD1", to: "NE1" },
      { from: "NE1", to: "CE2" },
      { from: "CE2", to: "CD2", order: 2, inside: indoleCentre },
      { from: "CD2", to: "CG" },
      { from: "CD2", to: "CE3" },
      { from: "CE3", to: "CZ3", order: 2, inside: indoleCentre },
      { from: "CZ3", to: "CH2" },
      { from: "CH2", to: "CZ2", order: 2, inside: indoleCentre },
      { from: "CZ2", to: "CE2" },
    ]),
  },
  {
    code: "Y", three: "Tyr", name: "Tyrosine", family: "aromatic", classes: ["aromatic", "polar"],
    residueMassDa: 163.1732, kyteDoolittle: -1.3,
    pKaCarboxyl: 2.20, pKaAmino: 9.11, pKaSideChain: 10.07, sideChainGroup: "phenol",
    location: "either", locationNote: "Amphipathic: the ring packs inward while the hydroxyl reaches water.",
    chouFasman: { helix: 0.69, sheet: 1.47, turn: 1.14 },
    facts: [
      "Each Tyr adds about 1,490 M⁻¹ cm⁻¹ to the 280 nm extinction coefficient.",
      "Receptor tyrosine kinases signal by phosphorylating tyrosine side chains.",
      "Named from the Greek tyros, cheese: it was first found in casein.",
    ],
    structure: residue([cb, cg, ...benzene, { id: "OH", x: -1.5, y: 5 * h, label: "OH" }], [caCb, cbCg, ...benzeneBonds, { from: "CZ", to: "OH" }]),
  },
];

const byCode = new Map(aminoAcids.map((acid) => [acid.code, acid]));
/** The reference entry for a one-letter code, or undefined for non-standard letters. */
export function aminoAcid(code: string): AminoAcid | undefined { return byCode.get(code.toUpperCase()); }

/** The amino-acid family that colours a composition row; "other" for non-standard letters. */
export function residueFamily(code: string): SideChainClass | "other" { return aminoAcid(code)?.family ?? "other"; }

/** The secondary-structure element the residue favours most (Chou–Fasman). */
export function preferredStructure(acid: AminoAcid): "helix" | "sheet" | "turn" {
  const { helix, sheet, turn } = acid.chouFasman;
  return helix >= sheet && helix >= turn ? "helix" : sheet >= turn ? "sheet" : "turn";
}
