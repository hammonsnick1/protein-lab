// A still PNG of a saved model for the printed report. A live 3D canvas does
// not print and is too heavy to keep on a page of paper, so Mol* draws the
// model once in an off-screen host and is disposed straight after.
import { structurePaletteForKey } from "@/lib/structure-palettes";

export type StructureSnapshot = { dataUri: string; /** Coloured by per-residue pLDDT rather than by chain. */ confidence: boolean };

const SIZE = 640;
const rendered = new Map<string, Promise<StructureSnapshot>>();

/** Renders (once per key) a cartoon of the model on white, cropped to the molecule. */
export function structureSnapshot(key: string, structureText: string, paletteKey: string): Promise<StructureSnapshot> {
  const cached = rendered.get(key);
  if (cached) return cached;
  const next = render(structureText, paletteKey);
  rendered.set(key, next);
  // A failed render may succeed later (WebGL context lost, model re-fetched), so it is not kept.
  next.catch(() => rendered.delete(key));
  return next;
}

async function render(structureText: string, paletteKey: string): Promise<StructureSnapshot> {
  const { MolstarStage } = await import("./molstar-stage");
  const host = document.createElement("div");
  // Laid out (WebGL needs a real size) but outside the window and out of the accessibility tree.
  host.setAttribute("aria-hidden", "true");
  Object.assign(host.style, { position: "fixed", left: `-${SIZE * 2}px`, top: "0", width: `${SIZE}px`, height: `${SIZE}px`, pointerEvents: "none" });
  document.body.append(host);
  let stage: Awaited<ReturnType<typeof MolstarStage.create>> | null = null;
  try {
    stage = await MolstarStage.create(host, { highlight: "#f1c85d", select: "#dc5c48", region: "#dc5c48" });
    const { hasConfidence } = await stage.load(structureText, "Structure");
    await stage.setStyle({ representation: "cartoon", color: hasConfidence ? "plddt-confidence" : "chain-id", showLigands: true, showWaters: false, spin: false }, structurePaletteForKey(paletteKey).colors);
    await stage.frameForImage();
    return { dataUri: await stage.imageDataUri({ autocrop: true }), confidence: hasConfidence };
  } finally {
    stage?.dispose();
    host.remove();
  }
}
