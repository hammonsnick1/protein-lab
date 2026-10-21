"use client";

import { useEffect, useRef, useState } from "react";
import { ArrowRight, CircleAlert, Download, ExternalLink, Folder, Globe, Hash, LoaderCircle, Lock, Pencil, Star, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { ProteinRecord } from "@/lib/protein-labs-api";
import { KIND_STYLE, formatBp, keyFeatures, vectorTagline } from "@/lib/vector-library";
import { COLOR_LABELS, addTags, normalizeTag, removeTags, type Collection, type ColorLabel, type OrganizedVector } from "@/lib/vector-library-organize";
import { InlineName, MiniMap, VectorMoreMenu, relativeDay, type MenuEntry } from "@/components/protein-labs/vector-library-parts";

export type SourceDescriptor = { id: string; name: string; summary: string; needsSet: boolean; annotated: boolean; attribution: string };
export type ExternalResult = { id: string; name: string; description: string; lengthBp: number | null; set: string };

function TargetPicker({ proteins, projectId, targetId, onTarget }: { proteins: ProteinRecord[]; projectId?: string; targetId: string; onTarget: (id: string) => void }) {
  if (projectId) return null;
  if (!proteins.length) return <small className="vl-target-empty">Create a project to put this vector to use.</small>;
  return <label className="vl-target">Project
    <select value={targetId} onChange={(event) => onTarget(event.target.value)}>
      {proteins.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>)}
    </select>
  </label>;
}

/** Tag chips with a free-text box; Enter or comma adds, Backspace on an empty box removes the last. */
export function TagEditor({ tags, suggestions, onChange, inputRef }: { tags: string[]; suggestions: string[]; onChange: (tags: string[]) => void; inputRef?: React.RefObject<HTMLInputElement | null> }) {
  const [draft, setDraft] = useState("");
  const listId = "vl-tag-suggestions";
  const commit = () => { const tag = normalizeTag(draft); if (tag) onChange(addTags(tags, [tag])); setDraft(""); };
  return <div className="vl-tag-editor" onClick={() => inputRef?.current?.focus()}>
    {tags.map((tag) => <span key={tag} className="vl-tag-pill"><Hash/>{tag}<button onClick={(event) => { event.stopPropagation(); onChange(removeTags(tags, [tag])); }} aria-label={`Remove tag ${tag}`}><X/></button></span>)}
    <input
      ref={inputRef}
      value={draft}
      list={listId}
      placeholder={tags.length ? "Add tag" : "Add a tag, e.g. lab stock"}
      aria-label="Add a tag"
      onChange={(event) => { const value = event.target.value; if (value.includes(",")) { onChange(addTags(tags, value.split(","))); setDraft(""); } else setDraft(value); }}
      onKeyDown={(event) => {
        event.stopPropagation();
        if (event.key === "Enter") { event.preventDefault(); commit(); }
        if (event.key === "Backspace" && !draft && tags.length) onChange(tags.slice(0, -1));
        if (event.key === "Escape") { setDraft(""); (event.target as HTMLInputElement).blur(); }
      }}
      onBlur={commit}
    />
    <datalist id={listId}>{suggestions.filter((tag) => !tags.some((entry) => entry.toLowerCase() === tag.toLowerCase())).map((tag) => <option key={tag} value={tag}/>)}</datalist>
  </div>;
}

function NotesEditor({ value, readOnlyHint, onSave }: { value: string; readOnlyHint?: string; onSave: (notes: string) => void }) {
  const [draft, setDraft] = useState(value);
  const [saved, setSaved] = useState<"idle" | "saving" | "saved">("idle");
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (timer.current) clearTimeout(timer.current); }, []);
  const schedule = (next: string) => {
    setDraft(next); setSaved("saving");
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => { onSave(next); setSaved("saved"); }, 600);
  };
  return <label className="vl-notes">
    <span>Notes{saved === "saving" ? <small>Saving…</small> : saved === "saved" ? <small>Saved</small> : null}</span>
    <textarea value={draft} rows={3} placeholder={readOnlyHint ?? "Cloning notes, where the glycerol stock is, who made it…"} onChange={(event) => schedule(event.target.value)} onKeyDown={(event) => event.stopPropagation()} onBlur={() => { if (timer.current) { clearTimeout(timer.current); timer.current = null; if (draft !== value) { onSave(draft); setSaved("saved"); } } }}/>
  </label>;
}

export function LocalPreview({
  vector, detail, busy, mode, proteins, projectId, targetId, collections, tagSuggestions, renaming, tagInputRef,
  onTarget, onUse, onFavorite, onDownload, onRename, onStartRename, onCancelRename, onColor, onTags, onNotes, onRemoveFromCollection, menu,
}: {
  vector: OrganizedVector;
  detail: OrganizedVector | "error" | undefined;
  busy: string;
  mode: "page" | "dialog";
  proteins: ProteinRecord[];
  projectId?: string;
  targetId: string;
  collections: Collection[];
  tagSuggestions: string[];
  renaming: boolean;
  tagInputRef: React.RefObject<HTMLInputElement | null>;
  onTarget: (id: string) => void;
  onUse: () => void;
  onFavorite: () => void;
  onDownload: () => void;
  onRename: (name: string) => void;
  onStartRename: () => void;
  onCancelRename: () => void;
  onColor: (color: ColorLabel | null) => void;
  onTags: (tags: string[]) => void;
  onNotes: (notes: string) => void;
  onRemoveFromCollection: (collectionId: string) => void;
  menu: () => MenuEntry[];
}) {
  const features = detail && detail !== "error" ? detail.features ?? [] : [];
  const key = keyFeatures(features, 7);
  const memberOf = collections.filter((collection) => vector.collectionIds.includes(collection.id));
  const facts: [string, string][] = [
    ["Host", vector.host.join(", ")],
    ["Promoter", [vector.promoter.join(", "), vector.inducer.length ? `(${vector.inducer.join(", ")})` : ""].filter(Boolean).join(" ")],
    ["Tags", vectorTagline(vector)],
    ["Marker", vector.selectionMarker],
    ["Origin", vector.origin],
    ["Copy number", vector.copyNumber],
    ["Supplier", vector.supplier],
    ["Added", vector.createdAt ? relativeDay(vector.createdAt) : ""],
    ["Last used", vector.lastUsedAt ? relativeDay(vector.lastUsedAt) : ""],
  ];
  return <article className="vl-card">
    <header>
      <span>
        {renaming
          ? <InlineName className="vl-rename-title" value={vector.name} editing onCommit={onRename} onCancel={onCancelRename}/>
          : <strong className="vl-card-title">
              {vector.name}
              {vector.isStandard
                ? <Lock className="vl-lock" aria-label="Standard catalogue vector: name and sequence are read-only"/>
                : <button className="vl-title-edit" onClick={onStartRename} aria-label="Rename" title="Rename (F2)"><Pencil/></button>}
            </strong>}
        <small>{formatBp(vector.lengthBp)} · {vector.circular ? "circular" : "linear"} · {vector.featureCount} features</small>
      </span>
      <span className="vl-card-head-actions">
        <Button variant="ghost" size="icon-sm" aria-pressed={vector.favorite} aria-label={vector.favorite ? "Remove from favourites" : "Add to favourites"} title={vector.favorite ? "Remove from favourites (F)" : "Add to favourites (F)"} disabled={busy === `fav:${vector.id}`} onClick={onFavorite}>
          <Star className={vector.favorite ? "vl-star filled" : "vl-star"}/>
        </Button>
        <VectorMoreMenu className="vl-more static" label={`${vector.name} actions`} entries={menu}/>
      </span>
    </header>

    <div className="vl-card-map">
      {detail === undefined
        ? <div className="vl-map-placeholder"><LoaderCircle className="spin"/><small>Drawing the map…</small></div>
        : detail === "error"
        ? <div className="vl-map-placeholder"><CircleAlert/><small>The map could not be loaded.</small></div>
        : <MiniMap name={vector.name} lengthBp={vector.lengthBp} features={features}/>}
    </div>

    {key.length > 0 && <ul className="vl-key-features" aria-label="Key features">
      {key.map((feature) => <li key={`${feature.name}-${feature.start}`}>
        <i style={{ background: KIND_STYLE[feature.kind].color }}/>
        <span>{feature.name}</span>
        <small>{KIND_STYLE[feature.kind].label} · {(feature.start + 1).toLocaleString("en-US")}–{feature.end.toLocaleString("en-US")}</small>
      </li>)}
    </ul>}

    <section className="vl-organize" aria-label="Organise">
      <div className="vl-color-row" role="radiogroup" aria-label="Colour label">
        <span>Label</span>
        {COLOR_LABELS.map((color) => <button key={color.id} role="radio" aria-checked={vector.color === color.id} aria-label={color.label} title={color.label} className="vl-swatch" style={{ "--swatch": color.swatch } as React.CSSProperties} onClick={() => onColor(vector.color === color.id ? null : color.id)}/>)}
        <button role="radio" aria-checked={vector.color === null} aria-label="No colour" title="No colour" className="vl-swatch none" onClick={() => onColor(null)}/>
      </div>
      <div className="vl-organize-field">
        <span>Tags</span>
        <TagEditor tags={vector.tags} suggestions={tagSuggestions} onChange={onTags} inputRef={tagInputRef}/>
      </div>
      {memberOf.length > 0 && <div className="vl-organize-field">
        <span>In collections</span>
        <div className="vl-member-chips">{memberOf.map((collection) => <span key={collection.id} className="vl-tag-pill"><Folder/>{collection.name}<button onClick={() => onRemoveFromCollection(collection.id)} aria-label={`Remove from ${collection.name}`}><X/></button></span>)}</div>
      </div>}
      <NotesEditor value={vector.notes ?? ""} onSave={onNotes}/>
    </section>

    <dl className="vl-facts">
      {facts.filter(([, value]) => value).map(([label, value]) => <div key={label}><dt>{label}</dt><dd>{value}</dd></div>)}
      {vector.insertName && <div><dt>Insert</dt><dd>{vector.insertName}</dd></div>}
      {vector.projects.length > 0 && <div><dt>Used in</dt><dd>{vector.projects.map((use) => use.proteinName).join(", ")}</dd></div>}
    </dl>

    <div className="vl-provenance">
      <strong>Source and licence</strong>
      {vector.sourceUrl ? <a href={vector.sourceUrl} target="_blank" rel="noreferrer">{shortUrl(vector.sourceUrl)} <ExternalLink/></a> : <small>{vector.isStandard ? "Source not recorded" : vector.provenance === "project" ? "Saved from a project in this workspace" : "Imported into this workspace's library"}</small>}
      {vector.license && <small>{vector.license}{vector.licenseUrl && <> <a href={vector.licenseUrl} target="_blank" rel="noreferrer">Terms <ExternalLink/></a></>}</small>}
    </div>

    <footer>
      <TargetPicker proteins={proteins} projectId={projectId} targetId={targetId} onTarget={onTarget}/>
      <div>
        <Button variant="outline" size="sm" disabled={busy === `dl:${vector.id}`} onClick={onDownload}>{busy === `dl:${vector.id}` ? <LoaderCircle className="spin"/> : <Download/>} GenBank</Button>
        <Button size="sm" disabled={!targetId || Boolean(busy)} onClick={onUse}>{busy === `use:${vector.id}` ? <LoaderCircle className="spin"/> : <ArrowRight/>} {mode === "dialog" ? "Load into this project" : "Use in project"}</Button>
      </div>
    </footer>
  </article>;
}

export function ExternalPreview({ source, result, busy, mode, proteins, projectId, targetId, onTarget, onUse }: {
  source: SourceDescriptor | undefined;
  result: ExternalResult;
  busy: boolean;
  mode: "page" | "dialog";
  proteins: ProteinRecord[];
  projectId?: string;
  targetId: string;
  onTarget: (id: string) => void;
  onUse: () => void;
}) {
  return <article className="vl-card">
    <header>
      <span>
        <strong className="vl-card-title">{result.name}</strong>
        <small>{result.lengthBp ? formatBp(result.lengthBp) : "Size shown after loading"} · {source?.name ?? "External source"}</small>
      </span>
    </header>
    <div className="vl-card-map">
      <div className="vl-map-placeholder"><Globe/><small>{source?.annotated ? "Curated annotations arrive when it is loaded." : "Protein Lab annotates the sequence after download."}</small></div>
    </div>
    {result.description && <p className="vl-external-description">{result.description}</p>}
    <dl className="vl-facts">
      <div><dt>Identifier</dt><dd>{result.id}</dd></div>
      {result.set && <div><dt>Set</dt><dd>{result.set}</dd></div>}
    </dl>
    {source?.attribution && <div className="vl-provenance"><strong>Source and licence</strong><small>{source.attribution}</small></div>}
    <footer>
      <TargetPicker proteins={proteins} projectId={projectId} targetId={targetId} onTarget={onTarget}/>
      <div>
        <Button size="sm" disabled={!targetId || busy} onClick={onUse}>{busy ? <LoaderCircle className="spin"/> : <Download/>} {mode === "dialog" ? "Load into this project" : "Use in project"}</Button>
      </div>
    </footer>
    <small className="vl-card-hint">Loading it saves a copy in the library, where it can be favourited, tagged and collected.</small>
  </article>;
}

/** Space-bar preview: a large map and the facts that decide a backbone, over the results. */
export function QuickLook({ vector, detail, onClose, onUse, mode }: { vector: OrganizedVector; detail: OrganizedVector | "error" | undefined; onClose: () => void; onUse: () => void; mode: "page" | "dialog" }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => { ref.current?.focus(); }, [vector.id]);
  const features = detail && detail !== "error" ? detail.features ?? [] : [];
  const key = keyFeatures(features, 10);
  return <div className="vl-quicklook-backdrop" onClick={onClose}>
    <div ref={ref} className="vl-quicklook" role="dialog" aria-modal="true" aria-label={`Quick look: ${vector.name}`} tabIndex={-1} onClick={(event) => event.stopPropagation()} onKeyDown={(event) => {
      if (event.key === " " || event.key === "Escape") { event.preventDefault(); event.stopPropagation(); onClose(); }
      if (event.key === "Enter") { event.preventDefault(); event.stopPropagation(); onUse(); }
    }}>
      <header>
        <span><strong>{vector.name}</strong><small>{formatBp(vector.lengthBp)} · {vector.featureCount} features · {[vector.host.join(", "), vector.promoter.join(", "), vectorTagline(vector), vector.selectionMarker].filter(Boolean).join(" · ")}</small></span>
        <Button variant="ghost" size="icon-sm" onClick={onClose} aria-label="Close quick look"><X/></Button>
      </header>
      <div className="vl-quicklook-body">
        {detail === undefined ? <div className="vl-map-placeholder"><LoaderCircle className="spin"/><small>Drawing the map…</small></div> : <MiniMap name={vector.name} lengthBp={vector.lengthBp} features={features} size={360}/>}
        {key.length > 0 && <ul className="vl-key-features" aria-label="Key features">
          {key.map((feature) => <li key={`${feature.name}-${feature.start}`}>
            <i style={{ background: KIND_STYLE[feature.kind].color }}/>
            <span>{feature.name}</span>
            <small>{KIND_STYLE[feature.kind].label} · {(feature.start + 1).toLocaleString("en-US")}–{feature.end.toLocaleString("en-US")}</small>
          </li>)}
        </ul>}
      </div>
      <footer><small><kbd>Space</kbd> or <kbd>Esc</kbd> closes · <kbd>Enter</kbd> {mode === "dialog" ? "loads it into this project" : "uses it in a project"}</small><Button size="sm" onClick={onUse}><ArrowRight/>{mode === "dialog" ? "Load into this project" : "Use in project"}</Button></footer>
    </div>
  </div>;
}

function shortUrl(url: string) {
  try { const parsed = new URL(url); return `${parsed.hostname.replace(/^www\./, "")}${parsed.pathname.length > 1 ? parsed.pathname : ""}`; }
  catch { return url; }
}
