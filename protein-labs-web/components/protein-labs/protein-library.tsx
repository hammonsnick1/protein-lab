"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowRightLeft, Ban, Check, ChevronRight, CircleAlert, FlaskConical, History, LayoutGrid, List, LoaderCircle, MapPin, Minus, Pencil, Pipette, Plus, Search, Snowflake, Star, TestTubes, Thermometer, Trash2, X } from "lucide-react";
import { Dialog as DialogPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { proteinLabsApi } from "@/lib/protein-labs-api";
import {
  CONCENTRATION_UNITS,
  FACETS,
  LOCATION_LEVELS,
  SORTS,
  TEMPERATURES,
  VOLUME_UNITS,
  YIELD_UNITS,
  activeFilterCount,
  aliquotsText,
  displayUnit,
  emptyForm,
  eventSummary,
  facetOptions,
  facetValueLabel,
  formToPayload,
  formatDateTime,
  formatDay,
  formatNumber,
  formatQuantity,
  joinLocation,
  librarySearchParams,
  locationCrumbs,
  locationText,
  recordToForm,
  remainingVolume,
  shortAge,
  sortProteins,
  statusMeta,
  storedAgo,
  toggleFilter,
  type FacetCounts,
  type FacetKey,
  type Filters,
  type FormErrors,
  type LibraryProtein,
  type LocationParts,
  type ProteinEvent,
  type ProteinForm,
  type SortKey,
} from "@/lib/protein-library";

type LoadState = { status: "loading" | "ready" | "error"; proteins: LibraryProtein[]; total: number; facets: FacetCounts; error: string };
type ViewMode = "cards" | "list";
type Modal = { kind: "add" } | { kind: "edit"; record: LibraryProtein } | { kind: "move"; record: LibraryProtein } | { kind: "discard"; record: LibraryProtein } | { kind: "delete"; record: LibraryProtein } | null;

const VIEW_KEY = "protein-labs-protein-library-view";

/**
 * The protein library: every purified batch the lab has made, where it is
 * stored and how much is left. Search and facets on the left, the batches in
 * the middle as cards or a list, and the chosen batch's storage, stock and
 * history on the right.
 */
export function ProteinLibrary() {
  const [query, setQuery] = useState("");
  const [debounced, setDebounced] = useState("");
  const [filters, setFilters] = useState<Filters>({});
  const [favoritesOnly, setFavoritesOnly] = useState(false);
  const [sort, setSort] = useState<SortKey>("updated");
  const [view, setView] = useState<ViewMode>("cards");
  const [state, setState] = useState<LoadState>({ status: "loading", proteins: [], total: 0, facets: {}, error: "" });
  const [libraryEmpty, setLibraryEmpty] = useState(false);
  const [reload, setReload] = useState(0);
  const [selectedId, setSelectedId] = useState("");
  const [details, setDetails] = useState<Record<string, LibraryProtein | "error">>({});
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState("");
  const [failure, setFailure] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [root, setRoot] = useState<HTMLElement | null>(null);
  const searchRef = useRef<HTMLInputElement>(null);

  const shown = useMemo(() => sortProteins(state.proteins, sort), [state.proteins, sort]);
  const filtered = Boolean(debounced.trim()) || activeFilterCount(filters) > 0 || favoritesOnly;
  const listed = shown.find((record) => record.id === selectedId) ?? null;
  const detail = details[selectedId];
  const selected = detail && detail !== "error" ? detail : listed;
  const lowCount = state.facets.status?.find((option) => option.value === "low")?.count ?? 0;
  // Dialogs portal into the shell so they keep the appearance's tokens.
  const shell = root?.closest<HTMLElement>(".app-shell") ?? null;

  useEffect(() => { const saved = localStorage.getItem(VIEW_KEY); if (saved === "list" || saved === "cards") queueMicrotask(() => setView(saved)); }, []);
  useEffect(() => { const timer = setTimeout(() => setDebounced(query), 200); return () => clearTimeout(timer); }, [query]);

  useEffect(() => {
    let active = true;
    proteinLabsApi.searchProteinLibrary(librarySearchParams({ query: debounced, filters, favorite: favoritesOnly ? true : undefined }))
      .then((value) => {
        if (!active) return;
        const proteins = value.proteins as unknown as LibraryProtein[];
        setState({ status: "ready", proteins, total: value.total, facets: value.facets as FacetCounts, error: "" });
        if (!filtered) setLibraryEmpty(value.total === 0);
        // Keep the detail panel on a batch the researcher can see.
        setSelectedId((current) => proteins.some((record) => record.id === current) ? current : sortProteins(proteins, sort)[0]?.id ?? "");
      })
      .catch((reason: unknown) => { if (active) setState((current) => ({ ...current, status: "error", error: message(reason) })); });
    return () => { active = false; };
  }, [debounced, filters, favoritesOnly, reload]); // eslint-disable-line react-hooks/exhaustive-deps

  // The list carries no events; the detail record does. Refetch when the batch changes.
  const selectedStamp = listed?.updatedAt ?? "";
  useEffect(() => {
    if (!selectedId) return;
    const cached = details[selectedId];
    if (cached && (cached === "error" || cached.updatedAt === selectedStamp)) return;
    let active = true;
    proteinLabsApi.getLibraryProtein(selectedId)
      .then((value) => { if (active) setDetails((current) => ({ ...current, [selectedId]: value as unknown as LibraryProtein })); })
      .catch(() => { if (active) setDetails((current) => ({ ...current, [selectedId]: "error" })); });
    return () => { active = false; };
  }, [selectedId, selectedStamp, details]);

  const focusSearch = useCallback(() => { searchRef.current?.focus(); searchRef.current?.select(); }, []);
  useEffect(() => {
    const onWindowKey = (event: KeyboardEvent) => {
      if (event.defaultPrevented || modal) return;
      const editing = event.target instanceof HTMLElement && (event.target.isContentEditable || ["INPUT", "SELECT", "TEXTAREA"].includes(event.target.tagName));
      if ((event.key === "/" && !editing) || (event.key.toLowerCase() === "k" && (event.ctrlKey || event.metaKey))) { event.preventDefault(); focusSearch(); }
    };
    window.addEventListener("keydown", onWindowKey);
    return () => window.removeEventListener("keydown", onWindowKey);
  }, [focusSearch, modal]);

  function onKeyDown(event: React.KeyboardEvent) {
    if (modal) return;
    if (event.key === "Escape" && query) { setQuery(""); event.preventDefault(); return; }
    if (event.key !== "ArrowDown" && event.key !== "ArrowUp" && event.key !== "ArrowLeft" && event.key !== "ArrowRight") return;
    if (event.target instanceof HTMLSelectElement || (event.target instanceof HTMLInputElement && event.target.type !== "checkbox")) return;
    const ids = shown.map((record) => record.id);
    if (!ids.length) return;
    event.preventDefault();
    const index = ids.indexOf(selectedId);
    const forward = event.key === "ArrowDown" || event.key === "ArrowRight";
    const next = ids[forward ? Math.min(ids.length - 1, index + 1) : Math.max(0, index - 1)];
    setSelectedId(next);
    const element = document.getElementById(`pl-item-${next}`);
    element?.scrollIntoView({ block: "nearest" });
    element?.focus();
  }

  function openModal(next: Modal) { setFailure(""); setModal(next); }
  function chooseView(next: ViewMode) { setView(next); localStorage.setItem(VIEW_KEY, next); }

  /** Run one change, show the engine's fresh record, and refresh the list and facets. */
  async function act(key: string, work: () => Promise<unknown>, done: (record: LibraryProtein | null) => string) {
    setBusy(key); setFailure(""); setNotice("");
    try {
      const result = await work();
      const record = result && typeof result === "object" && "id" in result ? result as LibraryProtein : null;
      if (record) setDetails((current) => ({ ...current, [record.id]: record }));
      setNotice(done(record));
      setReload((value) => value + 1);
      return true;
    } catch (reason) { setFailure(message(reason)); return false; }
    finally { setBusy(""); }
  }

  async function save(form: ProteinForm, existing?: LibraryProtein) {
    const { payload, errors } = formToPayload(form, existing);
    if (Object.keys(errors).length) return errors;
    const ok = await act("save", async () => {
      if (existing) return proteinLabsApi.updateLibraryProtein(existing.id, payload);
      const created = await proteinLabsApi.createLibraryProtein(payload) as unknown as LibraryProtein;
      setSelectedId(created.id);
      // The history starts the day it went into storage.
      return proteinLabsApi.addLibraryProteinEvent(created.id, { eventType: "stored", ...(created.storageDate ? { occurredAt: created.storageDate } : {}) });
    }, (record) => existing ? `${record?.name ?? existing.name} was updated.` : `${record?.name ?? "The batch"} was added to the library.`);
    if (ok) { setModal(null); setLibraryEmpty(false); }
    return {};
  }

  const consumeAliquots = (record: LibraryProtein, count: number) => act(`use:${record.id}`,
    () => proteinLabsApi.addLibraryProteinEvent(record.id, { eventType: "aliquot_used", aliquotsUsed: count }),
    (updated) => `Used ${aliquotsText(count)} of ${record.name}. ${updated ? `${aliquotsText(updated.aliquotCount)} left.` : ""}`);

  const logThaw = (record: LibraryProtein) => act(`thaw:${record.id}`,
    () => proteinLabsApi.addLibraryProteinEvent(record.id, { eventType: "thawed" }),
    () => `Thaw of ${record.name} recorded.`);

  async function move(record: LibraryProtein, parts: LocationParts, note: string) {
    const from = locationText(record);
    const to = locationText({ ...parts, locationPath: joinLocation(parts) });
    const ok = await act(`move:${record.id}`, async () => {
      await proteinLabsApi.addLibraryProteinEvent(record.id, { eventType: "moved", fromLocation: from, toLocation: to, notes: note });
      // The event moves the path; the structured fields follow so the breadcrumb and facets agree.
      return proteinLabsApi.updateLibraryProtein(record.id, { ...parts, locationPath: joinLocation(parts) });
    }, () => `${record.name} moved to ${to || "an unrecorded place"}.`);
    if (ok) setModal(null);
  }

  async function discard(record: LibraryProtein, note: string) {
    const ok = await act(`discard:${record.id}`, () => proteinLabsApi.addLibraryProteinEvent(record.id, { eventType: "discarded", notes: note }), () => `${record.name} was marked discarded. Its history is kept.`);
    if (ok) setModal(null);
  }

  async function remove(record: LibraryProtein) {
    const ok = await act(`delete:${record.id}`, () => proteinLabsApi.deleteLibraryProtein(record.id), () => `${record.name} was deleted from the library.`);
    if (ok) { setModal(null); setDetails((current) => { const copy = { ...current }; delete copy[record.id]; return copy; }); }
  }

  const toggleFavorite = (record: LibraryProtein) => act(`fav:${record.id}`,
    () => proteinLabsApi.updateLibraryProtein(record.id, { favorite: !record.favorite }),
    (updated) => updated?.favorite ? `${record.name} is a favourite.` : `${record.name} is no longer a favourite.`);

  const clearFilters = () => { setFilters({}); setFavoritesOnly(false); setQuery(""); };
  const filterCount = activeFilterCount(filters) + (favoritesOnly ? 1 : 0);

  return <main className="plib" ref={setRoot} onKeyDown={onKeyDown} aria-label="Protein library">
    <header className="pl-header">
      <div>
        <span className="eyebrow">PROTEIN LIBRARY</span>
        <h1>Purified proteins</h1>
        <p>Every batch you have purified: how much is left, and exactly where it is stored.</p>
      </div>
      <div className="pl-header-actions">
        {lowCount > 0 && !(filters.status ?? []).includes("low") && <button className="pl-low-alert" onClick={() => setFilters((current) => ({ ...current, status: ["low"] }))}>
          <CircleAlert/> {lowCount} {lowCount === 1 ? "batch is" : "batches are"} running low
        </button>}
        <Button onClick={() => openModal({ kind: "add" })}><Plus/> Add protein</Button>
      </div>
    </header>

    <div className="pl-toolbar">
      <label className="pl-query">
        <Search/>
        <input ref={searchRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search by name, gene, construct, buffer or location — e.g. HBB, His6, Freezer A" aria-label="Search the protein library"/>
        {query && <button onClick={() => setQuery("")} aria-label="Clear search"><X/></button>}
        <kbd>/</kbd>
      </label>
      <label className="pl-sort">Sort
        <select value={sort} onChange={(event) => setSort(event.target.value as SortKey)}>
          {SORTS.map((option) => <option key={option.key} value={option.key}>{option.label}</option>)}
        </select>
      </label>
      <div className="pl-viewswitch" role="radiogroup" aria-label="Layout">
        <button role="radio" aria-checked={view === "cards"} onClick={() => chooseView("cards")} title="Cards"><LayoutGrid/> Cards</button>
        <button role="radio" aria-checked={view === "list"} onClick={() => chooseView("list")} title="List"><List/> List</button>
      </div>
    </div>

    {(notice || failure) && <div className={`pl-banner ${failure ? "failure" : ""}`} role="status">
      {failure ? <CircleAlert/> : <Check/>}
      <span>{failure || notice}</span>
      <button onClick={() => { setFailure(""); setNotice(""); }} aria-label="Dismiss"><X/></button>
    </div>}

    <div className="pl-body">
      <aside className="pl-facets" aria-label="Filters">
        <div className="pl-facets-head">
          <strong>Filters</strong>
          {filterCount > 0 && <button onClick={() => { setFilters({}); setFavoritesOnly(false); }}>Clear {filterCount}</button>}
        </div>
        <label className="pl-facet-option pl-favorites-only">
          <input type="checkbox" checked={favoritesOnly} onChange={(event) => setFavoritesOnly(event.target.checked)}/>
          <Star/><span>Favourites only</span>
        </label>
        {FACETS.map(({ key, label }) => <FacetGroup key={key} facet={key} label={label} options={facetOptions(state.facets[key], filters[key])} selected={filters[key] ?? []} onToggle={(value) => setFilters((current) => toggleFilter(current, key, value))}/>)}
      </aside>

      <section className="pl-results" aria-label="Batches">
        <div className="pl-section-head">
          <strong>{filtered ? "Matching batches" : "All batches"}</strong>
          <small>{state.status === "ready" ? `${shown.length} of ${filtered ? state.total : shown.length}` : ""}</small>
        </div>
        {state.status === "loading" && !state.proteins.length && <div className="pl-empty"><LoaderCircle className="spin"/><span><strong>Loading the protein library…</strong></span></div>}
        {state.status === "error" && <div className="pl-empty failure"><CircleAlert/><span><strong>The protein library is unavailable</strong><small>{state.error}. Start the local engine and your batches load here.</small></span><Button size="sm" variant="outline" onClick={() => setReload((value) => value + 1)}>Retry</Button></div>}
        {state.status === "ready" && libraryEmpty && !filtered && <div className="pl-welcome">
          <TestTubes/>
          <strong>Your protein library is empty</strong>
          <p>Record each purified batch as it goes into the freezer: its concentration and purity, how many aliquots you made, and the freezer, shelf, rack, box and position it went into.</p>
          <Button onClick={() => openModal({ kind: "add" })}><Plus/> Add your first batch</Button>
        </div>}
        {state.status === "ready" && !shown.length && filtered && <div className="pl-empty"><Search/><span><strong>No batch matches</strong><small>Try another name, or clear the filters.</small></span><Button size="sm" variant="outline" onClick={clearFilters}>Clear search and filters</Button></div>}

        {shown.length > 0 && (view === "cards"
          ? <div className="pl-cards" role="listbox" aria-label="Protein batches">
              {shown.map((record) => <ProteinCard key={record.id} record={record} selected={record.id === selectedId} onSelect={() => setSelectedId(record.id)}/>)}
            </div>
          : <div className="pl-table" role="listbox" aria-label="Protein batches">
              <div className="pl-table-head" aria-hidden="true"><span>Protein</span><span>Conc.</span><span>Aliquots</span><span>Storage</span><span>Stored</span><span>Status</span></div>
              {shown.map((record) => <ProteinRow key={record.id} record={record} selected={record.id === selectedId} onSelect={() => setSelectedId(record.id)}/>)}
            </div>)}
      </section>

      <aside className="pl-detail" aria-label="Batch details">
        {selected
          ? <ProteinDetail
              key={selected.id}
              record={selected}
              events={detail && detail !== "error" ? detail.events ?? [] : undefined}
              eventsFailed={detail === "error"}
              busy={busy}
              onFavorite={() => void toggleFavorite(selected)}
              onEdit={() => openModal({ kind: "edit", record: selected })}
              onUse={(count) => void consumeAliquots(selected, count)}
              onThaw={() => void logThaw(selected)}
              onMove={() => openModal({ kind: "move", record: selected })}
              onDiscard={() => openModal({ kind: "discard", record: selected })}
              onRetry={() => setDetails((current) => { const copy = { ...current }; delete copy[selected.id]; return copy; })}
            />
          : <div className="pl-detail-empty"><FlaskConical/><strong>{state.status === "ready" && libraryEmpty ? "Added batches appear here" : "Select a batch"}</strong><small>Its stock, storage location and history show here. Use ↑ ↓ to move through the batches.</small></div>}
      </aside>
    </div>

    <ProteinFormDialog container={shell} modal={modal} busy={busy === "save"} failure={failure} onClose={() => setModal(null)} onSave={save} onDelete={(record) => openModal({ kind: "delete", record })}/>
    <MoveDialog container={shell} modal={modal} busy={busy.startsWith("move:")} failure={failure} onClose={() => setModal(null)} onMove={(record, parts, note) => void move(record, parts, note)}/>
    <ConfirmDialog
      container={shell}
      open={modal?.kind === "discard" || modal?.kind === "delete"}
      title={modal?.kind === "delete" ? `Delete ${modal.record.name}?` : modal?.kind === "discard" ? `Discard ${modal.record.name}?` : ""}
      description={modal?.kind === "delete"
        ? "The batch and its whole history are removed from the library. This cannot be undone. To keep the record, discard it instead."
        : "The batch is marked discarded and leaves the available stock. Its record and history stay in the library."}
      confirmLabel={modal?.kind === "delete" ? "Delete batch" : "Discard batch"}
      withNote={modal?.kind === "discard"}
      failure={failure}
      busy={busy.startsWith("discard:") || busy.startsWith("delete:")}
      onClose={() => setModal(null)}
      onConfirm={(note) => { if (modal?.kind === "discard") void discard(modal.record, note); if (modal?.kind === "delete") void remove(modal.record); }}
    />
  </main>;
}

function FacetGroup({ facet, label, options, selected, onToggle }: { facet: FacetKey; label: string; options: { value: string; count: number }[]; selected: string[]; onToggle: (value: string) => void }) {
  const [expanded, setExpanded] = useState(false);
  if (!options.length) return null;
  const visible = expanded ? options : options.slice(0, 6);
  return <fieldset className={`pl-facet pl-facet-${facet}`}>
    <legend>{label}</legend>
    {visible.map((option) => {
      const text = facetValueLabel(facet, option.value);
      return <label key={option.value} className={`pl-facet-option ${option.count === 0 ? "empty" : ""}`}>
        <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)}/>
        {facet === "status" && <i className={`pl-dot tone-${statusMeta(option.value).tone}`} aria-hidden="true"/>}
        <span title={text}>{text}</span>
        <em>{option.count}</em>
      </label>;
    })}
    {options.length > 6 && <button className="pl-facet-more" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer" : `Show ${options.length - 6} more`}</button>}
  </fieldset>;
}

function StatusBadge({ status }: { status: string }) {
  const meta = statusMeta(status);
  return <span className={`pl-status tone-${meta.tone}`} title={meta.hint}><i aria-hidden="true"/>{meta.label}</span>;
}

function TemperatureChip({ value }: { value: string }) {
  if (!value) return null;
  const frozen = /^-|LN2/i.test(value);
  return <span className={`pl-temp ${frozen ? "frozen" : ""}`}>{frozen ? <Snowflake/> : <Thermometer/>}{value}</span>;
}

/** Aliquots left as a row of tubes, so stock reads at a glance. */
function AliquotMeter({ count, status, max = 10 }: { count: number; status: string; max?: number }) {
  const tone = statusMeta(status).tone;
  if (status === "discarded") return <span className="pl-meter tone-gone" aria-label="Discarded">—</span>;
  return <span className={`pl-meter tone-${tone}`} role="img" aria-label={`${aliquotsText(count)} left`}>
    {count === 0 ? <i className="none"/> : Array.from({ length: Math.min(count, max) }, (_, index) => <i key={index}/>)}
    {count > max && <small>+{count - max}</small>}
  </span>;
}

function ProteinCard({ record, selected, onSelect }: { record: LibraryProtein; selected: boolean; onSelect: () => void }) {
  const place = locationText(record);
  const volume = record.status === "discarded" ? "" : remainingVolume(record);
  const subtitle = [record.constructName || record.geneName, record.purificationMethod].filter(Boolean).join(" · ");
  return <button id={`pl-item-${record.id}`} role="option" aria-selected={selected} tabIndex={selected ? 0 : -1} className={`pl-card tone-${statusMeta(record.status).tone}`} onClick={onSelect}>
    <span className="pl-card-top">
      <StatusBadge status={record.status}/>
      <TemperatureChip value={record.storageTemperature}/>
      {record.favorite && <Star className="pl-star filled" aria-label="Favourite"/>}
    </span>
    <strong className="pl-card-name">{record.name}</strong>
    <small className="pl-card-sub">{subtitle || record.organism || "No construct recorded"}</small>
    <span className="pl-card-numbers">
      <Figure value={formatNumber(record.concentrationValue)} unit={displayUnit(record.concentrationUnit)}/>
      <Figure value={formatNumber(record.purityPercent)} unit="% pure"/>
      <Figure value={volume.split(" ")[0]} unit={volume ? `${volume.split(" ")[1]} left` : "volume"}/>
    </span>
    <span className="pl-card-stock"><AliquotMeter count={record.aliquotCount} status={record.status}/><small>{record.status === "discarded" ? "Discarded" : `${aliquotsText(record.aliquotCount)} left`}</small></span>
    <span className="pl-card-foot">
      <MapPin/><span title={place}>{place || "Location not recorded"}</span>
      {record.storageDate && <small title={storedAgo(record.storageDate)}>{shortAge(record.storageDate)}</small>}
    </span>
  </button>;
}

function Figure({ value, unit }: { value: string; unit: string }) {
  return <span className={value ? "" : "unknown"}><b>{value || "—"}</b><small>{unit}</small></span>;
}

function ProteinRow({ record, selected, onSelect }: { record: LibraryProtein; selected: boolean; onSelect: () => void }) {
  const place = locationText(record);
  return <button id={`pl-item-${record.id}`} role="option" aria-selected={selected} tabIndex={selected ? 0 : -1} className="pl-row" onClick={onSelect}>
    <span className="pl-row-name"><strong>{record.name}{record.favorite && <Star className="pl-star filled" aria-label="Favourite"/>}</strong><small>{[record.constructName || record.geneName, record.purificationMethod].filter(Boolean).join(" · ") || record.organism || "—"}</small></span>
    <span className="pl-row-num">{formatQuantity(record.concentrationValue, record.concentrationUnit) || "—"}</span>
    <span className="pl-row-num">{record.status === "discarded" ? "—" : record.aliquotCount}{record.aliquotVolume && record.status !== "discarded" ? <small> × {formatQuantity(record.aliquotVolume, record.aliquotUnit)}</small> : null}</span>
    <span className="pl-row-place"><small>{record.storageTemperature}</small><span title={place}>{place || "—"}</span></span>
    <span className="pl-row-num" title={storedAgo(record.storageDate)}>{shortAge(record.storageDate) || "—"}</span>
    <span><StatusBadge status={record.status}/></span>
  </button>;
}

function ProteinDetail({ record, events, eventsFailed, busy, onFavorite, onEdit, onUse, onThaw, onMove, onDiscard, onRetry }: {
  record: LibraryProtein;
  events: ProteinEvent[] | undefined;
  eventsFailed: boolean;
  busy: string;
  onFavorite: () => void;
  onEdit: () => void;
  onUse: (count: number) => void;
  onThaw: () => void;
  onMove: () => void;
  onDiscard: () => void;
  onRetry: () => void;
}) {
  const [count, setCount] = useState(1);
  const crumbs = locationCrumbs(record);
  const discarded = record.status === "discarded";
  const usable = !discarded && record.aliquotCount > 0;
  const take = Math.min(Math.max(1, count), Math.max(1, record.aliquotCount));
  const facts: [string, string][] = [
    ["Gene", record.geneName],
    ["Organism", record.organism],
    ["Construct", record.constructName],
    ["Method", record.purificationMethod],
    ["Buffer", record.buffer],
  ];
  return <article className="pl-detail-card">
    <header>
      <span>
        <strong>{record.name}</strong>
        <small>{[record.geneName, record.organism].filter(Boolean).join(" · ") || "Purified batch"}</small>
      </span>
      <Button variant="ghost" size="icon-sm" aria-pressed={record.favorite} aria-label={record.favorite ? "Remove from favourites" : "Add to favourites"} title={record.favorite ? "Remove from favourites" : "Add to favourites"} disabled={busy === `fav:${record.id}`} onClick={onFavorite}><Star className={record.favorite ? "pl-star filled" : "pl-star"}/></Button>
      <Button variant="outline" size="sm" onClick={onEdit}><Pencil/> Edit</Button>
    </header>

    <div className="pl-detail-status">
      <StatusBadge status={record.status}/>
      {record.storageDate && <span>{storedAgo(record.storageDate)}</span>}
    </div>

    <div className="pl-stats">
      <Stat label="Concentration" value={formatQuantity(record.concentrationValue, record.concentrationUnit)}/>
      <Stat label="Volume left" value={discarded ? "" : remainingVolume(record)}/>
      <Stat label="Yield" value={formatQuantity(record.yieldValue, record.yieldUnit)}/>
      <Stat label="Purity" value={record.purityPercent === null ? "" : `${formatNumber(record.purityPercent)} %`} bar={record.purityPercent}/>
    </div>

    <section className="pl-section">
      <h3>Storage</h3>
      {crumbs.length
        ? <ol className="pl-crumbs" aria-label="Storage location">
            {crumbs.map((crumb, index) => <li key={`${crumb.label}-${index}`}>
              {index > 0 && <ChevronRight aria-hidden="true"/>}
              <span><small>{crumb.label}</small><strong>{crumb.value}</strong></span>
            </li>)}
          </ol>
        : <p className="pl-muted">No location recorded. Edit the batch to add its freezer, shelf, rack, box and position.</p>}
      <dl className="pl-facts">
        <div><dt>Temperature</dt><dd>{record.storageTemperature ? <TemperatureChip value={record.storageTemperature}/> : "Not recorded"}</dd></div>
        <div><dt>Stored</dt><dd>{record.storageDate ? <>{formatDay(record.storageDate)} <small>· {storedAgo(record.storageDate).replace(/^Stored /, "")}</small></> : "Not recorded"}</dd></div>
      </dl>
    </section>

    <section className="pl-section">
      <h3>Aliquots</h3>
      <div className="pl-stock">
        <AliquotMeter count={record.aliquotCount} status={record.status} max={16}/>
        <span className="pl-stock-text"><strong>{discarded ? "Discarded" : `${aliquotsText(record.aliquotCount)} left`}</strong>{!discarded && record.aliquotVolume !== null && <small>{formatQuantity(record.aliquotVolume, record.aliquotUnit)} each</small>}</span>
      </div>
      <div className="pl-actions">
        <span className="pl-stepper" aria-label="Aliquots to use">
          <button aria-label="One fewer" disabled={!usable || take <= 1} onClick={() => setCount(take - 1)}><Minus/></button>
          <output aria-live="polite">{take}</output>
          <button aria-label="One more" disabled={!usable || take >= record.aliquotCount} onClick={() => setCount(take + 1)}><Plus/></button>
        </span>
        <Button size="sm" disabled={!usable || Boolean(busy)} onClick={() => { onUse(take); setCount(1); }}>{busy === `use:${record.id}` ? <LoaderCircle className="spin"/> : <Pipette/>} Use {take === 1 ? "aliquot" : `${take} aliquots`}</Button>
      </div>
      <div className="pl-actions secondary">
        <Button size="sm" variant="outline" disabled={discarded || Boolean(busy)} onClick={onMove}><ArrowRightLeft/> Move</Button>
        <Button size="sm" variant="outline" disabled={discarded || Boolean(busy)} onClick={onThaw}>{busy === `thaw:${record.id}` ? <LoaderCircle className="spin"/> : <Thermometer/>} Log thaw</Button>
        <Button size="sm" variant="outline" className="pl-danger" disabled={discarded || Boolean(busy)} onClick={onDiscard}><Ban/> Discard</Button>
      </div>
    </section>

    {(facts.some(([, value]) => value) || record.tags.length > 0 || record.notes) && <section className="pl-section">
      <h3>Batch</h3>
      <dl className="pl-facts">
        {facts.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
        {record.tags.length > 0 && <div><dt>Tags</dt><dd className="pl-tags">{record.tags.map((tag) => <span key={tag}>{tag}</span>)}</dd></div>}
      </dl>
      {record.notes && <p className="pl-notes">{record.notes}</p>}
    </section>}

    <section className="pl-section">
      <h3><History/> History</h3>
      {eventsFailed
        ? <p className="pl-muted">The history could not be loaded. <button className="pl-link" onClick={onRetry}>Retry</button></p>
        : events === undefined
        ? <p className="pl-muted"><LoaderCircle className="spin"/> Loading the history…</p>
        : events.length === 0
        ? <p className="pl-muted">Nothing recorded yet. Using, moving or thawing the batch adds an entry here.</p>
        : <ol className="pl-timeline">
            {events.map((event) => {
              const summary = eventSummary(event);
              return <li key={event.id} className={`event-${event.eventType}`}>
                <i aria-hidden="true"/>
                <span>
                  <strong>{summary.title}</strong>
                  {summary.detail && <small>{summary.detail}</small>}
                  {event.notes && <small className="pl-event-note">{event.notes}</small>}
                </span>
                <time dateTime={event.occurredAt}>{/^\d{4}-\d{2}-\d{2}$/.test(event.occurredAt) ? formatDay(event.occurredAt) : formatDateTime(event.occurredAt)}</time>
              </li>;
            })}
          </ol>}
    </section>
  </article>;
}

function Stat({ label, value, bar }: { label: string; value: string; bar?: number | null }) {
  return <div className={`pl-stat ${value ? "" : "unknown"}`}>
    <small>{label}</small>
    <strong>{value || "—"}</strong>
    {bar !== undefined && bar !== null && <span className="pl-bar" aria-hidden="true"><i style={{ width: `${Math.max(0, Math.min(100, bar))}%` }}/></span>}
  </div>;
}

// ---------------------------------------------------------------------------
// Dialogs. Radix supplies focus trapping and Escape; they portal into the
// app shell so each appearance's tokens apply.
// ---------------------------------------------------------------------------

function Sheet({ container, open, onClose, title, description, wide, children }: { container: HTMLElement | null; open: boolean; onClose: () => void; title: string; description: string; wide?: boolean; children: React.ReactNode }) {
  return <DialogPrimitive.Root open={open} onOpenChange={(next) => { if (!next) onClose(); }}>
    <DialogPrimitive.Portal container={container}>
      <DialogPrimitive.Overlay className="pl-overlay"/>
      <DialogPrimitive.Content className={`pl-dialog ${wide ? "wide" : ""}`}>
        <header>
          <span>
            <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description>{description}</DialogPrimitive.Description>
          </span>
          <DialogPrimitive.Close className="pl-dialog-close" aria-label="Close"><X/></DialogPrimitive.Close>
        </header>
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  </DialogPrimitive.Root>;
}

function ProteinFormDialog({ container, modal, busy, failure, onClose, onSave, onDelete }: { container: HTMLElement | null; modal: Modal; busy: boolean; failure: string; onClose: () => void; onSave: (form: ProteinForm, existing?: LibraryProtein) => Promise<FormErrors>; onDelete: (record: LibraryProtein) => void }) {
  const open = modal?.kind === "add" || modal?.kind === "edit";
  const existing = modal?.kind === "edit" ? modal.record : undefined;
  return <Sheet container={container} open={open} onClose={onClose} wide title={existing ? `Edit ${existing.name}` : "Add a purified protein"} description={existing ? "Changes are saved to this batch. Use the quick actions to record use, moves and discards so they appear in its history." : "Record the batch as it goes into storage. Only the name is required."}>
    {open && <ProteinFormBody key={existing?.id ?? "new"} existing={existing} busy={busy} failure={failure} onCancel={onClose} onSave={onSave} onDelete={onDelete}/>}
  </Sheet>;
}

function ProteinFormBody({ existing, busy, failure, onCancel, onSave, onDelete }: { existing?: LibraryProtein; busy: boolean; failure: string; onCancel: () => void; onSave: (form: ProteinForm, existing?: LibraryProtein) => Promise<FormErrors>; onDelete: (record: LibraryProtein) => void }) {
  const [form, setForm] = useState<ProteinForm>(() => existing ? recordToForm(existing) : emptyForm());
  const [errors, setErrors] = useState<FormErrors>({});
  const set = (key: keyof ProteinForm) => (event: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => {
    const value = event.target.value;
    setForm((current) => ({ ...current, [key]: value }));
    if (errors[key]) setErrors((current) => ({ ...current, [key]: undefined }));
  };
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    const found = await onSave(form, existing);
    setErrors(found);
    const first = Object.keys(found).find((key) => found[key as keyof ProteinForm]);
    if (first) document.getElementById(`pl-field-${first}`)?.focus();
  }
  const field = (key: keyof ProteinForm, label: string, extra: React.InputHTMLAttributes<HTMLInputElement> = {}) => <label className={`pl-field ${errors[key] ? "invalid" : ""}`}>
    <span>{label}</span>
    <input id={`pl-field-${key}`} value={form[key]} onChange={set(key)} aria-invalid={Boolean(errors[key])} {...extra}/>
    {errors[key] && <small>{errors[key]}</small>}
  </label>;
  const withUnit = (key: keyof ProteinForm, unitKey: keyof ProteinForm, label: string, units: string[]) => <label className={`pl-field ${errors[key] ? "invalid" : ""}`}>
    <span>{label}</span>
    <span className="pl-unit-input">
      <input id={`pl-field-${key}`} inputMode="decimal" value={form[key]} onChange={set(key)} aria-invalid={Boolean(errors[key])}/>
      <select value={form[unitKey]} onChange={set(unitKey)} aria-label={`${label} unit`}>{[...new Set([form[unitKey], ...units])].filter(Boolean).map((unit) => <option key={unit}>{unit}</option>)}</select>
    </span>
    {errors[key] && <small>{errors[key]}</small>}
  </label>;
  return <form className="pl-form" onSubmit={(event) => void submit(event)} noValidate>
    <div className="pl-form-scroll">
      <fieldset>
        <legend>Protein</legend>
        <div className="pl-grid two">
          {field("name", "Name *", { autoFocus: true, placeholder: "e.g. His-TEV-HBB batch 3" })}
          {field("constructName", "Construct", { placeholder: "e.g. pET-28a(+) HBB" })}
          {field("geneName", "Gene", { placeholder: "e.g. HBB" })}
          {field("organism", "Organism", { placeholder: "e.g. Homo sapiens" })}
          {field("tags", "Tags", { placeholder: "Comma separated — His6, TEV-cleaved" })}
          {field("purificationMethod", "Purification method", { placeholder: "e.g. Ni-NTA → SEC" })}
        </div>
      </fieldset>
      <fieldset>
        <legend>Amount and quality</legend>
        <div className="pl-grid three">
          {withUnit("concentrationValue", "concentrationUnit", "Concentration", CONCENTRATION_UNITS)}
          {withUnit("yieldValue", "yieldUnit", "Total yield", YIELD_UNITS)}
          {field("purityPercent", "Purity (%)", { inputMode: "decimal", placeholder: "e.g. 95" })}
        </div>
        {field("buffer", "Buffer", { placeholder: "e.g. 20 mM HEPES pH 7.5, 150 mM NaCl, 5% glycerol" })}
      </fieldset>
      <fieldset>
        <legend>Storage</legend>
        <div className="pl-grid three">
          {field("storageDate", "Date stored", { type: "date" })}
          <label className="pl-field"><span>Temperature</span>
            <select value={form.storageTemperature} onChange={set("storageTemperature")}>
              {[...new Set([form.storageTemperature, ...TEMPERATURES])].map((value) => <option key={value || "none"} value={value}>{value || "Not recorded"}</option>)}
            </select>
          </label>
          <span/>
          {field("aliquotCount", "Aliquots", { inputMode: "numeric", placeholder: "e.g. 12" })}
          {withUnit("aliquotVolume", "aliquotUnit", "Volume each", VOLUME_UNITS)}
        </div>
        <div className="pl-grid five">
          {LOCATION_LEVELS.map((level) => <span key={level.key}>{field(level.key, level.label, { placeholder: placeholderFor(level.key) })}</span>)}
        </div>
      </fieldset>
      <label className="pl-field"><span>Notes</span><textarea rows={3} value={form.notes} onChange={set("notes")} placeholder="Anything the next person should know: activity, aggregation, freeze–thaw sensitivity…"/></label>
    </div>
    <FormFailure text={failure}/>
    <footer>
      {existing && <Button type="button" variant="ghost" className="pl-danger" onClick={() => onDelete(existing)}><Trash2/> Delete batch</Button>}
      <span className="pl-spacer"/>
      <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      <Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <Check/>} {existing ? "Save changes" : "Add to library"}</Button>
    </footer>
  </form>;
}

function placeholderFor(key: string) {
  return ({ freezer: "−80 #2", shelf: "Shelf 3", rack: "Rack B", box: "Box 7", position: "C4" } as Record<string, string>)[key] ?? "";
}

function MoveDialog({ container, modal, busy, failure, onClose, onMove }: { container: HTMLElement | null; modal: Modal; busy: boolean; failure: string; onClose: () => void; onMove: (record: LibraryProtein, parts: LocationParts, note: string) => void }) {
  const record = modal?.kind === "move" ? modal.record : null;
  return <Sheet container={container} open={Boolean(record)} onClose={onClose} title={record ? `Move ${record.name}` : ""} description="Record where the batch now lives. The move is added to its history.">
    {record && <MoveBody key={record.id} record={record} busy={busy} failure={failure} onCancel={onClose} onMove={onMove}/>}
  </Sheet>;
}

function MoveBody({ record, busy, failure, onCancel, onMove }: { record: LibraryProtein; busy: boolean; failure: string; onCancel: () => void; onMove: (record: LibraryProtein, parts: LocationParts, note: string) => void }) {
  const [parts, setParts] = useState<LocationParts>({ freezer: record.freezer, shelf: record.shelf, rack: record.rack, box: record.box, position: record.position });
  const [note, setNote] = useState("");
  const from = locationText(record);
  return <form className="pl-form" onSubmit={(event) => { event.preventDefault(); onMove(record, parts, note); }}>
    <p className="pl-muted"><MapPin/> Now: {from || "not recorded"}</p>
    <div className="pl-grid five">
      {LOCATION_LEVELS.map((level, index) => <label key={level.key} className="pl-field"><span>{level.label}</span><input autoFocus={index === 0} value={parts[level.key]} placeholder={placeholderFor(level.key)} onChange={(event) => { const value = event.target.value; setParts((current) => ({ ...current, [level.key]: value })); }}/></label>)}
    </div>
    <label className="pl-field"><span>Note</span><input value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional — e.g. freezer defrost"/></label>
    <FormFailure text={failure}/>
    <footer>
      <span className="pl-spacer"/>
      <Button type="button" variant="outline" onClick={onCancel}>Cancel</Button>
      <Button type="submit" disabled={busy}>{busy ? <LoaderCircle className="spin"/> : <ArrowRightLeft/>} Move batch</Button>
    </footer>
  </form>;
}

function ConfirmDialog({ container, open, title, description, confirmLabel, withNote, busy, failure, onClose, onConfirm }: { container: HTMLElement | null; open: boolean; title: string; description: string; confirmLabel: string; withNote: boolean; busy: boolean; failure: string; onClose: () => void; onConfirm: (note: string) => void }) {
  const [note, setNote] = useState("");
  return <Sheet container={container} open={open} onClose={() => { setNote(""); onClose(); }} title={title} description={description}>
    <form className="pl-form" onSubmit={(event) => { event.preventDefault(); onConfirm(note); setNote(""); }}>
      {withNote && <label className="pl-field"><span>Reason</span><input autoFocus value={note} onChange={(event) => setNote(event.target.value)} placeholder="Optional — e.g. precipitated after thaw"/></label>}
      <FormFailure text={failure}/>
      <footer>
        <span className="pl-spacer"/>
        <Button type="button" variant="outline" autoFocus={!withNote} onClick={() => { setNote(""); onClose(); }}>Cancel</Button>
        <Button type="submit" variant="destructive" disabled={busy}>{busy ? <LoaderCircle className="spin"/> : withNote ? <Ban/> : <Trash2/>} {confirmLabel}</Button>
      </footer>
    </form>
  </Sheet>;
}

function FormFailure({ text }: { text: string }) {
  return text ? <p className="pl-form-error" role="alert"><CircleAlert/> {text}</p> : null;
}

function message(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
