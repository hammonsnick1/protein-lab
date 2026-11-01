// How far a buffer pH sits from the protein's isoelectric point. Net charge,
// and with it solubility, is lowest at the pI, so purification handbooks keep
// working buffers at least 1 pH unit away (Cytiva, "Strategies for Protein
// Purification"; Scopes, "Protein Purification", ch. 2). Under 1 unit is a
// warning; under 0.5 unit blocks the save.
//
// The pI that matters is the one of the species in the buffer: the tagged
// fusion through lysis and capture, the cleaved product after the protease.
//
// Pure module: no runtime `@/` imports, so `node --test` can load it.
import type { Compatibility } from "./stage-buffer.ts";

export const PI_WARN_DISTANCE = 1.0;
export const PI_BLOCK_DISTANCE = 0.5;

/** A pI and the species it belongs to, as named in check text. */
export type PIReference = { pI: number; species: string };
/** The buffers to check: a step label, its pH (null when unset) and the pI that applies. */
export type PIEntry = { step: string; pH: number | null; reference: PIReference | null };

/** Buffer steps that hold the tagged fusion; every other step holds the cleaved product. */
export const captureSteps = ["lysis", "binding", "wash", "elution"];

/**
 * The pI for capture buffers and for buffers after cleavage, read from a saved
 * construct summary (`fusionProperties` / `cleavedProperties`). Without a
 * construct both fall back to the target's own pI.
 */
export function constructPIs(construct: Record<string, unknown> | null | undefined, targetPI: number | null): { capture: PIReference | null; downstream: PIReference | null } {
  const target = targetPI !== null && Number.isFinite(targetPI) && targetPI > 0 ? { pI: targetPI, species: "target" } : null;
  const read = (properties: unknown, species: string) => {
    const pI = Number((properties as Record<string, unknown> | null | undefined)?.pI);
    return Number.isFinite(pI) && pI > 0 ? { pI, species } : null;
  };
  const fusion = read(construct?.fusionProperties, "fusion");
  const capture = fusion ?? target;
  if (construct?.cleaves === false) return { capture, downstream: capture };
  return { capture, downstream: read(construct?.cleavedProperties, "cleaved product") ?? target };
}

/** "error" under 0.5 pH unit, "warning" under 1.0, else "pass". */
export function pIDistanceLevel(pH: number, pI: number): Compatibility["level"] {
  // Rounded to 0.01 so pH 7.5 against pI 6.5 counts as exactly one unit.
  const distance = Math.round(Math.abs(pH - pI) * 100) / 100;
  return distance < PI_BLOCK_DISTANCE ? "error" : distance < PI_WARN_DISTANCE ? "warning" : "pass";
}

/**
 * At most one blocking and one warning finding listing the offending buffers,
 * or a single pass. Entries with no pH or no pI are skipped; with none left
 * there is no finding at all.
 */
export function pIBufferChecks(entries: PIEntry[]): Compatibility[] {
  const checked = entries.filter((entry): entry is PIEntry & { pH: number; reference: PIReference } => entry.pH !== null && Number.isFinite(entry.pH) && entry.reference !== null);
  if (!checked.length) return [];
  const describe = (entry: PIEntry & { pH: number; reference: PIReference }) => `${entry.step} pH ${entry.pH} is ${(Math.round(Math.abs(entry.pH - entry.reference.pI) * 100) / 100).toFixed(2)} unit from the ${entry.reference.species} pI ${entry.reference.pI.toFixed(2)}`;
  const at = (level: Compatibility["level"]) => checked.filter((entry) => pIDistanceLevel(entry.pH, entry.reference.pI) === level).map(describe);
  const blocking = at("error"), close = at("warning");
  const checks: Compatibility[] = [];
  if (blocking.length) checks.push({ level: "error", title: "Buffer pH is too close to the pI", detail: `${blocking.join("; ")}. Under ${PI_BLOCK_DISTANCE} unit the protein carries almost no net charge and is likely to aggregate or precipitate; move the pH at least ${PI_WARN_DISTANCE} unit away.` });
  if (close.length) checks.push({ level: "warning", title: "Buffer pH is close to the pI", detail: `${close.join("; ")}. Keep working buffers at least ${PI_WARN_DISTANCE} pH unit from the pI, or raise the salt to limit aggregation.` });
  if (!checks.length) {
    const species = [...new Set(checked.map((entry) => `${entry.reference.species} pI ${entry.reference.pI.toFixed(2)}`))].join(", ");
    checks.push({ level: "pass", title: "Buffer pH is at least 1 unit from the pI", detail: `Every checked buffer is at least ${PI_WARN_DISTANCE} pH unit from the ${species}.` });
  }
  return checks;
}
