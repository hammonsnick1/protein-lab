"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRight, CircleAlert, FlaskConical, LoaderCircle, RefreshCw, TriangleAlert, Wand2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Cite, CiteGroup, ReferenceList } from "@/components/ui/citations";
import { MolstarViewer, type ViewerRegion } from "@/components/protein-labs/molstar-viewer";
import { HmSymbol } from "@/components/protein-labs/space-group-explorer";
import { citationScope, type CitationId } from "@/lib/citations";
import { proteinLabsApi, type JsonObject } from "@/lib/protein-labs-api";
import { structureOptionLabel, type StructureEntry, type ResidueAddress } from "@/lib/structure-regions";
import { clampCutoff, DEFAULT_INTERFACE_CUTOFF, formatCutoff, INTERFACE_CUTOFF_RANGE } from "@/lib/structure-interface";
import { findSpaceGroup, multiplicity, SOHNCKE_GROUPS, type SpaceGroup, type UnitCell } from "@/lib/space-groups";
import {
  analysePacking, CLASH_OVERLAP, confidentAtoms, constrainCell, copyLabel, freeCellFields, HBOND_RANGE, latticeMmcif, LOW_CONFIDENCE_PLDDT, makeLattice, nearbyCopies,
  parseCopyChain, parseMmcif, placeInCell, referenceCopy, suggestCell, unitCellCopies, viewerResidues,
  type AtomPair, type LatticeAtom, type LatticeCopy, type PackingContact, type ParsedStructure,
} from "@/lib/crystal-lattice";
import { CRYSTAL_EXAMPLES, findExample, type CrystalExample } from "@/lib/crystal-examples";
import type { CrystallizePanelProps } from "@/lib/crystallize-panels";

// Every source this panel cites, in first-use order down the page.
const REFERENCES: CitationId[] = [
  "ita2016", "wukovitz1995", "pdb2000", "alphafold2021", "tunyasuvunakool2021", "carugo1997", "bakerhubbard1984", "word1999", "bondi1964",
  "carugo2017", "jeffrey1997", "wwpdb-valsym", "molstar",
  ...CRYSTAL_EXAMPLES.map((example) => example.citation),
];

type Load<T> = { state: "loading" } | { state: "ready"; value: T } | { state: "error"; message: string };
type CellMode = "experimental" | "hypothetical";
type Display = "neighbours" | "cell";
/** "structure:pdb:1ABC", "structure:alphafold_db:AF-…" or "example:1UBQ". */
type SourceKey = string;
type Loaded = { key: SourceKey; label: string; isModel: boolean; parsed: ParsedStructure };

const CELL_FIELDS: { key: keyof UnitCell; label: string; unit: string }[] = [
  { key: "a", label: "a", unit: "Å" }, { key: "b", label: "b", unit: "Å" }, { key: "c", label: "c", unit: "Å" },
  { key: "alpha", label: "α", unit: "°" }, { key: "beta", label: "β", unit: "°" }, { key: "gamma", label: "γ", unit: "°" },
];
// Above this many atoms Mol* is drawn from Cα atoms only, so rotating stays smooth.
const FULL_ATOM_LIMIT = 250_000;
const FALLBACK_GROUP = findSpaceGroup("P 21 21 21")!;

const structureKey = (entry: StructureEntry): SourceKey => `structure:${entry.source}:${entry.id}`;

export function CrystalLatticePanel({ bundle, selectedSpaceGroup: chosenSymbol, selectSpaceGroup, saved, save, onOpenJob }: CrystallizePanelProps) {
  const proteinId = bundle.protein.id;
  const refs = useMemo(() => citationScope("lattice", REFERENCES), []);
  const [saveError, setSaveError] = useState("");
  const persist = useCallback((patch: JsonObject) => { save(patch).then(() => setSaveError("")).catch((reason: unknown) => setSaveError(errorText(reason))); }, [save]);

  // ── Which structure ───────────────────────────────────────────────────────
  const [list, setList] = useState<Load<StructureEntry[]>>({ state: "loading" });
  const [listRun, setListRun] = useState(0);
  useEffect(() => {
    let active = true;
    queueMicrotask(() => { if (active) setList({ state: "loading" }); });
    proteinLabsApi.listStructures(proteinId).then((value) => { if (active) setList({ state: "ready", value: value.structures ?? [] }); })
      .catch((reason: unknown) => { if (active) setList({ state: "error", message: errorText(reason) }); });
    return () => { active = false; };
  }, [proteinId, listRun, bundle.alphaFoldModels.length]);
  const structures = useMemo(() => list.state === "ready" ? list.value : [], [list]);

  const savedSource = typeof saved.source === "string" ? saved.source : null;
  const [choice, setChoice] = useState<SourceKey | null>(null);
  // Default: the saved choice, else the first PDB entry (it has a real cell), else the AlphaFold model.
  const defaultKey = savedSource ?? (structures.find((entry) => entry.source === "pdb") ?? structures[0] ? structureKey(structures.find((entry) => entry.source === "pdb") ?? structures[0]) : null);
  const sourceKey = choice ?? (list.state === "loading" && !savedSource ? null : defaultKey);
  const chooseSource = (key: SourceKey) => { setChoice(key); setSelectedCopy(null); persist({ source: key, cellMode: null, cell: null }); };

  // ── Download and read it ──────────────────────────────────────────────────
  const cache = useRef(new Map<SourceKey, Loaded>());
  const [detail, setDetail] = useState<{ key: SourceKey | null; load: Load<Loaded> }>({ key: null, load: { state: "loading" } });
  const [detailRun, setDetailRun] = useState(0);
  useEffect(() => {
    if (!sourceKey) return;
    const cached = cache.current.get(sourceKey);
    if (cached) { queueMicrotask(() => setDetail({ key: sourceKey, load: { state: "ready", value: cached } })); return; }
    let active = true;
    queueMicrotask(() => { if (active) setDetail({ key: sourceKey, load: { state: "loading" } }); });
    const [kind, ...rest] = sourceKey.split(":");
    const source = kind === "example" ? "pdb" : rest[0] as StructureEntry["source"];
    const id = kind === "example" ? rest[0] : rest.slice(1).join(":");
    proteinLabsApi.getStructure(proteinId, source, id).then((value) => {
      if (!active) return;
      const loaded: Loaded = { key: sourceKey, label: kind === "example" ? `PDB ${id}` : source === "alphafold_db" ? `AlphaFold model ${id}` : `PDB ${id}`, isModel: source === "alphafold_db", parsed: parseMmcif(value.structureText ?? "") };
      cache.current.set(sourceKey, loaded);
      setDetail({ key: sourceKey, load: loaded.parsed.atoms.length ? { state: "ready", value: loaded } : { state: "error", message: "The file holds no protein atoms to pack." } });
    }).catch((reason: unknown) => { if (active) setDetail({ key: sourceKey, load: { state: "error", message: errorText(reason) } }); });
    return () => { active = false; };
  }, [proteinId, sourceKey, detailRun]);
  const loaded = detail.key === sourceKey && detail.load.state === "ready" ? detail.load.value : null;
  const loadState: Load<Loaded> = !sourceKey ? { state: "loading" } : detail.key === sourceKey ? detail.load : { state: "loading" };

  // ── Cell and space group ──────────────────────────────────────────────────
  const fileGroup = loaded?.parsed.spaceGroup ? findSpaceGroup(loaded.parsed.spaceGroup) : null;
  const hasExperimental = Boolean(loaded?.parsed.cell && fileGroup?.sohncke);
  const savedMode = saved.cellMode === "experimental" || saved.cellMode === "hypothetical" ? saved.cellMode : null;
  const cellMode: CellMode = savedMode === "experimental" && !hasExperimental ? "hypothetical" : savedMode ?? (hasExperimental ? "experimental" : "hypothetical");
  const chosenGroup = chosenSymbol ? findSpaceGroup(chosenSymbol) : null;
  const hypotheticalGroup = chosenGroup?.sohncke ? chosenGroup : FALLBACK_GROUP;
  const group: SpaceGroup = cellMode === "experimental" && fileGroup ? fileGroup : hypotheticalGroup;
  const trim = saved.trimLowConfidence !== false;
  const baseAtoms = useMemo(() => {
    if (!loaded) return [];
    const confident = loaded.isModel && trim ? confidentAtoms(loaded.parsed.atoms) : loaded.parsed.atoms;
    return confident.length ? confident : loaded.parsed.atoms;
  }, [loaded, trim]);

  const savedCell = readCell(saved.cell);
  const [suggested, setSuggested] = useState<{ key: string; cell: UnitCell; clashes: number } | null>(null);
  const suggestionKey = `${sourceKey}|${hypotheticalGroup.n}|${trim}`;
  const [suggesting, setSuggesting] = useState(false);
  const runSuggestion = useCallback((persistIt: boolean) => {
    if (!baseAtoms.length) return;
    setSuggesting(true);
    // Let the spinner paint before the search blocks the thread for a moment.
    window.setTimeout(() => {
      const result = suggestCell(baseAtoms, hypotheticalGroup);
      setSuggested({ key: suggestionKey, cell: result.cell, clashes: result.clashes });
      setSuggesting(false);
      if (persistIt) persist({ cell: result.cell });
    }, 30);
  }, [baseAtoms, hypotheticalGroup, suggestionKey, persist]);
  const needsSuggestion = cellMode === "hypothetical" && !savedCell && baseAtoms.length > 0 && suggested?.key !== suggestionKey;
  // A hypothetical cell nobody has set yet starts from a suggestion; the ref stops a second search for the same key.
  const searched = useRef<string | null>(null);
  useEffect(() => {
    if (!needsSuggestion || searched.current === suggestionKey) return;
    searched.current = suggestionKey;
    queueMicrotask(() => runSuggestion(false));
  }, [needsSuggestion, suggestionKey, runSuggestion]);

  const cell: UnitCell | null = cellMode === "experimental" ? loaded?.parsed.cell ?? null
    : savedCell ? constrainCell(savedCell, hypotheticalGroup.system)
    : suggested?.key === suggestionKey ? suggested.cell : null;

  // ── Lattice and packing ───────────────────────────────────────────────────
  const savedCutoff = typeof saved.cutoff === "number" ? clampCutoff(saved.cutoff) : DEFAULT_INTERFACE_CUTOFF;
  const [cutoff, setCutoff] = useState(savedCutoff);
  // The slider moves `cutoffDraft` at once; the analysis (seconds on a large entry) reruns only once it rests.
  const [cutoffDraft, setCutoffDraft] = useState(savedCutoff);
  const cutoffTimer = useRef<number | undefined>(undefined);
  useEffect(() => () => window.clearTimeout(cutoffTimer.current), []);
  const changeCutoff = (value: number) => {
    const next = clampCutoff(value);
    setCutoffDraft(next);
    window.clearTimeout(cutoffTimer.current);
    // Copies are renumbered by the new analysis, so a kept selection would point at another neighbour.
    cutoffTimer.current = window.setTimeout(() => { setCutoff(next); setSelectedCopy(null); persist({ cutoff: next }); }, 350);
  };
  const display: Display = saved.display === "cell" ? "cell" : "neighbours";
  const built = useMemo(() => {
    if (!cell || !baseAtoms.length) return null;
    const lattice = makeLattice(cell, group);
    const atoms = cellMode === "experimental" ? baseAtoms : placeInCell(baseAtoms, cell, group);
    const summary = analysePacking(atoms, nearbyCopies(lattice, atoms, cutoff), cutoff);
    return { lattice, atoms, summary };
  }, [cell, baseAtoms, group, cellMode, cutoff]);

  const [selectedCopy, setSelectedCopy] = useState<number | null>(null);
  const selected = built?.summary.contacts.find((contact) => contact.copy.index === selectedCopy) ?? null;

  const view = useMemo(() => {
    if (!built) return null;
    const copies: LatticeCopy[] = display === "cell" ? unitCellCopies(built.lattice, built.atoms) : [referenceCopy(built.lattice), ...built.summary.contacts.map((contact) => contact.copy)];
    const trace = built.atoms.length * copies.length > FULL_ATOM_LIMIT;
    const atoms = trace ? built.atoms.filter((atom) => atom.name === "CA") : built.atoms;
    return { text: latticeMmcif(atoms, copies, loaded?.label ?? "lattice"), copies: copies.length, trace };
  }, [built, display, loaded?.label]);

  const region: ViewerRegion | null = useMemo(() => selected && display === "neighbours" ? {
    id: `contact-${selected.copy.index}`,
    residues: [...viewerResidues(selected.referenceResidues, 0), ...viewerResidues(selected.mateResidues, selected.copy.index)],
    ligand: null,
  } : null, [selected, display]);

  const pickResidue = (residue: ResidueAddress) => {
    if (!built) return;
    const parsed = parseCopyChain(residue.labelAsymId);
    if (!parsed) return;
    const contacts = built.summary.contacts;
    const match = parsed.copy > 0 ? contacts.find((contact) => contact.copy.index === parsed.copy)
      : contacts.find((contact) => contact.referenceResidues.some((item) => item.chain === parsed.chain && item.seq === residue.labelSeqId));
    if (match) setSelectedCopy(match.copy.index);
  };

  const residueNames = useMemo(() => residueLabeller(baseAtoms), [baseAtoms]);
  const example = sourceKey?.startsWith("example:") ? findExample(sourceKey.slice("example:".length)) : null;

  return <div className="lattice-panel">
    <Explainer refs={refs}/>

    <section className="crystallize-section lattice-source" aria-labelledby="lattice-source-heading">
      <header><h3 id="lattice-source-heading">1 · Choose a structure to pack</h3><small>Use a structure of your own protein, or open a PDB example to see how a known crystal is built. Structures come from your earlier jobs; nothing needs typing in again.</small></header>
      <div className="lattice-source-grid">
        <div className="lattice-own">
          <h4>Your protein</h4>
          {list.state === "loading" ? <p className="crystallize-empty" role="status"><LoaderCircle className="spin"/> Looking up the structures saved with {bundle.protein.name}…</p>
            : list.state === "error" ? <div className="lattice-problem" role="alert"><CircleAlert/><span><strong>The structure list could not be loaded</strong><small>{list.message}</small></span><Button size="sm" variant="outline" onClick={() => setListRun((value) => value + 1)}><RefreshCw/> Try again</Button></div>
            : structures.length ? <div className="lattice-structures" role="radiogroup" aria-label="Structures of your protein">{structures.map((entry) => {
              const key = structureKey(entry);
              return <button key={key} type="button" role="radio" aria-checked={sourceKey === key} className={sourceKey === key ? "active" : ""} onClick={() => chooseSource(key)}>
                <strong>{entry.source === "alphafold_db" ? "AlphaFold model" : `PDB ${entry.id}`}</strong>
                <small>{entry.source === "alphafold_db" ? "Predicted: no crystal, so only a hypothetical cell" : structureOptionLabel(entry).split(" · ").slice(1).join(" · ") || entry.title || "Experimental structure"}</small>
              </button>;
            })}</div>
            : <div className="lattice-problem"><FlaskConical/><span><strong>No structure saved yet</strong><small>Fetch the AlphaFold model or pick PDB entries in the Structure Viewer, or start with an example on the right.</small></span><Button size="sm" variant="outline" onClick={() => onOpenJob("structure")}>Open Structure Viewer <ArrowRight/></Button></div>}
        </div>
        <div className="lattice-examples">
          <h4>Learning examples<CiteGroup scope={refs} ids={["pdb2000"]}/></h4>
          <div role="radiogroup" aria-label="PDB learning examples">{CRYSTAL_EXAMPLES.map((item) => {
            const key = `example:${item.pdbId}`;
            const itemGroup = findSpaceGroup(item.spaceGroup)!;
            return <button key={key} type="button" role="radio" aria-checked={sourceKey === key} className={sourceKey === key ? "active" : ""} onClick={() => chooseSource(key)}>
              <span className="lattice-example-head"><HmSymbol group={itemGroup}/><b>{item.pdbId}</b></span>
              <small>{item.protein} · {item.copiesPerCell} per cell</small>
            </button>;
          })}</div>
        </div>
      </div>
      {example && <ExampleNote example={example} refs={refs}/>}
    </section>

    <section className="crystallize-section lattice-cell" aria-labelledby="lattice-cell-heading" aria-busy={loadState.state === "loading"}>
      <header><h3 id="lattice-cell-heading">2 · Set the unit cell</h3><small>The unit cell is the box that repeats in every direction; the space group says how many copies sit in it and how each one is turned.<Cite scope={refs} id="ita2016"/></small></header>
      {loadState.state === "loading" ? <p className="crystallize-empty" role="status"><LoaderCircle className="spin"/> {sourceKey ? "Downloading the structure…" : "Waiting for a structure."}</p>
        : loadState.state === "error" ? <div className="lattice-problem" role="alert"><CircleAlert/><span><strong>The structure could not be loaded</strong><small>{loadState.message}</small></span>
          {/reference match/i.test(loadState.message) ? <Button size="sm" variant="outline" onClick={() => onOpenJob("reference-match")}>Choose a reference match <ArrowRight/></Button> : <Button size="sm" variant="outline" onClick={() => { if (sourceKey) cache.current.delete(sourceKey); setDetailRun((value) => value + 1); }}><RefreshCw/> Try again</Button>}</div>
        : loaded && <CellControls
          loaded={loaded} cellMode={cellMode} hasExperimental={hasExperimental} fileGroup={fileGroup} group={group} cell={cell}
          chosenGroup={chosenGroup} suggesting={suggesting} suggestedClashes={suggested?.key === suggestionKey && !savedCell ? suggested.clashes : null}
          trim={trim} trimmed={loaded.parsed.atoms.length - baseAtoms.length} refs={refs}
          onMode={(mode) => { setSelectedCopy(null); persist({ cellMode: mode }); }}
          onGroup={(symbol) => { setSelectedCopy(null); persist({ cell: null }); void selectSpaceGroup(symbol); }}
          onUseFileGroup={() => fileGroup && void selectSpaceGroup(fileGroup.hm)}
          onCell={(next) => { setSelectedCopy(null); persist({ cell: next }); }}
          onSuggest={() => { setSelectedCopy(null); runSuggestion(true); }}
          onTrim={(value) => { setSelectedCopy(null); persist({ trimLowConfidence: value, cell: null }); }}
        />}
    </section>

    {loaded && <section className="lattice-stage" aria-label="Lattice and packing">
      <div className="lattice-viewer-panel">
        <header>
          <h3>3 · The lattice in 3D</h3>
          <div className="sg-mode lattice-display" role="radiogroup" aria-label="What to draw">
            {(["neighbours", "cell"] as const).map((value) => <button key={value} type="button" role="radio" aria-checked={display === value} className={display === value ? "active" : ""} onClick={() => persist({ display: value })}>{value === "neighbours" ? "Molecule and its neighbours" : "One unit cell"}</button>)}
          </div>
          <small>{view ? `${view.copies} ${view.copies === 1 ? "copy" : "copies"} · ${display === "neighbours" ? "the molecule plus every copy that touches it" : `the ${multiplicity(group)} copies that fill one cell`}${view.trace ? " · drawn from Cα atoms only to keep the view smooth" : ""}. Each copy has its own colour; chain “A-3” is copy 3 of chain A.` : "Building the lattice…"}<Cite scope={refs} id="molstar"/></small>
        </header>
        <div className="molecule-stage lattice-molecule">
          {view ? <MolstarViewer structureText={view.text} label={`${loaded.label} · ${group.hm}${cellMode === "hypothetical" ? " (hypothetical)" : ""}`} palette="protein-lab" region={region} controlsHost={null} onResiduePick={pickResidue}/>
            : <div className="structure-empty" role="status"><LoaderCircle className="spin"/><strong>{suggesting ? "Searching for a cell that fits…" : "Building the lattice…"}</strong></div>}
        </div>
      </div>
      <PackingPanel built={built} cutoff={cutoff} cutoffDraft={cutoffDraft} hypothetical={cellMode === "hypothetical"} refs={refs} selected={selected} names={residueNames}
        onCutoff={changeCutoff}
        onSelect={(index) => { setSelectedCopy(index); if (display !== "neighbours") persist({ display: "neighbours" }); }}/>
    </section>}

    {saveError && <p className="lattice-save-error" role="alert"><CircleAlert/> Your lattice settings could not be saved: {saveError}</p>}
    <ReferenceList scope={refs} className="crystallize-references"/>
  </div>;
}

// ── Plain-language introduction ─────────────────────────────────────────────

function Explainer({ refs }: { refs: ReturnType<typeof citationScope> }) {
  return <section className="crystallize-explainer" aria-labelledby="lattice-explainer-heading">
    <h3 id="lattice-explainer-heading">How proteins pack in a crystal</h3>
    <div>
      <div>
        <h4>The building blocks</h4>
        <p>A crystal is one small box, the <b>unit cell</b>, repeated millions of times in every direction. Inside it, the <b>space group</b> makes copies of the molecule by turning it about axes and sliding it along them.<Cite scope={refs} id="ita2016"/> The part that is copied, one molecule or a few, is the <b>asymmetric unit</b>; the deposited PDB file holds exactly that.</p>
        <p>Some groups are far more common for proteins than others: P 2₁2₁2₁ and P 2₁ lead because screw axes let molecules pack without needing a perfectly matched patch on each side.<Cite scope={refs} id="wukovitz1995"/></p>
      </div>
      <div>
        <h4>Why packing matters</h4>
        <ul>
          <li>Every copy touches its neighbours only through small patches of surface, the <b>crystal contacts</b>. They are usually smaller and weaker than the interfaces that hold real complexes together.<Cite scope={refs} id="carugo1997"/></li>
          <li>A few hydrogen bonds or salt bridges at each contact hold the lattice together.<Cite scope={refs} id="bakerhubbard1984"/> Loops and tags that flop about on the surface can stop those contacts forming.</li>
          <li>Two atoms cannot overlap: if copies clash, that cell or arrangement is impossible.<Cite scope={refs} id="word1999"/></li>
        </ul>
      </div>
    </div>
  </section>;
}

function ExampleNote({ example, refs }: { example: CrystalExample; refs: ReturnType<typeof citationScope> }) {
  return <p className="xtal-callout lattice-example-note"><FlaskConical aria-hidden="true"/><span><b>{example.protein}, PDB {example.pdbId}.</b> {example.lesson}<Cite scope={refs} id={example.citation}/>{example.spaceGroup === "P 21 21 21" || example.spaceGroup === "P 1 21 1" ? <Cite scope={refs} id="wukovitz1995"/> : null}</span></p>;
}

// ── Cell controls ───────────────────────────────────────────────────────────

type CellControlsProps = {
  loaded: Loaded; cellMode: CellMode; hasExperimental: boolean; fileGroup: SpaceGroup | null; group: SpaceGroup; cell: UnitCell | null;
  chosenGroup: SpaceGroup | null; suggesting: boolean; suggestedClashes: number | null; trim: boolean; trimmed: number; refs: ReturnType<typeof citationScope>;
  onMode(mode: CellMode): void; onGroup(symbol: string): void; onUseFileGroup(): void; onCell(cell: UnitCell): void; onSuggest(): void; onTrim(value: boolean): void;
};

function CellControls({ loaded, cellMode, hasExperimental, fileGroup, group, cell, chosenGroup, suggesting, suggestedClashes, trim, trimmed, refs, onMode, onGroup, onUseFileGroup, onCell, onSuggest, onTrim }: CellControlsProps) {
  const [draft, setDraft] = useState<Partial<Record<keyof UnitCell, string>>>({});
  const free = freeCellFields(group.system);
  const valueOf = (key: keyof UnitCell) => draft[key] ?? (cell ? String(cell[key]) : "");
  const parsedDraft = cell ? Object.fromEntries(CELL_FIELDS.map(({ key }) => [key, Number(valueOf(key))])) as UnitCell : null;
  const draftValid = parsedDraft && free.every((key) => Number.isFinite(parsedDraft[key]) && (key.length === 1 ? parsedDraft[key] >= 10 && parsedDraft[key] <= 1000 : parsedDraft[key] > 30 && parsedDraft[key] < 150));
  const dirty = Object.keys(draft).length > 0;
  const apply = () => { if (parsedDraft && draftValid) { onCell(constrainCell(parsedDraft, group.system)); setDraft({}); } };
  const whyNoExperimental = loaded.isModel ? "An AlphaFold model was never crystallised, so it has no cell." : !loaded.parsed.cell ? "This entry was not solved by X-ray crystallography, so its file has no real cell." : fileGroup && !fileGroup.sohncke ? `The file names ${fileGroup.hm}, which protein crystals cannot adopt.` : "The file names no space group this app can read.";

  return <div className="lattice-cell-body">
    <div className="sg-mode lattice-mode" role="radiogroup" aria-label="Kind of unit cell">
      <button type="button" role="radio" aria-checked={cellMode === "experimental"} className={cellMode === "experimental" ? "active" : ""} disabled={!hasExperimental} title={hasExperimental ? undefined : whyNoExperimental} onClick={() => onMode("experimental")}>Experimental cell</button>
      <button type="button" role="radio" aria-checked={cellMode === "hypothetical"} className={cellMode === "hypothetical" ? "active" : ""} onClick={() => onMode("hypothetical")}>Hypothetical cell</button>
    </div>

    {cellMode === "experimental" && cell && fileGroup ? <div className="lattice-banner experimental" role="note">
      <strong>Experimental crystal · {loaded.label}</strong>
      <span>The cell and space group were measured by X-ray diffraction and stored in the PDB file{"'"}s cell record (CRYST1).<Cite scope={refs} id="pdb2000"/> The copies you see are where the molecules really sat.</span>
      <dl className="lattice-cell-values"><div><dt>Space group</dt><dd><HmSymbol group={fileGroup}/></dd></div>{CELL_FIELDS.map(({ key, label, unit }) => <div key={key}><dt>{label}</dt><dd>{cell[key].toFixed(key.length === 1 ? 2 : 1)} {unit}</dd></div>)}</dl>
      {chosenGroup?.n !== fileGroup.n && <Button size="sm" variant="outline" onClick={onUseFileGroup}>Use {fileGroup.hm} in the space-group selector</Button>}
    </div> : <div className="lattice-banner hypothetical" role="note">
      <strong><TriangleAlert aria-hidden="true"/> HYPOTHETICAL cell · not an experimental crystal</strong>
      <span>You chose the space group and cell; nobody has grown this crystal. Use it to see how a group arranges copies and whether they would fit, not as a prediction.{!hasExperimental && <> {whyNoExperimental}</>}</span>
    </div>}

    {cellMode === "hypothetical" && <div className="lattice-hypothetical">
      <label className="lab-field lattice-group">
        <span>Space group (one of the 65 a protein can adopt)</span>
        <select value={group.hm} onChange={(event) => onGroup(event.target.value)}>
          {SOHNCKE_GROUPS.map((item) => <option key={item.n} value={item.hm}>{item.hm} · No. {item.n} · {item.system}</option>)}
        </select>
        <small>{chosenGroup && !chosenGroup.sohncke ? `${chosenGroup.hm} from the space-group tab mirrors the protein, so ${FALLBACK_GROUP.hm} is used here instead.` : `Shared with the Space groups tab. ${multiplicity(group)} copies per cell.`}</small>
      </label>
      <fieldset className="lattice-cell-fields">
        <legend>Cell edges and angles <small>({group.system}: {free.length < 6 ? `${CELL_FIELDS.filter(({ key }) => !free.includes(key)).map(({ label }) => label).join(", ")} follow from the rest` : "all six are free"})</small></legend>
        {CELL_FIELDS.map(({ key, label, unit }) => <label key={key} className={free.includes(key) ? "" : "locked"}>
          <span>{label}</span>
          <input type="number" inputMode="decimal" step={key.length === 1 ? 0.5 : 1} value={free.includes(key) ? valueOf(key) : cell ? String(constrainCell({ ...cell, ...(parsedDraft ?? {}) }, group.system)[key]) : ""} disabled={!free.includes(key) || !cell}
            onChange={(event) => setDraft((current) => ({ ...current, [key]: event.target.value }))} onKeyDown={(event) => { if (event.key === "Enter") apply(); }} aria-label={`${label} in ${unit === "Å" ? "ångström" : "degrees"}`}/>
          <small>{unit}</small>
        </label>)}
      </fieldset>
      <div className="lattice-cell-actions">
        <Button size="sm" disabled={!dirty || !draftValid} onClick={apply}>Build this cell</Button>
        {dirty && <Button size="sm" variant="ghost" onClick={() => setDraft({})}>Undo edits</Button>}
        <Button size="sm" variant="outline" disabled={suggesting} onClick={onSuggest}>{suggesting ? <LoaderCircle className="spin"/> : <Wand2/>} Suggest a cell that fits</Button>
        <small>{dirty && !draftValid ? "Edges must be 10–1000 Å and angles 30–150°." : suggestedClashes === 0 ? "The suggested cell is the smallest the search found with no clashes." : suggestedClashes ? `Even the largest cell tried still has ${suggestedClashes} clashes.` : "Edit the free values and build, or let the app search for a cell."}</small>
      </div>
      {loaded.isModel && <label className="lattice-trim"><input type="checkbox" checked={trim} onChange={(event) => onTrim(event.target.checked)}/>
        <span>Leave out residues AlphaFold is unsure of (pLDDT below {LOW_CONFIDENCE_PLDDT})<CiteGroup scope={refs} ids={["alphafold2021", "tunyasuvunakool2021"]}/>{trimmed > 0 && trim ? ` · ${trimmed} atoms left out` : ""}. Floppy ends would otherwise swell the cell; they are often trimmed from crystallisation constructs for the same reason.</span>
      </label>}
    </div>}
  </div>;
}

// ── Packing analysis ────────────────────────────────────────────────────────

type Built = { atoms: LatticeAtom[]; summary: ReturnType<typeof analysePacking> } | null;

function PackingPanel({ built, cutoff, cutoffDraft, hypothetical, refs, selected, names, onCutoff, onSelect }: { built: Built; cutoff: number; cutoffDraft: number; hypothetical: boolean; refs: ReturnType<typeof citationScope>; selected: PackingContact | null; names: ResidueLabeller; onCutoff(value: number): void; onSelect(index: number): void }) {
  if (!built) return <div className="lattice-packing"><p className="crystallize-empty" role="status"><LoaderCircle className="spin"/> Measuring contacts…</p></div>;
  const { totals, contacts } = built.summary;
  return <div className="lattice-packing">
    <header><h3>4 · Packing analysis</h3><small>Measured between the molecule and each copy, on heavy atoms only (no hydrogens, waters or ligands). Click a row, or a residue in 3D, to highlight both sides of that contact.</small></header>
    <dl className="lattice-counts">
      <div><dt>Neighbours touching</dt><dd>{totals.neighbours}</dd></div>
      <div><dt>Residue contacts<Cite scope={refs} id="carugo1997"/></dt><dd>{totals.residuePairs}</dd></div>
      <div><dt>Possible H-bonds<Cite scope={refs} id="bakerhubbard1984"/></dt><dd>{totals.hbonds}</dd></div>
      <div className={totals.clashes ? "bad" : ""}><dt>Clashes<CiteGroup scope={refs} ids={["word1999", "bondi1964"]}/></dt><dd>{totals.clashes}</dd></div>
      <div><dt>Interface residues</dt><dd>{totals.interfaceResidues}</dd></div>
    </dl>
    <label className="lattice-cutoff"><span>Contact distance <b>{formatCutoff(cutoffDraft)}</b>{cutoffDraft !== cutoff && <small role="status"> · measuring…</small>}</span>
      <input type="range" min={INTERFACE_CUTOFF_RANGE.min} max={INTERFACE_CUTOFF_RANGE.max} step={INTERFACE_CUTOFF_RANGE.step} value={cutoffDraft} aria-valuetext={formatCutoff(cutoffDraft)} onChange={(event) => onCutoff(Number(event.target.value))}/>
    </label>
    <p className="crystallize-note">A <b>contact</b> is any pair of atoms closer than the contact distance ({formatCutoff(DEFAULT_INTERFACE_CUTOFF)} unless you change it).<Cite scope={refs} id="carugo2017"/> A <b>possible H-bond</b> is a nitrogen and an oxygen {HBOND_RANGE.min}–{HBOND_RANGE.max} Å apart, close enough to share a hydrogen; the geometry is not checked further.<CiteGroup scope={refs} ids={["jeffrey1997", "bakerhubbard1984"]}/> A <b>clash</b> is two atoms whose van der Waals spheres overlap by {CLASH_OVERLAP} Å or more,<CiteGroup scope={refs} ids={["word1999", "bondi1964"]}/> or N/O atoms closer than {HBOND_RANGE.min} Å, the limit below which the PDB flags any two atoms in neighbouring copies.<Cite scope={refs} id="wwpdb-valsym"/>{!hypothetical && contacts.some((contact) => contact.clashes.length) ? " In a real crystal a few clashes usually mean a side chain with two positions, a short salt bridge, or an atom the file models only partly." : ""}</p>
    {hypothetical && totals.clashes > 0 && <p className="xtal-callout warning"><TriangleAlert aria-hidden="true"/><span>{totals.clashes} clashing atom pairs: copies overlap, so no real crystal could have this cell. Make the cell bigger or let the app suggest one.</span></p>}
    {contacts.length ? <div className="lattice-table-wrap"><table className="crystallize-groups lattice-contacts">
      <thead><tr><th scope="col">Copy</th><th scope="col">How it is made</th><th scope="col" className="num">Residue pairs</th><th scope="col" className="num">H-bonds</th><th scope="col" className="num">Clashes</th><th scope="col" className="num">Closest</th></tr></thead>
      <tbody>{contacts.map((contact) => <tr key={contact.copy.index} className={selected?.copy.index === contact.copy.index ? "selected" : ""} aria-selected={selected?.copy.index === contact.copy.index} onClick={() => onSelect(contact.copy.index)}>
        <th scope="row"><button type="button" ref={selected?.copy.index === contact.copy.index ? revealRow : undefined} onClick={(event) => { event.stopPropagation(); onSelect(contact.copy.index); }} aria-label={`Highlight contact with copy ${contact.copy.index}`}>{contact.copy.index}</button></th>
        <td>{copyLabel(contact.copy)}<small><code>{contact.copy.triplet}</code></small></td>
        <td className="num">{contact.residuePairs}</td>
        <td className="num">{contact.hbonds.length}</td>
        <td className={`num ${contact.clashes.length ? "bad" : ""}`}>{contact.clashes.length}</td>
        <td className="num">{contact.minDistance.toFixed(1)} Å</td>
      </tr>)}</tbody>
    </table></div> : <p className="crystallize-empty">No copy comes within {formatCutoff(cutoff)}. The molecules float apart, so this cell is too big to hold a crystal together.</p>}
    {selected && <ContactDetail contact={selected} atoms={built.atoms} names={names}/>}
  </div>;
}

function ContactDetail({ contact, atoms, names }: { contact: PackingContact; atoms: LatticeAtom[]; names: ResidueLabeller }) {
  const pair = (item: AtomPair) => `${names.atom(atoms[item.reference])} ··· ${names.atom(atoms[item.mate])}′ ${item.distance.toFixed(2)} Å`;
  return <div className="lattice-detail" aria-live="polite">
    <h4>Contact with copy {contact.copy.index}</h4>
    <p><b>This molecule:</b> {contact.referenceResidues.map((residue) => names.residue(residue.chain, residue.seq)).join(", ") || "—"}</p>
    <p><b>Copy {contact.copy.index} (′):</b> {contact.mateResidues.map((residue) => names.residue(residue.chain, residue.seq)).join(", ") || "—"}</p>
    {contact.hbonds.length > 0 && <p><b>Possible H-bonds:</b> {contact.hbonds.slice(0, 6).map(pair).join("; ")}{contact.hbonds.length > 6 ? `; and ${contact.hbonds.length - 6} more` : ""}</p>}
    {contact.clashes.length > 0 && <p className="bad"><b>Clashes:</b> {contact.clashes.slice(0, 6).map(pair).join("; ")}{contact.clashes.length > 6 ? `; and ${contact.clashes.length - 6} more` : ""}</p>}
  </div>;
}

// ── Helpers ─────────────────────────────────────────────────────────────────

/** A contact picked in 3D may sit below the table's fold; bring its row into view without moving the page. */
function revealRow(element: HTMLElement | null) {
  element?.closest("tr")?.scrollIntoView({ block: "nearest" });
}

type ResidueLabeller = { residue(chain: string, seq: number): string; atom(atom: LatticeAtom): string };

function residueLabeller(atoms: readonly LatticeAtom[]): ResidueLabeller {
  const byKey = new Map<string, LatticeAtom>();
  for (const atom of atoms) { const key = `${atom.chain}:${atom.seq}`; if (!byKey.has(key)) byKey.set(key, atom); }
  const chains = new Set(atoms.map((atom) => atom.authChain));
  const label = (atom: LatticeAtom) => `${titleCase(atom.comp)} ${atom.authSeq}${atom.insCode}${chains.size > 1 ? ` (${atom.authChain})` : ""}`;
  return {
    residue: (chain, seq) => { const atom = byKey.get(`${chain}:${seq}`); return atom ? label(atom) : `${chain} ${seq}`; },
    atom: (atom) => `${label(atom)} ${atom.name}`,
  };
}

const titleCase = (comp: string) => comp.length === 3 ? comp[0] + comp.slice(1).toLowerCase() : comp;

function readCell(value: unknown): UnitCell | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const keys: (keyof UnitCell)[] = ["a", "b", "c", "alpha", "beta", "gamma"];
  return keys.every((key) => typeof record[key] === "number" && Number.isFinite(record[key])) ? Object.fromEntries(keys.map((key) => [key, record[key]])) as UnitCell : null;
}

function errorText(reason: unknown) {
  const text = reason instanceof Error ? reason.message : String(reason);
  if (/No saved UniProt reference match/i.test(text)) return "PDB files are downloaded through this project's UniProt reference match, and none is chosen yet. Choose one, then try again.";
  return /endpoint not found/i.test(text) ? "This version of the local engine cannot serve structures. Update Protein Labs, then try again." : text;
}
