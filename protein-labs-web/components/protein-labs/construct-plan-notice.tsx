"use client";

import { useEffect, useMemo, useState } from "react";
import { ArrowRight, CircleAlert, CircleCheck, Dna, LoaderCircle, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { ensureProjectJob, proteinLabsApi } from "@/lib/protein-labs-api";
import { saveBufferSteps } from "@/lib/purification-buffers";
import { appTypes, findAnnotatedConstruct, planFromConstruct, savedConstructUpdate, type ConstructUpdate, type PlanChange, type ProductMetrics, type SavedPlan, type StageId } from "@/lib/construct-plan-update";
import { readOligomericState, subunitCount } from "@/lib/oligomeric-state";

type Products = { fusion: ProductMetrics | null; cleaved: ProductMetrics | null };
const stages: StageId[] = ["affinity", "cleavage", "subtractive", "sec"];

/**
 * When a saved vector already carries the annotated construct (tag, protease
 * site and insert), this states the purification plan that construct implies
 * and what it would change, applies it only when asked, and afterwards keeps
 * saying what was changed and from which construct. Renders nothing when no
 * vector carries an annotated construct and no update was ever applied.
 */
export function ConstructPlanNotice({ bundle, vectors, onChanged, onApplied }: {
  bundle: ProteinBundle;
  vectors: JsonObject[];
  onChanged: () => Promise<void>;
  onApplied?: (update: ConstructUpdate) => void;
}) {
  const construct = useMemo(() => findAnnotatedConstruct(vectors, bundle.protein.sequence, bundle.protein.name), [vectors, bundle.protein.sequence, bundle.protein.name]);
  const [products, setProducts] = useState<Products | null>(null);
  const [failure, setFailure] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  // The engine's ProtParam gives the fusion's and the cleaved product's mass and pI.
  useEffect(() => {
    if (!construct) return;
    let active = true;
    setProducts(null); setFailure("");
    Promise.all([analyze(construct.fusion), construct.cleaves ? analyze(construct.cleaved) : Promise.resolve(null)])
      .then(([fusion, cleaved]) => { if (active) setProducts({ fusion, cleaved }); })
      .catch((reason: unknown) => { if (active) { setFailure(errorText(reason)); setProducts({ fusion: null, cleaved: null }); } });
    return () => { active = false; };
  }, [construct]);

  const saved = useMemo<SavedPlan>(() => ({
    affinity: config(bundle, appTypes.affinity), cleavage: config(bundle, appTypes.cleavage), subtractive: config(bundle, appTypes.subtractive), sec: config(bundle, appTypes.sec),
  }), [bundle]);
  const subunits = subunitCount(readOligomericState(config(bundle, "protparam")));
  const update = useMemo(() => construct && products ? planFromConstruct(construct, products, saved, { subunits, appliedAt: "" }) : null, [construct, products, saved, subunits]);
  const record = savedConstructUpdate(saved);
  const pending = update?.changes.some((change) => change.changed) ?? false;

  async function apply() {
    if (!construct || !products) return;
    setBusy(true); setError("");
    try {
      const final = planFromConstruct(construct, products, saved, { subunits, appliedAt: new Date().toISOString() });
      const proteinId = bundle.protein.id;
      const latest = await proteinLabsApi.getProtein(proteinId);
      for (const stage of stages) {
        const next = final.configs[stage];
        if (!next) continue;
        const existing = latest.projectJobs.find((job) => job.appType === appTypes[stage]);
        await ensureProjectJob(proteinId, latest.projectJobs, appTypes[stage], jobName(stage, next), next, existing?.status ?? "in_progress");
      }
      const refreshed = await proteinLabsApi.getProtein(proteinId);
      await saveBufferSteps(proteinId, refreshed.projectJobs, final.bufferSteps);
      onApplied?.(final);
      await onChanged();
    } catch (reason) {
      setError(errorText(reason));
    } finally {
      setBusy(false);
    }
  }

  if (!construct && !record) return null;

  if (construct && (!record || pending)) {
    const product = construct.cleaves ? products?.cleaved : products?.fusion;
    return <section className="construct-update pending" aria-live="polite">
      <header>
        <Dna aria-hidden="true"/>
        <span>
          <span className="eyebrow">ANNOTATED CONSTRUCT FOUND</span>
          <strong>Construct {construct.constructName} in vector {construct.vectorName} sets this plan</strong>
          <small className="construct-update-layout">{construct.layout}</small>
        </span>
      </header>
      <p className="construct-update-product">
        {construct.cleaves ? "Cleaved product" : "Purified fusion (no protease site annotated)"}: {construct.cleaves && construct.scar ? <>scar <b>{construct.scar}</b> + {bundle.protein.name}, </> : null}
        {construct.cleaved.length} aa{product ? `, ${(product.massDa / 1000).toFixed(1)} kDa, pI ${product.pI.toFixed(2)}` : products ? ", mass and pI estimated from length" : ""}.
      </p>
      {!products && <p className="construct-update-status"><LoaderCircle className="spin" aria-hidden="true"/> Calculating the product&rsquo;s mass and pI…</p>}
      {failure && <p className="construct-update-status warning"><CircleAlert aria-hidden="true"/> The engine could not calculate mass and pI ({failure}). Sizes below are estimated at about 110 Da per residue.</p>}
      {update && <ChangeList changes={update.changes}/>}
      {construct.warnings.map((warning) => <p key={warning} className="construct-update-status warning"><CircleAlert aria-hidden="true"/> {warning}</p>)}
      {record && <p className="construct-update-status">Last updated from a construct {formatDate(record.appliedAt)}; the saved plan has changed since.</p>}
      {error && <p className="construct-update-status error"><CircleAlert aria-hidden="true"/> {error}</p>}
      <footer>
        <small>Nothing changes until you apply it. Every job stays editable, and each one re-runs its checks when you save it.</small>
        <Button disabled={busy || !update} onClick={() => void apply()}>{busy ? <LoaderCircle className="spin"/> : <RefreshCw/>} Update plan from construct</Button>
      </footer>
    </section>;
  }

  // Applied, and nothing in the saved plan disagrees with the construct.
  const changed = (Array.isArray(record!.changes) ? record!.changes as PlanChange[] : []).filter((change) => change.changed);
  return <section className="construct-update applied" aria-live="polite">
    <header>
      <CircleCheck aria-hidden="true"/>
      <span>
        <span className="eyebrow">PLAN UPDATED FROM CONSTRUCT</span>
        <strong>{String(record!.summary ?? "")}</strong>
        {record!.layout ? <small className="construct-update-layout">{String(record!.layout)}</small> : null}
      </span>
    </header>
    {changed.length > 0 && <ChangeList changes={changed}/>}
    <footer><small>Applied {formatDate(record!.appliedAt)}. Reopen a job to adjust it; saving it re-runs its compatibility checks.</small></footer>
  </section>;
}

function ChangeList({ changes }: { changes: PlanChange[] }) {
  return <ol className="construct-update-changes">
    {changes.map((change) => <li key={change.stage} className={change.changed ? "changed" : "kept"}>
      <span className="construct-update-stage">{change.label}</span>
      <span className="construct-update-diff">
        {change.changed ? <>{change.before === "Not chosen" ? <span className="construct-update-was">Not chosen</span> : <s>{change.before}</s>}<ArrowRight aria-label="becomes"/><b>{change.after}</b></> : <><b>{change.after}</b><em>Unchanged</em></>}
        <small>{change.detail}</small>
      </span>
    </li>)}
  </ol>;
}

async function analyze(sequence: string): Promise<ProductMetrics> {
  const { result } = await proteinLabsApi.analyzeSequence(sequence);
  const extinction = (result.extinctionCoefficient280 ?? {}) as JsonObject;
  return { lengthAa: sequence.length, massDa: Number(result.molecularWeightDa ?? 0), pI: Number(result.theoreticalPI ?? 0), extinctionReduced: Number(extinction.reducedMolarM1Cm1 ?? 0) };
}
function jobName(stage: StageId, next: JsonObject) {
  if (stage === "affinity") return `Affinity capture — ${next.shortName}`;
  if (stage === "cleavage") return `Tag cleavage — ${next.proteaseName}`;
  if (stage === "subtractive") return `Subtractive cleanup — ${next.shortName}`;
  return `SEC polish — ${next.shortName}`;
}
function config(bundle: ProteinBundle, appType: string) { return bundle.projectJobs.find((job) => job.appType === appType)?.config ?? {}; }
function formatDate(value: unknown) { const date = new Date(String(value ?? "")); return Number.isNaN(date.getTime()) ? "earlier" : date.toLocaleString(undefined, { dateStyle: "medium", timeStyle: "short" }); }
function errorText(value: unknown) { return value instanceof Error ? value.message : String(value); }
