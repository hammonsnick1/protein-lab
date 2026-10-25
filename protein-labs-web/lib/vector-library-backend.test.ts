import { test } from "vitest";
import assert from "node:assert/strict";
import { engineSearchParams, fromEngineCollection, fromEngineImportResult, fromEngineVector } from "./vector-library-backend.ts";

const base = { query: "", filters: {}, sort: "name" as const, order: "asc" as const };

test("engine search params carry the sidebar scope, sort and facets", () => {
  const view = new URLSearchParams(engineSearchParams({ ...base, query: " pET ", filters: { host: ["E. coli"] }, scope: { kind: "view", view: "favorites" }, sort: "size", order: "desc" }));
  assert.equal(view.get("view"), "favorites");
  assert.equal(view.get("q"), "pET");
  assert.deepEqual(view.getAll("host"), ["E. coli"]);
  assert.equal(view.get("sort"), "size");
  assert.equal(view.get("order"), "desc");
  assert.equal(view.get("collection"), null);

  const collection = new URLSearchParams(engineSearchParams({ ...base, scope: { kind: "collection", id: "c1" } }));
  assert.equal(collection.get("view"), "all");
  assert.equal(collection.get("collection"), "c1");

  const tag = new URLSearchParams(engineSearchParams({ ...base, scope: { kind: "tag", name: "lab stock" } }));
  assert.deepEqual(tag.getAll("tag"), ["lab stock"]);
});

test("engine summaries become organised vectors", () => {
  const vector = fromEngineVector({ id: "v1", name: "pET", origin: "project", isStandard: false, colorLabel: "blue", tags: ["a"], collectionIds: ["c1"], lastUsedAt: null });
  assert.equal(vector.provenance, "project");
  assert.equal(vector.color, "blue");
  assert.deepEqual(vector.tags, ["a"]);
  assert.deepEqual(vector.collectionIds, ["c1"]);
  assert.equal(vector.lastUsedAt, undefined);

  const bare = fromEngineVector({ id: "s1", name: "pUC", origin: "Addgene", isStandard: true, color: "teal" });
  assert.equal(bare.provenance, "standard");
  assert.equal(bare.color, null, "an unknown colour is dropped, not drawn");
  assert.deepEqual(bare.tags, []);
});

test("engine collections keep their count and position", () => {
  assert.deepEqual(fromEngineCollection({ id: "c1", name: "Yeast", position: 2, vectorCount: 5 }), { id: "c1", name: "Yeast", position: 2, count: 5 });
});

test("engine import results map to outcomes", () => {
  assert.deepEqual(fromEngineImportResult({ filename: "a.gb", status: "new", resolution: "kept", vector: { id: "v9", name: "pA" } }), { filename: "a.gb", status: "added", id: "v9", name: "pA" });
  assert.equal(fromEngineImportResult({ filename: "b.gb", status: "duplicate", resolution: "merged", vector: { id: "v1", name: "pB" } }).status, "merged");
  assert.equal(fromEngineImportResult({ filename: "c.gb", status: "duplicate", resolution: "skipped" }).status, "skipped");
  assert.deepEqual(fromEngineImportResult({ filename: "d.gb", status: "error", error: "No records" }), { filename: "d.gb", status: "failed", message: "No records" });
});
