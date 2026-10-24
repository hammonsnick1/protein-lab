import { test } from "node:test";
import assert from "node:assert/strict";
import {
  EMPTY_ORGANIZER,
  addTags,
  applyOrganizer,
  clickSelect,
  collectionList,
  copyName,
  defaultResolution,
  facetCountsFor,
  deleteCollection,
  forgetVectors,
  importSummary,
  importableFiles,
  inScope,
  moveFocus,
  moveItem,
  normalizeTag,
  parseOrganizer,
  pruneSelection,
  removeTags,
  resolutionChoices,
  setMembership,
  sortVectors,
  tagCounts,
  uniqueName,
  viewCounts,
  type OrganizedVector,
  type OrganizerState,
} from "./vector-library-organize.ts";
import type { LibraryVector } from "./vector-library.ts";

const NOW = Date.parse("2026-10-21T12:00:00Z");

function vector(id: string, extra: Partial<OrganizedVector> = {}): OrganizedVector {
  return {
    id, name: id, lengthBp: 5000, circular: true, featureCount: 0, insertName: "", host: [], promoter: [], inducer: [], nTags: [], cTags: [],
    proteaseSites: [], selectionMarker: "", origin: "", provenance: "import", copyNumber: "", supplier: "", sourceUrl: "", license: "", licenseUrl: "",
    isStandard: false, favorite: false, projectCount: 0, projects: [], collectionIds: [], tags: [], color: null, ...extra,
  } as OrganizedVector;
}

test("sortVectors orders by name naturally, with the name breaking ties", () => {
  const list = [vector("pET28a"), vector("pET3"), vector("pET100"), vector("pBAD24")];
  assert.deepEqual(sortVectors(list, "name", "asc").map((entry) => entry.id), ["pBAD24", "pET3", "pET28a", "pET100"]);
  assert.deepEqual(sortVectors(list, "name", "desc").map((entry) => entry.id), ["pET100", "pET28a", "pET3", "pBAD24"]);
  const sized = [vector("b", { lengthBp: 4000 }), vector("a", { lengthBp: 4000 }), vector("c", { lengthBp: 3000 })];
  assert.deepEqual(sortVectors(sized, "size", "asc").map((entry) => entry.id), ["c", "a", "b"]);
  assert.deepEqual(sortVectors(sized, "size", "desc").map((entry) => entry.id), ["a", "b", "c"]);
});

test("sortVectors puts never-used vectors last whichever way last-used runs", () => {
  const list = [vector("never"), vector("old", { lastUsedAt: "2026-01-01T00:00:00Z" }), vector("new", { lastUsedAt: "2026-10-20T00:00:00Z" })];
  assert.deepEqual(sortVectors(list, "lastUsed", "desc").map((entry) => entry.id), ["new", "old", "never"]);
  assert.deepEqual(sortVectors(list, "lastUsed", "asc").map((entry) => entry.id), ["old", "new", "never"]);
  const added = [vector("a", { createdAt: "2026-02-01T00:00:00Z" }), vector("b", { createdAt: "2026-03-01T00:00:00Z" })];
  assert.deepEqual(sortVectors(added, "created", "desc").map((entry) => entry.id), ["b", "a"]);
});

test("smart views, collections and tags pick the right vectors", () => {
  const list = [
    vector("std", { isStandard: true, provenance: "standard", favorite: true }),
    vector("mine", { collectionIds: ["c1"], tags: ["His-tag"], lastUsedAt: "2026-10-15T00:00:00Z" }),
    vector("loose", { tags: ["his-tag", "kan"], lastUsedAt: "2026-07-01T00:00:00Z" }),
    vector("bare"),
  ];
  const ids = (scope: Parameters<typeof inScope>[1]) => list.filter((entry) => inScope(entry, scope, NOW)).map((entry) => entry.id);
  assert.deepEqual(ids({ kind: "view", view: "favorites" }), ["std"]);
  assert.deepEqual(ids({ kind: "view", view: "recent" }), ["mine"]);
  assert.deepEqual(ids({ kind: "view", view: "imports" }), ["mine", "loose", "bare"]);
  assert.deepEqual(ids({ kind: "view", view: "standard" }), ["std"]);
  assert.deepEqual(ids({ kind: "view", view: "unsorted" }), ["bare"], "a tagged vector is already sorted");
  assert.deepEqual(ids({ kind: "collection", id: "c1" }), ["mine"]);
  assert.deepEqual(ids({ kind: "tag", name: "HIS-TAG" }), ["mine", "loose"]);
  assert.deepEqual(viewCounts(list, NOW), { all: 4, favorites: 1, recent: 1, imports: 3, standard: 1, unsorted: 1 });
});

test("tags merge case-insensitively and count once per vector", () => {
  assert.equal(normalizeTag("  #His   tag "), "His tag");
  assert.deepEqual(addTags(["His"], ["his", " TEV ", "", "#kan"]), ["His", "TEV", "kan"]);
  assert.deepEqual(removeTags(["His", "TEV"], ["his"]), ["TEV"]);
  assert.deepEqual(tagCounts([{ tags: ["His", "his", "TEV"] }, { tags: ["TEV"] }, { tags: ["Kan"] }]), [
    { name: "TEV", count: 2 }, { name: "His", count: 1 }, { name: "Kan", count: 1 },
  ]);
});

test("facet counts follow the vectors on screen", () => {
  const list = [vector("a", { host: ["E. coli"], promoter: ["T7"], selectionMarker: "Kan" }), vector("b", { host: ["E. coli", "E. coli"], promoter: ["tac"], selectionMarker: "" })];
  const facets = facetCountsFor(list);
  assert.deepEqual(facets.host, [{ value: "E. coli", count: 2 }]);
  assert.deepEqual(facets.promoter, [{ value: "T7", count: 1 }, { value: "tac", count: 1 }]);
  assert.deepEqual(facets.selectionMarker, [{ value: "Kan", count: 1 }]);
  assert.equal(facets.supplier, undefined);
});

test("moveItem reorders and ignores out-of-range moves", () => {
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 0, 2), ["b", "c", "a", "d"]);
  assert.deepEqual(moveItem(["a", "b", "c", "d"], 3, 0), ["d", "a", "b", "c"]);
  assert.deepEqual(moveItem(["a", "b"], 5, 0), ["a", "b"]);
  assert.deepEqual(moveItem(["a", "b", "c"], 0, 99), ["b", "c", "a"]);
});

test("new names never clash", () => {
  assert.equal(uniqueName("New collection", ["new collection", "New collection 2"]), "New collection 3");
  assert.equal(copyName("pET28a", ["pET28a"]), "pET28a copy");
  assert.equal(copyName("pET28a copy", ["pET28a copy"]), "pET28a copy 2");
});

test("clickSelect behaves like a file manager", () => {
  const order = ["a", "b", "c", "d", "e"];
  let state = clickSelect(order, [], null, "b", {});
  assert.deepEqual(state, { selected: ["b"], anchor: "b" });
  state = clickSelect(order, state.selected, state.anchor, "d", { shift: true });
  assert.deepEqual(state.selected, ["b", "c", "d"]);
  state = clickSelect(order, state.selected, state.anchor, "a", { shift: true });
  assert.deepEqual(state.selected, ["a", "b"]);
  state = clickSelect(order, state.selected, state.anchor, "e", { toggle: true });
  assert.deepEqual(state, { selected: ["a", "b", "e"], anchor: "e" });
  state = clickSelect(order, state.selected, state.anchor, "a", { toggle: true });
  assert.deepEqual(state.selected, ["b", "e"]);
  assert.deepEqual(pruneSelection(["e", "c", "b"], ["b", "x", "e"]), ["e", "b"]);
});

test("moveFocus walks a grid and a list", () => {
  // 3 columns, 8 items: rows [0 1 2] [3 4 5] [6 7]
  assert.equal(moveFocus(1, "ArrowDown", 3, 8), 4);
  assert.equal(moveFocus(4, "ArrowDown", 3, 8), 7);
  assert.equal(moveFocus(5, "ArrowDown", 3, 8), 7);
  assert.equal(moveFocus(7, "ArrowDown", 3, 8), 7);
  assert.equal(moveFocus(4, "ArrowUp", 3, 8), 1);
  assert.equal(moveFocus(1, "ArrowUp", 3, 8), 1);
  assert.equal(moveFocus(0, "ArrowLeft", 3, 8), 0);
  assert.equal(moveFocus(2, "ArrowRight", 3, 8), 3);
  assert.equal(moveFocus(3, "ArrowRight", 1, 8), 3);
  assert.equal(moveFocus(3, "ArrowDown", 1, 8), 4);
  assert.equal(moveFocus(-1, "ArrowDown", 3, 8), 0);
  assert.equal(moveFocus(2, "End", 3, 8), 7);
  assert.equal(moveFocus(0, "PageDown", 1, 8, 4), 4);
  assert.equal(moveFocus(0, "ArrowDown", 3, 0), -1);
});

test("import review proposes safe defaults and only offers possible resolutions", () => {
  const fresh = { filename: "a.gb", status: "new" as const };
  const twin = { filename: "b.gb", status: "duplicate" as const, duplicateOf: { id: "x", name: "pET28a" } };
  const standardTwin = { filename: "c.gb", status: "duplicate" as const, duplicateOf: { id: "y", name: "pGEX", isStandard: true } };
  const broken = { filename: "d.gb", status: "error" as const, error: "No sequence" };
  assert.equal(defaultResolution(fresh), "import");
  assert.equal(defaultResolution(twin), "skip");
  assert.equal(defaultResolution(broken), "skip");
  assert.deepEqual(resolutionChoices(twin), ["skip", "keepBoth", "merge"]);
  assert.deepEqual(resolutionChoices(standardTwin), ["skip", "keepBoth"]);
  assert.deepEqual(resolutionChoices(broken), ["skip"]);
  assert.equal(importSummary([fresh, twin, broken], { "b.gb": "merge" }), "1 to add · 1 to merge · 1 skipped");
  const files = [{ name: "set/pET28a.gb" }, { name: "set/.DS_Store" }, { name: "set/notes.txt" }];
  const { accepted, ignored } = importableFiles(files, (name) => name.endsWith(".gb"));
  assert.deepEqual(accepted.map((file) => file.name), ["set/pET28a.gb"]);
  assert.deepEqual(ignored.map((file) => file.name), ["set/notes.txt"]);
});

test("the local organiser survives bad storage and layers onto summaries", () => {
  assert.deepEqual(parseOrganizer("not json"), EMPTY_ORGANIZER);
  assert.deepEqual(parseOrganizer(JSON.stringify({ version: 9 })), EMPTY_ORGANIZER);
  let state: OrganizerState = { ...EMPTY_ORGANIZER, collections: [{ id: "c1", name: "E. coli" }, { id: "c2", name: "Insect" }], imported: ["m"] };
  state = setMembership(state, ["m", "s"], "c1", true);
  state = setMembership(state, ["m"], "c2", true);
  state = { ...state, names: { m: "Renamed", s: "Nope" }, tags: { m: ["His"] }, colors: { s: "green" } };
  const uses = [{ proteinId: "a", proteinName: "A", lastUsedAt: "2026-10-01T00:00:00Z" }, { proteinId: "b", proteinName: "B", lastUsedAt: "2026-10-09T00:00:00Z" }];
  const base = [vector("s", { isStandard: true }), vector("m", { projectCount: 2, projects: uses }), vector("p", { projectCount: 1 })] as LibraryVector[];
  const organized = applyOrganizer(base, state);
  assert.equal(organized[0].name, "s", "standard vectors keep their name");
  assert.equal(organized[0].provenance, "standard");
  assert.equal(organized[0].color, "green");
  assert.equal(organized[1].name, "Renamed");
  assert.equal(organized[1].provenance, "import");
  assert.equal(organized[2].provenance, "project");
  assert.equal(organized[1].lastUsedAt, "2026-10-09T00:00:00Z", "last use comes from the latest project use");
  assert.deepEqual(organized[1].collectionIds, ["c1", "c2"]);
  assert.deepEqual(collectionList(state, organized).map((entry) => [entry.name, entry.count]), [["E. coli", 2], ["Insect", 1]]);
  const removed = deleteCollection(state, "c1");
  assert.deepEqual(applyOrganizer(base, removed)[1].collectionIds, ["c2"]);
  const forgotten = forgetVectors(state, ["m"]);
  assert.equal(forgotten.tags.m, undefined);
  assert.deepEqual(forgotten.imported, []);
});
