// Roadmap step-menu placement. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { dismissesMenu, MENU_MARGIN, menuAnchor, placeMenu } from "./context-menu.ts";

const menu = { width: 320, height: 483 };
const topBar = 68;

describe("menuAnchor", () => {
  it("opens a pointer-clicked menu at the pointer", () => {
    assert.deepEqual(menuAnchor({ detail: 1, clientX: 832, clientY: 743 }, { left: 688, bottom: 765 }), { x: 832, y: 743 });
  });

  it("opens a keyboard-activated menu under its control, not at the window corner", () => {
    assert.deepEqual(menuAnchor({ detail: 0, clientX: 0, clientY: 0 }, { left: 688, bottom: 765 }), { x: 688, y: 765 });
  });
});

describe("placeMenu", () => {
  it("leaves a menu that fits where it was opened", () => {
    assert.deepEqual(placeMenu({ x: 300, y: 200 }, menu, { width: 1440, height: 900 }, topBar), { left: 300, top: 200 });
  });

  it("opens upward from a step's lower button instead of running off the bottom (1440×900)", () => {
    const placed = placeMenu({ x: 832, y: 743 }, menu, { width: 1440, height: 900 }, topBar);
    assert.equal(placed.top, 743 - menu.height);
    assert.ok(placed.top + menu.height <= 900 - MENU_MARGIN);
  });

  it("stays inside the minimum 900×650 window and below the top bar", () => {
    const placed = placeMenu({ x: 730, y: 467 }, menu, { width: 900, height: 650 }, topBar);
    assert.ok(placed.left >= MENU_MARGIN && placed.left + menu.width <= 900 - MENU_MARGIN);
    assert.ok(placed.top >= topBar + MENU_MARGIN && placed.top + menu.height <= 650 - MENU_MARGIN);
  });

  it("never puts a keyboard-opened menu under the top bar", () => {
    assert.equal(placeMenu({ x: 0, y: 0 }, menu, { width: 1440, height: 900 }, topBar).top, topBar + MENU_MARGIN);
  });
});

describe("dismissesMenu", () => {
  it("closes on Escape only", () => {
    assert.equal(dismissesMenu("Escape"), true);
    assert.equal(dismissesMenu("Enter"), false);
  });
});
