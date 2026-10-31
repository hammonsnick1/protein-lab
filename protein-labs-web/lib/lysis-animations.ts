/**
 * Which mechanism animation the Cell lysis method window plays for each
 * method in the lysis catalogue, and the one-line caption that says in words
 * what the animation shows (so the motion is never the only explanation).
 */

export type LysisAnimationKind =
  | "sonication" | "homogenizer" | "bead-mill" | "enzymatic" | "detergent"
  | "dounce" | "nitrogen" | "osmotic" | "freeze-thaw";

export type LysisAnimation = { kind: LysisAnimationKind; caption: string };

export const lysisAnimationKinds: LysisAnimationKind[] = ["sonication", "homogenizer", "bead-mill", "enzymatic", "detergent", "dounce", "nitrogen", "osmotic", "freeze-thaw"];

/** Keyed by the `id` of each method in `lysisMethods`. */
export const lysisAnimations: Record<string, LysisAnimation> = {
  sonication: { kind: "sonication", caption: "The probe tip sends ultrasonic waves; cavitation bubbles form and collapse, and the shear tears cells open." },
  homogenizer: { kind: "homogenizer", caption: "Cells are pushed at high pressure through a narrow valve gap and come out as broken fragments." },
  "bead-mill": { kind: "bead-mill", caption: "Shaken beads collide with cells and crack even tough walls." },
  enzymatic: { kind: "enzymatic", caption: "Lysozyme digests the cell wall until the weakened cell releases its contents." },
  detergent: { kind: "detergent", caption: "Detergent molecules insert into the membrane and dissolve it into small micelles." },
  dounce: { kind: "dounce", caption: "A close-fitting pestle strokes up and down, shearing soft cells against the glass." },
  nitrogen: { kind: "nitrogen", caption: "Nitrogen dissolves into cells under pressure, then expands when the pressure is released and bursts them." },
  osmotic: { kind: "osmotic", caption: "A sudden change in tonicity swells the outer membrane and releases periplasmic proteins; the inner cell stays intact." },
  "freeze-thaw": { kind: "freeze-thaw", caption: "Ice crystals grow on freezing and pierce the membrane; on thawing the cell leaks its contents." },
};

export function lysisAnimationFor(methodId: string): LysisAnimation | null {
  return lysisAnimations[methodId] ?? null;
}
