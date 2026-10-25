import type { ProteinRecord } from "./protein-labs-api.ts";
import type { ChangeCategory, ProjectTree, ProjectTreeBranch } from "./project-tree-types.ts";
import { isChangeCategory } from "./project-tree-types.ts";

/** The older localStorage record. Still read once, for the import. */
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
/** Set once the engine has accepted the localStorage trees, so we never re-import. */
export const PROJECT_TREES_IMPORTED_KEY = "protein-labs-project-trees-imported-v1";
export const PROJECT_TREES_CHANGED_EVENT = "protein-labs-project-trees-changed";

const LEGACY_CATEGORIES: Record<string, ChangeCategory> = {
  "construct change": "sequence",
  "sequence change": "sequence",
  "vector change": "vector",
  "host change": "host",
  "tag change": "tag",
  "purification change": "purification",
  "assay change": "assay",
};

/** Map a free-text legacy `changeType` onto a change category. */
export function categoryFromChangeType(changeType: string): ChangeCategory {
  const key = changeType.trim().toLowerCase();
  if (isChangeCategory(key)) return key;
  return LEGACY_CATEGORIES[key] ?? "other";
}

/**
 * Legacy trees carry a hand-typed `changeType` and no computed diff, so the
 * branch starts with that single category and an empty summary. The view fills
 * `summary`/`categories` in from the diff service once the projects are loaded.
 */
export function toProjectTree(saved: SavedProjectTree): ProjectTree {
  return {
    id: saved.id,
    name: saved.name,
    rootProjectId: saved.rootProjectId,
    branches: (saved.relationships ?? []).map((link) => ({
      id: link.id,
      fromProjectId: link.fromProjectId,
      toProjectId: link.toProjectId,
      summary: "",
      categories: [categoryFromChangeType(link.changeType ?? "")],
      changeCount: 0,
      note: link.description ?? "",
    })),
    createdAt: saved.createdAt,
    updatedAt: saved.updatedAt,
  };
}

/** Round-trip back to the localStorage record, for the local-only storage mode. */
export function toSavedTree(tree: ProjectTree): SavedProjectTree {
  return {
    id: tree.id,
    name: tree.name,
    rootProjectId: tree.rootProjectId,
    relationships: tree.branches.map((branch) => ({
      id: branch.id,
      fromProjectId: branch.fromProjectId,
      toProjectId: branch.toProjectId,
      changeType: branch.categories[0] ?? "other",
      description: branch.note,
    })),
    createdAt: tree.createdAt,
    updatedAt: tree.updatedAt,
  };
}

export function readSavedProjectTrees(proteins: ProteinRecord[] = []): SavedProjectTree[] {
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
  writeSavedProjectTrees(migrated);
  return migrated;
}

/** Local trees, already converted to the engine shape. */
export function readProjectTrees(proteins: ProteinRecord[] = []): ProjectTree[] {
  return readSavedProjectTrees(proteins).map(toProjectTree);
}

export function writeSavedProjectTrees(trees: SavedProjectTree[]) {
  if (typeof window === "undefined") return;
  localStorage.setItem(PROJECT_TREES_KEY, JSON.stringify(trees));
  window.dispatchEvent(new CustomEvent(PROJECT_TREES_CHANGED_EVENT, { detail: trees }));
}

export function writeProjectTrees(trees: ProjectTree[]) {
  writeSavedProjectTrees(trees.map(toSavedTree));
}

/** Every project referenced by a tree, root first. */
export function treeProjectIds(tree: Pick<ProjectTree, "rootProjectId" | "branches">): string[] {
  return [...new Set([
    tree.rootProjectId,
    ...tree.branches.flatMap((branch) => [branch.fromProjectId, branch.toProjectId]),
  ])].filter(Boolean);
}

export function projectTreeStats(trees: Pick<ProjectTree, "branches">[]) {
  return {
    trees: trees.length,
    branches: trees.reduce((total, tree) => total + tree.branches.length, 0),
  };
}

/** Blank branch used when a link is created before its diff has been computed. */
export function emptyBranch(fromProjectId: string, toProjectId: string, note = ""): ProjectTreeBranch {
  return { id: crypto.randomUUID(), fromProjectId, toProjectId, summary: "", categories: [], changeCount: 0, note };
}
