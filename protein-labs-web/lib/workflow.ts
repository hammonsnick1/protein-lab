import type { JsonObject, ProjectJob, ProteinBundle } from "@/lib/protein-labs-api";

export type WorkflowJobDefinition = {
  id: string;
  appType: string;
  label: string;
  description: string;
  stage: "understand" | "plan" | "purify" | "analysis";
  color: string;
  requiredKey?: string;
};

export type WorkflowSectionDefinition = {
  id: WorkflowJobDefinition["stage"];
  label: string;
  description: string;
  color: string;
};

export const workflowSections: WorkflowSectionDefinition[] = [
  { id: "understand", label: "Understanding your protein", description: "Build a reliable sequence, evidence, and structure foundation before designing the experiment.", color: "#35b99a" },
  { id: "plan", label: "Plan your purification", description: "Choose the production system and design a compatible purification strategy.", color: "#6d7ff2" },
  { id: "purify", label: "Purify your protein", description: "Run the approved plan at the bench and keep a structured experimental record.", color: "#ef8f47" },
  { id: "analysis", label: "Analyze your purification", description: "Inspect chromatography and gel results without losing their project context.", color: "#b47bf3" },
];

export type WorkflowState = "completed" | "skipped" | "started" | "recommended" | "available";

export const workflowJobs: WorkflowJobDefinition[] = [
  { id: "sequence", appType: "protein-planner", label: "Protein sequence", description: "Add or revise the amino-acid sequence for this construct.", stage: "understand", color: "#35b99a" },
  { id: "properties", appType: "protparam", label: "Protein properties", description: "Calculate the complete ProtParam molecular and stability profile.", stage: "understand", color: "#7e9cff" },
  { id: "research", appType: "database-research", label: "Sequence research", description: "Collect BLAST, UniProt, PDB, PTM, and condition evidence.", stage: "understand", color: "#ffa84a" },
  { id: "reference-match", appType: "reference-match", label: "Choose reference match", description: "Select the closest biological reference so cofactors and PTMs come from one traceable UniProt record.", stage: "understand", color: "#f2c14e", requiredKey: "selectedAccession" },
  { id: "structure", appType: "alphafold", label: "Structure prediction", description: "Retrieve, import, and inspect an AlphaFold model.", stage: "understand", color: "#37dce8" },
  { id: "readiness", appType: "protein-readiness", label: "Protein readiness check", description: "Review membrane, cysteine, location, A₂₈₀, disorder, and cofactor risks.", stage: "understand", color: "#45c6a7", requiredKey: "reviewStatus" },
  { id: "expression-system", appType: "expression-system", label: "Choose expression system", description: "Compare bacterial, yeast, insect, and mammalian production hosts.", stage: "plan", color: "#e178d0", requiredKey: "strainId" },
  { id: "expression-vector", appType: "expression-planning", label: "Expression vector design", description: "Build, annotate, inspect, and document the expression plasmid.", stage: "plan", color: "#d98ae9" },
  { id: "purification-lysis", appType: "purification-lysis", label: "Cell lysis", description: "Choose a host-compatible disruption method, lysis buffer, and review incompatibilities.", stage: "plan", color: "#2bb7a9", requiredKey: "methodId" },
  { id: "purification-affinity", appType: "purification-affinity", label: "Affinity capture", description: "Choose a tag and matching capture resin or prepacked column.", stage: "plan", color: "#63b4ff", requiredKey: "columnId" },
  { id: "purification-cleavage", appType: "purification-cleavage", label: "Tag cleavage", description: "Choose a protease and document cleavage-site evidence.", stage: "plan", color: "#5aa9f2", requiredKey: "proteaseId" },
  { id: "purification-subtractive", appType: "purification-subtractive", label: "Subtractive cleanup", description: "Remove uncleaved fusion, released tag, and tagged protease by reverse affinity.", stage: "plan", color: "#468fda", requiredKey: "columnId" },
  { id: "purification-sec", appType: "purification-sec", label: "SEC polishing", description: "Match target size, injection volume, and buffer to a final size-exclusion column.", stage: "plan", color: "#756be8", requiredKey: "columnId" },
  { id: "purification-buffer", appType: "purification-buffer", label: "Buffer design", description: "Build editable buffers for each purification step.", stage: "plan", color: "#4d9de8", requiredKey: "presetId" },
  { id: "purification-workflow", appType: "purification-workflow", label: "Compile workflow", description: "Cross-check the complete design and generate a bench plan.", stage: "plan", color: "#3d91e8", requiredKey: "reviewStatus" },
  { id: "transformation-expression", appType: "transformation-expression", label: "Transformation and Expression", description: "Record the starting material, host-specific medium, culture conditions, and expression notes.", stage: "purify", color: "#ef8f47", requiredKey: "mediaId" },
  { id: "chromatogram", appType: "chromatogram-studio", label: "Chromatogram Studio", description: "Analyze purification traces, SEC standards, peaks, and figures.", stage: "analysis", color: "#b47bf3" },
  { id: "gel", appType: "gel-analysis", label: "Gel densitometry", description: "Analyze SDS-PAGE or Native PAGE lanes, Rf, MW, and purity.", stage: "analysis", color: "#7fcb81" },
];

export function definitionFor(value: string) {
  return workflowJobs.find((job) => job.id === value || job.appType === value) ?? workflowJobs[0];
}

export function savedByUser(job: ProjectJob) {
  return job.status === "complete" || job.config.savedByUser === true || job.config.skipped === true;
}

export function jobsFor(bundle: ProteinBundle, definition: WorkflowJobDefinition) {
  if (definition.appType === "protein-planner") return [];
  return bundle.projectJobs.filter((job) => job.appType === definition.appType);
}

export function isComplete(bundle: ProteinBundle, definition: WorkflowJobDefinition) {
  if (definition.appType === "protein-planner") return Boolean(bundle.protein.sequence);
  if (definition.appType === "protparam") return Boolean(bundle.protparam) && jobsFor(bundle, definition).some(savedByUser);
  const matches = jobsFor(bundle, definition);
  return matches.some((job) => {
    if (job.config.skipped === true) return true;
    if (job.status !== "complete") return false;
    return definition.requiredKey ? String(job.config[definition.requiredKey] ?? "").length > 0 : true;
  });
}

export function isSkipped(bundle: ProteinBundle, definition: WorkflowJobDefinition) {
  return jobsFor(bundle, definition).some((job) => job.status === "complete" && job.config.skipped === true);
}

export function visibleDefinitions(bundle: ProteinBundle) {
  return workflowJobs.filter((definition) => definition.appType === "protein-planner" || jobsFor(bundle, definition).some(savedByUser));
}

export function nextRecommended(bundle: ProteinBundle) {
  return workflowJobs.find((definition) => !isComplete(bundle, definition)) ?? workflowJobs.at(-1)!;
}

export function workflowState(bundle: ProteinBundle, definition: WorkflowJobDefinition): WorkflowState {
  if (isSkipped(bundle, definition)) return "skipped";
  if (isComplete(bundle, definition)) return "completed";
  if (nextRecommended(bundle).appType === definition.appType) return "recommended";
  if (jobsFor(bundle, definition).length) return "started";
  return "available";
}

export function buildSkipConfig(existing: JsonObject = {}) {
  return { ...existing, skipped: true, savedByUser: true, skipReason: "Skipped by user", skippedAt: new Date().toISOString() };
}
