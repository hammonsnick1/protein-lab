// Organism autocomplete for the Protein sequence job. The engine answers
// `GET /v1/taxonomy/search`; this module keeps the browser side pure so the
// debounce, cache and keyboard rules can be tested without a DOM.

export type TaxonSource = "uniprot" | "ncbi" | "curated";

export type TaxonSuggestion = {
  taxonId: number;
  scientificName: string;
  commonName: string;
  rank: string;
  strain: string;
  source: TaxonSource;
};

export type TaxonomySearchResponse = {
  query: string;
  /** "offline" means UniProt and NCBI failed and the bundled list answered. */
  source: TaxonSource | "offline";
  offline: boolean;
  message: string;
  results: TaxonSuggestion[];
  cached: boolean;
};

export const ORGANISM_SEARCH_DELAY_MS = 250;

export type OrganismSearchState =
  | { status: "idle" }
  | { status: "loading"; query: string }
  | { status: "ready"; query: string; response: TaxonomySearchResponse }
  | { status: "error"; query: string; message: string };

type Timers = {
  setTimeout: (callback: () => void, ms: number) => unknown;
  clearTimeout: (handle: unknown) => void;
};

/**
 * Debounced, cached organism search. Each `search` call cancels the pending
 * one; answers for an older query are dropped so a slow reply never replaces
 * a newer list. Offline answers are not cached, so the next keystroke after
 * the network returns gets real UniProt/NCBI rows.
 */
export function createOrganismSearch(options: {
  fetch: (query: string) => Promise<TaxonomySearchResponse>;
  onState: (state: OrganismSearchState) => void;
  delayMs?: number;
  cacheSize?: number;
  timers?: Timers;
}) {
  const delay = options.delayMs ?? ORGANISM_SEARCH_DELAY_MS;
  const cacheSize = options.cacheSize ?? 60;
  const timers: Timers = options.timers ?? {
    setTimeout: (callback, ms) => globalThis.setTimeout(callback, ms),
    clearTimeout: (handle) => globalThis.clearTimeout(handle as ReturnType<typeof setTimeout>),
  };
  const cache = new Map<string, TaxonomySearchResponse>();
  let pending: unknown = null;
  let generation = 0;

  function cancel() {
    if (pending !== null) timers.clearTimeout(pending);
    pending = null;
    generation += 1;
  }

  function search(raw: string) {
    cancel();
    const query = normalizeQuery(raw);
    const key = query.toLowerCase();
    const hit = cache.get(key);
    if (hit) {
      options.onState({ status: "ready", query, response: hit });
      return;
    }
    const ticket = generation;
    options.onState({ status: "loading", query });
    pending = timers.setTimeout(() => {
      pending = null;
      options.fetch(query).then((response) => {
        if (ticket !== generation) return;
        if (!response.offline) {
          cache.delete(key);
          cache.set(key, response);
          while (cache.size > cacheSize) cache.delete(cache.keys().next().value as string);
        }
        options.onState({ status: "ready", query, response });
      }, (reason: unknown) => {
        if (ticket !== generation) return;
        options.onState({ status: "error", query, message: reason instanceof Error ? reason.message : String(reason) });
      });
    }, query ? delay : 0);
  }

  return { search, cancel, cacheSize: () => cache.size };
}

export function normalizeQuery(raw: string) {
  return raw.replace(/\s+/g, " ").trim().slice(0, 100);
}

/** ↑/↓ wrap through the options; Home/End jump; -1 means nothing highlighted. */
export function nextHighlight(current: number, key: string, count: number) {
  if (count <= 0) return -1;
  if (key === "ArrowDown") return current < 0 ? 0 : (current + 1) % count;
  if (key === "ArrowUp") return current < 0 ? count - 1 : (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return current;
}

/** The text saved in the organism field when a suggestion is chosen. */
export function organismLabel(row: TaxonSuggestion) {
  // A cell line has no taxon of its own, so "HEK293 cells" is appended to the
  // species name; strain-rank taxa already carry the strain in their name.
  if (!row.strain || row.scientificName.toLowerCase().includes(row.strain.toLowerCase())) return row.scientificName;
  return row.rank === "species" ? `${row.scientificName} (${row.strain})` : row.scientificName;
}

/** Secondary line of a suggestion: common name, strain or cell line, rank. */
export function suggestionDetail(row: TaxonSuggestion) {
  const strainShown = row.strain && !row.scientificName.toLowerCase().includes(row.strain.toLowerCase());
  return [row.commonName, strainShown ? row.strain : "", row.rank && row.rank !== "no rank" ? row.rank : ""].filter(Boolean).join(" · ");
}

export function sourceNote(response: TaxonomySearchResponse) {
  if (response.offline) return response.message || "Online lookup unavailable. Showing the bundled list of common organisms.";
  if (response.source === "curated") return "Common expression and model organisms. Type at least 2 letters to search UniProt and NCBI Taxonomy.";
  return response.source === "ncbi" ? "Results from NCBI Taxonomy." : "Results from UniProt taxonomy.";
}
