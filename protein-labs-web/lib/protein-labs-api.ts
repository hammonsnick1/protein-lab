import type { ProjectDiff, ProjectTree } from "@/lib/project-tree-types";

// The desktop build substitutes this at bundle time; the web build leaves it
// undefined and falls back to the environment variable.
declare const __PROTEIN_LABS_API__: string | undefined;

import type { RegionsResponse, StructureDetail, StructureListResponse, StructureSource } from "./structure-regions.ts";
import type { ConservationJob, ConservationJobSummary } from "./conservation.ts";
import type { TaxonomySearchResponse } from "./organism-search.ts";

// An empty bundled value is meaningful: it means same-origin requests, so the
// chain tests for a defined string rather than a truthy one.
const bundledApi = typeof __PROTEIN_LABS_API__ === "string" ? __PROTEIN_LABS_API__ : undefined;
const environmentApi = typeof process !== "undefined" ? process.env?.NEXT_PUBLIC_PROTEIN_LABS_API : undefined;
export const API_BASE = bundledApi ?? environmentApi ?? "http://127.0.0.1:8770";

export type JsonObject = Record<string, unknown>;

export type ProteinRecord = {
  id: string;
  name: string;
  sequence: string;
  organism: string;
  /** NCBI taxon ID chosen from the organism suggestions; null for free text. */
  organismTaxonId?: number | null;
  geneName: string;
  description: string;
  expressionSystem: string;
  notes: string;
  tags: string[];
  externalIds: Record<string, string>;
  createdAt?: string;
  updatedAt?: string;
};

export type ProjectJob = {
  id: string;
  proteinId: string;
  name: string;
  appType: string;
  status: "ready" | "in_progress" | "complete";
  config: JsonObject;
  createdAt: string;
  updatedAt: string;
};

export type ProteinBundle = {
  protein: ProteinRecord;
  protparam: { result: JsonObject; analyzedAt: string } | null;
  blastJobs: JsonObject[];
  uniprotMatches: JsonObject[];
  pdbMatches: JsonObject[];
  alphaFoldModels: JsonObject[];
  // Summaries only — the per-residue grade profile is fetched per run. Older
  // engine builds predate the field, so treat it as possibly absent.
  conservationJobs?: ConservationJobSummary[];
  projectJobs: ProjectJob[];
  projectNotebook: { title: string; summary: string; sections: JsonObject[]; updatedAt: string } | null;
};

// Shapes returned by the vector engine. Coordinates are zero-based, half-open.
export type StructureScreen = { longestComplementaryRun: number; complementaryMotif: string; threePrimeComplementarity: number; risk: "low" | "moderate" | "high"; method: string; limitation: string };
export type DesignedPrimer = {
  id: string; name: string; sequence: string; annealingSequence: string; overhang: string;
  start: number; end: number; strand: number; cloningMethod: string;
  length: number; totalLength: number; gcPercent: number; tmCelsius: number; tmMethod: string;
  conditions: Record<string, number>; hairpin: StructureScreen; selfDimer: StructureScreen; heteroDimer: StructureScreen;
  targetTmCelsius: number; tmDeltaCelsius: number; withinGcLimits: boolean;
};
export type PrimerDesignRequest = {
  name: string; start: number; end: number; targetTmCelsius: number; minLength: number; maxLength: number;
  minGcPercent: number; maxGcPercent: number; cloningMethod: string; forwardOverhang: string; reverseOverhang: string;
};
export type EnzymeRow = {
  enzyme: string; recognitionSite: string; cutPositions: number[]; cutCount: number; insertCutCount: number;
  uniqueCutter: boolean; twoCutter: boolean; absentFromInsert: boolean; mcsFlanking: boolean;
  suppliers: string[]; methylationSensitive: string[]; end: { polarity: "blunt" | "5-prime" | "3-prime"; sequence: string };
};
export type EnzymeSets = { enzymes: EnzymeRow[]; sets: { uniqueCutters: string[]; twoCutters: string[]; mcsFlanking: string[]; absentFromInsert: string[] }; supplierFilter: string | null };
export type CloningMethod = "restriction-ligation" | "gibson" | "in-fusion" | "gateway-bp" | "gateway-lr";
export type CloningWarning = { code: string; message: string };
export type CloningPreview = {
  method: string;
  product: { sequence: string; circular: boolean; features: JsonObject[] } | null;
  junctions: JsonObject[]; warnings: CloningWarning[]; lostFeatures?: string[];
};
export type GelLane = { id: string; name: string; kind: "ladder" | "sample"; bands: { sizeBp: number; relativeMass: number }[] };
export type GelResult = { ladder: string; lanes: GelLane[]; migrationModel: string; sizeUnit: string };

export type BackendHealth ={ service: string; version: number; apps: string[]; database: string };

// Exported so feature-specific engine clients (chromatography, gels) share one
// transport, one error shape and one base URL instead of hand-rolling fetch.
// Shown when the engine cannot be reached at all. "connection" keeps the
// vector library's offline classification working.
export const ENGINE_UNREACHABLE_MESSAGE = "No connection to the local Protein Lab engine. Restart Protein Lab and try again.";

export async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_BASE}${path}`, {
      ...init,
      headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
    });
  } catch {
    // fetch rejects only when no response arrived at all, so the local engine
    // is not running. Say that instead of the browser's "Failed to fetch".
    throw new Error(ENGINE_UNREACHABLE_MESSAGE);
  }
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(errorText(body.error) ?? `Protein Lab returned ${response.status}`);
  return body as T;
}

// Older routes send `{error: "text"}`; newer ones `{error: {code, message}}`.
function errorText(error: unknown): string | undefined {
  if (typeof error === "string") return error;
  if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") return (error as { message: string }).message;
  return undefined;
}

const post = <T>(path: string, body: JsonObject = {}) => request<T>(path, { method: "POST", body: JSON.stringify(body) });
const patch = <T>(path: string, body: JsonObject) => request<T>(path, { method: "PATCH", body: JSON.stringify(body) });

export const proteinLabsApi = {
  health: () => request<BackendHealth>("/v1/health"),
  listProteins: () => request<{ proteins: ProteinRecord[] }>("/v1/protein-planner/proteins"),
  getProtein: (proteinId: string) => request<ProteinBundle>(`/v1/protein-planner/proteins/${proteinId}`),
  createProtein: (fields: Partial<ProteinRecord>) => post<ProteinBundle>("/v1/protein-planner/proteins", fields as JsonObject),
  updateProtein: (proteinId: string, fields: Partial<ProteinRecord>) => patch<ProteinBundle>(`/v1/protein-planner/proteins/${proteinId}`, fields as JsonObject),
  deleteProtein: (proteinId: string) => request<{ deleted: string }>(`/v1/protein-planner/proteins/${proteinId}`, { method: "DELETE" }),
  searchTaxonomy: (query: string, limit = 12) => request<TaxonomySearchResponse>(`/v1/taxonomy/search?${new URLSearchParams({ q: query, limit: String(limit) })}`),
  analyze: (proteinId: string) => post<{ result: JsonObject }>(`/v1/protein-planner/proteins/${proteinId}/analyze`),
  analyzeSequence: (sequence: string) => post<{ result: JsonObject }>("/v1/protein-planner/analyze-sequence", { sequence }),
  uniprot: (proteinId: string) => post<{ matches: JsonObject[] }>(`/v1/protein-planner/proteins/${proteinId}/uniprot/match`, { size: 25 }),
  searchUniProt: (proteinId: string, query: string, size = 10) => post<{ matches: JsonObject[] }>(`/v1/protein-planner/proteins/${proteinId}/uniprot/search`, { query, size }),
  fetchUniProt: (proteinId: string, accession: string) => post<{ match: JsonObject }>(`/v1/protein-planner/proteins/${proteinId}/uniprot/fetch`, { accession }),
  blast: (proteinId: string, purpose = "blast", database = "swissprot", hitlistSize = 25) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/blast`, { database, hitlistSize, purpose }),
  pollBlast: (rid: string) => request<JsonObject>(`/v1/protein-planner/blast/${encodeURIComponent(rid)}`),
  cancelBlast: (rid: string) => post<JsonObject>(`/v1/protein-planner/blast/${encodeURIComponent(rid)}/cancel`),
  pdb: (proteinId: string) => post<{ matches: JsonObject[] }>(`/v1/protein-planner/proteins/${proteinId}/pdb/search`, { identityCutoff: .3, evalueCutoff: .001, limit: 10 }),
  alphaFoldDb: (proteinId: string, accession = "") => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/alphafold/db`, { accession }),
  alphaFoldServer: (proteinId: string) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/alphafold/server-job`),
  importAlphaFold: (proteinId: string, path: string) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/alphafold/import`, { path }),
  getAlphaFoldModel: (proteinId: string, modelId: string) => request<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/alphafold/models/${encodeURIComponent(modelId)}`),
  // Structure Viewer: AlphaFold and experimental PDB entries, mmCIF + residue mapping, regions of interest.
  listStructures: (proteinId: string, limit = 10) => request<StructureListResponse>(`/v1/protein-planner/proteins/${proteinId}/structures?limit=${limit}`),
  getStructure: (proteinId: string, source: StructureSource, structureId: string) => request<StructureDetail>(`/v1/protein-planner/proteins/${proteinId}/structures/${source}/${encodeURIComponent(structureId)}`),
  getStructureRegions: (proteinId: string, source: StructureSource, structureId: string) => request<RegionsResponse>(`/v1/protein-planner/proteins/${proteinId}/structures/${source}/${encodeURIComponent(structureId)}/regions`),
  // ConSurf conservation. ConSurf has no job-submission API, so a new run is
  // prepared here, finished by the user in their browser and imported back;
  // ConSurf-DB lookups are answered straight away. See
  // protein-labs/backend/CONSERVATION_API.md.
  prepareConsurfJob: (proteinId: string) => post<ConservationJob>(`/v1/protein-planner/proteins/${proteinId}/conservation/consurf-job`),
  lookupConsurfDb: (proteinId: string, pdbId = "", chain = "") => post<ConservationJob>(`/v1/protein-planner/proteins/${proteinId}/conservation/consurf-db`, { pdbId, chain }),
  importConsurf: (proteinId: string, gradesPath: string, msaPath = "", jobId = "") => post<ConservationJob>(`/v1/protein-planner/proteins/${proteinId}/conservation/import`, { gradesPath, msaPath, jobId }),
  listConservation: (proteinId: string) => request<{ proteinId: string; jobs: ConservationJobSummary[]; colors: Record<string, string> }>(`/v1/protein-planner/proteins/${proteinId}/conservation`),
  getConservation: (proteinId: string, jobId: string) => request<ConservationJob>(`/v1/protein-planner/proteins/${proteinId}/conservation/${encodeURIComponent(jobId)}`),
  getConservationMsa: (proteinId: string, jobId: string) => request<{ fasta: string; available: boolean; sequenceCount: number; alignmentLength: number; queryId: string; ids: string[] }>(`/v1/protein-planner/proteins/${proteinId}/conservation/${encodeURIComponent(jobId)}/msa`),
  deleteConservation: (proteinId: string, jobId: string) => request<{ deleted: string }>(`/v1/protein-planner/proteins/${proteinId}/conservation/${encodeURIComponent(jobId)}`, { method: "DELETE" }),
  createJob: (proteinId: string, name: string, appType: string, config: JsonObject = {}) => post<ProjectJob>(`/v1/protein-planner/proteins/${proteinId}/jobs`, { name, appType, config }),
  updateJob: (proteinId: string, jobId: string, name: string, status: ProjectJob["status"], config: JsonObject) => patch<ProjectJob>(`/v1/protein-planner/proteins/${proteinId}/jobs/${jobId}`, { name, status, config }),
  deleteJob: (proteinId: string, jobId: string) => request<{ deleted: string }>(`/v1/protein-planner/proteins/${proteinId}/jobs/${jobId}`, { method: "DELETE" }),
  saveNotebook: (proteinId: string, title: string, summary: string, sections: JsonObject[]) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/notebook`, { title, summary, sections }),
  listVectors: (proteinId: string) => request<{ vectors: JsonObject[] }>(`/v1/protein-planner/proteins/${proteinId}/vectors`),
  createVector: (proteinId: string, vector: JsonObject) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors`, vector),
  updateVector: (proteinId: string, vectorId: string, vector: JsonObject) => patch<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors/${vectorId}`, vector),
  deleteVector: (proteinId: string, vectorId: string) => request<{ deleted: string }>(`/v1/protein-planner/proteins/${proteinId}/vectors/${vectorId}`, { method: "DELETE" }),
  importVector: (proteinId: string, filename: string, content: string) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors/import`, { filename, content }),
  vectorLibrary: () => request<{ vectors: JsonObject[] }>("/v1/protein-planner/vector-library"),
  // Catalogue search: `params` comes from librarySearchParams in lib/vector-library.
  searchVectorLibrary: (params: string) => request<{ vectors: JsonObject[]; total: number; limit: number; offset: number; facets: Record<string, { value: string; count: number }[]> }>(`/v1/protein-planner/vector-library?${params}`),
  recentLibraryVectors: (limit = 8) => request<{ vectors: JsonObject[] }>(`/v1/protein-planner/vector-library/recent?limit=${limit}`),
  setLibraryFavorite: (libraryId: string, favorite: boolean) => patch<JsonObject>(`/v1/protein-planner/vector-library/${encodeURIComponent(libraryId)}`, { favorite }),
  // Purified-protein library. `params` comes from librarySearchParams
  // in lib/protein-library; records and events are typed there.
  searchProteinLibrary: (params: string) => request<{ proteins: JsonObject[]; total: number; facets: Record<string, { value: string; count: number }[]> }>(`/v1/protein-planner/protein-library?${params}`),
  getLibraryProtein: (id: string) => request<JsonObject>(`/v1/protein-planner/protein-library/${encodeURIComponent(id)}`),
  createLibraryProtein: (fields: JsonObject) => post<JsonObject>("/v1/protein-planner/protein-library", fields),
  updateLibraryProtein: (id: string, fields: JsonObject) => patch<JsonObject>(`/v1/protein-planner/protein-library/${encodeURIComponent(id)}`, fields),
  deleteLibraryProtein: (id: string) => request<{ deleted: string }>(`/v1/protein-planner/protein-library/${encodeURIComponent(id)}`, { method: "DELETE" }),
  addLibraryProteinEvent: (id: string, event: { eventType: string; aliquotsUsed?: number; fromLocation?: string; toLocation?: string; notes?: string; occurredAt?: string }) => post<JsonObject>(`/v1/protein-planner/protein-library/${encodeURIComponent(id)}/events`, event),
  exportLibraryVector: (libraryId: string, format: "genbank" | "fasta") => request<{ filename: string; content: string }>(`/v1/protein-planner/vector-library/${encodeURIComponent(libraryId)}/export?format=${format}`),
  importLibraryVector: (filename: string, content: string) => post<JsonObject & { duplicate?: boolean }>("/v1/protein-planner/vector-library/import", { filename, content }),
  getLibraryVector: (libraryId: string) => request<JsonObject>(`/v1/protein-planner/vector-library/${encodeURIComponent(libraryId)}`),
  deleteLibraryVector: (libraryId: string) => request<{ deleted: string }>(`/v1/protein-planner/vector-library/${encodeURIComponent(libraryId)}`, { method: "DELETE" }),
  copyLibraryVector: (proteinId: string, libraryId: string) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors/library/${encodeURIComponent(libraryId)}`),
  // Library organisation: collections, tags, per-vector metadata, bulk actions, import review.
  updateLibraryVector: (libraryId: string, fields: JsonObject) => patch<JsonObject>(`/v1/protein-planner/vector-library/${encodeURIComponent(libraryId)}`, fields),
  duplicateLibraryVector: (libraryId: string) => post<JsonObject>(`/v1/protein-planner/vector-library/${encodeURIComponent(libraryId)}/duplicate`),
  restoreLibraryVector: (libraryId: string) => post<JsonObject>(`/v1/protein-planner/vector-library/${encodeURIComponent(libraryId)}/restore`),
  bulkLibraryAction: (body: JsonObject) => post<{ updated: string[]; skipped: (string | JsonObject)[]; affectedIds: string[]; vectors: JsonObject[] }>("/v1/protein-planner/vector-library/bulk", body),
  libraryCollections: () => request<{ collections: JsonObject[] }>("/v1/protein-planner/vector-library/collections"),
  createLibraryCollection: (name: string) => post<{ collection: JsonObject }>("/v1/protein-planner/vector-library/collections", { name }),
  updateLibraryCollection: (collectionId: string, fields: JsonObject) => patch<{ collection: JsonObject }>(`/v1/protein-planner/vector-library/collections/${encodeURIComponent(collectionId)}`, fields),
  deleteLibraryCollection: (collectionId: string) => request<{ deletedId: string }>(`/v1/protein-planner/vector-library/collections/${encodeURIComponent(collectionId)}`, { method: "DELETE" }),
  // POST, not PUT: the engine's CORS preflight does not allow PUT.
  reorderLibraryCollections: (ids: string[]) => post<{ collections: JsonObject[] }>("/v1/protein-planner/vector-library/collections/order", { ids }),
  previewLibraryImport: (files: { filename: string; content: string }[]) => post<{ files: JsonObject[] }>("/v1/protein-planner/vector-library/import/preview", { files }),
  commitLibraryImport: (files: { filename: string; content: string; resolution: string }[]) => post<{ files: JsonObject[] }>("/v1/protein-planner/vector-library/import/commit", { files }),
  vectorSources: () => request<{ sources: JsonObject[] }>("/v1/protein-planner/vector-sources"),
  vectorSourceSets: (source: string) => request<{ sets: JsonObject[] }>(`/v1/protein-planner/vector-sources/sets?source=${encodeURIComponent(source)}`),
  searchVectorSources: (source: string, query: string, set = "", limit = 25) => post<{ results: JsonObject[] }>("/v1/protein-planner/vector-sources/search", { source, query, set, limit }),
  loadVectorFromSource: (proteinId: string, source: string, identifier: string, set = "", name = "") => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors/load`, { source, identifier, set, name }),
  exportVector: (proteinId: string, vectorId: string, format: "genbank" | "fasta" | "snapgene") => request<{ filename: string; content: string; encoding?: "text" | "base64" }>(`/v1/protein-planner/proteins/${proteinId}/vectors/${vectorId}/export?format=${format}`),
  assembleVectors: (proteinId: string, name: string, vectorIds: string[], minimumOverlap: number, circular: boolean) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors/assemble`, { name, vectorIds, minimumOverlap, circular }),
  autoAnnotateVector: (proteinId: string, vectorId: string, minimumOrfAminoAcids = 50, includeOrfs = true) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors/${vectorId}/auto-annotate`, { minimumOrfAminoAcids, includeOrfs }),
  designVectorPrimers: (proteinId: string, vectorId: string, name: string, start: number, end: number, primerLength: number) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors/${vectorId}/primers`, { name, start, end, primerLength }),
  designTmPrimers: (proteinId: string, vectorId: string, request: PrimerDesignRequest) => post<JsonObject & { designedPrimers?: DesignedPrimer[] }>(`/v1/protein-planner/proteins/${proteinId}/vectors/${vectorId}/primers`, request as unknown as JsonObject),
  vectorEnzymeSets: (proteinId: string, vectorId: string, fields: { enzymeNames?: string[]; insertSequence?: string; insertVectorId?: string; mcs?: { start: number; end: number } | null; supplier?: string }) => post<EnzymeSets>(`/v1/protein-planner/proteins/${proteinId}/vectors/${vectorId}/enzyme-sets`, fields as JsonObject),
  cloningPreview: (proteinId: string, fields: { method: CloningMethod; backboneVectorId: string; insertVectorId: string } & JsonObject) => post<CloningPreview>(`/v1/protein-planner/proteins/${proteinId}/vectors/cloning-preview`, fields),
  simulateGel: (proteinId: string, ladder: "1kb" | "100bp", lanes: { id: string; name: string; vectorId?: string; enzymeNames?: string[]; bandSizes?: number[] }[]) => post<GelResult>(`/v1/protein-planner/proteins/${proteinId}/vectors/gel`, { ladder, lanes }),
  editVectorSequence: (proteinId: string, vectorId: string, operation: string, start: number, end: number, replacement = "") => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors/${vectorId}/edit`, { operation, start, end, replacement }),
  constructHosts: () => request<{ hosts: JsonObject[] }>("/v1/protein-planner/construct-hosts"),
  backTranslate: (protein: string, host: string, avoidEnzymes: string[] = []) => post<JsonObject>("/v1/protein-planner/back-translate", { protein, host, avoidEnzymes }),
  vectorInsertionSites: (proteinId: string, vectorId: string, enzymeNames: string[] = []) => post<{ sites: JsonObject[] }>(`/v1/protein-planner/proteins/${proteinId}/vectors/${vectorId}/insertion-sites`, { enzymeNames }),
  insertIntoVector: (proteinId: string, vectorId: string, fields: JsonObject) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors/${vectorId}/insert`, fields),
  digestVector: (proteinId: string, vectorId: string, enzymeNames: string[]) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors/${vectorId}/digest`, { enzymeNames }),
  alignVectors: (proteinId: string, vectorId: string, queryVectorId: string) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors/${vectorId}/align`, { queryVectorId }),
  // Vector Workbench: the same engine, without a project. SnapGene .dna
  // content travels base64 encoded both ways.
  parseVectorFile: (filename: string, content: string) => post<JsonObject & { fileFormat: string }>("/v1/vector-workbench/parse", { filename, content }),
  exportWorkbenchVector: (vector: JsonObject, format: "genbank" | "fasta" | "snapgene") => post<{ filename: string; content: string; encoding: "text" | "base64" }>("/v1/vector-workbench/export", { vector, format }),
  analyzeWorkbenchVector: (fields: { sequence: string; circular: boolean; enzymeNames?: string[]; minimumOrfAminoAcids?: number }) => post<{ restrictionSites: JsonObject[]; orfs: JsonObject[] }>("/v1/vector-workbench/analyze", fields),
  saveLibraryVectorAsNew: (vector: JsonObject) => post<JsonObject>("/v1/protein-planner/vector-library", vector),
  overwriteLibraryVector: (libraryId: string, vector: JsonObject) => post<JsonObject>(`/v1/protein-planner/vector-library/${encodeURIComponent(libraryId)}/contents`, vector),
  // Project trees and the project diff service. The tree response
  // embeds a one-line summary per branch so the tree view draws in one call;
  // the full diff is fetched lazily when a branch is selected.
  listProjectTrees: () => request<{ trees: ProjectTree[] }>("/v1/protein-planner/project-trees"),
  createProjectTree: (name: string, rootProjectId: string) => post<ProjectTree>("/v1/protein-planner/project-trees", { name, rootProjectId }),
  renameProjectTree: (treeId: string, name: string) => patch<ProjectTree>(`/v1/protein-planner/project-trees/${treeId}`, { name }),
  deleteProjectTree: (treeId: string) => request<{ deleted: string }>(`/v1/protein-planner/project-trees/${treeId}`, { method: "DELETE" }),
  createProjectBranch: (treeId: string, fromProjectId: string, toProjectId: string, note: string) => post<ProjectTree>(`/v1/protein-planner/project-trees/${treeId}/branches`, { fromProjectId, toProjectId, note }),
  updateProjectBranch: (treeId: string, branchId: string, fields: { fromProjectId?: string; note?: string }) => patch<ProjectTree>(`/v1/protein-planner/project-trees/${treeId}/branches/${branchId}`, fields),
  deleteProjectBranch: (treeId: string, branchId: string) => request<ProjectTree>(`/v1/protein-planner/project-trees/${treeId}/branches/${branchId}`, { method: "DELETE" }),
  // `confirmed` is the engine's durability handshake: only then may the
  // browser stop treating its localStorage copy as authoritative.
  importProjectTrees: (trees: JsonObject[]) => post<{ trees?: ProjectTree[]; imported?: number; skipped?: number; confirmed?: boolean }>("/v1/protein-planner/project-trees/import", { trees }),
  projectDiff: (fromProjectId: string, toProjectId: string) => request<ProjectDiff>(`/v1/protein-planner/project-diff?from=${encodeURIComponent(fromProjectId)}&to=${encodeURIComponent(toProjectId)}`),
};

export async function ensureProjectJob(proteinId: string, jobs: ProjectJob[], appType: string, name: string, config: JsonObject, status: ProjectJob["status"] = "complete") {
  const existing = jobs.find((job) => job.appType === appType);
  const job = existing ?? await proteinLabsApi.createJob(proteinId, name, appType);
  return proteinLabsApi.updateJob(proteinId, job.id, name, status, config);
}

export async function fileToBase64(file: File) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  let binary = "";
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  return btoa(binary);
}
