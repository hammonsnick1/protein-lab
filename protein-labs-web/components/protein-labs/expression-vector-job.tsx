"use client";

import { useEffect, useRef, useState } from "react";
import { AlignCenter, ArrowLeftRight, Beaker, Check, CircleAlert, Database, Dna, Download, FileInput, FlaskConical, History, LoaderCircle, Map as MapIcon, Plus, Redo2, Save, Scissors, Search, Trash2, Undo2, WandSparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { ensureProjectJob, fileToBase64, proteinLabsApi } from "@/lib/protein-labs-api";
import { VectorBackboneBrowser } from "@/components/protein-labs/vector-backbone-browser";
import { VectorCloningWorkspace } from "@/components/protein-labs/vector-cloning-workspace";

type VectorRecord = JsonObject & { id: string; name: string; sequence: string; circular: boolean; features: JsonObject[]; primers: JsonObject[]; orfs: JsonObject[]; restrictionSites: JsonObject[]; history: JsonObject[] };
type VectorTab = "map" | "clone" | "sequence" | "orfs" | "primers" | "tools" | "history";

export function ExpressionVectorJob({ bundle, onChanged }: { bundle: ProteinBundle; onChanged: () => Promise<void> }) {
  const [vectors, setVectors] = useState<VectorRecord[]>([]);
  const [selectedId, setSelectedId] = useState("");
  const [draft, setDraft] = useState<VectorRecord>(() => blankVector());
  const [tab, setTab] = useState<VectorTab>("map");
  const [selectedFeature, setSelectedFeature] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [featureName, setFeatureName] = useState("New feature");
  const [featureType, setFeatureType] = useState("misc_feature");
  const [featureColor, setFeatureColor] = useState("#43a047");
  const [featureNotes, setFeatureNotes] = useState("");
  const [insertSequence, setInsertSequence] = useState("");
  const [motif, setMotif] = useState("");
  const [motifHits, setMotifHits] = useState<number[]>([]);
  const [orfMinimum, setOrfMinimum] = useState(50);
  const [digestEnzymes, setDigestEnzymes] = useState("EcoRI, BamHI, HindIII, NotI, XhoI");
  const [digest, setDigest] = useState<JsonObject | null>(null);
  const [alignId, setAlignId] = useState("");
  const [alignment, setAlignment] = useState<JsonObject | null>(null);
  const [primerName, setPrimerName] = useState("Insert PCR");
  const [primerLength, setPrimerLength] = useState(20);
  const [assemblyIds, setAssemblyIds] = useState<string[]>([]);
  const [assemblyName, setAssemblyName] = useState("Overlap assembly");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [browsing, setBrowsing] = useState(false);
  const [browserDismissed, setBrowserDismissed] = useState(false);
  const [undo, setUndo] = useState<VectorRecord[]>([]);
  const [redo, setRedo] = useState<VectorRecord[]>([]);
  const fileRef = useRef<HTMLInputElement>(null);

  async function load(preferred = selectedId) {
    const response = await proteinLabsApi.listVectors(bundle.protein.id);
    const next = response.vectors.map(vectorRecord);
    setVectors(next);
    const selected = next.find((vector) => vector.id === preferred) ?? next[0];
    if (selected) { setSelectedId(selected.id); setDraft(selected); }
    else { setSelectedId(""); setDraft(blankVector()); }
  }
  useEffect(() => {
    void load(); // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bundle.protein.id]);



  const activeFeature = draft.features.find((feature) => String(feature.id) === selectedFeature);
  const selectedLength = Math.max(0, selection.end - selection.start);
  const sequenceLength = draft.sequence.length;

  function choose(id: string) {
    const value = vectors.find((vector) => vector.id === id);
    if (!value) return;
    setSelectedId(id); setDraft(value); setSelectedFeature(""); setUndo([]); setRedo([]); setDigest(null); setAlignment(null);
  }

  function beginNew() { setSelectedId(""); setDraft(blankVector()); setSelectedFeature(""); setUndo([]); setRedo([]); setTab("sequence"); }

  async function persist(value = draft, note = "Vector saved.") {
    if (!value.sequence.trim()) { setMessage("Enter or import a DNA sequence before saving."); return null; }
    setBusy(true); setMessage("");
    try {
      const saved = selectedId ? await proteinLabsApi.updateVector(bundle.protein.id, selectedId, value) : await proteinLabsApi.createVector(bundle.protein.id, value);
      const record = vectorRecord(saved); setSelectedId(record.id); setDraft(record);
      const latest = await proteinLabsApi.getProtein(bundle.protein.id);
      await ensureProjectJob(bundle.protein.id, latest.projectJobs, "expression-planning", `Expression vector — ${record.name}`, { vectorId: record.id, vectorName: record.name, featureCount: record.features.length, primerCount: record.primers.length, savedByUser: true });
      await load(record.id); await onChanged(); setMessage(note); return record;
    } catch (reason) { setMessage(errorText(reason)); return null; }
    finally { setBusy(false); }
  }

  async function adopt(vector: JsonObject, note: string, tab: VectorTab = "clone") {
    const record = vectorRecord(vector);
    await load(record.id);
    const latest = await proteinLabsApi.getProtein(bundle.protein.id);
    await ensureProjectJob(bundle.protein.id, latest.projectJobs, "expression-planning", `Expression vector — ${record.name}`, {
      vectorId: record.id,
      vectorName: record.name,
      featureCount: record.features.length,
      primerCount: record.primers.length,
      source: String(vector.source ?? vector.sourceName ?? "project"),
      sourceId: String(vector.sourceId ?? ""),
      sourceUrl: String(vector.sourceUrl ?? ""),
      savedByUser: true,
    });
    await onChanged();
    setBrowsing(false); setTab(tab); setMessage(note);
  }

  async function importFile(file: File | null) {
    if (!file) return;
    setBusy(true); setMessage("");
    try {
      const snapgene = /\.(dna|prot)$/i.test(file.name);
      const content = snapgene ? await fileToBase64(file) : await file.text();
      const imported = vectorRecord(await proteinLabsApi.importVector(bundle.protein.id, file.name, content));
      await load(imported.id); setTab("map"); setMessage(`${file.name} imported with ${imported.features.length} annotations.`);
    }
    catch (reason) { setMessage(errorText(reason)); }
    finally { setBusy(false); if (fileRef.current) fileRef.current.value = ""; }
  }

  async function exportFile(format: "genbank" | "fasta") {
    if (!selectedId) { setMessage("Save the vector before exporting it."); return; }
    try { const result = await proteinLabsApi.exportVector(bundle.protein.id, selectedId, format); downloadText(result.filename, result.content); }
    catch (reason) { setMessage(errorText(reason)); }
  }

  async function annotateAutomatically() {
    const saved = selectedId ? draft : await persist(draft, "Vector saved.");
    if (!saved) return;
    setBusy(true);
    try { const annotated = vectorRecord(await proteinLabsApi.autoAnnotateVector(bundle.protein.id, saved.id, orfMinimum, true)); await load(annotated.id); setDraft(annotated); setTab("map"); const report = object(annotated.annotationReport); setMessage(`${String(report.added ?? 0)} features added by ${String(report.method ?? "automatic annotation")}.`); }
    catch (reason) { setMessage(errorText(reason)); }
    finally { setBusy(false); }
  }

  function snapshot() { setUndo((values) => [...values.slice(-99), structuredClone(draft)]); setRedo([]); }

  async function addAnnotation(insert = false) {
    let start = Math.min(selection.start, selection.end), end = Math.max(selection.start, selection.end);
    const next = structuredClone(draft);
    snapshot();
    if (insert) {
      const replacement = cleanDna(insertSequence);
      if (!replacement) { setMessage("Enter the DNA region to insert."); return; }
      const position = start;
      next.sequence = next.sequence.slice(0, position) + replacement + next.sequence.slice(position);
      next.features = next.features.map((feature) => Number(feature.start) >= position ? { ...feature, start: Number(feature.start) + replacement.length, end: Number(feature.end) + replacement.length } : feature);
      start = position; end = position + replacement.length;
    } else if (end <= start) { setMessage("Highlight a sequence region first."); return; }
    const feature = { id: `feature-${crypto.randomUUID()}`, name: featureName.trim() || "New feature", type: featureType, start, end, strand: 1, color: featureColor, notes: featureNotes, automatic: false };
    next.features = [...next.features, feature];
    setDraft(next); setSelectedFeature(String(feature.id)); setSelection({ start, end });
    await persist(next, `${feature.name} annotated from base ${start + 1} to ${end}.`);
  }

  async function updateFeature(patch: JsonObject) {
    if (!activeFeature) return;
    snapshot();
    const next = { ...draft, features: draft.features.map((feature) => String(feature.id) === selectedFeature ? { ...feature, ...patch } : feature) };
    setDraft(next); await persist(next, "Annotation updated in map and sequence views.");
  }

  async function deleteFeature() {
    if (!activeFeature) return;
    snapshot(); const next = { ...draft, features: draft.features.filter((feature) => String(feature.id) !== selectedFeature) };
    setSelectedFeature(""); setDraft(next); await persist(next, "Annotation removed.");
  }

  async function sequenceOperation(operation: "insert" | "delete" | "replace" | "reverse_complement") {
    if (!selectedId) { setMessage("Save the vector before applying sequence edits."); return; }
    let start = Math.min(selection.start, selection.end), end = Math.max(selection.start, selection.end);
    const replacement = operation === "insert" || operation === "replace" ? cleanDna(insertSequence) : "";
    if ((operation === "delete" || operation === "replace") && end <= start) { setMessage("Highlight a sequence region first."); return; }
    if (operation === "reverse_complement" && end <= start) { start = 0; end = draft.sequence.length; }
    snapshot(); setBusy(true);
    try { const result = vectorRecord(await proteinLabsApi.editVectorSequence(bundle.protein.id, selectedId, operation, start, end, replacement)); setDraft(result); await load(result.id); setMessage(`${operation.replace("_", " ")} applied.`); }
    catch (reason) { setMessage(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function restore(direction: "undo" | "redo") {
    const source = direction === "undo" ? undo : redo;
    const target = source.at(-1); if (!target) return;
    if (direction === "undo") { setUndo(source.slice(0, -1)); setRedo((values) => [...values, structuredClone(draft)]); }
    else { setRedo(source.slice(0, -1)); setUndo((values) => [...values, structuredClone(draft)]); }
    setDraft(target); await persist(target, `${direction === "undo" ? "Undo" : "Redo"} applied.`);
  }

  function findMotif() {
    const query = cleanDna(motif); const hits: number[] = [];
    if (query) for (let index = draft.sequence.indexOf(query); index >= 0; index = draft.sequence.indexOf(query, index + 1)) hits.push(index);
    setMotifHits(hits); if (hits.length) setSelection({ start: hits[0], end: hits[0] + query.length }); setMessage(`${hits.length} exact motif match${hits.length === 1 ? "" : "es"} found.`);
  }

  async function designPrimers() {
    if (!selectedId) return setMessage("Save the vector first.");
    const start = Math.min(selection.start, selection.end), end = Math.max(selection.start, selection.end) || draft.sequence.length;
    setBusy(true);
    try { const result = vectorRecord(await proteinLabsApi.designVectorPrimers(bundle.protein.id, selectedId, primerName, start, end, primerLength)); setDraft(result); await load(result.id); setTab("primers"); setMessage("Forward and reverse primers designed and saved."); }
    catch (reason) { setMessage(errorText(reason)); }
    finally { setBusy(false); }
  }

  async function removePrimer(id: string) { const next = { ...draft, primers: draft.primers.filter((primer) => String(primer.id) !== id) }; setDraft(next); await persist(next, "Primer removed."); }

  async function runDigest() { if (!selectedId) return setMessage("Save the vector first."); setBusy(true); try { const value = await proteinLabsApi.digestVector(bundle.protein.id, selectedId, digestEnzymes.split(/[,\s]+/).filter(Boolean)); setDigest(value); setMessage("Restriction digest simulated."); } catch (reason) { setMessage(errorText(reason)); } finally { setBusy(false); } }
  async function runAlignment() { if (!selectedId || !alignId) return setMessage("Choose a second saved vector."); setBusy(true); try { setAlignment(await proteinLabsApi.alignVectors(bundle.protein.id, selectedId, alignId)); setMessage("Pairwise DNA alignment completed."); } catch (reason) { setMessage(errorText(reason)); } finally { setBusy(false); } }
  async function runAssembly() { if (assemblyIds.length < 2) return setMessage("Select at least two vectors in assembly order."); setBusy(true); try { const created = vectorRecord(await proteinLabsApi.assembleVectors(bundle.protein.id, assemblyName, assemblyIds, 20, false)); await load(created.id); setMessage("Overlap assembly created and saved as a new vector."); } catch (reason) { setMessage(errorText(reason)); } finally { setBusy(false); } }
  async function deleteVector() { if (!selectedId || !window.confirm(`Delete ${draft.name}?`)) return; await proteinLabsApi.deleteVector(bundle.protein.id, selectedId); await load(""); setMessage("Vector deleted."); }

  return <div className="vector-planner">
    <aside className="vector-library"><header><span><strong>Project vectors</strong><small>{vectors.length} saved constructs</small></span><Button size="icon-sm" onClick={beginNew}><Plus/></Button></header><div>{vectors.map((vector) => <button className={vector.id === selectedId ? "selected" : ""} key={vector.id} onClick={() => choose(vector.id)}><Dna/><span><strong>{vector.name}</strong><small>{vector.sequence.length.toLocaleString()} bp · {vector.features.length} features</small></span></button>)}</div><input ref={fileRef} type="file" hidden accept=".gb,.gbk,.genbank,.fa,.fasta,.fna" onChange={(event) => void importFile(event.target.files?.[0] ?? null)}/><Button onClick={() => setBrowsing(true)}><Database/> Load backbone</Button><Button variant="outline" onClick={() => fileRef.current?.click()}><FileInput/> Import GenBank / FASTA / .dna</Button><Button variant="ghost" onClick={beginNew}><Plus/> New blank vector</Button></aside>
    <section className="vector-main"><header className="vector-editor-header"><div><input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })}/><span>{sequenceLength.toLocaleString()} bp · {draft.circular ? "circular" : "linear"} · {Number(draft.gcPercent ?? gcPercent(draft.sequence)).toFixed(1)}% GC</span></div><label className="topology-toggle"><input type="checkbox" checked={draft.circular} onChange={(event) => setDraft({ ...draft, circular: event.target.checked })}/><span>{draft.circular ? "Circular" : "Linear"}</span></label><Button disabled={busy} onClick={() => void persist()}>{busy ? <LoaderCircle className="spin"/> : <Save/>} Save</Button><Button variant="outline" onClick={() => void annotateAutomatically()}><WandSparkles/> Auto annotate</Button><Button variant="ghost" size="icon" disabled={!undo.length} onClick={() => void restore("undo")}><Undo2/></Button><Button variant="ghost" size="icon" disabled={!redo.length} onClick={() => void restore("redo")}><Redo2/></Button></header>
      <nav className="vector-tabs">{([ ["map","Map",MapIcon], ["clone","Clone",Scissors], ["sequence","Sequence",Dna], ["orfs","ORFs",FlaskConical], ["primers","Primers",Beaker], ["tools","Tools",Scissors], ["history","History",History] ] as [VectorTab,string,typeof Dna][]).map(([id,label,Icon]) => <button key={id} className={tab === id ? "active" : ""} onClick={() => setTab(id)}><Icon/>{label}</button>)}</nav>
      <div className="vector-tab-content">
        {tab === "map" && <VectorMap vector={draft} selectedFeature={selectedFeature} onFeature={(id) => { setSelectedFeature(id); const feature = draft.features.find((item) => String(item.id) === id); if (feature) setSelection({start:Number(feature.start),end:Number(feature.end)}); }}/>} 
        {tab === "clone" && <VectorCloningWorkspace bundle={bundle} vectorId={selectedId} vectorName={draft.name} onInserted={(vector, note) => adopt(vector, note, "clone")}/>}
        {tab === "sequence" && <div className="sequence-design"><div className="sequence-toolbar"><Button size="sm" variant="outline" onClick={() => void addAnnotation(false)}><Plus/> Annotate selection</Button><Button size="sm" variant="outline" onClick={() => void addAnnotation(true)}><Plus/> Insert annotated region</Button><Button size="sm" variant="ghost" onClick={() => void sequenceOperation("delete")}><Trash2/> Delete</Button><Button size="sm" variant="ghost" onClick={() => void sequenceOperation("replace")}><ArrowLeftRight/> Replace</Button><Button size="sm" variant="ghost" onClick={() => void sequenceOperation("reverse_complement")}><AlignCenter/> Reverse complement</Button><span>{selectedLength ? `Selected ${selection.start + 1}–${selection.end} (${selectedLength} bp)` : "Highlight DNA to annotate or edit"}</span></div><div className="sequence-annotations">{draft.features.map((feature) => <button key={String(feature.id)} className={String(feature.id) === selectedFeature ? "selected" : ""} style={{borderColor:String(feature.color ?? "#607d8b")}} onClick={() => { setSelectedFeature(String(feature.id)); setSelection({start:Number(feature.start),end:Number(feature.end)}); }}><span style={{background:String(feature.color ?? "#607d8b")}}/><strong>{String(feature.name)}</strong><small>{Number(feature.start)+1}–{String(feature.end)}</small></button>)}</div><textarea className="dna-editor" spellCheck={false} value={draft.sequence} onChange={(event) => setDraft({ ...draft, sequence: cleanDna(event.target.value) })} onSelect={(event) => setSelection({ start: event.currentTarget.selectionStart, end: event.currentTarget.selectionEnd })}/></div>}
        {tab === "orfs" && <div className="orf-workspace"><div className="tool-row"><label>Minimum ORF amino acids<input type="number" min="5" value={orfMinimum} onChange={(event) => setOrfMinimum(Number(event.target.value))}/></label><Button onClick={() => void annotateAutomatically()}><WandSparkles/> Detect and annotate ORFs</Button></div><div className="data-table"><div><b>ORF</b><b>Coordinates</b><b>Frame</b><b>Length</b><b>Translation</b></div>{draft.orfs.map((orf) => <button key={String(orf.id)} onClick={() => setSelection({start:Number(orf.start),end:Number(orf.end)})}><strong>{String(orf.name)}</strong><span>{Number(orf.start)+1}–{String(orf.end)}</span><span>{String(orf.frame)}</span><span>{String(orf.aminoAcids)} aa</span><code>{String(orf.translation).slice(0,45)}…</code></button>)}</div></div>}
        {tab === "primers" && <div className="primer-workspace"><div className="tool-row"><label>Pair name<input value={primerName} onChange={(event) => setPrimerName(event.target.value)}/></label><label>Primer length<input type="number" min="15" max="60" value={primerLength} onChange={(event) => setPrimerLength(Number(event.target.value))}/></label><Button onClick={() => void designPrimers()}><WandSparkles/> Design pair for selection</Button></div><div className="primer-list">{draft.primers.map((primer) => <article key={String(primer.id)}><span><strong>{String(primer.name)}</strong><small>{Number(primer.start)+1}–{String(primer.end)} · strand {Number(primer.strand)>0?"+":"−"}</small></span><code>{String(primer.overhang ?? "")}{String(primer.sequence)}</code><span><b>Tm {String(primer.tmCelsius)} °C</b><b>GC {String(primer.gcPercent)}%</b></span><Button variant="ghost" size="icon-sm" onClick={() => void removePrimer(String(primer.id))}><Trash2/></Button></article>)}</div></div>}
        {tab === "tools" && <div className="vector-tools"><section><h3><Search/> Find DNA motif</h3><div className="tool-row"><input value={motif} onChange={(event) => setMotif(event.target.value)} placeholder="Enter A/C/G/T motif"/><Button onClick={findMotif}>Find</Button></div><p>{motifHits.length ? motifHits.map((hit) => hit + 1).join(", ") : "No matches selected"}</p></section><section><h3><Scissors/> Restriction digest</h3><textarea value={digestEnzymes} onChange={(event) => setDigestEnzymes(event.target.value)}/><Button onClick={() => void runDigest()}>Simulate digest</Button>{digest && <pre>{pretty(digest)}</pre>}</section><section><h3><AlignCenter/> Align saved vectors</h3><select value={alignId} onChange={(event) => setAlignId(event.target.value)}><option value="">Choose query vector</option>{vectors.filter((vector) => vector.id !== selectedId).map((vector) => <option key={vector.id} value={vector.id}>{vector.name}</option>)}</select><Button onClick={() => void runAlignment()}>Align</Button>{alignment && <div className="alignment-result"><strong>{Number(alignment.identityPercent ?? 0).toFixed(2)}% identity</strong><span>{String(alignment.mismatches ?? 0)} mismatches · {String(alignment.gaps ?? 0)} gaps · score {String(alignment.score ?? "—")}</span></div>}</section><section><h3><FlaskConical/> Overlap assembly</h3><input value={assemblyName} onChange={(event) => setAssemblyName(event.target.value)}/><div className="assembly-list">{vectors.map((vector) => <label key={vector.id}><input type="checkbox" checked={assemblyIds.includes(vector.id)} onChange={(event) => setAssemblyIds(event.target.checked ? [...assemblyIds,vector.id] : assemblyIds.filter((id) => id !== vector.id))}/>{vector.name}</label>)}</div><Button onClick={() => void runAssembly()}>Assemble selected vectors</Button></section></div>}
        {tab === "history" && <div className="history-list">{draft.history.map((entry,index) => <article key={index}><History/><span><strong>{humanize(String(entry.type ?? "Vector operation"))}</strong><small>{pretty(entry)}</small></span></article>)}</div>}
      </div>
    </section>
    <aside className="feature-inspector"><header><strong>Inspector</strong>{activeFeature && <Button variant="ghost" size="icon-sm" onClick={() => setSelectedFeature("")}><X/></Button>}</header>{activeFeature ? <><label>Name<input value={String(activeFeature.name ?? "")} onChange={(event) => void updateFeature({name:event.target.value})}/></label><label>Type<input value={String(activeFeature.type ?? "misc_feature")} onChange={(event) => void updateFeature({type:event.target.value})}/></label><div className="coordinate-row"><label>Start<input type="number" min="1" value={Number(activeFeature.start)+1} onChange={(event) => void updateFeature({start:Number(event.target.value)-1})}/></label><label>End<input type="number" min="1" value={Number(activeFeature.end)} onChange={(event) => void updateFeature({end:Number(event.target.value)})}/></label></div><label>Strand<select value={Number(activeFeature.strand) < 0 ? -1 : 1} onChange={(event) => void updateFeature({strand:Number(event.target.value)})}><option value="1">Forward (+)</option><option value="-1">Reverse (−)</option></select></label><label>Color<input type="color" value={String(activeFeature.color ?? "#607d8b")} onChange={(event) => void updateFeature({color:event.target.value})}/></label><label>Notes<textarea value={String(activeFeature.notes ?? "")} onChange={(event) => void updateFeature({notes:event.target.value})}/></label><Button variant="destructive" onClick={() => void deleteFeature()}><Trash2/> Delete annotation</Button></> : <><p>Select an annotation on the map, in the sequence feature bar, or create one from a highlighted sequence.</p><label>New feature name<input value={featureName} onChange={(event) => setFeatureName(event.target.value)}/></label><label>Feature type<input value={featureType} onChange={(event) => setFeatureType(event.target.value)}/></label><label>Color<input type="color" value={featureColor} onChange={(event) => setFeatureColor(event.target.value)}/></label><label>Notes<textarea value={featureNotes} onChange={(event) => setFeatureNotes(event.target.value)}/></label><label>DNA to insert<textarea className="short-dna" value={insertSequence} onChange={(event) => setInsertSequence(cleanDna(event.target.value))}/></label><Button onClick={() => void addAnnotation(false)}><Plus/> Annotate selection</Button><Button variant="outline" onClick={() => void addAnnotation(true)}><Plus/> Insert & annotate</Button></>}<hr/><Button variant="outline" onClick={() => void exportFile("genbank")}><Download/> GenBank</Button><Button variant="outline" onClick={() => void exportFile("fasta")}><Download/> FASTA</Button>{selectedId && <Button variant="ghost" className="danger-text" onClick={() => void deleteVector()}><Trash2/> Delete vector</Button>}{message && <div className={`vector-message ${/error|enter|choose|first|outside/i.test(message)?"error":""}`}>{/error|enter|choose|first|outside/i.test(message)?<CircleAlert/>:<Check/>}<span>{message}</span></div>}</aside>
    {(browsing || (!vectors.length && !selectedId && !browserDismissed)) && <div className="backbone-overlay" role="dialog" aria-label="Load a vector backbone"><VectorBackboneBrowser proteinId={bundle.protein.id} onLoaded={(vector, note) => adopt(vector, note)} onClose={() => { setBrowsing(false); setBrowserDismissed(true); }}/></div>}
  </div>;
}

function VectorMap({ vector, selectedFeature, onFeature }: { vector: VectorRecord; selectedFeature: string; onFeature: (id: string) => void }) {
  const length = Math.max(1, vector.sequence.length);
  const width = 880, height = 620, cx = width / 2, cy = height / 2, radius = 176;

  // Features are drawn on up to three concentric rings so that overlapping
  // annotations stay separately readable, the way a plasmid map should.
  const drawn = vector.features.map((feature, index) => {
    const start = Number(feature.start) / length * 360 - 90;
    const end = Number(feature.end) / length * 360 - 90;
    const ring = radius - (index % 3) * 15;
    const mid = midAngle(start, end);
    return { feature, start, end, ring, mid, reverse: Number(feature.strand) < 0 };
  });

  // Enzyme ticks sit just outside the backbone; only unique cutters are
  // labelled, which is what makes a site useful for cloning.
  const cutCounts = new Map<string, number>();
  for (const site of vector.restrictionSites) {
    const name = String(site.enzyme ?? site.name ?? "");
    cutCounts.set(name, (cutCounts.get(name) ?? 0) + 1);
  }
  const enzymes = vector.restrictionSites
    .map((site) => ({
      name: String(site.enzyme ?? site.name ?? ""),
      position: Number(site.position ?? site.start ?? 0),
      unique: cutCounts.get(String(site.enzyme ?? site.name ?? "")) === 1,
    }))
    .filter((site) => site.unique)
    .slice(0, 28);

  // Features and enzymes share one layout pass so the two sets of labels
  // cannot land on top of each other.
  const labels = placeLabels([
    ...drawn.map((item) => ({ key: `f:${String(item.feature.id)}`, angle: item.mid, radius: item.ring })),
    ...enzymes.map((site, index) => ({ key: `e:${site.name}-${index}`, angle: site.position / length * 360 - 90, radius: radius + 12 })),
  ], cy, height, 14);

  return <div className="plasmid-map">
    <svg viewBox={`0 0 ${width} ${height}`}>
      <circle cx={cx} cy={cy} r={radius} className="plasmid-backbone" />

      {enzymes.map((site, index) => {
        const angle = site.position / length * 360 - 90;
        const inner = polar(cx, cy, radius - 4, angle), outer = polar(cx, cy, radius + 10, angle);
        const label = labels.get(`e:${site.name}-${index}`);
        if (!label) return null;
        return <g key={`${site.name}-${index}`} className="enzyme-mark">
          <line x1={inner.x} y1={inner.y} x2={outer.x} y2={outer.y} className="restriction-tick" />
          <polyline points={`${outer.x},${outer.y} ${label.bend},${label.y} ${label.x},${label.y}`} className="enzyme-leader" />
          <text x={label.x + (label.left ? -3 : 3)} y={label.y + 3} textAnchor={label.left ? "end" : "start"} className="restriction-label">{site.name}</text>
        </g>;
      })}

      {drawn.map((item) => {
        const id = String(item.feature.id);
        const color = String(item.feature.color ?? "#607d8b");
        const label = labels.get(`f:${id}`);
        const anchor = polar(cx, cy, item.ring, item.mid);
        return <g key={id} className={id === selectedFeature ? "selected" : ""} onClick={() => onFeature(id)}>
          <path d={arc(cx, cy, item.ring, item.start, item.end)} stroke={color} className="feature-arc" />
          <path d={arrowHead(cx, cy, item.ring, item.start, item.end, item.reverse)} fill={color} className="feature-arrow" />
          {label && <>
            <polyline points={`${anchor.x},${anchor.y} ${label.bend},${label.y} ${label.x},${label.y}`} className="feature-leader" />
            <text x={label.x + (label.left ? -4 : 4)} y={label.y + 3.5} textAnchor={label.left ? "end" : "start"}>{String(item.feature.name)}</text>
          </>}
        </g>;
      })}

      <text x={cx} y={cy - 4} textAnchor="middle" className="vector-name">{vector.name}</text>
      <text x={cx} y={cy + 18} textAnchor="middle" className="vector-length">{length.toLocaleString()} bp{vector.circular ? " · circular" : " · linear"}</text>
    </svg>
    <div className="map-key">
      <span><i /> Click an annotation to edit it</span>
      <span>{enzymes.length} unique cutters shown · {vector.restrictionSites.length} sites · {vector.orfs.length} ORFs</span>
    </div>
  </div>;
}

type PlacedLabel = { x: number; y: number; bend: number; left: boolean };

/**
 * Lay labels out around the map without overlapping.
 *
 * Each label keeps the side it naturally falls on, then the column is spread
 * apart so no two labels collide. Without this the cloning region of a real
 * backbone is an unreadable pile of overlapping text.
 */
function placeLabels(
  items: { key: string; angle: number; radius: number }[],
  cy: number,
  height: number,
  minimumGap: number,
): Map<string, PlacedLabel> {
  const columns: Record<"left" | "right", { key: string; y: number }[]> = { left: [], right: [] };
  for (const item of items) {
    const radians = item.angle * Math.PI / 180;
    const left = Math.cos(radians) < 0;
    columns[left ? "left" : "right"].push({ key: item.key, y: cy + Math.sin(radians) * (item.radius + 18) });
  }

  const placed = new Map<string, PlacedLabel>();
  for (const side of ["left", "right"] as const) {
    const column = columns[side].sort((a, b) => a.y - b.y);
    // Push downward where labels are too close, then pull back inside the frame.
    for (let index = 1; index < column.length; index += 1) {
      column[index].y = Math.max(column[index].y, column[index - 1].y + minimumGap);
    }
    const overflow = column.length ? column[column.length - 1].y - (height - 12) : 0;
    if (overflow > 0) for (const entry of column) entry.y -= overflow;
    for (let index = column.length - 2; index >= 0; index -= 1) {
      column[index].y = Math.min(column[index].y, column[index + 1].y - minimumGap);
    }
    const left = side === "left";
    for (const entry of column) {
      placed.set(entry.key, { x: left ? 150 : 730, y: Math.max(14, entry.y), bend: left ? 196 : 684, left });
    }
  }
  return placed;
}

/** Small triangle at the end of a feature arc showing its direction. */
function arrowHead(cx: number, cy: number, r: number, start: number, end: number, reverse: boolean) {
  const tipAngle = reverse ? start : end;
  const span = Math.min(6, Math.max(2, Math.abs(normalizeSpan(end - start)) / 3));
  const baseAngle = reverse ? tipAngle + span : tipAngle - span;
  const tip = polar(cx, cy, r, tipAngle);
  const outer = polar(cx, cy, r + 9, baseAngle);
  const inner = polar(cx, cy, r - 9, baseAngle);
  return `M ${tip.x} ${tip.y} L ${outer.x} ${outer.y} L ${inner.x} ${inner.y} Z`;
}

function midAngle(start: number, end: number) {
  return start + normalizeSpan(end - start) / 2;
}

function normalizeSpan(span: number) {
  let value = span;
  if (value < 0) value += 360;
  return Math.max(1, Math.min(359.9, value));
}

function blankVector(): VectorRecord { return { id:"", name:"Untitled vector", sequence:"", circular:true, features:[], primers:[], orfs:[], restrictionSites:[], history:[], enzymeNames:[], minimumOrfAminoAcids:50 }; }
function vectorRecord(raw: JsonObject): VectorRecord { return { ...blankVector(), ...raw, id:String(raw.id??""), name:String(raw.name??"Untitled vector"), sequence:String(raw.sequence??""), circular:raw.circular!==false, features:array(raw.features), primers:array(raw.primers), orfs:array(raw.orfs), restrictionSites:array(raw.restrictionSites), history:array(raw.history) }; }
function array(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item)&&typeof item==="object"&&!Array.isArray(item)) : []; }
function object(value: unknown): JsonObject { return value&&typeof value==="object"&&!Array.isArray(value)?value as JsonObject:{}; }
function cleanDna(value: string) { return value.toUpperCase().replace(/[^ACGTUN]/g, ""); }
function gcPercent(value: string) { return value ? (value.match(/[GC]/g)?.length ?? 0)/value.length*100 : 0; }
function errorText(value: unknown) { return value instanceof Error ? value.message : String(value); }
function humanize(value:string){return value.replace(/([a-z])([A-Z])/g,"$1 $2").replace(/[_-]/g," ");}
function pretty(value:unknown){return JSON.stringify(value,null,2);}
function downloadText(filename:string,content:string){const blob=new Blob([content],{type:"text/plain"});const url=URL.createObjectURL(blob);const link=document.createElement("a");link.href=url;link.download=filename;link.click();URL.revokeObjectURL(url);}
function polar(cx:number,cy:number,r:number,angle:number){const rad=angle*Math.PI/180;return{x:cx+Math.cos(rad)*r,y:cy+Math.sin(rad)*r};}
function arc(cx:number,cy:number,r:number,start:number,end:number){let span=end-start;if(span<0)span+=360;span=Math.max(1,Math.min(359.9,span));const a=polar(cx,cy,r,start),b=polar(cx,cy,r,start+span);return`M ${a.x} ${a.y} A ${r} ${r} 0 ${span>180?1:0} 1 ${b.x} ${b.y}`;}
