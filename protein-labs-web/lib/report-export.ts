// What the purification report says about the protein, and the Markdown and
// standalone HTML files it exports.
//
// The on-screen page, Print/PDF and both exports read the protein's numbers
// from the same rows built here, so an exported report can never quote a
// different molecular weight, ε₂₈₀ or pI from the one the scientist saw. The
// values are the engine's ProtParam result and the saved construct, formatted
// but never recalculated.
//
// Only erasable TypeScript syntax and type-only imports are used, so the unit
// tests run under Node's built-in type stripping.
import type { JsonObject, ProjectJob, ProteinBundle } from "./protein-labs-api.ts";
import { gelFigureNote, readGelJobConfig } from "./gel-quantification.ts";
import { finalStorageBuffer } from "./roadmap-steps.ts";
import { assemblyValue, oligomericLabel, oligomericSummary, readOligomericState, subunitCount } from "./oligomeric-state.ts";
import { constructNumbers, type ConstructNumbers, type SpeciesNumbers } from "./construct-numbers.ts";

export type Figure = { id: string; jobId: string; caption: string };
export type ReportPage = {
  id: string;
  templateId: string;
  title: string;
  subtitle: string;
  content: string;
  hidden: boolean;
  showFacts: boolean;
  figures: Figure[];
};

export type ConstructRow = { species: string; residues: string; massDa: string; extinction: string };
export type ProteinProperties = {
  properties: [string, string][];
  construct: ConstructRow[];
  constructFacts: [string, string][];
};

export function jobConfig(bundle: ProteinBundle, appType: string): JsonObject {
  return bundle.projectJobs.find((job) => job.appType === appType)?.config ?? {};
}

/** Short, human-readable facts drawn from whichever jobs feed a page. */
export function pageFacts(bundle: ProteinBundle, templateId: string): [string, string][] {
  const rows: [string, string][] = [];
  const add = (label: string, value: unknown) => { const printable = text(value, ""); if (printable) rows.push([label, printable]); };
  if (templateId === "expression") {
    const host = jobConfig(bundle, "expression-system");
    const vector = jobConfig(bundle, "expression-planning");
    const run = jobConfig(bundle, "transformation-expression");
    add("Host strain", host.strainName);
    add("Host system", host.hostSystem);
    add("Promoter", host.promoter);
    add("Vector", vector.vectorName);
    add("Medium", run.mediaName);
    add("Induction", run.inductionSummary ?? run.induction);
    add("Harvest", run.harvestSummary ?? run.harvest);
  }
  if (templateId === "lysis") {
    const lysis = jobConfig(bundle, "purification-lysis");
    add("Method", lysis.methodName);
    add("Category", lysis.category);
    add("Mechanism", lysis.mechanism);
    add("Lysis buffer", lysis.bufferName);
    add("Buffer pH", lysis.bufferPH);
  }
  if (templateId === "affinity" || templateId === "cleanup" || templateId === "sec") {
    const appType = templateId === "affinity" ? "purification-affinity" : templateId === "cleanup" ? "purification-subtractive" : "purification-sec";
    const step = jobConfig(bundle, appType);
    add("Column or resin", step.columnName);
    add("Tag", step.tag);
    add("Ligand", step.ligand);
    add("Binding", step.binding);
    add("Wash", step.wash);
    add("Elution", step.elution);
    add("Buffer", step.bufferName);
    if (templateId === "sec") { add("Expected mass", step.expectedMassKDa ? `${text(step.expectedMassKDa)} kDa` : ""); add("Sample volume", step.sampleVolumeMl ? `${text(step.sampleVolumeMl)} mL` : ""); }
  }
  if (templateId === "cleavage") {
    const cleavage = jobConfig(bundle, "purification-cleavage");
    add("Protease", cleavage.proteaseName);
    add("Recognition site", cleavage.recognitionSite ?? cleavage.site);
    add("Conditions", cleavage.conditions);
    add("Buffer", cleavage.bufferName);
    const { cleaved } = constructNumbers(bundle);
    add("Mass after cleavage", cleaved ? `${number(cleaved.massDa, 2)} Da` : "");
  }
  if (templateId === "quality") {
    const storage = finalStorageBuffer(bundle);
    const review = jobConfig(bundle, "purification-workflow");
    add("Storage buffer", storage?.name);
    add("Buffer pH", storage?.pH);
    add("Workflow review", review.reviewStatus);
    add("Reviewed", review.savedAt ? new Date(String(review.savedAt)).toLocaleDateString() : "");
  }
  return rows;
}

function savedConstruct(bundle: ProteinBundle): JsonObject {
  const cleavage = jobConfig(bundle, "purification-cleavage");
  const affinity = jobConfig(bundle, "purification-affinity");
  return asObject(cleavage.construct ?? affinity.construct);
}

/** The Protein properties page: predicted characteristics and the expressed construct. */
export function proteinProperties(bundle: ProteinBundle, numbers: ConstructNumbers = constructNumbers(bundle)): ProteinProperties {
  const protparam = bundle.protparam?.result ?? {};
  const extinction = asObject(protparam.extinctionCoefficient280);
  const construct = savedConstruct(bundle);
  const cleavage = jobConfig(bundle, "purification-cleavage");
  const affinity = jobConfig(bundle, "purification-affinity");
  const vector = jobConfig(bundle, "expression-planning");
  const host = jobConfig(bundle, "expression-system");
  const residues = String(bundle.protein.sequence.length);
  const nativeMass = number(protparam.molecularWeightDa, 2);
  const nativeExt = number(extinction.reducedMolarM1Cm1, 0);
  const oligomer = readOligomericState(jobConfig(bundle, "protparam"));
  const assemblyMass = assemblyValue(protparam.molecularWeightDa, oligomer);
  // Assembly rows sit beside the monomer rows, which then say they are per chain.
  const assembly = oligomer && assemblyMass !== null ? { name: oligomericLabel(oligomer), scale: `${subunitCount(oligomer)} × monomer` } : null;
  const monomer = assembly ? "Monomer " : "";
  const properties: [string, string][] = [
    [assembly ? "Monomer molecular weight" : "Molecular weight", `${nativeMass} Da`],
    [`${monomer}ε₂₈₀ (reduced cysteines)`, `${nativeExt} M⁻¹cm⁻¹`],
    [`${monomer}ε₂₈₀ (cystines formed)`, `${number(extinction.oxidizedMolarM1Cm1, 0)} M⁻¹cm⁻¹`],
    ["Theoretical pI", number(protparam.theoreticalPI, 2)],
    ["Residues", residues],
    ["Expression host", text(host.strainName, text(host.hostSystem, "Not selected"))],
    ["Oligomeric state", oligomer ? oligomericSummary(oligomer) : "Not recorded"],
  ];
  if (assembly) properties.push(
    [`${assembly.name} molecular weight (${assembly.scale})`, `${number(assemblyMass, 2)} Da`],
    [`${assembly.name} ε₂₈₀ (reduced cysteines, ${assembly.scale})`, `${number(assemblyValue(extinction.reducedMolarM1Cm1, oligomer), 0)} M⁻¹cm⁻¹`],
    [`${assembly.name} ε₂₈₀ (cystines formed, ${assembly.scale})`, `${number(assemblyValue(extinction.oxidizedMolarM1Cm1, oligomer), 0)} M⁻¹cm⁻¹`],
  );
  if (oligomer?.notes) properties.push(["Oligomeric-state notes", oligomer.notes]);
  // The same species the roadmap and SEC polishing quote. With no tag chosen
  // the native chain is what is expressed and purified.
  const row = (species: string, value: SpeciesNumbers | null): ConstructRow => value
    ? { species, residues: String(value.residues), massDa: number(value.massDa, 2), extinction: number(value.extinctionReduced, 0) }
    : { species, residues: "—", massDa: "—", extinction: "—" };
  const expressed = numbers.constructSource === "none" ? numbers.native : numbers.fusion;
  const constructRows = [row(numbers.constructSource === "none" ? "Native chain" : "Uncleaved fusion", expressed)];
  if (numbers.cleaves) constructRows.push(row("After tag cleavage", numbers.cleaved));
  if (numbers.assembly) constructRows.push(row(`${numbers.assemblyLabel} (${numbers.subunits} × ${numbers.purifiedSpecies})`, numbers.assembly));
  return {
    properties,
    construct: constructRows,
    constructFacts: [
      ["Affinity tag", text(construct.tagName ?? affinity.tag, "Not selected")],
      ["Linker", text(construct.linkerName, "None")],
      ["Vector junction", text(construct.junctionSequence, "None")],
      ["Cleavage", text(cleavage.proteaseName, "Not selected")],
      // The scar is what the researcher actually ends up with: the protease's
      // P1' residues plus whatever the backbone's junction leaves behind.
      ["Retained after cleavage", text(construct.scar, "No residual residues")],
      ["Expression vector", text(vector.vectorName, text(host.vectorFamilyName, "Not selected"))],
      ["Vector length", vector.featureCount ? `${text(vector.featureCount)} annotated features` : "—"],
    ],
  };
}

/**
 * The properties an export should carry, or null when the engine has not
 * characterised the protein and no construct was saved: such a page then
 * exports exactly as before, with no table of dashes.
 */
export function exportedProperties(bundle: ProteinBundle, page: ReportPage, numbers?: ConstructNumbers): ProteinProperties | null {
  if (page.templateId !== "properties") return null;
  const protparam = bundle.protparam?.result ?? {};
  const extinction = asObject(protparam.extinctionCoefficient280);
  const characterised = [protparam.molecularWeightDa, protparam.theoreticalPI, extinction.reducedMolarM1Cm1, extinction.oxidizedMolarM1Cm1]
    .some((value) => typeof value === "number" && Number.isFinite(value));
  const construct = savedConstruct(bundle);
  if (!characterised && !Object.keys(construct).length) return null;
  return proteinProperties(bundle, numbers);
}

export const constructColumns = ["Species", "Residues", "Molecular weight (Da)", "ε₂₈₀ reduced (M⁻¹cm⁻¹)"];

function markdownCell(value: string) {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ");
}
function markdownTable(head: string[], rows: string[][]) {
  return [`| ${head.map(markdownCell).join(" | ")} |`, `| ${head.map(() => "---").join(" | ")} |`, ...rows.map((row) => `| ${row.map(markdownCell).join(" | ")} |`)];
}

export function reportMarkdown(bundle: ProteinBundle, title: string, summary: string, pages: ReportPage[], numbers?: ConstructNumbers) {
  const lines = [`# ${title}`, "", summary, "", `**${bundle.protein.name}** · ${bundle.protein.sequence.length} aa · ${bundle.protein.organism || "organism not entered"}`, ""];
  for (const page of pages.filter((value) => !value.hidden)) {
    lines.push(`## ${page.title}`);
    if (page.subtitle) lines.push(`*${page.subtitle}*`);
    lines.push("");
    const properties = exportedProperties(bundle, page, numbers);
    if (properties) {
      lines.push(...markdownTable(["Property", "Value"], properties.properties), "");
      lines.push("### Expressed construct", "");
      lines.push(...markdownTable(constructColumns, properties.construct.map((row) => [row.species, row.residues, row.massDa, row.extinction])), "");
      for (const [label, value] of properties.constructFacts) lines.push(`- **${label}:** ${value}`);
      lines.push("");
    }
    if (page.showFacts) for (const [label, value] of pageFacts(bundle, page.templateId)) lines.push(`- **${label}:** ${value}`);
    if (page.content.trim()) { lines.push("", page.content.trim()); }
    for (const [index, figure] of page.figures.entries()) lines.push("", `_Figure ${index + 1}. ${figure.caption}_`);
    lines.push("");
  }
  return lines.join("\n");
}

function htmlFacts(facts: [string, string][]) {
  return facts.length ? `<dl>${facts.map(([label, value]) => `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`).join("")}</dl>` : "";
}

function htmlProperties(properties: ProteinProperties) {
  const rows = properties.construct.map((row) => `<tr><td>${escapeHtml(row.species)}</td><td class="num">${escapeHtml(row.residues)}</td><td class="num">${escapeHtml(row.massDa)}</td><td class="num">${escapeHtml(row.extinction)}</td></tr>`).join("");
  return `${htmlFacts(properties.properties)}
      <h3>Expressed construct</h3>
      <table class="construct"><thead><tr>${constructColumns.map((column, index) => `<th${index ? ` class="num"` : ""}>${escapeHtml(column)}</th>`).join("")}</tr></thead><tbody>${rows}</tbody></table>
      ${htmlFacts(properties.constructFacts)}`;
}

export function reportHtml(bundle: ProteinBundle, title: string, summary: string, pages: ReportPage[], analyses: ProjectJob[], numbers?: ConstructNumbers) {
  const body = pages.filter((page) => !page.hidden).map((page) => {
    const facts = page.showFacts ? pageFacts(bundle, page.templateId) : [];
    const properties = exportedProperties(bundle, page, numbers);
    const figures = page.figures.map((figure, index) => {
      const job = analyses.find((value) => value.id === figure.jobId);
      const image = job?.appType === "gel-analysis" && job.config.previewBase64
        ? `<img src="data:image/png;base64,${String(job.config.previewBase64)}" alt="${escapeHtml(figure.caption)}"/>`
        : `<p class="placeholder">${escapeHtml(job?.name ?? "Figure")}</p>`;
      // Whatever the caption claims, the figure carries the engine's own
      // verdict for each annotated lane, including the lanes it would not quantify.
      const note = job?.appType === "gel-analysis" ? gelFigureNote(readGelJobConfig(job.config)) : null;
      return `<figure>${image}<figcaption><b>Figure ${index + 1}.</b> ${escapeHtml(figure.caption)}${note ? ` <span class="gel-note">${escapeHtml(note)}</span>` : ""}</figcaption></figure>`;
    }).join("");
    return `<section class="sheet">
      <h2>${escapeHtml(page.title)}</h2>
      ${page.subtitle ? `<p class="subtitle">${escapeHtml(page.subtitle)}</p>` : ""}
      ${properties ? htmlProperties(properties) : ""}
      ${htmlFacts(facts)}
      ${page.content.trim() ? `<div class="notes">${escapeHtml(page.content).replace(/\n/g, "<br/>")}</div>` : ""}
      ${figures}
    </section>`;
  }).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"/><title>${escapeHtml(title)}</title><style>
    body { font-family: Georgia, "Times New Roman", serif; color: #14181b; margin: 0; background: #f2f2f3; }
    .sheet { background: #fff; max-width: 820px; margin: 24px auto; padding: 48px 56px; box-shadow: 0 2px 10px rgba(0,0,0,.08); }
    h1 { font-size: 30px; margin: 0 0 6px; } h2 { font-size: 21px; margin: 0 0 4px; border-bottom: 2px solid #14181b; padding-bottom: 7px; }
    h3 { font-size: 15px; margin: 22px 0 8px; }
    .subtitle { color: #5d666c; margin: 6px 0 16px; font-style: italic; }
    dl { display: grid; grid-template-columns: 1fr 1fr; gap: 0 26px; margin: 16px 0; }
    dl > div { display: flex; justify-content: space-between; gap: 14px; border-bottom: 1px solid #e3e5e7; padding: 6px 0; }
    dt { color: #5d666c; font-size: 13px; } dd { margin: 0; font-weight: 600; font-size: 13px; text-align: right; }
    table.construct { width: 100%; border-collapse: collapse; font-size: 13px; margin: 0 0 12px; }
    table.construct th { text-align: left; font-weight: 600; color: #5d666c; border-bottom: 1.5px solid #14181b; padding: 6px 8px 6px 0; }
    table.construct td { border-bottom: 1px solid #e3e5e7; padding: 7px 8px 7px 0; }
    table.construct .num { text-align: right; font-variant-numeric: tabular-nums; }
    table.construct th:last-child, table.construct td:last-child { padding-right: 0; }
    .notes { white-space: pre-wrap; line-height: 1.6; margin: 16px 0; }
    figure { margin: 22px 0; } figure img { max-width: 100%; border: 1px solid #d8dadd; }
    figcaption { font-size: 12px; color: #5d666c; margin-top: 7px; }
    figcaption .gel-note { display: block; margin-top: 5px; font-size: 11px; line-height: 1.5; color: #6d767c; }
    .placeholder { color: #8a9197; font-style: italic; }
    @media print { body { background: #fff; } .sheet { box-shadow: none; margin: 0; page-break-after: always; } }
  </style></head><body>
    <section class="sheet"><h1>${escapeHtml(title)}</h1><p class="subtitle">${escapeHtml(summary)}</p>
    <dl><div><dt>Construct</dt><dd>${escapeHtml(bundle.protein.name)}</dd></div><div><dt>Length</dt><dd>${bundle.protein.sequence.length} aa</dd></div><div><dt>Organism</dt><dd>${escapeHtml(bundle.protein.organism || "—")}</dd></div><div><dt>Prepared</dt><dd>${new Date().toLocaleDateString()}</dd></div></dl></section>
    ${body}
  </body></html>`;
}

export function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
export function array(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}
export function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}
export function number(value: unknown, digits: number) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
}
export function escapeHtml(value: string) {
  return value.replace(/[&<>"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[character] ?? character));
}
