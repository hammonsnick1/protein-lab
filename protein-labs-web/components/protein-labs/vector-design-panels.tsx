"use client";

import { useState } from "react";
import { CircleAlert, FlaskConical, LoaderCircle, Plus, RefreshCw, Scissors, Trash2, WandSparkles, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { EnzymeRow, GelResult, JsonObject } from "@/lib/protein-labs-api";
import type { CheckedPrimer } from "@/lib/vector-editor-state";
import type { SeqRange } from "@/lib/vector-geometry";
import { formatRange, rangeLength } from "@/lib/vector-geometry";

/** Commercially common enzymes analysed by default — the set a cloning bench actually stocks. */
export const ANALYSED_ENZYMES = [
  "AatII", "AgeI", "ApaI", "AscI", "AvrII", "BamHI", "BbsI", "BglII", "BsaI", "BsiWI", "BsmBI", "BspEI", "BsrGI",
  "ClaI", "EagI", "EcoRI", "EcoRV", "FseI", "HindIII", "HpaI", "KpnI", "MfeI", "MluI", "NcoI", "NdeI", "NheI",
  "NotI", "NsiI", "PacI", "PmeI", "PstI", "PvuI", "SacI", "SacII", "SalI", "SbfI", "ScaI", "SmaI", "SpeI", "SphI",
  "StuI", "SwaI", "XbaI", "XhoI", "XmaI",
];

export type EnzymeGroup = "unique" | "two" | "mcs" | "absent" | "all";
export const ENZYME_GROUPS: { id: EnzymeGroup; label: string; hint: string }[] = [
  { id: "unique", label: "Unique cutters", hint: "Cut the construct exactly once — the sites you can clone into." },
  { id: "two", label: "Two-cutters", hint: "Cut twice — useful to drop out a fragment or check an insert." },
  { id: "mcs", label: "At the MCS", hint: "Unique cutters in or right beside the multiple cloning site — the usual cloning pair." },
  { id: "absent", label: "Absent from insert", hint: "Do not cut the insert, so they are safe for directional cloning." },
  { id: "all", label: "All analysed", hint: "Every enzyme checked, including those that do not cut." },
];

export function enzymeInGroup(row: EnzymeRow, group: EnzymeGroup) {
  if (group === "unique") return row.uniqueCutter;
  if (group === "two") return row.twoCutter;
  if (group === "mcs") return row.mcsFlanking;
  if (group === "absent") return row.absentFromInsert && row.cutCount > 0;
  return true;
}

/**
 * Choose enzymes by what they do to this construct, not by name. Every row
 * says where it cuts, what end it leaves and which suppliers stock it.
 */
export function EnzymeChooser({ rows, loading, error, insertChecked, onInsertCheck, onReload, chosen, onChosen, onFocus, onDigest }: {
  rows: EnzymeRow[] | null; loading: boolean; error: string; insertChecked: boolean;
  onInsertCheck: (value: boolean) => void; onReload: () => void;
  chosen: string[]; onChosen: (names: string[]) => void; onFocus: (row: EnzymeRow) => void; onDigest: (names: string[]) => void;
}) {
  const [group, setGroup] = useState<EnzymeGroup>("unique");
  const [query, setQuery] = useState("");
  const visible = (rows ?? []).filter((row) => enzymeInGroup(row, group) && row.enzyme.toLowerCase().includes(query.toLowerCase()));
  const counts = Object.fromEntries(ENZYME_GROUPS.map((entry) => [entry.id, (rows ?? []).filter((row) => enzymeInGroup(row, entry.id)).length]));
  const toggle = (name: string) => onChosen(chosen.includes(name) ? chosen.filter((value) => value !== name) : [...chosen, name]);
  return <div className="venz">
    <div className="venz-head">
      <div className="venz-groups" role="tablist" aria-label="Enzyme groups">
        {ENZYME_GROUPS.map((entry) => <button key={entry.id} role="tab" aria-selected={group === entry.id} className={group === entry.id ? "active" : ""} title={entry.hint} onClick={() => setGroup(entry.id)}>
          {entry.label}<b>{rows ? counts[entry.id] : "–"}</b>
        </button>)}
      </div>
      <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Filter by name" aria-label="Filter enzymes by name" />
      <label className="venz-check"><input type="checkbox" checked={insertChecked} onChange={(event) => onInsertCheck(event.target.checked)} />Check against the project protein&apos;s insert</label>
      <Button size="sm" variant="ghost" onClick={onReload} disabled={loading}>{loading ? <LoaderCircle className="spin" /> : <RefreshCw />} Reanalyse</Button>
    </div>
    <p className="venz-hint">{ENZYME_GROUPS.find((entry) => entry.id === group)?.hint}</p>
    {error && <div className="vpanel-error"><CircleAlert /><span>{error}</span><Button size="sm" variant="outline" onClick={onReload}>Retry</Button></div>}
    {loading && !rows && <div className="vpanel-loading"><LoaderCircle className="spin" /> Analysing {ANALYSED_ENZYMES.length} enzymes against the construct…</div>}
    {rows && !visible.length && <div className="vpanel-empty">No enzyme in this group{query ? ` matches “${query}”` : ""}.{group === "mcs" ? " The construct has no annotated or detectable MCS." : ""}{group === "absent" && !insertChecked ? " Tick “check against the insert” first." : ""}</div>}
    {rows && visible.length > 0 && <div className="venz-table" role="table">
      <div className="venz-row head" role="row"><span /><b>Enzyme</b><b>Site</b><b>Cuts at</b><b>Ends</b><b>Notes</b></div>
      {visible.map((row) => <div key={row.enzyme} className={`venz-row${chosen.includes(row.enzyme) ? " chosen" : ""}`} role="row">
        <input type="checkbox" checked={chosen.includes(row.enzyme)} onChange={() => toggle(row.enzyme)} aria-label={`Choose ${row.enzyme}`} />
        <button type="button" className="venz-name" onClick={() => onFocus(row)} disabled={!row.cutCount} title={row.cutCount ? "Show this site on the maps" : "Does not cut"}>{row.enzyme}</button>
        <code>{row.recognitionSite}</code>
        <span>{row.cutCount ? row.cutPositions.map((position) => position.toLocaleString()).join(", ") : "does not cut"}</span>
        <span>{row.end.polarity === "blunt" ? "blunt" : `${row.end.polarity === "5-prime" ? "5′" : "3′"} ${row.end.sequence}`}</span>
        <span className="venz-notes">
          {row.insertCutCount > 0 && <em className="warn">cuts insert ×{row.insertCutCount}</em>}
          {row.methylationSensitive.length > 0 && <em title="Blocked by this methylation in dam+/dcm+ E. coli">{row.methylationSensitive.join("/")}-sensitive</em>}
          <em title={row.suppliers.join(", ")}>{row.suppliers.length} supplier{row.suppliers.length === 1 ? "" : "s"}</em>
        </span>
      </div>)}
    </div>}
    <footer className="venz-foot">
      <span>{chosen.length ? `Chosen: ${chosen.join(", ")}` : "Tick enzymes to show only them on the maps and to digest."}</span>
      {chosen.length > 0 && <Button size="sm" variant="ghost" onClick={() => onChosen([])}><X /> Clear</Button>}
      <Button size="sm" disabled={!chosen.length} onClick={() => onDigest(chosen)}><Scissors /> Digest and run gel</Button>
    </footer>
  </div>;
}

// ---------------------------------------------------------------------------
// Gel
// ---------------------------------------------------------------------------

export type GelLaneRequest = { id: string; name: string; enzymeNames: string[] };

/**
 * An in-silico agarose gel. Migration follows the engine's model (distance
 * proportional to −log₁₀ bp); band intensity follows relative mass.
 */
export function GelPanel({ lanes, onLanes, result, loading, error, ladder, onLadder, onRun }: {
  lanes: GelLaneRequest[]; onLanes: (lanes: GelLaneRequest[]) => void; result: GelResult | null; loading: boolean; error: string;
  ladder: "1kb" | "100bp"; onLadder: (ladder: "1kb" | "100bp") => void; onRun: () => void;
}) {
  return <div className="vgel">
    <div className="vgel-controls">
      <label>Ladder<select value={ladder} onChange={(event) => onLadder(event.target.value as "1kb" | "100bp")}><option value="1kb">1 kb ladder</option><option value="100bp">100 bp ladder</option></select></label>
      <div className="vgel-lanes">
        {lanes.map((lane, index) => <span key={lane.id}><b>{index + 1}</b>{lane.name}<button type="button" aria-label={`Remove lane ${lane.name}`} onClick={() => onLanes(lanes.filter((value) => value.id !== lane.id))}><Trash2 /></button></span>)}
        {!lanes.length && <small>Choose enzymes and press “Digest and run gel”, or add an uncut lane.</small>}
      </div>
      <Button size="sm" variant="outline" onClick={() => onLanes([...lanes, { id: `lane-${Date.now()}`, name: "Uncut", enzymeNames: [] }])}><Plus /> Uncut lane</Button>
      <Button size="sm" disabled={!lanes.length || loading} onClick={onRun}>{loading ? <LoaderCircle className="spin" /> : <FlaskConical />} Run gel</Button>
    </div>
    {error && <div className="vpanel-error"><CircleAlert /><span>{error}</span><Button size="sm" variant="outline" onClick={onRun}>Retry</Button></div>}
    {result ? <GelImage result={result} /> : !error && <div className="vpanel-empty">{loading ? "Running the gel…" : "No gel run yet."}</div>}
  </div>;
}

export function GelImage({ result }: { result: GelResult }) {
  const sizes = result.lanes.flatMap((lane) => lane.bands.map((band) => band.sizeBp));
  const max = Math.max(10000, ...sizes) * 1.15, min = Math.max(50, Math.min(...sizes) * 0.8);
  const laneWidth = 54, gap = 14, left = 64, top = 34, height = 340;
  const width = left + result.lanes.length * (laneWidth + gap) + 20;
  const yOf = (bp: number) => top + ((Math.log10(max) - Math.log10(bp)) / (Math.log10(max) - Math.log10(min))) * height;
  const ladder = result.lanes.find((lane) => lane.kind === "ladder");
  return <figure className="vgel-figure">
    <svg viewBox={`0 0 ${width} ${top + height + 24}`} width={width} role="img" aria-label="Simulated agarose gel">
      <rect x={left - 8} y={top - 16} width={width - left - 4} height={height + 28} rx={6} className="vgel-slab" />
      {ladder?.bands.map((band) => <text key={band.sizeBp} x={left - 14} y={yOf(band.sizeBp) + 3} textAnchor="end" className="vgel-size">{band.sizeBp >= 1000 ? `${band.sizeBp / 1000} kb` : `${band.sizeBp}`}</text>)}
      {result.lanes.map((lane, index) => {
        const x = left + index * (laneWidth + gap);
        const strongest = Math.max(...lane.bands.map((band) => band.relativeMass), 0.0001);
        return <g key={lane.id}>
          <rect x={x} y={top - 12} width={laneWidth} height={5} className="vgel-well" />
          <text x={x + laneWidth / 2} y={top - 18} textAnchor="middle" className="vgel-lane">{index === 0 ? "L" : index}</text>
          {lane.bands.map((band, bandIndex) => <rect key={bandIndex} x={x + 3} y={yOf(band.sizeBp) - 2} width={laneWidth - 6} height={4} rx={1.5} className="vgel-band" style={{ opacity: lane.kind === "ladder" ? 0.75 : 0.3 + 0.7 * Math.sqrt(band.relativeMass / strongest) }}><title>{`${band.sizeBp.toLocaleString()} bp`}</title></rect>)}
        </g>;
      })}
    </svg>
    <figcaption>
      <ol start={0}>{result.lanes.map((lane) => <li key={lane.id}><b>{lane.name}</b>{lane.kind === "sample" && <span>{lane.bands.length ? lane.bands.map((band) => band.sizeBp.toLocaleString()).join(", ") + " bp" : "no fragments"}</span>}</li>)}</ol>
      <small>Simulated: {result.migrationModel}. Supercoiled and nicked forms of uncut plasmid are not modelled.</small>
    </figcaption>
  </figure>;
}

// ---------------------------------------------------------------------------
// Primers
// ---------------------------------------------------------------------------

const METHODS: { id: string; label: string; hint: string }[] = [
  { id: "pcr", label: "Plain PCR", hint: "Annealing sequence only." },
  { id: "restriction", label: "Restriction cloning", hint: "Add a site plus a few clamp bases to each 5′ end." },
  { id: "gibson", label: "Gibson", hint: "15–40 nt overlaps with the neighbouring fragment." },
  { id: "in-fusion", label: "In-Fusion", hint: "15–40 nt overlaps with the linearised vector ends." },
  { id: "gateway", label: "Gateway (attB)", hint: "attB1/attB2 are added automatically." },
];

export type PrimerSettings = { name: string; targetTm: number; minLength: number; maxLength: number; minGc: number; maxGc: number; method: string; forwardOverhang: string; reverseOverhang: string };
export const defaultPrimerSettings: PrimerSettings = { name: "Insert PCR", targetTm: 60, minLength: 18, maxLength: 30, minGc: 40, maxGc: 60, method: "pcr", forwardOverhang: "", reverseOverhang: "" };

export function PrimerPanel({ settings, onSettings, region, length, designed, saved, loading, error, onDesign, onRemove, onFocus }: {
  settings: PrimerSettings; onSettings: (settings: PrimerSettings) => void; region: SeqRange | null; length: number;
  designed: CheckedPrimer[]; saved: JsonObject[]; loading: boolean; error: string; onDesign: () => void; onRemove: (id: string) => void; onFocus: (range: SeqRange) => void;
}) {
  const set = (patch: Partial<PrimerSettings>) => onSettings({ ...settings, ...patch });
  const method = METHODS.find((entry) => entry.id === settings.method) ?? METHODS[0];
  const regionSize = region ? rangeLength(region, length) : 0;
  const needsOverlap = settings.method === "gibson" || settings.method === "in-fusion";
  return <div className="vprimer">
    <section className="vprimer-form">
      <div className="vprimer-region">
        <span>Amplify</span>
        <b>{regionSize ? `${formatRange(region!, length)} · ${regionSize.toLocaleString()} bp` : "Select a region on any view"}</b>
        {region && region.end < region.start && <small className="warn">Origin-spanning regions are not supported yet; select the region on one side of the origin.</small>}
      </div>
      <label>Pair name<input value={settings.name} onChange={(event) => set({ name: event.target.value })} /></label>
      <label>Target Tm (°C)<input type="number" min={45} max={75} step={0.5} value={settings.targetTm} onChange={(event) => set({ targetTm: Number(event.target.value) })} /></label>
      <label>Length (nt)<span className="vprimer-pair"><input type="number" min={15} max={60} value={settings.minLength} onChange={(event) => set({ minLength: Number(event.target.value) })} />–<input type="number" min={15} max={60} value={settings.maxLength} onChange={(event) => set({ maxLength: Number(event.target.value) })} /></span></label>
      <label>GC (%)<span className="vprimer-pair"><input type="number" min={0} max={100} value={settings.minGc} onChange={(event) => set({ minGc: Number(event.target.value) })} />–<input type="number" min={0} max={100} value={settings.maxGc} onChange={(event) => set({ maxGc: Number(event.target.value) })} /></span></label>
      <label className="wide">Cloning method<select value={settings.method} onChange={(event) => set({ method: event.target.value })}>{METHODS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select><small>{method.hint}</small></label>
      {settings.method !== "pcr" && <>
        <label className="wide">Forward 5′ {settings.method === "gateway" ? "extra bases after attB1" : "overhang"}<input className="mono" value={settings.forwardOverhang} placeholder={needsOverlap ? "15–40 nt overlap" : "e.g. GCGC + GGATCC"} onChange={(event) => set({ forwardOverhang: event.target.value.toUpperCase().replace(/[^ACGT]/g, "") })} /></label>
        <label className="wide">Reverse 5′ {settings.method === "gateway" ? "extra bases after attB2" : "overhang"}<input className="mono" value={settings.reverseOverhang} placeholder={needsOverlap ? "15–40 nt overlap" : "e.g. GCGC + CTCGAG"} onChange={(event) => set({ reverseOverhang: event.target.value.toUpperCase().replace(/[^ACGT]/g, "") })} /></label>
      </>}
      <Button disabled={loading || regionSize < settings.minLength || (region ? region.end < region.start : true)} onClick={onDesign}>{loading ? <LoaderCircle className="spin" /> : <WandSparkles />} Design primer pair</Button>
      {error && <div className="vpanel-error"><CircleAlert /><span>{error}</span></div>}
    </section>
    <section className="vprimer-results">
      {designed.length > 0 && <>
        <h4>Designed pair</h4>
        {designed.map((primer) => <PrimerCard key={primer.id} primer={primer} onFocus={onFocus} />)}
        {designed[0] && <p className="vprimer-pair-note">Pair ΔTm {Math.abs(designed[0].tmCelsius - (designed[1]?.tmCelsius ?? designed[0].tmCelsius)).toFixed(1)} °C · heterodimer risk <Risk screen={designed[0].heteroDimer} /> · {designed[0].tmMethod}</p>}
      </>}
      <h4>Saved primers <small>{saved.length}</small></h4>
      {!saved.length && <div className="vpanel-empty">No primers saved on this construct yet.</div>}
      {saved.map((primer) => <article key={String(primer.id)} className="vprimer-saved">
        <button type="button" onClick={() => onFocus({ start: Number(primer.start), end: Number(primer.end) })}><strong>{String(primer.name)}</strong><small>{Number(primer.start) + 1}–{String(primer.end)} · {Number(primer.strand) > 0 ? "forward" : "reverse"}</small></button>
        <code><i>{String(primer.overhang ?? "").toLowerCase()}</i>{String(primer.annealingSequence ?? primer.sequence ?? "").slice(String(primer.annealingSequence ?? "") ? 0 : String(primer.overhang ?? "").length)}</code>
        <span>Tm {Number(primer.tmCelsius ?? 0).toFixed(1)} °C</span>
        <Button variant="ghost" size="icon-sm" aria-label={`Remove ${String(primer.name)}`} onClick={() => onRemove(String(primer.id))}><Trash2 /></Button>
      </article>)}
    </section>
  </div>;
}

function PrimerCard({ primer, onFocus }: { primer: CheckedPrimer; onFocus: (range: SeqRange) => void }) {
  const off = Math.abs(primer.tmDeltaCelsius) > 2;
  return <article className="vprimer-card">
    <header><button type="button" onClick={() => onFocus({ start: primer.start, end: primer.end })}><strong>{primer.strand > 0 ? "Forward" : "Reverse"}</strong><small>{primer.start + 1}–{primer.end} · {primer.totalLength} nt</small></button></header>
    <code title="Overhang in lower case, annealing region in upper case"><i>{primer.overhang.toLowerCase()}</i>{primer.annealingSequence}</code>
    <div className="vprimer-metrics">
      <span className={off ? "warn" : "ok"}>Tm {primer.tmCelsius.toFixed(1)} °C <small>({primer.tmDeltaCelsius >= 0 ? "+" : ""}{primer.tmDeltaCelsius.toFixed(1)})</small></span>
      <span className={primer.withinGcLimits ? "ok" : "warn"}>GC {primer.gcPercent.toFixed(0)}%</span>
      <span>Hairpin <Risk screen={primer.hairpin} /></span>
      <span>Self-dimer <Risk screen={primer.selfDimer} /></span>
    </div>
  </article>;
}

function Risk({ screen }: { screen: CheckedPrimer["hairpin"] }) {
  return <b className={`vrisk risk-${screen.risk}`} title={`${screen.longestComplementaryRun} nt complementary run, ${screen.threePrimeComplementarity} nt at the 3′ end. ${screen.limitation}`}>{screen.risk}</b>;
}
