"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Check, CircleAlert, Disc3, Dna, ExternalLink, FileDown, FilePlus2, FlaskConical, FolderCog, FolderOpen, FolderSearch, GitBranch, HelpCircle, Keyboard, LayoutGrid, LoaderCircle, MoreHorizontal, Plus, RefreshCw, Save, Settings, Share2, Sparkles, TestTubes, Workflow } from "lucide-react";
import { Menubar as MenubarPrimitive } from "radix-ui";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppDashboard } from "@/components/protein-labs/app-dashboard";
import { JobWorkspace } from "@/components/protein-labs/job-workspace";
import { ReportsWorkspace } from "@/components/protein-labs/reports-workspace";
import { ProjectDashboard, ProjectWorkflow } from "@/components/protein-labs/project-workflow";
import { ProjectTrees } from "@/components/protein-labs/project-trees";
import { StructureViewer } from "@/components/protein-labs/structure-viewer";
import { PurificationRoadmapWorkspace } from "@/components/protein-labs/purification-roadmap";
import { LibraryHub } from "@/components/protein-labs/library-hub";
import { UserManual } from "@/components/protein-labs/user-manual";
import { JsonObject, ProteinBundle, ProteinRecord, proteinLabsApi } from "@/lib/protein-labs-api";
import { definitionFor } from "@/lib/workflow";
import { writeProjectTrees } from "@/lib/project-trees";
import type { ProjectTree } from "@/lib/project-tree-types";
import { loadProjectTrees, type StorageMode } from "@/lib/project-tree-store";
import { useProteinLabsWebMcp } from "@/hooks/use-protein-labs-webmcp";
import { runViewTransition } from "@/lib/view-transition";
import { desktopBridge, folderOf, type ProjectDirectoryState } from "@/lib/desktop-bridge";
import { libraryStorage, type LibraryTab } from "@/lib/library-hub";

type View = "home" | "projects" | "dashboard" | "workflow" | "project-trees" | "library" | "manual" | "roadmap" | "reports" | "job";
// Baked in by desktop/vite.config.ts from package.json.
declare const __PROTEIN_LABS_VERSION__: string;
const appVersion = __PROTEIN_LABS_VERSION__;

// Depth of each view; moving to a shallower view animates as "back".
const viewDepth: Record<View, number> = { home: 0, projects: 1, "project-trees": 1, library: 1, manual: 1, dashboard: 2, workflow: 3, roadmap: 3, reports: 3, job: 4 };
type VisualTheme = "paper" | "mono-dark" | "mono-light";

// Each appearance carries its own light or dark mode, so the appearance is the
// only thing to choose.
const visualThemes: { id: VisualTheme; label: string; description: string; colors: string[]; dark: boolean }[] = [
  { id: "paper", label: "Graphic novel", description: "Light mode. Warm paper, bold ink, and coral highlights", colors: ["#f3eee2", "#181611", "#ef765f"], dark: false },
  { id: "mono-dark", label: "Monochrome dark", description: "Dark mode. Near-black surfaces with white type and rules", colors: ["#09090a", "#ffffff", "#8b8b8f"], dark: true },
  { id: "mono-light", label: "Monochrome light", description: "Light mode. White page with black type and rules", colors: ["#ffffff", "#0b0b0c", "#8b8b8f"], dark: false },
];
// Earlier builds shipped Midnight ink, Aurora lab and Blueprint; all three were
// dark, so a saved preference lands on the monochrome dark appearance.
function savedVisualTheme(value: string | null): VisualTheme | null {
  if (value === "paper" || value === "mono-dark" || value === "mono-light") return value;
  if (value === "midnight" || value === "aurora" || value === "blueprint") return "mono-dark";
  return null;
}

const welcomeGeometry: JsonObject = {
  points: Array.from({ length: 190 }, (_, index) => ({
    x: 32 * Math.sin(index * .17) + 11 * Math.sin(index * .63),
    y: 27 * Math.sin(index * .23 + .8) + 9 * Math.cos(index * .51),
    z: 30 * Math.cos(index * .19) + 7 * Math.sin(index * .47),
    chain: "A",
    plddt: 92,
  })),
};

export default function Home() {
  const [started, setStarted] = useState(false);
  const [splashMounted, setSplashMounted] = useState(false);
  const [splashReady, setSplashReady] = useState(false);
  const [splashLeaving, setSplashLeaving] = useState(false);
  const [view, setViewState] = useState<View>("home");
  const [proteins, setProteins] = useState<ProteinRecord[]>([]);
  const [projectTrees, setProjectTrees] = useState<ProjectTree[]>([]);
  const [treeStorage, setTreeStorage] = useState<StorageMode>("local");
  const [treesLoading, setTreesLoading] = useState(true);
  const [bundles, setBundles] = useState<Record<string, ProteinBundle>>({});
  const [selectedId, setSelectedId] = useState("");
  const [activeJob, setActiveJob] = useState("sequence");
  const [jobReturn, setJobReturn] = useState<"planning" | "roadmap">("planning");
  const [visualTheme, setVisualTheme] = useState<VisualTheme>("paper");
  const [createOpen, setCreateOpen] = useState(false);
  const [newName, setNewName] = useState("");
  const [newSequence, setNewSequence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [engineOnline, setEngineOnline] = useState<boolean | null>(null);
  // Menus portal into the shell (not <body>) so they keep the appearance's
  // colour tokens, and escape the top bar's paint containment.
  const [shellNode, setShellNode] = useState<HTMLDivElement | null>(null);
  const [aboutOpen, setAboutOpen] = useState(false);
  const [manualVisit, setManualVisit] = useState<{ section?: string; visit: number }>({ visit: 0 });
  const [enginePath, setEnginePath] = useState("");
  const [projectDirectory, setProjectDirectory] = useState<ProjectDirectoryState | null>(null);
  const [libraryTab, setLibraryTab] = useState<LibraryTab>("vectors");

  const dark = visualThemes.find((theme) => theme.id === visualTheme)?.dark ?? false;
  const bundle = bundles[selectedId] ?? null;

  const refreshProjects = useCallback(async () => {
    const result = await proteinLabsApi.listProteins();
    setProteins(result.proteins);
    return result.proteins;
  }, []);

  const loadProject = useCallback(async (proteinId: string, source?: ProteinRecord[], select = true) => {
    const projects = source ?? (await proteinLabsApi.listProteins()).proteins;
    setProteins(projects);
    const selected = projects.find((protein) => protein.id === proteinId);
    if (!selected) throw new Error("The selected protein project no longer exists.");
    const loaded = await proteinLabsApi.getProtein(proteinId);
    setBundles((current) => ({ ...current, [proteinId]: loaded })); if (select) setSelectedId(proteinId);
    return loaded;
  }, []);

  const refreshBundle = useCallback(async (preferredId?: string) => { const id = preferredId || selectedId; if (id) await loadProject(id); }, [loadProject, selectedId]);

  // Project trees come from the engine when it serves them and from this
  // computer otherwise, so the screen knows which store it is editing.
  useEffect(() => { proteinLabsApi.health().then(async (health) => { setEngineOnline(true); setEnginePath(health.database); const projects = await refreshProjects(); const trees = await loadProjectTrees(projects); setTreeStorage(trees.mode); setProjectTrees(trees.trees); }).catch((reason) => { setEngineOnline(false); setError(reason instanceof Error ? reason.message : String(reason)); }).finally(() => setTreesLoading(false)); }, [refreshProjects]);
  useEffect(() => {
    queueMicrotask(() => setSplashMounted(true));
    const timer = window.setTimeout(() => setSplashReady(true), 1150);
    return () => window.clearTimeout(timer);
  }, []);
  // Ctrl+Shift+L opens the library on its Vectors tab, Ctrl+Shift+P on Proteins,
  // and F1 the manual from anywhere.
  useEffect(() => {
    if (!started) return;
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "l") { event.preventDefault(); openLibrary("vectors"); } if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "p") { event.preventDefault(); openLibrary("proteins"); } if (event.key === "F1") { event.preventDefault(); openManual(); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { desktopBridge()?.getProjectDirectory().then(setProjectDirectory).catch(() => undefined); }, []);
  useEffect(() => { const saved = savedVisualTheme(localStorage.getItem("protein-labs-visual-theme")); if (saved) queueMicrotask(() => setVisualTheme(saved)); }, []);

  function setView(next: View, update?: () => void) { runViewTransition(() => { update?.(); setViewState(next); }, viewDepth[next] < viewDepth[view] ? "back" : "forward"); }
  async function openProject(id: string, destination: View = "dashboard") { setBusy(true); setError(""); try { await loadProject(id, undefined, false); setView(destination, () => { setSelectedId(id); setActiveJob("sequence"); }); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } }
  async function createProject() { const sequence = newSequence.replace(/\s+/g, "").toUpperCase(); if (!sequence) { setError("Paste an amino-acid sequence before creating the project."); return; } setBusy(true); setError(""); try { const created = await proteinLabsApi.createProtein({ name: newName.trim() || `Protein project ${proteins.length + 1}`, sequence }); setNewName(""); setNewSequence(""); setCreateOpen(false); await loadProject(created.protein.id, undefined, false); setView("dashboard", () => { setSelectedId(created.protein.id); setActiveJob("sequence"); }); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } }
  // The store already persisted the change; this keeps the dashboard count in
  // step, and mirrors engine-held trees locally as an offline read cache.
  function updateProjectTrees(next: ProjectTree[]) { setProjectTrees(next); if (treeStorage === "engine") writeProjectTrees(next); }
  async function openProjectJob(id: string, job: string) { setBusy(true); setError(""); try { await loadProject(id, undefined, false); setView("job", () => { setSelectedId(id); setActiveJob(definitionFor(job).id); setJobReturn("planning"); }); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } }
  // Switching tabs inside the library keeps the page; arriving from elsewhere animates in.
  function openLibrary(tab: LibraryTab) { if (view === "library") setLibraryTab(tab); else setView("library", () => setLibraryTab(tab)); }
  function openJob(value: string, returnTo: "planning" | "roadmap" = "planning") { setView("job", () => { setActiveJob(definitionFor(value).id); setJobReturn(returnTo); }); }
  function chooseVisualTheme(theme: VisualTheme) { setVisualTheme(theme); localStorage.setItem("protein-labs-visual-theme", theme); }
  async function shareProject() { if (!bundle) return; const text = `${bundle.protein.name}\n${bundle.protein.sequence.length} aa\n${bundle.projectJobs.length} saved workflow jobs`; try { await navigator.clipboard.writeText(text); setError("Project summary copied to the clipboard."); } catch { setError("Clipboard access was not available."); } }
  // Each visit remounts the manual, so a Help item always lands on its section
  // even when the manual is already open with a search typed in.
  function openManual(section?: string) { setView("manual", () => setManualVisit((current) => ({ section, visit: current.visit + 1 }))); }
  // Switching folders restarts the engine on another database, so every
  // project held in memory belongs to the old folder and is dropped.
  async function chooseProjectDirectory() {
    const bridge = desktopBridge();
    if (!bridge) return;
    setBusy(true); setError("");
    try {
      const result = await bridge.chooseProjectDirectory();
      if (result.status === "error") { setError(result.message); return; }
      if (result.status === "cancelled") return;
      setProjectDirectory(result.state);
      if (result.status === "unchanged") return;
      setEnginePath(result.state.database);
      setBundles({});
      setView("home", () => setSelectedId(""));
      const projects = await refreshProjects();
      const trees = await loadProjectTrees(projects);
      setTreeStorage(trees.mode); setProjectTrees(trees.trees);
      setError(`Projects now live in ${result.state.directory}${result.copied ? " — your existing projects were copied there" : ""}.`);
    } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); }
  }
  async function revealProjectDirectory() { const message = await desktopBridge()?.openProjectDirectory(); if (message) setError(message); }
  function enterWorkspace() {
    if (splashLeaving) return;
    setSplashLeaving(true);
    window.setTimeout(() => {
      setViewState("home");
      setStarted(true);
    }, 520);
  }

  useProteinLabsWebMcp(useMemo(() => ({ openProject: (id: string) => { void openProject(id, "dashboard"); }, openJob: (id: string) => openJob(id), openNotebook: () => setView("reports"), openLibrary: (tab: LibraryTab) => openLibrary(tab) }), [])); // eslint-disable-line react-hooks/exhaustive-deps

  if (!started) {
    return <div className={`app-shell visual-${visualTheme} ${dark ? "dark" : ""}`} data-visual-theme={visualTheme}>
      <StartupScreen mounted={splashMounted} ready={splashReady} leaving={splashLeaving} engineOnline={engineOnline} onStart={enterWorkspace}/>
    </div>;
  }

  return <div className={`app-shell visual-${visualTheme} ${dark ? "dark" : ""}`} data-visual-theme={visualTheme} ref={setShellNode}>
    <header className="topbar desktop-topbar">
      <button className={`brand dashboard-home-button ${view !== "home" ? "return-mode" : ""}`} onClick={() => setView("home")} aria-label={view === "home" ? "Protein Lab dashboard" : "Back to dashboard"} title={view === "home" ? "Protein Lab dashboard" : "Back to dashboard"}><span className="brand-mark">{view === "home" ? <i className="protein-lab-logo" style={{ backgroundImage: "url('./protein-lab-logo.png')" }} aria-hidden="true"/> : <ArrowLeft/>}</span><span><strong>{view === "home" ? "Protein Lab" : "Back to dashboard"}</strong>{view !== "home" && <small>Exit this workspace</small>}</span></button>
      <MenubarPrimitive.Root className="desktop-menu-bar" aria-label="Application menu" loop>
        <DesktopMenu label="File" container={shellNode}>
          <MenuItem icon={<FilePlus2/>} onSelect={() => setCreateOpen(true)}>New project</MenuItem>
          <MenuItem icon={<FolderOpen/>} onSelect={() => setView("projects")}>Open…</MenuItem>
          <MenuItem icon={<Save/>} disabled={!bundle} onSelect={() => void refreshBundle()}>Save / refresh</MenuItem>
          <MenuItem icon={<FileDown/>} disabled={!bundle} onSelect={() => setView("reports")}>Save As / Export</MenuItem>
          <MenuItem icon={<Share2/>} disabled={!bundle} onSelect={() => void shareProject()}>Share</MenuItem>
          <MenubarPrimitive.Separator className="desktop-menu-separator"/>
          <MenuItem icon={<FolderCog/>} disabled={!projectDirectory?.canChange} onSelect={() => void chooseProjectDirectory()}>Set project directory…</MenuItem>
          <MenuItem icon={<FolderSearch/>} disabled={!projectDirectory} onSelect={() => void revealProjectDirectory()}>Show project directory</MenuItem>
          <ProjectDirectoryNote state={projectDirectory} enginePath={enginePath}/>
        </DesktopMenu>
        <DesktopMenu label="Edit" container={shellNode}>
          <MenuItem icon={<RefreshCw/>} onSelect={() => void refreshProjects()}>Refresh workspace</MenuItem>
          <MenuItem icon={<BookOpen/>} disabled={!bundle} onSelect={() => setView("reports")}>Edit report</MenuItem>
        </DesktopMenu>
        <DesktopMenu label="Settings" container={shellNode}>
          <MenubarPrimitive.Label className="menu-heading"><Settings/> Appearance</MenubarPrimitive.Label>
          <MenubarPrimitive.RadioGroup className="theme-preset-list" value={visualTheme} onValueChange={(value) => chooseVisualTheme(value as VisualTheme)}>
            {/* Picking an appearance keeps the menu open so they can be compared. */}
            {visualThemes.map((theme) => <MenubarPrimitive.RadioItem key={theme.id} value={theme.id} className="theme-preset-item" onSelect={(event) => event.preventDefault()}><span className="theme-swatches">{theme.colors.map((color) => <i key={color} style={{ background: color }}/>)}</span><span><strong>{theme.label}</strong><small>{theme.description}</small></span><MenubarPrimitive.ItemIndicator><Check/></MenubarPrimitive.ItemIndicator></MenubarPrimitive.RadioItem>)}
          </MenubarPrimitive.RadioGroup>
          <small className="desktop-menu-note">Each appearance sets its own light or dark mode.</small>
        </DesktopMenu>
        <DesktopMenu label="Tools" container={shellNode}>
          <MenuItem icon={<LayoutGrid/>} onSelect={() => setView("projects")}>Project gallery</MenuItem>
          <MenuItem icon={<GitBranch/>} onSelect={() => setView("project-trees")}>Project trees</MenuItem>
          <MenuItem icon={<Disc3/>} shortcut="Ctrl+Shift+L" onSelect={() => openLibrary("vectors")}>Vector library</MenuItem>
          <MenuItem icon={<TestTubes/>} shortcut="Ctrl+Shift+P" onSelect={() => openLibrary("proteins")}>Protein library</MenuItem>
          <MenuItem icon={<Workflow/>} disabled={!bundle} onSelect={() => setView("workflow")}>Project workflow</MenuItem>
          <MenuItem icon={<FlaskConical/>} disabled={!bundle} onSelect={() => setView("roadmap")}>Purification roadmap</MenuItem>
          <MenuItem icon={<BookOpen/>} disabled={!bundle} onSelect={() => setView("reports")}>Purification report</MenuItem>
        </DesktopMenu>
        <DesktopMenu label="Help" container={shellNode}>
          <MenuItem icon={<BookOpen/>} shortcut="F1" onSelect={() => openManual()}>User manual</MenuItem>
          <MenuItem icon={<Keyboard/>} onSelect={() => openManual("keyboard-and-mouse")}>Keyboard & mouse controls</MenuItem>
          <MenubarPrimitive.Separator className="desktop-menu-separator"/>
          <MenuItem icon={<HelpCircle/>} onSelect={() => setAboutOpen(true)}>About Protein Lab</MenuItem>
        </DesktopMenu>
      </MenubarPrimitive.Root>
      <div className="topbar-spacer"/>
      <div className="top-actions"><Button variant={view === "library" && libraryTab === "vectors" ? "secondary" : "ghost"} size="sm" className="topbar-vector-library" aria-pressed={view === "library" && libraryTab === "vectors"} title="Vector library (Ctrl+Shift+L)" onClick={() => openLibrary("vectors")}><Disc3/> Vector library</Button><Button variant={view === "library" && libraryTab === "proteins" ? "secondary" : "ghost"} size="sm" className="topbar-protein-library" aria-pressed={view === "library" && libraryTab === "proteins"} title="Protein library (Ctrl+Shift+P)" onClick={() => openLibrary("proteins")}><TestTubes/> Protein library</Button><TopGoogleAccount/></div>
    </header>

    {error && <div className="global-error"><CircleAlert/><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
    {busy && <div className="global-working"><LoaderCircle className="spin"/> Working with the local scientific engine…</div>}

    <div className={`workspace-view-transition ${view === "home" ? "is-dashboard" : ""}`} key={`${view}:${selectedId}:${view === "job" ? activeJob : ""}`}>
      {view === "home" ? <AppDashboard proteins={proteins} trees={projectTrees} onOpenProject={(id) => void openProject(id)} onOpenReports={(id) => void openProject(id, "reports")} onProjects={() => setView("projects")} onTrees={() => setView("project-trees")} storage={libraryStorage(projectDirectory, enginePath)} onLibrary={openLibrary} onRevealStorage={() => void revealProjectDirectory()} onChangeStorage={() => void chooseProjectDirectory()} onCreate={() => setCreateOpen(true)}/>
        : view === "projects" ? <ProjectGallery proteins={proteins} onOpen={(id) => void openProject(id)} onCreate={() => { setError(""); setCreateOpen(true); }}/>
        : view === "manual" ? <UserManual key={manualVisit.visit} initialSection={manualVisit.section}/>
        : view === "library" ? <LibraryHub tab={libraryTab} onTabChange={setLibraryTab} proteins={proteins} storage={libraryStorage(projectDirectory, enginePath)} onOpenVectorProject={(id) => void openProjectJob(id, "expression-vector")} onRevealStorage={() => void revealProjectDirectory()} onChangeStorage={() => void chooseProjectDirectory()}/>
        : view === "project-trees" ? <ProjectTrees proteins={proteins} trees={projectTrees} storageMode={treeStorage} loading={treesLoading} onChange={updateProjectTrees} onOpenProject={(id) => void openProject(id)}/>
        : bundle ? <>{view === "dashboard" && <ProjectDashboard bundle={bundle} onResume={() => setView("workflow")} onRoadmap={() => setView("roadmap")} onReports={() => setView("reports")}/>} {view === "workflow" && <ProjectWorkflow bundle={bundle} onOpenJob={(id) => openJob(id, "planning")} onRoadmap={() => setView("roadmap")} onRefresh={() => refreshBundle(selectedId)}/>} {view === "roadmap" && <PurificationRoadmapWorkspace bundle={bundle} onOpenJob={(id) => openJob(id, "roadmap")} onBackToWorkflow={() => setView("workflow")} onChanged={() => refreshBundle(selectedId)}/>} {view === "job" && <JobWorkspace key={`${selectedId}:${activeJob}:${jobReturn}`} jobId={activeJob} bundle={bundle} returnTo={jobReturn} onBack={() => setView(jobReturn === "roadmap" ? "roadmap" : "workflow")} onOpenJob={(id) => openJob(id, "planning")} onReports={() => setView("reports")} onRoadmap={() => setView("roadmap")} onChanged={() => refreshBundle(selectedId)}/>} {view === "reports" && <ReportsWorkspace bundle={bundle} onChanged={() => refreshBundle(selectedId)}/>}</>
        : <main className="gallery"><p>Select a saved protein project.</p></main>}
    </div>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="dialog-panel"><DialogHeader><DialogTitle>Start a protein project</DialogTitle><DialogDescription>Create an independent project with its own Workflow, Roadmap, and Report. Related projects can be connected later in Project Trees.</DialogDescription></DialogHeader><label className="field">Project name<input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. PA0012 · PDB 8U0I"/></label><label className="field">Protein sequence<textarea rows={7} value={newSequence} onChange={(event) => setNewSequence(event.target.value)} placeholder="Paste a one-letter amino acid sequence"/></label><small>{newSequence.replace(/\s/g, "").length} residues</small><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={busy || !newSequence.trim()} onClick={() => void createProject()}>{busy && <LoaderCircle className="spin"/>} Create project</Button></DialogFooter></DialogContent></Dialog>
    <Dialog open={aboutOpen} onOpenChange={setAboutOpen}><DialogContent className="dialog-panel about-dialog"><DialogHeader><DialogTitle>Protein Lab {appVersion}</DialogTitle><DialogDescription>An offline workspace for planning protein expression, running purification analyses, and writing the purification report.</DialogDescription></DialogHeader><dl className="about-facts"><dt>Project directory</dt><dd className="about-path">{projectDirectory?.directory ?? (enginePath ? folderOf(enginePath) : "Engine not connected")}</dd><dt>Engine</dt><dd>{engineOnline ? "Connected" : engineOnline === false ? "Not connected" : "Connecting…"}</dd></dl><DialogFooter><Button variant="outline" onClick={() => { setAboutOpen(false); openManual(); }}><BookOpen/> Open the manual</Button><Button onClick={() => setAboutOpen(false)}>Close</Button></DialogFooter></DialogContent></Dialog>
  </div>;
}

function StartupScreen({ mounted, ready, leaving, engineOnline, onStart }: { mounted: boolean; ready: boolean; leaving: boolean; engineOnline: boolean | null; onStart: () => void }) {
  return <main className={`startup-screen ${leaving ? "leaving" : ""}`}>
    <div className="startup-halftone" aria-hidden="true"/>
    <section className="startup-content" aria-label="Protein Lab welcome screen">
      <span className="startup-kicker">PROTEIN PURIFICATION WORKSPACE</span>
      <div className="startup-hologram-shell" aria-hidden="true">
        <span className="startup-orbit startup-orbit-one"/>
        <span className="startup-orbit startup-orbit-two"/>
        <div className="startup-hologram">
          {mounted ? <StructureViewer geometry={welcomeGeometry} compact autoRotate hologram colorMode="theme" palette="protein-lab" envelope label="Protein Lab"/> : <span className="startup-protein-seed"><i className="protein-lab-logo" style={{ backgroundImage: "url('./protein-lab-logo.png')" }} aria-hidden="true"/></span>}
        </div>
        <span className="startup-shadow"/>
      </div>
      <div className="startup-wordmark">
        <h1><strong>Protein</strong> Lab</h1>
      </div>
      <p className="startup-subtitle">Plan. Design. Purify.</p>
      <div className="startup-action">
        {ready ? <Button className="startup-button" size="lg" onClick={onStart}><Sparkles/> Start</Button> : <span className="startup-loading"><i/>{engineOnline === false ? "Local workspace ready · engine reconnects inside" : "Preparing your local workspace"}</span>}
      </div>
      <small className="startup-local-status"><span className={engineOnline ? "online" : engineOnline === false ? "offline" : "checking"}/>{engineOnline ? "Scientific engine ready" : engineOnline === false ? "Offline workspace available" : "Starting local scientific engine"}</small>
    </section>
  </main>;
}

// The top-bar menus. Radix supplies the menubar keyboard model (arrows move
// between and within menus, Escape closes, typeahead) and renders each menu in
// a portal: the top bar has paint containment for scroll performance, which
// clipped the old in-place dropdowns to its own 62px height (HOM-147).
function DesktopMenu({ label, container, children }: { label: string; container: HTMLElement | null; children: React.ReactNode }) {
  return <MenubarPrimitive.Menu>
    <MenubarPrimitive.Trigger className="desktop-menu-trigger">{label}</MenubarPrimitive.Trigger>
    <MenubarPrimitive.Portal container={container}><MenubarPrimitive.Content className="desktop-menu-popover" align="start" sideOffset={6} collisionPadding={8}>{children}</MenubarPrimitive.Content></MenubarPrimitive.Portal>
  </MenubarPrimitive.Menu>;
}
function MenuItem({ icon, shortcut, disabled, onSelect, children }: { icon: React.ReactNode; shortcut?: string; disabled?: boolean; onSelect: () => void; children: React.ReactNode }) {
  return <MenubarPrimitive.Item className="desktop-menu-item" disabled={disabled} onSelect={onSelect}>{icon}<span>{children}</span>{shortcut && <kbd>{shortcut}</kbd>}</MenubarPrimitive.Item>;
}
// Long folder paths wrap at their separators rather than mid-name.
function MenuPath({ path }: { path: string }) {
  return <span className="menu-path">{path.split(/(?<=[/\\])/).map((part, index) => <Fragment key={index}>{part}<wbr/></Fragment>)}</span>;
}
function ProjectDirectoryNote({ state, enginePath }: { state: ProjectDirectoryState | null; enginePath: string }) {
  if (state?.missing) return <small className="desktop-menu-note warning" title={state.directory}>{state.missing} was not found, so projects are being saved in the default folder.</small>;
  if (state) return <small className="desktop-menu-note" title={state.directory}>{state.canChange ? "Projects are saved in" : "This engine was started outside Protein Lab and saves in"} <MenuPath path={state.directory}/></small>;
  return <small className="desktop-menu-note" title={enginePath}>{enginePath ? <>Choosing a folder needs the desktop app. The engine saves in <MenuPath path={folderOf(enginePath)}/></> : "Choosing a folder needs the desktop app."}</small>;
}

function TopGoogleAccount() {
  const [profile, setProfile] = useState<{ name?: string; googleEmail?: string; googleConnected?: boolean }>({});
  useEffect(() => {
    const load = () => { try { setProfile(JSON.parse(localStorage.getItem("protein-labs-profile") || "{}")); } catch { setProfile({}); } };
    load(); window.addEventListener("protein-labs-profile-changed", load); window.addEventListener("focus", load);
    return () => { window.removeEventListener("protein-labs-profile-changed", load); window.removeEventListener("focus", load); };
  }, []);
  function connect() {
    const next = { ...profile, googleConnected: true };
    localStorage.setItem("protein-labs-profile", JSON.stringify(next)); setProfile(next);
    window.open("https://alphafoldserver.com/welcome", "_blank", "noopener,noreferrer");
  }
  return <button className={`top-google-account ${profile.googleConnected ? "connected" : ""}`} onClick={connect}><span>G</span><span><strong>{profile.googleConnected ? "Google linked" : "Link Google account"}</strong>{profile.googleConnected && <small>{profile.googleEmail || "AlphaFold browser access"}</small>}</span><ExternalLink/></button>;
}

function ProjectGallery({ proteins, onOpen, onCreate }: { proteins: ProteinRecord[]; onOpen: (id: string) => void; onCreate: () => void }) { return <main className="gallery"><section className="gallery-heading"><div><span className="eyebrow">LOCAL LAB WORKSPACE</span><h1>Protein projects</h1><p>Each project has its own guided Workflow, purification Roadmap, and Report.</p></div><Button onClick={onCreate}><Plus/> New project</Button></section><section className="project-grid">{proteins.map((protein) => <button key={protein.id} className="project-card" onClick={() => onOpen(protein.id)}><ProjectCardPreview protein={protein}/><div className="project-card-body"><div className="project-meta"><span className="live-dot"/> SAVED LOCALLY <MoreHorizontal/></div><h2>{protein.name}</h2><p>{protein.sequence.length} aa{protein.organism ? ` · ${protein.organism}` : ""}</p><div className="modified">Updated {formatDate(protein.updatedAt)}</div></div></button>)}<button className="new-project-card" onClick={onCreate}><span><Plus/></span><strong>New project</strong><small>Start with a sequence</small></button></section>{proteins.length === 0 && <section className="recent-strip"><div><Dna/><span><strong>Begin with the protein sequence</strong><small>Protein Lab calculates properties locally as soon as it is saved.</small></span></div><Button variant="outline" onClick={onCreate}>Create first project</Button></section>}</main>; }
function ProjectCardPreview({ protein }: { protein: ProteinRecord }) { const [geometry, setGeometry] = useState<JsonObject | null>(null); const [label, setLabel] = useState("Protein needs to be predicted"); useEffect(() => { let active = true; proteinLabsApi.getProtein(protein.id).then(async (bundle) => { const model = bundle.alphaFoldModels[0]; if (!model?.modelId) return; if (active) setLabel(String(model.name ?? model.modelId)); const result = await proteinLabsApi.getAlphaFoldModel(protein.id, String(model.modelId)); if (active) setGeometry((result.geometry && typeof result.geometry === "object" ? result.geometry : result) as JsonObject); }).catch(() => undefined); return () => { active = false; }; }, [protein.id]); return <div className="protein-orbit"><StructureViewer geometry={geometry} paletteKey={protein.id} compact autoRotate hologram label={label}/></div>; }
function formatDate(value?: string) { if (!value) return "recently"; const date = new Date(value); return Number.isNaN(date.valueOf()) ? "recently" : date.toLocaleDateString(); }
