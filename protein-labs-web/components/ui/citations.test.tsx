import assert from "node:assert/strict";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, it } from "vitest";
import { citationScope, licenseRegister } from "../../lib/citations.ts";
import { Cite, CiteGroup, LicenseList, ReferenceList } from "./citations.tsx";

const hrefs = (html: string) => [...html.matchAll(/href="#([^"]+)"/g)].map((match) => match[1]);
const anchors = (html: string) => [...html.matchAll(/<li id="([^"]+)"/g)].map((match) => match[1]);
const markerText = (html: string) => html.replace(/<[^>]+>/g, "");

describe("citation markers", () => {
  const scope = citationScope("hsqc", ["shiftx2", "ucbshift2", "legolas2025", "bmrb"]);

  it("numbers a marker from the scope and points it at the list anchor", () => {
    const html = renderToStaticMarkup(<Cite scope={scope} id="bmrb"/>);
    assert.equal(markerText(html), "[4]");
    assert.deepEqual(hrefs(html), ["ref-hsqc-bmrb"]);
    assert.match(html, /aria-label="Reference 4: Hoch et al\. 2023: Biological Magnetic Resonance Data Bank"/);
  });

  it("sorts a group by list number and drops repeats", () => {
    const html = renderToStaticMarkup(<CiteGroup scope={scope} ids={["legolas2025", "shiftx2", "legolas2025"]}/>);
    assert.equal(markerText(html), "[1, 3]");
    assert.deepEqual(hrefs(html), ["ref-hsqc-shiftx2", "ref-hsqc-legolas2025"]);
  });

  it("refuses to draw a marker for a source missing from the list", () => {
    assert.throws(() => renderToStaticMarkup(<Cite scope={scope} id="rdkit"/>), /not in the "hsqc" reference list/);
  });
});

describe("reference list", () => {
  const scope = citationScope("xtal", ["mascl2025", "ucl-sgp", "mascl2025"]);
  const html = renderToStaticMarkup(<ReferenceList scope={scope}/>);

  it("gives every marker a matching list entry, in scope order", () => {
    const markers = renderToStaticMarkup(<CiteGroup scope={scope} ids={["ucl-sgp", "mascl2025"]}/>);
    assert.deepEqual(anchors(html), ["ref-xtal-mascl2025", "ref-xtal-ucl-sgp"]);
    assert.deepEqual(hrefs(markers), anchors(html));
    assert.match(html, /\[1\][^]*MASCL[^]*\[2\][^]*UCL space-group diagrams/);
  });

  it("shows authors, year, title, source and an outside link, DOI first", () => {
    assert.match(html, /Liao KJ, Sun YJ \(2025\)\. <cite>Using AlphaFold/);
    assert.match(html, /Proteins 93:1747–1766\./);
    assert.match(html, /href="https:\/\/doi\.org\/10\.1002\/prot\.26844" target="_blank" rel="noreferrer">doi:10\.1002\/prot\.26844/);
    assert.match(html, /href="http:\/\/img\.chem\.ucl\.ac\.uk\/sgp\/mainmenu\.htm" target="_blank"/);
    assert.match(html, /<span class="reference-kind">Website<\/span>/);
  });

  it("labels the section by its heading and draws nothing for an empty scope", () => {
    assert.match(html, /aria-labelledby="ref-xtal-heading"[^]*id="ref-xtal-heading"/);
    assert.equal(renderToStaticMarkup(<ReferenceList scope={citationScope("none", [])}/>), "");
  });
});

describe("licence list", () => {
  const html = renderToStaticMarkup(<LicenseList/>);
  const rows = [...html.matchAll(/<tr><th scope="row">(.*?)<\/tr>/g)].map((match) => match[1]);

  it("has one row per register entry, in register order", () => {
    const register = licenseRegister();
    assert.equal(rows.length, register.length);
    rows.forEach((row, index) => assert.ok(row.startsWith(register[index].name ?? register[index].title), row));
  });

  it("pairs each reuse class with a labelled chip, not colour alone", () => {
    const row = (name: string) => rows.find((entry) => entry.startsWith(name)) ?? "";
    assert.match(row("Mol*"), /status-chip pass.*Reuse allowed with notice/);
    assert.match(row("UCBShift 2.0"), /status-chip attention.*Restricted use/);
    assert.match(row("Shoebill"), /status-chip review.*Cite only — no reuse/);
    assert.match(row("UCBShift 2.0"), /href="https:\/\/github\.com\/THGLab\/CSpred\/blob\/master\/LICENSE\.txt"/);
  });
});
