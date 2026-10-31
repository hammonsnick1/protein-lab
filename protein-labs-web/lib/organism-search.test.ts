// Organism autocomplete: debounce, cache, stale replies and keyboard rules.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { createOrganismSearch, nextHighlight, organismLabel, sourceNote, suggestionDetail } from "./organism-search.ts";
import type { OrganismSearchState, TaxonSuggestion, TaxonomySearchResponse } from "./organism-search.ts";

function fakeTimers() {
  let now = 0; let next = 1;
  const queue = new Map<number, { at: number; run: () => void }>();
  return {
    timers: {
      setTimeout: (run: () => void, ms: number) => { const id = next++; queue.set(id, { at: now + ms, run }); return id; },
      clearTimeout: (id: unknown) => { queue.delete(id as number); },
    },
    advance(ms: number) {
      now += ms;
      for (const [id, entry] of [...queue].sort((a, b) => a[1].at - b[1].at)) if (entry.at <= now) { queue.delete(id); entry.run(); }
    },
    pending: () => queue.size,
  };
}

function reply(query: string, extra: Partial<TaxonomySearchResponse> = {}): TaxonomySearchResponse {
  return { query, source: "uniprot", offline: false, message: "", cached: false, results: [row({ scientificName: query })], ...extra };
}
function row(fields: Partial<TaxonSuggestion>): TaxonSuggestion {
  return { taxonId: 1, scientificName: "", commonName: "", rank: "species", strain: "", source: "uniprot", ...fields };
}
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

function setup(fetch: (query: string) => Promise<TaxonomySearchResponse>) {
  const clock = fakeTimers(); const states: OrganismSearchState[] = []; const asked: string[] = [];
  const search = createOrganismSearch({ fetch: (query) => { asked.push(query); return fetch(query); }, onState: (state) => states.push(state), timers: clock.timers });
  return { clock, states, asked, search };
}

describe("createOrganismSearch", () => {
  it("waits 250 ms after the last keystroke and sends one request", async () => {
    const { clock, states, asked, search } = setup(async (query) => reply(query));
    search.search("h"); clock.advance(100);
    search.search("ho"); clock.advance(100);
    search.search("hom"); clock.advance(249);
    assert.deepEqual(asked, []);
    assert.deepEqual(states.at(-1), { status: "loading", query: "hom" });
    clock.advance(1); await settle();
    assert.deepEqual(asked, ["hom"]);
    assert.equal(states.at(-1)?.status, "ready");
  });

  it("answers repeated queries from the cache without a request", async () => {
    const { clock, states, asked, search } = setup(async (query) => reply(query));
    search.search("Mouse"); clock.advance(250); await settle();
    search.search("  mouse ");
    assert.equal(clock.pending(), 0);
    assert.deepEqual(asked, ["Mouse"]);
    assert.equal(states.at(-1)?.status, "ready");
  });

  it("does not cache the offline list, so the next search retries online", async () => {
    const { clock, asked, search } = setup(async (query) => reply(query, { source: "offline", offline: true }));
    search.search("pichia"); clock.advance(250); await settle();
    search.search("pichia"); clock.advance(250); await settle();
    assert.deepEqual(asked, ["pichia", "pichia"]);
  });

  it("drops a slow reply for an older query", async () => {
    const waiting: Array<(value: TaxonomySearchResponse) => void> = [];
    const { clock, states, search } = setup((query) => new Promise((resolve) => waiting.push(() => resolve(reply(query)))));
    search.search("esch"); clock.advance(250);
    search.search("escherichia"); clock.advance(250);
    waiting[1](reply("escherichia")); await settle();
    waiting[0](reply("esch")); await settle();
    const last = states.at(-1);
    assert.equal(last?.status, "ready");
    assert.equal(last?.status === "ready" && last.query, "escherichia");
  });

  it("reports engine errors and cancel() silences pending work", async () => {
    const { clock, states, search } = setup(async () => { throw new Error("engine down"); });
    search.search("rat"); clock.advance(250); await settle();
    assert.deepEqual(states.at(-1), { status: "error", query: "rat", message: "engine down" });
    search.search("rattus"); search.cancel(); clock.advance(500); await settle();
    assert.equal(clock.pending(), 0);
    assert.deepEqual(states.at(-1), { status: "loading", query: "rattus" });
  });

  it("loads the common list for an empty field without waiting", async () => {
    const { clock, asked, search } = setup(async (query) => reply(query, { source: "curated" }));
    search.search(""); clock.advance(0); await settle();
    assert.deepEqual(asked, [""]);
  });
});

describe("nextHighlight", () => {
  it("moves and wraps with the arrow keys", () => {
    assert.equal(nextHighlight(-1, "ArrowDown", 3), 0);
    assert.equal(nextHighlight(2, "ArrowDown", 3), 0);
    assert.equal(nextHighlight(-1, "ArrowUp", 3), 2);
    assert.equal(nextHighlight(0, "ArrowUp", 3), 2);
    assert.equal(nextHighlight(1, "Home", 3), 0);
    assert.equal(nextHighlight(1, "End", 3), 2);
    assert.equal(nextHighlight(1, "x", 3), 1);
    assert.equal(nextHighlight(0, "ArrowDown", 0), -1);
  });
});

describe("suggestion text", () => {
  const hek = row({ taxonId: 9606, scientificName: "Homo sapiens", commonName: "Human", strain: "HEK293 cells", source: "curated" });
  const bl21 = row({ taxonId: 469008, scientificName: "Escherichia coli (strain B / BL21-DE3)", rank: "strain", strain: "BL21(DE3)" });
  it("names the organism saved in the field", () => {
    assert.equal(organismLabel(hek), "Homo sapiens (HEK293 cells)");
    assert.equal(organismLabel(bl21), "Escherichia coli (strain B / BL21-DE3)");
    assert.equal(organismLabel(row({ scientificName: "Mus musculus" })), "Mus musculus");
  });
  it("shows common name, strain and rank", () => {
    assert.equal(suggestionDetail(hek), "Human · HEK293 cells · species");
    assert.equal(suggestionDetail(bl21), "BL21(DE3) · strain");
    assert.equal(suggestionDetail(row({ rank: "no rank" })), "");
  });
  it("says where the rows came from", () => {
    assert.match(sourceNote(reply("x", { source: "offline", offline: true })), /bundled list/);
    assert.match(sourceNote(reply("x", { source: "ncbi" })), /NCBI Taxonomy/);
    assert.match(sourceNote(reply("x")), /UniProt/);
    assert.match(sourceNote(reply("", { source: "curated" })), /Common expression/);
  });
});
