import type { ProteinRecord } from "@/lib/protein-labs-api";

export type ProjectRelationship = {
  id: string;
  fromProjectId: string;
  toProjectId: string;
  changeType: string;
  description: string;
};

export type SavedProjectTree = {
  id: string;
  name: string;
  rootProjectId: string;
  relationships: ProjectRelationship[];
  createdAt: string;
  updatedAt: string;
};

export const PROJECT_TREES_KEY = "protein-labs-project-trees-v1";

export function readProjectTrees(proteins: ProteinRecord[] = []): SavedProjectTree[] {
  if (typeof window === "undefined") return [];
  try {
    const stored = localStorage.getItem(PROJECT_TREES_KEY);
    if (stored) {
      const parsed = JSON.parse(stored);
      return Array.isArray(parsed) ? parsed : [];
    }
  } catch { /* A damaged local record should not prevent Protein Lab from opening. */ }

  const legacyLinks = proteins.filter((protein) => protein.externalIds?.parentProteinId);
  if (!legacyLinks.length) return [];
  const roots = new Map<string, ProteinRecord[]>();
  for (const protein of legacyLinks) {
    const rootId = protein.externalIds.rootProteinId || protein.externalIds.parentProteinId;
    roots.set(rootId, [...(roots.get(rootId) ?? []), protein]);
  }
  const now = new Date().toISOString();
  const migrated = [...roots].map(([rootProjectId, children]) => ({
    id: crypto.randomUUID(),
    name: `${proteins.find((protein) => protein.id === rootProjectId)?.name ?? "Project"} relationships`,
    rootProjectId,
    relationships: children.map((protein) => ({
      id: crypto.randomUUID(),
      fromProjectId: protein.externalIds.parentProteinId || rootProjectId,
      toProjectId: protein.id,
      changeType: protein.externalIds.constructChangeType || "Construct change",
      description: protein.description || "Imported from the earlier construct-branch view.",
    })),
    createdAt: now,
    updatedAt: now,
  }));
  writeProjectTrees(migrated);
  return migrated;
}

export function writeProjectTrees(trees: SavedProjectTree[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROJECT_TREES_KEY, JSON.stringify(trees));
  window.dispatchEvent(new CustomEvent("protein-labs-project-trees-changed", { detail: trees }));
}

export function projectTreeStats(trees: SavedProjectTree[]) {
  return {
    trees: trees.length,
    branches: trees.reduce((total, tree) => total + tree.relationships.length, 0),
  };
}
