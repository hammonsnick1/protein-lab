"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, Check, Eye, EyeOff, FileCode2, FileDown, FileText, Image as ImageIcon,
  LoaderCircle, Plus, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { JsonObject, ProjectJob, ProteinBundle } from "@/lib/protein-labs-api";
import { proteinLabsApi } from "@/lib/protein-labs-api";
import { StructureViewer } from "@/components/protein-labs/structure-viewer";
import { CaveatsBlock, MethodsBlock, PurityBlock, SecBlock, YieldBlock } from "@/components/protein-labs/report-blocks";
import { desktopBridge } from "@/lib/desktop-bridge";
import { captureFigure } from "@/lib/report-figures";
import {
  assignedMass, buildReportData, emptyYieldEntry, formatMass, formatNumber, formatPurity, loadYieldEntries, secCalibrated, yieldStages,
  type ReportData, type YieldEntry,
} from "@/lib/report-data";
import { dedupe, reportDocumentHtml, runningHeader, type PrintBlock, type PrintFigure, type PrintPage } from "@/lib/report-print";

/**
 * Publication-quality purification report.
 *
 * One page per stage of the work, each pre-filled from what the project
 * actually saved and each fully editable, plus the consolidated pages that
 * carry the purification itself: yield across every stage, purity per stage
 * from the gel, the size-exclusion mass with its fit quality, a methods
 * section a reader could follow, and every flag the engines raised.
 *
 * `lib/report-data.ts` is the only place project data is read, and
 * `lib/report-print.ts` turns the same model into the printable document the
 * PDF and the standalone HTML are both written from.
 */

type Figure = { id: string; jobId: string; caption: string };
type ReportPage = {
  id: string;
  templateId: string;
  title: string;
  subtitle: string;
  content: string;
  hidden: boolean;
  showFacts: boolean;
  figures: Figure[];
};

type PageTemplate = {
  id: string;
  title: string;
  subtitle: string;
  prompt: string;
  // Workflow jobs whose saved configuration fills this page in.
  sources: string[];
  figures: boolean;
  /** Calculated pages hold a table rather than an A4 box of prose. */
  flows?: boolean;
};

const pageTemplates: PageTemplate[] = [
  { id: "properties", title: "Protein properties", subtitle: "Target, construct, and predicted characteristics", prompt: "Summarise what the protein is, why it was made, and anything a reader needs before the methods.", sources: [], figures: false },
  { id: "vector", title: "Expression vector", subtitle: "The annotated plasmid carrying the construct", prompt: "Note the backbone, the cloning strategy, how the insert was verified, and the sequencing result.", sources: ["expression-planning"], figures: false },
  { id: "methods", title: "Methods", subtitle: "Conditions a reader could follow to repeat the work", prompt: "Add anything the planning jobs cannot know: equipment, timings, temperatures, and deviations.", sources: [], figures: false, flows: true },
  { id: "expression", title: "Transformation and expression", subtitle: "Host, medium, induction, and harvest", prompt: "Record the starting material, culture scale, induction conditions, harvest, and any deviation from the plan.", sources: ["expression-system", "expression-planning", "transformation-expression"], figures: true },
  { id: "lysis", title: "Cell lysis and clarification", subtitle: "Disruption and removal of insoluble material", prompt: "Record cell mass, resuspension volume, disruption settings, temperature, clarification, and retained samples.", sources: ["purification-lysis"], figures: true },
  { id: "affinity", title: "Affinity capture", subtitle: "Tag capture on the selected medium", prompt: "Record load, flow-through, wash volumes, elution, pooled fractions, yield, and purity.", sources: ["purification-affinity"], figures: true },
  { id: "cleavage", title: "Affinity-tag cleavage", subtitle: "Protease treatment and completion", prompt: "Record protease ratio, time, temperature, completion checked by gel, and retained samples.", sources: ["purification-cleavage"], figures: true },
  { id: "cleanup", title: "Subtractive cleanup", subtitle: "Removal of tag, uncleaved fusion, and protease", prompt: "Record load, flow-through recovery, and how completely the tagged species were removed.", sources: ["purification-subtractive"], figures: true },
  { id: "sec", title: "SEC polishing", subtitle: "Final size-exclusion step and solution state", prompt: "Record column, injection volume, flow rate, elution volume, pooled fractions, and the oligomeric state.", sources: ["purification-sec"], figures: true },
  { id: "yield", title: "Yield and recovery", subtitle: "Volume, total protein, and recovery at each stage", prompt: "Explain anything the table cannot: pooling decisions, samples held back, and losses you can account for.", sources: ["purification-roadmap"], figures: false, flows: true },
  { id: "purity", title: "Purity by stage", subtitle: "Quantified from the saved gel densitometry", prompt: "Note which lane was loaded from which stage, the load per lane, and the stain used.", sources: ["gel-analysis"], figures: true, flows: true },
  { id: "mass", title: "Size-exclusion molecular mass", subtitle: "Apparent mass, calibration, and fit quality", prompt: "Interpret the oligomeric state and say how confident the assignment is.", sources: ["chromatogram-studio"], figures: true, flows: true },
  { id: "quality", title: "Quality control and storage", subtitle: "Final concentration, purity, and handling", prompt: "Record final concentration and how it was measured, purity, aliquots, storage buffer, temperature, and freeze–thaw guidance.", sources: ["purification-buffer", "purification-workflow"], figures: true },
  { id: "caveats", title: "Caveats and engine flags", subtitle: "Every flag the analysis engines raised on these numbers", prompt: "Add any caveat the software cannot see, and say what was done about the flags above.", sources: [], figures: false, flows: true },
];

/** Which calculated block, if any, a page carries. */
const dataBlocks: Record<string, PrintBlock["kind"]> = {
  yield: "yield",
  purity: "purity",
  mass: "sec",
  methods: "methods",
  caveats: "flags",
};

export function ReportsWorkspace({ bundle, onChanged }: { bundle: ProteinBundle; onChanged: () => Promise<void> }) {
  const saved = bundle.projectNotebook;
  const [title, setTitle] = useState(saved?.title ?? `${bundle.protein.name} — purification report`);
  const [summary, setSummary] = useState(saved?.summary ?? "Expression, purification, and quality-control record.");
  const [pages, setPages] = useState<ReportPage[]>(() => loadPages(saved?.sections));
  const [entries, setEntries] = useState<YieldEntry[]>(() => loadEntries(bundle, saved?.sections));
  const [busy, setBusy] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState<string>("");
  const [geometry, setGeometry] = useState<JsonObject | null>(null);
  const [vectors, setVectors] = useState<JsonObject[]>([]);
  const hydrated = useRef(false);
  const desktop = useMemo(() => desktopBridge(), []);

  const analyses = useMemo(
    () => bundle.projectJobs.filter((job) => job.appType === "chromatogram-studio" || job.appType === "gel-analysis"),
    [bundle.projectJobs],
  );
  // Everything calculated in the report comes from one derivation of the
  // project, so the screen, the PDF, and the HTML export cannot disagree.
  const data = useMemo(() => buildReportData(bundle, entries), [bundle, entries]);
  // Figure numbers run across the whole report, assigned once here so the
  // caption on screen and the caption in the printed document are the same
  // number.
  const figureNumbers = useMemo(() => {
    const numbers = new Map<string, number>();
    let next = 0;
    for (const page of pages.filter((value) => !value.hidden)) {
      if (page.templateId === "properties" && geometry) numbers.set(plateId("structure", page.id), (next += 1));
      if (page.templateId === "vector" && vectors.length) numbers.set(plateId("vector", page.id), (next += 1));
      for (const figure of page.figures) numbers.set(figure.id, (next += 1));
    }
    return numbers;
  }, [geometry, pages, vectors.length]);

  useEffect(() => {
    if (hydrated.current || dirty) return;
    hydrated.current = true;
    setTitle(saved?.title ?? `${bundle.protein.name} — purification report`);
    setSummary(saved?.summary ?? "Expression, purification, and quality-control record.");
    setPages(loadPages(saved?.sections));
    setEntries(loadEntries(bundle, saved?.sections));
  }, [bundle, dirty, saved]);

  // The predicted structure is stored separately from the bundle, so the
  // cover page fetches the saved model's coordinates once.
  useEffect(() => {
    const model = bundle.alphaFoldModels[0];
    const modelId = model ? String(model.modelId ?? "") : "";
    if (!modelId) return;
    let active = true;
    proteinLabsApi.getAlphaFoldModel(bundle.protein.id, modelId)
      .then((value) => { if (active) setGeometry(asObject(value.geometry)); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [bundle.protein.id, bundle.alphaFoldModels]);

  useEffect(() => {
    let active = true;
    proteinLabsApi.listVectors(bundle.protein.id)
      .then((value) => { if (active) setVectors(value.vectors); })
      .catch(() => undefined);
    return () => { active = false; };
  }, [bundle.protein.id]);

  useEffect(() => {
    if (!dirty) return;
    const timer = window.setTimeout(() => void save(true), 1400);
    return () => window.clearTimeout(timer);
    // Autosave follows edits rather than a refreshed bundle.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [title, summary, pages, entries, dirty]);

  function edit(next: ReportPage[]) { setPages(next); setDirty(true); }
  function editEntry(id: string, patch: Partial<YieldEntry>) {
    const stage = data.yieldRows.find((row) => row.id === id)?.stage ?? "";
    setEntries((current) => {
      const existing = current.find((value) => value.id === id);
      return existing
        ? current.map((value) => (value.id === id ? { ...value, ...patch } : value))
        : [...current, { ...emptyYieldEntry(id, stage), ...patch }];
    });
    setDirty(true);
  }
  function updatePage(id: string, patch: Partial<ReportPage>) { edit(pages.map((page) => (page.id === id ? { ...page, ...patch } : page))); }
  function movePage(index: number, direction: -1 | 1) {
    const target = index + direction;
    if (target < 0 || target >= pages.length) return;
    const next = [...pages];
    [next[index], next[target]] = [next[target], next[index]];
    edit(next);
  }
  function addPage() {
    edit([...pages, { id: crypto.randomUUID(), templateId: "custom", title: "Additional page", subtitle: "", content: "", hidden: false, showFacts: false, figures: [] }]);
  }
  function removePage(id: string) { edit(pages.filter((page) => page.id !== id)); }
  function attachFigure(pageId: string, job: ProjectJob) {
    const page = pages.find((value) => value.id === pageId);
    if (!page) return;
    updatePage(pageId, { figures: [...page.figures, { id: crypto.randomUUID(), jobId: job.id, caption: job.name }] });
    setPicker("");
  }
  function updateFigure(pageId: string, figureId: string, patch: Partial<Figure>) {
    const page = pages.find((value) => value.id === pageId);
    if (!page) return;
    updatePage(pageId, { figures: page.figures.map((figure) => (figure.id === figureId ? { ...figure, ...patch } : figure)) });
  }
  function removeFigure(pageId: string, figureId: string) {
    const page = pages.find((value) => value.id === pageId);
    if (!page) return;
    updatePage(pageId, { figures: page.figures.filter((figure) => figure.id !== figureId) });
  }
  function restoreDefaults() {
    if (!window.confirm("Rebuild the standard report pages? Your typed notes on removed pages will be lost.")) return;
    edit(defaultPages());
    setMessage("Standard report pages restored.");
  }

  async function save(automatic = false) {
    setBusy(true);
    if (!automatic) setMessage("");
    try {
      const sections = [...pages.map(toSection), yieldSection(entries)] as unknown as JsonObject[];
      await proteinLabsApi.saveNotebook(bundle.protein.id, title, summary, sections);
      setDirty(false);
      if (!automatic) { await onChanged(); setMessage("Report saved locally."); }
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  /**
   * The printable document, built from what is on screen.
   *
   * Figures are lifted out of the live report as SVG rather than redrawn, so a
   * chromatogram reaches the PDF as vector paths and stays sharp at any zoom.
   */
  const printInput = useCallback((mode: "pdf" | "html") => ({
    mode,
    title,
    summary,
    preparedOn: new Date().toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" }),
    protein: {
      name: bundle.protein.name,
      length: bundle.protein.sequence.length,
      organism: bundle.protein.organism,
      geneName: bundle.protein.geneName,
    },
    data,
    pages: pages.filter((page) => !page.hidden).map((page) => printPage(page, bundle, vectors, figureNumbers)),
  }), [bundle, data, figureNumbers, pages, summary, title, vectors]);

  async function exportPdf() {
    if (!desktop) {
      setMessage("PDF export needs the Protein Lab desktop app, which writes the file with a real PDF engine. In a browser, use Standalone HTML and print it to PDF.");
      return;
    }
    setExporting(true);
    setMessage("");
    try {
      const document = reportDocumentHtml(printInput("pdf"));
      const result = await desktop.exportReportPdf({
        html: document,
        filename: safeName(title),
        header: runningHeader(title, bundle.protein.name),
        footer: `${bundle.protein.name} · prepared ${new Date().toLocaleDateString()}`,
      });
      if (result.ok) setMessage(`Report written to ${result.path}.`);
      else if (result.cancelled) setMessage("PDF export cancelled.");
      else setMessage(result.reason ?? "The PDF could not be written.");
    } catch (reason) {
      setMessage(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setExporting(false);
    }
  }

  function exportHtml() {
    download(`${safeName(title)}.html`, reportDocumentHtml(printInput("html")), "text/html");
    setMessage("A standalone HTML report was exported. It prints with the same layout as the PDF.");
  }
  function exportMarkdown() {
    download(`${safeName(title)}.md`, reportMarkdown(bundle, title, summary, pages, data), "text/markdown");
    setMessage("A Markdown summary was exported.");
  }

  const visible = pages.filter((page) => !page.hidden);

  return <main className="reports-workspace">
    <aside className="reports-sidebar">
      <span className="eyebrow">REPORT BUILDER</span>
      <h2>Purification report</h2>
      <p>Each page is filled in from what this project saved and stays fully editable. Print or export when the record is complete.</p>
      <Button onClick={() => void save(false)} disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <Check/>} Save report</Button>
      <Button onClick={() => void exportPdf()} disabled={exporting || !desktop} title={desktop ? "Write a PDF with selectable text and vector figures" : "Available in the Protein Lab desktop app"}>
        {exporting ? <LoaderCircle className="spin"/> : <FileDown/>} {exporting ? "Writing PDF…" : "Export PDF"}
      </Button>
      {!desktop && <small className="reports-sidebar-note">PDF export runs in the desktop app. In a browser, export standalone HTML and print that.</small>}
      <hr/>
      <strong>Pages</strong>
      <ol className="reports-page-list">
        {pages.map((page, index) => <li key={page.id} className={page.hidden ? "hidden-page" : ""}>
          <button onClick={() => document.getElementById(`report-page-${page.id}`)?.scrollIntoView({ behavior: "smooth", block: "start" })}>
            <span>{page.hidden ? "—" : String(visible.indexOf(page) + 1)}</span>
            <small>{page.title}</small>
          </button>
          <span className="reports-page-tools">
            <button title={page.hidden ? "Include this page" : "Leave this page out"} onClick={() => updatePage(page.id, { hidden: !page.hidden })}>{page.hidden ? <EyeOff/> : <Eye/>}</button>
            <button title="Move up" disabled={index === 0} onClick={() => movePage(index, -1)}><ArrowUp/></button>
            <button title="Move down" disabled={index === pages.length - 1} onClick={() => movePage(index, 1)}><ArrowDown/></button>
            <button title="Delete page" onClick={() => removePage(page.id)}><Trash2/></button>
          </span>
        </li>)}
      </ol>
      <Button variant="outline" size="sm" onClick={addPage}><Plus/> Add a page</Button>
      <Button variant="ghost" size="sm" onClick={restoreDefaults}>Restore standard pages</Button>
      <hr/>
      <strong>Export</strong>
      <Button variant="outline" onClick={exportHtml}><FileCode2/> Standalone HTML</Button>
      <Button variant="outline" onClick={exportMarkdown}><FileText/> Markdown</Button>
      <div className="autosave-state"><span className={dirty ? "dirty" : "saved"}/>{dirty ? "Unsaved changes" : "All changes saved"}</div>
      {message && <div className="notebook-message">{message}<button onClick={() => setMessage("")}><X/></button></div>}
    </aside>

    <div className="reports-pages">
      <article className="report-sheet report-title-sheet">
        <div className="report-sheet-inner">
          <span className="report-kicker">PROTEIN LAB · PURIFICATION RECORD</span>
          <input className="report-title-input" value={title} onChange={(event) => { setTitle(event.target.value); setDirty(true); }}/>
          <textarea className="report-summary-input" rows={2} value={summary} onChange={(event) => { setSummary(event.target.value); setDirty(true); }}/>
          <dl className="report-title-facts">
            <div><dt>Construct</dt><dd>{bundle.protein.name}</dd></div>
            <div><dt>Length</dt><dd>{bundle.protein.sequence.length} aa</dd></div>
            <div><dt>Organism</dt><dd>{bundle.protein.organism || "—"}</dd></div>
            <div><dt>Gene</dt><dd>{bundle.protein.geneName || "—"}</dd></div>
            <div><dt>Prepared</dt><dd>{new Date().toLocaleDateString([], { year: "numeric", month: "long", day: "numeric" })}</dd></div>
            <div><dt>Pages</dt><dd>{visible.length}</dd></div>
          </dl>
        </div>
      </article>

      {pages.map((page) => {
        const template = pageTemplates.find((value) => value.id === page.templateId);
        const facts = pageFacts(bundle, page.templateId);
        const pageNumber = page.hidden ? null : visible.indexOf(page) + 1;
        const block = dataBlocks[page.templateId];
        return <article key={page.id} id={`report-page-${page.id}`} className={`report-sheet ${template?.flows ? "report-sheet-flow" : ""} ${page.hidden ? "is-excluded" : ""}`}>
          <div className="report-sheet-inner">
            <header className="report-sheet-header">
              <span>
                <input className="report-page-title" value={page.title} onChange={(event) => updatePage(page.id, { title: event.target.value })}/>
                <input className="report-page-subtitle" value={page.subtitle} placeholder="Optional subtitle" onChange={(event) => updatePage(page.id, { subtitle: event.target.value })}/>
              </span>
              <span className="report-page-number">{pageNumber ? `Page ${pageNumber}` : "Not included"}</span>
            </header>

            {page.templateId === "properties" && <PropertiesBlocks bundle={bundle} geometry={geometry} plate={figureNumbers.get(plateId("structure", page.id)) ?? null} frameId={plateId("structure", page.id)}/>}
            {page.templateId === "vector" && <VectorBlocks bundle={bundle} vectors={vectors} plate={figureNumbers.get(plateId("vector", page.id)) ?? null} frameId={plateId("vector", page.id)}/>}
            {block === "yield" && <YieldBlock rows={data.yieldRows} entries={entries} onEntryChange={editEntry}/>}
            {block === "purity" && <PurityBlock purity={data.purity}/>}
            {block === "sec" && <SecBlock sec={data.sec}/>}
            {block === "methods" && <MethodsBlock data={data}/>}
            {block === "flags" && <CaveatsBlock flags={data.flags}/>}

            {page.showFacts && facts.length > 0 && <section className="report-facts">
              <h3>Recorded plan</h3>
              <dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            </section>}
            {page.showFacts && facts.length === 0 && !block && page.templateId !== "properties" && page.templateId !== "vector" && <p className="report-missing">
              Nothing has been saved for this step yet. Complete it in the workflow and the plan will appear here, or write the record by hand below.
            </p>}

            <section className="report-notes">
              <h3>Record</h3>
              <textarea
                value={page.content}
                placeholder={template?.prompt ?? "Add the methods, observations, and results for this page."}
                onChange={(event) => updatePage(page.id, { content: event.target.value })}
              />
            </section>

            {page.figures.length > 0 && <section className="report-figures">
              {page.figures.map((figure, index) => {
                const job = analyses.find((value) => value.id === figure.jobId);
                return <figure key={figure.id}>
                  <div className="report-figure-frame" data-report-figure={figure.id}>
                    {job ? <AnalysisFigure job={job}/> : <p className="report-missing">That analysis is no longer saved in this project.</p>}
                  </div>
                  <figcaption>
                    <b>Figure {figureNumbers.get(figure.id) ?? index + 1}.</b>
                    <input value={figure.caption} onChange={(event) => updateFigure(page.id, figure.id, { caption: event.target.value })}/>
                    <button className="report-figure-remove" title="Remove figure" onClick={() => removeFigure(page.id, figure.id)}><Trash2/></button>
                  </figcaption>
                </figure>;
              })}
            </section>}

            <footer className="report-sheet-tools">
              <label className="report-toggle"><input type="checkbox" checked={page.showFacts} onChange={(event) => updatePage(page.id, { showFacts: event.target.checked })}/> Show the recorded plan</label>
              {(template?.figures ?? true) && <Button variant="outline" size="sm" onClick={() => setPicker(page.id)}><ImageIcon/> Add chromatogram or gel</Button>}
              <span className="report-sheet-source">{bundle.protein.name}</span>
            </footer>
          </div>
        </article>;
      })}
    </div>

    <Dialog open={Boolean(picker)} onOpenChange={(open) => { if (!open) setPicker(""); }}>
      <DialogContent className="result-dialog">
        <DialogHeader>
          <DialogTitle>Place a saved figure</DialogTitle>
          <DialogDescription>Chromatograms and gels come from the analyses saved in this project, so the report always shows the current data.</DialogDescription>
        </DialogHeader>
        <div className="snapshot-list">
          {analyses.map((job) => <button key={job.id} onClick={() => attachFigure(picker, job)}>
            <ImageIcon/>
            <span><strong>{job.name}</strong><small>{job.appType === "gel-analysis" ? "Gel densitometry" : "Chromatogram Studio"} · saved {new Date(job.updatedAt).toLocaleDateString()}</small></span>
            <Plus/>
          </button>)}
          {!analyses.length && <p className="report-missing">Save a Chromatogram Studio or Gel densitometry analysis first; it will then be available here.</p>}
        </div>
      </DialogContent>
    </Dialog>
  </main>;
}

function PropertiesBlocks({ bundle, geometry, plate, frameId }: { bundle: ProteinBundle; geometry: JsonObject | null; plate: number | null; frameId: string }) {
  const protparam = bundle.protparam?.result ?? {};
  const construct = constructSummary(bundle);
  const vector = jobConfig(bundle, "expression-planning");
  const host = jobConfig(bundle, "expression-system");
  const model = bundle.alphaFoldModels[0];
  return <>
    <section className="report-properties">
      <div className="report-structure">
        <div className="report-structure-frame" data-report-figure={frameId}>
          {geometry
            ? <StructureViewer geometry={geometry} compact paletteKey={bundle.protein.id} label=""/>
            : <p className="report-missing">No predicted structure has been saved. Run the Structure prediction job to include it.</p>}
        </div>
        <small>{plate ? <b>Figure {plate}. </b> : null}{structureCaption(model, geometry)}</small>
      </div>
      <dl className="report-property-grid">
        <div><dt>Molecular weight</dt><dd>{number(protparam.molecularWeightDa, 2)} Da</dd></div>
        <div><dt>ε₂₈₀ (reduced cysteines)</dt><dd>{number(asObject(protparam.extinctionCoefficient280).reducedMolarM1Cm1, 0)} M⁻¹cm⁻¹</dd></div>
        <div><dt>ε₂₈₀ (cystines formed)</dt><dd>{number(asObject(protparam.extinctionCoefficient280).oxidizedMolarM1Cm1, 0)} M⁻¹cm⁻¹</dd></div>
        <div><dt>Theoretical pI</dt><dd>{number(protparam.theoreticalPI, 2)}</dd></div>
        <div><dt>Residues</dt><dd>{bundle.protein.sequence.length}</dd></div>
        <div><dt>Expression host</dt><dd>{text(host.strainName, text(host.hostSystem, "Not selected"))}</dd></div>
      </dl>
    </section>
    <section className="report-construct">
      <h3>Expressed construct</h3>
      <table>
        <thead><tr><th>Species</th><th>Residues</th><th>Molecular weight (Da)</th><th>ε₂₈₀ reduced (M⁻¹cm⁻¹)</th></tr></thead>
        <tbody>
          <tr><td>Uncleaved fusion</td><td>{construct.fusionLength}</td><td>{construct.fusionMass}</td><td>{construct.fusionExt}</td></tr>
          <tr><td>After tag cleavage</td><td>{construct.cleavedLength}</td><td>{construct.cleavedMass}</td><td>{construct.cleavedExt}</td></tr>
        </tbody>
      </table>
      <dl className="report-property-grid">
        <div><dt>Affinity tag</dt><dd>{construct.tag}</dd></div>
        <div><dt>Cleavage</dt><dd>{construct.protease}</dd></div>
        <div><dt>Expression vector</dt><dd>{text(vector.vectorName, text(host.vectorFamilyName, "Not selected"))}</dd></div>
        <div><dt>Vector length</dt><dd>{vector.featureCount ? `${text(vector.featureCount)} annotated features` : "—"}</dd></div>
      </dl>
    </section>
  </>;
}

function VectorBlocks({ bundle, vectors, plate, frameId }: { bundle: ProteinBundle; vectors: JsonObject[]; plate: number | null; frameId: string }) {
  const vector = plannedVector(bundle, vectors);
  if (!vector) {
    return <p className="report-missing">No vector has been saved for this project. Build one in Expression vector design and the annotated map will appear here.</p>;
  }
  const features = array(vector.features);
  const insert = features.find((feature) => feature.isInsert === true);
  const length = Number(vector.length ?? String(vector.sequence ?? "").length) || 0;
  return <section className="report-vector">
    <div className="report-vector-map" data-report-figure={frameId}>
      <PlasmidMap name={text(vector.name, "Vector")} length={length} circular={vector.circular !== false} features={features}/>
    </div>
    {plate && <small className="report-plate-caption"><b>Figure {plate}.</b> Annotated map of {text(vector.name, "the expression vector")}, {length.toLocaleString()} bp, with {features.length} saved annotations.</small>}
    <dl className="report-property-grid">
      <div><dt>Vector</dt><dd>{text(vector.name)}</dd></div>
      <div><dt>Length</dt><dd>{length.toLocaleString()} bp</dd></div>
      <div><dt>Topology</dt><dd>{vector.circular === false ? "Linear" : "Circular"}</dd></div>
      <div><dt>Annotations</dt><dd>{features.length}</dd></div>
      <div><dt>Insert</dt><dd>{insert ? text(insert.name) : "Not marked"}</dd></div>
      <div><dt>Insert length</dt><dd>{insert ? `${Number(insert.end) - Number(insert.start)} bp` : "—"}</dd></div>
    </dl>
  </section>;
}

/**
 * A printable, fully annotated plasmid map.
 *
 * Every saved feature is drawn as an arc and labelled on a leader line, with
 * the inserted construct emphasised, so the report carries the same map the
 * vector editor shows.
 */
function PlasmidMap({ name, length, circular, features }: { name: string; length: number; circular: boolean; features: JsonObject[] }) {
  const W = 620, H = 620, cx = W / 2, cy = H / 2, radius = 176;
  if (!length) return <p className="report-missing">This vector has no sequence.</p>;
  const angleFor = (position: number) => (position / length) * Math.PI * 2 - Math.PI / 2;
  const pointAt = (position: number, r: number) => {
    const angle = angleFor(position);
    return [cx + Math.cos(angle) * r, cy + Math.sin(angle) * r] as const;
  };
  const arc = (start: number, end: number, r: number, width: number) => {
    const span = Math.max(end - start, length * 0.002);
    const outer = r + width / 2, inner = r - width / 2;
    const [x1, y1] = pointAt(start, outer), [x2, y2] = pointAt(start + span, outer);
    const [x3, y3] = pointAt(start + span, inner), [x4, y4] = pointAt(start, inner);
    const large = span / length > 0.5 ? 1 : 0;
    return `M${x1} ${y1} A${outer} ${outer} 0 ${large} 1 ${x2} ${y2} L${x3} ${y3} A${inner} ${inner} 0 ${large} 0 ${x4} ${y4} Z`;
  };
  // Labels are spread down each side so they never overlap, with a leader
  // line back to the feature they name.
  const placed = features
    .map((feature, index) => {
      const start = Number(feature.start) || 0;
      const end = Number(feature.end) || start;
      const middle = (start + end) / 2;
      const angle = angleFor(middle);
      return {
        index,
        feature,
        start,
        end,
        middle,
        right: Math.cos(angle) >= 0,
        y: cy + Math.sin(angle) * (radius + 26),
        anchorX: cx + Math.cos(angle) * (radius + 14),
        anchorY: cy + Math.sin(angle) * (radius + 14),
      };
    })
    .sort((a, b) => a.y - b.y);
  const gap = 15;
  for (const side of [true, false]) {
    const column = placed.filter((item) => item.right === side);
    for (let i = 1; i < column.length; i++) {
      if (column[i].y - column[i - 1].y < gap) column[i].y = column[i - 1].y + gap;
    }
    const overflow = (column.at(-1)?.y ?? 0) - (H - 26);
    if (overflow > 0) for (const item of column) item.y -= overflow;
  }
  return <svg className="report-plasmid" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${name} plasmid map`}>
    <circle cx={cx} cy={cy} r={radius} fill="none" stroke="#b9bfc4" strokeWidth="7"/>
    {!circular && <line x1={cx} y1={cy - radius - 12} x2={cx} y2={cy - radius + 12} stroke="#14181b" strokeWidth="2"/>}
    {features.map((feature, index) => {
      const start = Number(feature.start) || 0;
      const end = Number(feature.end) || start;
      const isInsert = feature.isInsert === true;
      return <path
        key={String(feature.id ?? index)}
        d={arc(start, end, radius, isInsert ? 19 : 13)}
        fill={String(feature.color ?? "#6b7a85")}
        stroke={isInsert ? "#14181b" : "none"}
        strokeWidth={isInsert ? 1.4 : 0}
        opacity={isInsert ? 1 : 0.9}
      />;
    })}
    {placed.map((item) => {
      const textX = item.right ? cx + radius + 44 : cx - radius - 44;
      const bendX = item.right ? cx + radius + 34 : cx - radius - 34;
      return <g key={`label-${item.index}`}>
        <polyline
          points={`${item.anchorX},${item.anchorY} ${bendX},${item.y} ${textX - (item.right ? 4 : -4)},${item.y}`}
          fill="none"
          stroke="#c3c8cc"
          strokeWidth="1"
        />
        <text x={textX} y={item.y + 3.5} textAnchor={item.right ? "start" : "end"} fontSize="10.5" fill="#2c343a" fontWeight={item.feature.isInsert === true ? 700 : 400}>
          {text(item.feature.name, "feature")}
        </text>
      </g>;
    })}
    <text x={cx} y={cy - 6} textAnchor="middle" fontSize="16" fontWeight="700" fill="#14181b">{name}</text>
    <text x={cx} y={cy + 14} textAnchor="middle" fontSize="12" fill="#6d767c">{length.toLocaleString()} bp</text>
  </svg>;
}

/**
 * A chromatogram or gel, drawn for print.
 *
 * The trace is vector from end to end: axes labelled with the units the
 * Chromatogram Studio project recorded, fraction windows marked where they
 * were collected, and peaks labelled with the apparent mass the SEC
 * calibration assigned. Traces are distinguished by dash pattern as well as
 * colour so the figure survives a greyscale printer.
 */
function AnalysisFigure({ job }: { job: ProjectJob }) {
  if (job.appType === "gel-analysis") {
    const preview = String(job.config.previewBase64 ?? "");
    return preview
      // The gel is an inline data URL destined for print.
      ? <img className="report-gel-image" alt={job.name} src={`data:image/png;base64,${preview}`}/>
      : <p className="report-missing">This gel analysis has no saved image.</p>;
  }
  const figure = asObject(job.config.figure);
  const series = array(job.config.traces)
    .filter((trace) => trace.visible !== false)
    .map((trace, index) => ({
      name: text(trace.name, `Trace ${index + 1}`),
      color: String(trace.color ?? "#2b3a42"),
      dash: dashPatterns[index % dashPatterns.length],
      points: array(trace.points)
        .map((point) => ({ x: Number(point.x), y: Number(point.y) }))
        .filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
    }))
    .filter((trace) => trace.points.length > 1);
  if (!series.length) return <p className="report-missing">This chromatogram has no saved traces.</p>;

  const xs = series.flatMap((trace) => trace.points.map((point) => point.x));
  const ys = series.flatMap((trace) => trace.points.map((point) => point.y));
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(0, ...ys), yMax = Math.max(...ys);
  const W = 680, H = 340, left = 72, right = 18, top = 20, bottom = 58;
  const sx = (value: number) => left + ((value - xMin) / Math.max(1e-12, xMax - xMin)) * (W - left - right);
  const sy = (value: number) => H - bottom - ((value - yMin) / Math.max(1e-12, yMax - yMin)) * (H - top - bottom);
  const ticks = (low: number, high: number) => Array.from({ length: 5 }, (_, index) => low + (index / 4) * (high - low));
  const digits = yMax - yMin < 1 ? 3 : yMax - yMin < 20 ? 2 : 0;
  const inRange = (value: unknown) => {
    const position = Number(value);
    return Number.isFinite(position) && position >= xMin && position <= xMax;
  };
  const fractions = array(job.config.fractions).filter((value) => inRange(value.start) && inRange(value.end));
  const peaks = array(job.config.peaks).filter((value) => inRange(value.apexX));
  const calibrated = secCalibrated(job.config);

  return <svg className="report-chromatogram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${job.name}: ${series.map((trace) => trace.name).join(", ")}`}>
    {/* Collected fractions sit behind the trace as light bands with their names. */}
    {fractions.map((fraction, index) => {
      const start = sx(Number(fraction.start)), end = sx(Number(fraction.end));
      return <g key={`f${index}`}>
        <rect x={Math.min(start, end)} y={top} width={Math.max(1.5, Math.abs(end - start))} height={H - bottom - top} fill="#9aa3a9" fillOpacity=".14"/>
        {/* Fraction names sit at the foot of their band, clear of the peak
            callouts along the top. */}
        <text x={(start + end) / 2} y={H - bottom - 6} textAnchor="middle" fontSize="8.5" fill="#5c656b" {...halo}>{text(fraction.name, "")}</text>
      </g>;
    })}
    <line x1={left} x2={W - right} y1={H - bottom} y2={H - bottom} stroke="currentColor" strokeWidth="1.1"/>
    <line x1={left} x2={left} y1={top} y2={H - bottom} stroke="currentColor" strokeWidth="1.1"/>
    {ticks(xMin, xMax).map((value) => <g key={`x${value}`}>
      <line x1={sx(value)} x2={sx(value)} y1={H - bottom} y2={H - bottom + 5} stroke="currentColor"/>
      <text x={sx(value)} y={H - bottom + 18} textAnchor="middle" fontSize="10">{value.toFixed(xMax - xMin < 10 ? 1 : 0)}</text>
    </g>)}
    {ticks(yMin, yMax).map((value) => <g key={`y${value}`}>
      <line x1={left - 5} x2={left} y1={sy(value)} y2={sy(value)} stroke="currentColor"/>
      <text x={left - 8} y={sy(value) + 3} textAnchor="end" fontSize="10">{value.toFixed(digits)}</text>
    </g>)}
    {series.map((trace) => <polyline
      key={trace.name}
      fill="none"
      stroke={trace.color}
      strokeWidth="1.5"
      strokeDasharray={series.length > 1 ? trace.dash : undefined}
      strokeLinejoin="round"
      points={trace.points.map((point) => `${sx(point.x).toFixed(1)},${sy(point.y).toFixed(1)}`).join(" ")}
    />)}
    {/* A peak is labelled with the mass the calibration gave it, or with its
        elution volume when the calibration could not assign one. */}
    {peaks.map((peak, index) => {
      const x = sx(Number(peak.apexX));
      // The same gate as the SEC table, so a stale mass never labels a peak
      // the table reports as unassigned.
      const mass = assignedMass(peak, calibrated).mwKDa;
      const label = mass !== null ? formatMass(mass) : `${Number(peak.apexX).toFixed(2)} mL`;
      return <g key={`p${index}`}>
        <line x1={x} x2={x} y1={top + 18} y2={top + 26} stroke="currentColor" strokeWidth=".9"/>
        <text x={x} y={top + 15} textAnchor="middle" fontSize="9" fontWeight="600" {...halo}>{text(peak.name, `Peak ${index + 1}`)}</text>
        <text x={x} y={top + 36} textAnchor="middle" fontSize="8.5" fill="#5c656b" {...halo}>{label}</text>
      </g>;
    })}
    <text x={left + (W - left - right) / 2} y={H - 8} textAnchor="middle" fontSize="11" fontWeight="600">
      {text(figure.xLabel, "Elution volume (mL)")}
    </text>
    <text transform={`translate(16 ${top + (H - bottom - top) / 2}) rotate(-90)`} textAnchor="middle" fontSize="11" fontWeight="600">
      {text(figure.yLabel, "Response (mAU)")}
    </text>
    {series.length > 1 && series.map((trace, index) => <g key={`k${trace.name}`}>
      <line x1={W - right - 104} x2={W - right - 82} y1={top + 8 + index * 13} y2={top + 8 + index * 13} stroke={trace.color} strokeWidth="2" strokeDasharray={trace.dash}/>
      <text x={W - right - 76} y={top + 11 + index * 13} fontSize="9">{trace.name}</text>
    </g>)}
  </svg>;
}

/** Greyscale-safe trace styles: colour alone is not enough on a printer. */
const dashPatterns = ["", "6 3", "2 2.5", "8 3 2 3", "1 2"];
/** A label that crosses the trace stays readable, on screen and in print. */
const halo = { stroke: "#ffffff", strokeWidth: 3, paintOrder: "stroke" as const, strokeLinejoin: "round" as const };

function defaultPages(): ReportPage[] {
  return pageTemplates.map((template) => ({
    id: crypto.randomUUID(),
    templateId: template.id,
    title: template.title,
    subtitle: template.subtitle,
    content: "",
    hidden: false,
    showFacts: true,
    figures: [],
  }));
}

function loadPages(sections: JsonObject[] | undefined): ReportPage[] {
  // The yield table is stored as a section but is not a page of its own.
  const pageSections = (sections ?? []).filter((value) => value.type !== "report-yield");
  if (!pageSections.length) return defaultPages();
  // Sections written by the earlier notebook have no page data; they come
  // through as extra pages so nothing a researcher wrote is lost.
  return pageSections.map((raw, index) => {
    const data = asObject(raw.data);
    return {
      id: String(raw.id ?? crypto.randomUUID()),
      templateId: String(data.templateId ?? "custom"),
      title: String(raw.title ?? `Page ${index + 1}`),
      subtitle: String(data.subtitle ?? ""),
      content: String(raw.content ?? ""),
      hidden: data.hidden === true,
      showFacts: data.showFacts !== false,
      figures: array(data.figures).map((figure) => ({
        id: String(figure.id ?? crypto.randomUUID()),
        jobId: String(figure.jobId ?? ""),
        caption: String(figure.caption ?? ""),
      })),
    };
  });
}

function toSection(page: ReportPage) {
  return {
    id: page.id,
    type: "report-page",
    title: page.title,
    content: page.content,
    sourceAppType: page.templateId,
    data: { templateId: page.templateId, subtitle: page.subtitle, hidden: page.hidden, showFacts: page.showFacts, figures: page.figures },
  };
}

/**
 * The yield table a saved report carries.
 *
 * The measurements belong to the report rather than to any planning job, so
 * they ride along in the notebook as one extra section. A stage the roadmap no
 * longer contains keeps its row in storage but is not shown, so renaming a
 * roadmap step does not silently delete recorded numbers.
 */
function loadEntries(bundle: ProteinBundle, sections: JsonObject[] | undefined): YieldEntry[] {
  const section = (sections ?? []).find((value) => value.type === "report-yield");
  const stored = loadYieldEntries(asObject(section?.data).rows);
  const stages = yieldStages(bundle);
  return stages.map((stage) => stored.find((entry) => entry.id === stage.id) ?? emptyYieldEntry(stage.id, stage.stage))
    .concat(stored.filter((entry) => !stages.some((stage) => stage.id === entry.id)));
}

function yieldSection(entries: YieldEntry[]) {
  return {
    id: "report-yield",
    type: "report-yield",
    title: "Yield and recovery",
    content: "",
    sourceAppType: "purification-roadmap",
    data: { rows: entries },
  };
}

function jobConfig(bundle: ProteinBundle, appType: string): JsonObject {
  return bundle.projectJobs.find((job) => job.appType === appType)?.config ?? {};
}

/** Short, human-readable facts drawn from whichever jobs feed a page. */
function pageFacts(bundle: ProteinBundle, templateId: string): [string, string][] {
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
    const construct = asObject(cleavage.construct);
    add("Mass after cleavage", construct.cleavedMassDa ? `${number(construct.cleavedMassDa, 2)} Da` : "");
  }
  if (templateId === "quality") {
    const buffer = jobConfig(bundle, "purification-buffer");
    const review = jobConfig(bundle, "purification-workflow");
    add("Storage buffer", buffer.bufferName ?? buffer.presetName);
    add("Buffer pH", buffer.bufferPH);
    add("Workflow review", review.reviewStatus);
    add("Reviewed", review.savedAt ? new Date(String(review.savedAt)).toLocaleDateString() : "");
  }
  return rows;
}

function constructSummary(bundle: ProteinBundle) {
  const cleavage = jobConfig(bundle, "purification-cleavage");
  const affinity = jobConfig(bundle, "purification-affinity");
  const construct = asObject(cleavage.construct ?? affinity.construct);
  const protparam = bundle.protparam?.result ?? {};
  const nativeMass = number(protparam.molecularWeightDa, 2);
  const nativeExt = number(asObject(protparam.extinctionCoefficient280).reducedMolarM1Cm1, 0);
  return {
    fusionLength: text(construct.fusionLength, String(bundle.protein.sequence.length)),
    fusionMass: construct.fusionMassDa ? number(construct.fusionMassDa, 2) : nativeMass,
    fusionExt: construct.fusionExtinction ? number(construct.fusionExtinction, 0) : nativeExt,
    cleavedLength: text(construct.cleavedLength, String(bundle.protein.sequence.length)),
    cleavedMass: construct.cleavedMassDa ? number(construct.cleavedMassDa, 2) : nativeMass,
    cleavedExt: construct.cleavedExtinction ? number(construct.cleavedExtinction, 0) : nativeExt,
    tag: text(construct.tagName ?? affinity.tag, "Not selected"),
    protease: text(cleavage.proteaseName, "Not selected"),
  };
}

/* ========================================================================
   Building the printable document
   ======================================================================== */

/** Stable frame ids for the two figures a page draws rather than places. */
function plateId(kind: "structure" | "vector", pageId: string) {
  return `plate-${kind}-${pageId}`;
}

function plannedVector(bundle: ProteinBundle, vectors: JsonObject[]) {
  const planned = String(jobConfig(bundle, "expression-planning").vectorId ?? "");
  return vectors.find((value) => String(value.id) === planned) ?? vectors[0] ?? null;
}

function structureCaption(model: JsonObject | undefined, geometry: JsonObject | null) {
  if (!model) return "Predicted structure";
  const parts = [text(model.name, text(model.modelId)), text(model.source, "AlphaFold")];
  if (geometry?.meanPlddt) parts.push(`mean pLDDT ${text(geometry.meanPlddt)}`);
  return parts.filter((value) => value && value !== "—").join(" · ");
}

/**
 * One report page, ready to print.
 *
 * Figures are captured out of the live DOM rather than re-derived, so the
 * exported document carries the same vector markup the reader is looking at.
 */
function printPage(
  page: ReportPage,
  bundle: ProteinBundle,
  vectors: JsonObject[],
  figureNumbers: Map<string, number>,
): PrintPage {
  const blocks: PrintBlock[] = [];
  if (page.templateId === "properties") {
    const protparam = bundle.protparam?.result ?? {};
    const construct = constructSummary(bundle);
    const host = jobConfig(bundle, "expression-planning");
    const system = jobConfig(bundle, "expression-system");
    const frame = plateId("structure", page.id);
    const figureNo = figureNumbers.get(frame);
    blocks.push({
      kind: "properties",
      figure: figureNo ? { ...captureFigure(frame, structureCaption(bundle.alphaFoldModels[0], null)), number: figureNo } : null,
      rows: [
        ["Molecular weight", `${number(protparam.molecularWeightDa, 2)} Da`],
        ["ε₂₈₀ (reduced cysteines)", `${number(asObject(protparam.extinctionCoefficient280).reducedMolarM1Cm1, 0)} M⁻¹cm⁻¹`],
        ["ε₂₈₀ (cystines formed)", `${number(asObject(protparam.extinctionCoefficient280).oxidizedMolarM1Cm1, 0)} M⁻¹cm⁻¹`],
        ["Theoretical pI", number(protparam.theoreticalPI, 2)],
        ["Residues", String(bundle.protein.sequence.length)],
        ["Expression host", text(system.strainName, text(system.hostSystem, "Not selected"))],
      ],
    });
    blocks.push({
      kind: "construct",
      header: ["Species", "Residues", "Molecular weight (Da)", "ε₂₈₀ reduced (M⁻¹cm⁻¹)"],
      rows: [
        ["Uncleaved fusion", construct.fusionLength, construct.fusionMass, construct.fusionExt],
        ["After tag cleavage", construct.cleavedLength, construct.cleavedMass, construct.cleavedExt],
      ],
      facts: [
        ["Affinity tag", construct.tag],
        ["Cleavage", construct.protease],
        ["Expression vector", text(host.vectorName, text(system.vectorFamilyName, "Not selected"))],
      ],
    });
  }
  if (page.templateId === "vector") {
    const vector = plannedVector(bundle, vectors);
    const features = array(vector?.features);
    const insert = features.find((feature) => feature.isInsert === true);
    const length = Number(vector?.length ?? String(vector?.sequence ?? "").length) || 0;
    const frame = plateId("vector", page.id);
    const figureNo = figureNumbers.get(frame);
    blocks.push({
      kind: "vector",
      figure: vector && figureNo
        ? { ...captureFigure(frame, `Annotated map of ${text(vector.name, "the expression vector")}, ${length.toLocaleString()} bp, with ${features.length} saved annotations.`), number: figureNo }
        : null,
      note: "No vector has been saved for this project.",
      facts: vector ? [
        ["Vector", text(vector.name)],
        ["Length", `${length.toLocaleString()} bp`],
        ["Topology", vector.circular === false ? "Linear" : "Circular"],
        ["Annotations", String(features.length)],
        ["Insert", insert ? text(insert.name) : "Not marked"],
        ["Insert length", insert ? `${Number(insert.end) - Number(insert.start)} bp` : ""],
      ] : [],
    });
  }
  const dataBlock = dataBlocks[page.templateId];
  if (dataBlock) blocks.push({ kind: dataBlock } as PrintBlock);
  if (page.showFacts) {
    const facts = pageFacts(bundle, page.templateId);
    if (facts.length) blocks.push({ kind: "facts", title: "Recorded plan", rows: facts });
  }
  blocks.push({ kind: "prose", text: page.content });

  const figures: PrintFigure[] = page.figures.map((figure) => ({
    ...captureFigure(figure.id, figure.caption),
    number: figureNumbers.get(figure.id) ?? 0,
  }));
  return { id: page.id, title: page.title, subtitle: page.subtitle, blocks, figures };
}

/* ========================================================================
   Exports
   ======================================================================== */

function download(filename: string, content: string, type: string) {
  const url = URL.createObjectURL(new Blob([content], { type }));
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

/** A plain-text companion to the PDF, for pasting into a lab wiki. */
function reportMarkdown(bundle: ProteinBundle, title: string, summary: string, pages: ReportPage[], data: ReportData) {
  const lines = [`# ${title}`, "", summary, "", `**${bundle.protein.name}** · ${bundle.protein.sequence.length} aa · ${bundle.protein.organism || "organism not entered"}`, ""];
  for (const page of pages.filter((value) => !value.hidden)) {
    lines.push(`## ${page.title}`);
    if (page.subtitle) lines.push(`*${page.subtitle}*`);
    lines.push("");
    if (dataBlocks[page.templateId]) lines.push(...markdownBlock(page.templateId, data), "");
    if (page.showFacts) for (const [label, value] of pageFacts(bundle, page.templateId)) lines.push(`- **${label}:** ${value}`);
    if (page.content.trim()) { lines.push("", page.content.trim()); }
    for (const [index, figure] of page.figures.entries()) lines.push("", `_Figure ${index + 1}. ${figure.caption}_`);
    lines.push("");
  }
  return lines.join("\n");
}

function markdownBlock(templateId: string, data: ReportData): string[] {
  if (templateId === "yield") {
    if (!data.yieldRows.length) return ["_No purification stages are recorded yet._"];
    return [
      "| Stage | Volume (mL) | Conc. (mg/mL) | Total protein (mg) | Step | Overall | Purity |",
      "| --- | --- | --- | --- | --- | --- | --- |",
      ...data.yieldRows.map((row) => `| ${row.stage}${row.flags.length ? " ⚠" : ""} | ${formatNumber(row.volumeMl, 1)} | ${formatNumber(row.concentrationMgMl, 2)} | ${formatNumber(row.totalProteinMg, 2)} | ${row.stepRecoveryPercent === null ? "—" : `${row.stepRecoveryPercent.toFixed(0)}%`} | ${row.overallRecoveryPercent === null ? "—" : `${row.overallRecoveryPercent.toFixed(0)}%`} | ${formatPurity(row.purityPercent, row.purityBound)} |`),
    ];
  }
  if (templateId === "purity") {
    if (!data.purity) return ["_No gel densitometry is saved for this project._"];
    return [
      "| Lane / stage | Target band | Apparent mass | Bands | Lane purity |",
      "| --- | --- | --- | --- | --- |",
      ...data.purity.rows.filter((row) => !row.isLadder).map((row) => `| ${row.lane}${row.flags.length ? " ⚠" : ""} | ${row.targetBand || "Not marked"} | ${row.targetMwKDa === null ? "—" : formatMass(row.targetMwKDa)} | ${row.bandCount} | ${formatPurity(row.purityPercent, row.purityBound)} |`),
    ];
  }
  if (templateId === "mass") {
    if (!data.sec) return ["_No chromatogram is saved for this project._"];
    const header = data.sec.fit
      ? `Kav = ${data.sec.fit.slope.toFixed(4)} log₁₀(Mr) + ${data.sec.fit.intercept.toFixed(4)} · R² ${data.sec.fit.r2.toFixed(4)} · n = ${data.sec.fit.standards}`
      : "No SEC calibration is stored with this chromatogram.";
    return [
      `**${data.sec.columnName || "Column not recorded"}** — ${header}`,
      "",
      "| Peak | Vₑ (mL) | Kav | Apparent mass | Area |",
      "| --- | --- | --- | --- | --- |",
      ...data.sec.peaks.map((peak) => `| ${peak.name}${peak.flags.length ? " ⚠" : ""} | ${formatNumber(peak.veMl, 2)} | ${peak.kav === null ? "—" : peak.kav.toFixed(3)} | ${peak.mwKDa === null ? "Not assigned" : formatMass(peak.mwKDa)} | ${peak.areaPercent === null ? "—" : `${peak.areaPercent.toFixed(1)}%`} |`),
    ];
  }
  if (templateId === "methods") {
    return data.methods.flatMap((block) => [`### ${block.title}`, "", ...block.lines.map((item) => `- **${item.label}:** ${item.value}`), ""]);
  }
  if (templateId === "caveats") {
    if (!data.flags.length) return ["_The analysis engines raised no flags on these numbers._"];
    return dedupe(data.flags).map((item) => `- **${item.scope} — ${item.title}.** ${item.detail}`);
  }
  return [];
}

function asObject(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {};
}
function array(value: unknown): JsonObject[] {
  return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : [];
}
function text(value: unknown, fallback = "—") {
  return value === null || value === undefined || value === "" ? fallback : String(value);
}
function number(value: unknown, digits: number) {
  return typeof value === "number" && Number.isFinite(value) ? value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }) : "—";
}
function safeName(value: string) {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "purification-report";
}
