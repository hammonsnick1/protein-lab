"use client";

import { useMemo, useState } from "react";
import { ArrowRight, Dna, GitBranch, Link2, Pencil, Plus, Save, Trash2, Trees } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProteinRecord } from "@/lib/protein-labs-api";
import type { SavedProjectTree } from "@/lib/project-trees";

const relationshipTypes = ["Construct change", "Vector change", "Host change", "Tag change", "Purification change", "Assay change", "Other"];

type Props = {
  proteins: ProteinRecord[];
  trees: SavedProjectTree[];
  onChange: (trees: SavedProjectTree[]) => void;
  onOpenProject: (projectId: string) => void;
};

export function ProjectTrees({ proteins, trees, onChange, onOpenProject }: Props) {
  const [selectedId, setSelectedId] = useState(trees[0]?.id ?? "");
  const [createOpen, setCreateOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [treeName, setTreeName] = useState("");
  const [rootProjectId, setRootProjectId] = useState(proteins[0]?.id ?? "");
  const selected = trees.find((tree) => tree.id === selectedId) ?? trees[0];
  const projectMap = useMemo(() => new Map(proteins.map((protein) => [protein.id, protein])), [proteins]);
  const projectIds = selected ? [...new Set([selected.rootProjectId, ...selected.relationships.flatMap((link) => [link.fromProjectId, link.toProjectId])])] : [];
  const [fromProjectId, setFromProjectId] = useState("");
  const [toProjectId, setToProjectId] = useState("");
  const [changeType, setChangeType] = useState(relationshipTypes[0]);
  const [description, setDescription] = useState("");

  function save(next: SavedProjectTree[]) {
    onChange(next);
    if (!next.some((tree) => tree.id === selectedId)) setSelectedId(next[0]?.id ?? "");
  }

  function createTree() {
    if (!rootProjectId) return;
    const now = new Date().toISOString();
    const tree: SavedProjectTree = { id: crypto.randomUUID(), name: treeName.trim() || `${projectMap.get(rootProjectId)?.name ?? "Project"} tree`, rootProjectId, relationships: [], createdAt: now, updatedAt: now };
    save([...trees, tree]); setSelectedId(tree.id); setTreeName(""); setCreateOpen(false);
  }

  function openLinkDialog() {
    if (!selected) return;
    const sources = projectIds.length ? projectIds : [selected.rootProjectId];
    const source = sources[0];
    setFromProjectId(source);
    setToProjectId(proteins.find((protein) => protein.id !== source && !projectIds.includes(protein.id))?.id ?? "");
    setChangeType(relationshipTypes[0]); setDescription(""); setLinkOpen(true);
  }

  function addRelationship() {
    if (!selected || !fromProjectId || !toProjectId || fromProjectId === toProjectId) return;
    const relationship = { id: crypto.randomUUID(), fromProjectId, toProjectId, changeType, description: description.trim() };
    save(trees.map((tree) => tree.id === selected.id ? { ...tree, relationships: [...tree.relationships, relationship], updatedAt: new Date().toISOString() } : tree));
    setLinkOpen(false);
  }

  function renameTree() {
    if (!selected) return;
    const name = window.prompt("Tree name", selected.name)?.trim();
    if (!name || name === selected.name) return;
    save(trees.map((tree) => tree.id === selected.id ? { ...tree, name, updatedAt: new Date().toISOString() } : tree));
  }

  function deleteTree() {
    if (!selected || !window.confirm(`Delete “${selected.name}”? The projects will remain saved.`)) return;
    save(trees.filter((tree) => tree.id !== selected.id));
  }

  function deleteRelationship(linkId: string) {
    if (!selected) return;
    save(trees.map((tree) => tree.id === selected.id ? { ...tree, relationships: tree.relationships.filter((link) => link.id !== linkId), updatedAt: new Date().toISOString() } : tree));
  }

  return <main className="project-trees-workspace">
    <aside className="project-tree-library">
      <header><span><b>PROJECT RELATIONSHIPS</b><h1>Project trees</h1><p>Connect complete projects and record what changed between them.</p></span><Button size="icon" onClick={() => { setRootProjectId(proteins[0]?.id ?? ""); setCreateOpen(true); }} disabled={!proteins.length}><Plus/></Button></header>
      <div>{trees.map((tree) => <button key={tree.id} className={tree.id === selected?.id ? "selected" : ""} onClick={() => setSelectedId(tree.id)}><Trees/><span><strong>{tree.name}</strong><small>{tree.relationships.length} branch{tree.relationships.length === 1 ? "" : "es"}</small></span><ArrowRight/></button>)}{!trees.length && <div className="project-tree-empty-list"><GitBranch/><strong>No project trees yet</strong><small>Create one after you have two or more related projects.</small></div>}</div>
    </aside>

    <section className="project-tree-main">
      {selected ? <>
        <header><span><b>SAVED PROJECT TREE</b><h2>{selected.name}</h2><p>{projectIds.length} linked project{projectIds.length === 1 ? "" : "s"} · {selected.relationships.length} branch{selected.relationships.length === 1 ? "" : "es"}</p></span><div><Button variant="outline" onClick={renameTree}><Pencil/> Rename</Button><Button onClick={openLinkDialog} disabled={proteins.length < 2}><Link2/> Link project</Button><Button variant="ghost" size="icon" onClick={deleteTree} aria-label="Delete tree"><Trash2/></Button></div></header>
        <div className="project-tree-canvas">
          <ProjectNode protein={projectMap.get(selected.rootProjectId)} root onOpen={onOpenProject}/>
          {selected.relationships.length ? <div className="project-relationship-list">{selected.relationships.map((link) => <article key={link.id}>
            <ProjectNode protein={projectMap.get(link.fromProjectId)} compact onOpen={onOpenProject}/>
            <div className="project-relationship-edge"><span/><b>{link.changeType}</b><small>{link.description || "No additional explanation recorded."}</small><ArrowRight/></div>
            <ProjectNode protein={projectMap.get(link.toProjectId)} compact onOpen={onOpenProject}/>
            <button className="relationship-delete" onClick={() => deleteRelationship(link.id)} title="Remove this link"><Trash2/></button>
          </article>)}</div> : <div className="project-tree-empty-canvas"><Link2/><h3>Connect another project</h3><p>Add a branch and explain whether the construct, vector, host, purification, or assay changed.</p><Button onClick={openLinkDialog} disabled={proteins.length < 2}><Plus/> Add first link</Button></div>}
        </div>
      </> : <div className="project-tree-welcome"><Trees/><h1>Show how your projects are related</h1><p>Each node is a separate Protein Lab project with its own Workflow, Roadmap, and Notebook.</p><Button onClick={() => setCreateOpen(true)} disabled={!proteins.length}><Plus/> New project tree</Button></div>}
    </section>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="dialog-panel"><DialogHeader><DialogTitle>Create a project tree</DialogTitle><DialogDescription>Choose the starting project. You can link more saved projects after the tree is created.</DialogDescription></DialogHeader><label className="field">Tree name<input autoFocus value={treeName} onChange={(event) => setTreeName(event.target.value)} placeholder="e.g. Hemoglobin construct series"/></label><label className="field">Starting project<select value={rootProjectId} onChange={(event) => setRootProjectId(event.target.value)}>{proteins.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>)}</select></label><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button onClick={createTree} disabled={!rootProjectId}><Save/> Create tree</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent className="dialog-panel"><DialogHeader><DialogTitle>Link a project</DialogTitle><DialogDescription>Add a separate project as a new branch and explain the relationship.</DialogDescription></DialogHeader><label className="field">Link from<select value={fromProjectId} onChange={(event) => setFromProjectId(event.target.value)}>{projectIds.map((id) => <option key={id} value={id}>{projectMap.get(id)?.name ?? "Missing project"}</option>)}</select></label><label className="field">Project to add<select value={toProjectId} onChange={(event) => setToProjectId(event.target.value)}><option value="">Choose a project</option>{proteins.filter((protein) => protein.id !== fromProjectId && !projectIds.includes(protein.id)).map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>)}</select></label><label className="field">What changed?<select value={changeType} onChange={(event) => setChangeType(event.target.value)}>{relationshipTypes.map((value) => <option key={value}>{value}</option>)}</select></label><label className="field">Explain the link<textarea rows={4} value={description} onChange={(event) => setDescription(event.target.value)} placeholder="e.g. Same protein sequence moved from pET-28a to pMAL-c5X to improve solubility."/></label><DialogFooter><Button variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button><Button onClick={addRelationship} disabled={!fromProjectId || !toProjectId}><Link2/> Save link</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}

function ProjectNode({ protein, root = false, compact = false, onOpen }: { protein?: ProteinRecord; root?: boolean; compact?: boolean; onOpen: (projectId: string) => void }) {
  if (!protein) return <div className="project-tree-node missing"><Dna/><span><strong>Project unavailable</strong><small>The saved link can be removed.</small></span></div>;
  return <button className={`project-tree-node ${root ? "root" : ""} ${compact ? "compact" : ""}`} onClick={() => onOpen(protein.id)}><Dna/><span><strong>{protein.name}</strong><small>{protein.sequence.length} aa · {protein.organism || "Organism not entered"}</small></span><ArrowRight/></button>;
}
