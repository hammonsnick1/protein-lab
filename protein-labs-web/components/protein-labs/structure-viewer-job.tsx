"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { Atom, ChevronLeft, ChevronRight, CircleAlert, CircleCheck, Download, ExternalLink, LoaderCircle, RefreshCw, Search, Upload, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ensureProjectJob, proteinLabsApi, type JsonObject, type ProteinBundle } from "@/lib/protein-labs-api";
import { readableMethod, regionSections, regionSelection, residueLabel, stepRegion, structureOptionLabel, type RegionsResponse, type StructureApiError, type StructureDetail, type StructureEntry, type StructureRegion } from "@/lib/structure-regions";
import { CHOICE_GROUPS, choiceKey, mappedChainIds, nextChoiceKey, normalizePdbId, percentText, researchHits, structureChoices, type ResearchHit, type StructureChoice } from "@/lib/structure-hits";
import { StructureViewer } from "@/components/protein-labs/structure-viewer";
import type { ViewerRegion } from "@/components/protein-labs/molstar-viewer";

type JobProps = { bundle: ProteinBundle; onChanged: () => Promise<void> };
type Load<T> = { state: "idle" | "loading" | "ready" | "error"; value: T | null; message: string; /** The structure this result belongs to. */ key?: string };
const idle = <T,>(): Load<T> => ({ state: "idle", value: null, message: "" });
const MANUAL_LIMIT = 6;

/** The Structure Viewer job: pick the AlphaFold model, a Sequence research hit or any PDB entry, then step through regions of interest. */
export function StructureJob({ bundle, onChanged, onOpenJob }: JobProps & { onOpenJob?: (jobId: string) => void }) {
  const proteinId = bundle.protein.id;
  const [list, setList] = useState<Load<{ structures: StructureEntry[]; errors: StructureApiError[]; accession: string | null }>>({ state: "loading", value: null, message: "" });
  const [selectedKey, setSelectedKey] = useState("");
  const [manual, setManual] = useManualIds(proteinId);
  const [detail, setDetail] = useState<Load<StructureDetail>>(idle);
  const [regions, setRegions] = useState<Load<RegionsResponse>>(idle);
  const [regionId, setRegionId] = useState<string | null>(null);
  const [showAdditives, setShowAdditives] = useState(false);
  const [reload, setReload] = useState(0);
  const savedModels = bundle.alphaFoldModels.length;
  const hits = useMemo(() => researchHits(bundle.pdbMatches), [bundle.pdbMatches]);
  const researchRan = bundle.projectJobs.some((job) => job.appType === "database-research" && Array.isArray(job.config.savedSources) && job.config.savedSources.map(String).includes("PDB"));

  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setList((current) => ({ ...current, state: "loading", message: "" })); });
    proteinLabsApi.listStructures(proteinId).then((value) => {
      if (active) setList({ state: "ready", value: { structures: value.structures ?? [], errors: value.errors ?? [], accession: value.referenceAccession }, message: "" });
    }).catch((reason: unknown) => { if (active) setList({ state: "error", value: null, message: errorText(reason) }); });
    return () => { active = false; };
  }, [proteinId, savedModels, reload]);

  const structures = useMemo(() => list.value?.structures ?? [], [list.value]);
  const choices = useMemo(() => structureChoices(structures, hits, manual), [structures, hits, manual]);
  // A choice the user made stands, even while the engine is still listing; otherwise the default opens once the list is in.
  const activeKey = choices.some((choice) => choice.key === selectedKey) || list.state !== "ready" ? selectedKey : nextChoiceKey(selectedKey, structures, choices);
  const choice = choices.find((item) => item.key === activeKey) ?? null;
  const selected = choice?.entry ?? null;

  useEffect(() => {
    if (!selected) return;
    let active = true;
    const key = choiceKey(selected);
    queueMicrotask(() => { if (!active) return; setDetail({ state: "loading", value: null, message: "", key }); setRegions({ state: "loading", value: null, message: "" }); setRegionId(null); });
    proteinLabsApi.getStructure(proteinId, selected.source, selected.id)
      .then((value) => { if (active) setDetail({ state: "ready", value, message: "", key }); })
      .catch((reason: unknown) => { if (active) setDetail({ state: "error", value: null, message: errorText(reason), key }); });
    proteinLabsApi.getStructureRegions(proteinId, selected.source, selected.id)
      .then((value) => { if (active) setRegions({ state: "ready", value, message: "" }); })
      .catch((reason: unknown) => { if (active) setRegions({ state: "error", value: null, message: errorText(reason) }); });
    return () => { active = false; };
    // Re-fetch only when the chosen structure changes, not when the list object is rebuilt.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [proteinId, selected?.source, selected?.id, reload]);

  // For one render after a switch the previous structure's result is still in state; never show it under the new name.
  const current = selected && detail.key === choiceKey(selected) ? detail : { ...detail, state: selected ? "loading" as const : detail.state };
  const sections = useMemo(() => regionSections(regions.value?.groups ?? [], { showAdditives }), [regions.value, showAdditives]);
  const region = sections.flatMap((section) => section.regions).find((item) => item.id === regionId) ?? null;
  const selection = useMemo(() => region ? regionSelection(region) : null, [region]);
  const viewerRegion = useMemo<ViewerRegion | null>(() => region && selection && selection.status !== "unmapped" ? { id: region.id, residues: selection.residues, ligand: selection.ligand } : null, [region, selection]);
  const step = useCallback((delta: 1 | -1) => setRegionId((current) => stepRegion(sections, current, delta)), [sections]);
  const geometry = useMemo<JsonObject | null>(() => current.state === "ready" && detail.value ? { structureText: detail.value.structureText, format: detail.value.format ?? "cif", source: selected?.source ?? null } : null, [current.state, detail.value, selected?.source]);
  // Research and typed-in entries arrive without chains or ligands; the loaded coordinates fill them in.
  const facts = useMemo(() => selected && current.state === "ready" && detail.value?.structure ? { ...selected, ...detail.value.structure, siftsAvailable: selected.siftsAvailable, mappedChains: selected.mappedChains ?? mappedChainIds(detail.value.mapping?.residues) } : selected, [selected, current.state, detail.value]);

  function choose(key: string) { setSelectedKey(key); }
  function loadId(id: string) {
    const key = `pdb:${id}`;
    if (!choices.some((item) => item.key === key)) setManual([...manual.filter((value) => value !== id), id].slice(-MANUAL_LIMIT));
    setSelectedKey(key);
  }
  const openResearch = onOpenJob ? () => onOpenJob("research") : undefined;

  const legacy = list.state === "error" && !choice;
  return <div className="structure-layout">
    <section className="lab-panel structure-view">
      <div className="panel-heading"><div><h2>{facts ? structureOptionLabel(facts) : "Structure Viewer"}</h2><p>{legacy ? "Saved AlphaFold model. Experimental entries need the structure service of the local engine." : facts?.title || choice?.hit?.description || (selected?.source === "alphafold_db" ? "AlphaFold DB model of the reference UniProt entry" : "Choose an AlphaFold model or an experimental PDB entry")}</p></div></div>
      {legacy ? <LegacyPreview bundle={bundle}/> : <div className="molecule-stage">
        {current.state === "ready" && geometry && selected
          ? <StructureViewer geometry={geometry} paletteKey={proteinId} label={selected.id} confidence={selected.source === "alphafold_db"} region={viewerRegion}/>
          : <StageMessage list={list} detail={current} selected={selected} hasChoices={choices.length > 0} onRetry={() => setReload((value) => value + 1)} onOpenResearch={openResearch}/>}
      </div>}
    </section>
    <div className="structure-side">
      <section className="lab-panel structure-picker">
        <div className="panel-heading"><div><h2>Structure</h2><p>{choices.length ? `${choices.length} structure${choices.length === 1 ? "" : "s"} to compare${list.value?.accession ? ` · UniProt ${list.value.accession}` : ""}` : "AlphaFold model, Sequence research hits and PDB entries"}</p></div></div>
        {list.state === "loading" && <p className="structure-note"><LoaderCircle className="spin"/> Looking up AlphaFold and PDB entries…</p>}
        {list.state === "error" && <Notice error message={`Entries linked to the UniProt reference could not be listed: ${sentence(list.message)}${hits.length ? " Sequence research hits can still be loaded." : " The saved AlphaFold model is shown instead."}`}/>}
        <StructureChoices choices={choices} activeKey={activeKey} accession={list.value?.accession ?? null} onChoose={choose}/>
        {!hits.length && <div className="structure-research-empty">
          <p className="structure-note"><Atom/> {researchRan ? "Sequence research found no PDB structures for this sequence." : "Sequence research has not searched the PDB for this protein yet."}</p>
          {openResearch && <Button variant="outline" size="sm" onClick={openResearch}><Search/> {researchRan ? "Search again in Sequence research" : "Open Sequence research"}</Button>}
        </div>}
        <PdbIdForm onLoad={loadId}/>
        {facts && <StructureFacts entry={facts} hit={choice?.hit ?? null} loaded={current.state === "ready"}/>}
        {(list.value?.errors ?? []).map((error, index) => <Notice key={index} error message={error.code === "reference_missing" ? "No UniProt reference match yet. PDB entries need one so residues and regions can be numbered: run “Find UniProt matches” in Sequence research." : `${error.source} is unavailable: ${error.message}${error.retryable ? " Try again later." : ""}`}/>)}
        {current.state === "ready" && (detail.value?.errors ?? []).map((error, index) => <Notice key={`d${index}`} error message={`${error.source} is unavailable: ${error.message}`}/>)}
      </section>
      <RegionsPanel state={legacy ? { state: "error", value: null, message: "the local engine has no structure service yet." } : regions} sections={sections} region={region} selection={selection} showAdditives={showAdditives} disabled={!selected || current.state !== "ready"}
        onChoose={setRegionId} onStep={step} onToggleAdditives={setShowAdditives}/>
      <AlphaFoldActions bundle={bundle} onChanged={onChanged}/>
    </div>
  </div>;
}

/** PDB IDs the user typed in, remembered per protein so they survive leaving the job. */
function useManualIds(proteinId: string): [string[], (ids: string[]) => void] {
  const storageKey = `protein-labs-structure-manual:${proteinId}`;
  const [ids, setIds] = useState<string[]>([]);
  useEffect(() => {
    let saved: unknown = [];
    try { saved = JSON.parse(localStorage.getItem(storageKey) ?? "[]"); } catch { saved = []; }
    const valid = Array.isArray(saved) ? saved.map((value) => normalizePdbId(String(value))).filter((value): value is string => Boolean(value)) : [];
    queueMicrotask(() => setIds(valid));
  }, [storageKey]);
  return [ids, (next) => { setIds(next); localStorage.setItem(storageKey, JSON.stringify(next)); }];
}

function StructureChoices({ choices, activeKey, accession, onChoose }: { choices: StructureChoice[]; activeKey: string; accession: string | null; onChoose(key: string): void }) {
  if (!choices.length) return null;
  return <div className="structure-choices" role="group" aria-label="Structures to show">
    {CHOICE_GROUPS.map((group) => {
      const items = choices.filter((item) => item.origin === group.origin);
      return items.length ? <div key={group.origin} className="structure-choice-group">
        <span className="structure-choice-heading">{group.label(items.length, accession)}</span>
        {items.map((item) => <ChoiceRow key={item.key} choice={item} active={item.key === activeKey} onChoose={() => onChoose(item.key)}/>)}
      </div> : null;
    })}
  </div>;
}

function ChoiceRow({ choice, active, onChoose }: { choice: StructureChoice; active: boolean; onChoose(): void }) {
  const { entry, hit } = choice;
  const method = entry.method ?? hit?.method ?? null;
  const resolution = entry.resolutionAngstrom ?? hit?.resolutionAngstrom ?? null;
  const facts = [method ? readableMethod(method) : "", typeof resolution === "number" ? `${resolution.toFixed(2)} Å` : ""].filter(Boolean).join(" · ");
  const title = entry.title || hit?.title || hit?.description || "";
  return <button type="button" className={`structure-choice ${active ? "active" : ""}`} aria-pressed={active} onClick={onChoose} title={title || undefined}>
    <span className="structure-choice-line"><strong>{entry.source === "alphafold_db" ? "AlphaFold model" : entry.id}</strong>{facts && <small>{facts}</small>}</span>
    {hit && <span className="structure-choice-metrics">{percentText(hit.identity)} identity · {percentText(hit.coverage)} coverage{hit.chainIds.length ? ` · chain${hit.chainIds.length === 1 ? "" : "s"} ${hit.chainIds.join(", ")}` : ""}</span>}
    {(title || entry.source === "alphafold_db") && <span className="structure-choice-title">{entry.source === "alphafold_db" ? entry.id : title}</span>}
  </button>;
}

function PdbIdForm({ onLoad }: { onLoad(id: string): void }) {
  const [value, setValue] = useState("");
  const [error, setError] = useState("");
  function submit(event: FormEvent) {
    event.preventDefault();
    const id = normalizePdbId(value);
    if (!id) { setError("Enter a four-character PDB ID, such as 4HHB."); return; }
    setError(""); setValue(""); onLoad(id);
  }
  return <form className="structure-id-form" onSubmit={submit} noValidate>
    <label className="lab-field"><span>Load any PDB entry by ID</span>
      <span className="structure-id-row"><input value={value} maxLength={4} spellCheck={false} autoComplete="off" placeholder="e.g. 4HHB" aria-invalid={Boolean(error)} onChange={(event) => { setValue(event.target.value.toUpperCase()); setError(""); }}/><Button type="submit" variant="outline" size="sm" disabled={!value.trim()}><Download/> Load</Button></span>
    </label>
    {error && <Notice error message={error}/>}
  </form>;
}

function StageMessage({ list, detail, selected, hasChoices, onRetry, onOpenResearch }: { list: Load<unknown>; detail: Load<unknown>; selected: StructureEntry | null; hasChoices: boolean; onRetry(): void; onOpenResearch?: () => void }) {
  if (detail.state === "error") {
    const needsReference = /uniprot reference/i.test(detail.message);
    return <div className="structure-empty" role="alert"><CircleAlert/><strong>{selected ? `${selected.id} could not be loaded` : "The structure could not be downloaded"}</strong>
      <small>{needsReference ? "The engine numbers residues against the UniProt reference match, and this protein has none yet. Run “Find UniProt matches” in Sequence research, then load the structure again." : sentence(detail.message)}</small>
      <span className="structure-empty-actions"><Button variant="outline" size="sm" onClick={onRetry}><RefreshCw/> Try again</Button>{needsReference && onOpenResearch && <Button variant="outline" size="sm" onClick={onOpenResearch}><Search/> Open Sequence research</Button>}</span></div>;
  }
  if (detail.state === "loading") return <div className="structure-empty" role="status"><LoaderCircle className="spin"/><strong>{selected?.source === "pdb" ? `Downloading ${selected.id} from the PDB…` : "Loading the model…"}</strong><small>Large entries can take a few seconds.</small></div>;
  if (list.state === "loading" && !selected) return <div className="structure-empty" role="status"><LoaderCircle className="spin"/><strong>Finding structures…</strong><small>Checking AlphaFold DB and the PDB for this protein.</small></div>;
  if (!hasChoices) return <div className="structure-empty"><strong>No structure to show yet</strong><small>Search the PDB in Sequence research, enter a PDB ID, or retrieve the AlphaFold DB model.</small>{onOpenResearch && <Button variant="outline" size="sm" onClick={onOpenResearch}><Search/> Open Sequence research</Button>}</div>;
  return <div className="structure-empty"><strong>Choose a structure</strong></div>;
}

function StructureFacts({ entry, hit, loaded }: { entry: StructureEntry; hit: ResearchHit | null; loaded: boolean }) {
  const ligands = entry.ligands.filter((ligand) => ligand.classification === "ligand");
  const ligandIds = [...new Map(ligands.map((ligand) => [ligand.ccdId, ligand.name ?? ""])).entries()];
  const pending = loaded ? "—" : "Shown once loaded";
  return <dl className="structure-facts">
    <dt>Source</dt><dd>{entry.source === "pdb" ? <a href={entry.sourceUrl ?? `https://www.rcsb.org/structure/${entry.id}`} target="_blank" rel="noreferrer">RCSB PDB {entry.id} <ExternalLink/></a> : "AlphaFold DB"}</dd>
    {entry.method && <><dt>Method</dt><dd>{readableMethod(entry.method)}</dd></>}
    {typeof entry.resolutionAngstrom === "number" && <><dt>Resolution</dt><dd>{entry.resolutionAngstrom.toFixed(2)} Å</dd></>}
    {hit && <><dt>Match</dt><dd>{percentText(hit.identity)} identity · {percentText(hit.coverage)} coverage of your sequence</dd></>}
    <dt>Chains</dt><dd>{entry.chains.length ? entry.chains.map((chain) => `${chain.chainId} (${chain.modeledResidueCount}/${chain.residueCount} modelled)`).join(", ") : pending}</dd>
    {entry.source === "pdb" && <><dt>Mapped chains</dt><dd>{entry.mappedChains?.length ? entry.mappedChains.join(", ") : entry.siftsAvailable === false || loaded ? "None mapped to the UniProt reference; regions cannot be placed" : pending}</dd></>}
    <dt>Ligands</dt><dd>{ligandIds.length ? ligandIds.map(([id, name], index) => <span key={id} title={name || undefined}>{index ? ", " : ""}{id}</span>) : entry.chains.length ? "None" : pending}</dd>
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

/** Shown when the engine has no structure endpoints: the saved AlphaFold model, as in older versions. */
function LegacyPreview({ bundle }: { bundle: ProteinBundle }) {
  const model = bundle.alphaFoldModels[0] ?? null;
  const [geometry, setGeometry] = useState<JsonObject | null>(null);
  useEffect(() => { if (!model?.modelId) return; proteinLabsApi.getAlphaFoldModel(bundle.protein.id, text(model.modelId, "")).then((value) => setGeometry(object(value.geometry))).catch(() => undefined); }, [bundle.protein.id, model]);
  return <div className="molecule-stage"><StructureViewer geometry={geometry} paletteKey={bundle.protein.id} confidence label={model ? `${text(model.name, text(model.modelId))} · ${text(geometry?.meanPlddt)} mean pLDDT` : "No AlphaFold model saved"}/></div>;
}

function Notice({ message, error = false }: { message: string; error?: boolean }) { return message ? <div className={`inline-message ${error ? "error" : ""}`}>{error ? <CircleAlert/> : <CircleCheck/>} {message}</div> : null; }
function text(value: unknown, fallback: unknown = "—") { return String(value === null || value === undefined || value === "" ? fallback : value); }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function sentence(value: string) { return /[.!?]$/.test(value.trim()) ? value.trim() : `${value.trim()}.`; }
function errorText(reason: unknown) { return reason instanceof Error ? reason.message : String(reason); }
