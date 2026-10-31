"use client";

import { Fragment, useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowRight, CalendarDays, ChevronLeft, ChevronRight,
  Clock3, ExternalLink, FlaskConical, FolderKanban, GitBranch, Pencil, Plus,
  Columns2, Disc3, FileText, FolderCog, FolderSearch, HardDrive, Library, Send, Sparkles, TestTubes, Trash2, UserPlus, Users, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { DashboardStats, type BundlesState } from "@/components/protein-labs/dashboard-stats";
import { FlipTile, TileHeadline } from "@/components/protein-labs/dashboard-flip-tile";
import type { ProteinBundle, ProteinRecord } from "@/lib/protein-labs-api";
import { proteinLabsApi } from "@/lib/protein-labs-api";
import type { ProjectTree } from "@/lib/project-tree-types";
import { projectTreeStats } from "@/lib/project-trees";
import { LIBRARY_TILE, libraryCount, summarizePlaces, type LibraryStorage, type LibraryTab } from "@/lib/library-hub";
import { librarySearchParams, type FacetCounts } from "@/lib/protein-library";

const mascots = [
  { id: "bacteria", emoji: "🦠", label: "Bacterium", caption: "Fast growth, focused science" },
  { id: "yeast", emoji: "🍞", label: "Yeast cell", caption: "Your eukaryotic folding friend" },
  { id: "insect", emoji: "🦋", label: "Insect cell", caption: "Complex proteins, gentle encouragement" },
  { id: "mammalian", emoji: "🧫", label: "Mammalian cell", caption: "Complex biology, calm company" },
] as const;

const mascotAffirmations = [
  "Your careful planning is building something remarkable.",
  "Great science is made one thoughtful step at a time.",
  "You’ve got this — your protein is in good hands.",
  "Nice work. Every saved choice makes the next step clearer.",
  "Keep going! Your purification plan is taking shape.",
];

const timelineStages = [
  { id: "expression", label: "Expression", color: "#a78bfa" },
  { id: "purification", label: "Purification", color: "#36c7a5" },
  { id: "chromatography", label: "Chromatography", color: "#58a6ff" },
  { id: "quality-control", label: "Quality control", color: "#f2b84b" },
] as const;

type TimelineStage = typeof timelineStages[number]["id"];
type TimelineEvent = { id: string; date: string; title: string; projectId: string; stage: TimelineStage };
type TeamMember = { id: string; name: string; email: string; role: "Member" | "Reviewer" | "Owner" };
type Profile = { name: string; googleEmail: string; googleConnected: boolean };

const defaultProfile: Profile = { name: "Researcher", googleEmail: "", googleConnected: false };
// The companion stays out of the way until the researcher asks for it.
const MASCOT_VISIBLE_KEY = "protein-labs-mascot-visible";
const reportPages = ["Protein properties", "Transformation and expression", "Cell lysis and clarification", "Affinity capture", "Affinity-tag cleavage", "Subtractive cleanup", "SEC polishing", "Quality control and storage"];

export function AppDashboard({ proteins, trees, onOpenProject, onOpenReports, onProjects, onTrees, storage, onLibrary, onWorkbench, onRevealStorage, onChangeStorage, onCreate }: { proteins: ProteinRecord[]; trees: ProjectTree[]; onOpenProject: (id: string) => void; onOpenReports: (id: string) => void; onProjects: () => void; onTrees: () => void; storage: LibraryStorage; onLibrary: (tab: LibraryTab) => void; onWorkbench: (libraryVectorId?: string) => void; onRevealStorage: () => void; onChangeStorage: () => void; onCreate: () => void }) {
  const [now, setNow] = useState(new Date());
  const [bundles, setBundles] = useState<ProteinBundle[]>([]);
  // Which project list the bundles were loaded for, so a newer list reads as loading.
  const [bundlesLoad, setBundlesLoad] = useState<{ source: ProteinRecord[]; state: BundlesState } | null>(null);
  const [vectors, setVectors] = useState<LibraryVector[]>([]);
  const [vectorsState, setVectorsState] = useState<BundlesState>("loading");
  const [stock, setStock] = useState<{ total: number; facets: FacetCounts } | null>(null);
  const [stockState, setStockState] = useState<BundlesState>("loading");
  const [mascotId, setMascotId] = useState("bacteria");
  const [mascotVisible, setMascotVisible] = useState(false);
  const [picker, setPicker] = useState(false);
  const [profile, setProfile] = useState<Profile>(defaultProfile);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileName, setProfileName] = useState(defaultProfile.name);
  const [googleEmail, setGoogleEmail] = useState("");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [memberOpen, setMemberOpen] = useState(false);
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<TeamMember["role"]>("Member");
  const [events, setEvents] = useState<TimelineEvent[]>([]);
  const [calendarMonth, setCalendarMonth] = useState(() => new Date(new Date().getFullYear(), new Date().getMonth(), 1));
  const [selectedDate, setSelectedDate] = useState(() => dateKey(new Date()));
  const [eventTitle, setEventTitle] = useState("");
  const [eventStage, setEventStage] = useState<TimelineStage>("purification");
  const [selectedProject, setSelectedProject] = useState("");
  const [notice, setNotice] = useState("");

  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 60_000); return () => window.clearInterval(timer); }, []);
  useEffect(() => {
    const savedMascot = localStorage.getItem("protein-labs-mascot");
    const savedVisible = localStorage.getItem(MASCOT_VISIBLE_KEY) === "true";
    queueMicrotask(() => {
      if (savedMascot && mascots.some((item) => item.id === savedMascot)) setMascotId(savedMascot);
      setMascotVisible(savedVisible);
      setProfile(readStored("protein-labs-profile", defaultProfile));
      setMembers(readStored<TeamMember[]>("protein-labs-team", []));
      setEvents(readStored<TimelineEvent[]>("protein-labs-purification-timeline", []));
    });
  }, []);
  useEffect(() => {
    let active = true;
    // Projects that fail to load are left out; the stats column says the
    // job counts are incomplete rather than showing them as zero.
    Promise.allSettled(proteins.map((protein) => proteinLabsApi.getProtein(protein.id))).then((results) => {
      if (!active) return;
      setBundles(results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []));
      setBundlesLoad({ source: proteins, state: results.some((result) => result.status === "rejected") ? "error" : "ready" });
    });
    return () => { active = false; };
  }, [proteins]);
  useEffect(() => {
    let active = true;
    proteinLabsApi.vectorLibrary()
      .then((value) => { if (active) { setVectors(value.vectors as unknown as LibraryVector[]); setVectorsState("ready"); } })
      .catch(() => { if (active) setVectorsState("error"); });
    // One row is enough: the total and the facets cover the whole protein library.
    proteinLabsApi.searchProteinLibrary(librarySearchParams({ query: "", filters: {}, limit: 1 }))
      .then((value) => { if (active) { setStock({ total: value.total, facets: value.facets as FacetCounts }); setStockState("ready"); } })
      .catch(() => { if (active) setStockState("error"); });
    return () => { active = false; };
  }, []);

  const mascot = mascots.find((item) => item.id === mascotId) ?? mascots[0];
  const bundlesState: BundlesState = bundlesLoad?.source === proteins ? bundlesLoad.state : "loading";
  const roots = proteins;
  const treeStats = projectTreeStats(trees);
  const activeProjectId = selectedProject || roots[0]?.id || "";
  const completedJobs = bundles.flatMap((bundle) => bundle.projectJobs).filter((job) => job.status === "complete").length;
  const totalJobs = bundles.reduce((sum, bundle) => sum + bundle.projectJobs.length, 0);
  const projectIdsInTrees = new Set(trees.flatMap((tree) => [tree.rootProjectId, ...tree.branches.flatMap((link) => [link.fromProjectId, link.toProjectId])]));
  const upcoming = events.filter((event) => event.date >= dateKey(now)).sort((a, b) => a.date.localeCompare(b.date));
  const workspaceHours = useWorkspaceHours();
  // The job touched most recently across every project, with its project's
  // progress, so the dashboard opens on whatever work is actually in flight.
  const currentJob = useMemo(() => {
    const entries = bundles.flatMap((bundle) => bundle.projectJobs.map((job) => ({ bundle, job })));
    if (!entries.length) return null;
    const latest = entries.reduce((best, entry) => (entry.job.updatedAt > best.job.updatedAt ? entry : best), entries[0]);
    const jobs = latest.bundle.projectJobs;
    const complete = jobs.filter((job) => job.status === "complete").length;
    return {
      project: latest.bundle.protein,
      job: latest.job,
      complete,
      total: jobs.length,
      progress: jobs.length ? complete / jobs.length : 0,
      recent: [...jobs].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 4),
    };
  }, [bundles]);
  const latestProjects = useMemo(() => [...proteins].sort((a, b) => (b.updatedAt ?? b.createdAt ?? "").localeCompare(a.updatedAt ?? a.createdAt ?? "")), [proteins]);
  const activeProject = roots.find((protein) => protein.id === activeProjectId);
  const vectorProjects = new Set(vectors.flatMap((vector) => vector.projects.map((use) => use.proteinId))).size;
  const vectorCount = vectorsState === "ready" ? vectors.length : null;
  // The workbench tile lists the user's own vectors first, newest first, then the standard ones.
  const recentVectors = useMemo(() => [...vectors].sort((a, b) => Number(a.isStandard) - Number(b.isStandard) || String(b.updatedAt ?? "").localeCompare(String(a.updatedAt ?? ""))).slice(0, 6), [vectors]);
  const proteinCount = stockState === "ready" ? stock?.total ?? 0 : null;
  const lowStock = stock?.facets.status?.find((option) => option.value === "low")?.count ?? 0;
  const proteinPlaces = summarizePlaces(stock?.facets.location);
  const librariesFailed = vectorsState === "error" && stockState === "error";
  const cells = useMemo(() => calendarCells(calendarMonth), [calendarMonth]);
  const selectedEvents = events.filter((event) => event.date === selectedDate).sort((a, b) => a.title.localeCompare(b.title));

  function showMascot(value: boolean) { setMascotVisible(value); if (!value) setPicker(false); localStorage.setItem(MASCOT_VISIBLE_KEY, String(value)); }
  function chooseMascot(id: string) { setMascotId(id); localStorage.setItem("protein-labs-mascot", id); setPicker(false); }
  function openProfile() { setProfileName(profile.name); setGoogleEmail(profile.googleEmail); setProfileOpen(true); }
  function saveProfile() {
    const value = { ...profile, name: profileName.trim() || "Researcher", googleEmail: googleEmail.trim() };
    setProfile(value); store("protein-labs-profile", value); setProfileOpen(false);
  }
  function connectGoogle() {
    const value = { ...profile, name: profileName.trim() || profile.name, googleEmail: googleEmail.trim(), googleConnected: true };
    setProfile(value); store("protein-labs-profile", value);
    window.open("https://alphafoldserver.com/welcome", "_blank", "noopener,noreferrer");
    setNotice("AlphaFold Server sign-in opened in your system browser. Protein Lab does not store your password or OAuth token.");
  }
  function disconnectGoogle() { const value = { ...profile, googleConnected: false }; setProfile(value); store("protein-labs-profile", value); }
  async function openAlphaFold() {
    const project = roots.find((item) => item.id === activeProjectId);
    if (project) {
      try { await navigator.clipboard.writeText(`>${project.name}\n${project.sequence}`); setNotice(`${project.name} was copied as FASTA. Paste it into AlphaFold Server.`); }
      catch { setNotice("AlphaFold Server opened, but clipboard access was unavailable."); }
    }
    window.open("https://alphafoldserver.com/welcome", "_blank", "noopener,noreferrer");
  }
  function addEvent() {
    if (!eventTitle.trim()) { setNotice("Give the purification timeline item a name first."); return; }
    const value: TimelineEvent = { id: crypto.randomUUID(), date: selectedDate, title: eventTitle.trim(), projectId: activeProjectId, stage: eventStage };
    const next = [...events, value]; setEvents(next); store("protein-labs-purification-timeline", next); setEventTitle(""); setNotice(`Added to ${formatCalendarDate(selectedDate)}.`);
  }
  function removeEvent(id: string) { const next = events.filter((event) => event.id !== id); setEvents(next); store("protein-labs-purification-timeline", next); }
  function addMember() {
    if (!memberName.trim() || !memberEmail.trim()) { setNotice("Enter the collaborator's name and email address."); return; }
    const value: TeamMember = { id: crypto.randomUUID(), name: memberName.trim(), email: memberEmail.trim(), role: memberRole };
    const next = [...members, value]; setMembers(next); store("protein-labs-team", next); setMemberName(""); setMemberEmail(""); setMemberRole("Member"); setMemberOpen(false);
  }
  function removeMember(id: string) { const next = members.filter((member) => member.id !== id); setMembers(next); store("protein-labs-team", next); }
  async function shareWith(member: TeamMember) {
    const project = roots.find((item) => item.id === activeProjectId);
    if (!project) { setNotice("Create or select a project before sharing."); return; }
    const projectBundle = bundles.find((bundle) => bundle.protein.id === project.id);
    const handoff = JSON.stringify({ schema: "protein-labs-project-handoff/v1", sharedAt: new Date().toISOString(), sharedWith: member.email, project: projectBundle ?? { protein: project } }, null, 2);
    const filename = `${safeFilename(project.name)}-protein-labs-handoff.json`;
    downloadText(filename, handoff);
    try { await navigator.clipboard.writeText(handoff); } catch { /* The email draft still opens if clipboard permission is unavailable. */ }
    const subject = encodeURIComponent(`Protein Lab project: ${project.name}`);
    const body = encodeURIComponent(`Hi ${member.name},\n\nI would like to share the Protein Lab project “${project.name}” (${project.sequence.length} aa) with you. Please find the exported project handoff file “${filename}” attached.\n\nBest,\n${profile.name}`);
    window.open(`mailto:${encodeURIComponent(member.email)}?subject=${subject}&body=${body}`, "_blank");
    setNotice(`${filename} was downloaded, copied, and an email draft for ${member.name} was opened. Attach the downloaded file before sending.`);
  }

  const projectSelect = (label: string, empty = "No projects yet") => <label className="dashboard-project-select">{label}<select value={activeProjectId} onChange={(event) => setSelectedProject(event.target.value)}>{roots.length ? roots.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>) : <option value="">{empty}</option>}</select></label>;

  return <main className="suite-dashboard">
    <div className="dashboard-shell-grid">
    <DashboardStats proteins={proteins} bundles={bundles} state={bundlesState} hours={workspaceHours}>
      {mascotVisible && <DashboardMascot
        mascotId={mascotId}
        pickerOpen={picker}
        onTogglePicker={() => setPicker((value) => !value)}
        onChoose={chooseMascot}
        onHide={() => showMascot(false)}
        cheers={companionCheers(roots.length, completedJobs, totalJobs, upcoming.length)}
      />}
    </DashboardStats>
    <div className="dashboard-content-column">
    <section className="dashboard-welcome dashboard-card">
      <div className="dashboard-greeting"><div><span className="eyebrow">PROTEIN LAB · LOCAL WORKSPACE</span><h1>{greeting(now)}, {profile.name || "Researcher"}.</h1><p>Plan the next experiment, review active work, and keep the purification team synchronized.</p></div></div>
      <div className="dashboard-welcome-actions">
        <LiveClock/>
        <Button size="sm" onClick={onCreate}><Plus/> New project</Button>
        <Button variant="outline" size="sm" onClick={openProfile}><Pencil/> Profile</Button>
        <Button variant="outline" size="icon" className={`mascot-toggle ${mascotVisible ? "is-on" : ""}`} aria-pressed={mascotVisible} onClick={() => showMascot(!mascotVisible)} title={mascotVisible ? "Hide your lab companion" : "Show your lab companion"} aria-label={mascotVisible ? "Hide lab companion" : "Show lab companion"}><span aria-hidden="true">{mascot.emoji}</span></Button>
      </div>
    </section>

    {notice && <div className="dashboard-notice"><Sparkles/><span>{notice}</span><button onClick={() => setNotice("")}><X/></button></div>}

    <div className="dashboard-board">
      {/* Each tile shows an overview and flips to its full list. In a column
          the flipped tile takes the spare height and its back scrolls. */}
      <div className="dashboard-board-column">
        <FlipTile className="dashboard-project-overview-card" icon={FolderKanban} art="projects" title="Projects" subtitle="Local protein projects"
          backSubtitle={`${roots.length} project${roots.length === 1 ? "" : "s"} · ${completedJobs}/${totalJobs} workflow jobs complete`}
          actions={<Button variant="outline" size="sm" onClick={onProjects}>Gallery <ArrowRight/></Button>}
          front={<>
            <TileHeadline value={roots.length} label={`protein project${roots.length === 1 ? "" : "s"}`} detail={roots.length ? `${completedJobs} of ${totalJobs} workflow jobs complete` : "Start from an amino-acid sequence"}/>
            {latestProjects[0] && <span className="tile-latest"><small>Last updated</small><b>{projectEmoji(latestProjects[0])} {latestProjects[0].name}</b><time>{formatRelative(latestProjects[0].updatedAt ?? latestProjects[0].createdAt)}</time></span>}
          </>}
          back={<div className="project-tile-grid">
            {roots.map((protein, index) => { const projectBundle = bundles.find((value) => value.protein.id === protein.id); return <ProjectTile key={protein.id} protein={protein} index={index} complete={projectBundle?.projectJobs.filter((job) => job.status === "complete").length ?? 0} total={projectBundle?.projectJobs.length ?? 0} linked={projectIdsInTrees.has(protein.id)} onOpen={() => onOpenProject(protein.id)}/>; })}
            {!roots.length && <button className="project-tile project-tile-new" onClick={onCreate}><span><Plus/></span><strong>Create your first project</strong><small>Start from an amino-acid sequence</small></button>}
          </div>}
        />

        <FlipTile className="dashboard-tree-overview-card" icon={GitBranch} art="trees" title="Project trees" subtitle="How your constructs relate"
          backSubtitle="How your constructs relate and what changed"
          actions={<Button variant="outline" size="sm" onClick={onTrees}>Open trees <ArrowRight/></Button>}
          front={<>
            <TileHeadline value={treeStats.trees} label={`tree${treeStats.trees === 1 ? "" : "s"}`} detail={`${treeStats.branches} branch${treeStats.branches === 1 ? "" : "es"} · ${projectIdsInTrees.size} linked project${projectIdsInTrees.size === 1 ? "" : "s"}`}/>
            {trees[0] ? <span className="tile-latest"><small>Newest tree</small><b>{trees[0].name}</b><time>from {projectName(roots, trees[0].rootProjectId)}</time></span> : <span className="tile-latest"><small>No trees yet</small><b>Link construct, vector, host or process changes</b></span>}
          </>}
          back={<>
            <button className="tree-stat-strip" onClick={onTrees}><span><strong>{treeStats.trees}</strong><small>Tree{treeStats.trees === 1 ? "" : "s"}</small></span><span><strong>{treeStats.branches}</strong><small>Branch{treeStats.branches === 1 ? "" : "es"}</small></span><span><strong>{projectIdsInTrees.size}</strong><small>Linked project{projectIdsInTrees.size === 1 ? "" : "s"}</small></span></button>
            {trees[0] && <button className="tree-feature" onClick={onTrees}><TreePreview tree={trees[0]} names={roots}/><span><strong>{trees[0].name}</strong><small>{trees[0].branches.length} branch{trees[0].branches.length === 1 ? "" : "es"} from {projectName(roots, trees[0].rootProjectId)}</small></span></button>}
            <div className="tree-tile-list">{trees.length ? trees.slice(1).map((tree, index) => { const projectIds = new Set([tree.rootProjectId, ...tree.branches.flatMap((link) => [link.fromProjectId, link.toProjectId])]); return <button key={tree.id} style={{ "--stagger": index } as React.CSSProperties} onClick={onTrees}><TreePreview tree={tree}/><span><strong>{tree.name}</strong><small>Root · {projectName(roots, tree.rootProjectId)}</small><small>{projectIds.size} projects · {tree.branches.length} branch{tree.branches.length === 1 ? "" : "es"}</small></span><ArrowRight/></button>; }) : <button className="tree-empty" onClick={onTrees}><TreePreview/><span><strong>Grow your first project tree</strong><small>Link construct, vector, host, or process changes between projects.</small></span><ArrowRight/></button>}</div>
          </>}
        />
        <FlipTile className="dashboard-workbench-card" icon={Columns2} art="workbench" title="Vector Workbench" subtitle="Map and sequence, side by side"
          backSubtitle="Open a vector, or start from a file"
          actions={<Button variant="outline" size="sm" onClick={() => onWorkbench()}>Open <ArrowRight/></Button>}
          front={<TileHeadline value={vectorCount ?? "…"} label={vectorCount === 1 ? "vector to open" : "vectors to open"} detail={vectorsState === "error" ? "Library unavailable; import a file instead" : "Edit features, find sites and ORFs, outside any project"}/>}
          back={<div className="tree-tile-list workbench-tile-list">
            {recentVectors.map((vector, index) => <button key={vector.id} style={{ "--stagger": index } as React.CSSProperties} onClick={() => onWorkbench(vector.id)}><Disc3/><span><strong>{vector.name}</strong><small>{vector.lengthBp.toLocaleString()} bp · {vector.featureCount} feature{vector.featureCount === 1 ? "" : "s"}{vector.isStandard ? " · standard" : ""}</small></span><ArrowRight/></button>)}
            {!recentVectors.length && <button className="workbench-tile-empty" onClick={() => onWorkbench()}><Columns2/><span><strong>Open the Workbench</strong><small>Import GenBank, FASTA or SnapGene .dna, or paste DNA</small></span><ArrowRight/></button>}
          </div>}
        />
      </div>

      <div className="dashboard-board-column">
        <FlipTile className="dashboard-current-job-card" icon={Activity} art="job" title="Current job" subtitle={currentJob ? `Last worked on ${relativeTime(currentJob.job.updatedAt, now)}` : "Nothing in progress yet"}
          actions={currentJob && <Button variant="outline" size="sm" onClick={() => onOpenProject(currentJob.project.id)}>Resume <ArrowRight/></Button>}
          front={currentJob ? <span className="tile-job">
            <span className="current-job-head">
              <span className="dashboard-project-avatar">{projectEmoji(currentJob.project)}</span>
              <span><strong>{currentJob.job.name}</strong><small>{currentJob.project.name}</small></span>
              <em className={`current-job-status status-${currentJob.job.status}`}>{jobStatusLabel(currentJob.job.status)}</em>
            </span>
            <span className="current-job-progress">
              <i style={{ "--value": `${Math.round(currentJob.progress * 100)}%` } as React.CSSProperties}/>
              <small>{currentJob.complete} of {currentJob.total} workflow jobs complete in this project</small>
            </span>
          </span> : <TileHeadline value="—" label="No job opened yet" detail="Save a workflow step in a project and it appears here"/>}
          back={currentJob ? <button className="current-job-body" onClick={() => onOpenProject(currentJob.project.id)}>
            <span className="current-job-head">
              <span className="dashboard-project-avatar">{projectEmoji(currentJob.project)}</span>
              <span><strong>{currentJob.job.name}</strong><small>{currentJob.project.name}</small></span>
              <em className={`current-job-status status-${currentJob.job.status}`}>{jobStatusLabel(currentJob.job.status)}</em>
            </span>
            <span className="current-job-progress">
              <i style={{ "--value": `${Math.round(currentJob.progress * 100)}%` } as React.CSSProperties}/>
              <small>{currentJob.complete} of {currentJob.total} workflow jobs complete in this project</small>
            </span>
            <span className="current-job-steps">
              {currentJob.recent.map((job) => <span key={job.id} className={job.status === "complete" ? "done" : ""}><i/>{job.name}</span>)}
            </span>
          </button> : <div className="current-job-empty"><FlaskConical/><span><strong>No job has been opened yet</strong><small>Open a project and save a workflow step; the most recent one appears here.</small></span><Button size="sm" onClick={onCreate}><Plus/> New project</Button></div>}
        />

        <FlipTile className="dashboard-reports-card" icon={FileText} art="reports" title="Reports" subtitle="Records to print or send"
          backSubtitle="Publication-quality records to print or send to a client"
          front={<TileHeadline value={reportPages.length} label="report sections" detail={activeProject ? `For ${activeProject.name}` : "Create a project to build its report"}/>}
          back={<div className="reports-card-body">
            {projectSelect("Project")}
            <ul className="reports-card-pages">{reportPages.map((page) => <li key={page}><i/>{page}</li>)}</ul>
            <Button className="wide" disabled={!activeProjectId} onClick={() => onOpenReports(activeProjectId)}><FileText/> Open the report</Button>
          </div>}
        />

        <FlipTile className="dashboard-team-card" icon={Users} art="team" title="Team members" subtitle="Project handoffs for collaborators"
          actions={<Button variant="outline" size="sm" onClick={() => setMemberOpen(true)}><UserPlus/> Add</Button>}
          front={<TileHeadline value={members.length + 1} label={members.length ? "people on the team" : "person on the team"} detail={members.length ? `${profile.name || "You"} and ${members.length} collaborator${members.length === 1 ? "" : "s"}` : "Only you so far"}/>}
          back={<>
            {projectSelect("Project to share")}
            <div className="team-list"><div className="team-member owner"><span>{initials(profile.name)}</span><div><strong>{profile.name || "Researcher"}</strong><small>{profile.googleEmail || "Local workspace owner"}</small></div><em>Owner</em></div>{members.map((member) => <div className="team-member" key={member.id}><span>{initials(member.name)}</span><div><strong>{member.name}</strong><small>{member.email}</small></div><em>{member.role}</em><button title={`Share with ${member.name}`} onClick={() => void shareWith(member)}><Send/></button><button title={`Remove ${member.name}`} onClick={() => removeMember(member.id)}><Trash2/></button></div>)}{!members.length && <div className="team-empty"><Users/><span><strong>No collaborators yet</strong><small>Add a researcher, then create an email-ready project handoff.</small></span></div>}</div>
          </>}
        />
      </div>

      <div className="dashboard-board-column">
        <FlipTile className="dashboard-calendar-card" icon={CalendarDays} art="timeline" title="Purification timeline" subtitle="Expression, columns and QC"
          backSubtitle="Schedule expression, columns, and quality control"
          actions={<Button variant="outline" size="sm" onClick={() => { setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedDate(dateKey(now)); }}>Today</Button>}
          front={<>
            <TileHeadline value={upcoming.length} label={`upcoming item${upcoming.length === 1 ? "" : "s"}`} detail={upcoming.length ? undefined : "Nothing scheduled yet"}/>
            {upcoming[0] && <span className="tile-latest"><small>Next</small><b><i className="tile-stage-dot" style={{ background: stage(upcoming[0].stage).color }}/>{upcoming[0].title}</b><time>{formatCalendarDate(upcoming[0].date)} · {stage(upcoming[0].stage).label}</time></span>}
          </>}
          back={<>
            <div className="calendar-toolbar"><button onClick={() => setCalendarMonth(shiftMonth(calendarMonth, -1))} aria-label="Previous month"><ChevronLeft/></button><strong>{calendarMonth.toLocaleDateString([], { month: "long", year: "numeric" })}</strong><button onClick={() => setCalendarMonth(shiftMonth(calendarMonth, 1))} aria-label="Next month"><ChevronRight/></button></div>
            <div className="purification-calendar"><div className="calendar-weekdays">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="calendar-days">{cells.map((cell) => { const key = dateKey(cell.date); const dayEvents = events.filter((event) => event.date === key); return <button key={key} className={`${cell.outside ? "outside" : ""} ${key === dateKey(now) ? "today" : ""} ${key === selectedDate ? "selected" : ""}`} onClick={() => setSelectedDate(key)}><span>{cell.date.getDate()}</span><i>{dayEvents.slice(0, 3).map((event) => <b key={event.id} style={{ background: stage(event.stage).color }}/>)}</i></button>; })}</div></div>
            <div className="timeline-editor"><div className="timeline-date"><strong>{formatCalendarDate(selectedDate)}</strong><small>{selectedEvents.length} planned item{selectedEvents.length === 1 ? "" : "s"}</small></div><div className="timeline-add"><input value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addEvent(); }} placeholder="e.g. Run Superdex 200 Increase" aria-label="Timeline item"/><select value={activeProjectId} onChange={(event) => setSelectedProject(event.target.value)} aria-label="Project">{roots.length ? roots.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>) : <option value="">General lab work</option>}</select><select value={eventStage} onChange={(event) => setEventStage(event.target.value as TimelineStage)} aria-label="Stage">{timelineStages.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select><button onClick={addEvent} aria-label="Add timeline item"><Plus/></button></div><div className="timeline-items">{selectedEvents.map((event) => <div key={event.id}><i style={{ background: stage(event.stage).color }}/><span><strong>{event.title}</strong><small>{stage(event.stage).label} · {projectName(roots, event.projectId)}</small></span><button onClick={() => removeEvent(event.id)} aria-label={`Remove ${event.title}`}><X/></button></div>)}{!selectedEvents.length && <p>Select a day and add the next purification milestone.</p>}</div></div>
          </>}
        />

        <FlipTile className="dashboard-vector-card" icon={Library} art="library" title={LIBRARY_TILE.title} subtitle={LIBRARY_TILE.subtitle}
          backSubtitle={storage.folder ? "Both are saved in the project database" : "Saved in the project database"}
          actions={<Button variant="outline" size="sm" onClick={() => onLibrary("vectors")}>Open library <ArrowRight/></Button>}
          front={librariesFailed
            ? <TileHeadline value="—" label="Libraries unavailable" detail="Start the local engine to read your vectors and proteins"/>
            : <span className="library-tile-counts">
              <TileHeadline value={vectorCount ?? "…"} label={vectorCount === 1 ? "vector" : "vectors"} detail={vectorsState === "error" ? "Unavailable" : vectorCount ? `Used in ${vectorProjects} project${vectorProjects === 1 ? "" : "s"}` : vectorsState === "ready" ? "None saved yet" : undefined}/>
              <TileHeadline value={proteinCount ?? "…"} label={proteinCount === 1 ? "protein" : "proteins"} detail={stockState === "error" ? "Unavailable" : lowStock ? `${lowStock} running low` : proteinCount ? "Purified batches" : stockState === "ready" ? "None saved yet" : undefined}/>
            </span>}
          back={<LibrarySummary
            shelves={[
              { tab: "vectors", icon: Disc3, count: vectorCount, failed: vectorsState === "error", detail: vectorCount ? `Used in ${vectorProjects} project${vectorProjects === 1 ? "" : "s"}` : "Name and save a vector in Expression vector design" },
              { tab: "proteins", icon: TestTubes, count: proteinCount, failed: stockState === "error", detail: proteinCount ? [proteinPlaces && `Stored in ${proteinPlaces}`, lowStock && `${lowStock} running low`].filter(Boolean).join(" · ") || "Purified batches" : "Add a purified batch and where it is kept" },
            ]}
            storage={storage} onOpen={onLibrary} onReveal={onRevealStorage} onChange={onChangeStorage}/>}
        />

        <FlipTile className="dashboard-account-card" icon={Sparkles} art="alphafold" title="AlphaFold access" subtitle="Through your system browser"
          backSubtitle="Use your Google-authenticated system browser"
          front={<span className={`tile-status ${profile.googleConnected ? "is-on" : ""}`}><i aria-hidden="true"/><span><b>{profile.googleConnected ? "Google browser link ready" : "Not connected"}</b><small>{profile.googleConnected ? profile.googleEmail || "Account selected in your browser" : "Your credentials stay with Google, not Protein Lab"}</small></span></span>}
          back={<>
            <div className="account-identity"><span className={profile.googleConnected ? "connected" : ""}>{profile.googleConnected ? "G" : mascot.emoji}</span><div><strong>{profile.googleConnected ? "Google browser link ready" : "Connect a Google account"}</strong><small>{profile.googleConnected ? profile.googleEmail || "Account selected in your browser" : "Your credentials stay with Google, not Protein Lab."}</small></div></div>
            {profile.googleConnected ? <>{projectSelect("Sequence to prepare")}<Button className="wide" onClick={() => void openAlphaFold()}><ExternalLink/> Copy FASTA & open AlphaFold</Button><button className="account-text-action" onClick={disconnectGoogle}>Disconnect browser link</button></> : <Button className="wide" onClick={connectGoogle}><ExternalLink/> Choose Google account</Button>}
            <p>AlphaFold Server remains a Google-hosted service. Protein Lab opens the official site and prepares the selected sequence; it never stores your Google password or authentication token.</p>
          </>}
        />
      </div>
    </div>
    </div>
    </div>

    <Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogContent className="dialog-panel"><DialogHeader><DialogTitle>Your Protein Lab profile</DialogTitle><DialogDescription>Choose how Protein Lab greets you and which Google account label appears on this computer.</DialogDescription></DialogHeader><label className="field">Preferred name<input autoFocus value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="How should Protein Lab address you?"/></label><label className="field">Google account email <small>(optional display label)</small><input type="email" value={googleEmail} onChange={(event) => setGoogleEmail(event.target.value)} placeholder="researcher@institution.edu"/></label><div className="profile-google-status"><span className={profile.googleConnected ? "connected" : ""}/><strong>{profile.googleConnected ? "Browser sign-in configured" : "Google browser sign-in not configured"}</strong></div><DialogFooter><Button variant="outline" onClick={() => setProfileOpen(false)}>Cancel</Button><Button onClick={saveProfile}>Save profile</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={memberOpen} onOpenChange={setMemberOpen}><DialogContent className="dialog-panel"><DialogHeader><DialogTitle>Add a team member</DialogTitle><DialogDescription>Team details remain on this computer and are used to prepare project handoffs.</DialogDescription></DialogHeader><label className="field">Name<input autoFocus value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="Collaborator name"/></label><label className="field">Email<input type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="name@institution.edu"/></label><label className="field">Role<select value={memberRole} onChange={(event) => setMemberRole(event.target.value as TeamMember["role"])}><option>Member</option><option>Reviewer</option><option>Owner</option></select></label><DialogFooter><Button variant="outline" onClick={() => setMemberOpen(false)}>Cancel</Button><Button onClick={addMember}><UserPlus/> Add member</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}

function DashboardMascot({ mascotId, pickerOpen, onTogglePicker, onChoose, onHide, cheers }: { mascotId: string; pickerOpen: boolean; onTogglePicker: () => void; onChoose: (id: string) => void; onHide: () => void; cheers: string[] }) {
  const stageRef = useRef<HTMLDivElement>(null);
  const [idle, setIdle] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [cheering, setCheering] = useState(0);
  const messageIndex = useRef(0);
  const messageTimer = useRef(0);
  const cheerTimer = useRef(0);
  const lines = useMemo(() => [...cheers, ...mascotAffirmations], [cheers]);
  const linesRef = useRef(lines);
  const mascot = mascots.find((item) => item.id === mascotId) ?? mascots[0];

  useEffect(() => { linesRef.current = lines; }, [lines]);

  useEffect(() => {
    let idleTimer = 0;
    const markActive = () => {
      setIdle(false);
      window.clearTimeout(idleTimer);
      idleTimer = window.setTimeout(() => setIdle(true), 120_000);
    };
    const activityEvents: (keyof WindowEventMap)[] = ["pointermove", "pointerdown", "keydown", "wheel", "touchstart"];
    activityEvents.forEach((name) => window.addEventListener(name, markActive, { passive: true }));
    const visibility = () => document.hidden ? setIdle(true) : markActive();
    document.addEventListener("visibilitychange", visibility);
    markActive();
    return () => {
      window.clearTimeout(idleTimer);
      activityEvents.forEach((name) => window.removeEventListener(name, markActive));
      document.removeEventListener("visibilitychange", visibility);
    };
  }, []);

  // Eyes track the cursor and the whole cell leans toward it. Pointer events are
  // coalesced into one style write per frame.
  useEffect(() => {
    let frame = 0;
    let pointer: { x: number; y: number } | null = null;
    const apply = () => {
      frame = 0;
      const stage = stageRef.current;
      if (!stage || !pointer || idle) return;
      const bounds = stage.getBoundingClientRect();
      const x = Math.max(-1, Math.min(1, (pointer.x - (bounds.left + bounds.width / 2)) / (bounds.width / 2)));
      const y = Math.max(-1, Math.min(1, (pointer.y - (bounds.top + bounds.height * .43)) / (bounds.height / 2)));
      stage.style.setProperty("--mascot-look-x", `${x * 7}px`);
      stage.style.setProperty("--mascot-look-y", `${y * 5}px`);
      stage.style.setProperty("--mascot-lean", `${x * 4}deg`);
      stage.style.setProperty("--mascot-shift", `${x * 6}px`);
    };
    const followCursor = (event: PointerEvent) => { pointer = { x: event.clientX, y: event.clientY }; if (!frame) frame = window.requestAnimationFrame(apply); };
    window.addEventListener("pointermove", followCursor, { passive: true });
    return () => { window.removeEventListener("pointermove", followCursor); window.cancelAnimationFrame(frame); };
  }, [idle]);

  useEffect(() => {
    const encourage = () => {
      setMessage(linesRef.current[messageIndex.current % linesRef.current.length]);
      messageIndex.current += 1;
      window.clearTimeout(messageTimer.current);
      messageTimer.current = window.setTimeout(() => setMessage(null), 12_000);
    };
    const welcomeTimer = window.setTimeout(encourage, 1_200);
    const affirmationTimer = window.setInterval(() => { if (!document.hidden) encourage(); }, 300_000);
    return () => { window.clearTimeout(welcomeTimer); window.clearTimeout(messageTimer.current); window.clearTimeout(cheerTimer.current); window.clearInterval(affirmationTimer); };
  }, []);

  function saySomething() {
    if (idle) return;
    setMessage(linesRef.current[messageIndex.current % linesRef.current.length]);
    messageIndex.current += 1;
    window.clearTimeout(messageTimer.current);
    messageTimer.current = window.setTimeout(() => setMessage(null), 12_000);
    // A new key restarts the jump and sparkle burst even on rapid clicks.
    setCheering((value) => value + 1);
    window.clearTimeout(cheerTimer.current);
    cheerTimer.current = window.setTimeout(() => setCheering(0), 1_100);
  }

  return <section className={`dashboard-mascot-companion dashboard-card mascot-theme-${mascot.id} ${idle ? "is-idle" : "is-active"} ${cheering ? "is-cheering" : ""}`} aria-label="Lab companion">
      <header><span><Sparkles/><span><strong>Your lab companion</strong><small>{idle ? "Sleeping while you are away" : "Awake and following your work"}</small></span></span><span className="companion-header-actions"><button onClick={onTogglePicker}>{mascot.emoji} Change</button><button className="companion-flip-button" onClick={onHide} title="Hide your lab companion" aria-label="Hide lab companion"><X/> Hide</button></span></header>
      <div className="mascot-companion-stage" ref={stageRef} onClick={saySomething} role="button" tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter" || event.key === " ") saySomething(); }} aria-label={`${mascot.label}. Click for encouragement.`}>
        <span className="mascot-aura" aria-hidden="true"/>
        <span className="mascot-orbit orbit-a" aria-hidden="true"><i/></span><span className="mascot-orbit orbit-b" aria-hidden="true"><i/></span>
        <span className="mascot-bubbles" aria-hidden="true">{Array.from({ length: 10 }, (_, index) => <i key={index} style={{ "--bubble": index } as React.CSSProperties}/>)}</span>
        {(message || idle) && <div key={idle ? "sleep" : message} className={`mascot-speech-bubble ${idle ? "sleep-message" : ""}`} aria-live="polite">{idle ? "Shh… catching a few Zs." : message}</div>}
        {idle && <div className="mascot-zzz" aria-hidden="true"><span>Z</span><span>z</span><span>z</span></div>}
        {cheering > 0 && <span key={cheering} className="mascot-sparkles" aria-hidden="true">{Array.from({ length: 12 }, (_, index) => <i key={index} style={{ "--spark": index } as React.CSSProperties}/>)}</span>}
        <div className="mascot-lean">
          <div key={cheering || "rest"} className={`lab-cell-mascot mascot-${mascot.id}`} aria-hidden="true">
            <span className="mascot-body-detail detail-one"/><span className="mascot-body-detail detail-two"/><span className="mascot-body-detail detail-three"/>
            {mascot.id === "bacteria" && <><i className="bacteria-flagellum flagellum-one"/><i className="bacteria-flagellum flagellum-two"/><i className="bacteria-spot spot-one"/><i className="bacteria-spot spot-two"/></>}
            {mascot.id === "yeast" && <><i className="yeast-bud"/><i className="yeast-nucleus"/></>}
            {mascot.id === "insect" && <><i className="insect-wing wing-left"/><i className="insect-wing wing-right"/><i className="insect-antenna antenna-left"/><i className="insect-antenna antenna-right"/></>}
            {mascot.id === "mammalian" && <><i className="mammalian-lobe lobe-one"/><i className="mammalian-lobe lobe-two"/><i className="mammalian-nucleus"/></>}
            <span className="mascot-face"><i className="mascot-eye"><b/></i><i className="mascot-eye"><b/></i><i className="mascot-cheek cheek-left"/><i className="mascot-cheek cheek-right"/><i className="mascot-mouth"/></span>
          </div>
          <div className="mascot-ground-shadow" aria-hidden="true"/>
        </div>
        <small className="mascot-hint">Click me for a pep talk</small>
      </div>
      <footer><span><strong>{mascot.label}</strong><small>{mascot.caption}</small></span><span className={`mascot-presence ${idle ? "away" : "online"}`}><i/>{idle ? "AFK · asleep" : "Active · awake"}</span></footer>
      {pickerOpen && <div className="mascot-picker companion-mascot-picker"><button className="mascot-picker-close" onClick={onTogglePicker} aria-label="Close mascot picker"><X/></button>{mascots.map((item) => <button key={item.id} className={item.id === mascotId ? "selected" : ""} onClick={() => onChoose(item.id)}><span>{item.emoji}</span><small>{item.label}</small></button>)}</div>}
  </section>;
}

type LibraryVector = {
  id: string;
  name: string;
  lengthBp: number;
  featureCount: number;
  insertName: string;
  projectCount: number;
  projects: { proteinId: string; proteinName: string }[];
  updatedAt: string;
  isStandard?: boolean;
};

/**
 * The back of the library tile: a row per library with its count and an Open
 * button for that tab, then the folder both libraries are saved in.
 */
function LibrarySummary({ shelves, storage, onOpen, onReveal, onChange }: {
  shelves: { tab: LibraryTab; icon: typeof Disc3; count: number | null; failed: boolean; detail: string }[];
  storage: LibraryStorage;
  onOpen: (tab: LibraryTab) => void;
  onReveal: () => void;
  onChange: () => void;
}) {
  return <div className="library-card-body">
    {shelves.map(({ tab, icon: Icon, count, failed, detail }) => <article key={tab} className="library-card-shelf">
      <Icon/>
      <span>
        <strong>{failed ? `${tab === "vectors" ? "Vector" : "Protein"} library unavailable` : libraryCount(tab, count)}</strong>
        <small>{failed ? "Start the local engine to read it." : detail}</small>
      </span>
      <Button size="sm" variant="outline" onClick={() => onOpen(tab)} aria-label={`Open the ${tab} tab`}>Open <ArrowRight/></Button>
    </article>)}
    <div className={`library-card-storage ${storage.missing ? "warning" : ""}`}>
      <HardDrive/>
      <span>
        <small>{storage.missing ? `${storage.missing} was not found; saving in the default folder` : storage.folder ? "Library folder" : "Saved in the project database once the engine connects"}</small>
        {/* Long paths wrap at their separators rather than mid-name. */}
        {storage.folder && <strong title={storage.database}>{storage.folder.split(/(?<=[/\\])/).map((part, index) => <Fragment key={index}>{part}<wbr/></Fragment>)}</strong>}
      </span>
      {(storage.canReveal || storage.canChange) && <span className="library-card-storage-actions">
        {storage.canReveal && <Button size="sm" variant="outline" onClick={onReveal}><FolderSearch/> Open folder</Button>}
        {storage.canChange && <Button size="sm" variant="ghost" onClick={onChange}><FolderCog/> Change location…</Button>}
      </span>}
    </div>
  </div>;
}

// Time the workspace has actually been open and visible, accumulated locally.
// Nothing else in Protein Lab records duration, so this is measured rather
// than inferred from saved jobs.
function useWorkspaceHours() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const key = "protein-labs-workspace-seconds";
    let total = 0;
    try { total = Number(window.localStorage.getItem(key)) || 0; } catch { total = 0; }
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setSeconds(total);
    const timer = window.setInterval(() => {
      if (document.hidden) return;
      total += 30;
      setSeconds(total);
      try { window.localStorage.setItem(key, String(total)); } catch { /* Counting must not break the dashboard. */ }
    }, 30_000);
    return () => window.clearInterval(timer);
  }, []);
  return seconds / 3600;
}

function jobStatusLabel(status: string) {
  return status === "complete" ? "Complete" : status === "in_progress" ? "In progress" : "Ready";
}

function relativeTime(value: string, now: Date) {
  const then = new Date(value).getTime();
  if (!Number.isFinite(then)) return "recently";
  const minutes = Math.max(0, Math.round((now.getTime() - then) / 60000));
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} minute${minutes === 1 ? "" : "s"} ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? "" : "s"} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? "" : "s"} ago`;
}

function LiveClock() {
  const [now, setNow] = useState(new Date());
  useEffect(() => { const timer = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(timer); }, []);
  return <div className="dashboard-clock"><Clock3/><span><strong>{now.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</strong><small>{now.toLocaleDateString([], { weekday: "long", month: "long", day: "numeric", year: "numeric" })}</small></span></div>;
}

const tileAccents = ["#36c7a5", "#58a6ff", "#a78bfa", "#ef765f", "#f2b84b", "#ed68d7"];
const residueClasses: [RegExp, string][] = [[/[AVLIMFWC]/, "#f2b84b"], [/[KRH]/, "#58a6ff"], [/[DE]/, "#ef765f"], [/[STNQY]/, "#36c7a5"], [/[GP]/, "#a78bfa"]];

function ProjectTile({ protein, index, complete, total, linked, onOpen }: { protein: ProteinRecord; index: number; complete: number; total: number; linked: boolean; onOpen: () => void }) {
  const accent = tileAccents[hashString(protein.id) % tileAccents.length];
  const progress = total ? complete / total : 0;
  const barcode = useMemo(() => sampleResidues(protein.sequence, 64), [protein.sequence]);
  return <button className="project-tile" style={{ "--tile-accent": accent, "--stagger": index } as React.CSSProperties} onClick={onOpen}>
    <span className="project-tile-top">
      <span className="dashboard-project-avatar">{projectEmoji(protein)}</span>
      <span className="project-tile-ring" title={`${complete} of ${total} jobs complete`}><svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="16" pathLength="100"/><circle cx="20" cy="20" r="16" pathLength="100" style={{ strokeDasharray: `${Math.max(progress * 100, .001)} 100` }}/></svg><b>{Math.round(progress * 100)}%</b></span>
    </span>
    <strong>{protein.name}</strong>
    <small>{protein.sequence.length} aa · {protein.organism || "Organism not entered"}</small>
    <span className="project-tile-barcode" aria-hidden="true">{barcode.map((color, residue) => <i key={residue} style={{ background: color }}/>)}</span>
    <span className="project-tile-foot"><em>{complete}/{total} jobs</em>{linked && <em className="linked"><GitBranch/> In a tree</em>}<time>{formatRelative(protein.updatedAt ?? protein.createdAt)}</time><ArrowRight/></span>
  </button>;
}

/* Draws a saved tree as a left-to-right branch diagram: the root on the left,
   each relationship one generation further right. With no tree it draws a
   decorative sample so the empty state still previews the feature. */
function TreePreview({ tree, names }: { tree?: ProjectTree; names?: ProteinRecord[] }) {
  // Labelled diagrams compress the generations to leave room for names on the right.
  const span = names ? 74 : 96;
  const layout = useMemo(() => {
    const links = tree ? tree.branches.map((link) => [link.fromProjectId, link.toProjectId] as const) : [["r", "a"], ["r", "b"], ["a", "c"], ["a", "d"]] as const;
    const root = tree?.rootProjectId ?? "r";
    const depth = new Map<string, number>([[root, 0]]);
    const queue = [root];
    while (queue.length) { const current = queue.shift()!; for (const [from, to] of links) if (from === current && !depth.has(to)) { depth.set(to, depth.get(current)! + 1); queue.push(to); } }
    for (const [from, to] of links) { if (!depth.has(from)) depth.set(from, 1); if (!depth.has(to)) depth.set(to, depth.get(from)! + 1); }
    const columns = new Map<number, string[]>();
    depth.forEach((level, id) => columns.set(level, [...(columns.get(level) ?? []), id]));
    const maxDepth = Math.max(1, ...columns.keys());
    const position = new Map<string, { x: number; y: number }>();
    columns.forEach((ids, level) => ids.forEach((id, row) => position.set(id, { x: 12 + level * (span / maxDepth), y: 50 * (row + 1) / (ids.length + 1) })));
    return { root, nodes: [...position], edges: links.map(([from, to]) => [position.get(from)!, position.get(to)!] as const) };
  }, [tree, span]);
  return <svg className={`tree-preview ${names ? "labelled" : ""}`} viewBox={names ? "0 0 180 50" : "0 0 120 50"} aria-hidden="true">
    {layout.edges.map(([from, to], index) => <path key={index} pathLength={1} style={{ "--edge": index } as React.CSSProperties} d={`M${from.x},${from.y} C${(from.x + to.x) / 2},${from.y} ${(from.x + to.x) / 2},${to.y} ${to.x},${to.y}`}/>)}
    {layout.nodes.map(([id, point], index) => <circle key={id} className={id === layout.root ? "root" : ""} style={{ "--node": index } as React.CSSProperties} cx={point.x} cy={point.y} r={id === layout.root ? 5 : 3.6}/>)}
    {names && layout.nodes.map(([id, point], index) => <text key={id} style={{ "--node": index } as React.CSSProperties} x={id === layout.root ? point.x - 5 : point.x + 5.5} y={id === layout.root ? point.y - 8 : point.y + 1.3}>{truncate(projectName(names, id), 22)}</text>)}
  </svg>;
}

function companionCheers(projects: number, completed: number, total: number, upcoming: number) {
  const lines: string[] = [];
  if (completed) lines.push(`${completed} workflow job${completed === 1 ? "" : "s"} complete. That’s real progress!`);
  if (total > completed) lines.push(`${total - completed} job${total - completed === 1 ? "" : "s"} waiting. Want to pick one up?`);
  if (projects) lines.push(`${projects} protein project${projects === 1 ? "" : "s"} in the lab. I’m keeping an eye on them.`);
  if (upcoming) lines.push(`You have ${upcoming} timeline item${upcoming === 1 ? "" : "s"} coming up. We’ve got this.`);
  return lines;
}
function truncate(value: string, length: number) { return value.length > length ? `${value.slice(0, length - 1)}…` : value; }
function hashString(value: string) { let hash = 0; for (let index = 0; index < value.length; index += 1) hash = (hash * 31 + value.charCodeAt(index)) >>> 0; return hash; }
function sampleResidues(sequence: string, count: number) { if (!sequence) return []; const length = Math.min(count, sequence.length); return Array.from({ length }, (_, index) => { const residue = sequence[Math.floor(index * sequence.length / length)].toUpperCase(); return residueClasses.find(([pattern]) => pattern.test(residue))?.[1] ?? "#9aa4a8"; }); }

function greeting(date: Date) { const hour = date.getHours(); return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good night"; }
function projectEmoji(protein: ProteinRecord) { const text = `${protein.organism} ${protein.expressionSystem}`.toLowerCase(); return text.includes("yeast") || text.includes("saccharomyces") || text.includes("pichia") ? "🍞" : text.includes("mammal") || text.includes("hek") || text.includes("cho") ? "🧫" : text.includes("coli") || text.includes("bacter") ? "🦠" : "🧬"; }
function formatRelative(value?: string) { if (!value) return "Saved locally"; const date = new Date(value); if (Number.isNaN(date.valueOf())) return "Saved locally"; const days = Math.max(0, Math.floor((Date.now() - date.valueOf()) / 86400000)); return days === 0 ? "Today" : days === 1 ? "Yesterday" : `${days} days ago`; }
function dateKey(date: Date) { const year = date.getFullYear(); const month = String(date.getMonth() + 1).padStart(2, "0"); const day = String(date.getDate()).padStart(2, "0"); return `${year}-${month}-${day}`; }
function formatCalendarDate(value: string) { const [year, month, day] = value.split("-").map(Number); return new Date(year, month - 1, day).toLocaleDateString([], { weekday: "short", month: "short", day: "numeric" }); }
function shiftMonth(value: Date, amount: number) { return new Date(value.getFullYear(), value.getMonth() + amount, 1); }
function calendarCells(month: Date) { const first = new Date(month.getFullYear(), month.getMonth(), 1); const start = new Date(month.getFullYear(), month.getMonth(), 1 - first.getDay()); return Array.from({ length: 42 }, (_, index) => { const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index); return { date, outside: date.getMonth() !== month.getMonth() }; }); }
function stage(id: TimelineStage) { return timelineStages.find((value) => value.id === id) ?? timelineStages[1]; }
function projectName(proteins: ProteinRecord[], id: string) { return proteins.find((protein) => protein.id === id)?.name || "General lab work"; }
function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((value) => value[0]?.toUpperCase()).join("") || "PL"; }
function store(key: string, value: unknown) { localStorage.setItem(key, JSON.stringify(value)); window.dispatchEvent(new CustomEvent(`${key}-changed`, { detail: value })); }
function readStored<T>(key: string, fallback: T): T { try { const value = localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; } }
function safeFilename(value: string) { return value.trim().replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "protein-project"; }
function downloadText(filename: string, content: string) { const url = URL.createObjectURL(new Blob([content], { type: "application/json" })); const anchor = document.createElement("a"); anchor.href = url; anchor.download = filename; anchor.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000); }
