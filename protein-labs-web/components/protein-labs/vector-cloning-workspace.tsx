"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleAlert, CircleCheck, Dna, LoaderCircle, Scissors, TriangleAlert, WandSparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { proteinLabsApi } from "@/lib/protein-labs-api";

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

/**
 * Place the project's protein into the loaded backbone.
 *
 * The backbone's own annotations decide where an insert can go, and each
 * candidate states whether it lands in frame with the upstream tag, so the
 * researcher is choosing between clearly labelled sites rather than counting
 * bases in a raw sequence.
 */
export function VectorCloningWorkspace({
  bundle,
  vectorId,
  vectorName,
  onInserted,
}: {
  bundle: ProteinBundle;
  vectorId: string;
  vectorName: string;
  onInserted: (vector: JsonObject, note: string) => Promise<void> | void;
}) {
  const [sites, setSites] = useState<InsertionSite[]>([]);
  const [siteId, setSiteId] = useState("");
  const [mode, setMode] = useState<"protein" | "dna">("protein");
  const [host, setHost] = useState("ecoli");
  const [hosts, setHosts] = useState<{ id: string; name: string }[]>([]);
  const [insertDna, setInsertDna] = useState("");
  const [avoid, setAvoid] = useState<string[]>([]);
  const [keepFrame, setKeepFrame] = useState(true);
  const [featureName, setFeatureName] = useState(`${bundle.protein.name} CDS`);
  const [preview, setPreview] = useState<JsonObject | null>(null);
  const [report, setReport] = useState<JsonObject | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(false);
  const [failure, setFailure] = useState("");

  const site = useMemo(() => sites.find((value) => value.id === siteId) ?? null, [sites, siteId]);
  const protein = bundle.protein.sequence;

  const refresh = useCallback(async () => {
    if (!vectorId) { setSites([]); return; }
    setLoading(true); setFailure("");
    try {
      const value = await proteinLabsApi.vectorInsertionSites(bundle.protein.id, vectorId);
      const list = value.sites as InsertionSite[];
      setSites(list);
      setSiteId((current) => (list.some((entry) => entry.id === current) ? current : list[0]?.id ?? ""));
    } catch (reason) { setFailure(message(reason)); }
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

  // Show the codons that will be inserted before anything is committed.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (mode !== "protein" || !protein) { setPreview(null); return; }
      proteinLabsApi.backTranslate(protein, host, avoid)
        .then((value) => { if (active) setPreview(value); })
        .catch((reason: unknown) => { if (active) setFailure(message(reason)); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [mode, protein, host, avoid]);

  const enzymeOptions = useMemo(
    () => [...new Set(sites.filter((value) => value.enzyme).map((value) => value.enzyme as string))].sort(),
    [sites],
  );

  async function insert() {
    if (!site) { setFailure("Choose an insertion site first."); return; }
    setBusy(true); setFailure(""); setReport(null);
    try {
      const vector = await proteinLabsApi.insertIntoVector(bundle.protein.id, vectorId, {
        ...(mode === "protein" ? { protein, host, avoidEnzymes: avoid } : { insertDna }),
        start: site.start,
        end: site.replaceRegion ? site.end : site.start,
        strand: site.strand,
        name: featureName.trim() || `${bundle.protein.name} CDS`,
        keepFrame,
      });
      const insertReport = (vector.insertReport ?? null) as JsonObject | null;
      setReport(insertReport);
      await onInserted(vector, `${featureName} inserted at ${site.label}.`);
      await refresh();
    } catch (reason) { setFailure(message(reason)); }
    finally { setBusy(false); }
  }

  if (!vectorId) return <div className="cloning-empty"><Dna /><p>Load a vector backbone to start cloning.</p></div>;

  return <div className="cloning-workspace">
    <section className="cloning-sites">
      <header>
        <span><strong>Annotated insertion sites</strong><small>{vectorName}</small></span>
        {loading ? <LoaderCircle className="spin" /> : <Button variant="ghost" size="sm" onClick={() => void refresh()}>Rescan</Button>}
      </header>
      <div className="cloning-site-list">
        {sites.map((entry) => <button
          key={entry.id}
          className={`${entry.id === siteId ? "selected" : ""} ${entry.kind}`}
          onClick={() => setSiteId(entry.id)}
        >
          <span className="cloning-site-head">
            <strong>{entry.label}</strong>
            <em>{kindLabels[entry.kind]}</em>
          </span>
          <small>{entry.reason}</small>
          <span className="cloning-site-meta">
            <b>{entry.replaceRegion ? `replaces ${entry.start + 1}–${entry.end}` : `at ${entry.start + 1}`}</b>
            <b>{entry.strand < 0 ? "reverse strand" : "forward strand"}</b>
            {entry.frame
              ? <b className={entry.frame.inFrame ? "frame-ok" : "frame-off"}>
                  {entry.frame.inFrame
                    ? `in frame with ${entry.frame.referenceName}`
                    : `${entry.frame.offset} nt out of frame with ${entry.frame.referenceName}`}
                </b>
              : <b className="frame-unknown">no upstream reading frame found</b>}
          </span>
        </button>)}
        {!sites.length && !loading && <p className="cloning-empty-note">
          No annotated cloning site was found. Auto-annotate the vector, or insert from the Sequence tab.
        </p>}
      </div>
    </section>

    <section className="cloning-insert">
      <header><span><strong>Insert the target</strong><small>{bundle.protein.name} · {protein.length} aa</small></span></header>

      {site && <div className="cloning-junction">
        <span className="junction-label">Junction preview</span>
        <code>
          <i>{site.upstream.slice(-21)}</i>
          <b>▸ insert ◂</b>
          <i>{site.downstream.slice(0, 21)}</i>
        </code>
        {site.frame && !site.frame.inFrame && keepFrame && <small>
          {site.frame.padding} base{site.frame.padding === 1 ? "" : "s"} of Gly codon padding will be added to restore the reading frame.
        </small>}
        {site.frame && !site.frame.inFrame && !keepFrame && <small className="warn">
          This site is {site.frame.offset} nt out of frame and padding is switched off; the fusion will not translate correctly.
        </small>}
      </div>}

      <div className="cloning-mode">
        <label className={mode === "protein" ? "selected" : ""}>
          <input type="radio" checked={mode === "protein"} onChange={() => setMode("protein")} />
          <span><strong>Back-translate the project protein</strong><small>Uses the host&apos;s preferred codons</small></span>
        </label>
        <label className={mode === "dna" ? "selected" : ""}>
          <input type="radio" checked={mode === "dna"} onChange={() => setMode("dna")} />
          <span><strong>Paste my own DNA</strong><small>For a synthesized or PCR-amplified insert</small></span>
        </label>
      </div>

      {mode === "protein" ? <div className="cloning-fields">
        <label>Expression host codon usage
          <select value={host} onChange={(event) => setHost(event.target.value)}>
            {hosts.map((entry) => <option key={entry.id} value={entry.id}>{entry.name}</option>)}
          </select>
        </label>
        {enzymeOptions.length > 0 && <fieldset className="cloning-avoid">
          <legend>Avoid creating these sites inside the insert</legend>
          <div>
            {enzymeOptions.map((enzyme) => <label key={enzyme}>
              <input
                type="checkbox"
                checked={avoid.includes(enzyme)}
                onChange={(event) => setAvoid(event.target.checked ? [...avoid, enzyme] : avoid.filter((value) => value !== enzyme))}
              />
              <span>{enzyme}</span>
            </label>)}
          </div>
        </fieldset>}
        {preview && <div className="cloning-preview">
          <span>
            <strong>{Number(preview.aminoAcids ?? 0)} codons + stop</strong>
            <small>{String(preview.hostName ?? "")} preferred codons</small>
          </span>
          <code>{String(preview.dna ?? "").slice(0, 90)}{String(preview.dna ?? "").length > 90 ? "…" : ""}</code>
          {Array.isArray(preview.codonSwaps) && preview.codonSwaps.length > 0 && <small>
            {preview.codonSwaps.length} codon{preview.codonSwaps.length === 1 ? "" : "s"} changed to avoid a restriction site.
          </small>}
          {Array.isArray(preview.remainingSites) && preview.remainingSites.length > 0 && <small className="warn">
            Could not remove: {preview.remainingSites.join(", ")}. Choose different cloning enzymes.
          </small>}
          <p className="cloning-limitation">{String(preview.limitation ?? "")}</p>
        </div>}
      </div> : <label className="cloning-dna">Insert DNA
        <textarea value={insertDna} spellCheck={false} onChange={(event) => setInsertDna(event.target.value.toUpperCase().replace(/[^ACGTN]/g, ""))} placeholder="Paste the coding sequence to insert" />
        <small>{insertDna.length} bp{insertDna.length % 3 ? ` · not a multiple of 3` : ""}</small>
      </label>}

      <div className="cloning-fields">
        <label>Annotation name
          <input value={featureName} onChange={(event) => setFeatureName(event.target.value)} />
        </label>
        <label className="cloning-checkbox">
          <input type="checkbox" checked={keepFrame} onChange={(event) => setKeepFrame(event.target.checked)} />
          <span>Pad to keep the reading frame</span>
        </label>
      </div>

      <Button disabled={busy || !site || (mode === "dna" && !insertDna)} onClick={() => void insert()}>
        {busy ? <LoaderCircle className="spin" /> : <Scissors />} Insert into {vectorName}
      </Button>

      {report && <div className={`cloning-report ${report.inFrame === false ? "warn" : "ok"}`}>
        {report.inFrame === false ? <TriangleAlert /> : <CircleCheck />}
        <div>
          <strong>
            {Number(report.insertedBases ?? 0)} bases inserted
            {Number(report.removedBases ?? 0) > 0 ? `, ${Number(report.removedBases)} replaced` : ""}
          </strong>
          <ul>
            <li>{report.inFrame === true ? "In frame with the upstream reading frame." : report.inFrame === false ? "Not in frame with the upstream reading frame." : "No upstream reading frame to compare against."}</li>
            {Number(report.paddingBases ?? 0) > 0 && <li>{Number(report.paddingBases)} padding base(s) added to restore the frame.</li>}
            <li>{report.startsWithMet ? "Insert starts with Met." : "Insert does not start with Met."}</li>
            <li>{Array.isArray(report.internalStopCodons) && report.internalStopCodons.length
              ? `Internal stop codon(s) at residue ${(report.internalStopCodons as number[]).map((value) => value + 1).join(", ")}.`
              : "No internal stop codons."}</li>
          </ul>
        </div>
      </div>}

      {failure && <div className="cloning-failure"><CircleAlert /><span>{failure}</span></div>}
      {!sites.length && !loading && <Button variant="outline" onClick={() => void refresh()}><WandSparkles /> Rescan after annotating</Button>}
      {site?.recommended && <p className="cloning-hint"><Check /> This is a recommended site for a tagged construct.</p>}
    </section>
  </div>;
}

function message(value: unknown) {
  return value instanceof Error ? value.message : String(value);
}
