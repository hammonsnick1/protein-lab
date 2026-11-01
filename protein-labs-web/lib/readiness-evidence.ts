// Answers for the readiness check's membrane and disorder questions, drawn
// from the strongest evidence the project holds. Positions are one-based
// construct positions unless a field says "model".

export type ReadinessAnswer = "Not reviewed" | "Yes" | "No" | "Needs follow-up";
export type WindowEvidence = { start: number; end: number; score: number; sequence: string } | null;

/** Shape of `modelConfidence` from GET …/readiness/evidence (STRUCTURE_API.md). */
export type ModelConfidence = {
  modelId: string; source: string; accession: string; name: string; error: string;
  threshold?: number; minimumRunLength?: number; meanPlddt?: number | null; modelResidueCount?: number;
  lowConfidenceResidueCount?: number; shortLowConfidenceRuns?: number; mismatches?: number;
  lowConfidenceRegions?: { modelStart: number; modelEnd: number; length: number; constructStart: number | null; constructEnd: number | null; meanPlddt: number }[];
  constructResiduesNotInModel?: { start: number; end: number }[];
};
export type ConservationEvidence = { jobId: string; source: string; pdbId: string; chain: string; identicalPdbId: string; identicalChain: string; constructGrades: string; gradedConstructResidues: number };
export type ReadinessStructureEvidence = { proteinId: string; constructLength: number; modelConfidence: ModelConfidence | null; conservation: ConservationEvidence | null };

export type Assessment = { answer: ReadinessAnswer; basis: "uniprot" | "plddt" | "composition" | "hydrophobic-window" | "none" | "pending"; detail: string };

/** Composition-screen cut-offs; triage only. */
export const MEMBRANE_WINDOW_FLAG = 0.52;
export const DISORDER_WINDOW_FLAG = 0.43;

export function assessMembrane(input: { referenceAccession: string; transmembraneCount: number; hydrophobic: WindowEvidence }): Assessment {
  const { referenceAccession, transmembraneCount, hydrophobic } = input;
  if (transmembraneCount) return { answer: "Yes", basis: "uniprot", detail: `${transmembraneCount} membrane-spanning region(s) reported by the selected UniProt reference.` };
  if (hydrophobic && hydrophobic.score >= MEMBRANE_WINDOW_FLAG) return { answer: "Needs follow-up", basis: "hydrophobic-window", detail: `A hydrophobic composition screen flagged residues ${hydrophobic.start}–${hydrophobic.end}; confirm with a dedicated topology predictor.` };
  const windowText = hydrophobic ? `the strongest hydrophobic window (${hydrophobic.start}–${hydrophobic.end}) scores ${hydrophobic.score.toFixed(3)}, below the ${MEMBRANE_WINDOW_FLAG} flag` : "the construct is too short for the hydrophobic window screen";
  // Without a reference there is no annotation to be absent, so the screen alone cannot settle it.
  if (!referenceAccession) return { answer: "Not reviewed", basis: "none", detail: `No reference is selected, and ${windowText}. Select a UniProt reference before answering.` };
  return { answer: "No", basis: "none", detail: `No evidence of a transmembrane segment: ${referenceAccession} annotates none, and ${windowText}. Absence of evidence is not proof that the protein is soluble.` };
}

/**
 * Disorder answer. UniProt annotation wins; otherwise a saved model's pLDDT
 * decides; the composition window is used only when there is no readable
 * model. `model` is `undefined` while the evidence is still loading.
 */
export function assessDisorder(input: { referenceAccession: string; disorderedCount: number; model: ModelConfidence | null | undefined; window: WindowEvidence; conservation: ConservationEvidence | null }): Assessment {
  const { referenceAccession, disorderedCount, model, window, conservation } = input;
  if (disorderedCount) return { answer: "Yes", basis: "uniprot", detail: `${disorderedCount} disordered region(s) reported by the selected UniProt reference.` };
  if (model === undefined) return { answer: "Not reviewed", basis: "pending", detail: "Reading per-residue confidence from the saved structure model…" };
  if (model && !model.error && model.lowConfidenceRegions) {
    const threshold = model.threshold ?? 50, run = model.minimumRunLength ?? 10;
    const label = `${model.modelId} (${model.source}${model.meanPlddt == null ? "" : `, mean pLDDT ${model.meanPlddt.toFixed(1)}`})`;
    const outside = (model.constructResiduesNotInModel ?? []).map(range);
    const outsideText = outside.length ? ` Construct residues ${outside.join(", ")} are not in the model and were not assessed.` : "";
    const regions = model.lowConfidenceRegions;
    if (!regions.length) {
      const annotation = referenceAccession ? `, and ${referenceAccession} annotates no disordered region` : "";
      return { answer: "No", basis: "plddt", detail: `${label} has no stretch of ${run} or more residues below pLDDT ${threshold}${annotation}. The composition screen is not used when a model exists.${outsideText}` };
    }
    const listed = regions.map((region) => {
      const where = region.constructStart == null ? `model ${region.modelStart}–${region.modelEnd}, outside the construct` : `${range({ start: region.constructStart, end: region.constructEnd ?? region.constructStart })} (model ${region.modelStart}–${region.modelEnd})`;
      const grade = region.constructStart == null ? null : meanGrade(conservation, region.constructStart, region.constructEnd ?? region.constructStart);
      return `${where}, mean pLDDT ${region.meanPlddt.toFixed(1)}${grade ? `, ${gradeText(grade)}` : ""}`;
    });
    return { answer: "Yes", basis: "plddt", detail: `${label} has ${regions.length} stretch(es) of ${run} or more residues below pLDDT ${threshold}: ${listed.join("; ")}.${outsideText}` };
  }
  const why = model?.error ? `The structure model ${model.modelId} could not be read (${model.error}), so` : "There is no structure model in this project, so";
  if (window && window.score >= DISORDER_WINDOW_FLAG) {
    const grade = meanGrade(conservation, window.start, window.end);
    return { answer: "Needs follow-up", basis: "composition", detail: `${why} a composition screen was used: it flagged residues ${window.start}–${window.end}${grade ? ` (${gradeText(grade)})` : ""}. Import an AlphaFold model or run a disorder predictor to confirm.` };
  }
  return { answer: "Not reviewed", basis: "none", detail: `${why} only a composition screen is available, and it found no strong flag. This local screen is not a disorder predictor.` };
}

/** Best-scoring window of (positive − negative residues) / window length; a local triage screen. */
export function windowScreen(sequence: string, minimum: number, maximumWindow: number, positive: string, negative: string): WindowEvidence { if (sequence.length < minimum) return null; const window = Math.min(maximumWindow, sequence.length); let best: NonNullable<WindowEvidence> | null = null; for (let start = 0; start <= sequence.length - window; start++) { const segment = sequence.slice(start, start + window); const score = ([...segment].filter((aa) => positive.includes(aa)).length - [...segment].filter((aa) => negative.includes(aa)).length) / window; if (!best || score > best.score) best = { start: start + 1, end: start + window, score, sequence: segment }; } return best; }
export const hydrophobicWindow = (sequence: string) => windowScreen(sequence, 15, 21, "AILMFWVY", "DEKR");
export const disorderWindow = (sequence: string) => windowScreen(sequence, 20, 30, "PESTQKRGND", "AILMFWVY");

/** Mean ConSurf grade over construct residues start–end, ignoring ungraded positions. */
export function meanGrade(conservation: ConservationEvidence | null, start: number, end: number): { mean: number; graded: number; total: number } | null {
  if (!conservation) return null;
  const grades = [...conservation.constructGrades.slice(start - 1, end)].filter((value) => value >= "1" && value <= "9").map(Number);
  return grades.length ? { mean: grades.reduce((sum, value) => sum + value, 0) / grades.length, graded: grades.length, total: end - start + 1 } : null;
}

export function conservationSummary(conservation: ConservationEvidence | null): string[] {
  if (!conservation) return [];
  const entry = `${conservation.pdbId}${conservation.chain ? ` chain ${conservation.chain}` : ""}${conservation.identicalPdbId && conservation.identicalPdbId !== conservation.pdbId ? ` (via ${conservation.identicalPdbId})` : ""}`;
  const whole = meanGrade(conservation, 1, conservation.constructGrades.length);
  return [`ConSurf ${entry} · ${conservation.gradedConstructResidues} of ${conservation.constructGrades.length} construct residues graded${whole ? ` · mean grade ${whole.mean.toFixed(1)}` : ""}`];
}

export function modelConfidenceSummary(model: ModelConfidence | null | undefined): string[] {
  if (!model) return [];
  if (model.error) return [`${model.modelId} · could not be read: ${model.error}`];
  const regions = model.lowConfidenceRegions ?? [];
  return [
    `${model.modelId} · ${model.source} · mean pLDDT ${model.meanPlddt?.toFixed(1) ?? "—"} · ${model.lowConfidenceResidueCount ?? 0} of ${model.modelResidueCount ?? 0} residues below ${model.threshold ?? 50}`,
    ...regions.map((region) => `Low confidence · model ${region.modelStart}–${region.modelEnd}${region.constructStart == null ? "" : ` · construct ${region.constructStart}–${region.constructEnd}`} · mean pLDDT ${region.meanPlddt.toFixed(1)}`),
  ];
}

function range(value: { start: number; end: number }) { return value.start === value.end ? String(value.start) : `${value.start}–${value.end}`; }
function gradeText(grade: { mean: number; graded: number; total: number }) { return `ConSurf mean grade ${grade.mean.toFixed(1)} of 9 over ${grade.graded}/${grade.total} graded residues`; }
