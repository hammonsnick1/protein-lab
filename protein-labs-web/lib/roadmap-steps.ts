// The purification roadmap's steps, as the roadmap board shows them: the live
// plan derived from the saved planning jobs, overlaid with the scientist's
// saved board (custom steps, order and edited titles).
//
// Shared by the roadmap board and by the gel studio, which binds a lane to one
// of these steps, so both list the same steps under the same ids. Only
// erasable TypeScript syntax and type-only imports are used, so the unit tests
// run under Node without a bundler.
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";

export type ComponentType = "buffer" | "chromatogram" | "gel" | "image" | "measurement" | "note";
export type BufferIngredient = { name: string; concentration: string; unit: string; role?: string };
export type RoadmapComponent = { id: string; type: ComponentType; title: string; notes: string; purpose?: string; pH?: string; ingredients?: BufferIngredient[]; sourceBufferKey?: string; sourceJobId?: string; fileName?: string; mimeType?: string; dataUrl?: string; yieldValue?: string; yieldUnit?: string; yieldMethod?: string; purityValue?: string; purityMethod?: string };
export type RoadmapStep = { id: string; title: string; instruction: string; record: string; ready: boolean; jobId: string; jobLabel: string; planDetails: string[]; components: RoadmapComponent[]; custom?: boolean };
/** A roadmap step a gel lane can be bound to, numbered as on the board. */
export type RoadmapStepOption = { id: string; number: number; title: string };

/** The steps the roadmap board shows for this protein, in board order. */
export function roadmapSteps(bundle: ProteinBundle): RoadmapStep[] {
  return mergeSavedSteps(liveSteps(bundle), bundle.projectJobs.find((job) => job.appType === "purification-roadmap")?.config.steps);
}

export function roadmapStepOptions(bundle: ProteinBundle): RoadmapStepOption[] {
  return roadmapSteps(bundle).map((value, index) => ({ id: value.id, number: index + 1, title: value.title }));
}

/**
 * The label for a lane's step binding. A binding is only ever set by the
 * scientist, so an id that is no longer on the roadmap is reported as such
 * rather than dropped or matched to a similar step.
 */
export function stageBindingLabel(stageId: string | null, options: RoadmapStepOption[]) {
  if (!stageId) return "Not bound to a step";
  const option = options.find((value) => value.id === stageId);
  return option ? `Step ${option.number} · ${option.title}` : `Step no longer on the roadmap (${stageId})`;
}

export function liveSteps(bundle: ProteinBundle): RoadmapStep[] {
  const expression = config(bundle, "expression-system"), vector = config(bundle, "expression-planning"), transformation = config(bundle, "transformation-expression"), lysis = config(bundle, "purification-lysis"), affinity = config(bundle, "purification-affinity"), cleavage = config(bundle, "purification-cleavage"), subtractive = config(bundle, "purification-subtractive"), sec = config(bundle, "purification-sec"), storageBuffer = finalStorageBuffer(bundle);
  const host = first(expression.strainName, transformation.hostName, "the selected production host"), media = first(transformation.mediaName, "the planned medium"), lysisMethod = first(lysis.methodName, "the selected lysis method"), affinityColumn = first(affinity.columnName, "the selected affinity medium"), protease = first(cleavage.proteaseName, cleavage.proteaseId, "the cleavage strategy"), retain = String(cleavage.proteaseId ?? "") === "retain", cleanup = first(subtractive.columnName, "the subtractive medium"), secColumn = first(sec.columnName, "the SEC column"), storage = first(storageBuffer?.name, "the storage buffer");
  return [
    step("transformation-expression", "Transformation and expression", `Begin the production run in ${host} using ${media}.`, "Starting material, medium, supplements, culture conditions, induction, harvest, and deviations.", Boolean(expression.strainId || transformation.mediaId), "transformation-expression", "Transformation and Expression", details(["Host", expression.strainName], ["Vector", vector.vectorName ?? expression.projectVectorName ?? expression.vectorFamilyName], ["Medium", transformation.mediaName])),
    step("lysis", "Cell lysis and clarification", `Disrupt the harvested material using ${lysisMethod}, then clarify before loading.`, "Pellet mass, resuspension volume, lysis settings, centrifugation, filtration, and retained samples.", Boolean(lysis.methodId), "purification-lysis", "Cell lysis job", details(["Method", lysis.methodName], ["Buffer", lysis.bufferName])),
    step("affinity", "Affinity capture", `Capture the target with ${affinityColumn}; retain load, flow-through, wash, and elution fractions.`, "Column, load amount, flow, washes, elution, fraction IDs, recovery, and purity.", Boolean(affinity.columnId), "purification-affinity", "Affinity capture job", details(["Column", affinity.columnName], ["Tag", affinity.tag])),
    step("cleavage", retain ? "Retain affinity tag" : "Affinity-tag cleavage", retain ? "The current plan keeps the affinity tag on the final construct." : `Exchange into compatible buffer and cleave with ${protease}.`, "Reaction conditions, completion, samples, and downstream tag/protease removal.", Boolean(cleavage.proteaseId), "purification-subtractive", "Protease choice · Subtractive cleanup job", details(["Strategy", cleavage.proteaseName ?? cleavage.proteaseId], ["Conditions", cleavage.conditions])),
    step("subtractive", "Subtractive cleanup", retain ? "Optional in the current tag-retention plan." : `Pass the cleavage mixture over ${cleanup} and collect the target fraction.`, "Load, flow-through, wash, elution, recovery, purity, and evidence of contaminant removal.", retain || Boolean(subtractive.columnId), "purification-subtractive", "Subtractive cleanup job", details(["Column", subtractive.columnName], ["Buffer", subtractive.bufferName])),
    step("sec", "SEC polishing", `Polish the target on ${secColumn} and associate the chromatogram with this step.`, "Sample concentration and volume, flow, trace, fractions, yield, purity, and oligomeric state.", Boolean(sec.columnId), "purification-sec", "SEC polishing job", details(["Column", sec.columnName], ["Buffer", sec.bufferName], ["Expected mass", sec.expectedMassKDa ? `${sec.expectedMassKDa} kDa` : ""])),
    step("quality-storage", "Quality control and storage", `Confirm quality before transferring into ${storage}.`, "Final concentration, yield, purity, identity, activity, storage, aliquots, freeze–thaw history, gels, and images.", Boolean(storageBuffer), "purification-sec", "Storage buffer · SEC polishing job", details(["Storage buffer", storageBuffer && (storageBuffer.pH ? `${storageBuffer.name}, pH ${storageBuffer.pH}` : storageBuffer.name)])),
  ];
}
/**
 * The final storage buffer, as the SEC polishing job saved it. Projects from
 * before per-job buffers kept a named preset on the shared buffer record; the
 * "per-job" marker on that record is not a buffer and is never reported.
 */
export function finalStorageBuffer(bundle: ProteinBundle): { name: string; pH: string } | null {
  const sec = config(bundle, "purification-sec"), legacy = config(bundle, "purification-buffer");
  if (sec.bufferId || sec.bufferStep) return { name: `${first(sec.bufferName, "Composed storage buffer")}${sec.bufferEdited === true ? " (edited)" : ""}`, pH: first(sec.bufferPH) };
  if (legacy.presetId && legacy.presetId !== "per-job") return { name: first(legacy.presetName, legacy.presetId), pH: "" };
  return null;
}
function step(id: string, title: string, instruction: string, record: string, ready: boolean, jobId: string, jobLabel: string, planDetails: string[]): RoadmapStep { return { id, title, instruction, record, ready, jobId, jobLabel, planDetails, components: [] }; }
export function config(bundle: ProteinBundle, appType: string): JsonObject { return bundle.projectJobs.find((job) => job.appType === appType)?.config ?? {}; }
export function first(...values: unknown[]) { return String(values.find((value) => value !== null && value !== undefined && String(value).trim()) ?? ""); }
function details(...rows: [string, unknown][]) { return rows.filter(([, value]) => value !== null && value !== undefined && String(value).trim()).map(([label, value]) => `${label}: ${String(value)}`); }
export function mergeSavedSteps(base: RoadmapStep[], raw: unknown): RoadmapStep[] {
  if (!Array.isArray(raw)) return base;
  const saved = raw.filter((value): value is JsonObject => Boolean(value) && typeof value === "object" && !Array.isArray(value));
  const restored = saved.map((prior) => {
    const id = String(prior.id ?? `added-${crypto.randomUUID()}`), live = base.find((value) => value.id === id);
    const components = Array.isArray(prior.components) ? prior.components.filter((item): item is RoadmapComponent => Boolean(item) && typeof item === "object" && !Array.isArray(item)).map((item) => ({ ...item, ingredients: Array.isArray(item.ingredients) ? item.ingredients : [] })) : [];
    if (live) return { ...live, title: String(prior.title ?? live.title), instruction: String(prior.instruction ?? live.instruction), record: String(prior.record ?? live.record), components };
    return { id, title: String(prior.title ?? "Custom purification step"), instruction: String(prior.instruction ?? "User-defined purification operation."), record: String(prior.record ?? "Record conditions, outcome, and deviations."), ready: prior.ready === true, jobId: String(prior.jobId ?? ""), jobLabel: String(prior.jobLabel ?? "User-defined step"), planDetails: Array.isArray(prior.planDetails) ? prior.planDetails.map(String) : [], components, custom: true } satisfies RoadmapStep;
  });
  const restoredIds = new Set(restored.map((value) => value.id));
  return [...restored, ...base.filter((value) => !restoredIds.has(value.id))];
}
export function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }

/**
 * Moves the item at `from` so it lands at insertion point `insertion`, counted
 * in the list before the move (0 is before the first item, length after the
 * last). Dropping an item on either side of itself leaves the order unchanged.
 */
export function moveStep<T>(items: T[], from: number, insertion: number): T[] {
  if (from < 0 || from >= items.length) return items;
  const target = Math.max(0, Math.min(insertion, items.length)), next = [...items], [moved] = next.splice(from, 1);
  next.splice(from < target ? target - 1 : target, 0, moved);
  return next;
}

/** A buffer recipe shown on a roadmap column; empty `ingredients` means not saved yet. */
export type StepBuffer = { id: string; label: string; pH: string; ingredients: BufferIngredient[] };
const stepBufferIds: Record<string, string[]> = { lysis: ["lysis"], affinity: ["binding", "wash", "elution"], cleavage: ["cleavage"], subtractive: ["cleavage"], sec: ["storage"] };
const stepBufferLabels: Record<string, string> = { lysis: "Lysis", binding: "Binding", wash: "Wash", elution: "Elution", cleavage: "Cleavage / cleanup", storage: "SEC running / storage" };
// Where each buffer lives on its own job's config, for projects saved before
// the shared purification-buffer record held it.
function ownJobBuffer(bundle: ProteinBundle, id: string): JsonObject {
  if (["binding", "wash", "elution"].includes(id)) return object(object(config(bundle, "purification-affinity").buffers)[id]);
  const appType = ({ lysis: "purification-lysis", cleavage: "purification-subtractive", storage: "purification-sec" } as Record<string, string | undefined>)[id];
  if (!appType) return {};
  const job = config(bundle, appType);
  return { pH: job.bufferPH ?? null, components: job.bufferComponents ?? null };
}

/**
 * The buffers used at a planned step, read from the shared purification-buffer
 * record (with the owning job's own buffer as a fallback for older projects).
 * Custom steps, steps without a buffer and a retained-tag cleavage step
 * return an empty list.
 */
export function stepBuffers(bundle: ProteinBundle, stepId: string): StepBuffer[] {
  // A plan that keeps the tag has no cleavage reaction to make a buffer for.
  if (stepId === "cleavage" && String(config(bundle, "purification-cleavage").proteaseId ?? "") === "retain") return [];
  const shared = object(config(bundle, "purification-buffer").steps);
  return (stepBufferIds[stepId] ?? []).map((id) => {
    const record = object(shared[id]), source = bufferIngredients(record.components).some((item) => item.name) ? record : ownJobBuffer(bundle, id);
    return { id, label: stepBufferLabels[id], pH: first(source.pH), ingredients: bufferIngredients(source.components).filter((item) => item.name) };
  });
}
export function bufferIngredients(value: unknown): BufferIngredient[] { return Array.isArray(value) ? value.filter((item) => item && typeof item === "object" && !Array.isArray(item)).map((raw) => { const item = raw as JsonObject; return { name: String(item.name ?? ""), concentration: String(item.concentration ?? ""), unit: String(item.unit ?? ""), role: String(item.role ?? "") }; }) : []; }
/** "50 mM Tris-HCl" — one ingredient as it is written on a bench recipe. */
export function ingredientLabel(item: BufferIngredient) { return [item.concentration, item.unit, item.name].map((value) => value.trim()).filter(Boolean).join(" "); }
