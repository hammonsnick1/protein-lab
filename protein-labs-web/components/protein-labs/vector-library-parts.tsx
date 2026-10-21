"use client";

import { useEffect, useRef, useState } from "react";
import { ContextMenu, DropdownMenu } from "radix-ui";
import {
  ArrowDown, ArrowDownAZ, ArrowUp, ArrowUpAZ, Check, ChevronDown, ChevronRight, Clock, Copy, Database, Download, Eye, FileInput, Folder, FolderPlus, GripVertical,
  Hash, Inbox, Layers, LayoutGrid, Library, List, MoreHorizontal, Palette, Pencil, Search, Star, Tag, Trash2, Undo2, Upload, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  FACETS, KIND_STYLE, SIZE_BUCKETS, arcPath, assignRings, featureKind, formatBp, vectorTagline,
  type FacetCounts, type FacetKey, type Filters, type MapFeature,
} from "@/lib/vector-library";
import {
  COLOR_LABELS, SMART_VIEWS, SORT_OPTIONS, colorSwatch, sameScope,
  type Collection, type ColorLabel, type OrganizedVector, type Scope, type SmartView, type SortKey, type SortOrder,
} from "@/lib/vector-library-organize";

export const VECTOR_DRAG_TYPE = "application/x-protein-lab-vectors";
const COLLECTION_DRAG_TYPE = "application/x-protein-lab-collection";

const VIEW_ICON: Record<SmartView, typeof Library> = { all: Library, favorites: Star, recent: Clock, imports: Upload, standard: Database, unsorted: Inbox };

// ---------------------------------------------------------------------------
// Mini map
// ---------------------------------------------------------------------------

/** A small circular map: backbone, features by kind on up to three rings, name and size in the middle. */
export function MiniMap({ name, lengthBp, features, size = 220, thumb = false }: { name: string; lengthBp: number; features: MapFeature[]; size?: number; thumb?: boolean }) {
  const centre = 110;
  const radius = thumb ? 70 : 78;
  const drawable = features.filter((feature) => feature.end !== feature.start);
  const rings = assignRings(drawable, lengthBp, 3);
  return <svg className={thumb ? "vl-minimap thumb" : "vl-minimap"} width={size} height={size} viewBox="0 0 220 220" role="img" aria-label={`Map of ${name}, ${formatBp(lengthBp)}, ${drawable.length} features`}>
    <circle cx={centre} cy={centre} r={radius} className="vl-minimap-backbone"/>
    {[0, 0.25, 0.5, 0.75].map((fraction) => {
      const angle = fraction * 2 * Math.PI;
      return <line key={fraction} className="vl-minimap-tick" x1={centre + (radius - 4) * Math.sin(angle)} y1={centre - (radius - 4) * Math.cos(angle)} x2={centre + (radius + 4) * Math.sin(angle)} y2={centre - (radius + 4) * Math.cos(angle)}/>;
    })}
    {drawable.map((feature, index) => {
      const style = KIND_STYLE[featureKind(feature)];
      const ringRadius = radius + (thumb ? 13 : 10) + rings[index] * (thumb ? 13 : 10);
      return <path key={`${feature.name}-${feature.start}-${index}`} d={arcPath(centre, centre, ringRadius, feature.start, feature.end, lengthBp)} stroke={style.color} strokeDasharray={style.dash} className="vl-minimap-feature">
        {!thumb && <title>{`${feature.name} · ${style.label} · ${(feature.start + 1).toLocaleString("en-US")}–${feature.end.toLocaleString("en-US")}`}</title>}
      </path>;
    })}
    {thumb
      ? <text x={centre} y={centre + 9} className="vl-minimap-thumb-size">{(lengthBp / 1000).toFixed(1)} kb</text>
      : <>
          <text x={centre} y={centre - 4} className="vl-minimap-name">{name.length > 18 ? `${name.slice(0, 17)}…` : name}</text>
          <text x={centre} y={centre + 13} className="vl-minimap-size">{formatBp(lengthBp)}</text>
        </>}
  </svg>;
}

// ---------------------------------------------------------------------------
// Menus: one list of actions, shown as a right-click menu or a "…" menu
// ---------------------------------------------------------------------------

export type MenuEntry =
  | { kind: "item"; label: string; icon?: React.ReactNode; shortcut?: string; disabled?: boolean; danger?: boolean; onSelect: () => void }
  | { kind: "sub"; label: string; icon?: React.ReactNode; disabled?: boolean; entries: MenuEntry[] }
  | { kind: "colors"; value: ColorLabel | null | "mixed"; onSelect: (color: ColorLabel | null) => void }
  | { kind: "label"; label: string }
  | { kind: "separator" };

type MenuParts = typeof ContextMenu | typeof DropdownMenu;

function MenuEntries({ entries, parts }: { entries: MenuEntry[]; parts: MenuParts }) {
  const P = parts as typeof DropdownMenu;
  return <>{entries.map((entry, index) => {
    if (entry.kind === "separator") return <P.Separator key={index} className="desktop-menu-separator"/>;
    if (entry.kind === "label") return <P.Label key={index} className="vl-menu-label">{entry.label}</P.Label>;
    if (entry.kind === "colors") return <div key={index} className="vl-menu-colors" role="group" aria-label="Colour label">
      <Palette/>
      {COLOR_LABELS.map((color) => <P.Item key={color.id} className="vl-menu-swatch" aria-label={color.label} title={color.label} onSelect={() => entry.onSelect(color.id)} style={{ "--swatch": color.swatch } as React.CSSProperties}>
        {entry.value === color.id && <Check/>}
      </P.Item>)}
      <P.Item className="vl-menu-swatch none" aria-label="No colour" title="No colour" onSelect={() => entry.onSelect(null)}>{entry.value === null && <Check/>}</P.Item>
    </div>;
    if (entry.kind === "sub") return <P.Sub key={index}>
      <P.SubTrigger className="desktop-menu-item" disabled={entry.disabled}>{entry.icon}<span>{entry.label}</span><ChevronRight className="vl-menu-chevron"/></P.SubTrigger>
      <P.Portal><P.SubContent className="desktop-menu-popover vl-menu" sideOffset={4} collisionPadding={8}><MenuEntries entries={entry.entries} parts={parts}/></P.SubContent></P.Portal>
    </P.Sub>;
    return <P.Item key={index} className={`desktop-menu-item ${entry.danger ? "vl-menu-danger" : ""}`} disabled={entry.disabled} onSelect={entry.onSelect}>
      {entry.icon}<span>{entry.label}</span>{entry.shortcut && <kbd>{entry.shortcut}</kbd>}
    </P.Item>;
  })}</>;
}

export function VectorContextMenu({ entries, onOpen, children }: { entries: () => MenuEntry[]; onOpen: () => void; children: React.ReactNode }) {
  const [items, setItems] = useState<MenuEntry[]>([]);
  return <ContextMenu.Root onOpenChange={(open) => { if (open) { onOpen(); setItems(entries()); } }}>
    <ContextMenu.Trigger asChild>{children}</ContextMenu.Trigger>
    <ContextMenu.Portal><ContextMenu.Content className="desktop-menu-popover vl-menu" collisionPadding={8}><MenuEntries entries={items} parts={ContextMenu}/></ContextMenu.Content></ContextMenu.Portal>
  </ContextMenu.Root>;
}

export function VectorMoreMenu({ entries, label, onOpen, className = "vl-more" }: { entries: () => MenuEntry[]; label: string; onOpen?: () => void; className?: string }) {
  const [items, setItems] = useState<MenuEntry[]>([]);
  return <DropdownMenu.Root onOpenChange={(open) => { if (open) { onOpen?.(); setItems(entries()); } }}>
    <DropdownMenu.Trigger asChild><button className={className} aria-label={label} title={label} onClick={(event) => event.stopPropagation()} onDoubleClick={(event) => event.stopPropagation()}><MoreHorizontal/></button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="desktop-menu-popover vl-menu" align="end" sideOffset={4} collisionPadding={8} onClick={(event) => event.stopPropagation()}><MenuEntries entries={items} parts={DropdownMenu}/></DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

export function MenuButton({ icon, label, entries, disabled }: { icon: React.ReactNode; label: string; entries: () => MenuEntry[]; disabled?: boolean }) {
  const [items, setItems] = useState<MenuEntry[]>([]);
  return <DropdownMenu.Root onOpenChange={(open) => { if (open) setItems(entries()); }}>
    <DropdownMenu.Trigger asChild><Button variant="outline" size="sm" disabled={disabled}>{icon}{label}<ChevronDown className="vl-caret"/></Button></DropdownMenu.Trigger>
    <DropdownMenu.Portal><DropdownMenu.Content className="desktop-menu-popover vl-menu" align="start" side="top" sideOffset={6} collisionPadding={8}><MenuEntries entries={items} parts={DropdownMenu}/></DropdownMenu.Content></DropdownMenu.Portal>
  </DropdownMenu.Root>;
}

export const MENU_ICONS = { open: <FileInput/>, look: <Eye/>, rename: <Pencil/>, star: <Star/>, collection: <Folder/>, newCollection: <FolderPlus/>, tag: <Tag/>, copy: <Copy/>, download: <Download/>, trash: <Trash2/>, remove: <X/>, check: <Check/> };

// ---------------------------------------------------------------------------
// Inline rename
// ---------------------------------------------------------------------------

export function InlineName({ value, editing, onCommit, onCancel, className = "" }: { value: string; editing: boolean; onCommit: (name: string) => void; onCancel: () => void; className?: string }) {
  const ref = useRef<HTMLInputElement>(null);
  const [draft, setDraft] = useState(value);
  // Mounted fresh for each rename, so the draft starts from the current name.
  useEffect(() => { if (editing) requestAnimationFrame(() => { ref.current?.focus(); ref.current?.select(); }); }, [editing]);
  if (!editing) return null;
  const finish = () => { const name = draft.trim(); if (name && name !== value) onCommit(name); else onCancel(); };
  return <input
    ref={ref}
    className={`vl-rename ${className}`}
    value={draft}
    aria-label="New name"
    maxLength={120}
    onChange={(event) => setDraft(event.target.value)}
    onClick={(event) => event.stopPropagation()}
    onDoubleClick={(event) => event.stopPropagation()}
    onKeyDown={(event) => {
      event.stopPropagation();
      if (event.key === "Enter") { event.preventDefault(); finish(); }
      if (event.key === "Escape") { event.preventDefault(); onCancel(); }
    }}
    onBlur={finish}
  />;
}

// ---------------------------------------------------------------------------
// Sidebar
// ---------------------------------------------------------------------------

export function LibrarySidebar({
  scope, onScope, viewCounts, collections, tags, facets, filters, sizes, sizeOptions, renamingCollection,
  onToggleFilter, onToggleSize, onClearFilters, onCreateCollection, onRenameCollection, onStartRename, onCancelRename, onDeleteCollection, onReorder, onDropVectors,
}: {
  scope: Scope;
  onScope: (scope: Scope) => void;
  viewCounts: Record<SmartView, number> | null;
  collections: Collection[];
  tags: { name: string; count: number }[];
  facets: FacetCounts;
  filters: Filters;
  sizes: string[];
  sizeOptions: { value: string; count: number }[];
  renamingCollection: string | null;
  onToggleFilter: (key: FacetKey, value: string) => void;
  onToggleSize: (value: string) => void;
  onClearFilters: () => void;
  onCreateCollection: () => void;
  onRenameCollection: (id: string, name: string) => void;
  onStartRename: (id: string) => void;
  onCancelRename: () => void;
  onDeleteCollection: (collection: Collection) => void;
  onReorder: (from: number, to: number) => void;
  onDropVectors: (collectionId: string, ids: string[]) => void;
}) {
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [allTags, setAllTags] = useState(false);
  const filterCount = Object.values(filters).reduce((sum, values) => sum + (values?.length ?? 0), 0) + sizes.length;
  const [filtersOpen, setFiltersOpen] = useState(filterCount > 0);
  const shownTags = allTags ? tags : tags.slice(0, 12);

  return <nav className="vl-sidebar" aria-label="Library organisation">
    <section className="vl-side-group">
      <h2>Library</h2>
      <ul role="list">
        {SMART_VIEWS.map((view) => {
          const Icon = VIEW_ICON[view.id];
          const active = sameScope(scope, { kind: "view", view: view.id });
          return <li key={view.id}>
            <button className={`vl-side-item ${active ? "active" : ""}`} aria-current={active ? "true" : undefined} title={view.hint} onClick={() => onScope({ kind: "view", view: view.id })}>
              <Icon className={view.id === "favorites" ? "vl-side-star" : ""}/><span>{view.label}</span><em>{viewCounts ? viewCounts[view.id] : ""}</em>
            </button>
          </li>;
        })}
      </ul>
    </section>

    <section className="vl-side-group">
      <h2>Collections<button className="vl-side-add" onClick={onCreateCollection} aria-label="New collection" title="New collection"><FolderPlus/></button></h2>
      {!collections.length && <p className="vl-side-hint">Group vectors by project, host or lab. <button onClick={onCreateCollection}>Create a collection</button></p>}
      <ul role="list">
        {collections.map((collection, index) => {
          const active = sameScope(scope, { kind: "collection", id: collection.id });
          const renaming = renamingCollection === collection.id;
          return <li
            key={collection.id}
            className={dropTarget === collection.id ? "vl-drop-target" : ""}
            draggable={!renaming}
            onDragStart={(event) => { event.dataTransfer.setData(COLLECTION_DRAG_TYPE, String(index)); event.dataTransfer.effectAllowed = "move"; }}
            onDragOver={(event) => {
              const types = event.dataTransfer.types;
              if (types.includes(VECTOR_DRAG_TYPE) || types.includes(COLLECTION_DRAG_TYPE)) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = types.includes(VECTOR_DRAG_TYPE) ? "copy" : "move"; setDropTarget(collection.id); }
            }}
            onDragLeave={() => setDropTarget((current) => current === collection.id ? null : current)}
            onDrop={(event) => {
              setDropTarget(null);
              const vectors = event.dataTransfer.getData(VECTOR_DRAG_TYPE);
              const from = event.dataTransfer.getData(COLLECTION_DRAG_TYPE);
              if (vectors) { event.preventDefault(); event.stopPropagation(); onDropVectors(collection.id, JSON.parse(vectors) as string[]); }
              else if (from !== "") { event.preventDefault(); event.stopPropagation(); onReorder(Number(from), index); }
            }}
          >
            {renaming
              ? <span className="vl-side-item editing"><Folder/><InlineName value={collection.name} editing onCommit={(name) => onRenameCollection(collection.id, name)} onCancel={onCancelRename}/></span>
              : <button className={`vl-side-item ${active ? "active" : ""}`} aria-current={active ? "true" : undefined} onClick={() => onScope({ kind: "collection", id: collection.id })} onDoubleClick={() => onStartRename(collection.id)}>
                  <GripVertical className="vl-grip" aria-hidden="true"/><Folder/><span>{collection.name}</span><em>{collection.count}</em>
                </button>}
            {!renaming && <VectorMoreMenu className="vl-side-more" label={`${collection.name} options`} entries={() => [
              { kind: "item", label: "Rename", icon: MENU_ICONS.rename, shortcut: "F2", onSelect: () => onStartRename(collection.id) },
              { kind: "item", label: "Move up", icon: <ArrowUp/>, disabled: index === 0, onSelect: () => onReorder(index, index - 1) },
              { kind: "item", label: "Move down", icon: <ArrowDown/>, disabled: index === collections.length - 1, onSelect: () => onReorder(index, index + 1) },
              { kind: "separator" },
              { kind: "item", label: "Delete collection", icon: MENU_ICONS.trash, danger: true, onSelect: () => onDeleteCollection(collection) },
            ]}/>}
          </li>;
        })}
      </ul>
    </section>

    <section className="vl-side-group">
      <h2>Tags</h2>
      {!tags.length && <p className="vl-side-hint">Tag vectors from the preview or the bulk bar to find them here.</p>}
      {tags.length > 0 && <div className="vl-tag-cloud">
        {shownTags.map((tag) => {
          const active = sameScope(scope, { kind: "tag", name: tag.name });
          return <button key={tag.name} className={`vl-tag-chip ${active ? "active" : ""}`} aria-pressed={active} onClick={() => onScope(active ? { kind: "view", view: "all" } : { kind: "tag", name: tag.name })}>
            <Hash/>{tag.name}<em>{tag.count}</em>
          </button>;
        })}
        {tags.length > 12 && <button className="vl-facet-more" onClick={() => setAllTags((value) => !value)}>{allTags ? "Fewer tags" : `All ${tags.length} tags`}</button>}
      </div>}
    </section>

    <section className="vl-side-group vl-filters">
      <h2>
        <button className="vl-filters-toggle" aria-expanded={filtersOpen} onClick={() => setFiltersOpen((value) => !value)}><ChevronRight className={filtersOpen ? "open" : ""}/>Filters{filterCount > 0 && <b>{filterCount}</b>}</button>
        {filterCount > 0 && <button className="vl-side-link" onClick={onClearFilters}>Clear</button>}
      </h2>
      {filtersOpen && <>
        {FACETS.map(({ key, label }) => <FacetGroup key={key} label={label} options={withSelected(facets[key], filters[key])} selected={filters[key] ?? []} onToggle={(value) => onToggleFilter(key, value)}/>)}
        <FacetGroup label="Size" options={sizeOptions.filter((option) => option.count || sizes.includes(option.value))} selected={sizes} labelFor={(value) => SIZE_BUCKETS.find((bucket) => bucket.id === value)?.label ?? value} onToggle={onToggleSize}/>
      </>}
    </section>
  </nav>;
}

function withSelected(counts: { value: string; count: number }[] | undefined, selected: string[] = []) {
  const options = [...(counts ?? [])];
  for (const value of selected) if (!options.some((option) => option.value === value)) options.push({ value, count: 0 });
  return options;
}

function FacetGroup({ label, options, selected, onToggle, labelFor = (value) => value }: { label: string; options: { value: string; count: number }[]; selected: string[]; onToggle: (value: string) => void; labelFor?: (value: string) => string }) {
  const [open, setOpen] = useState(selected.length > 0);
  const [expanded, setExpanded] = useState(false);
  if (!options.length) return null;
  const visible = expanded ? options : options.slice(0, 6);
  return <div className="vl-facet">
    <button className="vl-facet-head" aria-expanded={open} onClick={() => setOpen((value) => !value)}>
      <ChevronRight className={open ? "open" : ""}/><span>{label}</span>{selected.length > 0 && <b>{selected.length}</b>}
    </button>
    {open && <div className="vl-facet-body">
      {visible.map((option) => <label key={option.value} className={`vl-facet-option ${option.count === 0 ? "empty" : ""}`}>
        <input type="checkbox" checked={selected.includes(option.value)} onChange={() => onToggle(option.value)}/>
        <span title={labelFor(option.value)}>{labelFor(option.value)}</span>
        <em>{option.count}</em>
      </label>)}
      {options.length > 6 && <button className="vl-facet-more" onClick={() => setExpanded((value) => !value)}>{expanded ? "Show fewer" : `Show ${options.length - 6} more`}</button>}
    </div>}
  </div>;
}

// ---------------------------------------------------------------------------
// Results toolbar
// ---------------------------------------------------------------------------

export function ResultsToolbar({ layout, onLayout, sort, order, onSort, onOrder }: { layout: "grid" | "list"; onLayout: (layout: "grid" | "list") => void; sort: SortKey; order: SortOrder; onSort: (sort: SortKey) => void; onOrder: () => void }) {
  return <div className="vl-toolbar-controls">
    <label className="vl-sort">
      <span>Sort</span>
      <select value={sort} onChange={(event) => onSort(event.target.value as SortKey)} aria-label="Sort vectors by">
        {SORT_OPTIONS.map((option) => <option key={option.id} value={option.id}>{option.label}</option>)}
      </select>
      <button onClick={onOrder} aria-label={order === "asc" ? "Ascending, switch to descending" : "Descending, switch to ascending"} title={order === "asc" ? "Ascending" : "Descending"}>
        {order === "asc" ? <ArrowDownAZ/> : <ArrowUpAZ/>}
      </button>
    </label>
    <div className="vl-layout-toggle" role="radiogroup" aria-label="Layout">
      <button role="radio" aria-checked={layout === "grid"} title="Grid" aria-label="Grid" onClick={() => onLayout("grid")}><LayoutGrid/></button>
      <button role="radio" aria-checked={layout === "list"} title="List" aria-label="List" onClick={() => onLayout("list")}><List/></button>
    </div>
  </div>;
}

// ---------------------------------------------------------------------------
// Cards and table rows
// ---------------------------------------------------------------------------

export type ItemHandlers = {
  onClick: (event: React.MouseEvent, vector: OrganizedVector) => void;
  onCheck: (event: React.MouseEvent | React.KeyboardEvent, vector: OrganizedVector) => void;
  onOpen: (vector: OrganizedVector) => void;
  onFavorite: (vector: OrganizedVector) => void;
  onDragStart: (event: React.DragEvent, vector: OrganizedVector) => void;
  onRename: (vector: OrganizedVector, name: string) => void;
  onCancelRename: () => void;
  menu: (vector: OrganizedVector) => MenuEntry[];
  onMenuOpen: (vector: OrganizedVector) => void;
};

function provenanceLabel(vector: OrganizedVector) {
  if (vector.provenance === "standard") return "Standard";
  if (vector.provenance === "import") return "Imported";
  return vector.projectCount === 1 ? "1 project" : `${vector.projectCount} projects`;
}

export function VectorCard({ vector, features, selected, focused, renaming, checking, handlers }: { vector: OrganizedVector; features: MapFeature[] | "loading" | "error"; selected: boolean; focused: boolean; renaming: boolean; checking: boolean; handlers: ItemHandlers }) {
  const swatch = colorSwatch(vector.color);
  const tagline = [vector.promoter.join(", "), vectorTagline(vector), vector.selectionMarker].filter(Boolean).join(" · ");
  return <VectorContextMenu entries={() => handlers.menu(vector)} onOpen={() => handlers.onMenuOpen(vector)}>
    <div
      id={`vl-item-${vector.id}`}
      role="option"
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      className={`vl-vcard ${selected ? "selected" : ""} ${checking ? "checking" : ""}`}
      style={swatch ? { "--label": swatch } as React.CSSProperties : undefined}
      draggable={!renaming}
      onDragStart={(event) => handlers.onDragStart(event, vector)}
      onClick={(event) => handlers.onClick(event, vector)}
      onDoubleClick={() => handlers.onOpen(vector)}
    >
      <span className="vl-vcard-check" role="checkbox" aria-checked={selected} aria-label={`Select ${vector.name}`} onClick={(event) => { event.stopPropagation(); handlers.onCheck(event, vector); }}><Check/></span>
      <button className={`vl-vcard-star ${vector.favorite ? "on" : ""}`} aria-pressed={vector.favorite} aria-label={vector.favorite ? "Remove from favourites" : "Add to favourites"} title={vector.favorite ? "Remove from favourites (F)" : "Add to favourites (F)"} tabIndex={-1} onClick={(event) => { event.stopPropagation(); handlers.onFavorite(vector); }} onDoubleClick={(event) => event.stopPropagation()}><Star/></button>
      <VectorMoreMenu label={`${vector.name} actions`} onOpen={() => handlers.onMenuOpen(vector)} entries={() => handlers.menu(vector)}/>
      <div className="vl-vcard-map">
        {features === "loading" ? <span className="vl-skel-ring"/> : <MiniMap name={vector.name} lengthBp={vector.lengthBp} features={features === "error" ? [] : features} size={112} thumb/>}
      </div>
      <div className="vl-vcard-body">
        {renaming
          ? <InlineName value={vector.name} editing onCommit={(name) => handlers.onRename(vector, name)} onCancel={handlers.onCancelRename}/>
          : <strong title={vector.name}>{swatch && <i className="vl-dot" aria-label={`${vector.color} label`}/>}{vector.name}</strong>}
        <small className="vl-vcard-meta">{formatBp(vector.lengthBp)} · <span className={`vl-prov ${vector.provenance}`}>{provenanceLabel(vector)}</span></small>
        <small className="vl-vcard-tagline" title={tagline || undefined}>{tagline || vector.insertName || `${vector.featureCount} feature${vector.featureCount === 1 ? "" : "s"} annotated`}</small>
        {vector.tags.length > 0 && <span className="vl-vcard-tags">{vector.tags.slice(0, 3).map((tag) => <em key={tag}>{tag}</em>)}{vector.tags.length > 3 && <em>+{vector.tags.length - 3}</em>}</span>}
      </div>
    </div>
  </VectorContextMenu>;
}

export function TableHeader({ sort, order, onSort, allSelected, someSelected, onSelectAll }: { sort: SortKey; order: SortOrder; onSort: (sort: SortKey) => void; allSelected: boolean; someSelected: boolean; onSelectAll: () => void }) {
  const head = (key: SortKey | null, label: string, className = "") => <span role="columnheader" className={className} aria-sort={key && sort === key ? (order === "asc" ? "ascending" : "descending") : undefined}>
    {key ? <button onClick={() => onSort(key)}>{label}{sort === key && (order === "asc" ? <ArrowDownAZ/> : <ArrowUpAZ/>)}</button> : label}
  </span>;
  return <div className="vl-trow vl-thead" role="row">
    <span role="columnheader" className="vl-tcheck"><span className="vl-vcard-check" role="checkbox" aria-checked={allSelected ? true : someSelected ? "mixed" : false} aria-label="Select all" tabIndex={0} onClick={onSelectAll} onKeyDown={(event) => { if (event.key === " " || event.key === "Enter") { event.preventDefault(); onSelectAll(); } }}>{allSelected ? <Check/> : someSelected ? <span className="vl-mixed"/> : null}</span></span>
    {head("name", "Name", "vl-tname")}
    {head("size", "Size", "vl-tsize")}
    {head(null, "Promoter · tags · marker", "vl-tdesc")}
    {head(null, "Labels", "vl-ttags")}
    {head(null, "Source", "vl-tsrc")}
    {head("lastUsed", "Last used", "vl-tused")}
    <span role="columnheader" className="vl-tmore"/>
  </div>;
}

export function VectorRow({ vector, selected, focused, renaming, handlers }: { vector: OrganizedVector; selected: boolean; focused: boolean; renaming: boolean; handlers: ItemHandlers }) {
  const swatch = colorSwatch(vector.color);
  const tagline = [vector.promoter.join(", "), vectorTagline(vector), vector.selectionMarker].filter(Boolean).join(" · ");
  return <VectorContextMenu entries={() => handlers.menu(vector)} onOpen={() => handlers.onMenuOpen(vector)}>
    <div
      id={`vl-item-${vector.id}`}
      role="option"
      aria-selected={selected}
      tabIndex={focused ? 0 : -1}
      className={`vl-trow ${selected ? "selected" : ""}`}
      draggable={!renaming}
      onDragStart={(event) => handlers.onDragStart(event, vector)}
      onClick={(event) => handlers.onClick(event, vector)}
      onDoubleClick={() => handlers.onOpen(vector)}
    >
      <span className="vl-tcheck"><span className="vl-vcard-check" role="checkbox" aria-checked={selected} aria-label={`Select ${vector.name}`} onClick={(event) => { event.stopPropagation(); handlers.onCheck(event, vector); }}><Check/></span></span>
      <span className="vl-tname">
        <i className="vl-dot" style={swatch ? { background: swatch } : undefined} aria-label={vector.color ? `${vector.color} label` : undefined}/>
        {renaming ? <InlineName value={vector.name} editing onCommit={(name) => handlers.onRename(vector, name)} onCancel={handlers.onCancelRename}/> : <strong title={vector.name}>{vector.name}</strong>}
        <button className={`vl-tstar ${vector.favorite ? "on" : ""}`} tabIndex={-1} aria-pressed={vector.favorite} aria-label={vector.favorite ? "Remove from favourites" : "Add to favourites"} onClick={(event) => { event.stopPropagation(); handlers.onFavorite(vector); }} onDoubleClick={(event) => event.stopPropagation()}><Star/></button>
      </span>
      <span className="vl-tsize">{(vector.lengthBp / 1000).toFixed(1)} kb</span>
      <span className="vl-tdesc" title={tagline || undefined}>{tagline || vector.insertName || "—"}</span>
      <span className="vl-ttags">{vector.tags.slice(0, 2).map((tag) => <em key={tag}>{tag}</em>)}{vector.tags.length > 2 && <em>+{vector.tags.length - 2}</em>}</span>
      <span className="vl-tsrc"><span className={`vl-prov ${vector.provenance}`}>{provenanceLabel(vector)}</span></span>
      <span className="vl-tused">{vector.lastUsedAt ? relativeDay(vector.lastUsedAt) : "Never"}</span>
      <span className="vl-tmore"><VectorMoreMenu label={`${vector.name} actions`} onOpen={() => handlers.onMenuOpen(vector)} entries={() => handlers.menu(vector)}/></span>
    </div>
  </VectorContextMenu>;
}

export function ResultSkeletons({ layout }: { layout: "grid" | "list" }) {
  return <div className={layout === "grid" ? "vl-grid" : "vl-table"} aria-hidden="true">
    {Array.from({ length: layout === "grid" ? 8 : 9 }, (_, index) => layout === "grid"
      ? <div key={index} className="vl-vcard vl-skeleton"><div className="vl-vcard-map"><span className="vl-skel-ring"/></div><div className="vl-vcard-body"><span className="vl-skel-line w70"/><span className="vl-skel-line w40"/><span className="vl-skel-line w90"/></div></div>
      : <div key={index} className="vl-trow vl-skeleton"><span className="vl-skel-line w20"/><span className="vl-skel-line w70"/><span className="vl-skel-line w40"/><span className="vl-skel-line w90"/></div>)}
  </div>;
}

export function EmptyState({ icon, title, body, action }: { icon: React.ReactNode; title: string; body: string; action?: React.ReactNode }) {
  return <div className="vl-empty-state">
    <span className="vl-empty-icon">{icon}</span>
    <strong>{title}</strong>
    <small>{body}</small>
    {action}
  </div>;
}

export const EMPTY_ICONS = { search: <Search/>, star: <Star/>, clock: <Clock/>, upload: <Upload/>, folder: <Folder/>, tag: <Hash/>, inbox: <Inbox/>, library: <Layers/> };

// ---------------------------------------------------------------------------
// Bulk bar and undo toasts
// ---------------------------------------------------------------------------

export function BulkBar({ count, total, children, onClear, onSelectAll }: { count: number; total: number; children: React.ReactNode; onClear: () => void; onSelectAll: () => void }) {
  return <div className="vl-bulkbar" role="toolbar" aria-label={`${count} selected`}>
    <span className="vl-bulk-count"><strong>{count}</strong> selected{count < total && <button onClick={onSelectAll}>Select all {total}</button>}</span>
    <div className="vl-bulk-actions">{children}</div>
    <button className="vl-bulk-close" onClick={onClear} aria-label="Clear selection" title="Clear selection (Esc)"><X/></button>
  </div>;
}

export type Toast = { id: number; text: string; undo?: () => void; life: number; tone?: "info" | "error" };

export function ToastStack({ toasts, onDismiss }: { toasts: Toast[]; onDismiss: (id: number) => void }) {
  return <div className="vl-toasts" role="status" aria-live="polite">
    {toasts.map((toast) => <div key={toast.id} className={`vl-toast ${toast.tone === "error" ? "error" : ""}`} style={{ "--life": `${toast.life}ms` } as React.CSSProperties}>
      <span>{toast.text}</span>
      {toast.undo && <button className="vl-toast-undo" onClick={() => { toast.undo?.(); onDismiss(toast.id); }}><Undo2/> Undo</button>}
      <button className="vl-toast-close" onClick={() => onDismiss(toast.id)} aria-label="Dismiss"><X/></button>
      {toast.undo && <i className="vl-toast-timer" aria-hidden="true"/>}
    </div>)}
  </div>;
}

export function relativeDay(iso: string) {
  const then = new Date(iso);
  if (Number.isNaN(then.getTime())) return "";
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return "Today";
  if (days === 1) return "Yesterday";
  if (days < 30) return `${days} days ago`;
  return then.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
}
