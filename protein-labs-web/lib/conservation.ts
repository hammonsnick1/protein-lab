// ConSurf conservation: the published 1-9 scale and the pure logic the
// conservation strip needs. The engine contract these mirror is documented in
// protein-labs/backend/CONSERVATION_API.md.

export type ConservationResidue = {
  position: number;
  residue: string;
  grade: number;
  score: number;
  insufficientData: boolean;
  confidenceInterval: [number, number] | null;
  confidenceGrades: [number, number] | null;
  alignedSequences: number | null;
  totalSequences: number | null;
  msaData: string | null;
  burialState: string;
  functionalState: string;
  residueVariety: string;
  varietyResidues: { residue: string; percent: number | null; belowOnePercent: boolean }[];
  atomLabel: string;
  pdbResidueNumber: string;
  pdbChain: string;
  modelled: boolean;
};

export type ConservationMetadata = {
  layout?: string;
  columns?: string[];
  gradeScale?: { grade: number; from: number; to: number }[];
  chains?: string[];
  residueCount?: number;
  gradedCount?: number;
  insufficientDataCount?: number;
  meanGrade?: number | null;
  skippedRowCount?: number;
  sequenceMatch?: {
    compared: boolean;
    queryLength: number;
    gradedLength?: number;
    identical: boolean | null;
    matchingResidues?: number;
    coverage: number | null;
  };
  gradedSequence?: string;
  msa?: { available: boolean; sequenceCount: number; alignmentLength: number; queryId: string; ids: string[] };
  // Prepared-submission fields.
  serverUrl?: string;
  files?: { kind: string; path: string; label: string; bytes: number; chain?: string; chains?: string[] }[];
  submissionDirectory?: string;
  steps?: string[];
  // ConSurf-DB lookup fields.
  matchedBy?: string;
  requestedPdbId?: string;
  requestedChain?: string;
  identicalPdbId?: string;
  identicalChain?: string;
  entryUrl?: string;
  importedFile?: string;
  msaFile?: string;
};

export type ConservationJobSummary = {
  id: string;
  proteinId: string;
  method: string;
  source: string;
  status: string;
  stage: string;
  pdbId: string;
  chain: string;
  querySequence: string;
  residueCount: number;
  error: string;
  createdAt: string;
  updatedAt: string;
  metadata: ConservationMetadata;
};

export type ConservationJob = ConservationJobSummary & { residues: ConservationResidue[] };

/** ConSurf's published scale: 9 most conserved, 1 most variable. */
export const CONSERVATION_COLORS: Record<string, string> = {
  "9": "#A02560",
  "8": "#F07DAB",
  "7": "#FAC9DE",
  "6": "#FCEDF4",
  "5": "#FFFFFF",
  "4": "#EAFFFF",
  "3": "#D7FFFF",
  "2": "#8CFFFF",
  "1": "#10C8D1",
  insufficient: "#FFFF96",
};

export const MIN_GRADE = 1;
export const MAX_GRADE = 9;

/** Grades 3-7 are near-white, so the strip needs ink the colour cannot carry. */
export function gradeColor(grade: number, insufficientData = false) {
  if (insufficientData) return CONSERVATION_COLORS.insufficient;
  return CONSERVATION_COLORS[String(clampGrade(grade))] ?? CONSERVATION_COLORS["5"];
}

/** A readable foreground for a grade's own background in both themes. */
export function gradeInk(grade: number, insufficientData = false) {
  if (insufficientData) return "#4a3c00";
  return clampGrade(grade) >= 8 ? "#ffffff" : "#23272f";
}

export function clampGrade(grade: number) {
  if (!Number.isFinite(grade)) return MIN_GRADE;
  return Math.min(MAX_GRADE, Math.max(MIN_GRADE, Math.round(grade)));
}

export function gradeLabel(grade: number) {
  const value = clampGrade(grade);
  if (value >= 8) return "highly conserved";
  if (value >= 6) return "conserved";
  if (value === 5) return "average";
  if (value >= 3) return "variable";
  return "highly variable";
}

/** The ordered legend, conserved first, with the insufficient-data entry last. */
export function gradeLegend() {
  const grades = Array.from({ length: MAX_GRADE }, (_, index) => MAX_GRADE - index).map((grade) => ({
    key: String(grade),
    grade,
    color: gradeColor(grade),
    ink: gradeInk(grade),
    label: gradeLabel(grade),
    insufficientData: false,
  }));
  return [...grades, {
    key: "insufficient",
    grade: 0,
    color: CONSERVATION_COLORS.insufficient,
    ink: gradeInk(0, true),
    label: "insufficient data",
    insufficientData: true,
  }];
}

export type ConservationSummary = {
  residueCount: number;
  gradedCount: number;
  insufficientDataCount: number;
  meanGrade: number | null;
  highlyConserved: number[];
  histogram: { grade: number; count: number; share: number }[];
  chains: string[];
  unmodelledCount: number;
};

/** Everything the summary row and the histogram need, from the residues alone. */
export function summarizeConservation(residues: ConservationResidue[]): ConservationSummary {
  const graded = residues.filter((residue) => !residue.insufficientData);
  const counts = new Map<number, number>();
  for (const residue of graded) {
    const grade = clampGrade(residue.grade);
    counts.set(grade, (counts.get(grade) ?? 0) + 1);
  }
  const histogram = Array.from({ length: MAX_GRADE }, (_, index) => {
    const grade = MAX_GRADE - index;
    const count = counts.get(grade) ?? 0;
    return { grade, count, share: graded.length ? count / graded.length : 0 };
  });
  return {
    residueCount: residues.length,
    gradedCount: graded.length,
    insufficientDataCount: residues.length - graded.length,
    meanGrade: graded.length
      ? Math.round((graded.reduce((total, residue) => total + residue.grade, 0) / graded.length) * 100) / 100
      : null,
    // The sites a scientist looks for first: grade 9 with enough data behind it.
    highlyConserved: graded.filter((residue) => residue.grade === MAX_GRADE).map((residue) => residue.position),
    histogram,
    chains: Array.from(new Set(residues.map((residue) => residue.pdbChain).filter(Boolean))).sort(),
    unmodelledCount: residues.filter((residue) => !residue.modelled).length,
  };
}

/** Runs of consecutive positions sharing a grade, for a compact description. */
export function conservedStretches(residues: ConservationResidue[], minimumGrade = 8, minimumLength = 3) {
  const stretches: { start: number; end: number; length: number; minGrade: number }[] = [];
  let current: { start: number; end: number; minGrade: number } | null = null;
  for (const residue of residues) {
    const eligible = !residue.insufficientData && residue.grade >= minimumGrade;
    if (eligible && current && residue.position === current.end + 1) {
      current.end = residue.position;
      current.minGrade = Math.min(current.minGrade, residue.grade);
      continue;
    }
    if (current) {
      const length = current.end - current.start + 1;
      if (length >= minimumLength) stretches.push({ ...current, length });
      current = null;
    }
    if (eligible) current = { start: residue.position, end: residue.position, minGrade: residue.grade };
  }
  if (current) {
    const length = current.end - current.start + 1;
    if (length >= minimumLength) stretches.push({ ...current, length });
  }
  return stretches;
}

/** How wide one residue column may be so `count` of them fit `width` pixels. */
export function stripColumnWidth(count: number, width: number, { min = 2, max = 18 } = {}) {
  if (count <= 0 || width <= 0) return max;
  return Math.min(max, Math.max(min, width / count));
}

/** Rows of residues for the wrapped strip, each row at most `perRow` wide. */
export function stripRows<T>(residues: T[], perRow: number): T[][] {
  const size = Math.max(1, Math.floor(perRow));
  const rows: T[][] = [];
  for (let index = 0; index < residues.length; index += size) rows.push(residues.slice(index, index + size));
  return rows;
}

/** The newest run that actually has grades, else the newest run of any kind. */
export function preferredJob<T extends { status: string; residueCount: number }>(jobs: T[]): T | undefined {
  return jobs.find((job) => job.status === "complete" && job.residueCount > 0) ?? jobs[0];
}

export function describeSource(job: { source: string; metadata: ConservationMetadata; pdbId: string; chain: string }) {
  if (job.source === "consurf-db") {
    const identical = job.metadata.identicalPdbId ?? "";
    const chain = job.metadata.identicalChain ?? "";
    const asked = [job.pdbId, job.chain].filter(Boolean).join(" chain ");
    const used = [identical, chain].filter(Boolean).join(" chain ");
    if (used && asked && used !== asked) return `ConSurf-DB · ${asked} via representative ${used}`;
    return `ConSurf-DB · ${used || asked || "pre-calculated"}`;
  }
  if (job.source === "consurf-server-import") return `Imported · ${job.metadata.importedFile || "ConSurf grades file"}`;
  return "ConSurf server submission";
}

export function formatCoverage(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "—";
  return `${(value * 100).toFixed(1)}%`;
}
