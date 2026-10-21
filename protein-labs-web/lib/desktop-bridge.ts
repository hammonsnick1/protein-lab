// What desktop/electron/preload.cjs exposes to the page. The web build and the
// headless test bundle run without it, so every caller must handle null.

export type ProjectDirectoryState = {
  directory: string;
  database: string;
  isDefault: boolean;
  // A saved folder that no longer exists; the engine fell back to the default.
  missing: string | null;
  // False when the app is attached to an engine it did not start.
  canChange: boolean;
};

export type ProjectDirectoryChoice =
  | { status: "cancelled" }
  | { status: "unchanged"; state: ProjectDirectoryState }
  | { status: "changed"; copied: boolean; state: ProjectDirectoryState }
  | { status: "error"; message: string };

export type ProteinLabDesktop = {
  getProjectDirectory: () => Promise<ProjectDirectoryState | null>;
  chooseProjectDirectory: () => Promise<ProjectDirectoryChoice>;
  // Resolves to an error message, or "" once the folder is shown.
  openProjectDirectory: () => Promise<string>;
};

export function desktopBridge(): ProteinLabDesktop | null {
  if (typeof window === "undefined") return null;
  return (window as Window & { proteinLabDesktop?: ProteinLabDesktop }).proteinLabDesktop ?? null;
}

// The folder holding a database path, for builds without the bridge where
// only the engine's /v1/health database path is known.
export function folderOf(databasePath: string): string {
  const cut = Math.max(databasePath.lastIndexOf("/"), databasePath.lastIndexOf("\\"));
  return cut > 0 ? databasePath.slice(0, cut) : databasePath;
}
