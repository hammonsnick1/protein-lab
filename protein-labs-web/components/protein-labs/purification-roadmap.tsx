"use client";

import { type DragEvent, Fragment, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Activity, ArrowLeft, ArrowRight, ArrowUpRight, Beaker, Check, ChevronRight, CircleCheck, Download, FileImage, FlaskConical, GripVertical, Image as ImageIcon, LoaderCircle, MoreHorizontal, Plus, Printer, Save, Share2, TestTubeDiagonal, Trash2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ensureProjectJob, fileToBase64, type JsonObject, type ProjectJob, type ProteinBundle } from "@/lib/protein-labs-api";
import { bandQuantification, formatSignalFraction, gelReportLanes, readGelJobConfig, SIGNAL_FRACTION_CAVEAT } from "@/lib/gel-quantification";
import { type BufferIngredient, bufferIngredients, type ComponentType, ingredientLabel, liveSteps, mergeSavedSteps, moveStep, type RoadmapComponent, type RoadmapStep, type StepBuffer, stepBuffers } from "@/lib/roadmap-steps";
import { dismissesMenu, menuAnchor, placeMenu } from "@/lib/context-menu";
import type { ConstructNumbers, SpeciesNumbers } from "@/lib/construct-numbers";
import { useConstructNumbers } from "@/lib/use-construct-numbers";
import { bufferStepOwners, savedBufferSteps } from "@/lib/purification-buffers";

type SavedBuffer = { key: string; jobId: string; title: string; purpose: string; pH: string; ingredients: BufferIngredient[]; source: string };
type ContextMenu = { kind: "board" | "step" | "record" | "component"; stepId?: string; componentId?: string; x: number; y: number };
type StepInsertion = { index: number };
type PendingAnalysis = { proteinId: string; stepId: string; type: "chromatogram" | "gel"; previousUpdatedAt: string };
type Notice = { text: string; action?: { label: string; jobId: string } };

const componentCatalog: { type: ComponentType; label: string; description: string; icon: typeof Beaker; color: string }[] = [
  { type: "buffer", label: "Saved buffer", description: "Choose a buffer saved in one of the purification-planning jobs.", icon: Beaker, color: "#4d9de8" },
  { type: "measurement", label: "Yield & purity", description: "Record recovery and purity with the methods used.", icon: Activity, color: "#38b489" },
  { type: "chromatogram", label: "Chromatogram Studio", description: "Open Chromatogram Studio and link its next saved result to this step.", icon: FlaskConical, color: "#a878e8" },
  { type: "gel", label: "Quantify a gel", description: "Open Gel Densitometry and link its next saved analysis to this step.", icon: TestTubeDiagonal, color: "#7abf72" },
  { type: "image", label: "Image", description: "Attach an experimental photograph or supporting figure.", icon: ImageIcon, color: "#e59748" },
  { type: "note", label: "Note", description: "Add an observation, deviation, or reminder.", icon: FileImage, color: "#77879b" },
];
const stepTemplates = [
  { id: "custom", title: "Custom purification step", instruction: "Create a step for any operation in this purification.", record: "Record conditions, samples, outcome, and deviations." },
  { id: "expression", title: "Transformation and expression", instruction: "Produce the target protein in the selected expression host.", record: "Record starting material, medium, induction, harvest, and deviations." },
  { id: "lysis", title: "Cell lysis", instruction: "Disrupt the harvested cells under protein-compatible conditions.", record: "Record mass, resuspension, settings, temperature, and retained samples." },
  { id: "clarification", title: "Clarification", instruction: "Remove insoluble material before chromatography.", record: "Record centrifugation, filtration, volume, and soluble recovery." },
  { id: "affinity", title: "Affinity capture", instruction: "Capture the tagged target on the selected affinity medium.", record: "Record load, flow-through, washes, elution fractions, yield, and purity." },
  { id: "buffer-exchange", title: "Buffer exchange / desalting", instruction: "Transfer the sample into a compatible downstream buffer.", record: "Record method, starting and final volumes, buffer, recovery, and conductivity." },
  { id: "cleavage", title: "Affinity-tag cleavage", instruction: "Remove the affinity tag using the planned cleavage strategy.", record: "Record ratio, time, temperature, completion, and retained samples." },
  { id: "cleanup", title: "Subtractive cleanup", instruction: "Remove uncleaved fusion, released tag, and tagged protease.", record: "Record load, flow-through, washes, recovery, and purity." },
  { id: "concentration", title: "Concentration", instruction: "Concentrate the protein for the next purification or analysis step.", record: "Record device, MWCO, starting and final volumes, concentration, and recovery." },
  { id: "ion-exchange", title: "Ion-exchange chromatography", instruction: "Separate species by charge using a compatible pH and salt gradient.", record: "Record resin, pH, gradient, chromatogram, fractions, yield, and purity." },
  { id: "hic", title: "Hydrophobic-interaction chromatography", instruction: "Separate species by surface hydrophobicity.", record: "Record resin, loading salt, gradient, chromatogram, fractions, yield, and purity." },
  { id: "sec", title: "Size-exclusion chromatography", instruction: "Polish the protein and assess its solution state by size.", record: "Record column, load, flow, chromatogram, fractions, yield, purity, and oligomeric state." },
  { id: "qc", title: "Quality control", instruction: "Confirm concentration, purity, identity, homogeneity, and activity.", record: "Record gels, chromatograms, spectra, activity, yield, and interpretation." },
  { id: "storage", title: "Formulation and storage", instruction: "Place the purified protein into its final formulation and storage condition.", record: "Record final buffer, concentration, aliquots, temperature, and freeze–thaw history." },
] as const;
const yieldMethods = ["A280 / NanoDrop", "Bradford assay", "BCA assay", "UV–Vis with extinction coefficient", "Fluorescence assay", "Gravimetric / dry mass", "Other"];
const purityMethods = ["SDS-PAGE densitometry", "Native PAGE densitometry", "SEC peak area", "RP-HPLC peak area", "Capillary electrophoresis", "Mass spectrometry", "Other"];
const bufferLabels: Record<string, string> = { lysis: "Lysis buffer", binding: "Binding buffer", wash: "Wash buffer", elution: "Elution buffer", cleavage: "Cleavage buffer", storage: "SEC / storage buffer" };
const pendingKey = (proteinId: string) => `protein-labs-roadmap-analysis:${proteinId}`;
const latestJob = (jobs: ProteinBundle["projectJobs"], appType: string) => jobs.filter((job) => job.appType === appType).reduce<ProteinBundle["projectJobs"][number] | undefined>((last, job) => !last || job.updatedAt > last.updatedAt ? job : last, undefined);

export function PurificationRoadmapWorkspace({ bundle, onOpenJob, onBackToWorkflow, onChanged }: { bundle: ProteinBundle; onOpenJob: (jobId: string) => void; onBackToWorkflow: () => void; onChanged: () => Promise<void> }) {
  const savedJob = bundle.projectJobs.find((job) => job.appType === "purification-roadmap");
  const sourceSignature = `${savedJob?.updatedAt ?? "new"}:${bundle.projectJobs.map((job) => job.updatedAt).join("|")}`;
  const currentPlan = useMemo(() => liveSteps(bundle), [bundle]);
  const savedBuffers = useMemo(() => savedBufferOptions(bundle), [bundle]);
  const [steps, setSteps] = useState<RoadmapStep[]>(() => mergeSavedSteps(currentPlan, savedJob?.config.steps));
  const [dirty, setDirty] = useState(false), [busy, setBusy] = useState(false), [notice, setNotice] = useState<Notice | null>(null);
  const [dragging, setDragging] = useState<string | null>(null), [dropIndex, setDropIndex] = useState<number | null>(null);
  const [context, setContext] = useState<ContextMenu | null>(null), [editingStep, setEditingStep] = useState<string | null>(null);
  const [editor, setEditor] = useState<{ stepId: string; component: RoadmapComponent } | null>(null);
  const [insertion, setInsertion] = useState<StepInsertion | null>(null), [movingStep, setMovingStep] = useState<string | null>(null);
  const lastSource = useRef(sourceSignature), board = useRef<HTMLElement>(null);
  const { numbers, analysing, failed } = useConstructNumbers(bundle);
  const proteinTransition = useMemo(() => cleavageTransition(numbers, { analysing, failed }), [numbers, analysing, failed]);

  useEffect(() => {
    if (lastSource.current === sourceSignature || dirty) return;
    lastSource.current = sourceSignature;
    setSteps(mergeSavedSteps(currentPlan, savedJob?.config.steps));
  }, [currentPlan, dirty, savedJob?.config.steps, sourceSignature]);

  useEffect(() => {
    const raw = sessionStorage.getItem(pendingKey(bundle.protein.id));
    if (!raw) return;
    let pending: PendingAnalysis;
    try { pending = JSON.parse(raw) as PendingAnalysis; } catch { sessionStorage.removeItem(pendingKey(bundle.protein.id)); return; }
    if (pending.proteinId !== bundle.protein.id) return;
    const appType = pending.type === "chromatogram" ? "chromatogram-studio" : "gel-analysis";
    // A protein can hold several gels; link the one saved after the step asked for it.
    const source = latestJob(bundle.projectJobs, appType);
    if (!source || source.updatedAt <= pending.previousUpdatedAt) return;
    const linked = componentFromAnalysis(pending.type, source);
    sessionStorage.removeItem(pendingKey(bundle.protein.id));
    queueMicrotask(() => {
      setSteps((values) => values.map((step) => step.id !== pending.stepId || step.components.some((item) => item.sourceJobId === source.id) ? step : { ...step, components: [...step.components, linked] }));
      setDirty(true);
      setMessage(`${pending.type === "gel" ? "Gel densitometry" : "Chromatogram Studio"} result linked to the roadmap. Save the roadmap to keep the link.`);
    });
  }, [bundle.projectJobs, bundle.protein.id]);

  // The notice stays on the board until dismissed; an action lets the scientist
  // choose to leave for another job instead of being sent there.
  function setMessage(text: string, action?: Notice["action"]) { setNotice(text ? { text, action } : null); }
  function change(updater: (value: RoadmapStep[]) => RoadmapStep[]) { setSteps((value) => updater(value)); setDirty(true); setMessage(""); }
  function editComponent(stepId: string, componentId: string) { const component = steps.find((step) => step.id === stepId)?.components.find((item) => item.id === componentId); if (component) setEditor({ stepId, component: structuredClone(component) }); setContext(null); }
  function commitComponent() { if (!editor) return; change((values) => values.map((step) => step.id !== editor.stepId ? step : { ...step, components: step.components.some((item) => item.id === editor.component.id) ? step.components.map((item) => item.id === editor.component.id ? editor.component : item) : [...step.components, editor.component] })); setEditor(null); }
  function deleteComponent(stepId: string, componentId: string) { change((values) => values.map((step) => step.id === stepId ? { ...step, components: step.components.filter((item) => item.id !== componentId) } : step)); setContext(null); }
  function addComponent(stepId: string, type: ComponentType) {
    setContext(null);
    if (type === "chromatogram" || type === "gel") {
      const appType = type === "chromatogram" ? "chromatogram-studio" : "gel-analysis";
      const current = latestJob(bundle.projectJobs, appType);
      sessionStorage.setItem(pendingKey(bundle.protein.id), JSON.stringify({ proteinId: bundle.protein.id, stepId, type, previousUpdatedAt: current?.updatedAt ?? "" } satisfies PendingAnalysis));
      onOpenJob(type === "chromatogram" ? "chromatogram" : "gel");
      return;
    }
    if (type === "buffer" && !savedBuffers.length) { setMessage("No buffers are saved yet. Buffers are set in Cell lysis, Affinity capture, Subtractive cleanup and SEC polishing; save one there, then add it here.", { label: "Open Affinity capture", jobId: "purification-affinity" }); return; }
    const component = newComponent(type);
    setEditor({ stepId, component: type === "buffer" ? applySavedBuffer(component, savedBuffers[0]) : component });
  }
  function beginStepInsertion(index: number) { setInsertion({ index: Math.max(0, Math.min(index, steps.length)) }); setContext(null); }
  function insertStep(templateId: string) {
    if (!insertion) return;
    const value = newRoadmapStep(templateId);
    change((items) => [...items.slice(0, insertion.index), value, ...items.slice(insertion.index)]);
    setInsertion(null);
    if (templateId === "custom") setEditingStep(value.id);
    setMessage(`Added ${value.title} as step ${insertion.index + 1}. All step numbers were updated.`);
  }
  function removeStep(stepId: string) {
    const current = steps.find((value) => value.id === stepId);
    if (!current || !window.confirm(`Remove “${current.title}” and its attached roadmap records?`)) return;
    change((items) => items.filter((item) => item.id !== stepId));
    setMovingStep((value) => value === stepId ? null : value);
    setContext(null);
    setMessage(`${current.title} was removed. The remaining steps were renumbered.`);
  }
  function selectForMove(stepId: string, targetIndex: number, ctrlKey: boolean) {
    if (!ctrlKey) return;
    if (!movingStep) { setMovingStep(stepId); setMessage("Step selected. Keep Ctrl held and select another step to move it before that step."); return; }
    if (movingStep === stepId) { setMovingStep(null); setMessage("Step move cancelled."); return; }
    moveTo(movingStep, targetIndex);
    setMovingStep(null);
  }
  /** Moves a step to an insertion point (0 = before step 1, steps.length = after the last). */
  function moveTo(stepId: string, insertion: number, refocus = false) {
    const fromIndex = steps.findIndex((value) => value.id === stepId);
    if (fromIndex < 0 || insertion === fromIndex || insertion === fromIndex + 1) return;
    const next = moveStep(steps, fromIndex, insertion), position = next.findIndex((value) => value.id === stepId) + 1;
    change(() => next);
    setMessage(`${steps[fromIndex].title} moved to step ${position}. Numbering and report order were updated.`);
    // React moves the column's DOM node, which drops keyboard focus from its handle.
    if (refocus) requestAnimationFrame(() => board.current?.querySelector<HTMLElement>(`[data-step-handle="${CSS.escape(stepId)}"]`)?.focus());
  }
  function handleKeys(event: ReactKeyboardEvent, stepId: string, index: number) {
    const insertion = { ArrowLeft: index - 1, ArrowUp: index - 1, ArrowRight: index + 2, ArrowDown: index + 2, Home: 0, End: steps.length }[event.key];
    if (insertion === undefined) return;
    event.preventDefault();
    if (insertion >= 0 && insertion <= steps.length) moveTo(stepId, insertion, true);
  }
  function startDrag(event: DragEvent, stepId: string) {
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", stepId);
    const column = (event.currentTarget as HTMLElement).closest("article");
    if (column) event.dataTransfer.setDragImage(column, 24, 24);
    setDragging(stepId); setContext(null);
  }
  function dragOver(event: DragEvent, insertion: number) {
    if (!dragging) return;
    event.preventDefault(); event.stopPropagation();
    event.dataTransfer.dropEffect = "move";
    if (dropIndex !== insertion) setDropIndex(insertion);
  }
  function dragOverColumn(event: DragEvent, index: number) {
    const rect = event.currentTarget.getBoundingClientRect();
    dragOver(event, event.clientX < rect.left + rect.width / 2 ? index : index + 1);
  }
  function drop(event: DragEvent) {
    event.preventDefault();
    if (dragging && dropIndex !== null) moveTo(dragging, dropIndex);
    endDrag();
  }
  function endDrag() { setDragging(null); setDropIndex(null); }

  async function saveBoard() {
    setBusy(true); setMessage("");
    try { await ensureProjectJob(bundle.protein.id, bundle.projectJobs, "purification-roadmap", "Purification roadmap", { steps, savedByUser: true, updatedAt: new Date().toISOString() }); setDirty(false); await onChanged(); setMessage("Purification roadmap saved locally with this project."); }
    catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }
  function exportDocument() { downloadBlob(reportFilename(bundle), new Blob([roadmapReport(bundle, steps, proteinTransition)], { type: "text/html;charset=utf-8" })); setMessage("A self-contained roadmap report was exported with the currently visible notes, gels, and chromatograms."); }
  function printDocument() { const report = window.open("", "_blank"); if (!report) { setMessage("The print window could not be opened. Use Export report instead."); return; } report.opener = null; report.document.write(roadmapReport(bundle, steps, proteinTransition)); report.document.close(); report.focus(); window.setTimeout(() => report.print(), 300); }
  async function shareDocument() {
    const html = roadmapReport(bundle, steps, proteinTransition), filename = reportFilename(bundle), file = new File([html], filename, { type: "text/html" });
    try {
      if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) await navigator.share({ title: `${bundle.protein.name} purification roadmap`, text: "Protein Lab purification roadmap", files: [file] });
      else { await navigator.clipboard.writeText(`${bundle.protein.name} purification roadmap\n${steps.length} steps · ${steps.reduce((sum, step) => sum + step.components.length, 0)} linked records\nExported from Protein Lab`); downloadBlob(filename, file); setMessage("The share summary was copied and the portable report was exported."); }
    } catch (reason) { if (reason instanceof DOMException && reason.name === "AbortError") return; setMessage("Direct sharing was unavailable. The report has been exported instead."); downloadBlob(filename, file); }
  }

  return <main className="roadmap-workspace" onClick={() => setContext(null)}>
    <header className="roadmap-workspace-header"><div className="roadmap-heading-group"><Button className="roadmap-workflow-back" variant="outline" onClick={onBackToWorkflow}><ArrowLeft/> Back to workflow</Button><div><span className="eyebrow">DEDICATED EXPERIMENT WORKSPACE</span><h1>Purification roadmap</h1><p>Add records to the relevant step. Buffers come from saved planning choices, while chromatography and gel records stay connected to their analysis jobs.</p></div></div><div className="roadmap-header-actions"><span className={`roadmap-save-state ${dirty ? "dirty" : "saved"}`}>{dirty ? "Unsaved changes" : "Saved locally"}</span><Button variant="outline" onClick={exportDocument}><Download/> Export report</Button><Button variant="outline" onClick={printDocument}><Printer/> Print / PDF</Button><Button variant="outline" onClick={() => void shareDocument()}><Share2/> Share</Button><Button disabled={busy || !dirty} onClick={() => void saveBoard()}>{busy ? <LoaderCircle className="spin"/> : <Save/>} Save roadmap</Button></div></header>
    <section className="roadmap-record-guidance"><strong>Build and reorder the purification route</strong><span>Press <b>+</b> between two steps to insert one there. Drag a step by its <GripVertical aria-label="handle"/> handle to reorder it, or focus the handle and press <b>←</b> / <b>→</b>. Right-click and Ctrl-select still work. Step numbers update automatically.</span></section>
    <section ref={board} className={`roadmap-board ${dragging ? "dragging" : ""}`} onDragOver={(event) => { if (dragging) event.preventDefault(); }} onDrop={drop} onContextMenu={(event) => { if (event.target !== event.currentTarget) return; event.preventDefault(); setContext({ kind: "board", x: event.clientX, y: event.clientY }); }}>{steps.map((step, index) => <Fragment key={step.id}><StepGap index={index} steps={steps} active={dropIndex === index} onInsert={beginStepInsertion} onDragOver={dragOver}/><article className={`roadmap-column ${step.ready ? "ready" : "pending"} ${movingStep === step.id ? "move-selected" : ""} ${dragging === step.id ? "drag-source" : ""}`} onClick={(event) => selectForMove(step.id, index, event.ctrlKey)} onDragOver={(event) => dragOverColumn(event, index)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContext({ kind: "step", stepId: step.id, x: event.clientX, y: event.clientY }); }}>
      <header><button className="roadmap-drag-handle" draggable data-step-handle={step.id} aria-label={`Move step ${index + 1}, ${step.title}. Drag, or press the arrow keys.`} title="Drag to reorder · or focus and press ← / →" onClick={(event) => event.stopPropagation()} onDragStart={(event) => startDrag(event, step.id)} onDragEnd={endDrag} onKeyDown={(event) => handleKeys(event, step.id, index)}><GripVertical/></button><em>{index + 1}</em><span><strong>{step.title}</strong><small>{step.instruction}</small></span>{step.jobId ? <button className="roadmap-open-job" title={`Open ${step.jobLabel}`} onClick={(event) => { event.stopPropagation(); onOpenJob(step.jobId); }}><ArrowUpRight/></button> : <span className="roadmap-custom-badge">Custom</span>}<button onClick={(event) => { event.stopPropagation(); setContext({ kind: "step", stepId: step.id, ...menuPoint(event) }); }}><MoreHorizontal/></button></header>
      <div className="roadmap-column-status"><span>{step.ready ? <CircleCheck/> : <ChevronRight/>}{step.ready ? "Planning choices saved" : "Planning is still in progress"}</span><small>{step.record}</small></div>
      {step.jobId ? <button className="roadmap-plan-loaded" onClick={(event) => { event.stopPropagation(); onOpenJob(step.jobId); }}><span><strong>{step.jobLabel}</strong><small>{step.planDetails.length ? "Automatically populated from Workflow" : "Open this job to finish its setup"}</small></span><ArrowUpRight/>{step.planDetails.length > 0 && <div>{step.planDetails.map((detail) => <em key={detail}>{detail}</em>)}</div>}</button> : <div className="roadmap-custom-step-note"><strong>User-defined step</strong><small>Add buffers, measurements, analyses, images, or notes below.</small></div>}
      <StepBufferList buffers={step.custom ? [] : stepBuffers(bundle, step.id)}/>
      <div className="roadmap-component-list">{step.components.map((component) => <RoadmapItem key={component.id} value={component} onOpen={() => editComponent(step.id, component.id)} onContextMenu={(event) => { event.preventDefault(); event.stopPropagation(); setContext({ kind: "component", stepId: step.id, componentId: component.id, x: event.clientX, y: event.clientY }); }}/>)}</div>
      <button className="roadmap-column-add" onClick={(event) => { event.stopPropagation(); setContext({ kind: "record", stepId: step.id, ...menuPoint(event) }); }}><Plus/> Add record or data</button>
    </article></Fragment>)}<StepGap index={steps.length} steps={steps} active={dropIndex === steps.length} onInsert={beginStepInsertion} onDragOver={dragOver}/><button className="roadmap-add-step" onClick={(event) => { event.stopPropagation(); beginStepInsertion(steps.length); }} onDragOver={(event) => dragOver(event, steps.length)}><Plus/><strong>Add step</strong><small>Insert any purification operation after step {steps.length}.</small></button></section>
    <ProteinTransitionSummary value={proteinTransition}/>
    {context && <RoadmapContextMenu value={context} steps={steps} onAddComponent={addComponent} onEditComponent={editComponent} onDeleteComponent={deleteComponent} onInsert={beginStepInsertion} onMove={(stepId, insertion) => { moveTo(stepId, insertion); setContext(null); }} onEditStep={(stepId) => { setEditingStep(stepId); setContext(null); }} onDeleteStep={removeStep} onClose={() => setContext(null)}/>} 
    {notice && <div className="roadmap-message" role="status">{notice.text}{notice.action && <Button size="sm" variant="outline" onClick={() => { const jobId = notice.action!.jobId; setNotice(null); onOpenJob(jobId); }}>{notice.action.label} <ArrowUpRight/></Button>}<button aria-label="Dismiss message" onClick={() => setNotice(null)}><X/></button></div>}
    <ComponentEditor value={editor} bundle={bundle} savedBuffers={savedBuffers} onChange={setEditor} onClose={() => setEditor(null)} onSave={commitComponent}/>
    <StepEditor step={editingStep ? steps.find((value) => value.id === editingStep) ?? null : null} onClose={() => setEditingStep(null)} onSave={(value) => { change((items) => items.map((item) => item.id === value.id ? value : item)); setEditingStep(null); }}/>
    <StepInsertionDialog value={insertion} onClose={() => setInsertion(null)} onChoose={insertStep}/>
  </main>;
}

/** The insertion point between two columns: a visible "+" and the drop target while dragging. */
function StepGap({ index, steps, active, onInsert, onDragOver }: { index: number; steps: RoadmapStep[]; active: boolean; onInsert: (index: number) => void; onDragOver: (event: DragEvent, insertion: number) => void }) {
  const label = index === 0 ? "Add a step before step 1" : index === steps.length ? `Add a step after step ${index}` : `Add a step between steps ${index} and ${index + 1}`;
  return <div className={`roadmap-step-gap ${active ? "drop-target" : ""}`} onDragOver={(event) => onDragOver(event, index)}><button aria-label={label} title={label} onClick={(event) => { event.stopPropagation(); onInsert(index); }}><Plus/></button></div>;
}

function StepBufferList({ buffers }: { buffers: StepBuffer[] }) {
  if (!buffers.length) return null;
  const missing = buffers.filter((buffer) => !buffer.ingredients.length).map((buffer) => buffer.label);
  return <div className="roadmap-step-buffers"><strong>Buffers</strong>{buffers.filter((buffer) => buffer.ingredients.length).map((buffer) => <div key={buffer.id}><span><b>{buffer.label}</b><small>{buffer.pH ? `pH ${buffer.pH}` : "pH not set"}</small></span><p>{buffer.ingredients.map(ingredientLabel).join(" · ")}</p></div>)}{missing.length > 0 && <p className="missing">Not saved yet: {missing.join(", ")}. Open the job to set {missing.length > 1 ? "them" : "it"}.</p>}</div>;
}

function RoadmapItem({ value, onOpen, onContextMenu }: { value: RoadmapComponent; onOpen: () => void; onContextMenu: (event: MouseEvent) => void }) {
  const catalog = componentCatalog.find((item) => item.type === value.type) ?? componentCatalog[5], Icon = catalog.icon;
  const image = value.dataUrl?.startsWith("data:image/") && !/tiff?/i.test(value.mimeType ?? "");
  return <button className={`roadmap-item type-${value.type}`} onClick={onOpen} onContextMenu={onContextMenu} style={{ "--component-color": catalog.color } as React.CSSProperties}>{image && <img src={value.dataUrl} alt={value.title}
  />}<span className="roadmap-item-icon"><Icon/></span><span><strong>{value.title}</strong><small>{itemSummary(value)}</small>{value.fileName && <em>{value.fileName}</em>}</span><MoreHorizontal/></button>;
}

function menuPoint(event: MouseEvent) {
  return menuAnchor(event, event.currentTarget.getBoundingClientRect());
}

function RoadmapContextMenu({ value, steps, onAddComponent, onEditComponent, onDeleteComponent, onInsert, onMove, onEditStep, onDeleteStep, onClose }: { value: ContextMenu; steps: RoadmapStep[]; onAddComponent: (stepId: string, type: ComponentType) => void; onEditComponent: (stepId: string, componentId: string) => void; onDeleteComponent: (stepId: string, componentId: string) => void; onInsert: (index: number) => void; onMove: (stepId: string, insertion: number) => void; onEditStep: (stepId: string) => void; onDeleteStep: (stepId: string) => void; onClose: () => void }) {
  const index = value.stepId ? steps.findIndex((step) => step.id === value.stepId) : steps.length;
  const ref = useRef<HTMLDivElement>(null);
  // Keep the whole menu in the window and below the top bar: near the bottom
  // or right edge it opens upward or leftward from the point instead.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (!menu) return;
    const floor = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
    const viewport = { width: window.innerWidth, height: window.innerHeight };
    const { left, top } = placeMenu({ x: value.x, y: value.y }, menu.getBoundingClientRect(), viewport, floor);
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }, [value.x, value.y, value.kind]);
  useEffect(() => {
    const close = (event: KeyboardEvent) => { if (dismissesMenu(event.key)) onClose(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [onClose]);
  return <div ref={ref} className="roadmap-context-menu" style={{ left: value.x, top: value.y }} onClick={(event) => event.stopPropagation()}>
    {value.kind === "component" && value.stepId && value.componentId && <><strong>Roadmap record</strong><button onClick={() => onEditComponent(value.stepId!, value.componentId!)}><MoreHorizontal/> Edit record</button><button className="delete" onClick={() => onDeleteComponent(value.stepId!, value.componentId!)}><Trash2/> Delete record</button></>}
    {value.kind === "record" && value.stepId && <><strong>Add record or data</strong>{componentCatalog.map((item) => { const Icon = item.icon; return <button key={item.type} onClick={() => onAddComponent(value.stepId!, item.type)}><Icon/><span><b>{item.label}</b><small>{item.description}</small></span>{(item.type === "chromatogram" || item.type === "gel") && <ArrowUpRight/>}</button>; })}<hr/><button onClick={() => onEditStep(value.stepId!)}><MoreHorizontal/> Edit step text</button></>}
    {value.kind === "step" && value.stepId && <><strong>Purification step {index + 1}</strong><button onClick={() => onInsert(Math.max(0, index))}><Plus/><span><b>Add step before</b><small>Choose any standard operation or create a custom step.</small></span></button><button onClick={() => onInsert(Math.max(0, index + 1))}><Plus/><span><b>Add step after</b><small>The new step is inserted here and all numbers update.</small></span></button><hr/><button onClick={() => onEditStep(value.stepId!)}><MoreHorizontal/> Edit step text</button><button disabled={index <= 0} onClick={() => onMove(value.stepId!, index - 1)}><ArrowLeft/><span><b>Move earlier</b><small>Or drag the step by its handle.</small></span></button><button disabled={index >= steps.length - 1} onClick={() => onMove(value.stepId!, index + 2)}><ArrowRight/><span><b>Move later</b><small>Focus the handle and use ← / → from the keyboard.</small></span></button><button className="delete" onClick={() => onDeleteStep(value.stepId!)}><Trash2/> Remove step</button></>}
    {value.kind === "board" && <><strong>Purification roadmap</strong><button onClick={() => onInsert(steps.length)}><Plus/><span><b>Add purification step</b><small>Choose a standard operation or make a custom step.</small></span></button><small className="roadmap-menu-hint">You can also press + between any two steps, or right-click a step to insert before or after it.</small></>}
  </div>;
}

function StepInsertionDialog({ value, onClose, onChoose }: { value: StepInsertion | null; onClose: () => void; onChoose: (templateId: string) => void }) {
  return <Dialog open={Boolean(value)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="roadmap-step-library"><DialogHeader><DialogTitle>Add a purification step</DialogTitle><DialogDescription>Choose a common operation or create a completely custom step. It will be inserted at step {(value?.index ?? 0) + 1}.</DialogDescription></DialogHeader><div className="roadmap-step-options">{stepTemplates.map((template) => <button key={template.id} onClick={() => onChoose(template.id)}><span><Plus/></span><strong>{template.title}</strong><small>{template.instruction}</small></button>)}</div><DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button></DialogFooter></DialogContent></Dialog>;
}

function ProteinTransitionSummary({ value }: { value: ReturnType<typeof cleavageTransition> }) {
  return <section className="roadmap-protein-transition"><header><span><Activity/><span><strong>Protein measurements through tag cleavage</strong><small>Keep these expected values visible when identifying bands, pooling fractions, and calculating concentration.</small></span></span><em>{value.cleavagePlanned ? "CLEAVAGE PLANNED" : "TAG RETAINED / NOT SET"}</em></header><div className="roadmap-transition-grid"><article><span>Before cleavage</span><strong>{value.beforeMass}</strong><small>Molecular weight</small><b>{value.beforeExtinction}</b><small>ε₂₈₀ reduced · M⁻¹ cm⁻¹</small></article><i>→</i><article><span>After cleavage</span><strong>{value.afterMass}</strong><small>Molecular weight</small><b>{value.afterExtinction}</b><small>ε₂₈₀ reduced · M⁻¹ cm⁻¹</small></article><aside><b>{value.tagLabel}</b><p>{value.note}</p>{value.oxidized && <small>Oxidized-cystine ε₂₈₀ after cleavage: {value.oxidized} M⁻¹ cm⁻¹</small>}{value.assembly && <small>{value.assembly}</small>}</aside></div></section>;
}

function ComponentEditor({ value, bundle, savedBuffers, onChange, onClose, onSave }: { value: { stepId: string; component: RoadmapComponent } | null; bundle: ProteinBundle; savedBuffers: SavedBuffer[]; onChange: (value: { stepId: string; component: RoadmapComponent } | null) => void; onClose: () => void; onSave: () => void }) {
  const component = value?.component;
  const sourceJob = component?.sourceJobId ? bundle.projectJobs.find((job) => job.id === component.sourceJobId) : null;
  function update(patch: Partial<RoadmapComponent>) { if (value) onChange({ ...value, component: { ...value.component, ...patch } }); }
  async function attach(file: File | null) { if (!file || !component) return; const base64 = await fileToBase64(file); update({ fileName: file.name, mimeType: file.type || "application/octet-stream", dataUrl: `data:${file.type || "application/octet-stream"};base64,${base64}` }); }
  function chooseBuffer(key: string) { const buffer = savedBuffers.find((item) => item.key === key); if (value && buffer) onChange({ ...value, component: applySavedBuffer(value.component, buffer) }); }
  return <Dialog open={Boolean(value)} onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="roadmap-editor-dialog"><DialogHeader><DialogTitle>{component ? `${componentCatalog.find((item) => item.type === component.type)?.label ?? "Roadmap"} record` : "Roadmap record"}</DialogTitle><DialogDescription>Everything entered here stays associated with this purification step and appears in roadmap exports.</DialogDescription></DialogHeader>{component && <div className="roadmap-editor-fields"><label>Title<input value={component.title} onChange={(event) => update({ title: event.target.value })}/></label>
    {component.type === "buffer" && <><label>Saved planning buffer<select value={legacyBufferKeys[component.sourceBufferKey ?? ""] ?? component.sourceBufferKey ?? ""} onChange={(event) => chooseBuffer(event.target.value)}>{savedBuffers.map((buffer) => <option key={buffer.key} value={buffer.key}>{buffer.title} · {buffer.source}</option>)}</select></label><div className="roadmap-saved-buffer"><span><b>{component.purpose}</b><small>{component.pH ? `pH ${component.pH}` : "pH not specified"}</small></span><ul>{(component.ingredients ?? []).map((item, index) => <li key={`${item.name}-${index}`}><b>{item.name || "Component"}</b><span>{item.concentration} {item.unit}</span>{item.role && <small>{item.role}</small>}</li>)}</ul><small>Edit this buffer in the Workflow job that sets it; roadmap records use the saved version.</small></div></>}
    {component.type === "measurement" && <div className="roadmap-measurement-editor"><label>Yield<input value={component.yieldValue} onChange={(event) => update({ yieldValue: event.target.value })} placeholder="e.g. 12.4"/></label><label>Yield unit<select value={component.yieldUnit} onChange={(event) => update({ yieldUnit: event.target.value })}><option>mg</option><option>mg/L culture</option><option>µg</option><option>% recovery</option><option>Other</option></select></label><label>Yield method<select value={component.yieldMethod} onChange={(event) => update({ yieldMethod: event.target.value })}>{yieldMethods.map((method) => <option key={method}>{method}</option>)}</select></label><label>Purity (%)<input value={component.purityValue} onChange={(event) => update({ purityValue: event.target.value })} placeholder="e.g. 92"/></label><label>Purity method<select value={component.purityMethod} onChange={(event) => update({ purityMethod: event.target.value })}>{purityMethods.map((method) => <option key={method}>{method}</option>)}</select></label></div>}
    {(component.type === "chromatogram" || component.type === "gel") && <div className="roadmap-linked-analysis"><CircleCheck/><span><b>{sourceJob?.name ?? "Saved analysis"}</b><small>Linked to {component.type === "gel" ? "Gel Densitometry" : "Chromatogram Studio"}. Reopen that job to change the analysis or annotations.</small></span></div>}
    {component.type === "image" && <label>Attach an image<input type="file" accept="image/*,.tif,.tiff" onChange={(event) => void attach(event.target.files?.[0] ?? null)}/>{component.fileName && <small>Attached: {component.fileName}</small>}</label>}
    <label>Notes<textarea rows={4} value={component.notes} onChange={(event) => update({ notes: event.target.value })} placeholder="Observations, conditions, interpretation, or deviations…"/></label></div>}<DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={component?.type === "buffer" && !component.sourceBufferKey} onClick={onSave}><Check/> Save item</Button></DialogFooter></DialogContent></Dialog>;
}

function StepEditor({ step, onClose, onSave }: { step: RoadmapStep | null; onClose: () => void; onSave: (step: RoadmapStep) => void }) { if (!step) return null; return <StepEditorDialog key={step.id} step={step} onClose={onClose} onSave={onSave}/>; }
function StepEditorDialog({ step, onClose, onSave }: { step: RoadmapStep; onClose: () => void; onSave: (step: RoadmapStep) => void }) { const [draft, setDraft] = useState<RoadmapStep | null>(step); return <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}><DialogContent className="roadmap-editor-dialog"><DialogHeader><DialogTitle>Edit roadmap step</DialogTitle><DialogDescription>Change the title, working instruction, or records expected at this step.</DialogDescription></DialogHeader>{draft && <div className="roadmap-editor-fields"><label>Step title<input value={draft.title} onChange={(event) => setDraft({ ...draft, title: event.target.value })}/></label><label>Instruction<textarea rows={4} value={draft.instruction} onChange={(event) => setDraft({ ...draft, instruction: event.target.value })}/></label><label>What to record<textarea rows={4} value={draft.record} onChange={(event) => setDraft({ ...draft, record: event.target.value })}/></label></div>}<DialogFooter><Button variant="outline" onClick={onClose}>Cancel</Button><Button disabled={!draft} onClick={() => draft && onSave(draft)}><Check/> Save step</Button></DialogFooter></DialogContent></Dialog>; }


/** One option per saved buffer step, read from the shared buffer record and named by the job that set it. */
function savedBufferOptions(bundle: ProteinBundle): SavedBuffer[] {
  const design = bundle.projectJobs.find((job) => job.appType === "purification-buffer");
  return Object.entries(savedBufferSteps(bundle.projectJobs)).map(([id, step]) => { const owner = bundle.projectJobs.find((job) => job.appType === bufferStepOwners[id].appType); return { key: `purification-buffer:${id}`, jobId: design?.id ?? owner?.id ?? "", title: bufferLabels[id], purpose: step.purpose, pH: step.pH, ingredients: bufferIngredients(step.components), source: owner?.name ?? bufferStepOwners[id].job }; });
}
/** Records saved before the buffer record was the only source point at the job's own buffer. */
const legacyBufferKeys: Record<string, string> = { "purification-lysis:selected": "purification-buffer:lysis", "purification-subtractive:selected": "purification-buffer:cleavage", "purification-sec:selected": "purification-buffer:storage" };
function applySavedBuffer(component: RoadmapComponent, buffer?: SavedBuffer): RoadmapComponent { if (!buffer) return component; return { ...component, title: buffer.title, purpose: buffer.purpose, pH: buffer.pH, ingredients: structuredClone(buffer.ingredients), sourceBufferKey: buffer.key, sourceJobId: buffer.jobId }; }
function componentFromAnalysis(type: "chromatogram" | "gel", job: ProjectJob): RoadmapComponent { return { id: crypto.randomUUID(), type, title: type === "gel" ? String(job.config.filename ?? job.name) : String(job.config.projectName ?? job.name), notes: "", sourceJobId: job.id, ...(type === "gel" && job.config.previewBase64 ? { dataUrl: `data:image/png;base64,${String(job.config.previewBase64)}`, mimeType: "image/png" } : {}) }; }
function newComponent(type: ComponentType): RoadmapComponent { const defaults: Record<ComponentType, Partial<RoadmapComponent>> = { buffer: { title: "Saved buffer", purpose: "", pH: "", ingredients: [] }, measurement: { title: "Yield and purity", yieldUnit: "mg", yieldMethod: yieldMethods[0], purityMethod: purityMethods[0] }, chromatogram: { title: "Chromatogram" }, gel: { title: "Gel densitometry" }, image: { title: "Experimental image" }, note: { title: "Experimental note" } }; return { id: crypto.randomUUID(), type, title: "Record", notes: "", ...defaults[type] }; }
function newRoadmapStep(templateId: string): RoadmapStep {
  const template = stepTemplates.find((value) => value.id === templateId) ?? stepTemplates[0];
  const jobs: Record<string, [string, string]> = {
    expression: ["transformation-expression", "Transformation and Expression"], lysis: ["purification-lysis", "Cell lysis job"], affinity: ["purification-affinity", "Affinity capture job"], cleavage: ["purification-subtractive", "Protease choice · Subtractive cleanup job"], cleanup: ["purification-subtractive", "Subtractive cleanup job"], sec: ["purification-sec", "SEC polishing job"], qc: ["purification-sec", "Storage buffer · SEC polishing job"], storage: ["purification-sec", "Storage buffer · SEC polishing job"],
  };
  const linked = jobs[templateId] ?? ["", "User-defined step"];
  return { id: `added-${crypto.randomUUID()}`, title: template.title, instruction: template.instruction, record: template.record, ready: false, jobId: linked[0], jobLabel: linked[1], planDetails: [], components: [], custom: true };
}
function itemSummary(value: RoadmapComponent) { if (value.type === "buffer") return `${value.purpose || "Saved buffer"}${value.pH ? ` · pH ${value.pH}` : ""} · ${(value.ingredients ?? []).filter((item) => item.name).length} components`; if (value.type === "measurement") return `Yield ${value.yieldValue || "—"} ${value.yieldUnit || ""} · Purity ${value.purityValue || "—"}%`; if (value.sourceJobId) return "Linked to a saved project analysis"; return value.notes || value.fileName || "Click or right-click to edit"; }

type TransitionStatus = { analysing: boolean; failed: boolean };
/** The before/after-cleavage panel, from the same numbers Affinity capture, SEC and the report use. */
function cleavageTransition(numbers: ConstructNumbers, status: TransitionStatus) {
  const { native, fusion, cleaved, cleaves } = numbers, after = cleaves ? cleaved : fusion;
  const nativeOxidized = native && native.extinctionOxidized !== native.extinctionReduced ? formatCoefficient(native.extinctionOxidized, false) : "";
  const assembly = numbers.assembly && numbers.purified ? `${numbers.assemblyLabel}: ${formatMass(numbers.assembly.massDa)} (${numbers.subunits} × ${formatMass(numbers.purified.massDa)})${numbers.assembly.extinctionReduced === null ? "" : `, ε₂₈₀ ${formatCoefficient(numbers.assembly.extinctionReduced)}`}` : "";
  if (numbers.constructSource === "none") return {
    cleavagePlanned: false, tagLabel: numbers.unresolvedTag ?? "Affinity tag not selected", beforeMass: numbers.unresolvedTag ? "Exact tag sequence needed" : formatSpeciesMass(native), afterMass: formatSpeciesMass(native), beforeExtinction: numbers.unresolvedTag ? "Exact tag sequence needed" : formatSpeciesExtinction(native), afterExtinction: formatSpeciesExtinction(native), oxidized: nativeOxidized, assembly,
    note: numbers.unresolvedTag ? `${numbers.unresolvedTag} is a large fusion partner. Load or paste its sequence in Affinity capture to calculate the tagged precursor.` : "Choose an affinity tag in Affinity capture to calculate the tagged precursor. These values come from Protein properties.",
  };
  // A planned construct is analysed by the engine on first view; say so until the numbers arrive.
  const waiting = status.failed ? "Engine unavailable" : "Calculating…";
  const species = (value: typeof fusion, format: (value: typeof fusion) => string) => value ? format(value) : waiting;
  const oxidized = after && after.extinctionOxidized !== after.extinctionReduced ? formatCoefficient(after.extinctionOxidized, false) : "";
  const residues = fusion ? `${fusion.residues} aa expressed${cleaves && cleaved ? `, ${cleaved.residues} aa after cleavage` : ""}` : "";
  const origin = numbers.constructSource === "saved" ? "the construct saved in Affinity capture" : "the construct Affinity capture shows for this plan (not saved yet)";
  return {
    cleavagePlanned: cleaves, tagLabel: `${numbers.tagName ?? "Affinity tag"}${residues ? ` · ${residues}` : ""}`,
    beforeMass: species(fusion, formatSpeciesMass), afterMass: species(after, formatSpeciesMass), beforeExtinction: species(fusion, formatSpeciesExtinction), afterExtinction: species(after, formatSpeciesExtinction), oxidized, assembly,
    note: status.failed && !fusion ? "The engine could not calculate the construct. Open Affinity capture to recalculate it." : `Calculated from ${origin}: tag, linker, cleavage site and junction included.${cleaves ? numbers.scar ? ` Cleavage leaves ${numbers.scar} on the protein.` : " Cleavage leaves no residual residues." : " No protease is chosen, so the tag stays on."}`,
  };
}
function formatSpeciesMass(value: SpeciesNumbers | null) { return value ? formatMass(value.massDa) : "Calculate Protein properties"; }
function formatSpeciesExtinction(value: SpeciesNumbers | null) { return formatCoefficient(value?.extinctionReduced ?? null); }
function formatMass(value: number) { return `${(value / 1000).toFixed(2)} kDa`; }
function formatCoefficient(value: number | null, fallback = true) { return value === null ? (fallback ? "Calculate Protein properties" : "") : Math.round(value).toLocaleString(); }

function reportFilename(bundle: ProteinBundle) { return `${safeFilename(bundle.protein.name)}-purification-roadmap.html`; }
function safeFilename(value: string) { return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "").toLowerCase() || "protein"; }
function downloadBlob(filename: string, blob: Blob) { const url = URL.createObjectURL(blob), link = document.createElement("a"); link.href = url; link.download = filename; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
function escapeHtml(value: unknown) { return String(value ?? "").replace(/[&<>"']/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#039;" })[character]!); }

function roadmapReport(bundle: ProteinBundle, steps: RoadmapStep[], transition: ReturnType<typeof cleavageTransition>) {
  const generated = new Date().toLocaleString(), jobs = new Map(bundle.projectJobs.map((job) => [job.id, job]));
  const body = steps.map((step, index) => `<section class="step"><header><span>${index + 1}</span><div><h2>${escapeHtml(step.title)}</h2><p>${escapeHtml(step.instruction)}</p></div><b class="${step.ready ? "ready" : "pending"}">${step.ready ? "PLANNED" : "IN PROGRESS"}</b></header>${step.planDetails.length ? `<div class="plan">${step.planDetails.map((detail) => `<em>${escapeHtml(detail)}</em>`).join("")}</div>` : ""}<p class="record"><b>Record:</b> ${escapeHtml(step.record)}</p>${step.components.length ? `<div class="records">${step.components.map((component) => reportComponent(component, jobs.get(component.sourceJobId ?? ""))).join("")}</div>` : `<p class="empty">No records have been attached to this step.</p>`}</section>`).join("");
  const transitionBlock = `<section class="transition"><header><div><small>EXPECTED PROTEIN MEASUREMENTS</small><h2>Before and after affinity-tag cleavage</h2></div><b>${transition.cleavagePlanned ? "CLEAVAGE PLANNED" : "TAG RETAINED / NOT SET"}</b></header><div><article><span>Before cleavage</span><strong>${escapeHtml(transition.beforeMass)}</strong><small>Molecular weight</small><em>${escapeHtml(transition.beforeExtinction)}</em><small>ε₂₈₀ reduced · M⁻¹ cm⁻¹</small></article><i>→</i><article><span>After cleavage</span><strong>${escapeHtml(transition.afterMass)}</strong><small>Molecular weight</small><em>${escapeHtml(transition.afterExtinction)}</em><small>ε₂₈₀ reduced · M⁻¹ cm⁻¹</small></article><aside><b>${escapeHtml(transition.tagLabel)}</b><p>${escapeHtml(transition.note)}</p>${transition.oxidized ? `<small>Oxidized-cystine ε₂₈₀ after cleavage: ${escapeHtml(transition.oxidized)} M⁻¹ cm⁻¹</small>` : ""}${transition.assembly ? `<small>${escapeHtml(transition.assembly)}</small>` : ""}</aside></div></section>`;
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(bundle.protein.name)} · Purification roadmap</title><style>${reportCss}</style></head><body><main><header class="cover"><small>PROTEIN LAB · PURIFICATION RECORD</small><h1>${escapeHtml(bundle.protein.name)}</h1><p>${escapeHtml(bundle.protein.description || "Purification roadmap")}</p><dl><div><dt>Sequence length</dt><dd>${bundle.protein.sequence.length} aa</dd></div><div><dt>Organism</dt><dd>${escapeHtml(bundle.protein.organism || "Not recorded")}</dd></div><div><dt>Generated</dt><dd>${escapeHtml(generated)}</dd></div></dl></header>${body}${transitionBlock}<footer>Generated locally by Protein Lab · ${escapeHtml(generated)}</footer></main></body></html>`;
}
function reportComponent(component: RoadmapComponent, job?: ProjectJob) {
  const notes = component.notes ? `<p class="notes">${escapeHtml(component.notes)}</p>` : "";
  if (component.type === "buffer") return `<article class="item buffer"><h3>${escapeHtml(component.title)}</h3><p><b>${escapeHtml(component.purpose)}</b>${component.pH ? ` · pH ${escapeHtml(component.pH)}` : ""}</p><table><thead><tr><th>Component</th><th>Concentration</th><th>Role</th></tr></thead><tbody>${(component.ingredients ?? []).map((item) => `<tr><td>${escapeHtml(item.name)}</td><td>${escapeHtml(item.concentration)} ${escapeHtml(item.unit)}</td><td>${escapeHtml(item.role)}</td></tr>`).join("")}</tbody></table>${notes}</article>`;
  if (component.type === "measurement") return `<article class="item measurement"><h3>${escapeHtml(component.title)}</h3><div class="metrics"><span><b>${escapeHtml(component.yieldValue || "—")} ${escapeHtml(component.yieldUnit)}</b><small>Yield · ${escapeHtml(component.yieldMethod)}</small></span><span><b>${escapeHtml(component.purityValue || "—")}%</b><small>Purity · ${escapeHtml(component.purityMethod)}</small></span></div>${notes}</article>`;
  if (component.type === "gel") return `<article class="item figure"><h3>${escapeHtml(component.title)}</h3>${gelReportFigure(job, component)}${gelQuantificationBlock(job)}${notes}</article>`;
  if (component.type === "chromatogram") return `<article class="item figure"><h3>${escapeHtml(component.title)}</h3>${chromatogramReportFigure(job)}${notes}</article>`;
  if (component.type === "image") return `<article class="item figure"><h3>${escapeHtml(component.title)}</h3>${component.dataUrl ? `<img src="${escapeHtml(component.dataUrl)}" alt="${escapeHtml(component.title)}">` : `<p>Image file: ${escapeHtml(component.fileName || "not embedded")}</p>`}${notes}</article>`;
  return `<article class="item note"><h3>${escapeHtml(component.title)}</h3>${notes || "<p>No note text was entered.</p>"}</article>`;
}
function gelReportFigure(job: ProjectJob | undefined, component: RoadmapComponent) {
  const source = component.dataUrl || (job?.config.previewBase64 ? `data:image/png;base64,${String(job.config.previewBase64)}` : ""); if (!source) return "<p>No gel preview is saved.</p>";
  const lanes = arrayObjects(job?.config.lanes), bands = arrayObjects(job?.config.bands);
  // A band the engine refused to quantify is drawn dashed, so the distinction
  // survives a greyscale print as well as it does on screen.
  const bandClass = (band: JsonObject) => `band${band.isTarget === true ? " target" : ""}${band.quantificationRefused === true ? " refused" : ""}${band.autoDetected === false ? " manual" : ""}`;
  return `<div class="gel-figure"><img src="${escapeHtml(source)}" alt="Saved gel"><div class="gel-overlay">${lanes.map((lane) => `<i class="lane" style="left:${Number(lane.xStart) * 100}%;width:${(Number(lane.xEnd) - Number(lane.xStart)) * 100}%"><b>${escapeHtml(lane.label)}</b></i>`).join("")}${bands.map((band) => `<i class="${bandClass(band)}" style="left:${laneLeft(lanes, band)}%;width:${laneWidth(lanes, band)}%;top:${Number(band.centerY) * 100}%"><b>${band.isTarget === true ? escapeHtml(band.label || "Target") : ""}</b></i>`).join("")}</div></div>`;
}
/**
 * The gel's quantitative claim, limited to what the engine actually reported: a
 * target signal fraction with its uncertainty where one exists, and the stated
 * reason where it does not. No purity is recalculated here.
 */
function gelQuantificationBlock(job?: ProjectJob) {
  if (!job) return "";
  const config = readGelJobConfig(job.config);
  const lanes = gelReportLanes(config).filter((lane) => !lane.isLadder);
  if (!lanes.length) return "";
  const rows = lanes.map((lane) => {
    const verdict = lane.verdict;
    const value = verdict.kind === "available"
      ? `<b>${escapeHtml(formatSignalFraction(verdict.fraction, verdict.uncertainty))}</b>`
      : verdict.kind === "unavailable"
        ? `Unavailable — ${escapeHtml(verdict.headline.toLowerCase())}`
        : "No target band selected";
    const detail = verdict.kind === "unavailable" ? verdict.detail.join(" ") : "";
    return `<tr class="${verdict.kind === "available" ? "" : "unavailable"}"><td>${escapeHtml(lane.label)}</td><td>${escapeHtml(lane.targetLabel ?? "—")}</td><td>${value}${detail ? `<small>${escapeHtml(detail)}</small>` : ""}</td></tr>`;
  }).join("");
  const refused = config.bands.filter((band) => bandQuantification(band) === "refused_saturated");
  const quantification = config.quantification;
  const calibration = config.ladderCalibration;
  const method = [
    quantification ? `Background: ${quantification.backgroundMethod} at ${quantification.backgroundRadiusPx} px.` : "",
    quantification ? `Linear range ${quantification.linearDynamicRange.minSignal}–${quantification.linearDynamicRange.maxSignal} (${quantification.linearDynamicRange.unit}).` : "",
    quantification ? `Uncertainty: ${quantification.uncertaintyMethod}.` : "",
    calibration?.status === "calibrated" && calibration.fitR2 !== null ? `Ladder fit R² = ${calibration.fitR2.toFixed(4)}${calibration.mobilityRange ? `, valid for mobility ${calibration.mobilityRange[0].toFixed(3)}–${calibration.mobilityRange[1].toFixed(3)} from the top` : ""}.` : "",
    config.calibrationIsStale ? "Molecular weights are withheld: the ladder inputs changed after this analysis." : "",
  ].filter(Boolean).join(" ");
  const caveats = quantification?.caveats.length
    ? `<ul class="gel-caveats">${quantification.caveats.map((caveat) => `<li>${escapeHtml(caveat)}</li>`).join("")}</ul>`
    : "";
  const refusals = refused.length
    ? `<p class="gel-refusals"><b>${refused.length} band${refused.length === 1 ? "" : "s"} not quantified:</b> ${escapeHtml(refused.map((band) => `${band.label} (${band.saturationReason ?? "saturated"})`).join("; "))}</p>`
    : "";
  return `<table class="gel-quant"><caption>Target signal fraction · ${escapeHtml(SIGNAL_FRACTION_CAVEAT)}</caption><thead><tr><th>Lane</th><th>Target band</th><th>Signal fraction</th></tr></thead><tbody>${rows}</tbody></table>${refusals}${method ? `<p class="gel-method">${escapeHtml(method)}</p>` : ""}${caveats}`;
}
function laneLeft(lanes: JsonObject[], band: JsonObject) { const lane = lanes.find((item) => String(item.id) === String(band.laneId)); return lane ? Number(lane.xStart) * 100 : 0; }
function laneWidth(lanes: JsonObject[], band: JsonObject) { const lane = lanes.find((item) => String(item.id) === String(band.laneId)); return lane ? (Number(lane.xEnd) - Number(lane.xStart)) * 100 : 100; }
function chromatogramReportFigure(job?: ProjectJob) {
  if (!job) return "<p>No chromatogram project is linked.</p>";
  const traces = arrayObjects(job.config.traces).filter((trace) => trace.visible !== false), peaks = arrayObjects(job.config.peaks), annotations = arrayObjects(job.config.annotations), fractions = arrayObjects(job.config.fractions);
  const allPoints = traces.flatMap((trace) => arrayObjects(trace.points).map((point) => ({ x: Number(point.x) + Number(trace.xShift ?? 0), y: Number(point.y) * Number(trace.yScale ?? 1) + Number(trace.yOffset ?? 0) })).filter((point) => Number.isFinite(point.x) && Number.isFinite(point.y)));
  if (!allPoints.length) return "<p>The saved Chromatogram Studio project does not contain a trace preview.</p>";
  const minX = Math.min(...allPoints.map((point) => point.x)), maxX = Math.max(...allPoints.map((point) => point.x)), minY = Math.min(0, ...allPoints.map((point) => point.y)), maxY = Math.max(...allPoints.map((point) => point.y));
  const width = 900, height = 380, left = 64, right = 20, top = 24, bottom = 50, plotW = width - left - right, plotH = height - top - bottom;
  const sx = (x: number) => left + (x - minX) / Math.max(.000001, maxX - minX) * plotW, sy = (y: number) => top + (maxY - y) / Math.max(.000001, maxY - minY) * plotH;
  const paths = traces.map((trace) => { const d = arrayObjects(trace.points).map((point, index) => `${index ? "L" : "M"}${sx(Number(point.x) + Number(trace.xShift ?? 0)).toFixed(1)} ${sy(Number(point.y) * Number(trace.yScale ?? 1) + Number(trace.yOffset ?? 0)).toFixed(1)}`).join(" "); return `<path d="${d}" fill="none" stroke="${escapeHtml(trace.color || "#24445c")}" stroke-width="${Math.max(1, Number(trace.lineWidth ?? 2))}" opacity="${Number(trace.opacity ?? 1)}"/>`; }).join("");
  const fractionShapes = fractions.map((fraction) => `<rect x="${sx(Number(fraction.start))}" y="${top}" width="${Math.max(1, sx(Number(fraction.end)) - sx(Number(fraction.start)))}" height="${plotH}" fill="${escapeHtml(fraction.color || "#f0b94d")}" opacity="${Number(fraction.opacity ?? .16)}"/>`).join("");
  const peakShapes = peaks.map((peak) => `<line x1="${sx(Number(peak.apexX))}" y1="${sy(Number(peak.response ?? peak.height ?? 0))}" x2="${sx(Number(peak.apexX))}" y2="${top + plotH}" stroke="${escapeHtml(peak.color || "#e36a4a")}" stroke-dasharray="4 4"/><text x="${sx(Number(peak.apexX)) + 5}" y="${Math.max(18, sy(Number(peak.response ?? peak.height ?? 0)) - 7)}" fill="${escapeHtml(peak.color || "#e36a4a")}">${escapeHtml(peak.name || "Peak")}</text>`).join("");
  const annotationShapes = annotations.map((annotation) => `<text x="${sx(Number(annotation.x))}" y="${top + Number(annotation.y) / 100 * plotH}" fill="${escapeHtml(annotation.color || "#222")}" font-size="${Number(annotation.fontSize ?? 12)}">${escapeHtml(annotation.text)}</text>`).join("");
  return `<svg class="chromatogram" viewBox="0 0 ${width} ${height}" role="img" aria-label="Saved chromatogram"><rect width="${width}" height="${height}" fill="white"/><g>${fractionShapes}</g><path d="M${left} ${top}V${top + plotH}H${left + plotW}" fill="none" stroke="#2b3640" stroke-width="1.5"/>${paths}${peakShapes}${annotationShapes}<text x="${left + plotW / 2}" y="${height - 12}" text-anchor="middle">Retention volume / time</text><text x="17" y="${top + plotH / 2}" transform="rotate(-90 17 ${top + plotH / 2})" text-anchor="middle">Response</text></svg>`;
}
function arrayObjects(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }

const reportCss = `:root{font-family:Inter,ui-sans-serif,system-ui,sans-serif;color:#17232c;background:#eef1f2}*{box-sizing:border-box}body{margin:0;background:#eef1f2}main{max-width:1020px;margin:28px auto;background:#fff;padding:54px;box-shadow:0 18px 60px #17232c20}.cover{border-bottom:4px solid #37bba0;padding-bottom:28px;margin-bottom:32px}.cover small{color:#db684f;font-weight:800;letter-spacing:.14em}.cover h1{font-size:42px;margin:10px 0 6px}.cover>p{color:#5f6c73}.cover dl{display:flex;gap:14px;margin:24px 0 0}.cover dl div{flex:1;background:#f3f6f5;border:1px solid #dce4e1;border-radius:12px;padding:12px}.cover dt,.cover dd{margin:0}.cover dt{font-size:11px;text-transform:uppercase;color:#708078}.cover dd{font-weight:700;margin-top:5px}.step{page-break-inside:avoid;border:1px solid #dce4e1;border-radius:16px;margin:0 0 24px;overflow:hidden}.step>header{display:flex;gap:14px;align-items:flex-start;padding:20px;background:#f6f8f7}.step>header>span{display:grid;place-items:center;min-width:32px;height:32px;border-radius:50%;background:#17232c;color:#fff;font-weight:800}.step h2{margin:0 0 6px;font-size:21px}.step header p,.record{margin:0;color:#5a6870}.step header div{flex:1}.step header>b{font-size:10px;letter-spacing:.08em;border-radius:999px;padding:7px 9px}.step header .ready{background:#d9f4e9;color:#187657}.step header .pending{background:#f2ead8;color:#876c2e}.plan{display:flex;flex-wrap:wrap;gap:7px;padding:15px 20px 0}.plan em{font-style:normal;background:#e9f0f4;border-radius:999px;padding:6px 10px;font-size:12px}.record{padding:15px 20px}.records{display:grid;gap:14px;padding:0 20px 20px}.item{border:1px solid #dce4e1;border-left:5px solid #4d9de8;border-radius:11px;padding:16px;page-break-inside:avoid}.item h3{margin:0 0 10px}.item p{margin:8px 0;color:#4e5d65}.item.measurement{border-left-color:#38b489}.item.figure{border-left-color:#a878e8}.item.note{border-left-color:#77879b}.item img,.chromatogram{display:block;max-width:100%;max-height:560px;margin:12px auto;border:1px solid #d7dddf;border-radius:8px}.metrics{display:flex;gap:12px}.metrics span{flex:1;background:#eff7f4;padding:13px;border-radius:9px}.metrics b,.metrics small{display:block}.metrics b{font-size:22px}.metrics small{color:#5a6870;margin-top:4px}table{width:100%;border-collapse:collapse;font-size:13px}th,td{text-align:left;border-bottom:1px solid #e2e7e8;padding:8px}.gel-figure{position:relative;display:inline-block;max-width:100%}.gel-figure>img{margin:0;max-height:520px}.gel-overlay{position:absolute;inset:0}.lane{position:absolute;top:0;height:100%;border:1px solid #40a9d8}.lane b{position:absolute;top:2px;left:2px;background:#fffD;padding:2px;font-size:9px}.band{position:absolute;height:2px;background:#ef8f47}.band.target{background:#e44845;height:3px}.band.refused,.band.manual{background:transparent;height:0;border-top:2px dashed #8a6d1f}.band b{position:absolute;left:100%;font-size:9px;background:#fff}table.gel-quant{margin-top:14px}table.gel-quant caption{caption-side:bottom;text-align:left;font-size:11px;color:#6a7780;padding-top:8px;line-height:1.5}table.gel-quant td b{font-size:15px}table.gel-quant td small{display:block;color:#6a7780;font-size:11px;margin-top:3px;line-height:1.45}table.gel-quant tr.unavailable td{color:#7a5f22}p.gel-method,p.gel-refusals{font-size:11.5px;color:#6a7780;line-height:1.5}ul.gel-caveats{margin:8px 0 0;padding-left:18px;font-size:11.5px;color:#6a7780;line-height:1.5}.empty{padding:0 20px 20px;color:#829097;font-style:italic}.transition{page-break-inside:avoid;border:1px solid #bfded6;border-radius:16px;background:#f3faf8;padding:20px;margin-top:30px}.transition>header{display:flex;justify-content:space-between;align-items:flex-start}.transition h2{margin:4px 0 0}.transition header small{color:#299777;font-weight:800;letter-spacing:.1em}.transition header>b{border-radius:99px;background:#d9f4e9;color:#187657;padding:7px 9px;font-size:10px}.transition>div{display:grid;grid-template-columns:1fr auto 1fr 1.4fr;align-items:center;gap:15px;margin-top:16px}.transition article{display:flex;flex-direction:column;border-radius:11px;background:#fff;padding:14px}.transition article>span,.transition article>small,.transition aside>small{color:#66757b;font-size:11px}.transition article>strong{font-size:24px;margin:6px 0 1px}.transition article>em{font-size:17px;font-style:normal;font-weight:750;margin-top:10px}.transition>div>i{font-size:24px;font-style:normal}.transition aside{border-left:1px solid #bfded6;padding-left:15px}.transition aside p{font-size:12px;line-height:1.45;color:#53646b}footer{margin-top:36px;padding-top:16px;border-top:1px solid #dce4e1;color:#748088;font-size:12px}@media print{body{background:#fff}main{margin:0;max-width:none;padding:22px;box-shadow:none}.step,.transition{break-inside:avoid}.cover{break-after:avoid}}`;
