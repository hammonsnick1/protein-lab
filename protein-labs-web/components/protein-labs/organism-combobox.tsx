"use client";

import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { BadgeCheck, CircleAlert, LoaderCircle, Search, WifiOff } from "lucide-react";

import { proteinLabsApi } from "@/lib/protein-labs-api";
import { createOrganismSearch, nextHighlight, organismLabel, sourceNote, suggestionDetail, type OrganismSearchState, type TaxonSuggestion } from "@/lib/organism-search";

type Placement = { above: boolean; maxHeight: number };

/**
 * Organism of interest with UniProt / NCBI Taxonomy suggestions from the
 * engine. Choosing a suggestion links its taxon ID; typing anything else keeps
 * a free-text organism with no taxon, exactly as older projects saved it.
 */
export function OrganismCombobox({ value, taxonId, onChange }: { value: string; taxonId: number | null; onChange: (organism: string, taxonId: number | null) => void }) {
  const id = useId(); const listId = `${id}-list`; const hintId = `${id}-hint`;
  const field = useRef<HTMLDivElement>(null); const list = useRef<HTMLUListElement>(null);
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(-1);
  const [state, setState] = useState<OrganismSearchState>({ status: "idle" });
  const [placement, setPlacement] = useState<Placement>({ above: false, maxHeight: 320 });
  const search = useMemo(() => createOrganismSearch({ fetch: (query) => proteinLabsApi.searchTaxonomy(query), onState: (next) => { setState(next); setHighlight(-1); } }), []);
  useEffect(() => () => search.cancel(), [search]);

  const response = state.status === "ready" ? state.response : null;
  const rows = response?.results ?? [];

  useLayoutEffect(() => {
    if (!open) return;
    // Keep the list on screen: open upward when there is more room above,
    // and cap its height to the space actually available (900×650 included).
    function place() {
      const rect = field.current?.getBoundingClientRect(); if (!rect) return;
      const topBar = document.querySelector(".topbar")?.getBoundingClientRect().bottom ?? 0;
      const below = window.innerHeight - rect.bottom - 12; const above = rect.top - Math.max(topBar, 0) - 12;
      const up = below < 220 && above > below;
      setPlacement({ above: up, maxHeight: Math.max(120, Math.min(340, up ? above : below)) });
    }
    place();
    window.addEventListener("resize", place); window.addEventListener("scroll", place, true);
    return () => { window.removeEventListener("resize", place); window.removeEventListener("scroll", place, true); };
  }, [open]);
  useEffect(() => { if (highlight >= 0) list.current?.querySelector(`[data-index="${highlight}"]`)?.scrollIntoView({ block: "nearest" }); }, [highlight]);

  function show(text: string) { setOpen(true); search.search(text); }
  function choose(row: TaxonSuggestion) { onChange(organismLabel(row), row.taxonId); setOpen(false); search.cancel(); }
  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) { show(value); return; }
      setHighlight((current) => nextHighlight(current, event.key, rows.length));
    } else if ((event.key === "Home" || event.key === "End") && open && highlight >= 0) {
      event.preventDefault(); setHighlight((current) => nextHighlight(current, event.key, rows.length));
    } else if (event.key === "Enter" && open) {
      event.preventDefault();
      if (rows[highlight]) choose(rows[highlight]); else setOpen(false);
    } else if (event.key === "Escape" && open) {
      event.preventDefault(); event.stopPropagation(); setOpen(false); search.cancel();
    }
  }

  const active = open && highlight >= 0 && rows[highlight] ? `${id}-option-${highlight}` : undefined;
  return <div className="lab-field organism-field">
    <label htmlFor={`${id}-input`}>Organism</label>
    <div className="organism-input" ref={field}>
      <Search aria-hidden="true"/>
      <input id={`${id}-input`} role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list" aria-activedescendant={active} aria-describedby={hintId} autoComplete="off" spellCheck={false}
        value={value} placeholder="Search by name, strain or taxon ID"
        onFocus={() => show(value)} onBlur={() => { setOpen(false); search.cancel(); }}
        onChange={(event) => { onChange(event.target.value, null); show(event.target.value); }} onKeyDown={onKeyDown}/>
    {open && <div className={`organism-popup${placement.above ? " above" : ""}`} style={{ maxHeight: placement.maxHeight }} onMouseDown={(event) => event.preventDefault()}>
      <ul role="listbox" id={listId} ref={list} aria-label="Organism suggestions">
        {rows.map((row, index) => { const detail = suggestionDetail(row); return <li key={`${row.taxonId}-${row.strain}`} id={`${id}-option-${index}`} data-index={index} role="option" aria-selected={index === highlight} className={index === highlight ? "highlighted" : ""} onMouseEnter={() => setHighlight(index)} onClick={() => choose(row)}>
          <span><strong>{row.rank === "species" || row.rank === "strain" || row.rank === "subspecies" ? <i>{row.scientificName}</i> : row.scientificName}</strong>{detail && <small>{detail}</small>}</span>
          <em>taxon {row.taxonId}</em>
        </li>; })}
      </ul>
      <OrganismStatus state={state} count={rows.length}/>
    </div>}
    </div>
    <small id={hintId} className={`organism-link${taxonId ? " linked" : ""}`}>
      {taxonId ? <><BadgeCheck aria-hidden="true"/> Linked to NCBI taxon {taxonId}</> : value.trim() ? "Free text · not linked to a taxon. Choose a suggestion to link one." : "Type to search UniProt and NCBI Taxonomy, or enter free text."}
    </small>
  </div>;
}

function OrganismStatus({ state, count }: { state: OrganismSearchState; count: number }) {
  if (state.status === "loading") return <p className="organism-status" role="status"><LoaderCircle className="spin" aria-hidden="true"/> Searching UniProt and NCBI Taxonomy…</p>;
  if (state.status === "error") return <p className="organism-status error" role="status"><CircleAlert aria-hidden="true"/> Organism lookup failed: {state.message} The typed name is kept as free text.</p>;
  if (state.status !== "ready") return null;
  const response = state.response;
  const empty = !count ? (response.offline ? `No match for “${state.query}” in the bundled list. ` : `No organism matches “${state.query}”. `) : "";
  return <p className={`organism-status${response.offline ? " offline" : ""}`} role="status">
    {response.offline && <WifiOff aria-hidden="true"/>}
    <span>{empty}{response.offline ? <><b>Offline list.</b> {sourceNote(response)}</> : sourceNote(response)}{!empty && count ? "" : " The typed name is kept as free text."}</span>
  </p>;
}
