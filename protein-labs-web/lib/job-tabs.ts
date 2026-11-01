/**
 * Keyboard model for the job-page tabs (components/protein-labs/job-tabs.tsx),
 * following the WAI-ARIA tabs pattern: arrows move between tabs and wrap,
 * Home and End jump to the ends. Any other key is left to the browser.
 */
export function tabKeyTarget(key: string, index: number, count: number): number | null {
  if (count < 1) return null;
  switch (key) {
    case "ArrowRight": return (index + 1) % count;
    case "ArrowLeft": return (index - 1 + count) % count;
    case "Home": return 0;
    case "End": return count - 1;
    default: return null;
  }
}

/** The tab to show: the requested one if it exists, else the first. */
export function activeTabId(ids: readonly string[], requested: string | null | undefined): string {
  return requested && ids.includes(requested) ? requested : ids[0] ?? "";
}
