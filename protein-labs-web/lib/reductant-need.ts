// Whether a purification buffer needs a reducing agent, read from the construct:
// a reductant only protects cysteines, so a construct with none does not need
// one. Also the one buffer-level clash a reductant brings: TCEP oxidizes in
// phosphate at neutral pH within days (Getz et al. 1999).
//
// Pure module: no runtime `@/` imports, so `node --test` can load it.
import type { BufferComponent } from "@/lib/purification-catalog";
import { findLibraryComponent, resolvePurpose } from "./buffer-component-library.ts";

type Config = Record<string, unknown>;

/** Cysteines in a one-letter protein sequence; null when there is no sequence. */
export function cysteineCount(sequence: unknown): number | null {
  const text = typeof sequence === "string" ? sequence.replace(/[^A-Za-z]/g, "") : "";
  return text ? (text.toUpperCase().match(/C/g)?.length ?? 0) : null;
}

/**
 * Cysteines in the protein a stage handles. Lysis and capture see the tagged
 * fusion; after tag cleavage (`afterCleavage`) a cleaving construct leaves the
 * cleaved product. Without a saved construct, the protein's own sequence.
 */
export function constructCysteines(construct: Config | null | undefined, proteinSequence: unknown, afterCleavage = false): number | null {
  const sequence = construct ? (afterCleavage && construct.cleaves === true ? construct.cleavedSequence : construct.fusionSequence) : null;
  return cysteineCount(sequence) ?? cysteineCount(proteinSequence);
}

/** A preset's components without its reducing agent when the construct has no cysteines. */
export function dropUnneededReductant(components: BufferComponent[], cysteines: number | null): BufferComponent[] {
  if (cysteines !== 0) return components;
  return components.filter((item) => resolvePurpose(findLibraryComponent(item.name), item.role) !== "reducing");
}

const isPhosphate = (item: BufferComponent) => findLibraryComponent(item.name)?.id === "sodium-phosphate" || /phosphate/i.test(item.name);
const isTcep = (item: BufferComponent) => findLibraryComponent(item.name)?.id === "tcep";

/** True when the buffer holds TCEP in a phosphate base. */
export function tcepInPhosphate(components: BufferComponent[]): boolean {
  return components.some(isTcep) && components.some(isPhosphate);
}

export const tcepPhosphateCaveat = "TCEP in phosphate buffer oxidizes within days at neutral pH. Add it fresh on the day, or use a HEPES or Tris base for a buffer that is stored.";
