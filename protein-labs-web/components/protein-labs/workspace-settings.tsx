"use client";

import { useEffect, useRef, useState } from "react";
import { ExternalLink, Sparkles, Trash2, UserPlus, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import type { ProteinRecord } from "@/lib/protein-labs-api";
import { readProfile, readTeam, subscribeStored, teamRoles, writeProfile, writeTeam, PROFILE_KEY, TEAM_KEY, type Profile, type TeamMember, type TeamRole } from "@/lib/workspace-profile";

export type SettingsSection = "profile" | "alphafold" | "collaborators";

const sections: { id: SettingsSection; label: string; hint: string }[] = [
  { id: "profile", label: "Profile", hint: "How Protein Lab greets you" },
  { id: "alphafold", label: "AlphaFold access", hint: "Through your system browser" },
  { id: "collaborators", label: "Collaborators", hint: "People you prepare handoffs for" },
];

const ALPHAFOLD_URL = "https://alphafoldserver.com/welcome";

/**
 * Everything about the person using this computer: their name, the Google
 * account their browser opens AlphaFold Server with, and the collaborators
 * they hand projects to. The dashboard used to carry all three as tiles and a
 * top-bar sign-in button; they belong here, out of the way of the science.
 */
export function WorkspaceSettings({ open, section, proteins, onOpenChange }: {
  open: boolean;
  section: SettingsSection;
  proteins: ProteinRecord[];
  onOpenChange: (open: boolean) => void;
}) {
  return <Dialog open={open} onOpenChange={onOpenChange}>
    {/* The section is the key, so choosing another Settings item while the
        dialog is open re-opens it on that section with what is stored now. */}
    <SettingsPanel key={section} section={section} proteins={proteins} onClose={() => onOpenChange(false)}/>
  </Dialog>;
}

function SettingsPanel({ section, proteins, onClose }: { section: SettingsSection; proteins: ProteinRecord[]; onClose: () => void }) {
  const [active, setActive] = useState<SettingsSection>(section);
  const [profile, setProfile] = useState<Profile>(readProfile);
  const [members, setMembers] = useState<TeamMember[]>(readTeam);
  const [notice, setNotice] = useState("");
  const [projectId, setProjectId] = useState("");
  const [memberName, setMemberName] = useState("");
  const [memberEmail, setMemberEmail] = useState("");
  const [memberRole, setMemberRole] = useState<TeamRole>("Member");
  const tabs = useRef<HTMLDivElement>(null);

  // Another window may be editing the same storage.
  useEffect(() => subscribeStored(PROFILE_KEY, () => setProfile(readProfile())), []);
  useEffect(() => subscribeStored(TEAM_KEY, () => setMembers(readTeam())), []);

  const project = proteins.find((protein) => protein.id === projectId) ?? proteins[0];

  function editProfile(change: Partial<Profile>) { const value = { ...profile, ...change }; setProfile(value); writeProfile(value); }
  function connectGoogle() {
    editProfile({ googleConnected: true });
    window.open(ALPHAFOLD_URL, "_blank", "noopener,noreferrer");
    setNotice("AlphaFold Server sign-in opened in your system browser. Protein Lab does not store your password or OAuth token.");
  }
  async function openAlphaFold() {
    if (project) {
      try { await navigator.clipboard.writeText(`>${project.name}\n${project.sequence}`); setNotice(`${project.name} was copied as FASTA. Paste it into AlphaFold Server.`); }
      catch { setNotice("AlphaFold Server opened, but clipboard access was unavailable."); }
    }
    window.open(ALPHAFOLD_URL, "_blank", "noopener,noreferrer");
  }
  function addMember() {
    if (!memberName.trim() || !memberEmail.trim()) { setNotice("Enter the collaborator's name and email address."); return; }
    const value: TeamMember = { id: crypto.randomUUID(), name: memberName.trim(), email: memberEmail.trim(), role: memberRole };
    const next = [...members, value];
    setMembers(next); writeTeam(next);
    setMemberName(""); setMemberEmail(""); setMemberRole("Member");
    setNotice(`${value.name} was added. The dashboard now shows a Team tile for preparing handoffs.`);
  }
  function removeMember(member: TeamMember) {
    const next = members.filter((value) => value.id !== member.id);
    setMembers(next); writeTeam(next);
    setNotice(next.length ? `${member.name} was removed.` : `${member.name} was removed. The Team tile is hidden again.`);
  }
  // The tab strip follows the menubar keyboard model: arrows move, Home and End jump.
  function moveTab(event: React.KeyboardEvent) {
    const keys: Record<string, number> = { ArrowRight: 1, ArrowLeft: -1 };
    const index = sections.findIndex((value) => value.id === active);
    const next = event.key === "Home" ? 0 : event.key === "End" ? sections.length - 1 : event.key in keys ? (index + keys[event.key] + sections.length) % sections.length : -1;
    if (next < 0) return;
    event.preventDefault();
    setActive(sections[next].id);
    queueMicrotask(() => tabs.current?.querySelector<HTMLButtonElement>('[aria-selected="true"]')?.focus());
  }

  return <DialogContent className="dialog-panel settings-dialog">
      <DialogHeader>
        <DialogTitle>Workspace settings</DialogTitle>
        <DialogDescription>Your name, AlphaFold Server access, and collaborators. All three are kept on this computer; Protein Lab never sends them anywhere.</DialogDescription>
      </DialogHeader>

      <div className="settings-tabs" role="tablist" aria-label="Settings sections" ref={tabs} onKeyDown={moveTab}>
        {sections.map((value) => <button key={value.id} role="tab" type="button" id={`settings-tab-${value.id}`} aria-controls={`settings-panel-${value.id}`} aria-selected={value.id === active} tabIndex={value.id === active ? 0 : -1} className={value.id === active ? "selected" : ""} onClick={() => setActive(value.id)}>
          <strong>{value.label}</strong><small>{value.hint}</small>
        </button>)}
      </div>

      <div className="settings-panel" role="tabpanel" id={`settings-panel-${active}`} aria-labelledby={`settings-tab-${active}`} tabIndex={-1}>
        {active === "profile" && <>
          <label className="field">Preferred name <small>(used in the dashboard greeting)</small>
            <input autoFocus value={profile.name} onChange={(event) => editProfile({ name: event.target.value })} placeholder="How should Protein Lab address you?"/>
          </label>
          <label className="field">Google account email <small>(optional display label)</small>
            <input type="email" value={profile.googleEmail} onChange={(event) => editProfile({ googleEmail: event.target.value })} placeholder="researcher@institution.edu"/>
          </label>
          <p className="settings-note">Protein Lab is a single-user offline notebook. The name is only used to greet you, and the address is only a label on the AlphaFold panel.</p>
        </>}

        {active === "alphafold" && <>
          <div className="settings-status"><span className={profile.googleConnected ? "connected" : ""}>{profile.googleConnected ? "G" : "—"}</span>
            <span><strong>{profile.googleConnected ? "Google browser link ready" : "Not connected"}</strong><small>{profile.googleConnected ? profile.googleEmail || "Account selected in your browser" : "Your credentials stay with Google, not Protein Lab"}</small></span>
          </div>
          {profile.googleConnected ? <>
            <label className="field">Sequence to prepare
              <select value={project?.id ?? ""} onChange={(event) => setProjectId(event.target.value)}>
                {proteins.length ? proteins.map((protein) => <option key={protein.id} value={protein.id}>{protein.name}</option>) : <option value="">No projects yet</option>}
              </select>
            </label>
            <div className="settings-actions">
              <Button disabled={!project} onClick={() => void openAlphaFold()}><ExternalLink/> Copy FASTA &amp; open AlphaFold</Button>
              <Button variant="outline" onClick={() => editProfile({ googleConnected: false })}>Disconnect browser link</Button>
            </div>
          </> : <div className="settings-actions"><Button onClick={connectGoogle}><ExternalLink/> Choose Google account</Button></div>}
          <p className="settings-note">AlphaFold Server remains a Google-hosted service. Protein Lab opens the official site in your system browser and prepares the selected sequence; it never stores your Google password or authentication token.</p>
        </>}

        {active === "collaborators" && <>
          <div className="settings-team-list">
            {members.map((member) => <div className="team-member" key={member.id}>
              <span>{initials(member.name)}</span>
              <div><strong>{member.name}</strong><small>{member.email}</small></div>
              <em>{member.role}</em>
              <button type="button" title={`Remove ${member.name}`} aria-label={`Remove ${member.name}`} onClick={() => removeMember(member)}><Trash2/></button>
            </div>)}
            {!members.length && <div className="team-empty"><Users/><span><strong>No collaborators yet</strong><small>Protein Lab works on its own. Add someone only when you need to send them a project; the dashboard then shows a Team tile for preparing the handoff.</small></span></div>}
          </div>
          <div className="settings-add-member">
            <label className="field">Name<input value={memberName} onChange={(event) => setMemberName(event.target.value)} placeholder="Collaborator name"/></label>
            <label className="field">Email<input type="email" value={memberEmail} onChange={(event) => setMemberEmail(event.target.value)} placeholder="name@institution.edu"/></label>
            <label className="field">Role<select value={memberRole} onChange={(event) => setMemberRole(event.target.value as TeamRole)}>{teamRoles.map((role) => <option key={role}>{role}</option>)}</select></label>
            <Button variant="outline" onClick={addMember}><UserPlus/> Add</Button>
          </div>
        </>}
      </div>

      {notice && <p className="settings-notice" aria-live="polite"><Sparkles/>{notice}</p>}
      <DialogFooter><Button onClick={onClose}>Close</Button></DialogFooter>
  </DialogContent>;
}

function initials(name: string) { return name.split(/\s+/).filter(Boolean).slice(0, 2).map((value) => value[0]?.toUpperCase()).join("") || "PL"; }
