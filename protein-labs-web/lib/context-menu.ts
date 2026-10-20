// Placement for the purification roadmap's step menus, kept free of React and
// the DOM so it can be tested with `npm run test`.

type Point = { x: number; y: number };
type Size = { width: number; height: number };

// Distance kept between the menu and the window edges.
export const MENU_MARGIN = 8;

/**
 * Where a menu opened by a click should start. A keyboard-activated click has
 * `detail` 0 and no pointer position (clientX/Y are 0), so the menu opens under
 * the activated control instead of at the window's corner.
 */
export function menuAnchor(click: { detail: number; clientX: number; clientY: number }, control: { left: number; bottom: number }): Point {
  if (click.detail > 0) return { x: click.clientX, y: click.clientY };
  return { x: control.left, y: control.bottom };
}

/**
 * Keep the whole menu in the window and below the top bar (`floor`). Near the
 * bottom edge it opens upward from the point, near the right edge leftward.
 */
export function placeMenu(point: Point, menu: Size, viewport: Size, floor: number): { left: number; top: number } {
  const top = point.y + menu.height > viewport.height - MENU_MARGIN ? point.y - menu.height : point.y;
  return {
    left: Math.max(MENU_MARGIN, Math.min(point.x, viewport.width - menu.width - MENU_MARGIN)),
    top: Math.max(floor + MENU_MARGIN, Math.min(top, viewport.height - menu.height - MENU_MARGIN)),
  };
}

/** Keys that close an open menu. */
export function dismissesMenu(key: string): boolean {
  return key === "Escape";
}
