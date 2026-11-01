"use client";

import { useMemo } from "react";
import { AlertTriangle, FlaskConical, Info } from "lucide-react";
import { CiteGroup, ReferenceList } from "@/components/ui/citations";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { citationScope, type CitationScope } from "@/lib/citations";
import {
  componentRolesFor, crystallizationProfile, DROP_CITATIONS, DROP_METHODS, GUIDANCE_CITATIONS, ligandAdvice, membraneNote,
  PRIORITY_LABELS, PUBLISHED_STARTING_RANGE, READ_THE_FIRST_PLATE, startingConcentration, suggestScreens, tailoringNotes, VAPOUR_DIFFUSION_STEPS,
  type ComponentRole, type CrystallizationProfile, type DropMethodId, type Reason, type ScreenPriority, type ScreenSuggestion,
} from "@/lib/crystallization-guidance";
import { formatTypicalRange } from "@/lib/buffer-component-library";
import { OPTIMIZATION_CITATIONS } from "@/lib/crystal-optimization";
import type { JsonObject } from "@/lib/protein-labs-api";
import { OptimizeTab } from "@/components/protein-labs/crystal-optimization";
import type { ProteinFacts } from "@/lib/protein-facts";

const PRIORITY_TONES: Record<ScreenPriority, StatusTone> = { first: "pass", next: "review", later: "attention" };

/**
 * The practical half of the Crystallize job: which screens to buy, how much
 * protein to put in, what every drop component is for and how vapour
 * diffusion drops are set up, then how to optimize a hit. Everything is tailored from `facts`, so the
 * scientist never re-enters what earlier jobs already recorded. The Crystallize
 * job (HOM-309) mounts it as its `guidance` panel, passing the facts it
 * already computed, and its saved panel state (the hit condition).
 */
export function CrystallizationGuidance({ facts, saved, save }: { facts: ProteinFacts; saved: JsonObject; save: (patch: JsonObject) => Promise<void> }) {
  const profile = useMemo(() => crystallizationProfile(facts), [facts]);
  const refs = useMemo(() => citationScope("crystal-guidance", [...GUIDANCE_CITATIONS, ...OPTIMIZATION_CITATIONS]), []);
  return <section className="xtal-guide" aria-labelledby="xtal-guide-title">
    <header className="xtal-guide-head">
      <h3 id="xtal-guide-title"><FlaskConical aria-hidden="true"/>Setting up crystallization trials</h3>
      <p>Where to start, what each ingredient of a crystallization drop does, how the drops are set up, and how to improve a hit. Advice is tailored from what earlier jobs recorded about this protein.</p>
    </header>
    <Tabs defaultValue="screens" className="xtal-guide-tabs">
      <TabsList aria-label="Crystallization guidance">
        <TabsTrigger value="screens">Screens and concentration</TabsTrigger>
        <TabsTrigger value="components">What goes in the drop</TabsTrigger>
        <TabsTrigger value="drops">Hanging vs sitting drop</TabsTrigger>
        <TabsTrigger value="optimize">Optimizing a hit</TabsTrigger>
      </TabsList>
      <TabsContent value="screens"><ScreensTab profile={profile} refs={refs}/></TabsContent>
      <TabsContent value="components"><ComponentsTab profile={profile} refs={refs}/></TabsContent>
      <TabsContent value="drops"><DropsTab refs={refs}/></TabsContent>
      <TabsContent value="optimize"><OptimizeTab profile={profile} refs={refs} saved={saved} save={save}/></TabsContent>
    </Tabs>
    <ReferenceList scope={refs} className="xtal-guide-refs"/>
  </section>;
}

// ── Screens and concentration ───────────────────────────────────────────────

function ScreensTab({ profile, refs }: { profile: CrystallizationProfile; refs: CitationScope }) {
  const screens = suggestScreens(profile);
  const concentration = startingConcentration(profile);
  const membrane = membraneNote(profile);
  const ligand = ligandAdvice(profile);
  return <div className="xtal-tab">
    <section className="xtal-card" aria-labelledby="xtal-basis">
      <h4 id="xtal-basis">What this advice is based on</h4>
      <dl className="xtal-basis">{tailoringNotes(profile).map((note) => <div key={note.label}>
        <dt>{note.label}</dt>
        <dd>{note.value}{note.citations.length > 0 && <CiteGroup scope={refs} ids={note.citations}/>}</dd>
      </div>)}</dl>
      {membrane && <p className="xtal-callout warning"><AlertTriangle aria-hidden="true"/><span>{membrane}</span></p>}
    </section>

    <section className="xtal-card" aria-labelledby="xtal-conc">
      <h4 id="xtal-conc">Starting protein concentration</h4>
      <p className="xtal-conc-value">
        <strong>{concentration.start} mg/mL</strong>
        {concentration.startMicromolar !== null && <span>≈ {formatMicromolar(concentration.startMicromolar)}</span>}
        <span>try {concentration.low}–{concentration.high} mg/mL</span>
      </p>
      <Reasons items={concentration.why} refs={refs}/>
      <p className="xtal-note"><Sourced reason={PUBLISHED_STARTING_RANGE} refs={refs}/> <Sourced reason={READ_THE_FIRST_PLATE} refs={refs}/></p>
      {ligand && <p className="xtal-callout"><Info aria-hidden="true"/><span>{ligand}<CiteGroup scope={refs} ids={["hassell2007"]}/></span></p>}
    </section>

    <PdbConditions profile={profile} refs={refs}/>

    <section className="xtal-card" aria-labelledby="xtal-screens">
      <h4 id="xtal-screens">Suggested commercial screens</h4>
      <p className="xtal-note">A screen is a ready-made plate of 48–96 different conditions. Sparse-matrix screens sample the conditions that most often crystallized other proteins, so a few plates cover a lot of chemistry<CiteGroup scope={refs} ids={["jancarik1991", "newman2005"]}/>.</p>
      <ol className="xtal-screens">{screens.map((item) => <ScreenCard key={item.screen.id} item={item} refs={refs}/>)}</ol>
    </section>
  </div>;
}

function ScreenCard({ item, refs }: { item: ScreenSuggestion; refs: CitationScope }) {
  const { screen } = item;
  return <li className={`xtal-screen ${item.priority}`}>
    <div className="xtal-screen-head">
      <StatusChip tone={PRIORITY_TONES[item.priority]} label={PRIORITY_LABELS[item.priority]}/>
      <strong>{screen.name}</strong>
      <span>{screen.vendor} · {screen.conditions}</span>
    </div>
    <p>{screen.samples}<CiteGroup scope={refs} ids={screen.citations}/></p>
    <Reasons items={item.why} refs={refs} label={`Why ${screen.name}`}/>
  </li>;
}

/** A line of advice with its sources; the app's own rules of thumb cite `pl-crystal-rules`, so every line carries a marker. */
function Sourced({ reason, refs }: { reason: Reason; refs: CitationScope }) {
  return <>{reason.text}<CiteGroup scope={refs} ids={reason.citations}/></>;
}

function Reasons({ items, refs, label }: { items: Reason[]; refs: CitationScope; label?: string }) {
  return <ul className="xtal-reasons" aria-label={label}>{items.map((reason) => <li key={reason.text}><Sourced reason={reason} refs={refs}/></li>)}</ul>;
}

function PdbConditions({ profile, refs }: { profile: CrystallizationProfile; refs: CitationScope }) {
  if (!profile.pdbConditions.length) return null;
  return <section className="xtal-card" aria-labelledby="xtal-pdb">
    <h4 id="xtal-pdb">Conditions that already worked for related structures</h4>
    <p className="xtal-note">Copied from the crystal-growth records of the PDB entries Sequence research found<CiteGroup scope={refs} ids={["pdb2000"]}/>. A close relative's condition is a strong starting point: set it up alongside the screens<CiteGroup scope={refs} ids={["pl-crystal-rules"]}/>.</p>
    <div className="xtal-table-wrap">
      <table className="xtal-table">
        <thead><tr><th scope="col">PDB</th><th scope="col">Identity</th><th scope="col">Method</th><th scope="col">pH</th><th scope="col">Temp. (K)</th><th scope="col">Condition as deposited</th></tr></thead>
        <tbody>{profile.pdbConditions.map(({ pdbId, identity, growth }, index) => <tr key={`${pdbId}-${index}`}>
          <th scope="row"><a href={`https://www.rcsb.org/structure/${pdbId}`} target="_blank" rel="noreferrer">{pdbId}</a></th>
          <td>{identity === null ? "—" : `${(identity * 100).toFixed(0)} %`}</td>
          <td>{growth.method ?? "—"}</td>
          <td>{growth.pH ?? "—"}</td>
          <td>{growth.temperatureK ?? "—"}</td>
          <td>{growth.details ?? "—"}</td>
        </tr>)}</tbody>
      </table>
    </div>
  </section>;
}

function formatMicromolar(value: number) {
  return value >= 1000 ? `${(value / 1000).toFixed(2)} mM` : `${value.toFixed(0)} µM`;
}

// ── What goes in the drop ───────────────────────────────────────────────────

function ComponentsTab({ profile, refs }: { profile: CrystallizationProfile; refs: CitationScope }) {
  return <div className="xtal-tab">
    <section className="xtal-card xtal-phase" aria-labelledby="xtal-phase">
      <h4 id="xtal-phase">Why a precipitant at all? The phase diagram</h4>
      <PhaseDiagram/>
      <div>
        <p>Proteins are purified to stay dissolved. To crystallize, the drop must hold <em>more</em> protein than can stay in solution — it must be <strong>supersaturated</strong><CiteGroup scope={refs} ids={["asherie2004", "mcpherson2014"]}/>. A phase diagram maps where that happens:</p>
        <ul className="xtal-zones">
          <li><b>Undersaturated:</b> below the solubility curve. Everything stays dissolved; crystals would dissolve.</li>
          <li><b>Metastable:</b> supersaturated, but too little for new crystals to start. Existing crystals (or seeds) grow here.</li>
          <li><b>Nucleation:</b> supersaturated enough that new crystals form. Aim to enter just inside it.</li>
          <li><b>Precipitation:</b> so far over that protein crashes out as amorphous solid faster than it can order.</li>
        </ul>
        <p>Adding precipitant moves the drop to the right, where the solubility curve is lower. Vapour diffusion then raises both concentrations slowly (dashed path), so the drop drifts into the nucleation zone instead of jumping into precipitate<CiteGroup scope={refs} ids={["chayen2008"]}/>.</p>
      </div>
    </section>
    {componentRolesFor(profile).map(({ role, applies }) => <RoleCard key={role.id} role={role} applies={applies} membrane={profile.membrane} refs={refs}/>)}
  </div>;
}

function RoleCard({ role, applies, membrane, refs }: { role: ComponentRole; applies: boolean; membrane: CrystallizationProfile["membrane"]; refs: CitationScope }) {
  const headingId = `xtal-role-${role.id}`;
  return <section className={`xtal-card xtal-role${applies ? "" : " muted"}`} aria-labelledby={headingId}>
    <h4 id={headingId}>{role.label}{!applies && <StatusChip tone="review" label={membrane === "no" ? "Not needed for this protein" : "Membrane proteins only"}/>}</h4>
    <p>{role.why}<CiteGroup scope={refs} ids={role.citations}/></p>
    {applies && <div className="xtal-table-wrap">
      <table className="xtal-table">
        <thead><tr><th scope="col">Example</th><th scope="col">Typical in crystallization</th><th scope="col">How it works</th></tr></thead>
        <tbody>{role.examples.map((example) => <tr key={example.name}>
          <th scope="row">{example.name}</th>
          <td>{example.typical}<CiteGroup scope={refs} ids={example.citations}/></td>
          <td>
            {example.how}
            {example.library && <small className="xtal-library">From the buffer library: purification range {formatTypicalRange(example.library.entry)}. {example.library.entry.cautions[0]}<CiteGroup scope={refs} ids={example.library.citations}/></small>}
          </td>
        </tr>)}</tbody>
      </table>
    </div>}
    {applies && <p className="xtal-tip"><b>Tip:</b> <Sourced reason={role.tip} refs={refs}/></p>}
  </section>;
}

// Schematic phase diagram. Concentrations are in arbitrary units: the shape is
// textbook, not data for this protein, and the figure says so. Each boundary is
// v = k / (u + 60); the nucleation and precipitation boundaries are 2× and 4×
// the solubility curve, so a drop whose concentrations double (vapour
// diffusion) crosses from undersaturated into nucleation.
const PLOT = { left: 40, right: 340, top: 12, bottom: 222 };
const SPAN_U = PLOT.right - PLOT.left, SPAN_V = PLOT.bottom - PLOT.top;
const toX = (u: number) => PLOT.left + u;
const toY = (v: number) => PLOT.bottom - Math.min(v, SPAN_V);
const boundary = (k: number) => (u: number) => k / (u + 60);
const SOLUBILITY = boundary(6000), NUCLEATION = boundary(12000), PRECIPITATION = boundary(24000);
function curvePoints(f: (u: number) => number, reverse = false) {
  const points: string[] = [];
  for (let u = 0; u <= SPAN_U; u += 5) points.push(`${toX(u).toFixed(1)} ${toY(f(u)).toFixed(1)}`);
  return reverse ? points.reverse() : points;
}
/** The region between two boundaries, as one closed path. */
function band(lower: ((u: number) => number) | null, upper: ((u: number) => number) | null) {
  const bottom = lower ? curvePoints(lower) : [`${PLOT.left} ${PLOT.bottom}`, `${PLOT.right} ${PLOT.bottom}`];
  const top = upper ? curvePoints(upper, true) : [`${PLOT.right} ${PLOT.top}`, `${PLOT.left} ${PLOT.top}`];
  return `M${[...bottom, ...top].join("L")}Z`;
}

function PhaseDiagram() {
  const start = { u: 60, v: 40 }, end = { u: 120, v: 80 };
  const zone = (u: number, f: (u: number) => number, g: ((u: number) => number) | null) => toY((f(u) + (g ? g(u) : SPAN_V)) / 2) + 4;
  return <figure className="xtal-figure">
    <svg viewBox="0 0 352 262" role="img" aria-label="Schematic protein phase diagram: protein concentration against precipitant concentration, with undersaturated, metastable, nucleation and precipitation zones, and a dashed vapour-diffusion path that starts undersaturated and ends in the nucleation zone.">
      <path d={band(null, SOLUBILITY)} className="xg-zone under"/>
      <path d={band(SOLUBILITY, NUCLEATION)} className="xg-zone metastable"/>
      <path d={band(NUCLEATION, PRECIPITATION)} className="xg-zone nucleation"/>
      <path d={band(PRECIPITATION, null)} className="xg-zone precipitation"/>
      <path d={`M${curvePoints(SOLUBILITY).join("L")}`} className="xg-curve"/>
      <path d={`M${curvePoints(NUCLEATION).join("L")}`} className="xg-curve faint"/>
      <path d={`M${curvePoints(PRECIPITATION).join("L")}`} className="xg-curve faint"/>
      <text x={toX(196)} y={toY(8)} className="xg-label">Undersaturated</text>
      <text x={toX(232)} y={zone(232, SOLUBILITY, NUCLEATION)} className="xg-label">Metastable</text>
      <text x={toX(232)} y={zone(232, NUCLEATION, PRECIPITATION)} className="xg-label">Nucleation</text>
      <text x={toX(196)} y={zone(196, PRECIPITATION, null)} className="xg-label">Precipitation</text>
      <line x1={toX(start.u)} y1={toY(start.v)} x2={toX(end.u)} y2={toY(end.v)} className="xg-path"/>
      <circle cx={toX(start.u)} cy={toY(start.v)} r="3.5" className="xg-point start"/>
      <path d={`M${toX(end.u)} ${toY(end.v) - 5}l5 5-5 5-5-5z`} className="xg-point end"/>
      <text x={toX(start.u)} y={toY(start.v) + 19} textAnchor="middle" className="xg-label small">drop set up</text>
      <text x={toX(end.u) + 9} y={toY(end.v) + 4} className="xg-label small">crystals nucleate</text>
      <path d={`M${PLOT.left} ${PLOT.top}V${PLOT.bottom}H${PLOT.right}`} className="xg-axis"/>
      <text x={(PLOT.left + PLOT.right) / 2} y="250" textAnchor="middle" className="xg-label axis">Precipitant concentration →</text>
      <text transform={`translate(22 ${(PLOT.top + PLOT.bottom) / 2}) rotate(-90)`} textAnchor="middle" className="xg-label axis">Protein concentration →</text>
    </svg>
    <figcaption>Schematic, not measured for this protein: the real curves depend on the protein, pH, temperature and precipitant. The solid line is the solubility curve; dashed lines bound the nucleation zone; the dashed arrow is one vapour-diffusion drop whose concentrations double.</figcaption>
  </figure>;
}

// ── Hanging vs sitting drop ─────────────────────────────────────────────────

function DropsTab({ refs }: { refs: CitationScope }) {
  return <div className="xtal-tab">
    <section className="xtal-card" aria-labelledby="xtal-vd">
      <h4 id="xtal-vd">How vapour diffusion works</h4>
      <ol className="xtal-steps">{VAPOUR_DIFFUSION_STEPS.map((step) => <li key={step}>{step}</li>)}</ol>
      <p className="xtal-note">Both set-ups below use the same principle; they differ only in where the drop sits<CiteGroup scope={refs} ids={DROP_CITATIONS}/>.</p>
    </section>
    <div className="xtal-drop-grid">
      {(["hanging", "sitting"] as DropMethodId[]).map((id) => <DropMethodCard key={id} id={id} refs={refs}/>)}
    </div>
  </div>;
}

function DropMethodCard({ id, refs }: { id: DropMethodId; refs: CitationScope }) {
  const method = DROP_METHODS[id];
  const headingId = `xtal-drop-${id}`;
  return <section className="xtal-card xtal-drop" aria-labelledby={headingId}>
    <h4 id={headingId}>{method.label}</h4>
    <figure className="xtal-figure xg-anim">
      {id === "hanging" ? <HangingDropDrawing/> : <SittingDropDrawing/>}
      <figcaption>{method.setup}</figcaption>
    </figure>
    <div className="xtal-proscons">
      <div><h5>Pros</h5><ul className="pros">{method.pros.map((line) => <li key={line}>{line}</li>)}</ul></div>
      <div><h5>Cons</h5><ul className="cons">{method.cons.map((line) => <li key={line}>{line}</li>)}</ul></div>
    </div>
    <p className="xtal-note">Sources<CiteGroup scope={refs} ids={DROP_CITATIONS}/></p>
  </section>;
}

/** Water vapour leaving the drop; with reduced motion the arrows stay drawn and still. */
function Vapour({ x, y1, y2, delay = 0 }: { x: number; y1: number; y2: number; delay?: number }) {
  return <g className="xg-vapour">
    <path d={`M${x} ${y1}V${y2}`} className="xg-vapour-shaft" style={{ animationDelay: `${delay}s` }}/>
    <path d={`M${x - 3.5} ${y2 - 4.5}L${x} ${y2}L${x + 3.5} ${y2 - 4.5}`}/>
  </g>;
}

function Crystals({ cx, cy }: { cx: number; cy: number }) {
  return <g className="xg-crystals">
    <path d={`M${cx - 7} ${cy}l3 -3 3 3 -3 3z`}/>
    <path d={`M${cx + 4} ${cy - 1}l2.5 -2.5 2.5 2.5 -2.5 2.5z`}/>
  </g>;
}

function HangingDropDrawing() {
  return <svg viewBox="0 0 252 150" role="img" aria-label="Hanging drop: a drop hangs from a glass cover slip sealed with grease over a well; water vapour moves from the drop down to the reservoir, the drop shrinks and crystals appear.">
    <path d="M40 34V128a6 6 0 0 0 6 6H154a6 6 0 0 0 6-6V34" className="xg-well"/>
    <path d="M42 104H158V128a4 4 0 0 1-4 4H46a4 4 0 0 1-4-4Z" className="xg-reservoir"/>
    <rect x="30" y="26" width="140" height="5" rx="1" className="xg-glass"/>
    <path d="M36 32h8M156 32h8" className="xg-grease"/>
    <g className="xg-drop-shrink hanging"><path d="M84 31a16 13 0 0 0 32 0Z" className="xg-drop"/></g>
    <Crystals cx={100} cy={37}/>
    <Vapour x={88} y1={52} y2={92}/>
    <Vapour x={112} y1={52} y2={92} delay={1.2}/>
    <text x="176" y="31" className="xg-label small">cover slip</text>
    <text x="176" y="45" className="xg-label small">grease seal</text>
    <text x="122" y="40" className="xg-label small">drop</text>
    <text x="122" y="76" className="xg-label small">water vapour</text>
    <text x="176" y="116" className="xg-label small">reservoir</text>
    <text x="176" y="131" className="xg-label small">(0.5–1 mL)</text>
  </svg>;
}

function SittingDropDrawing() {
  return <svg viewBox="0 0 252 150" role="img" aria-label="Sitting drop: a drop sits on a raised post beside the reservoir under sealing tape; water vapour moves from the drop to the reservoir, the drop shrinks and crystals appear.">
    <path d="M30 30V128a6 6 0 0 0 6 6H164a6 6 0 0 0 6-6V30" className="xg-well"/>
    <path d="M32 108H168V128a4 4 0 0 1-4 4H36a4 4 0 0 1-4-4Z" className="xg-reservoir"/>
    <path d="M78 134V78H122V134" className="xg-post"/>
    <path d="M86 78a14 6 0 0 1 28 0Z" className="xg-post-cup"/>
    <rect x="24" y="24" width="152" height="4" rx="1" className="xg-tape"/>
    <g className="xg-drop-shrink sitting"><path d="M86 78a14 11 0 0 1 28 0Z" className="xg-drop"/></g>
    <Crystals cx={100} cy={74}/>
    <Vapour x={52} y1={60} y2={98}/>
    <Vapour x={148} y1={60} y2={98} delay={1.2}/>
    <text x="180" y="29" className="xg-label small">sealing tape</text>
    <text x="120" y="70" className="xg-label small">drop</text>
    <text x="180" y="86" className="xg-label small">post</text>
    <text x="36" y="46" className="xg-label small">water vapour</text>
    <text x="180" y="116" className="xg-label small">reservoir</text>
    <text x="180" y="131" className="xg-label small">(50–100 µL)</text>
  </svg>;
}
