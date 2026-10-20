// Storage for project trees (HOM-137).
//
// The engine owns trees and diffs (HOM-136). Until that lands — and whenever
// the engine is unreachable — the screen stays usable on the old localStorage
// record and computes diffs in the browser. One probe at load decides which
// mode the session runs in, so no call site has to branch.

import { proteinLabsApi, type ProteinBundle, type ProteinRecord } from "./protein-labs-api.ts";
import {
  PROJECT_TREES_IMPORTED_KEY,
  readProjectTrees,
  readSavedProjectTrees,
  writeProjectTrees,
} from "./project-trees.ts";
import type { ProjectDiff, ProjectTree } from "./project-tree-types.ts";
import { branchSummary, diffSourceFromBundle, localProjectDiff, type DiffSource } from "./project-tree-diff.ts";

export type StorageMode = "engine" | "local";

export type LoadResult = { mode: StorageMode; trees: ProjectTree[]; imported: number };

function now() {
  return new Date().toISOString();
}

/**
 * Load every tree. Tries the engine first; a failure (not implemented, engine
 * offline) drops the session into local mode rather than showing an error,
 * because the local record is real user data we must keep serving.
 */
export async function loadProjectTrees(proteins: ProteinRecord[]): Promise<LoadResult> {
  try {
    const { trees } = await proteinLabsApi.listProjectTrees();
    const imported = await importLocalTrees(trees);
    return imported ?? { mode: "engine", trees, imported: 0 };
  } catch {
    return { mode: "local", trees: readProjectTrees(proteins), imported: 0 };
  }
}

/**
 * One-time hand-off of the browser's trees to the engine. Guarded by a
 * localStorage flag and skipped once the engine already holds trees, so a user
 * who deletes an imported tree does not get it back on the next launch.
 */
async function importLocalTrees(engineTrees: ProjectTree[]): Promise<LoadResult | null> {
  if (typeof window === "undefined") return null;
  if (localStorage.getItem(PROJECT_TREES_IMPORTED_KEY)) return null;
  const local = readSavedProjectTrees();
  if (!local.length) {
    localStorage.setItem(PROJECT_TREES_IMPORTED_KEY, now());
    return null;
  }
  try {
    const result = await proteinLabsApi.importProjectTrees(local as unknown as Record<string, unknown>[]);
    localStorage.setItem(PROJECT_TREES_IMPORTED_KEY, now());
    return { mode: "engine", trees: result.trees, imported: result.imported };
  } catch {
    // Leave the flag unset so the import is retried next launch.
    return { mode: "engine", trees: engineTrees, imported: 0 };
  }
}

const replace = (trees: ProjectTree[], updated: ProjectTree) =>
  trees.some((tree) => tree.id === updated.id)
    ? trees.map((tree) => (tree.id === updated.id ? updated : tree))
    : [...trees, updated];

function persist(mode: StorageMode, trees: ProjectTree[]) {
  if (mode === "local") writeProjectTrees(trees);
  return trees;
}

export async function createTree(mode: StorageMode, trees: ProjectTree[], name: string, rootProjectId: string) {
  if (mode === "engine") return replace(trees, await proteinLabsApi.createProjectTree(name, rootProjectId));
  const stamp = now();
  const tree: ProjectTree = { id: crypto.randomUUID(), name, rootProjectId, branches: [], createdAt: stamp, updatedAt: stamp };
  return persist(mode, [...trees, tree]);
}

export async function renameTree(mode: StorageMode, trees: ProjectTree[], treeId: string, name: string) {
  if (mode === "engine") return replace(trees, await proteinLabsApi.renameProjectTree(treeId, name));
  return persist(mode, trees.map((tree) => (tree.id === treeId ? { ...tree, name, updatedAt: now() } : tree)));
}

export async function deleteTree(mode: StorageMode, trees: ProjectTree[], treeId: string) {
  if (mode === "engine") await proteinLabsApi.deleteProjectTree(treeId);
  return persist(mode, trees.filter((tree) => tree.id !== treeId));
}

export async function linkBranch(
  mode: StorageMode, trees: ProjectTree[], treeId: string,
  fromProjectId: string, toProjectId: string, note: string,
) {
  if (mode === "engine") return replace(trees, await proteinLabsApi.createProjectBranch(treeId, fromProjectId, toProjectId, note));
  const branch = { id: crypto.randomUUID(), fromProjectId, toProjectId, summary: "", categories: [], changeCount: 0, note };
  return persist(mode, trees.map((tree) => (tree.id === treeId
    ? { ...tree, branches: [...tree.branches, branch], updatedAt: now() }
    : tree)));
}

/** Also the drag-to-re-parent path: it patches `fromProjectId`. */
export async function updateBranch(
  mode: StorageMode, trees: ProjectTree[], treeId: string, branchId: string,
  fields: { fromProjectId?: string; note?: string },
) {
  if (mode === "engine") return replace(trees, await proteinLabsApi.updateProjectBranch(treeId, branchId, fields));
  return persist(mode, trees.map((tree) => (tree.id === treeId
    ? {
      ...tree,
      updatedAt: now(),
      branches: tree.branches.map((branch) => (branch.id === branchId
        // A re-parent invalidates the cached summary, so clear it; the view
        // recomputes it from the diff service on the next pass.
        ? { ...branch, ...fields, ...(fields.fromProjectId ? { summary: "", categories: [], changeCount: 0 } : {}) }
        : branch)),
    }
    : tree)));
}

export async function unlinkBranch(mode: StorageMode, trees: ProjectTree[], treeId: string, branchId: string) {
  if (mode === "engine") return replace(trees, await proteinLabsApi.deleteProjectBranch(treeId, branchId));
  return persist(mode, trees.map((tree) => (tree.id === treeId
    ? { ...tree, branches: tree.branches.filter((branch) => branch.id !== branchId), updatedAt: now() }
    : tree)));
}

// --- diffs ------------------------------------------------------------------

/** Project data the local diff needs, loaded once per project and reused. */
export class DiffCache {
  private bundles = new Map<string, Promise<ProteinBundle>>();
  private diffs = new Map<string, Promise<ProjectDiff>>();

  /** `local` skips the engine call entirely instead of 404ing once per branch. */
  constructor(private mode: StorageMode = "engine") {}

  private source(projectId: string): Promise<DiffSource> {
    const existing = this.bundles.get(projectId) ?? proteinLabsApi.getProtein(projectId);
    this.bundles.set(projectId, existing);
    return existing.then(diffSourceFromBundle);
  }

  private async compute(fromProjectId: string, toProjectId: string): Promise<ProjectDiff> {
    const [from, to] = await Promise.all([this.source(fromProjectId), this.source(toProjectId)]);
    return localProjectDiff(from, to);
  }

  /** Engine diff when available, otherwise computed from the loaded bundles. */
  diff(fromProjectId: string, toProjectId: string): Promise<ProjectDiff> {
    const key = `${fromProjectId}->${toProjectId}`;
    const existing = this.diffs.get(key);
    if (existing) return existing;
    const pending = this.mode === "local"
      ? this.compute(fromProjectId, toProjectId)
      : proteinLabsApi.projectDiff(fromProjectId, toProjectId)
        .catch(() => this.compute(fromProjectId, toProjectId));
    this.diffs.set(key, pending);
    return pending;
  }

  forget(fromProjectId: string, toProjectId: string) {
    this.diffs.delete(`${fromProjectId}->${toProjectId}`);
  }
}

/**
 * Fill in `summary`/`categories` for branches the engine did not summarise
 * (local mode, or a link created in this session). Returns the branches that
 * changed, keyed by branch id, so the caller can merge without a full reload.
 */
export async function resolveBranchSummaries(tree: ProjectTree, cache: DiffCache) {
  const pending = tree.branches.filter((branch) => !branch.summary);
  if (!pending.length) return new Map<string, { summary: string; categories: ProjectDiff["categories"]; changeCount: number }>();
  const entries = await Promise.all(pending.map(async (branch) => {
    try {
      const diff = await cache.diff(branch.fromProjectId, branch.toProjectId);
      const summary = diff.summary
        || branchSummary(diff.sequence, diff.changes.filter((change) => change.category !== "sequence" && change.category !== "protparam"));
      return [branch.id, { summary, categories: diff.categories, changeCount: diff.changes.length }] as const;
    } catch {
      // A deleted project cannot be diffed; the node renders as missing.
      return [branch.id, { summary: "Difference unavailable", categories: [] as ProjectDiff["categories"], changeCount: 0 }] as const;
    }
  }));
  return new Map(entries);
}
