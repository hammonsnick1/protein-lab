import type { ConstructReport } from "@/components/protein-labs/construct-designer";
import { defaultLayoutFor, findTagModule, junctionOptions, linkerOptions, tagModuleForAffinityTag, type ConstructPlan } from "@/lib/construct-catalog";
import type { JsonObject } from "@/lib/protein-labs-api";

/** The tag, linker and position saved by Affinity capture, falling back to
 *  the tag module that matches the chosen resin. */
export function initialPlan(saved: JsonObject, affinityTag: string): ConstructPlan {
  const stored = saved.constructPlan as JsonObject | undefined;
  const derived = tagModuleForAffinityTag(affinityTag);
  const tagId = String(stored?.tagId ?? derived?.id ?? "");
  const cleavageId = String(stored?.cleavageId ?? "");
  const terminus = stored?.terminus === "C" ? "C" : stored?.terminus === "N" ? "N" : derived?.terminus ?? "N";
  // A saved plan reopens exactly as it was built. Plans saved before the
  // junction existed had none, and "gs" was the old default linker; only a
  // project with no saved plan starts from the house layout.
  const layout = stored ? { linkerId: "gs", junctionId: "none" } : defaultLayoutFor(tagId, cleavageId, terminus);
  return {
    terminus,
    initiatorMet: stored?.initiatorMet === undefined ? true : stored.initiatorMet === true,
    tagId,
    linkerId: String(stored?.linkerId ?? layout.linkerId),
    junctionId: String(stored?.junctionId ?? layout.junctionId),
    cleavageId,
    resolvedTagSequence: String(stored?.resolvedTagSequence ?? ""),
    resolvedTagSource: String(stored?.resolvedTagSource ?? ""),
  };
}

export function planConfig(plan: ConstructPlan): JsonObject {
  return { terminus: plan.terminus, initiatorMet: plan.initiatorMet, tagId: plan.tagId, linkerId: plan.linkerId, junctionId: plan.junctionId ?? "none", cleavageId: plan.cleavageId, resolvedTagSequence: plan.resolvedTagSequence ?? "", resolvedTagSource: plan.resolvedTagSource ?? "" };
}

/** Everything later jobs and reports need about the assembled construct. */
export function constructSummary(report: ConstructReport | null): JsonObject | null {
  if (!report) return null;
  const { construct, plan } = report;
  return {
    terminus: plan.terminus, tagId: plan.tagId, tagName: findTagModule(plan.tagId)?.name ?? null,
    linkerId: plan.linkerId, linkerName: linkerOptions.find((option) => option.id === plan.linkerId)?.name ?? null,
    junctionId: plan.junctionId ?? "none",
    junctionSequence: junctionOptions.find((option) => option.id === (plan.junctionId ?? "none"))?.sequence ?? "",
    cleavageId: plan.cleavageId,
    cleaves: construct.cleaves, scar: construct.scar, unresolvedTag: construct.unresolvedTag?.name ?? null, resolvedTagSource: plan.resolvedTagSource ?? null,
    fusionSequence: construct.fusion, cleavedSequence: construct.cleaved, releasedSequence: construct.released,
    segments: construct.segments.map((segment) => ({ label: segment.label, kind: segment.kind, sequence: segment.sequence, start: segment.start, end: segment.end, retained: segment.retained })),
    warnings: construct.warnings,
    fusionProperties: report.fusion as unknown as JsonObject | null,
    cleavedProperties: report.cleaved as unknown as JsonObject | null,
    releasedProperties: report.released as unknown as JsonObject | null,
  };
}
