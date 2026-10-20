"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Download, LoaderCircle, RefreshCw, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ensureProjectJob, proteinLabsApi, type JsonObject, type ProteinBundle } from "@/lib/protein-labs-api";
import { readableMethod, regionSections, regionSelection, residueLabel, stepRegion, structureOptionLabel, type RegionsResponse, type StructureApiError, type StructureDetail, type StructureEntry, type StructureRegion } from "@/lib/structure-regions";
import { StructureViewer } from "@/components/protein-labs/structure-viewer";
import type { ViewerRegion } from "@/components/protein-labs/molstar-viewer";

type JobProps = { bundle: ProteinBundle; onChanged: () => Promise<void> };
type Load<T> = { state: "idle" | "loading" | "ready" | "error"; value: T | null; message: string };
const idle = <T,>(): Load<T> => ({ state: "idle", value: null, message: "" });
const keyOf = (entry: Pick<StructureEntry, "source" | "id">) => `${entry.source}:${entry.id}`;

/** The Structure Viewer job: pick the AlphaFold model or an experimental PDB entry, then step through regions of interest. */
export function StructureJob({ bundle, onChanged }: JobProps) {
  const proteinId = bundle.protein.id;
  const [list, setList] = useState<Load<{ structures: StructureEntry[]; errors: StructureApiError[]; accession: string | null }>>({ state: "loading", value: null, message: "" });
  const [selectedKey, setSelectedKey] = useState("");
  const [detail, setDetail] = useState<Load<StructureDetail>>(idle);
  const [regions, setRegions] = useState<Load<RegionsResponse>>(idle);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [showAdditives, setShowAdditives] = useState(false);
  const [reload, setReload] = useState(0);
  const savedModels = bundle.alphaFoldModels.length;

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setList((current) => ({ ...current, state: "loading", message: "" })); });
    proteinLabsApi.listStructures(proteinId).then((value) => {
      if (!active) return;
      setList({ state: "ready", value: { structures: value.structures ?? [], errors: value.errors ?? [], accession: value.referenceAccession }, message: "" });
      setSelectedKey((current) => value.structures.some((entry) => keyOf(entry) === current) ? current : defaultKey(value.structures));
    }).catch((reason: unknown) => { if (active) setList({ state: "error", value: null, message: errorText(reason) }); });
    return () => { active = false; };
  }, [proteinId, savedModels, reload]);

  const structures = useMemo(() => list.value?.structures ?? [], [list.value]);
  const selected = structures.find((entry) => keyOf(entry) === selectedKey) ?? null;

  useEffect(() => {
    if (!selected) return;
    let active = true;
    queueMicrotask(() => { if (!active) return; setDetail({ state: "loading", value: null, message: "" }); setRegions({ state: "loading", value: null, message: "" }); setRegionId(null); });
    proteinLabsApi.getStructure(proteinId, selected.source, selected.id)
      .then((value) => { if (active) setDetail({ state: "ready", value, message: "" }); })
      .catch((reason: unknown) => { if (active) setDetail({ state: "error", value: null, message: errorText(reason) }); });
    proteinLabsApi.getStructureRegions(proteinId, selected.source, selected.id)
      .then((value) => { if (active) setRegions({ state: "ready", value, message: "" }); })
      .catch((reason: unknown) => { if (active) setRegions({ state: "error", value: null, message: errorText(reason) }); });
    return () => { active = false; };
    // Re-fetch only when the chosen structure changes, not when the list object is rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proteinId, selected?.source, selected?.id, reload]);

  const sections = useMemo(() => regionSections(regions.value?.groups ?? [], { showAdditives }), [regions.value, showAdditives]);
  const region = sections.flatMap((section) => section.regions).find((item) => item.id === regionId) ?? null;
  const selection = useMemo(() => region ? regionSelection(region) : null, [region]);
  const viewerRegion = useMemo<ViewerRegion | null>(() => region && selection && selection.status !== "unmapped" ? { id: region.id, residues: selection.residues, ligand: selection.ligand } : null, [region, selection]);
  const step = useCallback((delta: 1 | -1) => setRegionId((current) => stepRegion(sections, current, delta)), [sections]);
  const geometry = useMemo<JsonObject | null>(() => detail.value ? { structureText: detail.value.structureText, format: detail.value.format ?? "cif", source: detail.value.source } : null, [detail.value]);

  const legacy = list.state === "error";
  return <div className="structure-layout">
    <section className="lab-panel structure-view">
      <div className="panel-heading"><div><h2>{selected ? structureOptionLabel(selected) : "Structure Viewer"}</h2><p>{legacy ? "Saved AlphaFold model. Experimental entries need the structure service of the local engine." : selected?.title ?? (selected?.source === "alphafold_db" ? "AlphaFold DB model of the reference UniProt entry" : "Choose an AlphaFold model or an experimental PDB entry")}</p></div></div>
      {legacy ? <LegacyPreview bundle={bundle}/> : <div className="molecule-stage">
        {detail.state === "ready" && geometry
          ? <StructureViewer geometry={geometry} paletteKey={proteinId} label={selected ? selected.id : "Structure"} confidence={selected?.source === "alphafold_db"} region={viewerRegion}/>
          : <StageMessage list={list} detail={detail} hasStructures={structures.length > 0} onRetry={() => setReload((value) => value + 1)}/>}
      </div>}
    </section>
    <div className="structure-side">
      <section className="lab-panel structure-picker">
        <div className="panel-heading"><div><h2>Structure</h2><p>{list.value?.accession ? `Entries for UniProt ${list.value.accession}` : "AlphaFold model and experimental PDB entries"}</p></div></div>
        {list.state === "loading" && <p className="structure-note"><LoaderCircle className="spin"/> Looking up AlphaFold and PDB entries…</p>}
        {list.state === "error" && <Notice error message={`Experimental structures could not be listed: ${list.message} The saved AlphaFold model is shown instead.`}/>}
        {list.state === "ready" && (structures.length
          ? <label className="lab-field"><span>Show structure</span><select value={selectedKey} onChange={(event) => setSelectedKey(event.target.value)}>
              {(["alphafold_db", "pdb"] as const).map((source) => { const items = structures.filter((entry) => entry.source === source); return items.length ? <optgroup key={source} label={source === "pdb" ? `Experimental (PDB) · ${items.length}` : "Predicted (AlphaFold)"}>{items.map((entry) => <option key={keyOf(entry)} value={keyOf(entry)}>{structureOptionLabel(entry)}</option>)}</optgroup> : null; })}
            </select></label>
          : <p className="structure-note">No AlphaFold model or PDB entry is available yet. Choose a reference match, then retrieve the AlphaFold model below.</p>)}
        {selected && <StructureFacts entry={selected}/>}
        {(list.value?.errors ?? []).map((error, index) => <Notice key={index} error message={`${error.source} is unavailable: ${error.message}${error.retryable ? " Try again later." : ""}`}/>)}
      </section>
      <RegionsPanel state={regions} sections={sections} region={region} selection={selection} showAdditives={showAdditives} disabled={!selected || detail.state !== "ready"}
        onChoose={setRegionId} onStep={step} onToggleAdditives={setShowAdditives}/>
      <AlphaFoldActions bundle={bundle} onChanged={onChanged}/>
    </div>
  </div>;
}

function defaultKey(structures: StructureEntry[]) {
  const preferred = structures.find((entry) => entry.source === "alphafold_db") ?? structures[0];
  return preferred ? keyOf(preferred) : "";
}

function StageMessage({ list, detail, hasStructures, onRetry }: { list: Load<unknown>; detail: Load<unknown>; hasStructures: boolean; onRetry(): void }) {
  if (detail.state === "error") return <div className="structure-empty" role="alert"><CircleAlert/><strong>The structure could not be downloaded</strong><small>{detail.message}</small><Button variant="outline" size="sm" onClick={onRetry}><RefreshCw/> Try again</Button></div>;
  if (list.state === "loading" || detail.state === "loading") return <div className="structure-empty" role="status"><LoaderCircle className="spin"/><strong>{detail.state === "loading" ? "Downloading coordinates…" : "Finding structures…"}</strong><small>Large entries can take a few seconds.</small></div>;
  if (!hasStructures) return <div className="structure-empty"><strong>No structure to show yet</strong><small>Retrieve the AlphaFold DB model or pick an experimental entry once a reference match is chosen.</small></div>;
  return <div className="structure-empty"><strong>Choose a structure</strong></div>;
}

function StructureFacts({ entry }: { entry: StructureEntry }) {
  const ligands = entry.ligands.filter((ligand) => ligand.classification === "ligand");
  const ligandIds = [...new Map(ligands.map((ligand) => [ligand.ccdId, ligand.name ?? ""])).entries()];
  return <dl className="structure-facts">
    <dt>Source</dt><dd>{entry.source === "pdb" ? "RCSB PDB" : "AlphaFold DB"}</dd>
    {entry.method && <><dt>Method</dt><dd>{readableMethod(entry.method)}</dd></>}
    {typeof entry.resolutionAngstrom === "number" && <><dt>Resolution</dt><dd>{entry.resolutionAngstrom.toFixed(2)} Å</dd></>}
    <dt>Chains</dt><dd>{entry.chains.length ? entry.chains.map((chain) => `${chain.chainId} (${chain.modeledResidueCount}/${chain.residueCount} modelled)`).join(", ") : "—"}</dd>
    {entry.source === "pdb" && <><dt>Mapped chains</dt><dd>{entry.mappedChains?.length ? entry.mappedChains.join(", ") : entry.siftsAvailable === false ? "No SIFTS mapping; regions cannot be placed" : "—"}</dd></>}
    <dt>Ligands</dt><dd>{ligandIds.length ? ligandIds.map(([id, name], index) => <span key={id} title={name || undefined}>{index ? ", " : ""}{id}</span>) : "None"}</dd>
  </dl>;
}

function RegionsPanel({ state, sections, region, selection, showAdditives, disabled, onChoose, onStep, onToggleAdditives }: {
  state: Load<RegionsResponse>; sections: ReturnType<typeof regionSections>; region: StructureRegion | null; selection: ReturnType<typeof regionSelection> | null; showAdditives: boolean; disabled: boolean;
  onChoose(id: string | null): void; onStep(delta: 1 | -1): void; onToggleAdditives(value: boolean): void;
}) {
  const total = sections.reduce((sum, section) => sum + section.regions.length, 0);
  const position = region ? sections.flatMap((section) => section.regions).findIndex((item) => item.id === region.id) + 1 : 0;
  const hasAdditives = (state.value?.groups ?? []).some((item) => item.type === "ligand_binding_site" && ["water", "common_additive"].includes(String(item.metadata?.classification)));
  return <section className="lab-panel structure-regions">
    <div className="panel-heading"><div><h2>Regions of interest</h2><p>Highlights exactly the residues the engine maps onto this structure.</p></div></div>
    {state.state === "loading" && <p className="structure-note"><LoaderCircle className="spin"/> Mapping regions onto the structure…</p>}
    {state.state === "error" && <Notice error message={`Regions could not be computed: ${state.message}`}/>}
    {state.state === "ready" && (total ? <>
      <div className="region-picker">
        <Button variant="outline" size="icon" aria-label="Previous region" title="Previous region" disabled={disabled} onClick={() => onStep(-1)}><ChevronLeft/></Button>
        <select aria-label="Region of interest" value={region?.id ?? ""} disabled={disabled} onChange={(event) => onChoose(event.target.value || null)}>
          <option value="">None highlighted</option>
          {sections.map((section) => <optgroup key={section.key} label={section.label}>{section.regions.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}</optgroup>)}
        </select>
        <Button variant="outline" size="icon" aria-label="Next region" title="Next region" disabled={disabled} onClick={() => onStep(1)}><ChevronRight/></Button>
      </div>
      <div className="region-meta"><small>{region ? `${position} of ${total}` : `${total} regions`}</small>{region && <button type="button" className="region-clear" onClick={() => onChoose(null)}><X/> Clear</button>}</div>
      {hasAdditives && <label className="region-toggle"><input type="checkbox" checked={showAdditives} onChange={(event) => onToggleAdditives(event.target.checked)}/> List waters and crystallisation additives</label>}
      {region && selection && <RegionDetail region={region} selection={selection}/>}
    </> : <p className="structure-note">No regions of interest were found for this structure.</p>)}
    {(state.value?.errors ?? []).map((error, index) => <Notice key={index} error message={`${error.source} is unavailable: ${error.message}`}/>)}
  </section>;
}

function RegionDetail({ region, selection }: { region: StructureRegion; selection: ReturnType<typeof regionSelection> }) {
  const rows = region.residues.filter((row) => row.modeled !== false && row.labelChainId && typeof row.labelSeqId === "number");
  const meta = region.metadata ?? {};
  return <div className="region-detail" aria-live="polite">
    <strong>{region.label}</strong>
    <p>{region.description}</p>
    {region.type === "ligand_binding_site" && <p className="region-ligand">{String(meta.name ?? meta.ccdId)} · {String(meta.ccdId)} chain {String(meta.chainId)} residue {String(meta.authSeqId)}{meta.insertionCode ? String(meta.insertionCode) : ""}{typeof meta.minimumDistanceAngstrom === "number" ? ` · closest contact ${meta.minimumDistanceAngstrom.toFixed(2)} Å` : ""}</p>}
    {selection.status === "unmapped" && <Notice error message="Not mapped onto this structure. These positions are outside the model or fall in an alignment gap, so nothing is highlighted."/>}
    {selection.status === "partial" && <Notice error message={`${selection.unmappedCount} position${selection.unmappedCount === 1 ? " is" : "s are"} outside the model or in an alignment gap. Only the ${rows.length} mapped residue${rows.length === 1 ? " is" : "s are"} highlighted.`}/>}
    {selection.status === "mapped" && <Notice message={region.type === "ligand_binding_site" ? `Ligand and ${rows.length} contact residue${rows.length === 1 ? "" : "s"} highlighted.` : `${rows.length} residue${rows.length === 1 ? "" : "s"} highlighted.`}/>}
    {rows.length > 0 && <ul className="region-residues">{rows.slice(0, 40).map((row) => <li key={`${row.labelChainId}:${row.labelSeqId}`} title={row.uniprotPosition ? `UniProt position ${row.uniprotPosition}${row.constructPosition ? ` · construct position ${row.constructPosition}` : ""}` : "No UniProt position"}>{residueLabel(row)}{row.mismatch ? " ≠ ref" : ""}</li>)}{rows.length > 40 && <li className="more">and {rows.length - 40} more</li>}</ul>}
  </div>;
}

/** Retrieve, prepare and import AlphaFold models (unchanged from the Structure prediction job). */
function AlphaFoldActions({ bundle, onChanged }: JobProps) {
  const match = bundle.uniprotMatches[0]; const defaultAccession = match ? text(match.accession, "") : "";
  const [accession, setAccession] = useState(defaultAccession); const [busy, setBusy] = useState(false); const [message, setMessage] = useState(""); const [importPath, setImportPath] = useState("");
  async function fetchModel() { setBusy(true); setMessage("Matching UniProt and retrieving AlphaFold DB coordinates…"); try { const value = await proteinLabsApi.alphaFoldDb(bundle.protein.id, accession); const latest = await proteinLabsApi.getProtein(bundle.protein.id); await ensureProjectJob(bundle.protein.id, latest.projectJobs, "alphafold", "AlphaFold structure", { modelId: value.modelId, source: "AlphaFold DB" }); await onChanged(); setMessage("AlphaFold model downloaded and saved locally."); } catch (reason) { setMessage(errorText(reason)); } finally { setBusy(false); } }
  async function prepare() { setBusy(true); try { const value = await proteinLabsApi.alphaFoldServer(bundle.protein.id); const latest = await proteinLabsApi.getProtein(bundle.protein.id); await ensureProjectJob(bundle.protein.id, latest.projectJobs, "alphafold", "AlphaFold Server submission", { source: "AlphaFold Server", ...value }, "in_progress"); await onChanged(); setMessage(`AlphaFold Server input prepared: ${text(value.submissionPath)}`); } catch (reason) { setMessage(errorText(reason)); } finally { setBusy(false); } }
  async function importResult() { if (!importPath.trim()) { setMessage("Enter the local path to an AlphaFold result (.cif, .pdb, or supported archive)."); return; } setBusy(true); try { const value = await proteinLabsApi.importAlphaFold(bundle.protein.id, importPath.trim()); const latest = await proteinLabsApi.getProtein(bundle.protein.id); await ensureProjectJob(bundle.protein.id, latest.projectJobs, "alphafold", "Imported AlphaFold structure", { modelId: value.modelId, source: "AlphaFold Server import", path: importPath, savedByUser: true }); await onChanged(); setMessage("AlphaFold result imported and saved locally."); } catch (reason) { setMessage(errorText(reason)); } finally { setBusy(false); } }
  return <details className="lab-panel structure-alphafold" open={bundle.alphaFoldModels.length === 0}>
    <summary className="panel-heading"><div><h2>AlphaFold model</h2><p>{bundle.alphaFoldModels.length} model{bundle.alphaFoldModels.length === 1 ? "" : "s"} saved locally</p></div></summary>
    <label className="lab-field"><span>UniProt accession</span><input value={accession} onChange={(event) => setAccession(event.target.value.toUpperCase())} placeholder="Automatically inferred when blank"/></label>
    <Button className="wide" disabled={busy} onClick={() => void fetchModel()}>{busy ? <LoaderCircle className="spin"/> : <Download/>} Retrieve AlphaFold DB model</Button>
    <Button variant="outline" className="wide" disabled={busy} onClick={() => void prepare()}><Upload/> Prepare AlphaFold Server job</Button>
    <hr/>
    <label className="lab-field"><span>Import returned AlphaFold result</span><input value={importPath} onChange={(event) => setImportPath(event.target.value)} placeholder="/home/user/Downloads/fold_model.cif"/></label>
    <Button variant="outline" className="wide" disabled={busy} onClick={() => void importResult()}><Upload/> Import returned result</Button>
    <Notice message={message} error={/not contain|could not|error|enter|unavailable|failed/i.test(message)}/>
  </details>;
}

/** Shown when the engine has no structure endpoints: the saved AlphaFold model, as before HOM-127. */
function LegacyPreview({ bundle }: { bundle: ProteinBundle }) {
  const model = bundle.alphaFoldModels[0] ?? null;
  const [geometry, setGeometry] = useState<JsonObject | null>(null);
  useEffect(() => { if (!model?.modelId) return; proteinLabsApi.getAlphaFoldModel(bundle.protein.id, text(model.modelId, "")).then((value) => setGeometry(object(value.geometry))).catch(() => undefined); }, [bundle.protein.id, model]);
  return <div className="molecule-stage"><StructureViewer geometry={geometry} paletteKey={bundle.protein.id} confidence label={model ? `${text(model.name, text(model.modelId))} · ${text(geometry?.meanPlddt)} mean pLDDT` : "No AlphaFold model saved"}/></div>;
}

function Notice({ message, error = false }: { message: string; error?: boolean }) { return message ? <div className={`inline-message ${error ? "error" : ""}`}>{error ? <CircleAlert/> : <CircleCheck/>} {message}</div> : null; }
function text(value: unknown, fallback: unknown = "—") { return String(value === null || value === undefined || value === "" ? fallback : value); }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function errorText(reason: unknown) { return reason instanceof Error ? reason.message : String(reason); }
