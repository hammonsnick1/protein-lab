/**
 * The researcher's local identity and the collaborators they prepare project
 * handoffs for. Both live in this computer's browser storage: Protein Lab is
 * an offline notebook and never sends either anywhere. Settings is the one
 * place that edits them, and every screen reads them through here so a change
 * made in Settings reaches the dashboard without a reload.
 */
export type TeamRole = "Member" | "Reviewer" | "Owner";
export type TeamMember = { id: string; name: string; email: string; role: TeamRole };
export type Profile = { name: string; googleEmail: string; googleConnected: boolean };

export const PROFILE_KEY = "protein-labs-profile";
export const TEAM_KEY = "protein-labs-team";
export const teamRoles: TeamRole[] = ["Member", "Reviewer", "Owner"];
export const defaultProfile: Profile = { name: "Researcher", googleEmail: "", googleConnected: false };

/** Stored values come from an earlier release or a hand-edited file, so each field is checked. */
export function normalizeProfile(value: unknown): Profile {
  const record = value && typeof value === "object" ? value as Record<string, unknown> : {};
  return {
    name: typeof record.name === "string" ? record.name.trim() : "",
    googleEmail: typeof record.googleEmail === "string" ? record.googleEmail.trim() : "",
    googleConnected: record.googleConnected === true,
  };
}

export function normalizeTeam(value: unknown): TeamMember[] {
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry) => {
    const record = entry && typeof entry === "object" ? entry as Record<string, unknown> : null;
    if (!record) return [];
    const name = typeof record.name === "string" ? record.name.trim() : "";
    const email = typeof record.email === "string" ? record.email.trim() : "";
    if (!name && !email) return [];
    const role = teamRoles.find((value) => value === record.role) ?? "Member";
    return [{ id: typeof record.id === "string" && record.id ? record.id : `${email || name}`, name: name || email, email, role }];
  });
}

/** The name used in the greeting and on the owner row; never blank. */
export function displayName(profile: Profile) { return profile.name || defaultProfile.name; }

export function readStored<T>(key: string, fallback: T): T {
  try { const value = window.localStorage.getItem(key); return value ? JSON.parse(value) as T : fallback; } catch { return fallback; }
}

/** Writes the value and tells the other open screens, which re-read it. */
export function store(key: string, value: unknown) {
  try { window.localStorage.setItem(key, JSON.stringify(value)); } catch { /* A full or blocked store must not break the screen. */ }
  window.dispatchEvent(new CustomEvent(`${key}-changed`, { detail: value }));
}

export function readProfile(): Profile { return normalizeProfile(readStored<unknown>(PROFILE_KEY, null)); }
export function readTeam(): TeamMember[] { return normalizeTeam(readStored<unknown>(TEAM_KEY, null)); }
export function writeProfile(profile: Profile) { store(PROFILE_KEY, profile); }
export function writeTeam(members: TeamMember[]) { store(TEAM_KEY, members); }

/** Calls back whenever this key changes here or in another window. */
export function subscribeStored(key: string, handler: () => void) {
  const changed = `${key}-changed`;
  window.addEventListener(changed, handler);
  window.addEventListener("storage", handler);
  return () => { window.removeEventListener(changed, handler); window.removeEventListener("storage", handler); };
}
