// The desktop build substitutes this at bundle time; the web build leaves it
// undefined and falls back to the environment variable.
declare const __PROTEIN_LABS_API__: string | undefined;

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
  projectJobs: ProjectJob[];
  projectNotebook: { title: string; summary: string; sections: JsonObject[]; updatedAt: string } | null;
};

// Shapes returned by the vector engine (HOM-49). Coordinates are zero-based, half-open.
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

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_BASE}${path}`, {
    ...init,
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new Error(String(body.error ?? `Protein Lab returned ${response.status}`));
  return body as T;
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
  getLibraryVector: (libraryId: string) => request<JsonObject>(`/v1/protein-planner/vector-library/${encodeURIComponent(libraryId)}`),
  deleteLibraryVector: (libraryId: string) => request<{ deleted: string }>(`/v1/protein-planner/vector-library/${encodeURIComponent(libraryId)}`, { method: "DELETE" }),
  copyLibraryVector: (proteinId: string, libraryId: string) => post<JsonObject>(`/v1/protein-planner/proteins/${proteinId}/vectors/library/${encodeURIComponent(libraryId)}`),
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
  analyzeGel: (filename: string, imageBase64: string, sensitivity: number, lanes: JsonObject[] = []) => post<JsonObject>("/v1/gel/analyze", { filename, imageBase64, sensitivity, ...(lanes.length ? { lanes } : {}) }),
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
