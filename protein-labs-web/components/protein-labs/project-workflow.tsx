"use client";

import { useEffect, useState } from "react";
import { Activity, Atom, BadgeCheck, Beaker, BookOpen, Boxes, Check, ChevronRight, CircleCheck, Dna, FlaskConical, GitBranch, Microscope, Search } from "lucide-react";
import { Button } from "@/components/ui/button";
import { StructureViewer } from "@/components/protein-labs/structure-viewer";
import type { JsonObject, ProteinBundle } from "@/lib/protein-labs-api";
import { proteinLabsApi } from "@/lib/protein-labs-api";
import { isComplete, workflowJobs, workflowSections, workflowState } from "@/lib/workflow";

const jobIcons = {
  sequence: Dna,
  properties: Activity,
  research: Search,
  "reference-match": BadgeCheck,
  structure: Atom,
  readiness: Check,
  "expression-system": Boxes,
  "expression-vector": Beaker,
  "purification-lysis": Beaker,
  "purification-affinity": FlaskConical,
  "purification-subtractive": FlaskConical,
  "purification-sec": Activity,
  "purification-workflow": GitBranch,
} as const;

const workflowDefinitions = workflowJobs.filter((definition) => definition.stage === "understand" || definition.stage === "plan");
const workflowSectionDefinitions = workflowSections.filter((section) => section.id === "understand" || section.id === "plan");

export function ProjectDashboard({ bundle, onResume, onRoadmap, onReports }: { bundle: ProteinBundle; onResume: () => void; onRoadmap: () => void; onReports: () => void }) {
  const [page, setPage] = useState(0);
  const [geometry, setGeometry] = useState<JsonObject | null>(null);
  const result = bundle.protparam?.result ?? {};
  const model = bundle.alphaFoldModels[0];
  useEffect(() => { const timer = window.setInterval(() => setPage((value) => (value + 1) % 3), 5000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    if (!model?.modelId) { queueMicrotask(() => setGeometry(null)); return; }
    proteinLabsApi.getAlphaFoldModel(bundle.protein.id, String(model.modelId)).then((value) => setGeometry((value.geometry && typeof value.geometry === "object" ? value.geometry : value) as JsonObject)).catch(() => setGeometry(null));
  }, [bundle.protein.id, model?.modelId]);
  const slides = [
    ["Molecular profile", `${formatMetric(result.molecularWeightDa, 1000, 1)} kDa`, `pI ${formatMetric(result.theoreticalPI, 1, 2)} · ${bundle.protein.sequence.length} residues`],
    ["Stability profile", `Instability ${formatMetric(result.instabilityIndex, 1, 1)}`, `Aliphatic ${formatMetric(result.aliphaticIndex, 1, 1)} · GRAVY ${formatMetric(result.gravy, 1, 3)}`],
    ["Project record", `${bundle.projectJobs.length} saved jobs`, `${bundle.uniprotMatches.length} UniProt · ${bundle.pdbMatches.length} PDB · ${bundle.alphaFoldModels.length} structure`],
  ];
  return <main className="project-dashboard">
    <section className="dashboard-structure"><div className={`hologram-protein ${model ? "predicted" : "empty"}`}><StructureViewer geometry={geometry} paletteKey={bundle.protein.id} compact autoRotate hologram label={model ? String(model.name ?? model.modelId ?? "Predicted structure") : "Protein needs to be predicted"}/></div><div className="hologram-base"><span/><span/><span/></div></section>
    <section className="dashboard-controls">
      <span className="eyebrow">CURRENT PROJECT</span><h1>{bundle.protein.name}</h1><p>{bundle.protein.description || "Protein expression and purification project"}</p>
      <Button className="resume-button" onClick={onResume}><ChevronRight/> Resume workflow</Button>
      <div className="project-dashboard-actions"><Button variant="outline" onClick={onRoadmap}><FlaskConical/> Purification roadmap</Button><Button variant="outline" onClick={onReports}><BookOpen/> Report</Button></div>
      <div className="stats-carousel"><span>{slides[page][0]}</span><strong>{slides[page][1]}</strong><small>{slides[page][2]}</small><div>{slides.map((_, index) => <button key={index} className={page === index ? "active" : ""} onClick={() => setPage(index)} aria-label={`Show statistic ${index + 1}`}/>)}</div></div>
      <div className="dashboard-facts"><span><CircleCheck/> Saved locally</span><span><Microscope/> {bundle.protein.organism || "Organism not entered"}</span></div>
    </section>
  </main>;
}

export function ProjectWorkflow({ bundle, onOpenJob, onRoadmap }: { bundle: ProteinBundle; onOpenJob: (jobId: string) => void; onRoadmap: () => void }) {
  const workflowComplete = workflowDefinitions.every((definition) => isComplete(bundle, definition));

  return <main className="workflow-screen workflow-card-only">
    <div className="workflow-toolbar"><span><strong>Workflow</strong><small>{bundle.protein.name} · Complete the jobs in order or open any card when your experiment requires a different path.</small></span></div>
    <div className="workflow-card-view single-project-workflow">
      <section className="workflow-branch-card active"><div className="workflow-section-stack">
        {workflowSectionDefinitions.map((section) => {
          const jobs = workflowDefinitions.filter((definition) => definition.stage === section.id);
          return <section className="workflow-card-section" style={{ "--section-color": section.color } as React.CSSProperties} key={section.id}><header><span><strong>{section.label}</strong><small>{section.description}</small></span><b>{jobs.length} JOBS</b></header><div>{jobs.map((definition, index) => { const Icon = jobIcons[definition.id as keyof typeof jobIcons] ?? Activity; const state = workflowState(bundle, definition); return <button key={definition.id} style={{ "--job-color": definition.color } as React.CSSProperties} onClick={() => onOpenJob(definition.id)}><span><Icon/></span><strong><i>{index + 1}</i>{definition.label}</strong><small>{definition.description}</small><em className={state}>{state.replace("_", " ")}</em></button>; })}</div></section>;
        })}
        <section className="workflow-card-section roadmap-launch-section" style={{ "--section-color": "#ef8f47" } as React.CSSProperties}><header><span><strong>Purify your protein</strong><small>Carry the approved plan to the bench in its data-linked roadmap.</small></span><b>{workflowComplete ? "READY" : "LIVE"}</b></header><button className="workflow-roadmap-launch" onClick={onRoadmap}><span><FlaskConical/></span><strong>Open purification roadmap</strong><small>Run transformation, lysis, capture, cleavage, cleanup, SEC, and quality control. Workflow choices populate the steps automatically.</small><em className={workflowComplete ? "completed" : "available"}>{workflowComplete ? "plan ready" : "available now"}</em><ChevronRight/></button></section>
      </div></section>
    </div>
  </main>;
}

function formatMetric(value: unknown, divisor: number, decimals: number) { return typeof value === "number" ? (value / divisor).toFixed(decimals) : "—"; }
