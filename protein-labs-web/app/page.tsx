"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, BookOpen, Check, CircleAlert, Disc3, Dna, ExternalLink, FileDown, FilePlus2, FlaskConical, FolderOpen, GitBranch, HelpCircle, LayoutGrid, LoaderCircle, MoreHorizontal, Plus, RefreshCw, Save, Settings, Share2, Sparkles, Workflow, Wrench } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { AppDashboard } from "@/components/protein-labs/app-dashboard";
import { JobWorkspace } from "@/components/protein-labs/job-workspace";
import { ReportsWorkspace } from "@/components/protein-labs/reports-workspace";
import { ProjectDashboard, ProjectWorkflow } from "@/components/protein-labs/project-workflow";
import { ProjectTrees } from "@/components/protein-labs/project-trees";
import { StructureViewer } from "@/components/protein-labs/structure-viewer";
import { PurificationRoadmapWorkspace } from "@/components/protein-labs/purification-roadmap";
import { VectorLibrary } from "@/components/protein-labs/vector-library";
import { JsonObject, ProteinBundle, ProteinRecord, proteinLabsApi } from "@/lib/protein-labs-api";
import { definitionFor } from "@/lib/workflow";
import { readProjectTrees, writeProjectTrees, type SavedProjectTree } from "@/lib/project-trees";
import { useProteinLabsWebMcp } from "@/hooks/use-protein-labs-webmcp";
import { runViewTransition } from "@/lib/view-transition";

type View = "home" | "projects" | "dashboard" | "workflow" | "project-trees" | "vectors" | "roadmap" | "reports" | "job";
// Depth of each view; moving to a shallower view animates as "back".
const viewDepth: Record<View, number> = { home: 0, projects: 1, "project-trees": 1, vectors: 1, dashboard: 2, workflow: 3, roadmap: 3, reports: 3, job: 4 };
type MenuName = "file" | "edit" | "settings" | "tools" | "help";
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
  const [projectTrees, setProjectTrees] = useState<SavedProjectTree[]>([]);
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
  const [openMenu, setOpenMenu] = useState<MenuName | null>(null);

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

  useEffect(() => { proteinLabsApi.health().then(async () => { setEngineOnline(true); const projects = await refreshProjects(); setProjectTrees(readProjectTrees(projects)); }).catch((reason) => { setEngineOnline(false); setError(reason instanceof Error ? reason.message : String(reason)); }); }, [refreshProjects]);
  useEffect(() => {
    queueMicrotask(() => setSplashMounted(true));
    const timer = window.setTimeout(() => setSplashReady(true), 1150);
    return () => window.clearTimeout(timer);
  }, []);
  // Ctrl+Shift+L opens the vector library from anywhere in the workspace.
  useEffect(() => {
    if (!started) return;
    const onKey = (event: KeyboardEvent) => { if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "l") { event.preventDefault(); setView("vectors"); } };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [started, view]); // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { const saved = savedVisualTheme(localStorage.getItem("protein-labs-visual-theme")); if (saved) queueMicrotask(() => setVisualTheme(saved)); }, []);

  function setView(next: View, update?: () => void) { runViewTransition(() => { update?.(); setViewState(next); }, viewDepth[next] < viewDepth[view] ? "back" : "forward"); }
  async function openProject(id: string, destination: View = "dashboard") { setBusy(true); setError(""); try { await loadProject(id, undefined, false); setView(destination, () => { setSelectedId(id); setActiveJob("sequence"); }); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } }
  async function createProject() { const sequence = newSequence.replace(/\s+/g, "").toUpperCase(); if (!sequence) { setError("Paste an amino-acid sequence before creating the project."); return; } setBusy(true); setError(""); try { const created = await proteinLabsApi.createProtein({ name: newName.trim() || `Protein project ${proteins.length + 1}`, sequence }); setNewName(""); setNewSequence(""); setCreateOpen(false); await loadProject(created.protein.id, undefined, false); setView("dashboard", () => { setSelectedId(created.protein.id); setActiveJob("sequence"); }); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } }
  function updateProjectTrees(next: SavedProjectTree[]) { setProjectTrees(next); writeProjectTrees(next); }
  async function openProjectJob(id: string, job: string) { setBusy(true); setError(""); try { await loadProject(id, undefined, false); setView("job", () => { setSelectedId(id); setActiveJob(definitionFor(job).id); setJobReturn("planning"); }); } catch (reason) { setError(reason instanceof Error ? reason.message : String(reason)); } finally { setBusy(false); } }
  function openJob(value: string, returnTo: "planning" | "roadmap" = "planning") { setView("job", () => { setActiveJob(definitionFor(value).id); setJobReturn(returnTo); }); }
  function chooseVisualTheme(theme: VisualTheme) { setVisualTheme(theme); localStorage.setItem("protein-labs-visual-theme", theme); }
  async function shareProject() { if (!bundle) return; const text = `${bundle.protein.name}\n${bundle.protein.sequence.length} aa\n${bundle.projectJobs.length} saved workflow jobs`; try { await navigator.clipboard.writeText(text); setError("Project summary copied to the clipboard."); } catch { setError("Clipboard access was not available."); } }
  function showHelp(kind: "shortcuts" | "about") { setOpenMenu(null); window.alert(kind === "shortcuts" ? "Protein Lab controls\n\nOpen Workflow cards to run project jobs.\nUse Project Trees to connect separate projects and explain what changed.\nThe purification roadmap and report stay attached to their individual project." : "Protein Lab 0.2\nOffline protein expression, purification, and analysis workspace."); }
  function enterWorkspace() {
    if (splashLeaving) return;
    setSplashLeaving(true);
    window.setTimeout(() => {
      setViewState("home");
      setStarted(true);
    }, 520);
  }

  useProteinLabsWebMcp(useMemo(() => ({ openProject: (id: string) => { void openProject(id, "dashboard"); }, openJob: (id: string) => openJob(id), openNotebook: () => setView("reports") }), [])); // eslint-disable-line react-hooks/exhaustive-deps

  if (!started) {
    return <div className={`app-shell visual-${visualTheme} ${dark ? "dark" : ""}`} data-visual-theme={visualTheme}>
      <StartupScreen mounted={splashMounted} ready={splashReady} leaving={splashLeaving} engineOnline={engineOnline} onStart={enterWorkspace}/>
    </div>;
  }

  return <div className={`app-shell visual-${visualTheme} ${dark ? "dark" : ""}`} data-visual-theme={visualTheme} onClick={() => setOpenMenu(null)}>
    <header className="topbar desktop-topbar">
      <button className={`brand dashboard-home-button ${view !== "home" ? "return-mode" : ""}`} onClick={() => setView("home")} aria-label={view === "home" ? "Protein Lab dashboard" : "Back to dashboard"} title={view === "home" ? "Protein Lab dashboard" : "Back to dashboard"}><span className="brand-mark">{view === "home" ? <i className="protein-lab-logo" style={{ backgroundImage: "url('./protein-lab-logo.png')" }} aria-hidden="true"/> : <ArrowLeft/>}</span><span><strong>{view === "home" ? "Protein Lab" : "Back to dashboard"}</strong>{view !== "home" && <small>Exit this workspace</small>}</span></button>
      <nav className="desktop-menu-bar" aria-label="Application menu">
        <DesktopMenu label="File" name="file" open={openMenu} setOpen={setOpenMenu}><button onClick={() => { setOpenMenu(null); setCreateOpen(true); }}><FilePlus2/> New project</button><button onClick={() => { setOpenMenu(null); setView("projects"); }}><FolderOpen/> Open…</button><button disabled={!bundle} onClick={() => { setOpenMenu(null); void refreshBundle(); }}><Save/> Save / refresh</button><button disabled={!bundle} onClick={() => { setOpenMenu(null); setView("reports"); }}><FileDown/> Save As / Export</button><button disabled={!bundle} onClick={() => { setOpenMenu(null); void shareProject(); }}><Share2/> Share</button></DesktopMenu>
        <DesktopMenu label="Edit" name="edit" open={openMenu} setOpen={setOpenMenu}><button disabled><span className="menu-glyph">↶</span> Undo</button><button disabled><span className="menu-glyph">↷</span> Redo</button><hr/><button onClick={() => { setOpenMenu(null); void refreshProjects(); }}><RefreshCw/> Refresh workspace</button><button disabled={!bundle} onClick={() => { setOpenMenu(null); setView("reports"); }}><BookOpen/> Edit report</button></DesktopMenu>
        <DesktopMenu label="Settings" name="settings" open={openMenu} setOpen={setOpenMenu}><span className="menu-heading"><Settings/> Appearance</span><div className="theme-preset-list">{visualThemes.map((theme) => <button key={theme.id} className={visualTheme === theme.id ? "selected" : ""} onClick={() => chooseVisualTheme(theme.id)}><span className="theme-swatches">{theme.colors.map((color) => <i key={color} style={{ background: color }}/>)}</span><span><strong>{theme.label}</strong><small>{theme.description}</small></span>{visualTheme === theme.id && <Check/>}</button>)}</div><small>Each appearance sets its own light or dark mode.</small></DesktopMenu>
        <DesktopMenu label="Tools" name="tools" open={openMenu} setOpen={setOpenMenu}><button onClick={() => { setOpenMenu(null); setView("projects"); }}><LayoutGrid/> Project gallery</button><button onClick={() => { setOpenMenu(null); setView("project-trees"); }}><GitBranch/> Project trees</button><button onClick={() => { setOpenMenu(null); setView("vectors"); }}><Disc3/> Vector library<kbd>Ctrl+Shift+L</kbd></button><button disabled={!bundle} onClick={() => { setOpenMenu(null); setView("workflow"); }}><Workflow/> Project workflow</button><button disabled={!bundle} onClick={() => { setOpenMenu(null); setView("roadmap"); }}><FlaskConical/> Purification roadmap</button><button disabled={!bundle} onClick={() => { setOpenMenu(null); setView("reports"); }}><BookOpen/> Purification report</button></DesktopMenu>
        <DesktopMenu label="Help" name="help" open={openMenu} setOpen={setOpenMenu}><button onClick={() => showHelp("shortcuts")}><Wrench/> Mouse & keyboard controls</button><button onClick={() => showHelp("about")}><HelpCircle/> About Protein Lab</button></DesktopMenu>
      </nav>
      <div className="topbar-spacer"/>
      <div className="top-actions"><Button variant={view === "vectors" ? "secondary" : "ghost"} size="sm" className="topbar-vector-library" aria-pressed={view === "vectors"} title="Vector library (Ctrl+Shift+L)" onClick={() => setView("vectors")}><Disc3/> Vector library</Button><TopGoogleAccount/></div>
    </header>

    {error && <div className="global-error"><CircleAlert/><span>{error}</span><button onClick={() => setError("")}>Dismiss</button></div>}
    {busy && <div className="global-working"><LoaderCircle className="spin"/> Working with the local scientific engine…</div>}

    <div className={`workspace-view-transition ${view === "home" ? "is-dashboard" : ""}`} key={`${view}:${selectedId}:${view === "job" ? activeJob : ""}`}>
      {view === "home" ? <AppDashboard proteins={proteins} trees={projectTrees} onOpenProject={(id) => void openProject(id)} onOpenReports={(id) => void openProject(id, "reports")} onProjects={() => setView("projects")} onTrees={() => setView("project-trees")} onVectors={() => setView("vectors")} onCreate={() => setCreateOpen(true)}/>
        : view === "projects" ? <ProjectGallery proteins={proteins} onOpen={(id) => void openProject(id)} onCreate={() => { setError(""); setCreateOpen(true); }}/>
        : view === "vectors" ? <VectorLibrary mode="page" proteins={proteins} onOpenProject={(id) => void openProjectJob(id, "expression-vector")}/>
        : view === "project-trees" ? <ProjectTrees proteins={proteins} trees={projectTrees} onChange={updateProjectTrees} onOpenProject={(id) => void openProject(id)}/>
        : bundle ? <>{view === "dashboard" && <ProjectDashboard bundle={bundle} onResume={() => setView("workflow")} onRoadmap={() => setView("roadmap")} onReports={() => setView("reports")}/>} {view === "workflow" && <ProjectWorkflow bundle={bundle} onOpenJob={(id) => openJob(id, "planning")} onRoadmap={() => setView("roadmap")} onRefresh={() => refreshBundle(selectedId)}/>} {view === "roadmap" && <PurificationRoadmapWorkspace bundle={bundle} onOpenJob={(id) => openJob(id, "roadmap")} onBackToWorkflow={() => setView("workflow")} onChanged={() => refreshBundle(selectedId)}/>} {view === "job" && <JobWorkspace key={`${selectedId}:${activeJob}:${jobReturn}`} jobId={activeJob} bundle={bundle} returnTo={jobReturn} onBack={() => setView(jobReturn === "roadmap" ? "roadmap" : "workflow")} onOpenJob={(id) => openJob(id, "planning")} onReports={() => setView("reports")} onRoadmap={() => setView("roadmap")} onChanged={() => refreshBundle(selectedId)}/>} {view === "reports" && <ReportsWorkspace bundle={bundle} onChanged={() => refreshBundle(selectedId)}/>}</>
        : <main className="gallery"><p>Select a saved protein project.</p></main>}
    </div>

    <Dialog open={createOpen} onOpenChange={setCreateOpen}><DialogContent className="dialog-panel"><DialogHeader><DialogTitle>Start a protein project</DialogTitle><DialogDescription>Create an independent project with its own Workflow, Roadmap, and Report. Related projects can be connected later in Project Trees.</DialogDescription></DialogHeader><label className="field">Project name<input autoFocus value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="e.g. PA0012 · PDB 8U0I"/></label><label className="field">Protein sequence<textarea rows={7} value={newSequence} onChange={(event) => setNewSequence(event.target.value)} placeholder="Paste a one-letter amino acid sequence"/></label><small>{newSequence.replace(/\s/g, "").length} residues</small><DialogFooter><Button variant="outline" onClick={() => setCreateOpen(false)}>Cancel</Button><Button disabled={busy || !newSequence.trim()} onClick={() => void createProject()}>{busy && <LoaderCircle className="spin"/>} Create project</Button></DialogFooter></DialogContent></Dialog>
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

function DesktopMenu({ label, name, open, setOpen, children }: { label: string; name: MenuName; open: MenuName | null; setOpen: (name: MenuName | null) => void; children: React.ReactNode }) { const expanded = open === name; return <div className="desktop-menu"><button className={expanded ? "active" : ""} onClick={(event) => { event.stopPropagation(); setOpen(expanded ? null : name); }}>{label}</button>{expanded && <div className="desktop-menu-popover" onClick={(event) => event.stopPropagation()}>{children}</div>}</div>; }

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
