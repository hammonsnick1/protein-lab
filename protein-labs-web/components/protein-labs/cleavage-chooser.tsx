"use client";

import { useMemo, useState } from "react";
import { Check, Search } from "lucide-react";
import { CatalogCartoon, proteaseCartoonKind } from "@/components/protein-labs/catalog-cartoons";
import { ChoiceInspector, CurrentChoice } from "@/components/protein-labs/catalog-choice";
import { ConstructDesigner, type ConstructReport } from "@/components/protein-labs/construct-designer";
import { initialPlan } from "@/lib/construct-records";
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { affinityColumns, proteaseCategories, proteases } from "@/lib/purification-catalog";

/** Affinity capture's starting resin, used until a resin is saved so both jobs show the same tag. */
const defaultAffinity = affinityColumns.find((column) => column.id === "his-ni") ?? affinityColumns[0];

/**
 * The tag-cleavage choice inside Subtractive cleanup. The tag, linker and
 * position come from Affinity capture; choosing a protease here inserts its
 * site, so the cleaved product (with any scar) and the released tag are
 * recalculated. The parent saves the choice with the cleanup resin.
 */
export function CleavageChooser({ bundle, vectors, proteaseId, onProteaseChange, siteEvidence, onSiteEvidenceChange, onReport }: {
  bundle: ProteinBundle;
  vectors: JsonObject[];
  proteaseId: string;
  onProteaseChange: (id: string) => void;
  siteEvidence: string;
  onSiteEvidenceChange: (value: string) => void;
  onReport: (report: ConstructReport) => void;
}) {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All");
  const [inspecting, setInspecting] = useState<string | null>(null);
  const affinity = useMemo(() => bundle.projectJobs.find((job) => job.appType === "purification-affinity")?.config ?? {}, [bundle.projectJobs]);
  const plan = useMemo(() => initialPlan(affinity, String(affinity.tag ?? defaultAffinity.tag)), [affinity]);
  const protease = proteases.find((value) => value.id === proteaseId) ?? proteases[0];
  const visible = proteases.filter((value) => (category === "All" || value.category === category) && Object.values(value).join(" ").toLowerCase().includes(search.toLowerCase()));
  const inspected = proteases.find((value) => value.id === inspecting);

  return <section className="cleavage-chooser">
    <header className="planner-intro"><span className="eyebrow">1 · TAG CLEAVAGE</span><h2>Choose how the affinity tag comes off</h2><p>The protease's site sits between the tag and your protein. Its cut decides what is left on the target and what the cleanup resin has to capture.</p></header>
    {!affinity.columnId && <p className="cleavage-chooser-note">Affinity capture has not been saved yet, so this shows its starting choice ({defaultAffinity.shortName}, {defaultAffinity.tag}). Save Affinity capture to use your own tag and linker.</p>}
    <div className="purification-browser compact-choice">
      <section className="catalog-pane">
        <div className="catalog-filters"><label><Search/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search enzyme or site…"/></label><select value={category} onChange={(event) => setCategory(event.target.value)}>{proteaseCategories.map((value) => <option key={value}>{value}</option>)}</select></div>
        <div className="purification-card-grid proteases">{visible.map((value) => <button key={value.id} className={value.id === proteaseId ? "selected" : ""} style={{ "--catalog-color": value.color } as React.CSSProperties} onClick={() => setInspecting(value.id)}><span className="protease-cartoon"><CatalogCartoon kind={proteaseCartoonKind(value.category, value.name)}/></span><span><strong>{value.name}</strong><small>{value.recognition}</small><em>{value.category} · {value.enzymeClass}</em></span>{value.id === proteaseId && <Check/>}</button>)}</div>
      </section>
      <CurrentChoice color={protease.color} cartoon={proteaseCartoonKind(protease.category, protease.name)} label="Selected cleavage strategy" title={protease.name} subtitle={`${protease.recognition} · ${protease.enzymeClass}`}>
        <label className="catalog-field">Cleavage-site evidence<textarea value={siteEvidence} onChange={(event) => onSiteEvidenceChange(event.target.value)} placeholder="Where is the site annotated in the final construct?"/></label>
      </CurrentChoice>
    </div>
    <ConstructDesigner stage="cleavage" targetSequence={bundle.protein.sequence} targetName={bundle.protein.name} affinityTagLabel={String(affinity.tag ?? defaultAffinity.tag)} proteaseId={proteaseId} plan={plan} onPlanChange={() => undefined} vectors={vectors} onReport={onReport}/>
    {inspected && <ChoiceInspector color={inspected.color} cartoon={proteaseCartoonKind(inspected.category, inspected.name)} eyebrow="CLEAVAGE STRATEGY" title={inspected.name} subtitle={`${inspected.recognition} · ${inspected.enzymeClass}`} rows={[["Summary", inspected.summary], ["Conditions", inspected.conditions], ["Strengths", inspected.strengths], ["Cautions", inspected.cautions], ["Removal", inspected.removal], ["Reference", inspected.reference]]} onClose={() => setInspecting(null)} onChoose={() => { onProteaseChange(inspected.id); setInspecting(null); }}/>}
  </section>;
}
