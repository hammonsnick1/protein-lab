// Practical crystallization guidance for the Crystallize job: which commercial
// screens to start with, at what protein concentration, what every component
// of a crystallization drop is for, and how vapour-diffusion drops work.
//
// Everything is tailored from `ProteinFacts`, so the scientist never re-enters
// size, membrane, disorder or ligand information an earlier job recorded.
// Each rule carries the citation ids that back it; the panel shows them with
// the shared citation component.
//
// Pure module: no runtime `@/` imports, so the unit tests load it directly.
import { aminoAcid, waterMassDa } from "./amino-acids.ts";
import { bufferComponentLibrary, type BufferLibraryEntry } from "./buffer-component-library.ts";
import type { CitationId } from "./citations.ts";
import type { CrystalGrowth, ProteinFacts, ReviewAnswer } from "./protein-facts.ts";

/** "unknown" means no earlier job answered the question; the panel says which job would. */
export type Answer = "yes" | "no" | "uncertain" | "unknown";

/** One line of advice and the sources behind it; `pl-crystal-rules` marks the app's own rule of thumb. */
export type Reason = { text: string; citations: CitationId[] };

export type CrystallizationProfile = {
  residues: number | null;
  /** Average mass from the sequence, kDa; null without a sequence. */
  massKDa: number | null;
  membrane: Answer;
  disorder: Answer;
  /** Cofactor or ligand names recorded by earlier jobs. */
  ligands: string[];
  /**
   * Whether anyone has answered the cofactor question: `missing` carries the
   * protein-facts reason, so an empty `ligands` is never read as "none".
   */
  cofactorReview: { status: "missing"; reason: string } | { status: "known"; required: ReviewAnswer };
  /** Crystal-growth rows deposited with related PDB entries. */
  pdbConditions: { pdbId: string; identity: number | null; growth: CrystalGrowth }[];
};

export function crystallizationProfile(facts: ProteinFacts): CrystallizationProfile {
  const sequence = facts.sequence.status === "known" ? facts.sequence.value.sequence : "";
  const answer = (fact: ProteinFacts["membrane"]): Answer => fact.status === "known" ? fact.value.verdict : "unknown";
  return {
    residues: sequence ? sequence.length : null,
    massKDa: sequence ? averageMassKDa(sequence) : null,
    membrane: answer(facts.membrane),
    disorder: answer(facts.disorder),
    ligands: facts.cofactors.status === "known" ? facts.cofactors.value.cofactors.map((item) => item.name) : [],
    cofactorReview: facts.cofactors.status === "known"
      ? { status: "known", required: facts.cofactors.value.required }
      : { status: "missing", reason: facts.cofactors.reason },
    pdbConditions: facts.pdbHits.status === "known"
      ? facts.pdbHits.value.hits.flatMap((hit) => hit.crystalGrowth
        .filter((growth) => growth.details || growth.pH !== null)
        .map((growth) => ({ pdbId: hit.pdbId, identity: hit.identity ?? null, growth })))
      : [],
  };
}

/** Average polypeptide mass in kDa: residue masses plus one water. Unknown letters count as an average residue (110 Da). */
export function averageMassKDa(sequence: string): number {
  let da = waterMassDa;
  for (const code of sequence.toUpperCase()) da += aminoAcid(code)?.residueMassDa ?? 110;
  return da / 1000;
}

// ── Commercial screens ──────────────────────────────────────────────────────

// Only screens whose formulation can be read from the vendor or the design
// paper are listed. NeXtal's PEGs II Suite was dropped (HOM-360): no current
// vendor or formulation page could be found, and PEG/Ion covers the follow-up.
export type ScreenId = "jcsg-plus" | "index" | "peg-ion" | "morpheus" | "memgold";

export type Screen = {
  id: ScreenId;
  name: string;
  vendor: string;
  /** Conditions per kit, as the vendor sells it. */
  conditions: string;
  /** What chemical space it samples, in plain language. */
  samples: string;
  citations: CitationId[];
};

export const SCREENS: Record<ScreenId, Screen> = {
  "jcsg-plus": {
    id: "jcsg-plus", name: "JCSG-plus", vendor: "Molecular Dimensions", conditions: "96 conditions",
    samples: "A sparse-matrix set distilled from the conditions that actually produced crystals at the Joint Center for Structural Genomics: PEGs, salts and organics across a wide pH range.",
    citations: ["newman2005", "md-jcsg-plus", "jancarik1991"],
  },
  index: {
    id: "index", name: "Index", vendor: "Hampton Research", conditions: "96 conditions",
    samples: "Grid, sparse-matrix and incomplete-factorial ideas in one plate, in zones: salts versus pH, neutralized organic acids, high salt with low polymer, high polymer with low salt, and PEG with salt versus pH.",
    citations: ["hampton-index", "hampton-index-guide", "jancarik1991"],
  },
  "peg-ion": {
    id: "peg-ion", name: "PEG/Ion and PEG/Ion 2", vendor: "Hampton Research", conditions: "48 + 48 conditions",
    samples: "PEG 3,350 paired with 48 different salts (PEG/Ion), then with titrated organic acids from pH 3.7 to 8.8 (PEG/Ion 2). It asks one question cleanly: which ion and pH help PEG crystallize this protein.",
    citations: ["hampton-pegion"],
  },
  morpheus: {
    id: "morpheus", name: "Morpheus", vendor: "Molecular Dimensions", conditions: "96 conditions",
    samples: "Precipitant mixes that are also cryoprotectants, crossed with additive mixes (small molecules, ions, ligand-like compounds) and three buffer systems.",
    citations: ["gorrec2009", "md-morpheus"],
  },
  memgold: {
    id: "memgold", name: "MemGold and MemGold2", vendor: "Molecular Dimensions", conditions: "96 + 96 conditions",
    samples: "Built from the conditions that crystallized deposited α-helical membrane proteins: mostly PEGs, often of low molecular weight, with modest salt — chemistry that tolerates detergent micelles.",
    citations: ["newstead2008", "parker2012", "md-memgold"],
  },
};

export type ScreenPriority = "first" | "next" | "later";

export type ScreenSuggestion = { screen: Screen; priority: ScreenPriority; why: Reason[] };

export const PRIORITY_LABELS: Record<ScreenPriority, string> = {
  first: "Start here",
  next: "Second round",
  later: "If nothing grows",
};

/** Ordered screen suggestions with the reasons each was chosen. */
export function suggestScreens(profile: CrystallizationProfile): ScreenSuggestion[] {
  const membrane = profile.membrane === "yes";
  const ligand = profile.ligands.length > 0;
  const list: ScreenSuggestion[] = [];
  const add = (id: ScreenId, priority: ScreenPriority, why: Reason[]) => list.push({ screen: SCREENS[id], priority, why });

  if (membrane) {
    add("memgold", "first", [
      { text: "Earlier jobs mark this as a membrane protein. MemGold's conditions were distilled from the conditions that crystallized deposited α-helical membrane proteins, rather than soluble ones.", citations: ["newstead2008", "parker2012"] },
      { text: "Those conditions are mostly PEGs, often of low molecular weight, with modest salt: chemistry that tolerates the detergent micelle around the protein.", citations: ["newstead2008"] },
    ]);
  }
  add("jcsg-plus", membrane ? "next" : "first", [
    { text: "A broad sparse-matrix screen: one plate samples the conditions that most often worked for other proteins, which is the efficient first question when nothing is known yet.", citations: ["jancarik1991", "newman2005"] },
    ...(membrane ? [{ text: "Use it after MemGold, keeping detergent above its CMC in the protein sample.", citations: ["pl-crystal-rules", "seddon2004"] } satisfies Reason] : []),
  ]);
  add("index", membrane ? "later" : "first", [
    { text: "Covers salts, organic acids and PEG–salt mixtures in labelled zones, so even precipitate and clear drops tell you which reagent class and pH this protein tolerates.", citations: ["hampton-index-guide"] },
    { text: "A second broad plate to run alongside JCSG-plus in the first round.", citations: ["pl-crystal-rules"] },
  ]);
  add("morpheus", ligand ? "first" : "next", [
    { text: "Its precipitant mixes double as cryoprotectants, so crystals can often be frozen straight from the drop; the best cryoprotectant concentration still depends on the sample.", citations: ["gorrec2009"] },
    ligand
      ? { text: `Earlier jobs record ${listNames(profile.ligands)}. Morpheus additive mixes include small molecules and ions that can stabilize ligand-bound states; add your own ligand to the protein first as well.`, citations: ["gorrec2009", "hassell2007"] }
      : { text: "Its additive mixes add chemistry that the classic screens do not sample.", citations: ["gorrec2009"] },
  ]);
  add("peg-ion", "next", [
    { text: "PEG is the most popular precipitant, and PEG with salt is the most reported system for growing single crystals. When first-round hits come from PEG conditions, this screen finds the best salt and pH to go with it.", citations: ["mcpherson2014", "hampton-index-guide", "hampton-pegion"] },
  ]);
  if (profile.membrane === "unknown" || profile.membrane === "uncertain") {
    add("memgold", "later", [
      { text: "Only if this turns out to be a membrane protein — then it moves to the top of the list and every drop needs detergent. No earlier job has settled that yet.", citations: ["newstead2008"] },
    ]);
  }
  const order: ScreenPriority[] = ["first", "next", "later"];
  return list.sort((a, b) => order.indexOf(a.priority) - order.indexOf(b.priority));
}

/** Why a membrane protein still needs a decision: shown when the readiness check has not answered. */
export function membraneNote(profile: CrystallizationProfile): string | null {
  if (profile.membrane === "unknown") return "No earlier job says whether this is a membrane protein. If it is, MemGold should come first and every drop needs detergent; answer it in Protein readiness check.";
  if (profile.membrane === "uncertain") return "The readiness check flags membrane association for follow-up. Settle it before screening: a membrane protein needs MemGold first and detergent in every drop.";
  return null;
}

// ── Starting protein concentration ──────────────────────────────────────────

export type ConcentrationAdvice = {
  /** mg/mL */
  low: number;
  high: number;
  /** A single number to try first, mg/mL. */
  start: number;
  /** The same start as molarity, µM; null without a mass. */
  startMicromolar: number | null;
  why: Reason[];
};

/**
 * Published first-screen ranges, for the line under the tailored range:
 * Hampton recommends 5–25 mg/mL for Index; the reviews span 2–100 mg/mL.
 */
export const PUBLISHED_STARTING_RANGE: Reason = {
  text: "Vendors recommend about 5–25 mg/mL for a first screen; reviews report working concentrations from about 2 up to 50–100 mg/mL, depending on the protein.",
  citations: ["hampton-index-guide", "dessau2011", "mcpherson2014"],
};

/**
 * A starting range by size, then adjusted for membrane proteins. The size
 * cut-offs and ranges are the app's own rule of thumb inside the published
 * span above; the panel says how to move them once the first drops are read.
 */
export function startingConcentration(profile: CrystallizationProfile): ConcentrationAdvice {
  const mass = profile.massKDa;
  let low = 5, high = 20, start = 10;
  const why: Reason[] = [];
  const rule: CitationId[] = ["pl-crystal-rules"];
  if (mass === null) {
    why.push({ text: "Without a saved sequence the size is unknown, so this is the app's general starting range for soluble proteins.", citations: rule });
  } else if (mass < 15) {
    low = 10; high = 30; start = 20;
    why.push({ text: `At about ${mass.toFixed(1)} kDa this is a small protein (under 15 kDa in this app's rule of thumb). Small proteins need a higher mass concentration to reach the same number of molecules per drop, so start at the top of the usual range.`, citations: rule });
  } else if (mass > 100) {
    low = 2; high = 10; start = 5;
    why.push({ text: `At about ${mass.toFixed(0)} kDa this is a large protein (over 100 kDa in this app's rule of thumb). Each molecule carries more mass, so fewer mg/mL already gives enough molecules; large proteins also aggregate sooner when over-concentrated.`, citations: rule });
  } else {
    why.push({ text: `At about ${mass.toFixed(1)} kDa this is a mid-sized protein, so start in the middle of the usual range.`, citations: rule });
  }
  if (profile.membrane === "yes") {
    high = Math.min(high, 15);
    start = Math.min(start, 10);
    low = Math.min(low, start);
    why.push({ text: "Membrane proteins are concentrated together with their detergent, and concentrators also pile up empty micelles. This app therefore caps the range at 15 mg/mL and suggests a concentrator cut-off above the micelle size.", citations: ["pl-crystal-rules"] });
  }
  if (profile.disorder === "yes") {
    why.push({ text: "Disordered regions are recorded. Flexible stretches rarely pack into a lattice; trimming them from the construct often helps more than any change of concentration.", citations: ["dale2003"] });
  }
  return { low, high, start, startMicromolar: mass === null ? null : start / mass * 1000, why };
}

/** How to move the concentration after reading the first plate (Hampton's Index guide). */
export const READ_THE_FIRST_PLATE: Reason = {
  text: "Read the plate once the drops have equilibrated. If most drops (Hampton suggests more than 70 of 96) hold precipitate and no crystals, halve the protein concentration and repeat the screen; if most stay clear, double it.",
  citations: ["hampton-index-guide", "dessau2011"],
};

/** One sentence per fact that shaped the advice, for the panel's "What this is based on" list. */
export function tailoringNotes(profile: CrystallizationProfile): { label: string; value: string; citations: CitationId[] }[] {
  const notes: { label: string; value: string; citations: CitationId[] }[] = [];
  notes.push({ label: "Size", value: profile.massKDa === null ? "Unknown — no sequence saved" : `${profile.residues} residues · ≈${profile.massKDa.toFixed(1)} kDa (average mass)`, citations: [] });
  notes.push({ label: "Membrane protein", value: answerText(profile.membrane), citations: [] });
  notes.push({ label: "Disordered regions", value: answerText(profile.disorder), citations: profile.disorder === "yes" ? ["dale2003"] : [] });
  notes.push({ label: "Ligands and cofactors", value: ligandText(profile), citations: profile.ligands.length ? ["hassell2007"] : [] });
  return notes;
}

/** Never "none" unless someone said so: a missing cofactor fact names the job that would answer it. */
function ligandText(profile: CrystallizationProfile) {
  if (profile.ligands.length) return listNames(profile.ligands);
  const review = profile.cofactorReview;
  if (review.status === "missing") return `Not answered yet — ${review.reason}`;
  if (review.required === "No") return "None needed, by the scientist's review";
  return "A cofactor is needed but none is named yet; name it in Protein readiness check";
}

/** Ligand advice: co-crystallize or soak. */
export function ligandAdvice(profile: CrystallizationProfile): string | null {
  if (!profile.ligands.length) return null;
  return `Earlier jobs record ${listNames(profile.ligands)}. Add ${new Set(profile.ligands).size > 1 ? "them" : "it"} to the protein before setting drops (co-crystallization), at enough excess to keep the protein saturated — commonly a several-fold molar excess. The alternative is to grow crystals first and soak the ligand in; soaking only works if the binding site is open to the solvent channels of the crystal.`;
}

function answerText(answer: Answer) {
  return answer === "yes" ? "Yes" : answer === "no" ? "No" : answer === "uncertain" ? "Flagged for follow-up" : "Not answered yet";
}

function listNames(names: string[]) {
  const unique = [...new Set(names)];
  return unique.length <= 2 ? unique.join(" and ") : `${unique.slice(0, -1).join(", ")} and ${unique.at(-1)}`;
}

// ── Drop components ─────────────────────────────────────────────────────────

export type ComponentRoleId = "precipitant" | "buffer" | "salt" | "additive" | "detergent";

export type CrystallizationExample = {
  name: string;
  typical: string;
  /** How this example does the job, in one or two sentences. */
  how: string;
  /** Sources for the typical amount; `pl-crystal-rules` where it is the app's own rule of thumb. */
  citations: CitationId[];
  /** Buffer-library entry reused for the purification-side caution, with the library's references for it. */
  library?: { entry: BufferLibraryEntry; citations: CitationId[] };
};

export type ComponentRole = {
  id: ComponentRoleId;
  label: string;
  /** Plain-language answer to "why is this in the drop?" */
  why: string;
  examples: CrystallizationExample[];
  /** Practical rule, e.g. what to keep out of the protein stock. */
  tip: Reason;
  citations: CitationId[];
  /** True when it only applies to some proteins; the panel says which. */
  onlyFor?: "membrane";
};

/**
 * A buffer-library entry and the registry ids of the references it records
 * (`buffer-component-library.ts` keeps them as text). Handbooks without a
 * registry entry are left out.
 */
function library(id: string, citations: CitationId[]): CrystallizationExample["library"] {
  const entry = bufferComponentLibrary.find((item) => item.id === id);
  return entry && { entry, citations };
}

// Typical amounts read from Hampton's Index formulation (hampton-index-guide)
// unless another source is named; ranges the sources do not give are marked
// as the app's own rule of thumb.
export const COMPONENT_ROLES: ComponentRole[] = [
  {
    id: "precipitant", label: "Precipitant",
    why: "A crystal only grows from a supersaturated solution: one holding more protein than it can keep dissolved at equilibrium. Purified protein is deliberately kept soluble, so on its own it never gets there. The precipitant lowers the protein's solubility, pushing the drop into the supersaturated zone of the phase diagram where molecules start to leave solution — ideally in an ordered lattice rather than as amorphous precipitate.",
    examples: [
      { name: "PEG 3,350 / 4,000 / 8,000", typical: "≈4–18 % (w/v) for most proteins; screens reach 25–30 %", how: "Long polymers take up volume the protein cannot enter (excluded volume), so protein molecules are crowded together. The most popular precipitant.", citations: ["mcpherson2014", "hampton-index-guide"] },
      { name: "Ammonium sulfate", typical: "1–3.5 M as the main precipitant", how: "Salting out: at high concentration the ions bind the water the protein surface needs, so proteins associate with each other instead.", citations: ["hampton-index-guide"] },
      { name: "MPD (2-methyl-2,4-pentanediol)", typical: "≈45 % (v/v) as the main precipitant; 1–5 % as an additive", how: "A small organic that lowers the solvent's dielectric constant and competes for surface water; also used in cryoprotecting precipitant mixes.", citations: ["hampton-index-guide", "mcpherson2014", "gorrec2009"] },
    ],
    tip: { text: "Screens vary the precipitant most of all. Precipitate in many drops means supersaturation is too high (too much protein or precipitant); clear drops mean it is too low.", citations: ["hampton-index-guide", "dessau2011"] },
    citations: ["mcpherson2014", "asherie2004", "chayen2008"],
  },
  {
    id: "buffer", label: "Buffer and pH",
    why: "pH sets the charge on every surface side chain. Crystal contacts are a handful of weak surface interactions, so a shift of half a pH unit can make or break them. Proteins are often least soluble near their isoelectric point, which some conditions exploit.",
    examples: [
      { name: "HEPES", typical: "0.1 M in screens, pH 7.0–7.5", how: "Neutral-pH Good's buffer.", citations: ["hampton-index-guide", "good1966"], library: library("hepes", ["good1966", "graslund2008"]) },
      { name: "Tris-HCl", typical: "0.1 M in screens, pH 8.5", how: "Mildly basic conditions; temperature-sensitive pH.", citations: ["hampton-index-guide"], library: library("tris", ["good1966"]) },
      { name: "MES", typical: "0.1 M in screens; buffers pH 5.5–6.7", how: "Slightly acidic conditions.", citations: ["good1966", "pl-crystal-rules"], library: library("mes", ["good1966"]) },
      { name: "Sodium acetate / citric acid", typical: "0.1 M in screens, pH 3.5–4.5", how: "Acidic conditions that standard purification buffers never reach.", citations: ["hampton-index-guide"] },
    ],
    tip: { text: "Keep the protein's own buffer weak (about 10–25 mM) so the screen's 0.1 M buffer decides the drop's pH.", citations: ["hampton-index-guide"] },
    citations: ["mcpherson2014", "dessau2011"],
  },
  {
    id: "salt", label: "Salt",
    why: "At low concentration salt screens charges and keeps proteins soluble (salting in); at high concentration it becomes a precipitant (salting out). Specific ions can also bridge two molecules and form a crystal contact, which is why screens like PEG/Ion test dozens of different salts.",
    examples: [
      { name: "NaCl", typical: "≤150 mM in the protein stock; 0.1–3 M in screens", how: "General ionic strength.", citations: ["pl-crystal-rules", "hampton-index-guide"], library: library("nacl", ["graslund2008", "bondos2003"]) },
      { name: "Divalent salts (MgCl₂, CaCl₂, Zn acetate)", typical: "0.005–0.2 M in screens", how: "Can bridge acidic side chains between neighbouring molecules.", citations: ["hampton-index-guide"] },
    ],
    tip: { text: "Dialyse the protein into dilute buffer with little salt before screening; a high-salt stock shifts every condition on the plate.", citations: ["hampton-index-guide"] },
    citations: ["mcpherson2014", "hampton-pegion"],
  },
  {
    id: "additive", label: "Additives",
    why: "Small molecules that do not crystallize the protein alone but tip a near-miss into a crystal: they stabilize one conformation, fill a gap in a crystal contact, or slow nucleation so fewer, larger crystals grow.",
    examples: [
      { name: "Ligands, cofactors and metal ions", typical: "Molar excess over the protein", how: "Lock the protein into one conformation, so molecules are more alike and pack better.", citations: ["hassell2007"] },
      { name: "TCEP", typical: "0.5–2 mM", how: "Keeps cysteines reduced so mixed disulfides do not make the sample heterogeneous.", citations: ["pl-crystal-rules"], library: library("tcep", ["getz1999", "graslund2008"]) },
      { name: "Glycerol", typical: "≤5 % (v/v) in the stock", how: "Stabilizes the protein but raises its solubility, so it works against the precipitant.", citations: ["pl-crystal-rules"], library: library("glycerol", ["vagenende2009", "bondos2003", "graslund2008"]) },
    ],
    tip: { text: "Additive screens are usually run to improve a hit; mixes of small molecules can also give crystals where the plain screen gave none.", citations: ["pl-crystal-rules", "mcpherson2006"] },
    citations: ["mcpherson2006", "hassell2007"],
  },
  {
    id: "detergent", label: "Detergent", onlyFor: "membrane",
    why: "A membrane protein's transmembrane surface is greasy. Outside the lipid bilayer, detergent molecules form a micelle belt around it; without that belt the protein unfolds and aggregates. In the drop, the detergent must stay above its critical micelle concentration (CMC), and the micelle itself becomes part of every crystal contact.",
    examples: [
      { name: "DDM", typical: "A few × CMC (≈0.02–0.05 % w/v)", how: "Gentle maltoside, the most common choice for extraction and purification.", citations: ["seddon2004", "newstead2008"], library: library("ddm", ["seddon2004"]) },
      { name: "LDAO, OG, C₈E₄", typical: "Above CMC", how: "Smaller micelles that leave more protein surface free for crystal contacts; harsher on fragile proteins.", citations: ["newstead2008", "parker2012"] },
      { name: "Lipidic cubic phase (monoolein)", typical: "3 parts lipid : 2 parts protein (60 : 40)", how: "Puts the protein back into a lipid bilayer (in meso); the route for many GPCR and transporter structures.", citations: ["caffrey2015"] },
    ],
    tip: { text: "Exchange to the detergent you want to crystallize in during the last purification step, not in the drop.", citations: ["pl-crystal-rules"] },
    citations: ["newstead2008", "parker2012", "caffrey2015"],
  },
];

/** The roles that apply to this protein; detergent appears only for membrane proteins, or as a note when membrane status is open. */
export function componentRolesFor(profile: CrystallizationProfile): { role: ComponentRole; applies: boolean }[] {
  return COMPONENT_ROLES.map((role) => ({ role, applies: role.onlyFor !== "membrane" || profile.membrane === "yes" }));
}

// ── Vapour diffusion ────────────────────────────────────────────────────────

export type DropMethodId = "hanging" | "sitting";

export type DropMethod = { id: DropMethodId; label: string; setup: string; pros: string[]; cons: string[] };

export const VAPOUR_DIFFUSION_STEPS = [
  "Mix protein with an equal volume of the reservoir solution, so the drop starts with half the reservoir's precipitant concentration.",
  "Seal the drop in the same closed well as the reservoir. They never touch; only water vapour moves between them.",
  "The reservoir has more precipitant, so water evaporates from the drop and condenses into the reservoir until both have the same water activity.",
  "The drop shrinks — with a 1:1 drop, to roughly half its volume — so protein and precipitant concentrations both rise slowly, about two-fold. That slow climb walks the drop into the supersaturated zone where crystals can nucleate.",
] as const;

export const DROP_METHODS: Record<DropMethodId, DropMethod> = {
  hanging: {
    id: "hanging", label: "Hanging drop",
    setup: "The drop hangs from the underside of a siliconized glass cover slip, sealed with grease over the reservoir.",
    pros: [
      "Excellent optics: you look through clean glass straight at the drop.",
      "Crystals are easy to reach and harvest once the cover slip is lifted.",
      "Inexpensive greased plates; the classic manual method for optimization.",
    ],
    cons: [
      "Slow to set up by hand and hard to automate; each well is sealed separately.",
      "Drops with detergent or organic solvents have low surface tension and spread or fall.",
      "Drop size is limited to a few microlitres.",
    ],
  },
  sitting: {
    id: "sitting", label: "Sitting drop",
    setup: "The drop sits on a raised shelf or post beside the reservoir; the whole plate is sealed with clear tape.",
    pros: [
      "Robot-friendly: 96-well plates with 100–200 nL drops make screening cheap in protein.",
      "Low-surface-tension drops (detergents, MPD) stay put — the usual choice for membrane proteins.",
      "Larger drops are possible for optimization.",
    ],
    cons: [
      "Crystals can stick to the plastic and be harder to harvest.",
      "Viewing through plastic and tape gives poorer optics than glass.",
      "Plastic plates cost more per well.",
    ],
  },
};

export const DROP_CITATIONS: CitationId[] = ["dessau2011", "chayen2008", "mcpherson2014"];

/** Every citation the panel can show, in reading order, for one reference list. */
export const GUIDANCE_CITATIONS: CitationId[] = [
  "mcpherson2014", "dessau2011", "hampton-index-guide", "pl-crystal-rules", "pdb2000", "chayen2008", "asherie2004", "jancarik1991",
  "newman2005", "md-jcsg-plus", "hampton-index", "hampton-pegion", "gorrec2009", "md-morpheus",
  "newstead2008", "parker2012", "md-memgold", "caffrey2015", "dale2003", "hassell2007", "mcpherson2006",
  "good1966", "graslund2008", "bondos2003", "getz1999", "vagenende2009", "seddon2004",
];
