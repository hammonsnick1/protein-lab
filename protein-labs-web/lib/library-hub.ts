// The vector and protein library: one page with a tab for each library, and
// the dashboard tile that opens it. Both libraries live in the engine's
// project database, so they share one storage location.
//
// Kept free of runtime `@/` imports so `node --test` can load it.

import { folderOf, type ProjectDirectoryState } from "./desktop-bridge.ts";

export type LibraryTab = "vectors" | "proteins";

export const LIBRARY_TILE = {
  title: "Vector and protein library",
  subtitle: "Saved vectors and proteins",
} as const;

export const LIBRARY_TABS: readonly { id: LibraryTab; label: string; noun: [string, string]; shortcut: string }[] = [
  { id: "vectors", label: "Vectors", noun: ["vector", "vectors"], shortcut: "Ctrl+Shift+L" },
  { id: "proteins", label: "Proteins", noun: ["protein", "proteins"], shortcut: "Ctrl+Shift+P" },
];

export function isLibraryTab(value: unknown): value is LibraryTab {
  return value === "vectors" || value === "proteins";
}

/**
 * Opens a library tab. When the library page is already showing it only
 * switches the tab; from anywhere else it navigates there with the page
 * transition. The current view is read through a getter on every call,
 * because callers may create the opener once and keep it.
 */
export function createLibraryOpener({ currentView, switchTab, openView }: {
  currentView: () => string;
  switchTab: (tab: LibraryTab) => void;
  openView: (tab: LibraryTab) => void;
}) {
  return (tab: LibraryTab) => { if (currentView() === "library") switchTab(tab); else openView(tab); };
}

/** Roving focus in the tab strip: arrows wrap, Home and End jump to the ends. */
export function nextLibraryTab(current: LibraryTab, key: string): LibraryTab | null {
  const index = LIBRARY_TABS.findIndex((tab) => tab.id === current);
  const last = LIBRARY_TABS.length - 1;
  const target = key === "ArrowRight" ? (index + 1) % LIBRARY_TABS.length
    : key === "ArrowLeft" ? (index + last) % LIBRARY_TABS.length
    : key === "Home" ? 0
    : key === "End" ? last
    : -1;
  return target < 0 ? null : LIBRARY_TABS[target].id;
}

/** "1 vector", "12 proteins"; a count that has not loaded reads "…". */
export function libraryCount(tab: LibraryTab, count: number | null) {
  const [one, many] = LIBRARY_TABS.find((entry) => entry.id === tab)!.noun;
  return count === null ? `… ${many}` : `${count.toLocaleString()} ${count === 1 ? one : many}`;
}

export type LibraryStorage = {
  /** The folder that holds the database, or "" when the engine is not connected. */
  folder: string;
  database: string;
  /** The desktop app can show the folder in the file manager. */
  canReveal: boolean;
  /** The desktop app started this engine and can move it to another folder. */
  canChange: boolean;
  /** A saved folder was missing, so the engine fell back to the default one. */
  missing: string | null;
};

/**
 * Where both libraries are saved. The desktop bridge knows the project
 * folder; without it (the web build) only the engine's database path is known.
 */
export function libraryStorage(state: ProjectDirectoryState | null, enginePath: string): LibraryStorage {
  if (state) return { folder: state.directory, database: state.database, canReveal: true, canChange: state.canChange, missing: state.missing };
  return { folder: enginePath ? folderOf(enginePath) : "", database: enginePath, canReveal: false, canChange: false, missing: null };
}

/** The sentence beside the path on each tab. */
export function storageSentence(tab: LibraryTab, storage: LibraryStorage) {
  const noun = tab === "vectors" ? "Vectors" : "Proteins";
  if (!storage.folder) return `${noun} are saved in the project database once the local engine is connected.`;
  return `${noun} are saved in the project database in`;
}


/**
 * The busiest storage places from the protein library's location facet,
 * grouped by their top level (the freezer or room), so "−80 #2 › Shelf 3 ›
 * Box 7" and "−80 #2 › Shelf 1" both count for "−80 #2".
 */
export function summarizePlaces(options: { value: string; count: number }[] | undefined, shown = 2) {
  const totals = new Map<string, number>();
  for (const option of options ?? []) {
    const place = option.value.split("›")[0].trim();
    if (place && option.count > 0) totals.set(place, (totals.get(place) ?? 0) + option.count);
  }
  const places = [...totals].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([place]) => place);
  if (!places.length) return "";
  const named = places.slice(0, shown).join(", ");
  const rest = places.length - shown;
  return rest > 0 ? `${named} and ${rest} more` : named;
}
