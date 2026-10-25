// Editable report headings. Run with `npm run test`.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import { headingIgnoresKey, singleLineHeading } from "./report-headings.ts";

describe("singleLineHeading", () => {
  it("turns pasted line breaks into single spaces", () => {
    assert.equal(singleLineHeading("Human hemoglobin beta —\n  purification report"), "Human hemoglobin beta — purification report");
    assert.equal(singleLineHeading("SEC\r\npolishing"), "SEC polishing");
  });

  it("leaves a one-line heading alone", () => {
    assert.equal(singleLineHeading("Quality control and storage"), "Quality control and storage");
  });
});

describe("headingIgnoresKey", () => {
  it("ignores Enter, which would add a line break to the wrapping field", () => {
    assert.equal(headingIgnoresKey("Enter"), true);
    assert.equal(headingIgnoresKey("a"), false);
  });
});
