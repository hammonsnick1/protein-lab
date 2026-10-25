// Engine request errors (HOM-79). Run with `npm run test`.
import assert from "node:assert/strict";
import { afterEach, describe, it } from "vitest";

import { ENGINE_UNREACHABLE_MESSAGE, request } from "./protein-labs-api.ts";
import { classifySourceError } from "./vector-library.ts";

const realFetch = globalThis.fetch;
afterEach(() => { globalThis.fetch = realFetch; });

describe("request", () => {
  it("says the engine is unreachable instead of the browser's \"Failed to fetch\"", async () => {
    globalThis.fetch = async () => { throw new TypeError("Failed to fetch"); };
    await assert.rejects(request("/v1/gel/analyze"), { message: ENGINE_UNREACHABLE_MESSAGE });
  });

  it("still reports an engine error message as the engine wrote it", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ error: "The selected file is not a readable gel image" }), { status: 400 });
    await assert.rejects(request("/v1/gel/analyze"), { message: "The selected file is not a readable gel image" });
  });

  it("returns the body of a successful response", async () => {
    globalThis.fetch = async () => new Response(JSON.stringify({ service: "protein-labs" }), { status: 200 });
    assert.deepEqual(await request("/v1/health"), { service: "protein-labs" });
  });

  it("keeps an unreachable engine classified as offline in the vector library", () => {
    assert.equal(classifySourceError(ENGINE_UNREACHABLE_MESSAGE), "offline");
  });
});
