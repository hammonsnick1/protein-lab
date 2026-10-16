"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { CircleAlert, CircleCheck, Dna, Info, LoaderCircle, Save, Scissors, TriangleAlert, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { CloningMethod, CloningPreview, JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { proteinLabsApi } from "@/lib/protein-labs-api";
import type { PreviewWarning } from "@/lib/vector-cloning";
import { dedupeSites, previewInsert } from "@/lib/vector-cloning";
import type { MapFeature } from "@/lib/vector-geometry";
import { MiniMap } from "@/components/protein-labs/vector-views";
import type { ViewVector } from "@/components/protein-labs/vector-views";

export type InsertionSite = {
  id: string;
  kind: "cloning-site" | "fusion-junction" | "restriction-site";
  label: string;
  featureType: string;
  start: number;
  end: number;
  strand: number;
  replaceRegion: boolean;
  recommended: boolean;
  reason: string;
  enzyme?: string;
  upstream: string;
  downstream: string;
  frame: {
    referenceName: string;
    offset: number;
    inFrame: boolean;
    padding: number;
  } | null;
};

const kindLabels: Record<InsertionSite["kind"], string> = {
  "cloning-site": "Cloning site",
  "fusion-junction": "Fusion junction",
  "restriction-site": "Restriction site",
};

const METHODS: { id: CloningMethod; label: string; hint: string }[] = [
  { id: "restriction-ligation", label: "Restriction & ligation", hint: "Double digest both constructs with two enzymes and ligate the insert fragment into the backbone." },
  { id: "gibson", label: "Gibson assembly", hint: "Join backbone and insert through terminal homology (≥ 20 bp overlaps)." },
  { id: "in-fusion", label: "In-Fusion", hint: "Join through 15 bp overlaps at the linearised vector ends." },
  { id: "gateway-lr", label: "Gateway LR", hint: "Move the attL-flanked entry region into a destination vector." },
  { id: "gateway-bp", label: "Gateway BP", hint: "Recombine an attB-flanked PCR product into a donor vector." },
];

/**
 * Put an insert into the loaded backbone, and show the product before
 * anything is committed: where it goes, the junction, the frame check, which
 * backbone features it replaces, and every warning.
 */
export function VectorCloningWorkspace({
  bundle, vectorId, vectorName, backbone, projectVectors, uniqueEnzymes, unsaved, onInserted,
}: {
  bundle: ProteinBundle;
  vectorId: string;
  vectorName: string;
  backbone: ViewVector;
  projectVectors: { id: string; name: string; length: number }[];
  uniqueEnzymes: string[];
  unsaved: boolean;
  onInserted: (vector: JsonObject, note: string) => Promise<void> | void;
}) {
  const [mode, setMode] = useState<"site" | "combine">("site");
  if (!vectorId) return <div className="cloning-empty"><Dna /><p>{unsaved ? "Save your changes first; cloning works on the saved construct." : "Load a vector backbone to start cloning."}</p></div>;
  return <div className="vclone">
    <div className="vseg vclone-mode" role="radiogroup" aria-label="Cloning approach">
      <button role="radio" aria-checked={mode === "site"} className={mode === "site" ? "active" : ""} onClick={() => setMode("site")}>Insert {bundle.protein.name} at a site</button>
      <button role="radio" aria-checked={mode === "combine"} className={mode === "combine" ? "active" : ""} onClick={() => setMode("combine")}>Combine two constructs</button>
    </div>
    {mode === "site"
      ? <SiteInsertion bundle={bundle} vectorId={vectorId} vectorName={vectorName} backbone={backbone} onInserted={onInserted} />
      : <CombineConstructs bundle={bundle} vectorId={vectorId} vectorName={vectorName} projectVectors={projectVectors} uniqueEnzymes={uniqueEnzymes} onInserted={onInserted} />}
  </div>;
}

function SiteInsertion({ bundle, vectorId, vectorName, backbone, onInserted }: { bundle: ProteinBundle; vectorId: string; vectorName: string; backbone: ViewVector; onInserted: (vector: JsonObject, note: string) => Promise<void> | void }) {
  const [sites, setSites] = useState<InsertionSite[]>([]);
  const [siteId, setSiteId] = useState("");
  const [mode, setMode] = useState<"protein" | "dna">("protein");
  const [host, setHost] = useState("ecoli");
  const [hosts, setHosts] = useState<{ id: string; name: string }[]>([]);
  const [insertDna, setInsertDna] = useState("");
  const [avoid, setAvoid] = useState<string[]>([]);
  const [keepFrame, setKeepFrame] = useState(true);
  const [featureName, setFeatureName] = useState(`${bundle.protein.name} CDS`);
  const [translation, setTranslation] = useState<JsonObject | null>(null);
  const [translating, setTranslating] = useState(false);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");

  const site = useMemo(() => sites.find((value) => value.id === siteId) ?? null, [sites, siteId]);
  const protein = bundle.protein.sequence;

  const refresh = useCallback(async () => {
    setLoading(true); setFailure("");
    try {
      const value = await proteinLabsApi.vectorInsertionSites(bundle.protein.id, vectorId);
      const list = dedupeSites(value.sites as InsertionSite[]);
      setSites(list);
      setSiteId((current) => (list.some((entry) => entry.id === current) ? current : list.find((entry) => entry.recommended)?.id ?? list[0]?.id ?? ""));
    } catch (reason) { setFailure(`Could not scan for insertion sites: ${message(reason)}`); }
    finally { setLoading(false); }
  }, [bundle.protein.id, vectorId]);

  // Loading the site list is exactly the data fetch this rule exempts; the
  // project's other loaders are written the same way.
  useEffect(() => { void refresh(); }, [refresh]);
  useEffect(() => {
    proteinLabsApi.constructHosts()
      .then((value) => setHosts(value.hosts as { id: string; name: string }[]))
      .catch(() => setHosts([]));
  }, []);

  // Back-translate as the choices change so the preview always shows real codons.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (mode !== "protein" || !protein) { setTranslation(null); return; }
      setTranslating(true);
      proteinLabsApi.backTranslate(protein, host, avoid)
        .then((value) => { if (active) setTranslation(value); })
        .catch((reason: unknown) => { if (active) setFailure(`Back-translation failed: ${message(reason)}`); })
        .finally(() => { if (active) setTranslating(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [mode, protein, host, avoid]);

  const enzymeOptions = useMemo(() => [...new Set(sites.filter((value) => value.enzyme).map((value) => value.enzyme as string))].sort(), [sites]);
  const insert = mode === "protein" ? String(translation?.dna ?? "") : insertDna;
  const preview = useMemo(() => site && insert ? previewInsert({ sequence: backbone.sequence, features: backbone.features }, site, insert, { keepFrame, name: featureName || "Insert" }) : null, [site, insert, backbone.sequence, backbone.features, keepFrame, featureName]);
  const warnings: PreviewWarning[] = [
    ...(preview?.warnings ?? []),
    ...(mode === "protein" && Array.isArray(translation?.remainingSites) && translation.remainingSites.length ? [{ level: "warning" as const, message: `The insert still contains ${(translation.remainingSites as string[]).join(", ")} sites; choose other cloning enzymes.` }] : []),
  ];
  const blocking = warnings.some((warning) => warning.level === "error");

  async function commit() {
    if (!site) return;
    setBusy(true); setFailure("");
    try {
      const vector = await proteinLabsApi.insertIntoVector(bundle.protein.id, vectorId, {
        ...(mode === "protein" ? { protein, host, avoidEnzymes: avoid } : { insertDna }),
        start: site.start,
        end: site.replaceRegion ? site.end : site.start,
        strand: site.strand,
        name: featureName.trim() || `${bundle.protein.name} CDS`,
        keepFrame,
      });
      await onInserted(vector, `${featureName} inserted at ${site.label}. The product is now the saved construct; undo with Ctrl+Z.`);
    } catch (reason) { setFailure(message(reason)); }
    finally { setBusy(false); }
  }

  return <div className="cloning-workspace">
    <section className="cloning-sites">
      <header>
        <span><strong>1 · Choose where it goes</strong><small>{vectorName}</small></span>
        {loading ? <LoaderCircle className="spin" aria-label="Scanning" /> : <Button variant="ghost" size="sm" onClick={() => void refresh()}>Rescan</Button>}
      </header>
      <div className="cloning-site-list">
        {sites.map((entry) => <button key={entry.id} className={`${entry.id === siteId ? "selected" : ""} ${entry.kind}`} onClick={() => setSiteId(entry.id)}>
          <span className="cloning-site-head"><strong>{entry.label}</strong><em>{kindLabels[entry.kind]}</em></span>
          <small>{entry.reason}</small>
          <span className="cloning-site-meta">
            <b>{entry.replaceRegion ? `replaces ${entry.start + 1}–${entry.end}` : `after ${entry.start}`}</b>
            <b>{entry.strand < 0 ? "reverse" : "forward"}</b>
            {entry.recommended && <b className="frame-ok">recommended</b>}
            {entry.frame
              ? <b className={entry.frame.inFrame ? "frame-ok" : "frame-off"}>{entry.frame.inFrame ? `in frame with ${entry.frame.referenceName}` : `${entry.frame.offset} nt off ${entry.frame.referenceName}`}</b>
              : <b className="frame-unknown">no upstream frame</b>}
          </span>
        </button>)}
        {loading && !sites.length && <div className="vpanel-loading"><LoaderCircle className="spin" /> Scanning annotations for cloning sites…</div>}
        {!sites.length && !loading && !failure && <p className="cloning-empty-note">No annotated cloning site was found. Auto-annotate the vector, or insert from the Sequence tab.</p>}
      </div>
    </section>

    <section className="cloning-insert">
      <header><span><strong>2 · Choose the insert</strong><small>{bundle.protein.name} · {protein.length} aa</small></span></header>
      <div className="cloning-mode">
        <label className={mode === "protein" ? "selected" : ""}>
          <input type="radio" checked={mode === "protein"} onChange={() => setMode("protein")} />
          <span><strong>Back-translate the project protein</strong><small>Host-preferred codons</small></span>
        </label>
        <label className={mode === "dna" ? "selected" : ""}>
          <input type="radio" checked={mode === "dna"} onChange={() => setMode("dna")} />
          <span><strong>Paste my own DNA</strong><small>Synthesised or PCR insert</small></span>
        </label>
      </div>
      {mode === "protein" ? <div className="cloning-fields">
        <label>Codon usage
          <select value={host} onChange={(event) => setHost(event.target.value)}>
            {hosts.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        {enzymeOptions.length > 0 && <fieldset className="cloning-avoid">
          <legend>Keep these sites out of the insert</legend>
          <div>{enzymeOptions.map((enzyme) => <label key={enzyme}>
            <input type="checkbox" checked={avoid.includes(enzyme)} onChange={(event) => setAvoid(event.target.checked ? [...avoid, enzyme] : avoid.filter((value) => value !== enzyme))} />
            <span>{enzyme}</span>
          </label>)}</div>
        </fieldset>}
        {translating && <small className="vmuted"><LoaderCircle className="spin" /> Back-translating…</small>}
      </div> : <label className="cloning-dna">Insert DNA
        <textarea value={insertDna} spellCheck={false} onChange={(event) => setInsertDna(event.target.value.toUpperCase().replace(/[^ACGTN]/g, ""))} placeholder="Paste the coding sequence to insert" />
        <small>{insertDna.length} bp{insertDna.length % 3 ? " · not a multiple of 3" : ""}</small>
      </label>}
      <div className="cloning-fields">
        <label>Annotation name<input value={featureName} onChange={(event) => setFeatureName(event.target.value)} /></label>
        <label className="cloning-checkbox"><input type="checkbox" checked={keepFrame} onChange={(event) => setKeepFrame(event.target.checked)} /><span>Pad with G to keep the reading frame</span></label>
      </div>
    </section>

    <section className="cloning-preview-panel" aria-live="polite">
      <header><span><strong>3 · Check the product</strong><small>Nothing is changed until you commit</small></span></header>
      {!site && <div className="vpanel-empty">Choose an insertion site.</div>}
      {site && !preview && <div className="vpanel-empty">{translating ? "Preparing the insert…" : "Add the insert DNA to see the product."}</div>}
      {site && preview && <>
        <MiniMap vector={{ name: `${vectorName} + insert`, sequence: preview.sequence, circular: backbone.circular, features: preview.features as MapFeature[], cuts: [] }} highlight={preview.insertRange} />
        <dl className="vclone-facts">
          <div><dt>Product</dt><dd>{preview.sequence.length.toLocaleString()} bp ({preview.sequence.length - backbone.sequence.length >= 0 ? "+" : ""}{(preview.sequence.length - backbone.sequence.length).toLocaleString()})</dd></div>
          <div><dt>Insert</dt><dd>{(preview.insertRange.start + 1).toLocaleString()}–{preview.insertRange.end.toLocaleString()}</dd></div>
          <div><dt>Protein</dt><dd className="mono">{preview.translation.slice(0, 12)}{preview.translation.length > 12 ? "…" : ""}{preview.translation.length > 12 ? preview.translation.slice(-4) : ""}</dd></div>
        </dl>
        <div className="cloning-junction">
          <span className="junction-label">Junction</span>
          <code>
            <i>{site.upstream.slice(-18)}</i>
            {preview.paddingBases > 0 && <u title="Frame padding">{"G".repeat(preview.paddingBases).toLowerCase()}</u>}
            <b>{preview.sequence.slice(preview.insertRange.start + preview.paddingBases, preview.insertRange.start + preview.paddingBases + 12)}…{preview.sequence.slice(preview.insertRange.end - 9, preview.insertRange.end)}</b>
            <i>{site.downstream.slice(0, 18)}</i>
          </code>
        </div>
        <Warnings warnings={warnings} />
      </>}
      {failure && <div className="vpanel-error"><CircleAlert /><span>{failure}</span></div>}
      <Button disabled={busy || !site || !preview || blocking} onClick={() => void commit()} title={blocking ? "Resolve the errors above first" : undefined}>
        {busy ? <LoaderCircle className="spin" /> : <Scissors />} Commit insert into {vectorName}
      </Button>
    </section>
  </div>;
}

function CombineConstructs({ bundle, vectorId, vectorName, projectVectors, uniqueEnzymes, onInserted }: { bundle: ProteinBundle; vectorId: string; vectorName: string; projectVectors: { id: string; name: string; length: number }[]; uniqueEnzymes: string[]; onInserted: (vector: JsonObject, note: string) => Promise<void> | void }) {
  const [method, setMethod] = useState<CloningMethod>("restriction-ligation");
  const [insertId, setInsertId] = useState("");
  const [left, setLeft] = useState("");
  const [right, setRight] = useState("");
  const [overlap, setOverlap] = useState(20);
  const [region, setRegion] = useState({ start: 0, end: 0 });
  const [result, setResult] = useState<CloningPreview | null>(null);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");
  const [name, setName] = useState(`${vectorName} product`);
  const [saving, setSaving] = useState(false);
  const info = METHODS.find((entry) => entry.id === method) ?? METHODS[0];
  const ready = !!insertId && (method !== "restriction-ligation" || (left && right && left !== right));

  async function run() {
    setLoading(true); setFailure(""); setResult(null);
    try {
      const fields: JsonObject = method === "restriction-ligation" ? { backboneEnzymes: [left, right], insertEnzymes: [left, right] }
        : method.startsWith("gateway") ? { backboneStart: region.start, backboneEnd: region.end || undefined }
        : { minimumOverlap: overlap, circular: true };
      setResult(await proteinLabsApi.cloningPreview(bundle.protein.id, { method, backboneVectorId: vectorId, insertVectorId: insertId, ...fields }));
    } catch (reason) { setFailure(message(reason)); }
    finally { setLoading(false); }
  }

  async function save() {
    if (!result?.product) return;
    setSaving(true); setFailure("");
    try {
      const vector = await proteinLabsApi.createVector(bundle.protein.id, { name: name.trim() || `${vectorName} product`, sequence: result.product.sequence, circular: result.product.circular, features: result.product.features, history: [{ type: "CloningSimulation", method: result.method, backbone: vectorName, insert: projectVectors.find((entry) => entry.id === insertId)?.name ?? "" }] });
      await onInserted(vector, `${name} saved as a new construct from ${info.label}.`);
    } catch (reason) { setFailure(message(reason)); }
    finally { setSaving(false); }
  }

  const product = result?.product;
  return <div className="vcombine">
    <section className="vcombine-form">
      <label>Method<select value={method} onChange={(event) => { setMethod(event.target.value as CloningMethod); setResult(null); }}>{METHODS.map((entry) => <option key={entry.id} value={entry.id}>{entry.label}</option>)}</select><small>{info.hint}</small></label>
      <label>Backbone<input value={vectorName} disabled /></label>
      <label>Insert from<select value={insertId} onChange={(event) => { setInsertId(event.target.value); setResult(null); }}><option value="">Choose a saved construct</option>{projectVectors.map((entry) => <option key={entry.id} value={entry.id}>{entry.name} · {entry.length.toLocaleString()} bp</option>)}</select>{!projectVectors.length && <small>Import or save the insert (a PCR product or synthetic gene) as its own construct first.</small>}</label>
      {method === "restriction-ligation" && <div className="vcombine-pair">
        <label>Left enzyme<select value={left} onChange={(event) => { setLeft(event.target.value); setResult(null); }}><option value="">—</option>{uniqueEnzymes.map((enzyme) => <option key={enzyme} value={enzyme}>{enzyme}</option>)}</select></label>
        <label>Right enzyme<select value={right} onChange={(event) => { setRight(event.target.value); setResult(null); }}><option value="">—</option>{uniqueEnzymes.map((enzyme) => <option key={enzyme} value={enzyme}>{enzyme}</option>)}</select></label>
        {!uniqueEnzymes.length && <small>No unique cutters found yet; open Enzymes &amp; gel to analyse the backbone.</small>}
      </div>}
      {(method === "gibson" || method === "in-fusion") && <label>Minimum overlap (bp)<input type="number" min={12} max={60} value={overlap} onChange={(event) => setOverlap(Number(event.target.value))} /></label>}
      {method.startsWith("gateway") && <div className="vcombine-pair">
        <label>Replace from base<input type="number" min={0} value={region.start} onChange={(event) => setRegion({ ...region, start: Number(event.target.value) })} /></label>
        <label>to base<input type="number" min={0} value={region.end} onChange={(event) => setRegion({ ...region, end: Number(event.target.value) })} /></label>
      </div>}
      <Button disabled={!ready || loading} onClick={() => void run()}>{loading ? <LoaderCircle className="spin" /> : <WandSparkles />} Preview product</Button>
    </section>
    <section className="cloning-preview-panel" aria-live="polite">
      <header><span><strong>Product preview</strong><small>Simulated by the engine; nothing is saved yet</small></span></header>
      {loading && <div className="vpanel-loading"><LoaderCircle className="spin" /> Simulating {info.label.toLowerCase()}…</div>}
      {!loading && !result && !failure && <div className="vpanel-empty">Choose the insert{method === "restriction-ligation" ? " and two enzymes" : ""}, then preview.</div>}
      {failure && <div className="vpanel-error"><CircleAlert /><span>{failure}</span><Button size="sm" variant="outline" onClick={() => void run()}>Retry</Button></div>}
      {result && !product && <div className="vpanel-error"><CircleAlert /><span>These ends cannot produce a product.</span></div>}
      {product && <>
        <MiniMap vector={{ name, sequence: product.sequence, circular: product.circular, features: product.features.map(asFeature), cuts: [] }} />
        <dl className="vclone-facts"><div><dt>Product</dt><dd>{product.sequence.length.toLocaleString()} bp · {product.circular ? "circular" : "linear"}</dd></div><div><dt>Features</dt><dd>{product.features.length}</dd></div></dl>
      </>}
      {result && result.junctions.length > 0 && <ul className="vjunctions">{result.junctions.map((junction, index) => <li key={index}>{junctionText(junction, index)}</li>)}</ul>}
      {result && <Warnings warnings={result.warnings.map((warning) => ({ level: /incompatible|missing|internal_stop|frame_loss/.test(warning.code) ? "error" as const : "warning" as const, message: warning.message }))} />}
      {product && <div className="vcombine-save"><input value={name} onChange={(event) => setName(event.target.value)} aria-label="Product name" /><Button disabled={saving} onClick={() => void save()}>{saving ? <LoaderCircle className="spin" /> : <Save />} Save as new construct</Button></div>}
    </section>
  </div>;
}

function Warnings({ warnings }: { warnings: PreviewWarning[] }) {
  if (!warnings.length) return <div className="vwarn ok"><CircleCheck /><span>No problems found: in frame, no internal stops, no features lost.</span></div>;
  return <ul className="vwarn-list">{warnings.map((warning, index) => <li key={index} className={`vwarn ${warning.level}`}>{warning.level === "error" ? <CircleAlert /> : warning.level === "warning" ? <TriangleAlert /> : <Info />}<span>{warning.message}</span></li>)}</ul>;
}

function junctionText(junction: JsonObject, index: number) {
  const side = index === 0 ? "Left junction" : index === 1 ? "Right junction" : `Junction ${index + 1}`;
  const at = junction.position !== undefined ? ` at ${Number(junction.position).toLocaleString()}` : "";
  if ("compatible" in junction) {
    const end = (value: unknown) => { const item = value as { polarity?: string; sequence?: string } | undefined; return item ? `${item.polarity}${item.sequence ? ` ${item.sequence}` : ""}` : "?"; };
    return `${side}${at}: ${junction.compatible ? "compatible" : "incompatible"} ends (${end(junction.left)} / ${end(junction.right)})`;
  }
  if ("siteBefore" in junction) return `${side}${at}: ${String(junction.siteBefore)} → ${String(junction.siteAfter)}`;
  const overlapLength = junction.overlap ?? junction.overlapLength ?? junction.length;
  return `${side}${at}${overlapLength !== undefined ? `: ${String(overlapLength).length > 6 ? `${String(overlapLength).length} bp overlap` : `${String(overlapLength)} bp overlap`}` : ""}`;
}

function asFeature(raw: JsonObject, index: number): MapFeature {
  return { id: String(raw.id ?? `product-${index}`), name: String(raw.name ?? raw.type ?? "feature"), type: String(raw.type ?? "misc_feature"), start: Number(raw.start ?? 0), end: Number(raw.end ?? 0), strand: Number(raw.strand ?? 1), color: String(raw.color ?? ""), customColor: Boolean(raw.customColor) };
}

function message(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
