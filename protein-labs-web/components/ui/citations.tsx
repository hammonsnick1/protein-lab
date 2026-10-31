import type { MouseEvent } from "react";
import { BookOpen, ExternalLink } from "lucide-react";
import {
  citationHref, citationShortLabel, getCitation, LICENSE_REUSE_LABELS, licenseRegister,
  type Citation, type CitationId, type CitationKind, type CitationScope, type LicenseReuse,
} from "../../lib/citations.ts";
import { StatusChip, type StatusTone } from "./status-chip.tsx";

// Usage on any job or panel:
//   const refs = citationScope("hsqc", ["shiftx2", "ucbshift2", "bmrb"]);
//   <p>Shifts come from SHIFTX2<Cite scope={refs} id="shiftx2"/>.</p>
//   <ReferenceList scope={refs}/>
// The marker number and the list number both come from the scope, so they agree.

const REUSE_TONES: Record<LicenseReuse, StatusTone> = { permissive: "pass", restricted: "attention", none: "review" };
const KIND_LABELS: Record<CitationKind, string> = { article: "Paper", book: "Book", software: "Software", database: "Database", website: "Website" };

function jumpToReference(event: MouseEvent<HTMLAnchorElement>, anchor: string) {
  const target = document.getElementById(anchor);
  if (!target) return;
  event.preventDefault();
  target.scrollIntoView({ block: "nearest" });
  target.focus({ preventScroll: true });
}

/** Inline numbered marker, e.g. [2]. Jumps to the entry in the list below. */
export function Cite({ scope, id }: { scope: CitationScope; id: CitationId }) {
  return <CiteGroup scope={scope} ids={[id]}/>;
}

/** Several markers at once, e.g. [1, 3]. */
export function CiteGroup({ scope, ids }: { scope: CitationScope; ids: CitationId[] }) {
  const sorted = [...new Set(ids)].sort((a, b) => scope.number(a) - scope.number(b));
  return <sup className="cite-marker">[{sorted.map((id, index) => {
    const citation = getCitation(id);
    const number = scope.number(id);
    const anchor = scope.anchor(id);
    const label = `${citationShortLabel(citation)}: ${citation.title}`;
    return <span key={id}>{index > 0 && ", "}<a href={`#${anchor}`} title={label} aria-label={`Reference ${number}: ${label}`} onClick={(event) => jumpToReference(event, anchor)}>{number}</a></span>;
  })}]</sup>;
}

function CitationLink({ citation }: { citation: Citation }) {
  const href = citationHref(citation);
  if (!href) return null;
  const text = citation.doi ? `doi:${citation.doi}` : href.replace(/^https?:\/\//, "").replace(/\/$/, "");
  return <a className="reference-link" href={href} target="_blank" rel="noreferrer">{text}<ExternalLink aria-hidden="true"/></a>;
}

/** The references for one job or panel, numbered to match its markers. */
export function ReferenceList({ scope, title = "References", className = "" }: { scope: CitationScope; title?: string; className?: string }) {
  if (scope.ids.length === 0) return null;
  const headingId = `ref-${scope.key}-heading`;
  return <section className={`reference-list ${className}`.trim()} aria-labelledby={headingId}>
    <h3 id={headingId}><BookOpen aria-hidden="true"/>{title}</h3>
    <ol>{scope.ids.map((id) => {
      const citation = getCitation(id);
      return <li key={id} id={scope.anchor(id)} tabIndex={-1}>
        <span className="reference-number">[{scope.number(id)}]</span>
        <div>
          <p className="reference-head">{citation.name && <strong>{citation.name}</strong>}<span className="reference-kind">{KIND_LABELS[citation.kind]}</span></p>
          <p>{citation.authors} ({citation.year}). <cite>{citation.title}</cite>. {citation.source}.</p>
          <CitationLink citation={citation}/>
        </div>
      </li>;
    })}</ol>
  </section>;
}

/** Every recorded licence: what each upstream allows and what the app does with it. */
export function LicenseList({ title = "Licences" }: { title?: string }) {
  const rows = licenseRegister();
  return <section className="license-list" aria-labelledby="license-list-heading">
    <h3 id="license-list-heading">{title}</h3>
    <p className="license-list-intro">Tools and resources the app studies, calls or bundles, with the licence that covers them. Full notices for bundled code are in <code>THIRD_PARTY_NOTICES.md</code>.</p>
    <table>
      <thead><tr><th scope="col">Source</th><th scope="col">Licence</th><th scope="col">Reuse</th><th scope="col">How the app uses it</th></tr></thead>
      <tbody>{rows.map((citation) => <tr key={citation.id}>
        <th scope="row">{citation.name ?? citation.title}<small>{citationShortLabel(citation)}</small></th>
        <td><a href={citation.license.url} target="_blank" rel="noreferrer">{citation.license.name}<ExternalLink aria-hidden="true"/></a></td>
        <td><StatusChip tone={REUSE_TONES[citation.license.reuse]} label={LICENSE_REUSE_LABELS[citation.license.reuse]}/></td>
        <td>{citation.license.usage}</td>
      </tr>)}</tbody>
    </table>
  </section>;
}
