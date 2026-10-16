"use client";

import type { JsonObject } from "@/lib/protein-labs-api";
import { VectorLibrary } from "@/components/protein-labs/vector-library";

/**
 * Pick a vector backbone and load it into the project.
 *
 * This is the vector library in dialog form: the same search over the local
 * catalogue and the public collections (SnapGene, NCBI GenBank, Addgene) as
 * the library page, but every vector it loads goes straight into this project.
 */
export function VectorBackboneBrowser({
  proteinId,
  onLoaded,
  onClose,
}: {
  proteinId: string;
  onLoaded: (vector: JsonObject, note: string) => Promise<void> | void;
  onClose: () => void;
}) {
  return <VectorLibrary mode="dialog" projectId={proteinId} onLoaded={onLoaded} onClose={onClose}/>;
}
