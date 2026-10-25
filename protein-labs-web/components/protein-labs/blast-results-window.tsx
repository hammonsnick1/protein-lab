"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import { Download, ExternalLink, ListChecks, Rows3, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { alignmentBlocks, buildMsa, clustalColours, columnConservation, coverageTier, evalueTier, formatEvalue, identityTier, msaFasta } from "@/lib/blast-alignment";
import type { BlastHit, BlastHsp, ClustalColour, ColumnKind, Tier } from "@/lib/blast-alignment";

export type BlastWindowTab = "pairwise" | "msa";

/** Every hit of one BLAST run in its own large window: pairwise alignments,
 *  and the selected hits laid onto the query as a multiple alignment. */
export function BlastResultsWindow({ open, onOpenChange, tab, onTabChange, focusHitId, hits, query, proteinName, runLabel }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  tab: BlastWindowTab;
  onTabChange: (tab: BlastWindowTab) => void;
  focusHitId: string;
  hits: BlastHit[];
  query: string;
  proteinName: string;
  runLabel: string;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="blast-window">
      <DialogHeader className="blast-window-header">
        <DialogTitle>BLAST results · {proteinName}</DialogTitle>
        <DialogDescription>{[`${hits.length} hit${hits.length === 1 ? "" : "s"}`, `query ${query.length} aa`, runLabel].filter(Boolean).join(" · ")}</DialogDescription>
      </DialogHeader>
      <Tabs value={tab} onValueChange={(value) => onTabChange(value as BlastWindowTab)} className="blast-window-tabs">
        <TabsList>
          <TabsTrigger value="pairwise"><Rows3/> Pairwise alignments</TabsTrigger>
          <TabsTrigger value="msa"><ListChecks/> Multiple sequence alignment</TabsTrigger>
        </TabsList>
        <TabsContent value="pairwise" className="blast-window-pane"><PairwisePane hits={hits} focusHitId={focusHitId}/></TabsContent>
        <TabsContent value="msa" className="blast-window-pane"><MsaPane hits={hits} query={query} proteinName={proteinName}/></TabsContent>
      </Tabs>
    </DialogContent>
  </Dialog>;
}

function PairwisePane({ hits, focusHitId }: { hits: BlastHit[]; focusHitId: string }) {
  const [filter, setFilter] = useState("");
  const [current, setCurrent] = useState(focusHitId || hits[0]?.id || "");
  const scroller = useRef<HTMLDivElement>(null);
  const visible = useMemo(() => {
    const needle = filter.trim().toLowerCase();
    return needle ? hits.filter((hit) => `${hit.accession} ${hit.description} ${hit.organism}`.toLowerCase().includes(needle)) : hits;
  }, [filter, hits]);

  function jump(id: string) {
    setCurrent(id);
    scroller.current?.querySelector(`[data-hit="${CSS.escape(id)}"]`)?.scrollIntoView({ block: "start" });
  }
  // Opened from a row of the hit table: start at that hit.
  useEffect(() => {
    if (!focusHitId) return;
    const frame = window.requestAnimationFrame(() => scroller.current?.querySelector(`[data-hit="${CSS.escape(focusHitId)}"]`)?.scrollIntoView({ block: "start" }));
    return () => window.cancelAnimationFrame(frame);
  }, [focusHitId]);

  if (!hits.length) return <WindowEmpty text="This BLAST run found no hits, so there are no alignments to show."/>;
  return <div className="blast-pairwise">
    <aside className="blast-hit-index">
      <label className="blast-filter"><Search aria-hidden="true"/><input value={filter} onChange={(event) => setFilter(event.target.value)} placeholder="Filter hits" aria-label="Filter hits by accession, protein or organism"/></label>
      <nav aria-label="Hits">
        {visible.map((hit) => <button key={hit.id} type="button" className={hit.id === current ? "active" : ""} onClick={() => jump(hit.id)}>
          <b>{hit.rank}</b><span><strong>{hit.accession}</strong><small>{hit.organism || hit.description || "—"}</small></span><em>{percent(hit.identity)}</em>
        </button>)}
        {!visible.length && <p>No hit matches “{filter}”.</p>}
      </nav>
    </aside>
    <div className="blast-alignments" ref={scroller}>
      {visible.map((hit) => <article key={hit.id} data-hit={hit.id} className="blast-alignment-card">
        <header>
          <span className="blast-rank">{hit.rank}</span>
          <div>
            <h3>{hit.accession}{hit.description ? <span> · {hit.description}</span> : null}</h3>
            {hit.organism && <p><i>{hit.organism}</i>{hit.length ? ` · ${hit.length} aa` : ""}</p>}
          </div>
          {hit.uniprotAccession && <a href={`https://www.uniprot.org/uniprotkb/${hit.uniprotAccession}`} target="_blank" rel="noreferrer" aria-label={`Open ${hit.uniprotAccession} at UniProt`}><ExternalLink/></a>}
        </header>
        <div className="blast-chip-row">
          <HitChip label="identity" value={percent(hit.identity)} tier={identityTier(hit.identity)}/>
          <HitChip label="coverage" value={percent(hit.coverage)} tier={coverageTier(hit.coverage)}/>
          <HitChip label="E-value" value={formatEvalue(hit.evalue)} tier={evalueTier(hit.evalue)}/>
          {hit.bitScore !== null && <span className="hit-chip plain"><b>{hit.bitScore.toFixed(1)}</b> bits</span>}
        </div>
        {hit.hsps.length
          ? hit.hsps.map((hsp, index) => <HspAlignment key={index} hsp={hsp} label={hit.hsps.length > 1 ? `HSP ${index + 1} of ${hit.hsps.length}` : ""}/>)
          : <p className="blast-missing">The residue-by-residue alignment was not saved with this run{hit.queryStart ? ` (it covers query residues ${hit.queryStart}–${hit.queryEnd})` : ""}. Run protein BLAST again to see it.</p>}
      </article>)}
    </div>
  </div>;
}

function HspAlignment({ hsp, label }: { hsp: BlastHsp; label: string }) {
  const blocks = useMemo(() => alignmentBlocks(hsp), [hsp]);
  const width = String(Math.max(hsp.queryFrom, hsp.queryTo, hsp.hitFrom, hsp.hitTo)).length;
  return <figure className="blast-hsp">
    <figcaption>
      {label && <b>{label}</b>}
      <span>Identities {hsp.identities}/{hsp.alignLength} ({Math.round((hsp.identities / Math.max(hsp.alignLength, 1)) * 100)}%)</span>
      {hsp.positives !== null && <span>Positives {hsp.positives}/{hsp.alignLength} ({Math.round((hsp.positives / Math.max(hsp.alignLength, 1)) * 100)}%)</span>}
      <span>Gaps {hsp.gaps}/{hsp.alignLength}</span>
      {hsp.evalue !== null && <span>E {formatEvalue(hsp.evalue)}</span>}
    </figcaption>
    <div className="blast-blocks">
      {blocks.map((block, index) => <pre key={index} className="blast-block">
        <span className="blast-line"><span className="blast-name">Query</span><span className="blast-num">{String(block.queryStart).padStart(width)}</span><Residues text={block.query} kinds={block.kinds}/><span className="blast-num end">{block.queryEnd}</span></span>
        <span className="blast-line midline"><span className="blast-name"/><span className="blast-num">{"".padStart(width)}</span><span className="blast-residues">{block.midline}</span></span>
        <span className="blast-line"><span className="blast-name">Sbjct</span><span className="blast-num">{String(block.subjectStart).padStart(width)}</span><Residues text={block.subject} kinds={block.kinds}/><span className="blast-num end">{block.subjectEnd}</span></span>
      </pre>)}
    </div>
  </figure>;
}

/** Runs of one column kind share a span, so a 60-column line is a handful of nodes. */
function Residues({ text, kinds }: { text: string; kinds: ColumnKind[] }) {
  const runs: { kind: ColumnKind; text: string }[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const last = runs[runs.length - 1];
    if (last && last.kind === kinds[index]) last.text += text[index];
    else runs.push({ kind: kinds[index], text: text[index] });
  }
  return <span className="blast-residues">{runs.map((run, index) => <span key={index} className={`aln-${run.kind}`}>{run.text}</span>)}</span>;
}

type Colouring = "clustal" | "identity" | "none";
const CLUSTAL_LEGEND: [ClustalColour, string][] = [["blue", "Hydrophobic"], ["red", "Positive"], ["magenta", "Negative"], ["green", "Polar"], ["pink", "Cysteine"], ["orange", "Glycine"], ["yellow", "Proline"], ["cyan", "Aromatic"]];

function MsaPane({ hits, query, proteinName }: { hits: BlastHit[]; query: string; proteinName: string }) {
  const aligned = useMemo(() => hits.filter((hit) => hit.hsps.length), [hits]);
  const [selected, setSelected] = useState<string[]>(() => aligned.slice(0, 10).map((hit) => hit.id));
  const [colouring, setColouring] = useState<Colouring>("clustal");
  const [hover, setHover] = useState<number | null>(null);
  const chosen = useMemo(() => aligned.filter((hit) => selected.includes(hit.id)), [aligned, selected]);
  const rows = useMemo(() => buildMsa(query, chosen), [query, chosen]);
  const colours = useMemo(() => colouring === "clustal" ? clustalColours(rows.map((row) => row.residues)) : null, [colouring, rows]);
  const conservation = useMemo(() => columnConservation(rows.map((row) => row.residues)), [rows]);
  const length = rows[0]?.residues.length ?? 0;
  const missing = hits.length - aligned.length;
  const insertions = rows.filter((row) => row.insertions > 0);
  // The grid can hold tens of thousands of cells, so hovering a column only
  // swaps one <style> rule instead of re-rendering every cell.
  const grid = useMemo(() => <div className="blast-msa-grid" style={{ "--msa-cols": length } as React.CSSProperties}>
    <div className="msa-row msa-ruler" aria-hidden="true"><span className="msa-label">Position</span><Ruler length={length}/></div>
    {rows.map((row, rowIndex) => <div key={row.id} className={`msa-row${rowIndex === 0 ? " query" : ""}`}>
      <span className="msa-label" title={row.label}><strong>{row.label}</strong><small>{rowIndex === 0 ? `${row.residues.length} aa` : `${Math.round(row.identity * 100)}% id`}</small></span>
      <span className="msa-cells">{Array.from(row.residues, (residue, column) => <span key={column} data-col={column} className={cellClass(residue, column, rows[0].residues, colours?.[rowIndex][column], colouring)}>{residue}</span>)}</span>
    </div>)}
    <div className="msa-row msa-conservation" aria-hidden="true"><span className="msa-label"><strong>Conservation</strong></span><span className="msa-cells">{conservation.map((value, column) => <span key={column} data-col={column}><i style={{ height: `${Math.round(value * 100)}%` }}/></span>)}</span></div>
  </div>, [rows, colours, colouring, conservation, length]);

  function toggle(id: string) { setSelected((current) => current.includes(id) ? current.filter((value) => value !== id) : [...current, id]); }
  function exportFasta() {
    const blob = new Blob([msaFasta(rows)], { type: "text/plain" });
    const url = URL.createObjectURL(blob), link = document.createElement("a");
    link.href = url; link.download = `${proteinName.replace(/[^\w.-]+/g, "-") || "protein"}-blast-msa.fasta`; link.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  function track(event: React.MouseEvent<HTMLDivElement>) {
    const cell = (event.target as HTMLElement).closest<HTMLElement>("[data-col]");
    setHover(cell ? Number(cell.dataset.col) : null);
  }

  if (!query) return <WindowEmpty text="The query sequence is missing, so the hits cannot be placed on it. Add the sequence in the Sequence job and run BLAST again."/>;
  if (!aligned.length) return <WindowEmpty text={hits.length ? "None of these hits has a saved alignment. Run protein BLAST again to build a multiple alignment." : "This BLAST run found no hits to align."}/>;
  return <div className="blast-msa">
    <aside className="blast-hit-index">
      <div className="blast-select-actions">
        <Button size="sm" variant="outline" onClick={() => setSelected(aligned.slice(0, 10).map((hit) => hit.id))}>Top 10</Button>
        <Button size="sm" variant="outline" onClick={() => setSelected(aligned.map((hit) => hit.id))}>All</Button>
        <Button size="sm" variant="ghost" onClick={() => setSelected([])}>Clear</Button>
      </div>
      <p className="blast-select-count">{chosen.length} of {aligned.length} hits aligned</p>
      <nav aria-label="Hits in the alignment">
        {aligned.map((hit) => <label key={hit.id} className={selected.includes(hit.id) ? "active" : ""}>
          <input type="checkbox" checked={selected.includes(hit.id)} onChange={() => toggle(hit.id)}/>
          <span><strong>{hit.accession}</strong><small>{hit.organism || hit.description || "—"}</small></span><em>{percent(hit.identity)}</em>
        </label>)}
      </nav>
      {missing > 0 && <p className="blast-select-note">{missing} hit{missing === 1 ? " has" : "s have"} no saved alignment and {missing === 1 ? "is" : "are"} not listed.</p>}
    </aside>
    <div className="blast-msa-main">
      <div className="blast-msa-toolbar">
        <div className="blast-segmented" role="radiogroup" aria-label="Colouring">
          {([["clustal", "ClustalX"], ["identity", "Identity to query"], ["none", "None"]] as [Colouring, string][]).map(([value, label]) => <button key={value} type="button" role="radio" aria-checked={colouring === value} className={colouring === value ? "active" : ""} onClick={() => setColouring(value)}>{label}</button>)}
        </div>
        <span className="blast-msa-readout" aria-live="off">{hover === null ? `${length} columns · query-anchored` : `Column ${hover + 1} · query ${rows[0].residues[hover]}${hover + 1} · ${Math.round(conservation[hover] * 100)}% conserved`}</span>
        <Button size="sm" variant="outline" onClick={exportFasta} disabled={!chosen.length}><Download/> Export FASTA</Button>
      </div>
      {colouring === "clustal" && <ul className="blast-msa-legend" aria-label="ClustalX colour key">{CLUSTAL_LEGEND.map(([colour, label]) => <li key={colour}><i className={`cx-${colour}`}/>{label}</li>)}</ul>}
      <div className="blast-msa-scroll" onMouseOver={track} onMouseLeave={() => setHover(null)} tabIndex={0} aria-label="Multiple sequence alignment; scroll sideways to read every column">
        {grid}
        {hover !== null && <style>{`.blast-msa-grid [data-col="${hover}"] { box-shadow: inset 0 0 0 1px var(--foreground); }`}</style>}
      </div>
      {!chosen.length && <p className="blast-select-note">Only the query is shown. Select hits on the left to align them with it.</p>}
      {insertions.length > 0 && <p className="blast-select-note">Residues a hit carries between two query positions cannot sit in a query-anchored column and are hidden: {insertions.map((row) => `${row.label.split(" ")[0]} (${row.insertions})`).join(", ")}.</p>}
    </div>
  </div>;
}

function cellClass(residue: string, column: number, query: string, clustal: ClustalColour | undefined, colouring: Colouring) {
  const names = ["msa-cell"];
  if (residue === "-") names.push("gap");
  else if (colouring === "clustal" && clustal) names.push(`cx-${clustal}`);
  else if (colouring === "identity" && residue === query[column]) names.push("ident");
  return names.join(" ");
}

/** Residue numbers over every tenth column, with a tick on every fifth. */
function Ruler({ length }: { length: number }) {
  const marks: number[] = [];
  for (let position = 5; position <= length; position += 5) marks.push(position);
  const at = (position: number) => ({ left: `calc(${position - 0.5} * var(--cell))` });
  return <span className="msa-ruler-track">
    {length > 0 && <b style={at(1)}>1</b>}
    {marks.map((position) => <Fragment key={position}><i className={position % 10 ? "minor" : "major"} style={at(position)}/>{position % 10 === 0 && <b style={at(position)}>{position}</b>}</Fragment>)}
  </span>;
}

function HitChip({ label, value, tier }: { label: string; value: string; tier: Tier }) {
  return <span className={`hit-chip ${tier}`}><b>{value}</b> {label}</span>;
}
function WindowEmpty({ text }: { text: string }) { return <div className="research-empty blast-window-empty"><Rows3/><span>{text}</span></div>; }
function percent(value: number | null) { return value === null ? "—" : `${(value * 100).toFixed(1)}%`; }
