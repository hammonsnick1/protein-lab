"use client";

// The "Export AlphaFold Server JSON" button on the Choose reference match job,
// and the preview it opens.
//
// The preview exists because the job the project implies and the job AlphaFold
// Server will accept are not the same thing: a cofactor may have no CCD code, a
// modification may sit on a residue this construct does not have, and the whole
// assembly may be over the token limit. Everything that was dropped or changed
// is listed before the download, next to the raw JSON, so the scientist uploads
// a file they have already read rather than one they have to debug on the
// server.

import { useMemo, useState } from "react";
import { Atom, Braces, Check, Copy, Dna, Download, ExternalLink, FlaskConical, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { StatusChip, type StatusTone } from "@/components/ui/status-chip";
import type { ProteinBundle } from "@/lib/protein-labs-api";
import { alphaFoldRequestFor, type PartnerChain } from "@/lib/alphafold-server-export";
import { alphaFoldFileName, buildAlphaFoldJob, type ChainSummary, type ExportWarning, type MoleculeSummary } from "@/lib/alphafold-server-job";

const severityChips: Record<ExportWarning["severity"], { tone: StatusTone; label: string }> = {
  excluded: { tone: "warning", label: "Left out" },
  adjusted: { tone: "review", label: "Changed" },
  blocking: { tone: "error", label: "Blocks upload" },
};

const chainKinds: Record<ChainSummary["kind"], string> = { protein: "Protein chain", dna: "DNA strand", rna: "RNA strand" };

export function AlphaFoldServerExport({ bundle }: { bundle: ProteinBundle }) {
  const [open, setOpen] = useState(false);
  const [partners, setPartners] = useState<PartnerChain[]>([]);
  const [status, setStatus] = useState("");
  const result = useMemo(() => buildAlphaFoldJob(alphaFoldRequestFor(bundle, partners)), [bundle, partners]);
  const fileName = alphaFoldFileName(bundle.protein.name);
  const { chains, molecules, tokens, tokenLimit } = result.summary;
  const blocking = result.warnings.filter((warning) => warning.severity === "blocking");

  function addPartner() {
    setPartners((current) => [...current, { id: `partner-${Date.now()}-${current.length}`, label: "", sequence: "", copies: 1 }]);
  }

  function updatePartner(id: string, patch: Partial<PartnerChain>) {
    setPartners((current) => current.map((partner) => (partner.id === id ? { ...partner, ...patch } : partner)));
  }

  function download() {
    const url = URL.createObjectURL(new Blob([result.json], { type: "application/json" }));
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = fileName;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    setStatus(`Saved ${fileName}. Upload it with "Load JSON" on AlphaFold Server.`);
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(result.json);
      setStatus("The job JSON is on the clipboard.");
    } catch {
      setStatus("This window could not reach the clipboard. Download the file instead.");
    }
  }

  return <>
    <Button variant="outline" onClick={() => { setStatus(""); setOpen(true); }}><Braces/> Export AlphaFold Server JSON</Button>
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogContent className="af-export-dialog">
        <DialogHeader>
          <DialogTitle>Export an AlphaFold Server job</DialogTitle>
          <DialogDescription>
            Built from this project&apos;s oligomeric state, cofactors and reference modifications. Save it, then use <a href="https://alphafoldserver.com/" target="_blank" rel="noreferrer">AlphaFold Server<ExternalLink aria-hidden="true"/></a>&apos;s &ldquo;Load JSON&rdquo; to run it.
          </DialogDescription>
        </DialogHeader>

        <div className="af-export-body">
          <div className={`af-export-meter${result.fitsTokenLimit ? "" : " over"}`}>
            <div>
              <strong>{tokens.toLocaleString("en-US")} of {tokenLimit.toLocaleString("en-US")} tokens</strong>
              <small>
                {result.fitsTokenLimit
                  ? "One token per residue or base, one per atom of a ligand, ion or modified residue."
                  : `Over the per-job limit by ${(tokens - tokenLimit).toLocaleString("en-US")} tokens — AlphaFold Server will refuse this job.`}
              </small>
            </div>
            <div className="af-export-bar" role="img" aria-label={`${tokens} of ${tokenLimit} tokens used`}>
              <span style={{ width: `${Math.min(100, (tokens / tokenLimit) * 100)}%` }}/>
            </div>
          </div>

          <section className="af-export-group">
            <header><Dna aria-hidden="true"/><strong>Chains</strong><span>{chains.length}</span></header>
            {chains.length ? <ul>
              {/* Keyed by position: two partner chains may share a name. */}
              {chains.map((chain, index) => <li key={`${chain.kind}-${index}`}>
                <div className="af-export-row">
                  <span className="af-export-name">{chain.label}</span>
                  <small>{chainKinds[chain.kind]} · {chain.length.toLocaleString("en-US")} {chain.kind === "protein" ? "residues" : "bases"} · {chain.count} {chain.count === 1 ? "copy" : "copies"} · {chain.tokens.toLocaleString("en-US")} {chain.tokens === 1 ? "token" : "tokens"}</small>
                </div>
                {(chain.ptms.length > 0 || chain.glycans.length > 0) && <div className="af-export-pills">
                  {chain.ptms.map((ptm) => <span key={`ptm-${ptm.position}`} className="af-export-pill ptm">CCD_{ptm.code} · {ptm.name} at {ptm.position}</span>)}
                  {chain.glycans.map((glycan) => <span key={`glycan-${glycan.position}`} className="af-export-pill glycan">Glycan {glycan.residues} at {glycan.position}</span>)}
                </div>}
              </li>)}
            </ul> : <p className="af-export-none">No chain in this project can be modelled yet.</p>}
          </section>

          <section className="af-export-group">
            <header><FlaskConical aria-hidden="true"/><strong>Ligands and ions</strong><span>{molecules.length}</span></header>
            {molecules.length ? <ul>
              {molecules.map((molecule) => <li key={`${molecule.kind}-${molecule.code}`}>
                <div className="af-export-row">
                  <span className="af-export-name">{moleculeCode(molecule)}</span>
                  <small>{molecule.kind === "ion" ? "Ion" : "Ligand"} · {molecule.count} {molecule.count === 1 ? "copy" : "copies"} · {molecule.name} · {molecule.tokens.toLocaleString("en-US")} {molecule.tokens === 1 ? "token" : "tokens"}</small>
                </div>
              </li>)}
            </ul> : <p className="af-export-none">No cofactor in this project maps to an AlphaFold Server ligand or ion.</p>}
          </section>

          <section className="af-export-group">
            <header><Atom aria-hidden="true"/><strong>Partner chains</strong><span>{partners.length}</span></header>
            <p className="af-export-none">AlphaFold Server needs each partner&apos;s own sequence. Paste any chain this construct is modelled with.</p>
            {partners.map((partner, index) => <div key={partner.id} className="af-export-partner">
              <label>
                <span>Name</span>
                <input value={partner.label} placeholder={`Partner chain ${index + 1}`} onChange={(event) => updatePartner(partner.id, { label: event.target.value })}/>
              </label>
              <label className="af-export-partner-sequence">
                <span>Sequence</span>
                <textarea value={partner.sequence} rows={2} spellCheck={false} placeholder="MVLSPADKTNVKAAW…" onChange={(event) => updatePartner(partner.id, { sequence: event.target.value })}/>
              </label>
              <label className="af-export-partner-copies">
                <span>Copies</span>
                <input type="number" min={1} max={99} value={partner.copies} onChange={(event) => updatePartner(partner.id, { copies: Math.max(1, Number(event.target.value) || 1) })}/>
              </label>
              <Button variant="ghost" size="icon-sm" aria-label={`Remove ${partner.label || `partner chain ${index + 1}`}`} onClick={() => setPartners((current) => current.filter((entry) => entry.id !== partner.id))}><Trash2/></Button>
            </div>)}
            <Button variant="outline" size="sm" onClick={addPartner}><Plus/> Add a partner chain</Button>
          </section>

          {result.warnings.length > 0 && <section className="af-export-group warnings">
            <header><StatusChip tone={blocking.length ? "error" : "warning"} label={`${result.warnings.length} ${result.warnings.length === 1 ? "note" : "notes"}`}/><strong>What changed on the way out</strong></header>
            <ul>
              {result.warnings.map((warning, index) => <li key={`${warning.category}-${index}`}>
                <StatusChip tone={severityChips[warning.severity].tone} label={severityChips[warning.severity].label}/>
                <span>{warning.message}</span>
              </li>)}
            </ul>
          </section>}

          <details className="af-export-json">
            <summary>Raw JSON · {fileName}</summary>
            <pre><code>{result.json}</code></pre>
          </details>
        </div>

        <DialogFooter className="af-export-footer">
          <span>{status || (result.canExport ? `${result.jobs[0].sequences.length} ${result.jobs[0].sequences.length === 1 ? "entity" : "entities"} in one job` : "Nothing to export yet.")}</span>
          <Button variant="outline" onClick={() => void copy()} disabled={!result.canExport}><Copy/> Copy JSON</Button>
          <Button onClick={download} disabled={!result.canExport}>{status.startsWith("Saved") ? <Check/> : <Download/>} Download JSON</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  </>;
}

/** Ligands carry the CCD_ prefix in the JSON; ions do not. */
function moleculeCode(molecule: MoleculeSummary) {
  return molecule.kind === "ligand" ? `CCD_${molecule.code}` : molecule.code;
}
