"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown, ArrowUp, Check, Eye, EyeOff, FileCode2, FileText, Image as ImageIcon,
  LoaderCircle, Plus, Printer, Trash2, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { JsonObject, ProjectJob, ProteinBundle } from "@/lib/protein-labs-api";
import { proteinLabsApi } from "@/lib/protein-labs-api";
import { gelFigureNote, readGelJobConfig } from "@/lib/gel-quantification";
import {
  array, asObject, constructColumns, jobConfig, pageFacts, proteinProperties, reportHtml, reportMarkdown, text,
  type Figure, type ReportPage,
} from "@/lib/report-export";
import { StructureViewer } from "@/components/protein-labs/structure-viewer";

/**
 * Publication-quality purification report.
 *
 * One page per stage of the work, each pre-filled from what the project
 * actually saved and each fully editable. The pages print as a clean record a
 * client or a lab can file, so the on-screen editing controls are the only
 * thing the print stylesheet removes.
 */

type PageTemplate = {
  id: string;
  title: string;
  subtitle: string;
  prompt: string;
  // Workflow jobs whose saved configuration fills this page in.
  sources: string[];
  figures: boolean;
};

const pageTemplates: PageTemplate[] = [
  { id: "properties", title: "Protein properties", subtitle: "Target, construct, and predicted characteristics", prompt: "Summarise what the protein is, why it was made, and anything a reader needs before the methods.", sources: [], figures: false },
  { id: "vector", title: "Expression vector", subtitle: "The annotated plasmid carrying the construct", prompt: "Note the backbone, the cloning strategy, how the insert was verified, and the sequencing result.", sources: ["expression-planning"], figures: false },
  { id: "expression", title: "Transformation and expression", subtitle: "Host, medium, induction, and harvest", prompt: "Record the starting material, culture scale, induction conditions, harvest, and any deviation from the plan.", sources: ["expression-system", "expression-planning", "transformation-expression"], figures: true },
  { id: "lysis", title: "Cell lysis and clarification", subtitle: "Disruption and removal of insoluble material", prompt: "Record cell mass, resuspension volume, disruption settings, temperature, clarification, and retained samples.", sources: ["purification-lysis"], figures: true },
  { id: "affinity", title: "Affinity capture", subtitle: "Tag capture on the selected medium", prompt: "Record load, flow-through, wash volumes, elution, pooled fractions, yield, and purity.", sources: ["purification-affinity"], figures: true },
  { id: "cleavage", title: "Affinity-tag cleavage", subtitle: "Protease treatment and completion", prompt: "Record protease ratio, time, temperature, completion checked by gel, and retained samples.", sources: ["purification-cleavage"], figures: true },
  { id: "cleanup", title: "Subtractive cleanup", subtitle: "Removal of tag, uncleaved fusion, and protease", prompt: "Record load, flow-through recovery, and how completely the tagged species were removed.", sources: ["purification-subtractive"], figures: true },
  { id: "sec", title: "SEC polishing", subtitle: "Final size-exclusion step and solution state", prompt: "Record column, injection volume, flow rate, elution volume, pooled fractions, and the oligomeric state.", sources: ["purification-sec"], figures: true },
  { id: "quality", title: "Quality control and storage", subtitle: "Final concentration, purity, and handling", prompt: "Record final concentration and how it was measured, purity, aliquots, storage buffer, temperature, and freeze–thaw guidance.", sources: ["purification-buffer", "purification-workflow"], figures: true },
];

export function ReportsWorkspace({ bundle, onChanged }: { bundle: ProteinBundle; onChanged: () => Promise<void> }) {
  const saved = bundle.projectNotebook;
  const [title, setTitle] = useState(saved?.title ?? `${bundle.protein.name} — purification report`);
  const [summary, setSummary] = useState(saved?.summary ?? "Expression, purification, and quality-control record.");
  const [pages, setPages] = useState<ReportPage[]>(() => loadPages(saved?.sections));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [dirty, setDirty] = useState(false);
  const [picker, setPicker] = useState<string>("");
  const [geometry, setGeometry] = useState<JsonObject | null>(null);
  const [vectors, setVectors] = useState<JsonObject[]>([]);
  const hydrated = useRef(false);

  const analyses = useMemo(
    () => bundle.projectJobs.filter((job) => job.appType === "chromatogram-studio" || job.appType === "gel-analysis"),
    [bundle.projectJobs],
  );

  useEffect(() => {
    if (hydrated.current || dirty) return;
    hydrated.current = true;
    setTitle(saved?.title ?? `${bundle.protein.name} — purification report`);
    setSummary(saved?.summary ?? "Expression, purification, and quality-control record.");
    setPages(loadPages(saved?.sections));
  }, [bundle.protein.name, dirty, saved]);

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
  }, [title, summary, pages, dirty]);

  function edit(next: ReportPage[]) { setPages(next); setDirty(true); }
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
      await proteinLabsApi.saveNotebook(bundle.protein.id, title, summary, pages.map(toSection) as unknown as JsonObject[]);
      setDirty(false);
      if (!automatic) { await onChanged(); setMessage("Report saved locally."); }
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  function exportHtml() {
    const blob = new Blob([reportHtml(bundle, title, summary, pages, analyses)], { type: "text/html" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${safeName(title)}.html`; link.click();
    URL.revokeObjectURL(url);
    setMessage("A standalone HTML report was exported.");
  }
  function exportMarkdown() {
    const blob = new Blob([reportMarkdown(bundle, title, summary, pages)], { type: "text/markdown" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url; link.download = `${safeName(title)}.md`; link.click();
    URL.revokeObjectURL(url);
  }

  const visible = pages.filter((page) => !page.hidden);

  return <main className="reports-workspace">
    <aside className="reports-sidebar">
      <span className="eyebrow">REPORT BUILDER</span>
      <h2>Purification report</h2>
      <p>Each page is filled in from what this project saved and stays fully editable. Print or export when the record is complete.</p>
      <Button onClick={() => void save(false)} disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <Check/>} Save report</Button>
      <Button variant="outline" onClick={() => window.print()}><Printer/> Print / PDF</Button>
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
        return <article key={page.id} id={`report-page-${page.id}`} className={`report-sheet ${page.hidden ? "is-excluded" : ""}`}>
          <div className="report-sheet-inner">
            <header className="report-sheet-header">
              <span>
                <input className="report-page-title" value={page.title} onChange={(event) => updatePage(page.id, { title: event.target.value })}/>
                <input className="report-page-subtitle" value={page.subtitle} placeholder="Optional subtitle" onChange={(event) => updatePage(page.id, { subtitle: event.target.value })}/>
              </span>
              <span className="report-page-number">{pageNumber ? `Page ${pageNumber}` : "Not included"}</span>
            </header>

            {page.templateId === "properties" && <PropertiesBlocks bundle={bundle} geometry={geometry}/>}
            {page.templateId === "vector" && <VectorBlocks bundle={bundle} vectors={vectors}/>}

            {page.showFacts && facts.length > 0 && <section className="report-facts">
              <h3>Recorded plan</h3>
              <dl>{facts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}</dl>
            </section>}
            {page.showFacts && facts.length === 0 && page.templateId !== "properties" && page.templateId !== "vector" && <p className="report-missing">
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
                  <div className="report-figure-frame">{job ? <AnalysisFigure job={job}/> : <p className="report-missing">That analysis is no longer saved in this project.</p>}</div>
                  <figcaption>
                    <b>Figure {index + 1}.</b>
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

function PropertiesBlocks({ bundle, geometry }: { bundle: ProteinBundle; geometry: JsonObject | null }) {
  const { properties, construct, constructFacts } = proteinProperties(bundle);
  const model = bundle.alphaFoldModels[0];
  return <>
    <section className="report-properties">
      <div className="report-structure">
        <div className="report-structure-frame">
          {geometry
            ? <StructureViewer geometry={geometry} compact paletteKey={bundle.protein.id} label=""/>
            : <p className="report-missing">No predicted structure has been saved. Run the Structure prediction job to include it.</p>}
        </div>
        <small>{model ? `${text(model.name, text(model.modelId))} · ${text(model.source, "AlphaFold")}${geometry?.meanPlddt ? ` · mean pLDDT ${text(geometry.meanPlddt)}` : ""}` : "Predicted structure"}</small>
      </div>
      <dl className="report-property-grid">
        {properties.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </section>
    <section className="report-construct">
      <h3>Expressed construct</h3>
      <table>
        <thead><tr>{constructColumns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
        <tbody>
          {construct.map((row) => <tr key={row.species}><td>{row.species}</td><td>{row.residues}</td><td>{row.massDa}</td><td>{row.extinction}</td></tr>)}
        </tbody>
      </table>
      <dl className="report-property-grid">
        {constructFacts.map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      </dl>
    </section>
  </>;
}

function VectorBlocks({ bundle, vectors }: { bundle: ProteinBundle; vectors: JsonObject[] }) {
  const planned = String(jobConfig(bundle, "expression-planning").vectorId ?? "");
  const vector = vectors.find((value) => String(value.id) === planned) ?? vectors[0] ?? null;
  if (!vector) {
    return <p className="report-missing">No vector has been saved for this project. Build one in Expression vector design and the annotated map will appear here.</p>;
  }
  const features = array(vector.features);
  const insert = features.find((feature) => feature.isInsert === true);
  const length = Number(vector.length ?? String(vector.sequence ?? "").length) || 0;
  return <section className="report-vector">
    <div className="report-vector-map">
      <PlasmidMap name={text(vector.name, "Vector")} length={length} circular={vector.circular !== false} features={features}/>
    </div>
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

/** Chromatogram traces and gel images both come straight from the saved job. */
function AnalysisFigure({ job }: { job: ProjectJob }) {
  if (job.appType === "gel-analysis") {
    const preview = String(job.config.previewBase64 ?? "");
    if (!preview) return <p className="report-missing">This gel analysis has no saved image.</p>;
    const note = gelFigureNote(readGelJobConfig(job.config));
    return <>
      {/* The gel is an inline data URL destined for print. */}
      <img className="report-gel-image" alt={job.name} src={`data:image/png;base64,${preview}`}/>
      {note && <p className="report-gel-note">{note}</p>}
    </>;
  }
  const traces = array(job.config.traces).filter((trace) => trace.visible !== false);
  const series = traces.map((trace) => ({
    name: String(trace.name ?? "Trace"),
    color: String(trace.color ?? "#444"),
    points: array(trace.points).map((point) => ({ x: Number(point.x), y: Number(point.y) })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)),
  })).filter((trace) => trace.points.length > 1);
  if (!series.length) return <p className="report-missing">This chromatogram has no saved traces.</p>;
  const xs = series.flatMap((trace) => trace.points.map((point) => point.x));
  const ys = series.flatMap((trace) => trace.points.map((point) => point.y));
  const xMin = Math.min(...xs), xMax = Math.max(...xs), yMin = Math.min(0, ...ys), yMax = Math.max(...ys);
  const W = 640, H = 300, left = 62, right = 16, top = 16, bottom = 44;
  const sx = (value: number) => left + ((value - xMin) / Math.max(1e-12, xMax - xMin)) * (W - left - right);
  const sy = (value: number) => H - bottom - ((value - yMin) / Math.max(1e-12, yMax - yMin)) * (H - top - bottom);
  const ticks = (low: number, high: number) => Array.from({ length: 5 }, (_, index) => low + (index / 4) * (high - low));
  const digits = yMax - yMin < 1 ? 3 : yMax - yMin < 20 ? 2 : 0;
  return <svg className="report-chromatogram" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={job.name}>
    <line x1={left} x2={W - right} y1={H - bottom} y2={H - bottom} stroke="currentColor"/>
    <line x1={left} x2={left} y1={top} y2={H - bottom} stroke="currentColor"/>
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
      strokeWidth="1.6"
      points={trace.points.map((point) => `${sx(point.x).toFixed(1)},${sy(point.y).toFixed(1)}`).join(" ")}
    />)}
    {series.length > 1 && series.map((trace, index) => <g key={`k${trace.name}`}>
      <line x1={W - right - 92} x2={W - right - 74} y1={top + 10 + index * 14} y2={top + 10 + index * 14} stroke={trace.color} strokeWidth="2.4"/>
      <text x={W - right - 68} y={top + 13 + index * 14} fontSize="10">{trace.name}</text>
    </g>)}
  </svg>;
}

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
  if (!Array.isArray(sections) || !sections.length) return defaultPages();
  // Sections written by the earlier notebook have no page data; they come
  // through as extra pages so nothing a researcher wrote is lost.
  return sections.map((raw, index) => {
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

function safeName(value: string) {
  return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "purification-report";
}
