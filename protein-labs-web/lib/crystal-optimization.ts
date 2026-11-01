// Optimizing a crystallization hit, for the Crystallize job's practical
// guidance: a 24-well fine grid generated from the scientist's hit condition,
// and short practical notes on seeding, drop geometry, additives and
// construct changes. Each note carries the citation ids that back it.
//
// Pure module: no runtime `@/` imports, so the unit tests load it directly.
import type { CitationId } from "./citations.ts";
import type { CrystallizationProfile } from "./crystallization-guidance.ts";

// ── The hit condition ───────────────────────────────────────────────────────

export const PRECIPITANT_UNITS = ["% (w/v)", "% (v/v)", "M"] as const;
export type PrecipitantUnit = (typeof PRECIPITANT_UNITS)[number];

/** The condition that gave crystals, as the scientist enters it; saved at `config.panels.guidance.hit`. */
export type HitCondition = {
  precipitant: string;
  /** In `unit`. */
  concentration: number;
  unit: PrecipitantUnit;
  /** Precipitant stock used to pipette the plate, in `unit`. */
  stock: number;
  buffer: string;
  /** Null when the condition has no defined pH; the pH grid is then not offered. */
  pH: number | null;
  /** Protein concentration in the drop's protein stock, mg/mL. */
  proteinMgMl: number;
  /** Everything else in the reservoir, kept constant across the plate. */
  other: string;
};

/** Typical bench stocks: 50 % (w/v) PEG, neat MPD-like organics, 4 M salts. */
export const DEFAULT_STOCK: Record<PrecipitantUnit, number> = { "% (w/v)": 50, "% (v/v)": 100, M: 4 };

/** Shown until the scientist saves their own hit; the panel labels it as an example. */
export const EXAMPLE_HIT: HitCondition = {
  precipitant: "PEG 3,350", concentration: 20, unit: "% (w/v)", stock: 50,
  buffer: "0.1 M HEPES", pH: 7.5, proteinMgMl: 10, other: "0.2 M ammonium sulfate",
};

/** Reservoir per well of a 24-well (4 × 6) vapour-diffusion plate, µL. */
export const RESERVOIR_MICROLITRES = 500;

/** Problems that stop a plate being generated, in plain language; empty when the hit is usable. */
export function hitProblems(hit: HitCondition): string[] {
  const problems: string[] = [];
  if (!hit.precipitant.trim()) problems.push("Name the precipitant.");
  if (!(hit.concentration > 0)) problems.push("Precipitant concentration must be above 0.");
  else if (hit.unit !== "M" && hit.concentration > 100) problems.push("A percentage precipitant cannot exceed 100 %.");
  if (!(hit.proteinMgMl > 0)) problems.push("Protein concentration must be above 0 mg/mL.");
  if (hit.pH !== null && !(hit.pH >= 2 && hit.pH <= 12)) problems.push("pH must be between 2 and 12, or left empty.");
  const highest = hit.concentration > 0 ? Math.max(...precipitantSteps(hit.concentration)) : 0;
  if (!(hit.stock > 0)) problems.push("Stock concentration must be above 0.");
  else if (hit.unit !== "M" && hit.stock > 100) problems.push("A percentage stock cannot exceed 100 %.");
  else if (highest > 0 && hit.stock <= highest) problems.push(`The stock must be more concentrated than the strongest well (${formatNumber(highest)} ${hit.unit}).`);
  return problems;
}

/** A saved hit, or null when nothing usable was saved. */
export function hitFromSaved(value: unknown): HitCondition | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const text = (key: string) => typeof raw[key] === "string" ? raw[key] as string : "";
  const num = (key: string) => typeof raw[key] === "number" && Number.isFinite(raw[key]) ? raw[key] as number : NaN;
  const unit = PRECIPITANT_UNITS.find((item) => item === raw.unit);
  if (!unit) return null;
  const hit: HitCondition = {
    precipitant: text("precipitant"), concentration: num("concentration"), unit, stock: num("stock"),
    buffer: text("buffer"), pH: raw.pH === null ? null : num("pH"), proteinMgMl: num("proteinMgMl"), other: text("other"),
  };
  return hitProblems(hit).length ? null : hit;
}

// ── Fine grid plates ────────────────────────────────────────────────────────

export type GridKind = "precipitant-ph" | "precipitant-protein";

/** Precipitant across the six columns: 70–120 % of the hit in 10 % steps, so the hit sits in column 4. */
export const PRECIPITANT_FACTORS = [0.7, 0.8, 0.9, 1, 1.1, 1.2] as const;
/** pH down the four rows: the hit in row C, with 0.2-unit steps either side. */
export const PH_OFFSETS = [-0.4, -0.2, 0, 0.2] as const;
/** Protein down the four rows: half to one and a half times the hit, so the hit sits in row C. */
export const PROTEIN_FACTORS = [0.5, 0.75, 1, 1.5] as const;

export const ROW_LETTERS = ["A", "B", "C", "D"] as const;

export type PlateWell = {
  /** "A1" … "D6". */
  id: string;
  precipitant: number;
  /** Precipitant stock to pipette into the reservoir, µL. */
  stockMicrolitres: number;
  pH: number | null;
  proteinMgMl: number;
  /** The well that repeats the hit exactly. */
  isHit: boolean;
};

export type OptimizationPlate = {
  kind: GridKind;
  title: string;
  /** What the rows vary, with its unit, e.g. "pH" or "Protein, mg/mL". */
  rowLabel: string;
  rowValues: number[];
  columnLabel: string;
  columnValues: number[];
  /** Four rows of six wells. */
  wells: PlateWell[][];
  /** What every well shares, one line each. */
  constant: string[];
};

/** Rounded to two significant figures of the hit, so steps read as bench numbers (14, 16 … not 14.000001). */
export function precipitantSteps(hit: number): number[] {
  return PRECIPITANT_FACTORS.map((factor) => roundLike(hit * factor, hit));
}

export function proteinSteps(hit: number): number[] {
  return PROTEIN_FACTORS.map((factor) => roundLike(hit * factor, hit));
}

export function phSteps(hit: number): number[] {
  return PH_OFFSETS.map((offset) => Math.round((hit + offset) * 10) / 10);
}

/** Null for the pH grid when the hit has no pH. */
export function optimizationPlate(hit: HitCondition, kind: GridKind): OptimizationPlate | null {
  if (hitProblems(hit).length) return null;
  if (kind === "precipitant-ph" && hit.pH === null) return null;
  const columns = precipitantSteps(hit.concentration);
  const byPh = kind === "precipitant-ph";
  const rows = byPh ? phSteps(hit.pH as number) : proteinSteps(hit.proteinMgMl);
  const hitRow = byPh ? PH_OFFSETS.indexOf(0) : PROTEIN_FACTORS.indexOf(1);
  const hitColumn = PRECIPITANT_FACTORS.indexOf(1);
  const wells = rows.map((rowValue, row) => columns.map((precipitant, column) => ({
    id: `${ROW_LETTERS[row]}${column + 1}`,
    precipitant,
    stockMicrolitres: Math.round(precipitant / hit.stock * RESERVOIR_MICROLITRES),
    pH: byPh ? rowValue : hit.pH,
    proteinMgMl: byPh ? hit.proteinMgMl : rowValue,
    isHit: row === hitRow && column === hitColumn,
  })));
  const buffer = hit.buffer.trim() || "the hit's buffer";
  const constant = [
    byPh
      ? `${buffer}, titrated to each row's pH — make one buffer stock per row.`
      : `${buffer}${hit.pH === null ? "" : ` at pH ${formatNumber(hit.pH)}`} in every well.`,
    ...(hit.other.trim() ? [`${hit.other.trim()} in every well.`] : []),
    `${hit.precipitant.trim()} from a ${formatNumber(hit.stock)} ${hit.unit} stock (volume in each well), then water to ${RESERVOIR_MICROLITRES} µL.`,
    byPh
      ? `Protein at ${formatNumber(hit.proteinMgMl)} mg/mL, mixed 1:1 with reservoir in the drop.`
      : "Dilute the protein stock to each row's concentration with its own buffer; mix 1:1 with reservoir in the drop.",
  ];
  return {
    kind,
    title: byPh ? "Plate 1: precipitant against pH" : "Plate 2: precipitant against protein concentration",
    rowLabel: byPh ? "pH" : "Protein, mg/mL",
    rowValues: rows,
    columnLabel: `${hit.precipitant.trim()}, ${hit.unit}`,
    columnValues: columns,
    wells,
    constant,
  };
}

/** Trailing zeros dropped: 20 → "20", 7.30 → "7.3", 0.15 → "0.15". */
export function formatNumber(value: number): string {
  return String(Number(value.toFixed(3)));
}

function roundLike(value: number, reference: number) {
  const step = 10 ** (Math.floor(Math.log10(reference)) - 1);
  return Number((Math.round(value / step) * step).toFixed(6));
}

// ── Techniques ──────────────────────────────────────────────────────────────

export type TechniqueGroupId = "seeding" | "drops" | "sample";

export const TECHNIQUE_GROUPS: { id: TechniqueGroupId; label: string; intro: string; citations: CitationId[] }[] = [
  {
    id: "seeding", label: "Seeding",
    intro: "Seeds separate nucleation from growth. Nucleation needs high supersaturation; growth is best at low supersaturation, in the metastable zone. Seeds let you set drops there, where they grow but no new crystals start.",
    citations: ["bergfors2003", "chayen2008"],
  },
  {
    id: "drops", label: "Drops and chemistry",
    intro: "Small changes to how the drop is set up and what is in it, holding the hit's main chemistry fixed.",
    citations: ["mcpherson-cudney2014"],
  },
  {
    id: "sample", label: "The protein itself",
    intro: "When no condition gives good crystals, change the sample: its concentration, what is bound to it, and its surface.",
    citations: ["dale2003", "mcpherson-cudney2014"],
  },
];

export type Technique = {
  id: string;
  group: TechniqueGroupId;
  label: string;
  /** When to reach for it, in one sentence. */
  when: string;
  /** What to do, as short bench steps. */
  steps: string[];
  citations: CitationId[];
};

export const TECHNIQUES: Technique[] = [
  {
    id: "microseeding", group: "seeding", label: "Microseeding (seed-bead stock)",
    when: "The hit gives showers of microcrystals, needles or crystals too small to use.",
    steps: [
      "Crush the hit's crystals in about 50 µL of reservoir solution with a PTFE seed bead by vortexing: this is the seed stock.",
      "Make 10-fold serial dilutions in reservoir solution (for example 1:10 down to 1:10⁶).",
      "Add a small volume (0.1–0.5 µL) of each dilution to fresh drops with less precipitant or protein than the hit, so seeds grow but new crystals do not start.",
      "Keep the dilution that gives a few well-separated crystals per drop.",
    ],
    citations: ["luft1999", "bergfors2003"],
  },
  {
    id: "streak", group: "seeding", label: "Streak seeding",
    when: "A quick test of whether seeding works, and of which conditions support growth.",
    steps: [
      "Touch a hit crystal with a cat whisker or fine hair to pick up seeds.",
      "Draw it in a straight line through a fresh drop that has already equilibrated.",
      "Crystals along the streak mean seeding works; streaking several drops in a row dilutes the seeds.",
    ],
    citations: ["stura1991", "bergfors2003"],
  },
  {
    id: "macroseeding", group: "seeding", label: "Macroseeding",
    when: "You have one good but small crystal and want it larger.",
    steps: [
      "Wash a single crystal through two or three drops of stabilizing solution to remove microcrystals and dissolve a little of its surface.",
      "Transfer it to a pre-equilibrated drop in the metastable zone, where it grows and nothing new nucleates.",
    ],
    citations: ["bergfors2003"],
  },
  {
    id: "cross-seeding", group: "seeding", label: "Cross-seeding",
    when: "There are no crystals of this protein to seed from yet.",
    steps: [
      "Use seeds of a related protein — a homologue, mutant, complex or another crystal form — as the nucleant.",
      "Once your own protein crystallizes, switch to seeds of its own crystals.",
    ],
    citations: ["bergfors2003"],
  },
  {
    id: "rmms", group: "seeding", label: "Random microseed matrix screening (rMMS)",
    when: "The hit is poor or appears in only one condition, and you want new, better hits.",
    steps: [
      "Make a seed stock from any crystals of the protein, even poor ones.",
      "Add a little of it to every drop of a full sparse-matrix screen, usually with a robot.",
      "Seeds skip the nucleation step, so conditions that sit in the metastable zone — and never nucleate alone — can now give crystals, often in new crystal forms.",
    ],
    citations: ["darcy2007"],
  },
  {
    id: "drop-ratio", group: "drops", label: "Drop ratio and drop volume",
    when: "The grid is close but crystals are still too many, too few or too small.",
    steps: [
      "Set the same condition at protein:reservoir ratios of 2:1, 1:1 and 1:2; each starts and ends the drop at a different point on the phase diagram, with no new solutions to make.",
      "Larger drops equilibrate more slowly and tend to give fewer, larger crystals.",
    ],
    citations: ["luft2007", "mcpherson-cudney2014"],
  },
  {
    id: "temperature", group: "drops", label: "Temperature",
    when: "Always worth one repeat of the best wells.",
    steps: [
      "Repeat the best wells at 4 °C and 20 °C: solubility, and so supersaturation, changes with temperature.",
      "Keep each plate at a constant temperature; swings dissolve crystals and start new ones.",
    ],
    citations: ["luft2007", "mcpherson-cudney2014"],
  },
  {
    id: "drop-format", group: "drops", label: "Sitting or hanging drop",
    when: "Moving a nanolitre robot hit to the bench.",
    steps: [
      "Scale up to microlitre drops; hits do not always transfer, so repeat the grid rather than only the single condition.",
      "Hanging drops give clearer optics and easier harvesting; keep sitting drops for detergent or MPD conditions that spread. The Hanging vs sitting drop tab compares them.",
    ],
    citations: ["dessau2011", "chayen2008"],
  },
  {
    id: "oil", group: "drops", label: "Oil over the reservoir (Al's oil)",
    when: "Crystals appear fast and in showers: vapour diffusion is too quick.",
    steps: [
      "Layer oil over the reservoir to slow the movement of water from the drop, so it approaches supersaturation slowly: fewer nuclei, larger crystals.",
      "Paraffin oil nearly blocks water vapour and silicone oil lets it through; Al's oil is a 1:1 mix of the two. More paraffin or a thicker layer slows equilibration further.",
    ],
    citations: ["chayen1997"],
  },
  {
    id: "additives", group: "drops", label: "Additive screens",
    when: "The crystals are there but misshapen, twinned or diffract poorly.",
    steps: [
      "Add a commercial additive screen (salts, polyols, organics, small ligands) to the best condition, usually as about a tenth of the drop.",
      "Score each additive against the plain condition on the same plate.",
    ],
    citations: ["mcpherson-cudney2014"],
  },
  {
    id: "silver-bullets", group: "drops", label: "Silver Bullets",
    when: "Nothing in the plain screens or the additive screen gives good crystals.",
    steps: [
      "Silver Bullets are mixtures of small molecules chosen to bridge neighbouring protein molecules and form crystal contacts.",
      "Add each mixture to a modest precipitant-and-buffer base; many proteins crystallized this way that plain screens had not crystallized.",
    ],
    citations: ["mcpherson2006"],
  },
  {
    id: "detergents", group: "drops", label: "Detergents",
    when: "Drops show aggregation or phase separation, or the protein is a membrane protein.",
    steps: [
      "A low concentration of a mild detergent can reduce non-specific aggregation and improve crystal shape, even for soluble proteins.",
      "For membrane proteins the detergent and its concentration are variables to screen in their own right.",
    ],
    citations: ["mcpherson-cudney2014", "newstead2008"],
  },
  {
    id: "protein-concentration", group: "sample", label: "Protein concentration and sample quality",
    when: "Use Plate 2 above; also whenever results are not reproducible.",
    steps: [
      "Scan protein concentration around the hit (Plate 2): too much gives precipitate or showers, too little gives clear drops.",
      "Use fresh protein, spun or filtered just before setting drops, from the same preparation for every repeat.",
    ],
    citations: ["dessau2011", "mcpherson-cudney2014"],
  },
  {
    id: "ligand", group: "sample", label: "Ligand co-crystallization",
    when: "The protein has a ligand, cofactor, substrate analogue or inhibitor.",
    steps: [
      "Incubate the protein with the ligand in molar excess before setting drops.",
      "A bound ligand often locks one conformation, so the molecules are more alike and pack better.",
    ],
    citations: ["hassell2007"],
  },
  {
    id: "proteolysis", group: "sample", label: "In situ proteolysis",
    when: "Flexible ends or loops are suspected, or the protein will not crystallize at all.",
    steps: [
      "Add a trace of protease (for example chymotrypsin or trypsin at about 1:100 to 1:1,000 by mass) to the protein just before setting drops.",
      "The protease trims flexible regions during crystallization; check what crystallized by mass spectrometry or SDS-PAGE.",
    ],
    citations: ["dong2007"],
  },
  {
    id: "ser", group: "sample", label: "Surface entropy reduction",
    when: "The protein resists every condition and you can change the construct.",
    steps: [
      "Mutate clusters of long, flexible surface residues (Lys, Glu, Gln) to Ala, creating low-entropy patches that can form crystal contacts.",
      "The SERp server proposes which clusters to mutate.",
    ],
    citations: ["derewenda2004", "goldschmidt2007"],
  },
];

/** Why a technique is worth trying first for this protein, or null; from what earlier jobs recorded. */
export function techniqueHint(technique: Technique, profile: CrystallizationProfile): string | null {
  switch (technique.id) {
    case "proteolysis":
    case "ser":
      return profile.disorder === "yes" ? "Disordered regions are recorded for this protein." : null;
    case "ligand":
      return profile.ligands.length ? `Earlier jobs record ${[...new Set(profile.ligands)].join(", ")}.` : null;
    case "detergents":
      return profile.membrane === "yes" ? "Earlier jobs mark this as a membrane protein." : null;
    default:
      return null;
  }
}

/** Every source the optimization tab cites, in reading order. */
export const OPTIMIZATION_CITATIONS: CitationId[] = [
  "mcpherson-cudney2014", "pl-crystal-rules", ...TECHNIQUE_GROUPS.flatMap((group) => group.citations), ...TECHNIQUES.flatMap((technique) => technique.citations),
];
