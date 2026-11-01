import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "vitest";
import { citationHref, citations, citationScope, citationShortLabel, licenseRegister, type CitationId } from "./citations.ts";

// Every source the HOM-303 brief names must be citable from the registry.
const HOM_303_SOURCES: CitationId[] = [
  "shoebill2026", "mall2025plm", "mascl2025", "ucl-sgp", "ita2016",
  "ucbshift2", "legolas2025", "shiftx2", "rdkit", "molstar", "bmrb", "ccd",
];

describe("citation registry", () => {
  it("covers every HOM-303 source", () => {
    for (const id of HOM_303_SOURCES) assert.ok(citations[id], id);
  });

  it("keys entries by their own id and gives each a working link", () => {
    for (const [key, citation] of Object.entries(citations)) {
      assert.equal(citation.id, key);
      assert.ok(citation.authors && citation.year && citation.title && citation.source, key);
      if (citation.doi) assert.match(citation.doi, /^10\.\d{4,9}\/\S+$/, key);
      assert.match(citationHref(citation) ?? "", /^https?:\/\//, key);
    }
  });

  it("defines each id once, so parallel branches that add the same source cannot both keep it", () => {
    const source = readFileSync(new URL("./citations.ts", import.meta.url), "utf8");
    const ids = [...source.matchAll(/^\s+id: "([^"]+)"/gm)].map((match) => match[1]);
    assert.deepEqual(ids.filter((id, index) => ids.indexOf(id) !== index), []);
  });

  it("prefers the DOI over the project URL", () => {
    assert.equal(citationHref(citations.shiftx2), "https://doi.org/10.1007/s10858-011-9478-4");
    assert.equal(citationHref(citations["ucl-sgp"]), "http://img.chem.ucl.ac.uk/sgp/mainmenu.htm");
  });

  it("writes short labels the way running text cites them", () => {
    assert.equal(citationShortLabel(citations.shiftx2), "Han et al. 2011");
    assert.equal(citationShortLabel(citations.mascl2025), "Liao & Sun 2025");
    assert.equal(citationShortLabel(citations["ucl-sgp"]), "Cockcroft 1999");
    assert.equal(citationShortLabel(citations.ita2016), "Aroyo 2016");
    assert.equal(citationShortLabel(citations.bmrb), "Hoch et al. 2023");
    assert.equal(citationShortLabel(citations.rdkit), "RDKit contributors 2006–");
  });
});

describe("citation scope", () => {
  it("numbers in first-use order and ignores repeats", () => {
    const scope = citationScope("hsqc", ["shiftx2", "bmrb", "shiftx2", "ucbshift2"]);
    assert.deepEqual(scope.ids, ["shiftx2", "bmrb", "ucbshift2"]);
    assert.equal(scope.number("ucbshift2"), 3);
    assert.equal(scope.anchor("bmrb"), "ref-hsqc-bmrb");
  });

  it("refuses a marker whose source is missing from the list", () => {
    const scope = citationScope("hsqc", ["shiftx2"]);
    assert.throws(() => scope.number("rdkit"), /not in the "hsqc" reference list/);
  });
});

describe("licence register", () => {
  it("lists only entries with a recorded licence, with a source link for each", () => {
    const rows = licenseRegister();
    assert.ok(rows.some((row) => row.id === "molstar" && row.license.reuse === "permissive"));
    assert.ok(rows.some((row) => row.id === "ucbshift2" && row.license.reuse === "restricted"));
    assert.ok(rows.some((row) => row.id === "shoebill2026" && row.license.reuse === "none"));
    assert.ok(!rows.some((row) => row.id === "bmrb"));
    for (const row of rows) assert.match(row.license.url, /^https?:\/\//);
  });
});
