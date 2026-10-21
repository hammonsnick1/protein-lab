// Pure helpers for the purified-protein library (HOM-159): search parameters,
// facets, status, storage location, dates, quantities, the event timeline and
// the add / edit form. No React and no `@/` imports, so `node --test` can load
// this module directly.

export type ProteinStatus = "stored" | "low" | "used_up" | "discarded";
export type EventType = "stored" | "thawed" | "aliquot_used" | "moved" | "discarded";

export type ProteinEvent = {
  id: string;
  eventType: EventType;
  aliquotsUsed: number;
  fromLocation: string;
  toLocation: string;
  notes: string;
  occurredAt: string;
  createdAt: string;
};

/** One purified batch, as the engine returns it (camelCase, HOM-158). */
export type LibraryProtein = {
  id: string;
  name: string;
  geneName: string;
  organism: string;
  constructName: string;
  tags: string[];
  purificationMethod: string;
  concentrationValue: number | null;
  concentrationUnit: string;
  yieldValue: number | null;
  yieldUnit: string;
  purityPercent: number | null;
  buffer: string;
  storageDate: string;
  storageTemperature: string;
  locationPath: string;
  freezer: string;
  shelf: string;
  rack: string;
  box: string;
  position: string;
  aliquotCount: number;
  aliquotVolume: number | null;
  aliquotUnit: string;
  status: ProteinStatus;
  notes: string;
  favorite: boolean;
  createdAt: string;
  updatedAt: string;
  events?: ProteinEvent[];
};

export type FacetKey = "temperature" | "location" | "status" | "method" | "tag";
export type Filters = Partial<Record<FacetKey, string[]>>;
export type FacetCounts = Partial<Record<FacetKey, { value: string; count: number }[]>>;

export const FACETS: { key: FacetKey; label: string }[] = [
  { key: "status", label: "Status" },
  { key: "temperature", label: "Temperature" },
  { key: "location", label: "Location" },
  { key: "method", label: "Method" },
  { key: "tag", label: "Tag" },
];

export const STATUS_META: Record<ProteinStatus, { label: string; tone: "ok" | "warn" | "empty" | "gone"; hint: string }> = {
  stored: { label: "Available", tone: "ok", hint: "Aliquots are in storage" },
  low: { label: "Low stock", tone: "warn", hint: "One aliquot or fewer left" },
  used_up: { label: "Used up", tone: "empty", hint: "No aliquots left" },
  discarded: { label: "Discarded", tone: "gone", hint: "Removed from storage" },
};

export const TEMPERATURES = ["-80 °C", "-20 °C", "4 °C", "LN2", "Room temperature"];
export const CONCENTRATION_UNITS = ["mg/mL", "µM", "mM", "µg/mL"];
export const YIELD_UNITS = ["mg", "µg", "g"];
export const VOLUME_UNITS = ["µL", "mL"];

export const LOCATION_LEVELS = [
  { key: "freezer", label: "Freezer" },
  { key: "shelf", label: "Shelf" },
  { key: "rack", label: "Rack" },
  { key: "box", label: "Box" },
  { key: "position", label: "Position" },
] as const;
export type LocationKey = (typeof LOCATION_LEVELS)[number]["key"];
export type LocationParts = Record<LocationKey, string>;

export const LOCATION_SEPARATOR = " › ";
const DAY_MS = 86_400_000;

/** Status facet values are stored keys; show them as the badge labels. */
export function facetValueLabel(key: FacetKey, value: string) {
  return key === "status" ? STATUS_META[value as ProteinStatus]?.label ?? value : value;
}

export function statusMeta(status: string) {
  return STATUS_META[status as ProteinStatus] ?? STATUS_META.stored;
}

/** Query string for GET /protein-library. Facet values repeat rather than being comma-joined. */
export function librarySearchParams({ query, filters, favorite, limit = 500 }: { query: string; filters: Filters; favorite?: boolean; limit?: number }) {
  const params = new URLSearchParams();
  if (query.trim()) params.set("q", query.trim());
  for (const { key } of FACETS) for (const value of filters[key] ?? []) params.append(key, value);
  if (favorite !== undefined) params.set("favorite", String(favorite));
  params.set("limit", String(limit));
  return params.toString();
}

export function toggleFilter(filters: Filters, key: FacetKey, value: string): Filters {
  const current = filters[key] ?? [];
  const next = current.includes(value) ? current.filter((entry) => entry !== value) : [...current, value];
  const copy = { ...filters };
  if (next.length) copy[key] = next; else delete copy[key];
  return copy;
}

export function activeFilterCount(filters: Filters) {
  return Object.values(filters).reduce((total, values) => total + (values?.length ?? 0), 0);
}

/**
 * Facet options as the sidebar shows them: the engine's counts, plus any value
 * the researcher has ticked that no longer matches, so it can still be unticked.
 */
export function facetOptions(counts: { value: string; count: number }[] | undefined, selected: string[] = []) {
  const options = [...(counts ?? [])];
  for (const value of selected) if (!options.some((option) => option.value.toLowerCase() === value.toLowerCase())) options.push({ value, count: 0 });
  return options;
}

/** "Freezer A › Shelf 2 › Rack B › Box 3". The position is kept out so the location facet groups by box. */
export function joinLocation(parts: Partial<LocationParts>) {
  return (["freezer", "shelf", "rack", "box"] as const).map((key) => (parts[key] ?? "").trim()).filter(Boolean).join(LOCATION_SEPARATOR);
}

/**
 * The storage location as breadcrumb steps. The structured fields win while
 * they agree with `locationPath`; once the path has moved elsewhere (a "moved"
 * event updates only the path) the path is split instead, so the breadcrumb
 * never shows a stale freezer.
 */
export function locationCrumbs(record: Pick<LibraryProtein, LocationKey | "locationPath">): { label: string; value: string }[] {
  const structured = LOCATION_LEVELS
    .map(({ key, label }) => ({ label, value: (record[key] ?? "").trim() }))
    .filter((crumb) => crumb.value);
  const path = (record.locationPath ?? "").trim();
  if (!path || path === joinLocation(record)) return structured;
  return path.split(/\s*(?:›|>|\/|\|)\s*/).filter(Boolean).map((value, index) => ({ label: LOCATION_LEVELS[index]?.label ?? "Place", value }));
}

export function locationText(record: Pick<LibraryProtein, LocationKey | "locationPath">) {
  return locationCrumbs(record).map((crumb) => crumb.value).join(LOCATION_SEPARATOR);
}

/** Whole calendar days from a date (YYYY-MM-DD or ISO) to `now`, in local time; null when unknown. */
export function daysSince(value: string, now: Date = new Date()) {
  const then = parseDay(value);
  if (!then) return null;
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  return Math.round((today.getTime() - then.getTime()) / DAY_MS);
}

export function storedAgo(value: string, now: Date = new Date()) {
  const days = daysSince(value, now);
  if (days === null) return "";
  if (days < 0) return days === -1 ? "Stored tomorrow" : `Stored in ${-days} days`;
  if (days === 0) return "Stored today";
  if (days === 1) return "Stored yesterday";
  return `Stored ${days} days ago`;
}

/** A short age for list cells: "today", "3 d", "5 mo", "2 y". */
export function shortAge(value: string, now: Date = new Date()) {
  const days = daysSince(value, now);
  if (days === null) return "";
  if (days <= 0) return "today";
  if (days < 60) return `${days} d`;
  if (days < 730) return `${Math.floor(days / 30.44)} mo`;
  return `${Math.floor(days / 365.25)} y`;
}

export function formatDay(value: string) {
  const day = parseDay(value);
  return day ? day.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" }) : "";
}

export function formatDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function parseDay(value: string) {
  if (!value) return null;
  const plain = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  const date = plain ? new Date(Number(plain[1]), Number(plain[2]) - 1, Number(plain[3])) : new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Up to three significant figures, without trailing zeros: 2.5, 0.125, 1,250. */
export function formatNumber(value: number | null | undefined) {
  if (value === null || value === undefined || !Number.isFinite(value)) return "";
  if (value === 0) return "0";
  const magnitude = Math.abs(value);
  const digits = magnitude >= 100 ? 0 : magnitude >= 10 ? 1 : magnitude >= 1 ? 2 : 3;
  return value.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function formatQuantity(value: number | null | undefined, unit: string) {
  const text = formatNumber(value);
  return text ? `${text} ${displayUnit(unit)}` : "";
}

/** The engine stores ASCII "uL"; show the micro sign. */
export function displayUnit(unit: string) {
  return (unit || "").replace(/^u(?=[LMgm])/, "µ");
}

/** Volume still in storage: aliquots left × aliquot volume, in mL once it passes 1 mL. */
export function remainingVolume(record: Pick<LibraryProtein, "aliquotCount" | "aliquotVolume" | "aliquotUnit">) {
  if (record.aliquotVolume === null || record.aliquotVolume === undefined) return "";
  const total = record.aliquotCount * record.aliquotVolume;
  const unit = displayUnit(record.aliquotUnit || "uL");
  if (unit === "µL" && total >= 1000) return formatQuantity(total / 1000, "mL");
  return formatQuantity(total, unit);
}

export function aliquotsText(count: number) {
  return count === 1 ? "1 aliquot" : `${count} aliquots`;
}

/** The timeline line for one event. */
export function eventSummary(event: Pick<ProteinEvent, "eventType" | "aliquotsUsed" | "fromLocation" | "toLocation">) {
  switch (event.eventType) {
    case "stored": return { title: "Stored", detail: event.toLocation || event.fromLocation || "" };
    case "thawed": return { title: "Thawed", detail: "" };
    case "aliquot_used": return { title: event.aliquotsUsed === 1 ? "Used 1 aliquot" : `Used ${event.aliquotsUsed} aliquots`, detail: "" };
    case "moved": return { title: "Moved", detail: [event.fromLocation, event.toLocation].filter(Boolean).join(" → ") };
    case "discarded": return { title: "Discarded", detail: "" };
    default: return { title: String(event.eventType).replace(/_/g, " "), detail: "" };
  }
}

export type SortKey = "updated" | "name" | "stored" | "aliquots";
export const SORTS: { key: SortKey; label: string }[] = [
  { key: "updated", label: "Recently changed" },
  { key: "stored", label: "Newest stored" },
  { key: "name", label: "Name" },
  { key: "aliquots", label: "Fewest aliquots" },
];

/** Favourites always lead; the rest follow the chosen order. */
export function sortProteins<T extends Pick<LibraryProtein, "name" | "favorite" | "updatedAt" | "storageDate" | "aliquotCount" | "status">>(records: T[], key: SortKey) {
  const rank = (record: T) => (record.status === "discarded" ? 1 : 0);
  const compare: Record<SortKey, (a: T, b: T) => number> = {
    updated: (a, b) => b.updatedAt.localeCompare(a.updatedAt),
    stored: (a, b) => (b.storageDate || "").localeCompare(a.storageDate || ""),
    name: (a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base", numeric: true }),
    aliquots: (a, b) => rank(a) - rank(b) || a.aliquotCount - b.aliquotCount,
  };
  return [...records].sort((a, b) => Number(b.favorite) - Number(a.favorite) || compare[key](a, b) || a.name.localeCompare(b.name));
}

// ---------------------------------------------------------------------------
// Add / edit form
// ---------------------------------------------------------------------------

export type ProteinForm = {
  name: string;
  geneName: string;
  organism: string;
  constructName: string;
  tags: string;
  purificationMethod: string;
  concentrationValue: string;
  concentrationUnit: string;
  yieldValue: string;
  yieldUnit: string;
  purityPercent: string;
  buffer: string;
  storageDate: string;
  storageTemperature: string;
  freezer: string;
  shelf: string;
  rack: string;
  box: string;
  position: string;
  aliquotCount: string;
  aliquotVolume: string;
  aliquotUnit: string;
  notes: string;
};

export function emptyForm(today: Date = new Date()): ProteinForm {
  return {
    name: "", geneName: "", organism: "", constructName: "", tags: "", purificationMethod: "",
    concentrationValue: "", concentrationUnit: "mg/mL", yieldValue: "", yieldUnit: "mg", purityPercent: "", buffer: "",
    storageDate: isoDay(today), storageTemperature: "-80 °C",
    freezer: "", shelf: "", rack: "", box: "", position: "",
    aliquotCount: "", aliquotVolume: "", aliquotUnit: "µL", notes: "",
  };
}

export function recordToForm(record: LibraryProtein): ProteinForm {
  const number = (value: number | null) => (value === null || value === undefined ? "" : String(value));
  return {
    name: record.name, geneName: record.geneName, organism: record.organism, constructName: record.constructName,
    tags: record.tags.join(", "), purificationMethod: record.purificationMethod,
    concentrationValue: number(record.concentrationValue), concentrationUnit: displayUnit(record.concentrationUnit) || "mg/mL",
    yieldValue: number(record.yieldValue), yieldUnit: displayUnit(record.yieldUnit) || "mg",
    purityPercent: number(record.purityPercent), buffer: record.buffer,
    storageDate: record.storageDate, storageTemperature: record.storageTemperature,
    freezer: record.freezer, shelf: record.shelf, rack: record.rack, box: record.box, position: record.position,
    aliquotCount: String(record.aliquotCount ?? 0), aliquotVolume: number(record.aliquotVolume),
    aliquotUnit: displayUnit(record.aliquotUnit) || "µL", notes: record.notes,
  };
}

export function parseTags(value: string) {
  const seen = new Set<string>();
  return value.split(/[,;\n]/).map((tag) => tag.trim()).filter((tag) => {
    const key = tag.toLowerCase();
    if (!tag || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export type FormErrors = Partial<Record<keyof ProteinForm, string>>;

/**
 * Validate the form and build the create / update body. Blank numbers are
 * sent as null so an edit can clear a value, and the status follows the
 * aliquot count with the engine's rule (one left is low, none is used up).
 */
export function formToPayload(form: ProteinForm, existing?: Pick<LibraryProtein, "status" | "aliquotCount">): { payload: Record<string, unknown>; errors: FormErrors } {
  const errors: FormErrors = {};
  const number = (key: keyof ProteinForm, { min = 0, max = Infinity, integer = false } = {}) => {
    const text = form[key].trim().replace(",", ".");
    if (!text) return null;
    const value = Number(text);
    if (!Number.isFinite(value)) { errors[key] = "Enter a number"; return null; }
    if (integer && !Number.isInteger(value)) { errors[key] = "Enter a whole number"; return null; }
    if (value < min || value > max) { errors[key] = max === Infinity ? `Must be ${min} or more` : `Must be between ${min} and ${max}`; return null; }
    return value;
  };
  if (!form.name.trim()) errors.name = "Name the protein";
  const concentrationValue = number("concentrationValue");
  const yieldValue = number("yieldValue");
  const purityPercent = number("purityPercent", { max: 100 });
  const aliquotCount = number("aliquotCount", { integer: true }) ?? 0;
  const aliquotVolume = number("aliquotVolume");
  if (form.storageDate && !/^\d{4}-\d{2}-\d{2}$/.test(form.storageDate)) errors.storageDate = "Use a date like 2026-10-21";
  const parts = { freezer: form.freezer.trim(), shelf: form.shelf.trim(), rack: form.rack.trim(), box: form.box.trim(), position: form.position.trim() };
  // Zero aliquots on a batch that never had any means "not counted", not
  // "empty", so it only reads as used up once aliquots existed and ran out.
  const status = existing?.status === "discarded" ? "discarded"
    : aliquotCount === 0 ? (existing && (existing.aliquotCount > 0 || existing.status === "used_up") ? "used_up" : "stored")
    : aliquotCount === 1 ? "low"
    : "stored";
  return {
    errors,
    payload: {
      name: form.name.trim(), geneName: form.geneName.trim(), organism: form.organism.trim(), constructName: form.constructName.trim(),
      tags: parseTags(form.tags), purificationMethod: form.purificationMethod.trim(),
      concentrationValue, concentrationUnit: form.concentrationUnit, yieldValue, yieldUnit: form.yieldUnit, purityPercent,
      buffer: form.buffer.trim(), storageDate: form.storageDate, storageTemperature: form.storageTemperature,
      ...parts, locationPath: joinLocation(parts),
      aliquotCount, aliquotVolume, aliquotUnit: form.aliquotUnit, notes: form.notes.trim(), status,
    },
  };
}

export function isoDay(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}
