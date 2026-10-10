export type SecColumn = {
  id: string;
  name: string;
  shortName: string;
  format: string;
  vt: number;
  minKDa: number | null;
  maxKDa: number | null;
  sampleMinMl: number | null;
  sampleMaxMl: number | null;
  recommendedFlowMlMin: number | null;
  phMin: number;
  phMax: number;
  description: string;
  bestFor: string;
  strengths: string;
  cautions: string;
  color: string;
  reference: string;
};

type SecFamily = Pick<SecColumn, "minKDa" | "maxKDa" | "phMin" | "phMax" | "bestFor" | "strengths" | "cautions" | "color"> & {
  label: string;
};

type ColumnSpec = {
  id: string;
  name: string;
  shortName: string;
  format: string;
  vt: number;
  family: SecFamily;
  sampleMinMl?: number;
  sampleMaxMl?: number;
  flowMlMin?: number;
  formatNote: string;
};

const cytivaSec = "Cytiva Size Exclusion Chromatography: Principles and Methods and product instructions for use";

const increase30: SecFamily = {
  label: "Superdex 30 Increase", minKDa: 0.1, maxKDa: 7, phMin: 3, phMax: 12,
  bestFor: "Peptides, oligonucleotides, and very small proteins below about 7 kDa.",
  strengths: "A narrow low-molecular-weight fractionation range gives better discrimination than broad protein SEC media.",
  cautions: "Most folded proteins and complexes will elute near the void; do not select it only from monomer sequence mass.", color: "#22a4d6",
};
const increase75: SecFamily = {
  label: "Superdex 75 Increase", minKDa: 3, maxKDa: 70, phMin: 3, phMax: 12,
  bestFor: "Small globular proteins, monomers, and contaminants in the 3–70 kDa range.",
  strengths: "High resolution for small proteins with well-established calibration behavior.",
  cautions: "Larger oligomers can elute near the void; use a wider-range medium when the native assembly is uncertain.", color: "#3b82f6",
};
const increase200: SecFamily = {
  label: "Superdex 200 Increase", minKDa: 10, maxKDa: 600, phMin: 3, phMax: 12,
  bestFor: "Routine monomer/oligomer separation, aggregate assessment, antibodies, and common soluble protein complexes.",
  strengths: "A versatile fractionation range with high resolution and low nonspecific interaction.",
  cautions: "Very small proteins approach total inclusion and very large assemblies approach the void.", color: "#2563eb",
};
const superose6: SecFamily = {
  label: "Superose 6 Increase", minKDa: 5, maxKDa: 5000, phMin: 3, phMax: 12,
  bestFor: "Large oligomers, antibodies, membrane-protein detergent complexes, viruses, and macromolecular assemblies.",
  strengths: "A very broad globular-protein range with good recovery for large complexes.",
  cautions: "A narrower Superdex medium can resolve small proteins better; viscous detergent or glycerol buffers require lower flow.", color: "#7c3aed",
};
const superose12: SecFamily = {
  label: "Superose 12", minKDa: 1, maxKDa: 300, phMin: 3, phMax: 12,
  bestFor: "Small-to-medium globular proteins when a 1–300 kDa working range is useful.",
  strengths: "Bridges peptide and conventional protein separations with a broad working range.",
  cautions: "This is a legacy medium; verify availability, pressure limits, and the exact instructions for the installed column.", color: "#9b65db",
};
const superdex30Pg: SecFamily = { ...increase30, label: "Superdex 30 prep grade", maxKDa: 10, color: "#0891b2" };
const superdex75Pg: SecFamily = { ...increase75, label: "Superdex 75 prep grade", color: "#0284c7" };
const superdex200Pg: SecFamily = { ...increase200, label: "Superdex 200 prep grade", color: "#0369a1" };
const sephacryl100: SecFamily = {
  label: "Sephacryl S-100 HR", minKDa: 1, maxKDa: 100, phMin: 3, phMax: 11,
  bestFor: "Preparative separation of small proteins and peptides at larger sample volumes.",
  strengths: "A robust preparative medium with useful capacity and economical scale-up.",
  cautions: "Resolution is generally lower than modern small-particle analytical columns; validate the target against the exact product range.", color: "#0f9f8f",
};
const sephacryl200: SecFamily = {
  label: "Sephacryl S-200 HR", minKDa: 5, maxKDa: 250, phMin: 3, phMax: 11,
  bestFor: "Preparative separation of many soluble proteins and medium-sized complexes.",
  strengths: "A practical balance of range, capacity, robustness, and preparative throughput.",
  cautions: "Broad peaks or close species may need a higher-resolution final analytical SEC step.", color: "#0d9488",
};
const sephacryl300: SecFamily = {
  label: "Sephacryl S-300 HR", minKDa: 10, maxKDa: 1500, phMin: 3, phMax: 11,
  bestFor: "Preparative separation of large proteins, oligomers, and macromolecular assemblies.",
  strengths: "A broad high-mass range with robust preparative capacity.",
  cautions: "Small proteins have limited resolving space, and demanding aggregate separation may benefit from Superose 6 Increase.", color: "#0f766e",
};

function makeColumn(spec: ColumnSpec): SecColumn {
  const range = `${spec.family.minKDa}–${spec.family.maxKDa} kDa`;
  return {
    id: spec.id, name: spec.name, shortName: spec.shortName, format: spec.format, vt: spec.vt,
    minKDa: spec.family.minKDa, maxKDa: spec.family.maxKDa,
    sampleMinMl: spec.sampleMinMl ?? null, sampleMaxMl: spec.sampleMaxMl ?? null,
    recommendedFlowMlMin: spec.flowMlMin ?? null, phMin: spec.family.phMin, phMax: spec.family.phMax,
    description: `${spec.format} ${spec.family.label} SEC column for the ${range} globular-protein fractionation range. ${spec.formatNote}`,
    bestFor: spec.family.bestFor,
    strengths: `${spec.family.strengths} ${spec.formatNote}`,
    cautions: `${spec.family.cautions} Fractionation ranges are guides for globular proteins; shape, oligomerization, glycosylation, and detergent micelles change apparent size.`,
    color: spec.family.color, reference: cytivaSec,
  };
}

// The single SEC source used by both purification planning and Chromatogram Studio.
// It is the union of the prepacked columns offered by the earlier Python and Flutter builds.
export const secColumns: SecColumn[] = [
  { id: "custom", name: "Custom column", shortName: "Custom SEC", format: "User-defined", vt: 24, minKDa: null, maxKDa: null, sampleMinMl: null, sampleMaxMl: null, recommendedFlowMlMin: null, phMin: 2, phMax: 13, description: "Define a column that is not in the prepacked Cytiva list.", bestFor: "Existing laboratory columns with locally validated packing and calibration.", strengths: "Supports any resin, geometry, and validated operating method.", cautions: "Enter the correct total column volume and independently verify fractionation range, pressure, sample volume, and pH limits.", color: "#718096", reference: "Local column documentation" },

  makeColumn({ id: "s30-3-2-300", name: "Superdex 30 Increase 3.2/300", shortName: "S30 Increase 3.2/300", format: "Micro analytical", vt: 2.4, family: increase30, sampleMinMl: .004, sampleMaxMl: .05, flowMlMin: .075, formatNote: "The narrow bore minimizes sample and buffer use." }),
  makeColumn({ id: "s75-3-2-300", name: "Superdex 75 Increase 3.2/300", shortName: "S75 Increase 3.2/300", format: "Micro analytical", vt: 2.4, family: increase75, sampleMinMl: .004, sampleMaxMl: .05, flowMlMin: .075, formatNote: "The narrow bore is suited to scarce samples." }),
  makeColumn({ id: "s200-3-2-300", name: "Superdex 200 Increase 3.2/300", shortName: "S200 Increase 3.2/300", format: "Micro analytical", vt: 2.4, family: increase200, sampleMinMl: .004, sampleMaxMl: .05, flowMlMin: .075, formatNote: "The narrow bore is suited to scarce samples." }),
  makeColumn({ id: "superose6-3-2-300", name: "Superose 6 Increase 3.2/300", shortName: "Superose 6 Increase 3.2/300", format: "Micro analytical", vt: 2.4, family: superose6, sampleMinMl: .004, sampleMaxMl: .05, flowMlMin: .04, formatNote: "The narrow bore is suited to scarce high-mass samples." }),
  makeColumn({ id: "superose12-3-2-300", name: "Superose 12 3.2/300", shortName: "Superose 12 3.2/300", format: "Micro analytical", vt: 2.4, family: superose12, sampleMinMl: .004, sampleMaxMl: .05, formatNote: "The narrow bore minimizes sample use." }),

  makeColumn({ id: "s75-5-150", name: "Superdex 75 Increase 5/150 GL", shortName: "S75 Increase 5/150", format: "Rapid analytical screening", vt: 3, family: increase75, sampleMinMl: .004, sampleMaxMl: .05, flowMlMin: .45, formatNote: "The short bed gives fast screening with lower resolution than a 300 mm bed." }),
  makeColumn({ id: "s200-5-150", name: "Superdex 200 Increase 5/150 GL", shortName: "S200 Increase 5/150", format: "Rapid analytical screening", vt: 3, family: increase200, sampleMinMl: .004, sampleMaxMl: .05, flowMlMin: .45, formatNote: "The short bed gives fast screening with lower resolution than a 300 mm bed." }),
  makeColumn({ id: "superose6-5-150", name: "Superose 6 Increase 5/150 GL", shortName: "Superose 6 Increase 5/150", format: "Rapid analytical screening", vt: 3, family: superose6, sampleMinMl: .004, sampleMaxMl: .05, flowMlMin: .2, formatNote: "The short bed gives fast large-complex screening with lower final-polish resolution." }),

  makeColumn({ id: "s30-10-300", name: "Superdex 30 Increase 10/300 GL", shortName: "S30 Increase 10/300", format: "Analytical / small-scale preparative", vt: 24, family: increase30, sampleMinMl: .025, sampleMaxMl: .5, flowMlMin: .8, formatNote: "The 300 mm bed provides high-resolution low-mass separation." }),
  makeColumn({ id: "s75-10-300", name: "Superdex 75 Increase 10/300 GL", shortName: "S75 Increase 10/300", format: "Analytical / small-scale preparative", vt: 24, family: increase75, sampleMinMl: .025, sampleMaxMl: .5, flowMlMin: .8, formatNote: "The 300 mm bed provides high resolution with up to 500 µL sample." }),
  makeColumn({ id: "s200-10-300", name: "Superdex 200 Increase 10/300 GL", shortName: "S200 Increase 10/300", format: "Analytical / small-scale preparative", vt: 24, family: increase200, sampleMinMl: .025, sampleMaxMl: .5, flowMlMin: .75, formatNote: "The 300 mm bed is a versatile high-resolution final-polish format." }),
  makeColumn({ id: "superose6-10-300", name: "Superose 6 Increase 10/300 GL", shortName: "Superose 6 Increase 10/300", format: "Large-complex analytical / preparative", vt: 24, family: superose6, sampleMinMl: .025, sampleMaxMl: .5, flowMlMin: .5, formatNote: "The 300 mm bed provides high-resolution separation of large assemblies." }),
  makeColumn({ id: "superose12-10-300", name: "Superose 12 10/300 GL", shortName: "Superose 12 10/300", format: "Analytical / small-scale preparative", vt: 24, family: superose12, sampleMinMl: .025, sampleMaxMl: .5, formatNote: "The 300 mm bed supports small-to-medium protein separations." }),

  makeColumn({ id: "hiscale16-s75", name: "Superdex 75 Increase HiScale 16/40", shortName: "HiScale 16/40 S75", format: "Preparative HiScale", vt: 80, family: increase75, sampleMaxMl: 3.2, formatNote: "The larger bed supports preparative loading; verify packing quality and the configured pressure limit." }),
  makeColumn({ id: "hiscale16-s200", name: "Superdex 200 Increase HiScale 16/40", shortName: "HiScale 16/40 S200", format: "Preparative HiScale", vt: 80, family: increase200, sampleMaxMl: 3.2, formatNote: "The larger bed supports preparative loading; verify packing quality and the configured pressure limit." }),
  makeColumn({ id: "hiscale16-superose6", name: "Superose 6 Increase HiScale 16/40", shortName: "HiScale 16/40 Superose 6", format: "Large-complex preparative HiScale", vt: 80, family: superose6, sampleMaxMl: 3.2, formatNote: "The larger bed supports preparative high-mass separation; verify packing and pressure limits." }),
  makeColumn({ id: "hiscale26-s75", name: "Superdex 75 Increase HiScale 26/40", shortName: "HiScale 26/40 S75", format: "Large preparative HiScale", vt: 212, family: increase75, sampleMaxMl: 8.5, formatNote: "The 26 mm format prioritizes preparative capacity and consumes substantially more buffer." }),
  makeColumn({ id: "hiscale26-s200", name: "Superdex 200 Increase HiScale 26/40", shortName: "HiScale 26/40 S200", format: "Large preparative HiScale", vt: 212, family: increase200, sampleMaxMl: 8.5, formatNote: "The 26 mm format prioritizes preparative capacity and consumes substantially more buffer." }),
  makeColumn({ id: "hiscale26-superose6", name: "Superose 6 Increase HiScale 26/40", shortName: "HiScale 26/40 Superose 6", format: "Large-complex preparative HiScale", vt: 212, family: superose6, sampleMaxMl: 8.5, formatNote: "The 26 mm format supports large-complex preparative work at high buffer consumption." }),

  makeColumn({ id: "hiload16-s30", name: "HiLoad 16/600 Superdex 30 pg", shortName: "HiLoad 16/600 S30", format: "Preparative", vt: 120, family: superdex30Pg, sampleMaxMl: 5, flowMlMin: 1, formatNote: "The long bed supports up to 5 mL sample for preparative polishing." }),
  makeColumn({ id: "hiload16-s75", name: "HiLoad 16/600 Superdex 75 pg", shortName: "HiLoad 16/600 S75", format: "Preparative", vt: 120, family: superdex75Pg, sampleMaxMl: 5, flowMlMin: 1, formatNote: "The long bed supports up to 5 mL sample for preparative polishing." }),
  makeColumn({ id: "hiload16-s200", name: "HiLoad 16/600 Superdex 200 pg", shortName: "HiLoad 16/600 S200", format: "Preparative", vt: 120, family: superdex200Pg, sampleMaxMl: 5, flowMlMin: 1, formatNote: "The long bed supports up to 5 mL sample for preparative polishing." }),
  makeColumn({ id: "hiload26-s30", name: "HiLoad 26/600 Superdex 30 pg", shortName: "HiLoad 26/600 S30", format: "Large preparative", vt: 320, family: superdex30Pg, sampleMaxMl: 13, flowMlMin: 2.6, formatNote: "The 26 mm long bed supports up to 13 mL sample with high buffer consumption." }),
  makeColumn({ id: "hiload26-s75", name: "HiLoad 26/600 Superdex 75 pg", shortName: "HiLoad 26/600 S75", format: "Large preparative", vt: 320, family: superdex75Pg, sampleMaxMl: 13, flowMlMin: 2.6, formatNote: "The 26 mm long bed supports up to 13 mL sample with high buffer consumption." }),
  makeColumn({ id: "hiload26-s200", name: "HiLoad 26/600 Superdex 200 pg", shortName: "HiLoad 26/600 S200", format: "Large preparative", vt: 320, family: superdex200Pg, sampleMaxMl: 13, flowMlMin: 2.6, formatNote: "The 26 mm long bed supports up to 13 mL sample with high buffer consumption." }),

  makeColumn({ id: "hiprep16-s100", name: "HiPrep 16/60 Sephacryl S-100 HR", shortName: "HiPrep 16/60 S-100", format: "Preparative", vt: 120, family: sephacryl100, sampleMaxMl: 5, flowMlMin: 1, formatNote: "The prepacked 16 mm bed offers robust preparative scale with up to about 5 mL sample." }),
  makeColumn({ id: "hiprep16-s200", name: "HiPrep 16/60 Sephacryl S-200 HR", shortName: "HiPrep 16/60 S-200", format: "Preparative", vt: 120, family: sephacryl200, sampleMaxMl: 5, flowMlMin: 1, formatNote: "The prepacked 16 mm bed offers robust preparative scale with up to about 5 mL sample." }),
  makeColumn({ id: "hiprep16-s300", name: "HiPrep 16/60 Sephacryl S-300 HR", shortName: "HiPrep 16/60 S-300", format: "Preparative", vt: 120, family: sephacryl300, sampleMaxMl: 5, flowMlMin: 1, formatNote: "The prepacked 16 mm bed offers robust preparative scale with up to about 5 mL sample." }),
  makeColumn({ id: "hiprep26-s100", name: "HiPrep 26/60 Sephacryl S-100 HR", shortName: "HiPrep 26/60 S-100", format: "Large preparative", vt: 320, family: sephacryl100, sampleMaxMl: 13, flowMlMin: 2.6, formatNote: "The prepacked 26 mm bed supports larger sample volume and requires substantially more buffer." }),
  makeColumn({ id: "hiprep26-s200", name: "HiPrep 26/60 Sephacryl S-200 HR", shortName: "HiPrep 26/60 S-200", format: "Large preparative", vt: 320, family: sephacryl200, sampleMaxMl: 13, flowMlMin: 2.6, formatNote: "The prepacked 26 mm bed supports larger sample volume and requires substantially more buffer." }),
  makeColumn({ id: "hiprep26-s300", name: "HiPrep 26/60 Sephacryl S-300 HR", shortName: "HiPrep 26/60 S-300", format: "Large preparative", vt: 320, family: sephacryl300, sampleMaxMl: 13, flowMlMin: 2.6, formatNote: "The prepacked 26 mm bed supports larger sample volume and requires substantially more buffer." }),
];
