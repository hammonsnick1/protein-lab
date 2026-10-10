"use client";

import { useMemo, useState } from "react";
import { BadgeCheck, Check, CircleAlert, Database, Dna, ExternalLink, LoaderCircle, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { ensureProjectJob, proteinLabsApi } from "@/lib/protein-labs-api";

export function ReferenceMatchJob({ bundle, onChanged }: { bundle: ProteinBundle; onChanged: () => Promise<void> }) {
  const saved = bundle.projectJobs.find((job) => job.appType === "reference-match")?.config ?? {};
  const matches = useMemo(() => [...bundle.uniprotMatches].sort(compareMatches), [bundle.uniprotMatches]);
  const [selectedAccession, setSelectedAccession] = useState(String(saved.selectedAccession ?? matches[0]?.accession ?? recordFor(matches[0]).accession ?? ""));
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const selected = matches.find((match) => accessionFor(match) === selectedAccession);
  const record = recordFor(selected);
  const ptms = objects(record.postTranslationalModifications);
  const cofactors = objects(record.cofactors);
  const locations = objects(record.subcellularLocations);
  const transmembrane = objects(record.transmembraneRegions);
  const disorder = objects(record.disorderedRegions);

  async function save() {
    if (!selected) { setMessage("Select a UniProt match before saving this checkpoint."); return; }
    setBusy(true); setMessage("");
    try {
      const accession = accessionFor(selected);
      const latest = await proteinLabsApi.getProtein(bundle.protein.id);
      await ensureProjectJob(bundle.protein.id, latest.projectJobs, "reference-match", `Reference match — ${accession}`, {
        selectedAccession: accession,
        selectedProteinName: text(record.proteinName ?? record.uniProtkbId ?? record.name),
        selectedOrganism: text(object(record.organism).scientificName),
        identity: numberOrNull(selected.identity),
        queryCoverage: numberOrNull(selected.queryCoverage),
        reviewed: record.reviewed === true,
        evidenceSnapshot: {
          postTranslationalModifications: ptms,
          cofactors,
          subcellularLocations: locations,
          transmembraneRegions: transmembrane,
          disorderedRegions: disorder,
        },
        selectedAt: new Date().toISOString(),
        savedByUser: true,
      });
      await onChanged();
      setMessage(`${accession} is now the reference used by the protein readiness check.`);
    } catch (reason) { setMessage(errorText(reason)); }
    finally { setBusy(false); }
  }

  if (!matches.length) return <div className="reference-workspace empty">
    <Database/><h2>Find a reference before choosing one</h2><p>Run the UniProt sequence match in Sequence research. Saved matches will appear here ranked by sequence identity, query coverage, and review status.</p>
  </div>;

  return <div className="reference-workspace">
    <header><div><span className="eyebrow">BIOLOGICAL REFERENCE CHECKPOINT</span><h2>Choose the closest match to this construct</h2><p>Pick one UniProt record as the traceable source for cofactor, maturation, PTM, localization, topology, and disorder evidence. A close homolog is supporting evidence—not proof that every annotation applies to your construct.</p></div><span className="reference-count"><Dna/>{matches.length} saved matches</span></header>
    <div className="reference-layout">
      <section className="reference-match-list">
        {matches.map((match, index) => {
          const item = recordFor(match); const accession = accessionFor(match); const isSelected = accession === selectedAccession;
          const itemPtms = objects(item.postTranslationalModifications); const itemCofactors = objects(item.cofactors);
          return <button key={`${accession}-${index}`} className={isSelected ? "selected" : ""} onClick={() => setSelectedAccession(accession)}>
            <span className="reference-rank">{index + 1}</span><span><strong>{accession} · {text(item.proteinName ?? item.uniProtkbId ?? item.name, "Unnamed protein")}</strong><small>{text(object(item.organism).scientificName, "Unknown organism")} · {item.reviewed === true ? "Reviewed Swiss-Prot" : "Unreviewed TrEMBL"}</small><span className="reference-metrics"><b>{percent(match.identity)} identity</b><b>{percent(match.queryCoverage)} coverage</b><b>{itemPtms.length} PTM/maturation</b><b>{itemCofactors.length} cofactors</b></span></span>{isSelected && <BadgeCheck/>}
          </button>;
        })}
      </section>
      <section className="reference-detail">
        {selected ? <>
          <header><span><Sparkles/><small>SELECTED EVIDENCE SOURCE</small><strong>{selectedAccession}</strong></span><a href={`https://www.uniprot.org/uniprotkb/${selectedAccession}`} target="_blank" rel="noreferrer">Open UniProt <ExternalLink/></a></header>
          <h3>{text(record.proteinName ?? record.uniProtkbId ?? record.name, "Unnamed protein")}</h3><p>{text(object(record.organism).scientificName, "Organism not recorded")}</p>
          <div className="reference-evidence-grid"><Evidence label="Cofactors" values={cofactors.map(cofactorText)}/><Evidence label="PTM and maturation features" values={ptms.map(regionText)}/><Evidence label="Cellular location" values={locations.map(locationText)}/><Evidence label="Membrane regions" values={transmembrane.map(regionText)}/><Evidence label="Disordered regions" values={disorder.map(regionText)}/></div>
          <div className="reference-warning"><CircleAlert/><span><strong>Transfer annotations cautiously</strong><small>Identity and coverage describe sequence similarity. Confirm active-site residues, modified positions, construct boundaries, organism biology, and literature before treating homolog annotations as experimental facts.</small></span></div>
        </> : <p>Select a match to inspect its biological annotations.</p>}
      </section>
    </div>
    <footer><span>{message}</span><Button disabled={busy || !selected} onClick={() => void save()}>{busy ? <LoaderCircle className="spin"/> : <Check/>} Save selected reference</Button></footer>
  </div>;
}

function Evidence({ label, values }: { label: string; values: string[] }) { return <article><strong>{label}</strong>{values.length ? values.slice(0, 8).map((value, index) => <span key={`${value}-${index}`}>{value}</span>) : <small>No structured annotation in this record.</small>}</article>; }
function recordFor(match: JsonObject | undefined) { const nested = object(match?.record); return Object.keys(nested).length ? nested : (match ?? {}); }
function accessionFor(match: JsonObject | undefined) { const record = recordFor(match); return text(record.accession ?? match?.accession, "Unknown"); }
function compareMatches(a: JsonObject, b: JsonObject) { const score = (value: JsonObject) => Number(value.identity ?? 0) * 100 + Number(value.queryCoverage ?? 0) * 15 + (recordFor(value).reviewed === true ? 1 : 0); return score(b) - score(a); }
function object(value: unknown): JsonObject { return value && typeof value === "object" && !Array.isArray(value) ? value as JsonObject : {}; }
function objects(value: unknown): JsonObject[] { return Array.isArray(value) ? value.filter((item): item is JsonObject => Boolean(item) && typeof item === "object" && !Array.isArray(item)) : []; }
function text(value: unknown, fallback = "—") { return value === null || value === undefined || value === "" ? fallback : String(value); }
function numberOrNull(value: unknown) { const number = Number(value); return Number.isFinite(number) ? number : null; }
function percent(value: unknown) { const number = Number(value); return Number.isFinite(number) ? `${(number * 100).toFixed(1)}%` : "—"; }
function regionText(value: JsonObject) { const location = object(value.location); const start = value.start ?? location.start ?? "?"; const end = value.end ?? location.end ?? "?"; return `${text(value.type, "Feature")}: ${text(value.description, "Annotated region")} (${text(start)}–${text(end)})`; }
function cofactorText(value: JsonObject) { return [value.name, value.chebiId].filter(Boolean).map(String).join(" · ") || "Annotated cofactor"; }
function locationText(value: JsonObject) { return [value.location, value.topology].filter(Boolean).map(String).join(" · ") || "Annotated cellular location"; }
function errorText(value: unknown) { return value instanceof Error ? value.message : String(value); }
