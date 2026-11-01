"use client";

import { useState, type FormEvent } from "react";
import { Info, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { CiteGroup } from "@/components/ui/citations";
import { StatusChip } from "@/components/ui/status-chip";
import type { CitationScope } from "@/lib/citations";
import {
  DEFAULT_STOCK, EXAMPLE_HIT, formatNumber, hitFromSaved, hitProblems, optimizationPlate, PRECIPITANT_UNITS, RESERVOIR_MICROLITRES,
  ROW_LETTERS, TECHNIQUE_GROUPS, TECHNIQUES, techniqueHint, type GridKind, type HitCondition, type OptimizationPlate, type PrecipitantUnit,
} from "@/lib/crystal-optimization";
import type { CrystallizationProfile } from "@/lib/crystallization-guidance";
import type { JsonObject } from "@/lib/protein-labs-api";

type Draft = Record<"precipitant" | "concentration" | "stock" | "buffer" | "pH" | "proteinMgMl" | "other", string> & { unit: PrecipitantUnit };

const toDraft = (hit: HitCondition): Draft => ({
  precipitant: hit.precipitant, concentration: String(hit.concentration), unit: hit.unit, stock: String(hit.stock),
  buffer: hit.buffer, pH: hit.pH === null ? "" : String(hit.pH), proteinMgMl: String(hit.proteinMgMl), other: hit.other,
});

const fromDraft = (draft: Draft): HitCondition => ({
  precipitant: draft.precipitant.trim(), concentration: Number(draft.concentration), unit: draft.unit, stock: Number(draft.stock),
  buffer: draft.buffer.trim(), pH: draft.pH.trim() ? Number(draft.pH) : null, proteinMgMl: Number(draft.proteinMgMl), other: draft.other.trim(),
});

/**
 * The "Optimizing a hit" tab of the practical guidance: fine-grid plates
 * generated from the hit the scientist enters (saved with the job), then
 * seeding, drop and sample changes to try next.
 */
export function OptimizeTab({ profile, refs, saved, save }: { profile: CrystallizationProfile; refs: CitationScope; saved: JsonObject; save: (patch: JsonObject) => Promise<void> }) {
  const savedHit = hitFromSaved(saved.hit);
  const hit = savedHit ?? EXAMPLE_HIT;
  return <div className="xtal-tab">
    <section className="xtal-card" aria-labelledby="xtal-opt-hit">
      <h4 id="xtal-opt-hit">Fine grid around the hit</h4>
      <p className="xtal-note">A screening hit is rarely the best condition. Refine it by varying the precipitant in small steps against a second variable, one 24-well plate each<CiteGroup scope={refs} ids={["mcpherson-cudney2014"]}/>. Step sizes are this app{"'"}s rule of thumb: 70–120 % of the hit{"'"}s precipitant, ±0.2 pH units and 0.5–1.5 × the protein concentration<CiteGroup scope={refs} ids={["pl-crystal-rules"]}/>.</p>
      <HitForm key={JSON.stringify(hit)} hit={hit} isExample={!savedHit} save={save}/>
    </section>
    {(["precipitant-ph", "precipitant-protein"] as GridKind[]).map((kind) => <PlateCard key={kind} kind={kind} plate={optimizationPlate(hit, kind)}/>)}
    {TECHNIQUE_GROUPS.map((group) => <section key={group.id} className="xtal-card" aria-labelledby={`xtal-opt-${group.id}`}>
      <h4 id={`xtal-opt-${group.id}`}>{group.label}</h4>
      <p className="xtal-note">{group.intro}<CiteGroup scope={refs} ids={group.citations}/></p>
      <ul className="xtal-techniques">{TECHNIQUES.filter((technique) => technique.group === group.id).map((technique) => {
        const hint = techniqueHint(technique, profile);
        return <li key={technique.id} className={hint ? "suggested" : undefined}>
          <div className="xtal-technique-head">
            <strong>{technique.label}</strong>
            {hint && <StatusChip tone="pass" label="Suggested for this protein"/>}
          </div>
          <p><b>When:</b> {technique.when}{hint && <> {hint}</>}</p>
          <ol className="xtal-steps">{technique.steps.map((step) => <li key={step}>{step}</li>)}</ol>
          <p className="xtal-note">Sources<CiteGroup scope={refs} ids={technique.citations}/></p>
        </li>;
      })}</ul>
    </section>)}
  </div>;
}

function HitForm({ hit, isExample, save }: { hit: HitCondition; isExample: boolean; save: (patch: JsonObject) => Promise<void> }) {
  const [draft, setDraft] = useState<Draft>(() => toDraft(hit));
  const [status, setStatus] = useState<{ kind: "idle" | "saving" } | { kind: "error"; message: string }>({ kind: "idle" });
  const parsed = fromDraft(draft);
  const problems = hitProblems(parsed);
  const dirty = JSON.stringify(parsed) !== JSON.stringify(hit);
  const set = (key: keyof Draft) => (event: { target: { value: string } }) => setDraft((current) => ({ ...current, [key]: event.target.value }));

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (problems.length) return;
    setStatus({ kind: "saving" });
    try {
      await save({ hit: parsed as unknown as JsonObject });
      setStatus({ kind: "idle" });
    } catch (error) {
      setStatus({ kind: "error", message: error instanceof Error ? error.message : String(error) });
    }
  }

  return <form className="xtal-hit-form" onSubmit={submit} aria-label="Hit condition">
    {isExample && <p className="xtal-callout"><Info aria-hidden="true"/><span>These are example values. Enter the condition that gave your crystals and select <b>Generate plates</b>; it is saved with this job.</span></p>}
    <div className="xtal-hit-fields">
      <label className="lab-field"><span>Precipitant</span><input value={draft.precipitant} onChange={set("precipitant")} placeholder="PEG 3,350"/></label>
      <label className="lab-field"><span>Concentration in the hit</span><input type="number" inputMode="decimal" min="0" step="any" value={draft.concentration} onChange={set("concentration")}/></label>
      <label className="lab-field"><span>Unit</span>
        <select value={draft.unit} onChange={(event) => {
          const unit = event.target.value as PrecipitantUnit;
          setDraft((current) => ({ ...current, unit, stock: String(DEFAULT_STOCK[unit]) }));
        }}>{PRECIPITANT_UNITS.map((unit) => <option key={unit} value={unit}>{unit}</option>)}</select>
      </label>
      <label className="lab-field"><span>Stock you pipette from ({draft.unit})</span><input type="number" inputMode="decimal" min="0" step="any" value={draft.stock} onChange={set("stock")}/></label>
      <label className="lab-field"><span>Buffer</span><input value={draft.buffer} onChange={set("buffer")} placeholder="0.1 M HEPES"/></label>
      <label className="lab-field"><span>pH (optional)</span><input type="number" inputMode="decimal" min="2" max="12" step="0.1" value={draft.pH} onChange={set("pH")}/></label>
      <label className="lab-field"><span>Protein (mg/mL)</span><input type="number" inputMode="decimal" min="0" step="any" value={draft.proteinMgMl} onChange={set("proteinMgMl")}/></label>
      <label className="lab-field wide"><span>Other components (optional)</span><input value={draft.other} onChange={set("other")} placeholder="0.2 M ammonium sulfate"/></label>
    </div>
    <div className="xtal-hit-actions">
      <Button type="submit" size="sm" disabled={problems.length > 0 || status.kind === "saving" || (!dirty && !isExample)}><Sparkles aria-hidden="true"/>{status.kind === "saving" ? "Saving…" : "Generate plates"}</Button>
      {dirty && <Button type="button" size="sm" variant="ghost" onClick={() => setDraft(toDraft(hit))}>Undo edits</Button>}
      <small role="status">{problems.length ? problems.join(" ") : status.kind === "error" ? `Could not save the hit: ${status.message}` : dirty ? "The plates below still show the previous values." : ""}</small>
    </div>
  </form>;
}

function PlateCard({ kind, plate }: { kind: GridKind; plate: OptimizationPlate | null }) {
  const headingId = `xtal-plate-${kind}`;
  if (!plate) {
    return <section className="xtal-card" aria-labelledby={headingId}>
      <h4 id={headingId}>{kind === "precipitant-ph" ? "Plate 1: precipitant against pH" : "Plate 2: precipitant against protein concentration"}</h4>
      <p className="xtal-note">{kind === "precipitant-ph" ? "The hit has no pH, so there is no pH axis to refine. Enter the buffer's pH to get this plate." : "Fix the hit condition above to generate this plate."}</p>
    </section>;
  }
  return <section className="xtal-card" aria-labelledby={headingId}>
    <h4 id={headingId}>{plate.title}</h4>
    <div className="xtal-table-wrap">
      <table className="xtal-table xtal-plate">
        <caption>Rows: {plate.rowLabel}. Columns: {plate.columnLabel}. Each well shows the precipitant stock to add to {RESERVOIR_MICROLITRES} µL of reservoir; <b>HIT</b> marks the well that repeats your hit.</caption>
        <thead>
          <tr><th scope="col"><span className="xtal-well-id">{plate.columnLabel} →</span>{plate.rowLabel} ↓</th>{plate.columnValues.map((value, column) => <th key={column} scope="col"><span className="xtal-well-id">{column + 1}</span>{formatNumber(value)}</th>)}</tr>
        </thead>
        <tbody>{plate.wells.map((row, index) => <tr key={ROW_LETTERS[index]}>
          <th scope="row"><span className="xtal-well-id">{ROW_LETTERS[index]}</span>{formatNumber(plate.rowValues[index])}</th>
          {row.map((well) => <td key={well.id} className={well.isHit ? "hit" : undefined}>
            {well.stockMicrolitres} µL{well.isHit && <b className="xtal-hit-tag">HIT</b>}
          </td>)}
        </tr>)}</tbody>
      </table>
    </div>
    <ul className="xtal-reasons" aria-label="Same in every well">{plate.constant.map((line) => <li key={line}>{line}</li>)}</ul>
  </section>;
}
