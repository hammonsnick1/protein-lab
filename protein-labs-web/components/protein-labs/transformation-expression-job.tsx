"use client";

import { type CSSProperties, useMemo, useState } from "react";
import { Check, CircleAlert, Dna, FlaskConical, LoaderCircle, Snowflake, Sprout, X } from "lucide-react";
import { CatalogCartoon, mediaCartoonKind } from "@/components/protein-labs/catalog-cartoons";
import { Button } from "@/components/ui/button";
import { ensureProjectJob, type ProteinBundle } from "@/lib/protein-labs-api";

type HostSystem = "ecoli" | "yeast" | "insect" | "mammalian";
type MediaChoice = { id: string; name: string; system: HostSystem; type: string; summary: string; bestFor: string; strengths: string; cautions: string; color: string };

const mediaChoices: MediaChoice[] = [
  { id: "lb", name: "LB", system: "ecoli", type: "Rich undefined", summary: "Routine bacterial medium for transformations, starter cultures, and moderate-density expression.", bestFor: "Fast screening and familiar small-scale workflows.", strengths: "Inexpensive, forgiving, and widely standardized.", cautions: "Lower biomass and less pH buffering than TB; composition varies by supplier.", color: "#56b4a2" },
  { id: "tb", name: "Terrific Broth (TB)", system: "ecoli", type: "Very rich buffered", summary: "High-density bacterial medium with strong phosphate buffering and glycerol.", bestFor: "High biomass and recombinant expression before induction.", strengths: "Typically supports substantially more biomass than LB.", cautions: "High oxygen demand; rich growth can worsen aggregation or acetate stress.", color: "#ef9b45" },
  { id: "2xyt", name: "2×YT", system: "ecoli", type: "Rich undefined", summary: "Peptone- and yeast-extract-rich medium between LB and TB in density.", bestFor: "Phage work, starter cultures, and robust bacterial expression.", strengths: "Simple, reliable growth with more nutrients than LB.", cautions: "Limited buffering; monitor aeration and induction density.", color: "#d7b34c" },
  { id: "m9", name: "M9 minimal", system: "ecoli", type: "Defined minimal", summary: "Defined salts medium with a controlled carbon and nitrogen source.", bestFor: "Isotope labeling, metabolic control, and media-composition studies.", strengths: "Chemically defined and easy to customize.", cautions: "Slower growth and lower biomass; supplements may be required for auxotrophs.", color: "#66a9df" },
  { id: "zym5052", name: "ZYM-5052 autoinduction", system: "ecoli", type: "Autoinduction", summary: "Mixed-carbon medium that delays lactose-driven induction until preferred carbon is depleted.", bestFor: "Unattended high-density T7 expression screens.", strengths: "No manual IPTG timing and convenient parallel cultures.", cautions: "Requires compatible lac/T7 regulation; unsuitable when basal expression is toxic.", color: "#9b79d1" },
  { id: "ypd", name: "YPD / YEPD", system: "yeast", type: "Rich undefined", summary: "Yeast extract, peptone, and dextrose for rapid routine yeast growth.", bestFor: "Recovery, biomass expansion, and nonselective propagation.", strengths: "Robust growth for many Saccharomyces and Pichia workflows.", cautions: "Does not maintain auxotrophic selection and glucose represses GAL promoters.", color: "#f2b94b" },
  { id: "sc", name: "Synthetic complete dropout", system: "yeast", type: "Defined selective", summary: "Defined yeast medium lacking the nutrient used by the expression plasmid marker.", bestFor: "Maintaining URA3, LEU2, HIS3, or TRP1 selection.", strengths: "Controlled composition and direct plasmid selection.", cautions: "Slower growth than YPD; choose the exact dropout formulation for the host genotype.", color: "#78b159" },
  { id: "bmgy-bmmy", name: "BMGY → BMMY", system: "yeast", type: "Pichia induction pair", summary: "Buffered glycerol-complex growth followed by methanol-complex induction.", bestFor: "AOX1-driven Komagataella/Pichia expression.", strengths: "Separates biomass accumulation from strong induction.", cautions: "Methanol is flammable and oxygen-intensive; feeding and ventilation need control.", color: "#4bb5a7" },
  { id: "ypg", name: "YPG / glycerol medium", system: "yeast", type: "Nonfermentable carbon", summary: "Rich medium using glycerol to support respiratory growth and derepression.", bestFor: "Mitochondrial studies and pre-induction growth for some promoters.", strengths: "Avoids glucose repression in appropriate systems.", cautions: "Growth is slower and promoter behavior must be verified.", color: "#8b7cd6" },
  { id: "sf900", name: "Sf-900 III SFM", system: "insect", type: "Serum-free suspension", summary: "Serum-free medium commonly used for Sf9/Sf21 baculovirus culture and expression.", bestFor: "Routine suspension expansion, virus amplification, and protein production.", strengths: "Serum-free, scalable, and well established.", cautions: "Use vendor-recommended density, viability, MOI, and agitation ranges.", color: "#4caf77" },
  { id: "esf921", name: "ESF 921", system: "insect", type: "Protein-free suspension", summary: "Protein-free insect-cell medium for high-density Sf9 and related production cultures.", bestFor: "Downstream processes that benefit from low background protein.", strengths: "Simplifies secreted-protein purification and supports suspension growth.", cautions: "Adapt cells gradually and verify performance for the chosen line.", color: "#39a6a3" },
  { id: "graces", name: "Grace's insect medium", system: "insect", type: "Classical basal", summary: "Classical insect-cell basal medium, often supplemented for adherent culture.", bestFor: "Legacy Sf9/Sf21 protocols and plaque-based workflows.", strengths: "Well documented and broadly familiar.", cautions: "Often needs serum or hydrolysate supplementation; less convenient for clean secreted products.", color: "#85b95b" },
  { id: "express-five", name: "Express Five SFM", system: "insect", type: "Serum-free High Five", summary: "Serum-free formulation optimized for High Five cells and recombinant production.", bestFor: "High Five suspension expression, including secreted proteins.", strengths: "Supports high expression without serum-derived protein.", cautions: "Match the medium to the cell line and avoid assuming Sf9 culture settings transfer directly.", color: "#2b8f65" },
  { id: "expi293", name: "Expi293 expression medium", system: "mammalian", type: "Defined high-density suspension", summary: "Chemically defined medium designed for high-density Expi293 transient expression.", bestFor: "Human-like transient production of secreted or complex proteins.", strengths: "High density and integrated with matched transfection/feed reagents.", cautions: "Treat cells, medium, reagent, enhancer, and schedule as a matched system.", color: "#7b6ee6" },
  { id: "freestyle293", name: "FreeStyle 293 medium", system: "mammalian", type: "Serum-free suspension", summary: "Serum-free medium for suspension-adapted 293 cells and transient expression.", bestFor: "Flexible suspension 293 workflows at moderate density.", strengths: "Serum-free and scalable with established transfection methods.", cautions: "Optimize DNA, reagent, density, and harvest time for the specific cell line.", color: "#667de0" },
  { id: "expicho", name: "ExpiCHO expression medium", system: "mammalian", type: "Defined high-density suspension", summary: "Chemically defined medium used with the ExpiCHO transient production system.", bestFor: "High-yield CHO-like production and secreted proteins.", strengths: "High-density culture with CHO-relevant processing.", cautions: "Use the matched feed, enhancer, transfection schedule, and temperature shift.", color: "#4f9bd9" },
  { id: "cdcho", name: "CD CHO medium", system: "mammalian", type: "Chemically defined", summary: "Defined, protein-free medium for CHO suspension growth and production development.", bestFor: "Stable CHO development and controlled upstream processes.", strengths: "Low background and reproducible composition.", cautions: "Selection supplements, feeds, and adaptation depend on the cell line.", color: "#3fa9c8" },
  { id: "dmem", name: "DMEM + serum", system: "mammalian", type: "Adherent", summary: "Classical basal medium, typically with serum, for adherent HEK293T and other mammalian cells.", bestFor: "Small-scale adherent transfection and rapid pilot expression.", strengths: "Familiar, robust, and broadly compatible with adherent lines.", cautions: "Serum adds variability and background protein; scale-up requires substantial surface area.", color: "#d46fa4" },
];

const systemLabels: Record<HostSystem, string> = { ecoli: "E. coli", yeast: "Yeast", insect: "Insect cells", mammalian: "Mammalian cells" };

function normalizeSystem(value: unknown): HostSystem {
  const text = String(value ?? "").toLowerCase();
  if (text.includes("yeast")) return "yeast";
  if (text.includes("insect")) return "insect";
  if (text.includes("mamm")) return "mammalian";
  return "ecoli";
}

export function TransformationExpressionJob({ bundle, onChanged }: { bundle: ProteinBundle; onChanged: () => Promise<void> }) {
  const saved = bundle.projectJobs.find((job) => job.appType === "transformation-expression");
  const expression = bundle.projectJobs.find((job) => job.appType === "expression-system")?.config ?? {};
  const detectedSystem = normalizeSystem(expression.hostSystemId ?? expression.hostSystem);
  const cellFreePlan = /cell-?\s?free|in vitro/i.test(String(expression.hostSystemId ?? expression.hostSystem ?? ""));
  const [system, setSystem] = useState<HostSystem>(() => normalizeSystem(saved?.config.hostSystemId ?? detectedSystem));
  const available = useMemo(() => mediaChoices.filter((value) => value.system === system), [system]);
  const [source, setSource] = useState(String(saved?.config.startingMaterial ?? "fresh"));
  const [mediaId, setMediaId] = useState(String(saved?.config.mediaId ?? available[0]?.id ?? ""));
  const [inspecting, setInspecting] = useState<string | null>(null);
  const [volume, setVolume] = useState(String(saved?.config.cultureVolume ?? ""));
  const [temperature, setTemperature] = useState(String(saved?.config.temperatureC ?? ""));
  const [induction, setInduction] = useState(String(saved?.config.inductionPlan ?? ""));
  const [mediaNotes, setMediaNotes] = useState(String(saved?.config.mediaNotes ?? ""));
  const [notes, setNotes] = useState(String(saved?.config.notes ?? ""));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selected = available.find((value) => value.id === mediaId) ?? available[0];
  const inspected = mediaChoices.find((value) => value.id === inspecting);

  function chooseSystem(value: HostSystem) {
    setSystem(value);
    const first = mediaChoices.find((choice) => choice.system === value);
    setMediaId(first?.id ?? "");
    setInspecting(null);
  }

  async function save() {
    if (!selected) { setMessage("Choose a culture medium before saving."); return; }
    setBusy(true); setMessage("");
    try {
      await ensureProjectJob(bundle.protein.id, bundle.projectJobs, "transformation-expression", "Transformation and Expression", {
        hostSystemId: system,
        hostSystem: systemLabels[system],
        hostId: expression.hostId ?? expression.strainId ?? null,
        hostName: expression.strainName ?? null,
        startingMaterial: source,
        startingMaterialLabel: source === "fresh" ? "Fresh transformation / transfection / infection" : source === "stock" ? "Glycerol or cryogenic stock" : "Existing culture or cell bank",
        mediaId: selected.id,
        mediaName: selected.name,
        mediaType: selected.type,
        mediaSummary: selected.summary,
        cultureVolume: volume.trim(),
        temperatureC: temperature.trim(),
        inductionPlan: induction.trim(),
        mediaNotes: mediaNotes.trim(),
        notes: notes.trim(),
        savedByUser: true,
        savedAt: new Date().toISOString(),
      });
      await onChanged();
      setMessage("Transformation and expression record saved.");
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  return <div className="transformation-expression-job">
    <section className="execution-intro">
      <span className="eyebrow">PURIFY YOUR PROTEIN · STEP 1</span>
      <h2>Transformation and Expression</h2>
      <p>Record how the production culture begins, select a host-appropriate medium, and preserve the experimental conditions that will matter later.</p>
      <div className="execution-host-context"><Sprout/><span><strong>{String(expression.strainName ?? systemLabels[detectedSystem])}</strong><small>{expression.strainName ? `${String(expression.hostSystem ?? systemLabels[detectedSystem])} · loaded from the expression plan` : "No saved host was found; choose the system used at the bench."}</small></span></div>
      {/* The media catalogue only covers cultured hosts. A cell-free plan has
          no transformation or culture step, so say that instead of silently
          offering E. coli media. */}
      {cellFreePlan && <div className="inline-message"><CircleAlert/> The saved expression system is cell-free, so there is no transformation or culture step. Record the reaction setup — extract, template, energy mix and incubation — in the notes below; the media list does not apply.</div>}
    </section>

    <section className="execution-panel">
      <header><span><strong>1 · Starting material</strong><small>How is this expression run being initiated?</small></span></header>
      <div className="starting-material-grid">
        <button className={source === "fresh" ? "selected" : ""} onClick={() => setSource("fresh")}><Dna/><strong>Fresh transformation</strong><small>Transformation, transfection, or baculovirus infection performed for this run.</small>{source === "fresh" && <Check/>}</button>
        <button className={source === "stock" ? "selected" : ""} onClick={() => setSource("stock")}><Snowflake/><strong>Glycerol / cryo stock</strong><small>Start from a saved bacterial, yeast, insect, or mammalian cell stock.</small>{source === "stock" && <Check/>}</button>
        <button className={source === "culture" ? "selected" : ""} onClick={() => setSource("culture")}><FlaskConical/><strong>Existing culture</strong><small>Continue from a starter culture, working cell bank, or maintained line.</small>{source === "culture" && <Check/>}</button>
      </div>
    </section>

    <section className="execution-panel">
      <header><span><strong>2 · Host system and medium</strong><small>Open a card for details, then select the medium used for this run.</small></span></header>
      <nav className="media-system-tabs">{(Object.keys(systemLabels) as HostSystem[]).map((value) => <button key={value} className={system === value ? "active" : ""} onClick={() => chooseSystem(value)}>{systemLabels[value]}</button>)}</nav>
      <div className="media-choice-grid">{available.map((value) => <button key={value.id} className={mediaId === value.id ? "selected" : ""} style={{ "--media-color": value.color } as CSSProperties} onClick={() => setInspecting(value.id)}><span><CatalogCartoon kind={mediaCartoonKind(value.type)}/></span><strong>{value.name}</strong><small>{value.summary}</small><em>{value.type}</em>{mediaId === value.id && <Check/>}</button>)}</div>
    </section>

    <section className="execution-panel expression-record-fields">
      <header><span><strong>3 · Expression record</strong><small>Document what was actually done. Blank fields remain explicitly unrecorded.</small></span></header>
      <div className="three-column-fields"><label>Culture volume<input value={volume} onChange={(event) => setVolume(event.target.value)} placeholder="e.g. 2 × 1 L"/></label><label>Temperature (°C)<input value={temperature} onChange={(event) => setTemperature(event.target.value)} placeholder="e.g. 18"/></label><label>Induction / harvest plan<input value={induction} onChange={(event) => setInduction(event.target.value)} placeholder="e.g. 0.2 mM IPTG, overnight"/></label></div>
      <label>Media composition, additives, and selection<textarea rows={4} value={mediaNotes} onChange={(event) => setMediaNotes(event.target.value)} placeholder="Antibiotics, supplements, carbon source, serum, feeds, induction additives…"/></label>
      <label>Experimental notes<textarea rows={5} value={notes} onChange={(event) => setNotes(event.target.value)} placeholder="Inoculation density, flask type, shaking, cell density, viability, harvest time, deviations…"/></label>
      <footer><span>{message && <><CircleAlert/><small>{message}</small></>}</span><Button disabled={busy || !selected} onClick={() => void save()}>{busy ? <LoaderCircle className="spin"/> : <Check/>} Save transformation and expression</Button></footer>
    </section>

    {inspected && <aside className="selection-inspector media-inspector" style={{ "--catalog-color": inspected.color } as CSSProperties}>
      <header><span><small>{systemLabels[inspected.system]} MEDIUM</small><strong>{inspected.name}</strong></span><Button variant="ghost" size="icon" onClick={() => setInspecting(null)}><X/></Button></header>
      <div className="selection-inspector-body"><div className="media-inspector-hero"><CatalogCartoon kind={mediaCartoonKind(inspected.type)}/><span><strong>{inspected.type}</strong><p>{inspected.summary}</p></span></div><dl className="inspector-detail-list"><div><dt>Best for</dt><dd>{inspected.bestFor}</dd></div><div><dt>Strengths</dt><dd>{inspected.strengths}</dd></div><div><dt>Watch-outs</dt><dd>{inspected.cautions}</dd></div></dl></div>
      <footer><Button variant="outline" onClick={() => setInspecting(null)}>Close</Button><Button onClick={() => { setMediaId(inspected.id); setInspecting(null); }}><Check/> Use this medium</Button></footer>
    </aside>}
  </div>;
}
