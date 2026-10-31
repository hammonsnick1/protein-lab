// Every lysis method the app offers has a mechanism animation. Run with `npm run test`.
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";

import { lysisMethods } from "./purification-stage-catalog.ts";
import { lysisAnimationFor, lysisAnimationKinds, lysisAnimations } from "./lysis-animations.ts";

const component = readFileSync(new URL("../components/protein-labs/lysis-method-animation.tsx", import.meta.url), "utf8");
const css = readFileSync(new URL("../app/globals.css", import.meta.url), "utf8");

describe("lysis method animations", () => {
  it("maps every lysis method to an animation with a caption", () => {
    for (const method of lysisMethods) {
      const animation = lysisAnimationFor(method.id);
      assert.ok(animation, `${method.id} has no animation`);
      assert.ok(lysisAnimationKinds.includes(animation.kind), `${method.id} uses unknown kind ${animation.kind}`);
      assert.ok(animation.caption.length > 20, `${method.id} needs a caption`);
    }
  });

  it("has no animation for a method the catalogue no longer offers", () => {
    const ids = new Set(lysisMethods.map((method) => method.id));
    for (const id of Object.keys(lysisAnimations)) assert.ok(ids.has(id), `${id} is not a lysis method`);
  });

  it("draws every animation kind", () => {
    for (const kind of lysisAnimationKinds) assert.match(component, new RegExp(`["']?${kind}["']?\\s*:\\s*\\(`), `${kind} has no drawing`);
  });

  it("shows a static frame when the user asks for reduced motion", () => {
    assert.match(css, /@media \(prefers-reduced-motion: reduce\)\s*\{\s*\.lysis-anim \*[^}]*animation:\s*none/);
  });
});
