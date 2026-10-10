"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import {
  Activity, ArrowRight, BarChart3, CalendarDays, ChevronLeft, ChevronRight,
  Clock3, Dna, ExternalLink, FlaskConical, FolderKanban, GitBranch, Pencil, Plus,
  Database, FileText, RotateCcw, RotateCw, Search, Send, Sparkles, Trash2, UserPlus, Users, X,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProteinBundle, ProteinRecord } from "@/lib/protein-labs-api";
import { proteinLabsApi } from "@/lib/protein-labs-api";
import type { SavedProjectTree } from "@/lib/project-trees";
import { projectTreeStats } from "@/lib/project-trees";

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

export function AppDashboard({ proteins, trees, onOpenProject, onOpenReports, onProjects, onTrees, onCreate }: { proteins: ProteinRecord[]; trees: SavedProjectTree[]; onOpenProject: (id: string) => void; onOpenReports: (id: string) => void; onProjects: () => void; onTrees: () => void; onCreate: () => void }) {
  const [now, setNow] = useState(new Date());
  const [bundles, setBundles] = useState<ProteinBundle[]>([]);
  const [mascotId, setMascotId] = useState("bacteria");
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
    queueMicrotask(() => {
      if (savedMascot && mascots.some((item) => item.id === savedMascot)) setMascotId(savedMascot);
      setProfile(readStored("protein-labs-profile", defaultProfile));
      setMembers(readStored<TeamMember[]>("protein-labs-team", []));
      setEvents(readStored<TimelineEvent[]>("protein-labs-purification-timeline", []));
    });
  }, []);
  useEffect(() => {
    let active = true;
    Promise.all(proteins.map((protein) => proteinLabsApi.getProtein(protein.id))).then((values) => { if (active) setBundles(values); }).catch(() => undefined);
    return () => { active = false; };
  }, [proteins]);

  const mascot = mascots.find((item) => item.id === mascotId) ?? mascots[0];
  const roots = proteins;
  const treeStats = projectTreeStats(trees);
  const activeProjectId = selectedProject || roots[0]?.id || "";
  const purifiedRoots = useMemo(() => new Set(bundles.filter((bundle) => bundle.projectJobs.some((job) => job.status === "complete" && ["purification-workflow", "chromatogram-studio", "gel-analysis"].includes(job.appType))).map((bundle) => bundle.protein.id)).size, [bundles]);
  const completedJobs = bundles.flatMap((bundle) => bundle.projectJobs).filter((job) => job.status === "complete").length;
  const totalJobs = bundles.reduce((sum, bundle) => sum + bundle.projectJobs.length, 0);
  const projectIdsInTrees = new Set(trees.flatMap((tree) => [tree.rootProjectId, ...tree.relationships.flatMap((link) => [link.fromProjectId, link.toProjectId])]));
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
  const residuesPlanned = proteins.reduce((sum, protein) => sum + protein.sequence.length, 0);
  const cells = useMemo(() => calendarCells(calendarMonth), [calendarMonth]);
  const selectedEvents = events.filter((event) => event.date === selectedDate).sort((a, b) => a.title.localeCompare(b.title));

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

  return <main className="suite-dashboard">
    <div className="dashboard-shell-grid">
    <DashboardMascot
      mascotId={mascotId}
      pickerOpen={picker}
      onTogglePicker={() => setPicker((value) => !value)}
      onChoose={chooseMascot}
      cheers={companionCheers(roots.length, completedJobs, totalJobs, upcoming.length)}
      stats={{
        purified: purifiedRoots,
        completedJobs,
        openJobs: Math.max(0, totalJobs - completedJobs),
        totalJobs,
        projects: proteins.length,
        residues: residuesPlanned,
        hours: workspaceHours,
        upcoming: upcoming.length,
        nextItem: upcoming[0] ? `${upcoming[0].title} · ${formatCalendarDate(upcoming[0].date)}` : "",
        trees: treeStats.trees,
        branches: treeStats.branches,
        linked: projectIdsInTrees.size,
        collaborators: members.length,
      }}
    />
    <div className="dashboard-content-column">
    <section className="dashboard-welcome dashboard-card">
      <div className="dashboard-greeting"><div><span className="eyebrow">PROTEIN LAB · LOCAL WORKSPACE</span><h1>{greeting(now)}, {profile.name || "Researcher"}.</h1><p>Plan the next experiment, review active work, and keep the purification team synchronized.</p></div></div>
      <div className="dashboard-welcome-actions"><LiveClock/><Button variant="outline" size="sm" onClick={openProfile}><Pencil/> Profile</Button></div>
    </section>

    {notice && <div className="dashboard-notice"><Sparkles/><span>{notice}</span><button onClick={() => setNotice("")}><X/></button></div>}

    <div className="dashboard-board">
      <article className="dashboard-card dashboard-project-overview-card">
        <CardHeader icon={FolderKanban} title="Projects" subtitle={`${roots.length} local protein project${roots.length === 1 ? "" : "s"} · ${completedJobs}/${totalJobs} workflow jobs complete`}><div><Button variant="outline" size="sm" onClick={onProjects}>View gallery <ArrowRight/></Button><Button size="sm" onClick={onCreate}><Plus/> New project</Button></div></CardHeader>
        <div className="project-tile-grid">
          {roots.map((protein, index) => { const projectBundle = bundles.find((value) => value.protein.id === protein.id); return <ProjectTile key={protein.id} protein={protein} index={index} complete={projectBundle?.projectJobs.filter((job) => job.status === "complete").length ?? 0} total={projectBundle?.projectJobs.length ?? 0} linked={projectIdsInTrees.has(protein.id)} onOpen={() => onOpenProject(protein.id)}/>; })}
          {!roots.length && <button className="project-tile project-tile-new" onClick={onCreate}><span><Plus/></span><strong>Create your first project</strong><small>Start from an amino-acid sequence</small></button>}
        </div>
      </article>

      <article className="dashboard-card dashboard-tree-overview-card">
        <CardHeader icon={GitBranch} title="Project trees" subtitle="How your constructs relate and what changed"><Button variant="outline" size="sm" onClick={onTrees}>Open trees <ArrowRight/></Button></CardHeader>
        <button className="tree-stat-strip" onClick={onTrees}><span><strong>{treeStats.trees}</strong><small>Tree{treeStats.trees === 1 ? "" : "s"}</small></span><span><strong>{treeStats.branches}</strong><small>Branch{treeStats.branches === 1 ? "" : "es"}</small></span><span><strong>{projectIdsInTrees.size}</strong><small>Linked project{projectIdsInTrees.size === 1 ? "" : "s"}</small></span></button>
        {trees[0] && <button className="tree-feature" onClick={onTrees}><TreePreview tree={trees[0]} names={roots}/><span><strong>{trees[0].name}</strong><small>{trees[0].relationships.length} branch{trees[0].relationships.length === 1 ? "" : "es"} from {projectName(roots, trees[0].rootProjectId)}</small></span></button>}
        <div className="tree-tile-list">{trees.length ? trees.slice(1).map((tree, index) => { const projectIds = new Set([tree.rootProjectId, ...tree.relationships.flatMap((link) => [link.fromProjectId, link.toProjectId])]); return <button key={tree.id} style={{ "--stagger": index } as React.CSSProperties} onClick={onTrees}><TreePreview tree={tree}/><span><strong>{tree.name}</strong><small>Root · {projectName(roots, tree.rootProjectId)}</small><small>{projectIds.size} projects · {tree.relationships.length} branch{tree.relationships.length === 1 ? "" : "es"}</small></span><ArrowRight/></button>; }) : <button className="tree-empty" onClick={onTrees}><TreePreview/><span><strong>Grow your first project tree</strong><small>Link construct, vector, host, or process changes between projects.</small></span><ArrowRight/></button>}</div>
      </article>

      <article className="dashboard-card dashboard-current-job-card">
        <CardHeader icon={Activity} title="Current job" subtitle={currentJob ? `Last worked on ${relativeTime(currentJob.job.updatedAt, now)}` : "Nothing in progress yet"}>{currentJob && <Button variant="ghost" size="sm" onClick={() => onOpenProject(currentJob.project.id)}>Resume <ArrowRight/></Button>}</CardHeader>
        {currentJob ? <button className="current-job-body" onClick={() => onOpenProject(currentJob.project.id)}>
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
      </article>

      <article className="dashboard-card dashboard-calendar-card">
        <CardHeader icon={CalendarDays} title="Purification timeline" subtitle="Schedule expression, columns, and quality control"><button className="calendar-today" onClick={() => { setCalendarMonth(new Date(now.getFullYear(), now.getMonth(), 1)); setSelectedDate(dateKey(now)); }}>Today</button></CardHeader>
        <div className="calendar-toolbar"><button onClick={() => setCalendarMonth(shiftMonth(calendarMonth, -1))}><ChevronLeft/></button><strong>{calendarMonth.toLocaleDateString([], { month: "long", year: "numeric" })}</strong><button onClick={() => setCalendarMonth(shiftMonth(calendarMonth, 1))}><ChevronRight/></button></div>
        <div className="purification-calendar"><div className="calendar-weekdays">{["S", "M", "T", "W", "T", "F", "S"].map((day, index) => <span key={`${day}-${index}`}>{day}</span>)}</div><div className="calendar-days">{cells.map((cell) => { const key = dateKey(cell.date); const dayEvents = events.filter((event) => event.date === key); return <button key={key} className={`${cell.outside ? "outside" : ""} ${key === dateKey(now) ? "today" : ""} ${key === selectedDate ? "selected" : ""}`} onClick={() => setSelectedDate(key)}><span>{cell.date.getDate()}</span><i>{dayEvents.slice(0, 3).map((event) => <b key={event.id} style={{ background: stage(event.stage).color }}/>)}</i></button>; })}</div></div>
        <div className="timeline-editor"><div className="timeline-date"><strong>{formatCalendarDate(selectedDate)}</strong><small>{selectedEvents.length} planned item{selectedEvents.length === 1 ? "" : "s"}</small></div><div className="timeline-add"><input value={eventTitle} onChange={(event) => setEventTitle(event.target.value)} onKeyDown={(event) => { if (event.key === "Enter") addEvent(); }} placeholder="e.g. Run Superdex 200 Increase"/><select value={activeProjectId} onChange={(event) => setSelectedProject(event.target.value)}>{roots.length ? roots.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>) : <option value="">General lab work</option>}</select><select value={eventStage} onChange={(event) => setEventStage(event.target.value as TimelineStage)}>{timelineStages.map((value) => <option key={value.id} value={value.id}>{value.label}</option>)}</select><button onClick={addEvent}><Plus/></button></div><div className="timeline-items">{selectedEvents.map((event) => <div key={event.id}><i style={{ background: stage(event.stage).color }}/><span><strong>{event.title}</strong><small>{stage(event.stage).label} · {projectName(roots, event.projectId)}</small></span><button onClick={() => removeEvent(event.id)}><X/></button></div>)}{!selectedEvents.length && <p>Select a day and add the next purification milestone.</p>}</div></div>
      </article>

      <article className="dashboard-card dashboard-reports-card">
        <CardHeader icon={FileText} title="Reports" subtitle="Publication-quality records to print or send to a client"/>
        <div className="reports-card-body">
          <label className="dashboard-project-select">Project<select value={activeProjectId} onChange={(event) => setSelectedProject(event.target.value)}>{roots.length ? roots.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>) : <option value="">No projects yet</option>}</select></label>
          <ul className="reports-card-pages">
            {["Protein properties", "Transformation and expression", "Cell lysis and clarification", "Affinity capture", "Affinity-tag cleavage", "Subtractive cleanup", "SEC polishing", "Quality control and storage"].map((page) => <li key={page}><i/>{page}</li>)}
          </ul>
          <Button className="wide" disabled={!activeProjectId} onClick={() => onOpenReports(activeProjectId)}><FileText/> Open the report</Button>
        </div>
      </article>

      <article className="dashboard-card dashboard-team-card">
        <CardHeader icon={Users} title="Team members" subtitle="Prepare project handoffs for collaborators"><Button variant="ghost" size="icon" onClick={() => setMemberOpen(true)} aria-label="Add team member"><UserPlus/></Button></CardHeader>
        <label className="dashboard-project-select">Project to share<select value={activeProjectId} onChange={(event) => setSelectedProject(event.target.value)}>{roots.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>)}</select></label>
        <div className="team-list"><div className="team-member owner"><span>{initials(profile.name)}</span><div><strong>{profile.name || "Researcher"}</strong><small>{profile.googleEmail || "Local workspace owner"}</small></div><em>Owner</em></div>{members.map((member) => <div className="team-member" key={member.id}><span>{initials(member.name)}</span><div><strong>{member.name}</strong><small>{member.email}</small></div><em>{member.role}</em><button title={`Share with ${member.name}`} onClick={() => void shareWith(member)}><Send/></button><button title={`Remove ${member.name}`} onClick={() => removeMember(member.id)}><Trash2/></button></div>)}{!members.length && <div className="team-empty"><Users/><span><strong>No collaborators yet</strong><small>Add a researcher, then create an email-ready project handoff.</small></span></div>}</div>
      </article>

      <VectorDatabaseCard onOpenProject={onOpenProject}/>

      <article className="dashboard-card dashboard-account-card">
        <CardHeader icon={Sparkles} title="AlphaFold access" subtitle="Use your Google-authenticated system browser"/>
        <div className="account-identity"><span className={profile.googleConnected ? "connected" : ""}>{profile.googleConnected ? "G" : mascot.emoji}</span><div><strong>{profile.googleConnected ? "Google browser link ready" : "Connect a Google account"}</strong><small>{profile.googleConnected ? profile.googleEmail || "Account selected in your browser" : "Your credentials stay with Google, not Protein Lab."}</small></div></div>
        {profile.googleConnected ? <><label className="dashboard-project-select">Sequence to prepare<select value={activeProjectId} onChange={(event) => setSelectedProject(event.target.value)}>{roots.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>)}</select></label><Button className="wide" onClick={() => void openAlphaFold()}><ExternalLink/> Copy FASTA & open AlphaFold</Button><button className="account-text-action" onClick={disconnectGoogle}>Disconnect browser link</button></> : <Button className="wide" onClick={connectGoogle}><ExternalLink/> Choose Google account</Button>}
        <p>AlphaFold Server remains a Google-hosted service. Protein Lab opens the official site and prepares the selected sequence; it never stores your Google password or authentication token.</p>
      </article>
    </div>
    </div>
    </div>

    <Dialog open={profileOpen} onOpenChange={setProfileOpen}><DialogContent className="dialog-panel"><DialogHeader><DialogTitle>Your Protein Lab profile</DialogTitle><DialogDescription>Choose how Protein Lab greets you and which Google account label appears on this computer.</DialogDescription></DialogHeader><label className="field">Preferred name<input autoFocus value={profileName} onChange={(event) => setProfileName(event.target.value)} placeholder="How should Protein Lab address you?"/></label><label className="field">Google account email <small>(optional display label)</small><input type="email" value={googleEmail} onChange={(event) => setGoogleEmail(event.target.value)} placeholder="researcher@institution.edu"/></label><div className="profile-google-status"><span className={profile.googleConnected ? "connected" : ""}/><strong>{profile.googleConnected ? "Browser sign-in configured" : "Google browser sign-in not configured"}</strong></div><DialogFooter><Button variant="outline" onClick={() => setProfileOpen(false)}>Cancel</Button><Button onClick={saveProfile}>Save profile</Button></DialogFooter></DialogContent></Dialog>

    <Dialog open={memberOpen} onOpenChange={setMemberOpen}><DialogContent className="dialog-panel"><DialogHeader><DialogTitle>Add a team member</DialogTitle><DialogDescription>Team details remain on this computer and are used to prepare project handoffs.</DialogDescription></DialogHeader><label className="field">Name<input autoFocus value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="Collaborator name"/></label><label className="field">Email<input type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="name@institution.edu"/></label><label className="field">Role<select value={memberRole} onChange={(event) => setMemberRole(event.target.value as TeamMember["role"])}><option>Member</option><option>Reviewer</option><option>Owner</option></select></label><DialogFooter><Button variant="outline" onClick={() => setMemberOpen(false)}>Cancel</Button><Button onClick={addMember}><UserPlus/> Add member</Button></DialogFooter></DialogContent></Dialog>
  </main>;
}

type CompanionStats = {
  purified: number; completedJobs: number; openJobs: number; totalJobs: number;
  projects: number; residues: number; hours: number; upcoming: number; nextItem: string;
  trees: number; branches: number; linked: number; collaborators: number;
};

function DashboardMascot({ mascotId, pickerOpen, onTogglePicker, onChoose, cheers, stats }: { mascotId: string; pickerOpen: boolean; onTogglePicker: () => void; onChoose: (id: string) => void; cheers: string[]; stats: CompanionStats }) {
  const [flipped, setFlipped] = useState(false);
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

  return <aside className="dashboard-mascot-column" aria-label="Lab mascot">
    <div className={`companion-flip ${flipped ? "is-flipped" : ""}`}>
    <div className={`companion-face companion-front dashboard-mascot-companion dashboard-card mascot-theme-${mascot.id} ${idle ? "is-idle" : "is-active"} ${cheering ? "is-cheering" : ""}`} aria-hidden={flipped}>
      <header><span><Sparkles/><span><strong>Your lab companion</strong><small>{idle ? "Sleeping while you are away" : "Awake and following your work"}</small></span></span><span className="companion-header-actions"><button onClick={onTogglePicker}>{mascot.emoji} Change</button><button className="companion-flip-button" onClick={() => setFlipped(true)} title="Show lab statistics"><RotateCw/> Stats</button></span></header>
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
    </div>
    <div className="companion-face companion-back dashboard-card" aria-hidden={!flipped}>
      <header><span><BarChart3/><span><strong>Lab statistics</strong><small>Everything this workspace has recorded</small></span></span><button className="companion-flip-button" onClick={() => setFlipped(false)} title="Back to your lab companion"><RotateCcw/> Companion</button></header>
      <div className="companion-stat-scroll">
        <div className="companion-headline-stats">
          <CompanionStat value={stats.purified} label="Proteins purified" detail="With completed purification or QC"/>
          <CompanionStat value={stats.completedJobs} label="Completed jobs" detail={`${stats.openJobs} still in progress`}/>
          <CompanionStat value={formatHours(stats.hours)} label="Hours in the workspace" detail="Counted while Protein Lab is open"/>
          <CompanionStat value={stats.upcoming} label="Upcoming timeline items" detail={stats.nextItem || "Nothing scheduled yet"}/>
        </div>
        <dl className="companion-stat-list">
          <div><dt>Projects</dt><dd>{stats.projects}</dd></div>
          <div><dt>Workflow jobs saved</dt><dd>{stats.totalJobs}</dd></div>
          <div><dt>Residues planned</dt><dd>{stats.residues.toLocaleString()}</dd></div>
          <div><dt>Project trees</dt><dd>{stats.trees}</dd></div>
          <div><dt>Tree branches</dt><dd>{stats.branches}</dd></div>
          <div><dt>Projects linked in trees</dt><dd>{stats.linked}</dd></div>
          <div><dt>Collaborators</dt><dd>{stats.collaborators}</dd></div>
          <div><dt>Average jobs per project</dt><dd>{stats.projects ? (stats.totalJobs / stats.projects).toFixed(1) : "—"}</dd></div>
        </dl>
        <p className="companion-stat-note">Counts come from the jobs saved in this workspace, so they grow as you complete real work.</p>
      </div>
    </div>
    </div>
  </aside>;
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
};

/**
 * Every vector saved anywhere in the workspace, with the construct it carries
 * and the projects using it. Vectors are catalogued when they are named and
 * saved in Expression vector design, so this is a workspace-wide view rather
 * than a per-project one.
 */
function VectorDatabaseCard({ onOpenProject }: { onOpenProject: (id: string) => void }) {
  const [vectors, setVectors] = useState<LibraryVector[]>([]);
  const [failed, setFailed] = useState(false);
  const [search, setSearch] = useState("");
  useEffect(() => {
    let active = true;
    proteinLabsApi.vectorLibrary()
      .then((value) => { if (active) setVectors(value.vectors as unknown as LibraryVector[]); })
      .catch(() => { if (active) setFailed(true); });
    return () => { active = false; };
  }, []);
  const needle = search.trim().toLowerCase();
  const shown = needle
    ? vectors.filter((vector) => [vector.name, vector.insertName, ...vector.projects.map((use) => use.proteinName)].join(" ").toLowerCase().includes(needle))
    : vectors;
  const linked = new Set(vectors.flatMap((vector) => vector.projects.map((use) => use.proteinId))).size;
  return <article className="dashboard-card dashboard-vector-card">
    <CardHeader
      icon={Database}
      title="Vector database"
      subtitle={vectors.length ? `${vectors.length} vector${vectors.length === 1 ? "" : "s"} across ${linked} project${linked === 1 ? "" : "s"}` : "Saved vectors appear here"}
    />
    <div className="vector-card-body">
      {vectors.length > 3 && <label className="vector-card-search"><Search/><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search vectors, inserts, or projects"/></label>}
      <div className="vector-card-list">
        {shown.map((vector) => <article key={vector.id}>
          <span>
            <strong>{vector.name}</strong>
            <small>{vector.lengthBp.toLocaleString()} bp · {vector.featureCount} annotations{vector.insertName ? ` · ${vector.insertName}` : ""}</small>
            <small className="vector-card-uses">{vector.projectCount} project{vector.projectCount === 1 ? "" : "s"}{vector.projects.length ? `: ${vector.projects.map((use) => use.proteinName).join(", ")}` : ""}</small>
          </span>
          {vector.projects[0] && <Button size="sm" variant="outline" onClick={() => onOpenProject(vector.projects[0].proteinId)}>Open <ArrowRight/></Button>}
        </article>)}
        {!shown.length && <div className="vector-card-empty">
          <Database/>
          <span>
            <strong>{failed ? "The vector database is unavailable" : vectors.length ? "No vector matched that search" : "No vectors saved yet"}</strong>
            <small>{failed ? "Start the local engine to read the catalogue." : "Name and save a vector in Expression vector design and it is catalogued here, with the construct inserted into it."}</small>
          </span>
        </div>}
      </div>
    </div>
  </article>;
}

function CompanionStat({ value, label, detail }: { value: number | string; label: string; detail: string }) {
  return <article className="companion-stat"><strong>{value}</strong><span>{label}</span><small>{detail}</small></article>;
}

function formatHours(hours: number) {
  if (hours < 1) return `${Math.round(hours * 60)}m`;
  return hours < 10 ? hours.toFixed(1) : String(Math.round(hours));
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
function TreePreview({ tree, names }: { tree?: SavedProjectTree; names?: ProteinRecord[] }) {
  // Labelled diagrams compress the generations to leave room for names on the right.
  const span = names ? 74 : 96;
  const layout = useMemo(() => {
    const links = tree ? tree.relationships.map((link) => [link.fromProjectId, link.toProjectId] as const) : [["r", "a"], ["r", "b"], ["a", "c"], ["a", "d"]] as const;
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

function CardHeader({ icon: Icon, title, subtitle, children }: { icon: typeof Dna; title: string; subtitle: string; children?: React.ReactNode }) { return <header className="dashboard-card-header"><span><Icon/><span><strong>{title}</strong><small>{subtitle}</small></span></span>{children}</header>; }
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
