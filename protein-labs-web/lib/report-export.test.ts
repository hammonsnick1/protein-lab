// The report exports carry the protein's numbers (HOM-120). Run with
// `npm run test` in protein-labs-web.
import assert from "node:assert/strict";
import { describe, it } from "vitest";

import type { ProjectJob, ProteinBundle } from "./protein-labs-api.ts";
import { proteinProperties, reportHtml, reportMarkdown, type ReportPage } from "./report-export.ts";

function job(appType: string, config: ProjectJob["config"]): ProjectJob {
  return { id: appType, proteinId: "p1", name: appType, appType, status: "complete", config, createdAt: "", updatedAt: "" };
}

// Human haemoglobin β, the reference protein, with the engine's own ProtParam
// output for it (unrounded, as the backend returns it).
const sequence = "MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH";
const reference: ProteinBundle = {
  protein: { id: "p1", name: "Hemoglobin subunit beta", sequence, organism: "Homo sapiens", geneName: "HBB", description: "", expressionSystem: "", notes: "", tags: [], externalIds: {} },
  protparam: {
    result: { molecularWeightDa: 15998.206400000001, theoreticalPI: 6.744537544250489, extinctionCoefficient280: { reducedMolarM1Cm1: 15470, oxidizedMolarM1Cm1: 15595 } },
    analyzedAt: "",
  },
  blastJobs: [], uniprotMatches: [], pdbMatches: [], alphaFoldModels: [],
  projectJobs: [
    job("expression-system", { strainName: "BL21(DE3)" }),
    job("expression-planning", { vectorName: "pET-28a(+)", featureCount: 12 }),
    job("purification-affinity", { tag: "His6" }),
    job("purification-cleavage", {
      proteaseName: "TEV protease",
      // Illustrative saved construct; the export must carry it verbatim.
      construct: { tagName: "His6-TEV", fusionLength: 163, fusionMassDa: 18321.7, fusionExtinction: 15470, cleavedLength: 144, cleavedMassDa: 16141.38, cleavedExtinction: 15470 },
    }),
  ],
  projectNotebook: null,
};

function page(templateId: string, patch: Partial<ReportPage> = {}): ReportPage {
  return { id: templateId, templateId, title: templateId === "properties" ? "Protein properties" : "Affinity capture", subtitle: "", content: "", hidden: false, showFacts: true, figures: [], ...patch };
}

const expected = ["15,998.21 Da", "15,470 M⁻¹cm⁻¹", "15,595 M⁻¹cm⁻¹", "6.74", "Expressed construct", "Uncleaved fusion", "After tag cleavage", "18,321.70", "16,141.38", "His6-TEV", "TEV protease", "pET-28a(+)"];

describe("report exports", () => {
  it("writes the properties and construct table to Markdown", () => {
    const markdown = reportMarkdown(reference, "Report", "Summary", [page("properties")]);
    for (const value of expected) assert.ok(markdown.includes(value), `Markdown is missing ${value}`);
    assert.match(markdown, /\| Molecular weight \| 15,998\.21 Da \|/);
    assert.match(markdown, /\| ε₂₈₀ \(reduced cysteines\) \| 15,470 M⁻¹cm⁻¹ \|/);
    assert.match(markdown, /\| ε₂₈₀ \(cystines formed\) \| 15,595 M⁻¹cm⁻¹ \|/);
    assert.match(markdown, /\| Theoretical pI \| 6\.74 \|/);
    assert.match(markdown, /\| Uncleaved fusion \| 163 \| 18,321\.70 \| 15,470 \|/);
    assert.match(markdown, /\| After tag cleavage \| 144 \| 16,141\.38 \| 15,470 \|/);
  });

  it("writes the properties and a styled construct table to HTML", () => {
    const html = reportHtml(reference, "Report", "Summary", [page("properties")], []);
    for (const value of expected) assert.ok(html.includes(value), `HTML is missing ${value}`);
    assert.match(html, /<dt>Molecular weight<\/dt><dd>15,998\.21 Da<\/dd>/);
    assert.match(html, /<dt>Theoretical pI<\/dt><dd>6\.74<\/dd>/);
    assert.match(html, /<table class="construct">/);
    assert.match(html, /table\.construct \{/);
    assert.match(html, /<td>After tag cleavage<\/td><td class="num">144<\/td><td class="num">16,141\.38<\/td>/);
  });

  it("exports the same values the on-screen page shows", () => {
    const screen = proteinProperties(reference);
    const markdown = reportMarkdown(reference, "Report", "Summary", [page("properties")]);
    const html = reportHtml(reference, "Report", "Summary", [page("properties")], []);
    for (const [label, value] of [...screen.properties, ...screen.constructFacts]) {
      assert.ok(markdown.includes(value), `Markdown is missing ${label}`);
      assert.ok(html.includes(value), `HTML is missing ${label}`);
    }
  });

  it("carries the properties even when the recorded plan is hidden, as the page does", () => {
    assert.ok(reportMarkdown(reference, "Report", "Summary", [page("properties", { showFacts: false })]).includes("15,998.21 Da"));
  });

  it("adds no empty section when the protein has not been characterised", () => {
    const bare: ProteinBundle = { ...reference, protparam: null, projectJobs: [] };
    const markdown = reportMarkdown(bare, "Report", "Summary", [page("properties")]);
    const html = reportHtml(bare, "Report", "Summary", [page("properties")], []);
    assert.equal(markdown, "# Report\n\nSummary\n\n**Hemoglobin subunit beta** · 147 aa · Homo sapiens\n\n## Protein properties\n\n");
    assert.ok(!html.includes("Expressed construct"));
    assert.ok(!html.includes("<table"));
    assert.ok(!html.includes("Molecular weight"));
  });

  it("keeps the properties tables on the properties page only", () => {
    const markdown = reportMarkdown(reference, "Report", "Summary", [page("affinity")]);
    const html = reportHtml(reference, "Report", "Summary", [page("affinity")], []);
    assert.ok(!markdown.includes("Expressed construct"));
    assert.ok(!html.includes("Expressed construct"));
    assert.ok(markdown.includes("- **Tag:** His6"));
  });
});
