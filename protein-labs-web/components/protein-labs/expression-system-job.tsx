"use client";

/**
 * Expression system job.
 *
 * Three questions, in order: which host family, which strain in it, and what
 * is the evidence. The family rail answers the first, the comparison table
 * answers it with numbers, and every strain card, panel and inspector carries
 * the references the numbers came from. The catalog itself lives in
 * `lib/expression-systems.ts`; this file only renders it.
 */

import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { BookOpen, Check, CircleAlert, CircleCheck, Columns3, ExternalLink, LoaderCircle, Microscope, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ensureProjectJob, type ProteinBundle } from "@/lib/protein-labs-api";
import {
  compatibleVectorFamilies, expressionHosts, expressionVectors, familyMetrics, familyReferences, findHost, hostCategories,
  hostFamilies, hostMetrics, hostReferences, hostSavedConfig, hostSystems, isMeter, matchesHostSearch, normalizeHostSystem,
  referenceCitation, referenceUrl,
  type ExpressionHost, type HostSystem, type MetricCell, type Reference,
} from "@/lib/expression-systems";

function Panel({ title, hint, children, className = "" }: { title: string; hint?: string; children: ReactNode; className?: string }) { return <section className={`lab-panel ${className}`}><div className="panel-heading"><div><h2>{title}</h2>{hint && <p>{hint}</p>}</div></div>{children}</section>; }
function Notice({ message, error = false }: { message: string; error?: boolean }) { return message ? <div className={`inline-message ${error ? "error" : ""}`}>{error ? <CircleAlert/> : <CircleCheck/>} {message}</div> : null; }

/**
 * Each family drawn as what it actually is — a rod with a flagellum, a budding
 * yeast, an insect cell meeting baculovirus particles, an adherent mammalian
 * cell, a reaction tube with ribosomes and no membrane at all — so a card is
 * recognisable before its label is read, and so the five families stay
 * distinguishable in greyscale. Same drawing vocabulary as the purification
 * catalogue cartoons.
 */
export function HostCartoon({ system, className = "" }: { system: HostSystem; className?: string }) {
  return <span className={`catalog-cartoon host-cartoon ${className}`} aria-hidden="true"><svg viewBox="0 0 28 32" fill="none">{hostFigure(system)}</svg></span>;
}

function hostFigure(system: HostSystem) {
  switch (system) {
    case "ecoli":
      // A rod-shaped cell carrying a plasmid, with a flagellum trailing behind.
      return <>
        <path d="M8 11.5h8.5a5 5 0 0 1 0 10H8a5 5 0 0 1 0-10Z" className="cartoon-bead"/>
        <circle cx="11.2" cy="16.5" r="2.1" className="cartoon-fill"/>
        <circle cx="16" cy="16.5" r="2.6" className="cartoon-line"/>
        <path d="M21.6 14q2.4-1.6 3.4.6t2.4.2" className="cartoon-line"/>
        <path d="M5 26.5h18" className="cartoon-base"/>
      </>;
    case "yeast":
      // A budding cell: mother, daughter bud and nucleus.
      return <>
        <circle cx="11.5" cy="18" r="7.5" className="cartoon-bead"/>
        <circle cx="21.6" cy="10.4" r="4.2" className="cartoon-bead"/>
        <circle cx="11.5" cy="18" r="2.6" className="cartoon-fill"/>
        <path d="M4 27.5h18" className="cartoon-base"/>
      </>;
    case "insect":
      // An insect cell being infected: two rod-shaped baculovirus particles,
      // drawn as rods rather than specks so they are not mistaken for sparkle.
      return <>
        <circle cx="11.5" cy="20" r="7.4" className="cartoon-bead"/>
        <circle cx="11.5" cy="20" r="2.4" className="cartoon-fill"/>
        <rect x="16.2" y="3.4" width="3.6" height="9.4" rx="1.8" transform="rotate(38 18 8.1)" className="cartoon-line"/>
        <rect x="22.2" y="7.6" width="3.2" height="8" rx="1.6" transform="rotate(38 23.8 11.6)" className="cartoon-line"/>
        <path d="M4 28.5h15" className="cartoon-base"/>
      </>;
    case "mammalian":
      // An adherent cell spread on a dish, with lamellipodial edges and an
      // off-centre nucleus, so it does not read as a plain eye shape.
      return <>
        <path d="M2.6 22.1c1.4-4.9 5-8.6 9.2-9.2 2.9-.4 4.2 1.9 6.6 1.3 2.3-.6 4.4-1.4 6.4.6 1.9 1.9 1.5 5.1.2 7.3-2.6 4.1-7.2 5.6-11.6 5.4-4-.2-8-1.4-10.2-3.9a2.1 2.1 0 0 1-.6-1.5Z" className="cartoon-bead"/>
        <ellipse cx="12.4" cy="20.4" rx="3.6" ry="2.9" className="cartoon-fill"/>
        <path d="M18.4 18.4q2.1.6 3.4 2.4M8 17.4q-1.6 1.4-2 3.4" className="cartoon-base"/>
        <path d="M1.5 28.5h25" className="cartoon-base"/>
      </>;
    case "cellfree":
      // A reaction tube: template strand and ribosomes, no membrane.
      return <>
        <path d="M9 4.5h10v16.5a5 5 0 0 1-10 0Z" className="cartoon-bead"/>
        <path d="M9 13.5h10v7.5a5 5 0 0 1-10 0Z" className="cartoon-liquid"/>
        <path d="M10.6 16.6q2-2.2 3.9 0t3.5 0" className="cartoon-line"/>
        <circle cx="12" cy="20" r="1.7" className="cartoon-fill"/>
        <circle cx="16.4" cy="19.4" r="1.7" className="cartoon-fill"/>
        <path d="M8 4.5h12" className="cartoon-spark"/>
      </>;
  }
}

/**
 * An ordinal metric is drawn as filled pips and always printed as a label, so
 * the scale survives greyscale and the value is still readable to a screen
 * reader. A value inherited from the family is labelled as such rather than
 * presented as a measurement of the strain.
 */
function MetricValue({ cell }: { cell: MetricCell }) {
  if (isMeter(cell.value)) {
    const meter = cell.value;
    return <span className="metric-meter"><span className="metric-pips" role="img" aria-label={`${meter.level} of ${cell.column.max}`}>{Array.from({ length: cell.column.max }, (_, index) => <b key={index} className={index < meter.level ? "on" : ""}/>)}</span><small>{meter.label}</small></span>;
  }
  return cell.inherited
    ? <span className="metric-text inherited">{cell.value}<em>family typical</em></span>
    : <span className="metric-text">{cell.value}</span>;
}

type ComparisonEntry = { key: string; name: string; subtitle: string; color: string; system: HostSystem; cells: MetricCell[]; chosen: boolean };

/** Metrics down the rows, systems or strains across the columns. */
function ComparisonTable({ entries, action, chooseLabel, chosenLabel, onChoose, onRemove }: { entries: ComparisonEntry[]; action: string; chooseLabel: string; chosenLabel?: string; onChoose: (entry: ComparisonEntry) => void; onRemove?: (entry: ComparisonEntry) => void }) {
  return <div className="metric-table-wrap">
    <table className="metric-table" style={{ "--columns": entries.length } as CSSProperties}>
      <caption className="sr-only">Expression systems compared across {entries[0]?.cells.length ?? 0} criteria</caption>
      <thead><tr><th scope="col"><span className="metric-corner">Criterion</span></th>{entries.map((entry) => <th key={entry.key} scope="col" style={{ "--host-color": entry.color } as CSSProperties} className={entry.chosen ? "chosen" : ""}>
        <span className="metric-head"><HostCartoon system={entry.system}/><strong>{entry.name}</strong><small>{entry.subtitle}</small></span>
        {onRemove && <button className="metric-head-remove" onClick={() => onRemove(entry)} aria-label={`Remove ${entry.name} from the comparison`}><X/></button>}
      </th>)}</tr></thead>
      <tbody>{entries[0]?.cells.map((_, row) => <tr key={entries[0].cells[row].key}>
        <th scope="row"><strong>{entries[0].cells[row].column.label}</strong><small>{entries[0].cells[row].column.hint}</small></th>
        {entries.map((entry) => <td key={entry.key} style={{ "--host-color": entry.color } as CSSProperties} className={entry.chosen ? "chosen" : ""}><MetricValue cell={entry.cells[row]}/></td>)}
      </tr>)}</tbody>
      <tfoot><tr><th scope="row"><small>{action}</small></th>{entries.map((entry) => <td key={entry.key} className={entry.chosen ? "chosen" : ""}><Button size="sm" variant={entry.chosen && chosenLabel ? "secondary" : "outline"} onClick={() => onChoose(entry)}>{entry.chosen && chosenLabel ? <><Check/> {chosenLabel}</> : chooseLabel}</Button></td>)}</tr></tfoot>
    </table>
  </div>;
}

function ReferenceList({ references }: { references: Reference[] }) {
  return <ul className="host-reference-list">{references.map((reference) => {
    const url = referenceUrl(reference);
    return <li key={reference.id} className={reference.kind}>
      <span className="host-reference-kind">{reference.kind === "vendor" ? "VENDOR DOC" : "LITERATURE"}</span>
      <span><strong>{referenceCitation(reference)}</strong><small>{reference.title}</small></span>
      {url && <a href={url} target="_blank" rel="noreferrer" aria-label={`Open DOI ${reference.doi}`}>doi <ExternalLink/></a>}
    </li>;
  })}</ul>;
}

function InsightList({ title, items, tone }: { title: string; items: string[]; tone: "strength" | "limit" }) {
  return <div className={`host-insight ${tone}`}><strong>{title}</strong><ul>{items.map((item) => <li key={item}>{tone === "strength" ? <CircleCheck/> : <CircleAlert/>}<span>{item}</span></li>)}</ul></div>;
}

export function ExpressionJob({ bundle, onChanged }: { bundle: ProteinBundle; onChanged: () => Promise<void> }) {
  const saved = bundle.projectJobs.find((job) => job.appType === "expression-system");
  const savedHostId = String(saved?.config.strainId ?? saved?.config.hostId ?? "");
  const savedHost = savedHostId ? findHost(savedHostId) : null;
  const savedSystem = savedHost?.system ?? normalizeHostSystem(saved?.config.hostSystemId ?? saved?.config.hostSystem);
  // Browsing a family no longer discards the chosen cell line: the choice is
  // one piece of state that carries its own family with it.
  const [family, setFamily] = useState<HostSystem>(savedSystem);
  const [chosenId, setChosenId] = useState(savedHost?.host.id ?? "");
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState("All hosts");
  const [comparison, setComparison] = useState<string[]>([]);
  const [compareMode, setCompareMode] = useState<"families" | "strains">("families");
  const [inspector, setInspector] = useState<{ kind: "host" | "vector"; system: HostSystem; id: string } | null>(null);
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!inspector) return;
    function close(event: KeyboardEvent) { if (event.key === "Escape") setInspector(null); }
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  }, [inspector]);

  const chosen = chosenId ? findHost(chosenId) : null;
  const options = expressionHosts[family];
  const categories = hostCategories(family);
  const visibleHosts = options.filter((entry) => (category === "All hosts" || entry.category === category) && matchesHostSearch(entry, search));
  const vectorMatches = chosen ? compatibleVectorFamilies(chosen.system, chosen.host) : [];

  const familyEntries = useMemo<ComparisonEntry[]>(() => hostSystems.map((system) => ({
    key: system, name: hostFamilies[system].shortName, subtitle: hostFamilies[system].subtitle, color: hostFamilies[system].color,
    system, cells: familyMetrics(system), chosen: chosen?.system === system,
  })), [chosen?.system]);
  const strainEntries = useMemo<ComparisonEntry[]>(() => comparison.map((id) => findHost(id)).filter((entry): entry is { system: HostSystem; host: ExpressionHost } => Boolean(entry)).map(({ system, host }) => ({
    key: host.id, name: host.name, subtitle: `${hostFamilies[system].shortName} · ${host.category}`, color: host.color,
    system, cells: hostMetrics(system, host), chosen: chosenId === host.id,
  })), [comparison, chosenId]);
  const showStrains = compareMode === "strains" && strainEntries.length >= 2;

  function toggleCompare(id: string) {
    setComparison((values) => {
      if (values.includes(id)) return values.filter((value) => value !== id);
      if (values.length >= 4) return values;
      if (values.length >= 1) setCompareMode("strains");
      return [...values, id];
    });
  }
  function choose(system: HostSystem, id: string) { setFamily(system); setChosenId(id); setCategory("All hosts"); setInspector(null); setMessage(""); }

  async function saveHost() {
    if (!chosen) { setMessage("Choose a cell line before saving."); return; }
    setBusy(true);
    try {
      // Only the cell line is committed here. The vector is chosen later, in
      // Expression vector design, against a real annotated backbone.
      await ensureProjectJob(bundle.protein.id, bundle.projectJobs, "expression-system", `Expression system — ${chosen.host.name}`, hostSavedConfig(chosen.system, chosen.host), "complete");
      await onChanged();
      setMessage(`${chosen.host.name} saved as the expression cell line.`);
    } catch (reason) { setMessage(reason instanceof Error ? reason.message : String(reason)); }
    finally { setBusy(false); }
  }

  const inspectedHost = inspector?.kind === "host" ? expressionHosts[inspector.system].find((entry) => entry.id === inspector.id) ?? null : null;
  const inspectedVector = inspector?.kind === "vector" ? expressionVectors[inspector.system].find((entry) => entry.id === inspector.id) ?? null : null;
  const browsing = hostFamilies[family];

  return <div className="expression-layout">
      <Panel title="Host systems" hint="Five production routes. Pick a family to see its strains; the table below compares them on the criteria that usually decide the choice." className="host-family-panel expression-full">
        <div className="host-family-rail" role="group" aria-label="Expression host families">
          {hostSystems.map((system) => {
            const entry = hostFamilies[system];
            return <button key={system} className={`host-family-card ${family === system ? "browsing" : ""} ${chosen?.system === system ? "chosen" : ""}`} style={{ "--host-color": entry.color } as CSSProperties} aria-pressed={family === system} onClick={() => { setFamily(system); setCategory("All hosts"); setSearch(""); }}>
              <HostCartoon system={system}/>
              <strong>{entry.shortName}</strong>
              <small>{entry.subtitle}</small>
              <em>{expressionHosts[system].length} strains · {familyReferences(system).length} refs</em>
              {chosen?.system === system && <span className="host-family-flag"><Check/> chosen</span>}
            </button>;
          })}
        </div>
      </Panel>

      <Panel title="Side-by-side comparison" hint={showStrains ? "The strains you ticked, on the same criteria. Values a strain does not change are marked as its family's typical value." : "Host families on the criteria that usually decide the choice. Tick two or more strains below to compare those instead."} className="metric-panel expression-full">
        <div className="metric-mode" role="group" aria-label="Comparison scope">
          <button className={compareMode === "families" ? "on" : ""} aria-pressed={compareMode === "families"} onClick={() => setCompareMode("families")}><Microscope/> Host families · 5</button>
          <button className={compareMode === "strains" ? "on" : ""} aria-pressed={compareMode === "strains"} disabled={strainEntries.length < 2} onClick={() => setCompareMode("strains")}><Columns3/> Ticked strains · {strainEntries.length}/4</button>
        </div>
        {showStrains
          ? <ComparisonTable entries={strainEntries} action="Choose the cell line for this project" chooseLabel="Choose" chosenLabel="Chosen" onChoose={(entry) => choose(entry.system, entry.key)} onRemove={(entry) => toggleCompare(entry.key)}/>
          : <ComparisonTable entries={familyEntries} action="Open a family to see its strains" chooseLabel="Browse strains" onChoose={(entry) => { setFamily(entry.system); setCategory("All hosts"); setSearch(""); }}/>}
        {compareMode === "strains" && strainEntries.length < 2 && <p className="expression-empty">Tick the Compare box on two to four strains to put them side by side.</p>}
      </Panel>

    <div className="expression-main">
      <Panel title={`${browsing.name} strains`} hint={browsing.summary} className="expression-host-panel">
        <div className="host-filter-row">
          <label><Search/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search strains, genotypes, markers, or applications"/></label>
          <select value={category} onChange={(event) => setCategory(event.target.value)} aria-label="Filter by strain category">{categories.map((value) => <option key={value}>{value}</option>)}</select>
          <span>{visibleHosts.length} of {options.length} {browsing.shortName} strains</span>
        </div>
        <div className="host-grid">{visibleHosts.map((entry) => {
          const cells = hostMetrics(family, entry);
          const costCell = cells.find((cell) => cell.key === "cost")!;
          const ptmCell = cells.find((cell) => cell.key === "ptm")!;
          return <div key={entry.id} className={`host-card ${chosenId === entry.id ? "selected" : ""}`} style={{ "--host-color": entry.color } as CSSProperties}>
            <button onClick={() => setInspector({ kind: "host", system: family, id: entry.id })} aria-label={`Open ${entry.name} details`}>
              <HostCartoon system={family}/>
              <span>
                <strong>{entry.name}{entry.aka && <i>{entry.aka}</i>}</strong>
                <small>{entry.category}</small>
                <em>{entry.usefulFor}</em>
                <span className="host-card-chips">
                  <b title="Relative cost"><MetricValue cell={costCell}/></b>
                  <b title="Post-translational modification">{isMeter(ptmCell.value) ? ptmCell.value.label : ""}</b>
                  <b title="References on this strain"><BookOpen/>{hostReferences(entry).length} refs</b>
                </span>
              </span>
              {chosenId === entry.id && <Check/>}
            </button>
            <div className="host-card-actions">
              <label><input type="checkbox" checked={comparison.includes(entry.id)} disabled={!comparison.includes(entry.id) && comparison.length >= 4} onChange={() => toggleCompare(entry.id)}/>Compare</label>
              <Button size="sm" variant={chosenId === entry.id ? "secondary" : "outline"} onClick={() => choose(family, entry.id)}>{chosenId === entry.id ? <><Check/> Chosen</> : "Choose"}</Button>
            </div>
          </div>;
        })}</div>
        {!visibleHosts.length && <p className="expression-empty">No {browsing.shortName} strain matches “{search}”{category === "All hosts" ? "" : ` in ${category}`}. Clear the search or pick another category.</p>}
      </Panel>
    </div>

    <div className="expression-side">
      <Panel title="Chosen cell line" hint={chosen ? "Save this cell line to the project, then design its vector in the next job." : "Choose a strain from the catalog or the comparison table to continue."}>
        {chosen
          ? <>
              <div className="host-profile-heading" style={{ "--host-color": chosen.host.color } as CSSProperties}><HostCartoon system={chosen.system}/><span><strong>{chosen.host.name}</strong><small>{hostFamilies[chosen.system].shortName} · {chosen.host.category}</small></span></div>
              <dl className="host-metric-grid">{hostMetrics(chosen.system, chosen.host).map((cell) => <div key={cell.key}><dt>{cell.column.label}</dt><dd><MetricValue cell={cell}/></dd></div>)}</dl>
              <dl className="host-details"><dt>Lineage</dt><dd>{chosen.host.lineage}</dd><dt>Promoter machinery</dt><dd>{chosen.host.promoter}</dd><dt>Genotype</dt><dd>{chosen.host.genotype}</dd><dt>Markers</dt><dd>{chosen.host.markers}</dd></dl>
              <div className="host-tags">{chosen.host.bestFor.map((item) => <span key={item}>{item}</span>)}</div>
              <Button className="wide" disabled={busy} onClick={() => void saveHost()}>{busy ? <LoaderCircle className="spin"/> : <Check/>} Save cell line</Button>
            </>
          : <p className="expression-empty">No cell line chosen yet. Pick one to see its full profile, its references, and the vectors that are compatible with it.</p>}
        <Notice message={message} error={/error|could not|choose/i.test(message)}/>
      </Panel>

      {chosen && <Panel title="Evidence for this strain" hint="Every number and claim on this strain traces back to one of these." className="host-evidence-panel">
        <ReferenceList references={hostReferences(chosen.host)}/>
      </Panel>}

      {chosen && <Panel title="Compatible vector families" hint={`Reference only — ${vectorMatches.length} families work with ${chosen.host.name}. The vector itself is chosen in Expression vector design.`}>
        <div className="vector-family-list">{vectorMatches.map(({ family: vectorFamily, level, note }) => <button key={vectorFamily.id} className={level} onClick={() => setInspector({ kind: "vector", system: chosen.system, id: vectorFamily.id })}><span><strong>{vectorFamily.name}</strong><small>{vectorFamily.promoter} · {vectorFamily.selection}</small><em>{note}</em></span>{level === "warning" ? <CircleAlert/> : <CircleCheck/>}</button>)}</div>
        {!vectorMatches.length && <p className="expression-empty">No catalog vector family is listed for {chosen.host.name}.</p>}
      </Panel>}

      <Panel title={`About ${browsing.name}`} hint="What this family is good at, where it runs out, and the reviews behind the figures." className="host-evidence-panel">
        <p className="host-family-summary">{browsing.summary}</p>
        <InsightList title="Strengths" items={browsing.strengths} tone="strength"/>
        <InsightList title="Limits" items={browsing.limits} tone="limit"/>
        <ReferenceList references={familyReferences(family)}/>
      </Panel>
    </div>

    {inspectedHost && <aside className="selection-inspector" role="dialog" aria-label={`${inspectedHost.name} details`}>
      <header><span><small>EXPRESSION HOST</small><strong>{inspectedHost.name}</strong></span><Button variant="ghost" size="icon" onClick={() => setInspector(null)} aria-label="Close details"><X/></Button></header>
      <div className="selection-inspector-body">
        <div className="host-profile-heading" style={{ "--host-color": inspectedHost.color } as CSSProperties}><HostCartoon system={inspector!.system}/><span><strong>{inspectedHost.category}</strong><small>{inspectedHost.aka ? `${inspectedHost.lineage} · also sold as ${inspectedHost.aka}` : inspectedHost.lineage}</small></span></div>
        <p>{inspectedHost.usefulFor}</p>
        <dl className="host-metric-grid">{hostMetrics(inspector!.system, inspectedHost).map((cell) => <div key={cell.key}><dt>{cell.column.label}</dt><dd><MetricValue cell={cell}/></dd></div>)}</dl>
        <InsightList title="Strengths" items={inspectedHost.strengths} tone="strength"/>
        <InsightList title="Limits" items={inspectedHost.limits} tone="limit"/>
        <dl className="host-details"><dt>Genotype</dt><dd>{inspectedHost.genotype}</dd><dt>Promoter</dt><dd>{inspectedHost.promoter}</dd><dt>Markers</dt><dd>{inspectedHost.markers}</dd></dl>
        <div className="host-tags">{inspectedHost.bestFor.map((item) => <span key={item}>{item}</span>)}</div>
        <div className="host-caution"><CircleAlert/><span><strong>Selection caution</strong><small>{inspectedHost.caution}</small></span></div>
        <ReferenceList references={hostReferences(inspectedHost)}/>
      </div>
      <footer><Button variant="outline" onClick={() => setInspector(null)}>Close</Button><Button onClick={() => { if (inspector) choose(inspector.system, inspector.id); }}><Check/> Choose this cell line</Button></footer>
    </aside>}

    {inspectedVector && <aside className="selection-inspector" role="dialog" aria-label={`${inspectedVector.name} details`}>
      <header><span><small>VECTOR FAMILY</small><strong>{inspectedVector.name}</strong></span><Button variant="ghost" size="icon" onClick={() => setInspector(null)} aria-label="Close details"><X/></Button></header>
      <div className="selection-inspector-body">
        <p>{inspectedVector.benefits}</p>
        <dl className="host-details"><dt>Promoter</dt><dd>{inspectedVector.promoter}</dd><dt>Replication</dt><dd>{inspectedVector.replication}</dd><dt>Selection</dt><dd>{inspectedVector.selection}</dd><dt>Delivery</dt><dd>{inspectedVector.delivery}</dd></dl>
        <div className="host-caution"><CircleAlert/><span><strong>Selection caution</strong><small>{inspectedVector.caution}</small></span></div>
      </div>
      <footer><Button variant="outline" onClick={() => setInspector(null)}>Close</Button></footer>
    </aside>}
  </div>;
}
