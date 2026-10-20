"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowDownRight, ArrowRight, ArrowUpRight, Crosshair, Disc3, Dna, FlaskConical, GitBranch,
  Link2, Loader2, Maximize2, Microscope, Minus, Pencil, Plus, Save, Scale, StickyNote, Tag, Trash2,
  Trees, TriangleAlert, Unlink, X, ZoomIn, ZoomOut,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProteinRecord } from "@/lib/protein-labs-api";
import { treeProjectIds } from "@/lib/project-trees";
import {
  CATEGORY_STYLES, orderCategories, primaryCategory,
  type ChangeCategory, type ProjectDiff, type ProjectTree, type ProjectTreeBranch, type SequenceDiff,
} from "@/lib/project-tree-types";
import {
  DEFAULT_LAYOUT, LABEL_HEIGHT, LABEL_WIDTH,
  canReparent, fitToViewport, labelRowOffset, layoutProjectTree,
  type LayoutEdge, type LayoutNode, type TreeLayout,
} from "@/lib/project-tree-layout";
import {
  DiffCache, createTree as createTreeIn, deleteTree as deleteTreeIn, linkBranch,
  renameTree as renameTreeIn, resolveBranchSummaries, unlinkBranch, updateBranch, type StorageMode,
} from "@/lib/project-tree-store";

const CATEGORY_ICONS: Record<ChangeCategory, typeof Dna> = {
  sequence: Dna, vector: Disc3, host: Microscope, tag: Tag,
  purification: FlaskConical, assay: Activity, protparam: Scale, notes: StickyNote, other: GitBranch,
};

const MIN_SCALE = 0.2;
const MAX_SCALE = 1.8;
const MINIMAP_WIDTH = 164;
const MINIMAP_HEIGHT = 100;
/** Residues shown either side of a change when the strip is windowed. */
const STRIP_FLANK = 9;

type Props = {
  proteins: ProteinRecord[];
  trees: ProjectTree[];
  storageMode: StorageMode;
  loading: boolean;
  onChange: (trees: ProjectTree[]) => void;
  onOpenProject: (projectId: string) => void;
};

type BranchFacts = { summary: string; categories: ChangeCategory[]; changeCount: number };

export function ProjectTrees({ proteins, trees, storageMode, loading, onChange, onOpenProject }: Props) {
  const [selectedTreeId, setSelectedTreeId] = useState("");
  const [selectedBranchId, setSelectedBranchId] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [facts, setFacts] = useState<Map<string, BranchFacts>>(new Map());
  const [diff, setDiff] = useState<ProjectDiff | null>(null);
  const [diffLoading, setDiffLoading] = useState(false);
  const [createOpen, setCreateOpen] = useState(false);
  const [renameOpen, setRenameOpen] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [treeName, setTreeName] = useState("");
  const [rootProjectId, setRootProjectId] = useState("");
  const [fromProjectId, setFromProjectId] = useState("");
  const [toProjectId, setToProjectId] = useState("");
  const [note, setNote] = useState("");

  const cache = useRef(new DiffCache(storageMode));
  useEffect(() => { cache.current = new DiffCache(storageMode); }, [storageMode]);

  const selected = trees.find((tree) => tree.id === selectedTreeId) ?? trees[0];
  const projectMap = useMemo(() => new Map(proteins.map((protein) => [protein.id, protein])), [proteins]);

  // Branches the engine has not summarised (local mode, or just created) get
  // their summary from the diff service, merged in at render time only.
  useEffect(() => {
    if (!selected) return;
    let live = true;
    void resolveBranchSummaries(selected, cache.current).then((resolved) => {
      if (live && resolved.size) setFacts((current) => new Map([...current, ...resolved]));
    });
    return () => { live = false; };
  }, [selected]);

  const branches = useMemo<ProjectTreeBranch[]>(
    () => (selected?.branches ?? []).map((branch) => {
      const extra = branch.summary ? null : facts.get(branch.id);
      return extra ? { ...branch, ...extra } : branch;
    }),
    [selected, facts],
  );
  const layout = useMemo(
    () => layoutProjectTree(selected?.rootProjectId ?? "", branches),
    [selected?.rootProjectId, branches],
  );
  const selectedBranch = branches.find((branch) => branch.id === selectedBranchId);

  useEffect(() => {
    if (!selectedBranch) { setDiff(null); return; }
    let live = true;
    setDiffLoading(true);
    cache.current.diff(selectedBranch.fromProjectId, selectedBranch.toProjectId)
      .then((result) => { if (live) { setDiff(result); setDiffLoading(false); } })
      .catch(() => { if (live) { setDiff(null); setDiffLoading(false); } });
    return () => { live = false; };
  }, [selectedBranch?.fromProjectId, selectedBranch?.toProjectId]); // eslint-disable-line react-hooks/exhaustive-deps

  /** Every mutation runs through here so failures surface in one place. */
  const mutate = useCallback(async (next: Promise<ProjectTree[]>) => {
    setBusy(true);
    setError("");
    try {
      onChange(await next);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : String(reason));
    } finally {
      setBusy(false);
    }
  }, [onChange]);

  function openCreate() {
    setTreeName("");
    setRootProjectId(proteins[0]?.id ?? "");
    setCreateOpen(true);
  }

  async function createTree() {
    if (!rootProjectId) return;
    const name = treeName.trim() || `${projectMap.get(rootProjectId)?.name ?? "Project"} tree`;
    setCreateOpen(false);
    const known = new Set(trees.map((tree) => tree.id));
    await mutate(createTreeIn(storageMode, trees, name, rootProjectId).then((next) => {
      const created = next.find((tree) => !known.has(tree.id));
      if (created) { setSelectedTreeId(created.id); setSelectedBranchId(""); }
      return next;
    }));
  }

  async function renameTree() {
    if (!selected || !treeName.trim()) return;
    setRenameOpen(false);
    await mutate(renameTreeIn(storageMode, trees, selected.id, treeName.trim()));
  }

  async function deleteTree() {
    if (!selected) return;
    if (!window.confirm(`Delete “${selected.name}”? The projects themselves stay saved.`)) return;
    setSelectedBranchId("");
    setSelectedTreeId("");
    await mutate(deleteTreeIn(storageMode, trees, selected.id));
  }

  function openLink(preferredParent = "") {
    if (!selected) return;
    const inTree = treeProjectIds(selected);
    setFromProjectId(preferredParent || inTree[0] || selected.rootProjectId);
    setToProjectId(proteins.find((protein) => !inTree.includes(protein.id))?.id ?? "");
    setNote("");
    setLinkOpen(true);
  }

  async function addLink() {
    if (!selected || !fromProjectId || !toProjectId || fromProjectId === toProjectId) return;
    setLinkOpen(false);
    await mutate(linkBranch(storageMode, trees, selected.id, fromProjectId, toProjectId, note.trim()));
  }

  async function removeLink(branchId: string) {
    if (!selected) return;
    if (branchId === selectedBranchId) setSelectedBranchId("");
    await mutate(unlinkBranch(storageMode, trees, selected.id, branchId));
  }

  async function reparent(branchId: string, newParentId: string) {
    if (!selected) return;
    const branch = branches.find((item) => item.id === branchId);
    if (!branch || !canReparent(branch, newParentId, branches)) return;
    cache.current.forget(branch.fromProjectId, branch.toProjectId);
    setFacts((current) => { const next = new Map(current); next.delete(branchId); return next; });
    await mutate(updateBranch(storageMode, trees, selected.id, branchId, { fromProjectId: newParentId }));
  }

  async function saveNote(branchId: string, value: string) {
    if (!selected) return;
    await mutate(updateBranch(storageMode, trees, selected.id, branchId, { note: value }));
  }

  if (loading) {
    return <main className="project-trees-workspace">
      <aside className="project-tree-library">
        <LibraryHeader onCreate={openCreate} disabled/>
        <div className="project-tree-list">{[0, 1, 2].map((index) => <div key={index} className="project-tree-skeleton"/>)}</div>
      </aside>
      <section className="project-tree-main">
        <div className="project-tree-welcome">
          <Loader2 className="spin"/>
          <h1>Loading project trees…</h1>
          <p>Reading the saved relationships between your projects.</p>
        </div>
      </section>
    </main>;
  }

  const linkedIds = selected ? treeProjectIds(selected) : [];
  const available = proteins.filter((protein) => !linkedIds.includes(protein.id));

  return <main className={`project-trees-workspace${selectedBranch ? " with-panel" : ""}`}>
    <aside className="project-tree-library">
      <LibraryHeader onCreate={openCreate} disabled={!proteins.length}/>
      <div className="project-tree-list">
        {trees.map((tree) => <button key={tree.id} className={tree.id === selected?.id ? "selected" : ""}
          onClick={() => { setSelectedTreeId(tree.id); setSelectedBranchId(""); }}>
          <Trees/>
          <span>
            <strong>{tree.name}</strong>
            <small>{tree.branches.length} branch{tree.branches.length === 1 ? "" : "es"} · {treeProjectIds(tree).length} project{treeProjectIds(tree).length === 1 ? "" : "s"}</small>
          </span>
          <ArrowRight/>
        </button>)}
        {!trees.length && <div className="project-tree-empty-list">
          <GitBranch/><strong>No project trees yet</strong>
          <small>Create one once you have two or more related projects.</small>
        </div>}
      </div>
      <footer className="project-tree-storage">
        {storageMode === "engine"
          ? <><Save/><span><strong>Saved in the engine</strong><small>Shared with every Protein Lab window.</small></span></>
          : <><StickyNote/><span><strong>Saved on this computer</strong><small>Moves to the engine as soon as it serves project trees.</small></span></>}
      </footer>
    </aside>

    <section className="project-tree-main">
      {selected ? <>
        <header>
          <span>
            <b>PROJECT TREE</b>
            <h2>{selected.name}</h2>
            <p>{linkedIds.length} linked project{linkedIds.length === 1 ? "" : "s"} · {selected.branches.length} branch{selected.branches.length === 1 ? "" : "es"}{layout.layerCount > 1 ? ` · ${layout.layerCount} generations` : ""}</p>
          </span>
          <div>
            <Button variant="outline" onClick={() => { setTreeName(selected.name); setRenameOpen(true); }}><Pencil/> Rename</Button>
            <Button onClick={() => openLink()} disabled={!available.length || busy}><Link2/> Link project</Button>
            <Button variant="ghost" size="icon" onClick={() => void deleteTree()} aria-label="Delete this tree" disabled={busy}><Trash2/></Button>
          </div>
        </header>

        {error && <div className="project-tree-notice error" role="alert">
          <TriangleAlert/>
          <span><strong>That change could not be saved</strong><small>{error}</small></span>
          <Button variant="outline" size="sm" onClick={() => setError("")}>Dismiss</Button>
        </div>}

        {layout.droppedEdgeIds.length > 0 && <div className="project-tree-notice" role="status">
          <TriangleAlert/>
          <span>
            <strong>{layout.droppedEdgeIds.length} link{layout.droppedEdgeIds.length === 1 ? "" : "s"} could not be drawn</strong>
            <small>A link that repeats another or loops back on itself is hidden. Remove it to tidy the tree.</small>
          </span>
          <Button variant="outline" size="sm" disabled={busy} onClick={() => void removeLink(layout.droppedEdgeIds[0])}>Remove one</Button>
        </div>}

        {selected.branches.length ? <TreeCanvas
          layout={layout}
          branches={branches}
          projects={projectMap}
          selectedBranchId={selectedBranchId}
          onSelectBranch={setSelectedBranchId}
          onOpenProject={onOpenProject}
          onReparent={(branchId, parentId) => void reparent(branchId, parentId)}
          onAddChild={(parentId) => openLink(parentId)}
          canDrop={(branchId, parentId) => {
            const branch = branches.find((item) => item.id === branchId);
            return Boolean(branch && canReparent(branch, parentId, branches));
          }}
          parentBranchOf={(projectId) => branches.find((branch) => branch.toProjectId === projectId)?.id ?? ""}
        /> : <div className="project-tree-empty-canvas">
          <Link2/>
          <h3>Connect another project</h3>
          <p>Add a branch and Protein Lab works out what changed — construct, vector, host, tag, purification, or assays.</p>
          <Button onClick={() => openLink()} disabled={!available.length}><Plus/> Add the first branch</Button>
          {!available.length && <small className="project-tree-hint">Every saved project is already in this tree.</small>}
        </div>}
      </> : <div className="project-tree-welcome">
        <Trees/>
        <h1>Show how your projects are related</h1>
        <p>Each node is a separate Protein Lab project with its own Workflow, Roadmap, and Notebook. Every branch shows exactly what changed between the two.</p>
        <Button onClick={openCreate} disabled={!proteins.length}><Plus/> New project tree</Button>
        {!proteins.length && <small className="project-tree-hint">Create a project first — a tree needs at least one.</small>}
      </div>}
    </section>

    {selectedBranch && <BranchPanel
      key={selectedBranch.id}
      branch={selectedBranch}
      diff={diff}
      loading={diffLoading}
      parent={projectMap.get(selectedBranch.fromProjectId)}
      child={projectMap.get(selectedBranch.toProjectId)}
      busy={busy}
      onClose={() => setSelectedBranchId("")}
      onOpenProject={onOpenProject}
      onUnlink={() => void removeLink(selectedBranch.id)}
      onSaveNote={(value) => void saveNote(selectedBranch.id, value)}
    />}

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="dialog-panel">
      <DialogHeader>
        <DialogTitle>Create a project tree</DialogTitle>
        <DialogDescription>Choose the starting project. You can link more saved projects once the tree exists.</DialogDescription>
      </DialogHeader>
      <label className="field">Tree name<input autoFocus value={treeName} onChange={(event) => setTreeName(event.target.value)} placeholder="e.g. Hemoglobin construct series"/></label>
      <label className="field">Starting project<select value={rootProjectId} onChange={(event) => setRootProjectId(event.target.value)}>
        {proteins.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>)}
      </select></label>
      <DialogFooter>
        <Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button>
        <Button onClick={() => void createTree()} disabled={!rootProjectId}><Save/> Create tree</Button>
      </DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={renameOpen} onOpenChange={setRenameOpen}><DialogContent className="dialog-panel">
      <DialogHeader>
        <DialogTitle>Rename this tree</DialogTitle>
        <DialogDescription>Only the tree is renamed; the projects inside it keep their own names.</DialogDescription>
      </DialogHeader>
      <label className="field">Tree name<input autoFocus value={treeName} onChange={(event) => setTreeName(event.target.value)}/></label>
      <DialogFooter>
        <Button variant="outline" onClick={() => setRenameOpen(false)}>Cancel</Button>
        <Button onClick={() => void renameTree()} disabled={!treeName.trim()}><Save/> Save name</Button>
      </DialogFooter>
    </DialogContent></Dialog>

    <Dialog open={linkOpen} onOpenChange={setLinkOpen}><DialogContent className="dialog-panel">
      <DialogHeader>
        <DialogTitle>Link a project</DialogTitle>
        <DialogDescription>Add a saved project as a new branch. Protein Lab compares the two and labels the branch for you.</DialogDescription>
      </DialogHeader>
      <label className="field">Branch from<select value={fromProjectId} onChange={(event) => setFromProjectId(event.target.value)}>
        {linkedIds.map((id) => <option key={id} value={id}>{projectMap.get(id)?.name ?? "Missing project"}</option>)}
      </select></label>
      <label className="field">Project to add<select value={toProjectId} onChange={(event) => setToProjectId(event.target.value)}>
        <option value="">Choose a project</option>
        {available.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>)}
      </select></label>
      <label className="field">Why did it branch? <span className="field-optional">optional</span>
        <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)} placeholder="e.g. Moved to pMAL-c5X to improve solubility."/></label>
      <DialogFooter>
        <Button variant="outline" onClick={() => setLinkOpen(false)}>Cancel</Button>
        <Button onClick={() => void addLink()} disabled={!fromProjectId || !toProjectId}><Link2/> Save branch</Button>
      </DialogFooter>
    </DialogContent></Dialog>
  </main>;
}

function LibraryHeader({ onCreate, disabled }: { onCreate: () => void; disabled?: boolean }) {
  return <header>
    <span><b>PROJECT RELATIONSHIPS</b><h1>Project trees</h1><p>Connect complete projects and see what changed on every branch.</p></span>
    <Button size="icon" onClick={onCreate} disabled={disabled} aria-label="New project tree"><Plus/></Button>
  </header>;
}

// --- canvas -----------------------------------------------------------------

type CanvasProps = {
  layout: TreeLayout;
  branches: ProjectTreeBranch[];
  projects: Map<string, ProteinRecord>;
  selectedBranchId: string;
  onSelectBranch: (branchId: string) => void;
  onOpenProject: (projectId: string) => void;
  onReparent: (branchId: string, newParentId: string) => void;
  onAddChild: (parentId: string) => void;
  canDrop: (branchId: string, parentId: string) => boolean;
  parentBranchOf: (projectId: string) => string;
};

function TreeCanvas({
  layout, branches, projects, selectedBranchId,
  onSelectBranch, onOpenProject, onReparent, onAddChild, canDrop, parentBranchOf,
}: CanvasProps) {
  const stage = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });
  // Fit-to-view is the derived default and panning/zooming is an override
  // stamped with the shape it was made against. Any change to the tree or the
  // stage invalidates the stamp, so a resized desktop window re-fits by
  // itself and no effect has to push a new view in.
  const [override, setOverride] = useState<{ shape: string; scale: number; x: number; y: number } | null>(null);
  const [panning, setPanning] = useState(false);
  const [dragging, setDragging] = useState("");
  const [dropTarget, setDropTarget] = useState("");
  const pan = useRef<{ pointerId: number; x: number; y: number; viewX: number; viewY: number } | null>(null);
  const branchById = useMemo(() => new Map(branches.map((branch) => [branch.id, branch])), [branches]);

  useEffect(() => {
    const element = stage.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) => {
      const next = { width: entry.contentRect.width, height: entry.contentRect.height };
      setSize((current) => (current.width === next.width && current.height === next.height ? current : next));
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, []);

  const shape = `${layout.nodes.length}:${Math.round(layout.width)}:${Math.round(layout.height)}:${Math.round(size.width)}:${Math.round(size.height)}`;
  const fitted = useMemo(() => {
    const next = fitToViewport(layout, size.width ? size : { width: 900, height: 520 }, 44, 1, MIN_SCALE);
    return { scale: next.scale, x: next.offsetX, y: Math.max(28, next.offsetY) };
  }, [layout, size]);
  const view = override?.shape === shape ? override : fitted;

  const move = (next: { scale: number; x: number; y: number }) => setOverride({ shape, ...next });
  const fit = () => setOverride(null);

  function zoomBy(factor: number, originX?: number, originY?: number) {
    const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, view.scale * factor));
    const anchorX = originX ?? size.width / 2;
    const anchorY = originY ?? size.height / 2;
    const ratio = scale / view.scale;
    move({ scale, x: anchorX - (anchorX - view.x) * ratio, y: anchorY - (anchorY - view.y) * ratio });
  }

  function onWheel(event: React.WheelEvent) {
    if (!event.deltaY) return;
    event.preventDefault();
    const box = stage.current?.getBoundingClientRect();
    zoomBy(event.deltaY < 0 ? 1.12 : 1 / 1.12, event.clientX - (box?.left ?? 0), event.clientY - (box?.top ?? 0));
  }

  function startPan(event: React.PointerEvent<HTMLDivElement>) {
    if (event.button !== 0 || (event.target as HTMLElement).closest("button, a, input, textarea, svg.project-tree-minimap")) return;
    pan.current = { pointerId: event.pointerId, x: event.clientX, y: event.clientY, viewX: view.x, viewY: view.y };
    setPanning(true);
    event.currentTarget.setPointerCapture(event.pointerId);
  }

  function movePan(event: React.PointerEvent) {
    const start = pan.current;
    if (!start || start.pointerId !== event.pointerId) return;
    move({ scale: view.scale, x: start.viewX + (event.clientX - start.x), y: start.viewY + (event.clientY - start.y) });
  }

  function endPan(event: React.PointerEvent) {
    if (pan.current?.pointerId !== event.pointerId) return;
    pan.current = null;
    setPanning(false);
  }

  function onKeyDown(event: React.KeyboardEvent) {
    const nudge = event.shiftKey ? 160 : 48;
    const moves: Record<string, [number, number]> = {
      ArrowLeft: [nudge, 0], ArrowRight: [-nudge, 0], ArrowUp: [0, nudge], ArrowDown: [0, -nudge],
    };
    if (moves[event.key]) {
      event.preventDefault();
      const [dx, dy] = moves[event.key];
      move({ scale: view.scale, x: view.x + dx, y: view.y + dy });
    } else if (event.key === "+" || event.key === "=") { event.preventDefault(); zoomBy(1.15); }
    else if (event.key === "-" || event.key === "_") { event.preventDefault(); zoomBy(1 / 1.15); }
    else if (event.key === "0") { event.preventDefault(); fit(); }
  }

  const showMinimap = layout.nodes.length > 6 || layout.width * view.scale > size.width;
  const categoriesInTree = orderCategories(branches.flatMap((branch) => branch.categories));

  return <div className="project-tree-canvas">
    <div
      ref={stage}
      className={`project-tree-stage${panning ? " panning" : ""}`}
      role="application"
      aria-label="Project tree graph. Arrow keys pan, plus and minus zoom, 0 fits the tree to the view."
      tabIndex={0}
      onWheel={onWheel}
      onPointerDown={startPan}
      onPointerMove={movePan}
      onPointerUp={endPan}
      onPointerCancel={endPan}
      onKeyDown={onKeyDown}
    >
      <div className="project-tree-scene"
        style={{ width: layout.width, height: layout.height, transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}>
        <svg className="project-tree-edges" width={layout.width} height={layout.height} aria-hidden="true">
          {layout.edges.map((edge) => {
            const category = primaryCategory(branchById.get(edge.id)?.categories ?? []);
            return <path key={edge.id} d={edge.path}
              className={`tree-edge category-${category}${edge.secondary ? " secondary" : ""}${edge.id === selectedBranchId ? " selected" : ""}`}/>;
          })}
        </svg>

        {layout.nodes.map((node) => <ProjectNode
          key={node.id}
          project={projects.get(node.id)}
          node={node}
          root={node.depth === 0 && !node.parents.length}
          dragging={dragging === node.id}
          dropping={dropTarget === node.id}
          branchId={parentBranchOf(node.id)}
          onOpen={onOpenProject}
          onAddChild={onAddChild}
          onDragStart={setDragging}
          onDragEnd={() => { setDragging(""); setDropTarget(""); }}
          onDragOverNode={(targetId) => {
            // While dragging, only React state knows the source: the browser
            // hides the payload from dragover. This drives the highlight only.
            const branchId = parentBranchOf(dragging);
            setDropTarget(branchId && canDrop(branchId, targetId) ? targetId : "");
          }}
          onDropNode={(targetId, sourceId) => {
            // The drop reads the payload, which is authoritative and does not
            // depend on a state update having landed between the two events.
            const branchId = parentBranchOf(sourceId || dragging);
            if (branchId && canDrop(branchId, targetId)) onReparent(branchId, targetId);
            setDragging("");
            setDropTarget("");
          }}
        />)}

        {layout.edges.map((edge) => {
          const branch = branchById.get(edge.id);
          return branch ? <BranchLabel key={edge.id} edge={edge} branch={branch} rows={layout.labelRows}
            selected={edge.id === selectedBranchId} onSelect={onSelectBranch}/> : null;
        })}
      </div>

      <div className="project-tree-controls">
        <button onClick={() => zoomBy(1.2)} aria-label="Zoom in" title="Zoom in"><ZoomIn/></button>
        <button onClick={() => zoomBy(1 / 1.2)} aria-label="Zoom out" title="Zoom out"><ZoomOut/></button>
        <button onClick={fit} aria-label="Fit the tree to the view" title="Fit to view (0)"><Maximize2/></button>
        <span className="project-tree-zoom">{Math.round(view.scale * 100)}%</span>
      </div>

      {showMinimap && <MiniMap layout={layout} view={view} size={size}
        onJump={(x, y) => move({ scale: view.scale, x, y })}/>}

      {categoriesInTree.length > 0 && <ul className="project-tree-legend">
        {categoriesInTree.map((category) => {
          const style = CATEGORY_STYLES[category];
          const Icon = CATEGORY_ICONS[category];
          return <li key={category} className={`category-${category}`}>
            <i className={`glyph glyph-${style.glyph}`}/><Icon/>{style.label}
          </li>;
        })}
      </ul>}
    </div>
  </div>;
}

function ProjectNode({
  project, node, root, dragging, dropping, branchId,
  onOpen, onAddChild, onDragStart, onDragEnd, onDragOverNode, onDropNode,
}: {
  project?: ProteinRecord;
  node: LayoutNode;
  root: boolean;
  dragging: boolean;
  dropping: boolean;
  branchId: string;
  onOpen: (projectId: string) => void;
  onAddChild: (parentId: string) => void;
  onDragStart: (projectId: string) => void;
  onDragEnd: () => void;
  onDragOverNode: (projectId: string) => void;
  onDropNode: (projectId: string, sourceId: string) => void;
}) {
  const box = { left: node.x, top: node.y, width: DEFAULT_LAYOUT.nodeWidth, height: DEFAULT_LAYOUT.nodeHeight };
  if (!project) {
    return <article className="project-tree-node missing" style={box}>
      <span className="project-tree-node-open">
        <TriangleAlert/>
        <span><strong>Project deleted</strong><small>Open this branch to unlink it.</small></span>
      </span>
    </article>;
  }
  return <article
    className={`project-tree-node${root ? " root" : ""}${dragging ? " dragging" : ""}${dropping ? " dropping" : ""}`}
    style={box}
    draggable={Boolean(branchId)}
    onDragStart={(event) => {
      event.dataTransfer.effectAllowed = "move";
      event.dataTransfer.setData("text/plain", node.id);
      onDragStart(node.id);
    }}
    onDragEnd={onDragEnd}
    onDragOver={(event) => { event.preventDefault(); onDragOverNode(node.id); }}
    onDrop={(event) => { event.preventDefault(); onDropNode(node.id, event.dataTransfer.getData("text/plain")); }}
  >
    <button className="project-tree-node-open" onClick={() => onOpen(project.id)} title={`Open ${project.name}`}>
      <Dna/>
      <span>
        <strong>{project.name}</strong>
        <small>{project.sequence.length} aa · {project.organism || "Organism not entered"}</small>
      </span>
    </button>
    <div className="project-tree-node-actions">
      {root ? <em>ROOT</em> : <em className="generation">GEN {node.depth + 1}</em>}
      <button onClick={() => onAddChild(project.id)} aria-label={`Branch from ${project.name}`} title="Branch from here"><Plus/></button>
    </div>
  </article>;
}

function BranchLabel({ edge, branch, rows, selected, onSelect }: {
  edge: LayoutEdge;
  branch: ProjectTreeBranch;
  rows: number;
  selected: boolean;
  onSelect: (branchId: string) => void;
}) {
  const categories = orderCategories(branch.categories);
  const category = primaryCategory(categories);
  return <button
    className={`project-tree-branch category-${category}${selected ? " selected" : ""}`}
    // The box is sized from the same constants the layout reserves space
    // with, so the CSS and the band height can never drift apart.
    style={{
      left: edge.labelX, top: edge.labelY + labelRowOffset(edge.labelRow, rows),
      width: LABEL_WIDTH, minHeight: LABEL_HEIGHT,
    }}
    onClick={() => onSelect(branch.id)}
    aria-pressed={selected}
  >
    <span className="branch-chips">
      {categories.length ? categories.slice(0, 3).map((item) => {
        const style = CATEGORY_STYLES[item];
        const Icon = CATEGORY_ICONS[item];
        return <i key={item} className={`branch-chip category-${item}`} title={style.label}>
          <Icon/><u>{style.code}</u>
        </i>;
      }) : <i className="branch-chip pending"><Loader2 className="spin"/></i>}
      {categories.length > 3 && <i className="branch-chip more">+{categories.length - 3}</i>}
    </span>
    <b>{branch.summary || "Comparing projects…"}</b>
  </button>;
}

function MiniMap({ layout, view, size, onJump }: {
  layout: TreeLayout;
  view: { scale: number; x: number; y: number };
  size: { width: number; height: number };
  onJump: (x: number, y: number) => void;
}) {
  const scale = Math.min(MINIMAP_WIDTH / (layout.width || 1), MINIMAP_HEIGHT / (layout.height || 1));
  function jump(event: React.MouseEvent<SVGSVGElement>) {
    const box = event.currentTarget.getBoundingClientRect();
    const sceneX = (event.clientX - box.left) / scale;
    const sceneY = (event.clientY - box.top) / scale;
    onJump(size.width / 2 - sceneX * view.scale, size.height / 2 - sceneY * view.scale);
  }
  return <svg className="project-tree-minimap" width={MINIMAP_WIDTH} height={MINIMAP_HEIGHT}
    onClick={jump} role="img" aria-label="Tree overview. Click to move the view.">
    <g transform={`scale(${scale})`}>
      {layout.edges.map((edge) => <path key={edge.id} d={edge.path} className="minimap-edge"/>)}
      {layout.nodes.map((node) => <rect key={node.id} x={node.x} y={node.y} rx={16}
        width={DEFAULT_LAYOUT.nodeWidth} height={DEFAULT_LAYOUT.nodeHeight} className="minimap-node"/>)}
    </g>
    <rect className="minimap-viewport"
      x={Math.max(0, (-view.x / view.scale) * scale)}
      y={Math.max(0, (-view.y / view.scale) * scale)}
      width={Math.min(MINIMAP_WIDTH, (size.width / view.scale) * scale)}
      height={Math.min(MINIMAP_HEIGHT, (size.height / view.scale) * scale)}/>
  </svg>;
}

// --- branch diff panel ------------------------------------------------------

function BranchPanel({
  branch, diff, loading, parent, child, busy, onClose, onOpenProject, onUnlink, onSaveNote,
}: {
  branch: ProjectTreeBranch;
  diff: ProjectDiff | null;
  loading: boolean;
  parent?: ProteinRecord;
  child?: ProteinRecord;
  busy: boolean;
  onClose: () => void;
  onOpenProject: (projectId: string) => void;
  onUnlink: () => void;
  onSaveNote: (note: string) => void;
}) {
  // The panel is remounted per branch (see the `key` at the call site), so
  // the draft starts from the saved note and never needs resetting.
  const [note, setNote] = useState(branch.note);
  const grouped = useMemo(() => {
    const map = new Map<ChangeCategory, ProjectDiff["changes"]>();
    for (const change of diff?.changes ?? []) map.set(change.category, [...(map.get(change.category) ?? []), change]);
    return orderCategories([...map.keys()])
      .filter((category) => category !== "sequence" && category !== "protparam")
      .map((category) => [category, map.get(category) as ProjectDiff["changes"]] as const);
  }, [diff]);

  return <aside className="project-tree-diff-panel" aria-label="Branch differences">
    <header>
      <span>
        <b>BRANCH DIFFERENCE</b>
        <h3>{parent?.name ?? "Deleted project"} <ArrowRight/> {child?.name ?? "Deleted project"}</h3>
        <p>{branch.summary || "Comparing the two projects…"}</p>
      </span>
      <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close the branch panel"><X/></Button>
    </header>

    <div className="project-tree-diff-body">
      {(!parent || !child) && <div className="project-tree-notice error" role="alert">
        <TriangleAlert/>
        <span><strong>One side of this branch is gone</strong>
          <small>The project was deleted, so there is nothing left to compare. Unlink the branch to tidy the tree.</small></span>
      </div>}

      {loading && <div className="project-tree-diff-loading"><Loader2 className="spin"/> Comparing projects…</div>}

      {!loading && diff && <>
        {!diff.changes.length && <div className="project-tree-diff-empty">
          <Scale/><strong>These two projects match</strong>
          <small>Nothing in the sequence, vector, host, tag, purification, or assays differs.</small>
        </div>}

        {diff.sequence && <section className="project-tree-diff-section category-sequence">
          <h4><Dna/> Sequence<i className="branch-chip category-sequence"><u>SEQ</u></i></h4>
          <dl className="project-tree-diff-figures">
            <div><dt>Identity</dt><dd>{diff.sequence.alignmentUnavailable ? "—" : `${diff.sequence.identityPercent}%`}</dd></div>
            <div><dt>Length</dt><dd>{diff.sequence.lengthBefore} → {diff.sequence.lengthAfter} aa</dd></div>
            <div><dt>Changes</dt><dd>{diff.sequence.alignmentUnavailable ? "—" : diff.sequence.edits.length}</dd></div>
          </dl>
          {/* Residue positions come from an alignment. Without one there is
              nothing honest to draw, so say that rather than guess. */}
          {diff.sequence.alignmentUnavailable
            ? <p className="project-tree-diff-note">
              <TriangleAlert/> These sequences are too long to align in the app.
              The lengths above are exact; connect the engine for the residue-by-residue comparison.
            </p>
            : <ResidueStrip sequence={diff.sequence}/>}
        </section>}

        {grouped.map(([category, changes]) => {
          const style = CATEGORY_STYLES[category];
          const Icon = CATEGORY_ICONS[category];
          return <section key={category} className={`project-tree-diff-section category-${category}`}>
            <h4><Icon/> {style.label}<i className={`branch-chip category-${category}`}><u>{style.code}</u></i></h4>
            <table className="project-tree-diff-table"><tbody>
              {changes.map((change) => <tr key={change.id}>
                <th scope="row">{change.field}</th>
                <td className="was">{change.before}</td>
                <td className="arrow"><ArrowRight/></td>
                <td className="now">{change.after}</td>
              </tr>)}
            </tbody></table>
          </section>;
        })}

        {diff.protparam.length > 0 && <section className="project-tree-diff-section category-protparam">
          <h4><Scale/> ProtParam<i className="branch-chip category-protparam"><u>PRM</u></i></h4>
          <table className="project-tree-diff-table"><tbody>
            {diff.protparam.map((delta) => <tr key={delta.label}>
              <th scope="row">{delta.label}</th>
              <td className="was">{delta.before}</td>
              <td className="arrow">{delta.direction === "up"
                ? <ArrowUpRight className="up"/>
                : delta.direction === "down" ? <ArrowDownRight className="down"/> : <Minus/>}</td>
              <td className="now">{delta.after}</td>
            </tr>)}
          </tbody></table>
        </section>}
      </>}

      {!loading && !diff && parent && child && <div className="project-tree-diff-empty">
        <TriangleAlert/><strong>The comparison could not be loaded</strong>
        <small>Protein Lab could not read one of the two projects. Reopen the branch to try again.</small>
      </div>}

      <section className="project-tree-diff-section">
        <h4><StickyNote/> Your note</h4>
        <textarea rows={3} value={note} onChange={(event) => setNote(event.target.value)}
          placeholder="Why did the project branch here?" aria-label="Branch note"/>
        <Button variant="outline" size="sm" disabled={busy || note === branch.note}
          onClick={() => onSaveNote(note.trim())}><Save/> Save note</Button>
      </section>
    </div>

    <footer>
      <Button variant="outline" size="sm" disabled={!parent} onClick={() => parent && onOpenProject(parent.id)}>Open parent</Button>
      <Button variant="outline" size="sm" disabled={!child} onClick={() => child && onOpenProject(child.id)}>Open branch</Button>
      <Button variant="ghost" size="sm" className="unlink" disabled={busy} onClick={onUnlink}><Unlink/> Unlink</Button>
    </footer>
  </aside>;
}

/**
 * Two aligned rows of residues with the changed columns marked. Long proteins
 * are windowed around each change, because a 400-residue strip is unreadable
 * and the interesting part is always the neighbourhood of an edit.
 */
function ResidueStrip({ sequence }: { sequence: SequenceDiff }) {
  const [whole, setWhole] = useState(false);
  const columns = sequence.alignedBefore.length;

  /** 1-based parent position of each alignment column. */
  const positions = useMemo(() => {
    const result = new Array<number>(columns);
    let position = 0;
    for (let index = 0; index < columns; index += 1) {
      if (sequence.alignedBefore[index] !== "-") position += 1;
      result[index] = position || 1;
    }
    return result;
  }, [sequence, columns]);

  const windows = useMemo(() => {
    if (whole || !sequence.edits.length) return [{ start: 0, end: columns }];
    const merged: { start: number; end: number }[] = [];
    for (let index = 0; index < columns; index += 1) {
      if (sequence.alignedBefore[index] === sequence.alignedAfter[index]) continue;
      const start = Math.max(0, index - STRIP_FLANK);
      const end = Math.min(columns, index + STRIP_FLANK + 1);
      const last = merged.at(-1);
      if (last && start <= last.end) last.end = Math.max(last.end, end);
      else merged.push({ start, end });
    }
    return merged.length ? merged : [{ start: 0, end: columns }];
  }, [sequence, whole, columns]);

  return <div className="residue-strip">
    <div className="residue-strip-scroll">
      {windows.map((window, order) => <div key={window.start} className="residue-window">
        {order > 0 && <span className="residue-gap" aria-hidden="true">⋯</span>}
        <div className="residue-grid" role="group"
          aria-label={`Residues ${positions[window.start]} to ${positions[window.end - 1]}`}>
          <div className="residue-row ruler">{range(window).map((index) => <span key={index}>
            {positions[index] % 10 === 0 && sequence.alignedBefore[index] !== "-" ? positions[index] : ""}
          </span>)}</div>
          <div className="residue-row before">{range(window).map((index) => <span key={index}
            className={columnClass(sequence, index)}>{sequence.alignedBefore[index]}</span>)}</div>
          <div className="residue-row after">{range(window).map((index) => <span key={index}
            className={columnClass(sequence, index)}>{sequence.alignedAfter[index]}</span>)}</div>
        </div>
      </div>)}
    </div>
    <div className="residue-strip-footer">
      <ul className="residue-edit-list">
        {sequence.edits.slice(0, 12).map((edit) => <li key={`${edit.kind}-${edit.position}`} className={`edit-${edit.kind}`}>
          <i/>{edit.label}<small>{edit.kind}</small>
        </li>)}
        {sequence.edits.length > 12 && <li className="edit-more">+{sequence.edits.length - 12} more</li>}
      </ul>
      {sequence.edits.length > 0 && <Button variant="outline" size="sm" onClick={() => setWhole(!whole)}>
        <Crosshair/> {whole ? "Changes only" : "Whole sequence"}
      </Button>}
    </div>
  </div>;
}

function range({ start, end }: { start: number; end: number }) {
  return Array.from({ length: end - start }, (_, offset) => start + offset);
}

function columnClass(sequence: SequenceDiff, index: number) {
  const before = sequence.alignedBefore[index];
  const after = sequence.alignedAfter[index];
  if (before === after) return "same";
  if (before === "-") return "added";
  if (after === "-") return "removed";
  return "changed";
}
