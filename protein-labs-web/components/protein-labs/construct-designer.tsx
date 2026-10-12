"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Check, CircleAlert, Clipboard, LoaderCircle, Scissors, TriangleAlert } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JsonObject } from "@/lib/protein-labs-api";
import { proteinLabsApi } from "@/lib/protein-labs-api";
import {
  assembleConstruct,
  cleanPeptide,
  cleavageSiteForProtease,
  findTagModule,
  linkerOptions,
  tagCandidatesFromVector,
  tagModules,
  type AssembledConstruct,
  type ConstructPlan,
  type ConstructSegment,
} from "@/lib/construct-catalog";

const segmentColors: Record<ConstructSegment["kind"], string> = {
  met: "#8d9aa3",
  tag: "#4d9de0",
  linker: "#9aa7b0",
  site: "#e5533d",
  scar: "#f0a43a",
  target: "#35b99a",
};

export type ConstructMetrics = {
  lengthAa: number;
  massDa: number;
  pI: number;
  extinctionReduced: number;
  extinctionOxidized: number;
  absorbanceReduced: number;
  absorbanceOxidized: number;
};

export type ConstructReport = {
  plan: ConstructPlan;
  construct: AssembledConstruct;
  fusion: ConstructMetrics | null;
  cleaved: ConstructMetrics | null;
  released: ConstructMetrics | null;
};

/**
 * Live construct designer.
 *
 * Mass and extinction coefficient are calculated by the same backend
 * ProtParam code that analyses the native protein, so the fusion and the
 * cleaved product are directly comparable with the Protein properties job
 * rather than being approximated in the browser.
 */
export function ConstructDesigner({
  targetSequence,
  targetName,
  affinityTagLabel,
  proteaseId,
  plan,
  onPlanChange,
  vectors,
  onReport,
  stage,
}: {
  targetSequence: string;
  targetName: string;
  affinityTagLabel: string;
  proteaseId: string;
  plan: ConstructPlan;
  onPlanChange: (plan: ConstructPlan) => void;
  vectors: JsonObject[];
  onReport?: (report: ConstructReport) => void;
  /** "tag": Affinity capture sets the tag, linker and position, and shows the
   *  cleavage only if a protease is already chosen. "cleavage": Subtractive
   *  cleanup shows that tag read-only and applies the chosen protease. */
  stage: "tag" | "cleavage";
}) {
  const construct = useMemo(
    () => assembleConstruct(targetSequence, { ...plan, cleavageId: proteaseId }),
    [targetSequence, plan, proteaseId],
  );
  const site = cleavageSiteForProtease(proteaseId);
  const tag = findTagModule(plan.tagId);
  const [metrics, setMetrics] = useState<Record<string, ConstructMetrics | null>>({});
  const [busy, setBusy] = useState(false);
  const [failure, setFailure] = useState("");
  const [paste, setPaste] = useState("");
  const [copied, setCopied] = useState("");
  const cache = useRef(new Map<string, ConstructMetrics>());

  const vectorCandidates = useMemo(
    () => tagCandidatesFromVector(vectors.flatMap((vector) => (Array.isArray(vector.features) ? vector.features : []) as JsonObject[])),
    [vectors],
  );

  const analyze = useCallback(async (sequence: string) => {
    if (!sequence) return null;
    const cached = cache.current.get(sequence);
    if (cached) return cached;
    const { result } = await proteinLabsApi.analyzeSequence(sequence);
    const extinction = (result.extinctionCoefficient280 ?? {}) as JsonObject;
    const value: ConstructMetrics = {
      lengthAa: Number((result.sequence as JsonObject | undefined)?.length ?? sequence.length),
      massDa: Number(result.molecularWeightDa ?? 0),
      pI: Number(result.theoreticalPI ?? 0),
      extinctionReduced: Number(extinction.reducedMolarM1Cm1 ?? 0),
      extinctionOxidized: Number(extinction.oxidizedMolarM1Cm1 ?? 0),
      absorbanceReduced: Number(extinction.reducedAbsorbance01Percent ?? 0),
      absorbanceOxidized: Number(extinction.oxidizedAbsorbance01Percent ?? 0),
    };
    cache.current.set(sequence, value);
    return value;
  }, []);

  // Recalculate whenever the construct changes. The debounce keeps typing in
  // the paste box from issuing a request per keystroke.
  useEffect(() => {
    let active = true;
    const timer = setTimeout(() => {
      if (!construct.fusion) { setMetrics({}); return; }
      setBusy(true); setFailure("");
      Promise.all([
        analyze(construct.fusion),
        analyze(construct.cleaves ? construct.cleaved : ""),
        analyze(construct.released),
      ])
        .then(([fusion, cleaved, released]) => {
          if (!active) return;
          setMetrics({ fusion, cleaved, released });
        })
        .catch((reason: unknown) => { if (active) setFailure(reason instanceof Error ? reason.message : String(reason)); })
        .finally(() => { if (active) setBusy(false); });
    }, 250);
    return () => { active = false; clearTimeout(timer); };
  }, [construct.fusion, construct.cleaved, construct.released, construct.cleaves, analyze]);

  const report = useMemo<ConstructReport>(() => ({
    plan: { ...plan, cleavageId: proteaseId },
    construct,
    fusion: metrics.fusion ?? null,
    cleaved: metrics.cleaved ?? null,
    released: metrics.released ?? null,
  }), [plan, proteaseId, construct, metrics]);

  // The report is handed upward from an effect so a parent that stores it does
  // not force a render loop through this component.
  const reportRef = useRef(onReport);
  useEffect(() => { reportRef.current = onReport; }, [onReport]);
  useEffect(() => { reportRef.current?.(report); }, [report]);

  function update(patch: Partial<ConstructPlan>) { onPlanChange({ ...plan, ...patch }); }

  async function copy(label: string, sequence: string) {
    await navigator.clipboard.writeText(sequence);
    setCopied(label);
    setTimeout(() => setCopied(""), 1500);
  }

  const native = metrics.fusion && metrics.cleaved
    ? metrics.fusion.massDa - metrics.cleaved.massDa
    : 0;

  return <section className="construct-designer">
    <header>
      <span>
        <strong>Construct and recalculated properties</strong>
        <small>
          {stage === "tag"
            ? `${affinityTagLabel ? `Tag from the selected resin: ${affinityTagLabel}. ` : ""}Adding the tag and linker changes the sequence, mass and extinction coefficient.`
            : "The protease's site is inserted after the tag and linker from Affinity capture; cleavage leaves its scar on the target."}
        </small>
      </span>
      {busy && <LoaderCircle className="spin" />}
    </header>

    {stage === "cleavage" && <p className="construct-source">
      Set in Affinity capture: {plan.terminus === "N" ? "N-terminal" : "C-terminal"} {tag?.name ?? "no tag"} · {linkerOptions.find((option) => option.id === plan.linkerId)?.name ?? "no linker"}{plan.initiatorMet ? " · initiator Met" : ""}.
    </p>}

    {stage === "tag" && <div className="construct-controls">
      <label>Tag position
        <select value={plan.terminus} onChange={(event) => update({ terminus: event.target.value as "N" | "C" })}>
          <option value="N">N-terminal</option>
          <option value="C">C-terminal</option>
        </select>
      </label>
      <label>Affinity tag
        <select value={plan.tagId} onChange={(event) => update({ tagId: event.target.value, resolvedTagSequence: "", resolvedTagSource: "" })}>
          <option value="">No tag</option>
          {tagModules.map((option) => <option key={option.id} value={option.id}>{option.name}{option.requiresSource ? " (needs sequence)" : ""}</option>)}
        </select>
      </label>
      <label>Linker
        <select value={plan.linkerId} onChange={(event) => update({ linkerId: event.target.value })}>
          {linkerOptions.map((option) => <option key={option.id} value={option.id}>{option.name}{option.sequence ? ` · ${option.sequence}` : ""}</option>)}
        </select>
      </label>
      <label className="construct-checkbox">
        <input type="checkbox" checked={plan.initiatorMet} onChange={(event) => update({ initiatorMet: event.target.checked })} />
        <span>Initiator Met</span>
      </label>
    </div>}

    {stage === "tag" && construct.unresolvedTag && <div className="construct-resolve">
      <TriangleAlert />
      <div>
        <strong>{construct.unresolvedTag.name} needs its real sequence</strong>
        <small>{construct.unresolvedTag.note}</small>
        {vectorCandidates.length > 0 && <div className="construct-candidates">
          {vectorCandidates.map((candidate) => <button key={`${candidate.name}-${candidate.sequence.length}`} onClick={() => update({ resolvedTagSequence: candidate.sequence, resolvedTagSource: `${candidate.name} (vector annotation)` })}>
            <strong>{candidate.name}</strong><small>{candidate.sequence.length} aa from the saved vector</small>
          </button>)}
        </div>}
        <label>Or paste the tag sequence
          <textarea value={paste} spellCheck={false} onChange={(event) => setPaste(event.target.value)} placeholder="Paste the amino-acid sequence of the fusion partner" />
        </label>
        <Button size="sm" variant="outline" disabled={!cleanPeptide(paste)} onClick={() => update({ resolvedTagSequence: cleanPeptide(paste), resolvedTagSource: "Pasted by researcher" })}>
          <Check /> Use pasted sequence
        </Button>
      </div>
    </div>}

    {plan.resolvedTagSource && <p className="construct-source">{tag?.name} sequence: {plan.resolvedTagSource} · {cleanPeptide(plan.resolvedTagSequence ?? "").length} aa</p>}

    <div className="construct-ribbon" role="img" aria-label="Construct layout from N to C terminus">
      {construct.segments.map((segment, index) => <span
        key={`${segment.kind}-${index}`}
        className={segment.retained ? "retained" : ""}
        style={{ "--segment-color": segmentColors[segment.kind], flexGrow: Math.max(1, Math.round(Math.sqrt(segment.sequence.length) * 4)) } as React.CSSProperties}
        title={`${segment.label}: ${segment.sequence.length} aa (${segment.start + 1}–${segment.end})`}
      >
        <b>{segment.label}</b>
        <small>{segment.sequence.length} aa</small>
      </span>)}
    </div>
    <div className="construct-ribbon-key">
      <span>N terminus → C terminus</span>
      {construct.cleaves && <span><Scissors /> Shaded blocks are removed by {site?.name ?? "the protease"}</span>}
    </div>

    <div className="construct-metrics">
      <MetricCard title="Expressed fusion" subtitle={`${targetName} with tag`} sequence={construct.fusion} metrics={metrics.fusion} onCopy={copy} copied={copied} />
      {construct.cleaves
        ? <MetricCard title="After tag cleavage" subtitle={construct.scar ? `Retains ${construct.scar} scar` : "No residual scar"} sequence={construct.cleaved} metrics={metrics.cleaved} onCopy={copy} copied={copied} highlight />
        : <MetricCard title="After tag cleavage" subtitle={stage === "tag" && !proteaseId ? "Choose the protease in Subtractive cleanup" : "Tag retained — no cleavage step"} sequence="" metrics={null} onCopy={copy} copied={copied} />}
      <MetricCard title="Released tag fragment" subtitle={construct.cleaves ? "Removed during cleanup" : "Not applicable"} sequence={construct.released} metrics={metrics.released} onCopy={copy} copied={copied} />
    </div>

    {metrics.fusion && metrics.cleaved && native > 0 && <p className="construct-delta">
      Tag removal reduces the mass by {(native / 1000).toFixed(2)} kDa
      {metrics.fusion.extinctionReduced !== metrics.cleaved.extinctionReduced
        ? ` and the reduced extinction coefficient by ${(metrics.fusion.extinctionReduced - metrics.cleaved.extinctionReduced).toLocaleString()} M⁻¹cm⁻¹.`
        : ", and leaves the extinction coefficient unchanged because the tag contains no Trp, Tyr or Cys."}
    </p>}

    {failure && <div className="construct-warning error"><CircleAlert /><span>{failure}</span></div>}
    {construct.warnings.map((warning) => <div className="construct-warning" key={warning}><TriangleAlert /><span>{warning}</span></div>)}
  </section>;
}

function MetricCard({ title, subtitle, sequence, metrics, onCopy, copied, highlight = false }: {
  title: string;
  subtitle: string;
  sequence: string;
  metrics: ConstructMetrics | null | undefined;
  onCopy: (label: string, sequence: string) => Promise<void>;
  copied: string;
  highlight?: boolean;
}) {
  return <article className={highlight ? "highlight" : ""}>
    <header>
      <span><strong>{title}</strong><small>{subtitle}</small></span>
      {sequence && <Button variant="ghost" size="icon-sm" title="Copy sequence" onClick={() => void onCopy(title, sequence)}>
        {copied === title ? <Check /> : <Clipboard />}
      </Button>}
    </header>
    {metrics ? <dl>
      <div><dt>Length</dt><dd>{metrics.lengthAa.toLocaleString()} aa</dd></div>
      <div><dt>Molecular weight</dt><dd>{(metrics.massDa / 1000).toFixed(2)} kDa<em>{metrics.massDa.toFixed(2)} Da</em></dd></div>
      <div><dt>ε₂₈₀ reduced</dt><dd>{metrics.extinctionReduced.toLocaleString()} M⁻¹cm⁻¹<em>A₂₈₀ 0.1% = {metrics.absorbanceReduced.toFixed(3)}</em></dd></div>
      <div><dt>ε₂₈₀ cystines</dt><dd>{metrics.extinctionOxidized.toLocaleString()} M⁻¹cm⁻¹<em>A₂₈₀ 0.1% = {metrics.absorbanceOxidized.toFixed(3)}</em></dd></div>
      <div><dt>Theoretical pI</dt><dd>{metrics.pI.toFixed(2)}</dd></div>
    </dl> : <p className="construct-empty">{sequence ? "Calculating…" : "—"}</p>}
  </article>;
}
