// Editable report headings, kept free of React so the rules can be tested with
// `npm run test`. The headings are one-row textareas that wrap on narrow
// windows instead of clipping, but they stay one line of text.

/** Pasted or typed line breaks become single spaces. */
export function singleLineHeading(value: string): string {
  return value.replace(/\s*[\r\n]+\s*/g, " ");
}

/** Enter would add a line break, so the heading ignores it. */
export function headingIgnoresKey(key: string): boolean {
  return key === "Enter";
}
