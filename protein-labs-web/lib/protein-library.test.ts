// Tests for the purified-protein library helpers (HOM-159).
// Run with `npm run test` in protein-labs-web (Node's built-in runner).
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  activeFilterCount,
  daysSince,
  displayUnit,
  emptyForm,
  eventSummary,
  facetOptions,
  facetValueLabel,
  formToPayload,
  formatNumber,
  formatQuantity,
  joinLocation,
  librarySearchParams,
  locationCrumbs,
  parseTags,
  recordToForm,
  remainingVolume,
  shortAge,
  sortProteins,
  statusMeta,
  storedAgo,
  toggleFilter,
  type LibraryProtein,
} from "./protein-library.ts";

const now = new Date(2026, 9, 21, 15, 30);

function record(fields: Partial<LibraryProtein> = {}): LibraryProtein {
  return {
    id: "p1", name: "His-TEV-HBB", geneName: "HBB", organism: "Homo sapiens", constructName: "pET-28a HBB", tags: ["His6"],
    purificationMethod: "Ni-NTA → SEC", concentrationValue: 2.4, concentrationUnit: "mg/mL", yieldValue: 12, yieldUnit: "mg",
    purityPercent: 95, buffer: "20 mM HEPES pH 7.5", storageDate: "2026-10-01", storageTemperature: "-80 °C",
    locationPath: "Freezer A › Shelf 2 › Rack B › Box 3", freezer: "Freezer A", shelf: "Shelf 2", rack: "Rack B", box: "Box 3", position: "C4",
    aliquotCount: 6, aliquotVolume: 50, aliquotUnit: "uL", status: "stored", notes: "", favorite: false,
    createdAt: "2026-10-01T10:00:00Z", updatedAt: "2026-10-02T10:00:00Z", ...fields,
  };
}

describe("librarySearchParams", () => {
  it("trims the query and repeats facet values", () => {
    const params = new URLSearchParams(librarySearchParams({ query: "  HBB ", filters: { temperature: ["-80 °C"], tag: ["His6", "GST, cleaved"] } }));
    assert.equal(params.get("q"), "HBB");
    assert.deepEqual(params.getAll("temperature"), ["-80 °C"]);
    assert.deepEqual(params.getAll("tag"), ["His6", "GST, cleaved"]);
    assert.equal(params.get("limit"), "500");
    assert.equal(params.has("favorite"), false);
  });
  it("omits an empty query and passes the favourite flag", () => {
    const params = new URLSearchParams(librarySearchParams({ query: "  ", filters: {}, favorite: true, limit: 20 }));
    assert.equal(params.has("q"), false);
    assert.equal(params.get("favorite"), "true");
    assert.equal(params.get("limit"), "20");
  });
});

describe("filters", () => {
  it("toggles a value on and off and drops empty keys", () => {
    const on = toggleFilter({}, "status", "low");
    assert.deepEqual(on, { status: ["low"] });
    assert.deepEqual(toggleFilter(on, "status", "low"), {});
    assert.equal(activeFilterCount({ status: ["low", "stored"], tag: ["His6"] }), 3);
  });
  it("keeps a ticked value visible after it stops matching", () => {
    assert.deepEqual(facetOptions([{ value: "-80 °C", count: 3 }], ["4 °C", "-80 °C"]), [{ value: "-80 °C", count: 3 }, { value: "4 °C", count: 0 }]);
  });
  it("labels status values as their badges", () => {
    assert.equal(facetValueLabel("status", "used_up"), "Used up");
    assert.equal(facetValueLabel("status", "stored"), "Available");
    assert.equal(facetValueLabel("tag", "stored"), "stored");
    assert.equal(statusMeta("nonsense").label, "Available");
  });
});

describe("storage location", () => {
  it("joins freezer to box, leaving the position out", () => {
    assert.equal(joinLocation({ freezer: " Freezer A ", shelf: "", rack: "Rack B", box: "Box 3", position: "C4" }), "Freezer A › Rack B › Box 3");
  });
  it("builds the breadcrumb from the structured fields while they agree with the path", () => {
    assert.deepEqual(locationCrumbs(record()).map((crumb) => `${crumb.label}:${crumb.value}`), ["Freezer:Freezer A", "Shelf:Shelf 2", "Rack:Rack B", "Box:Box 3", "Position:C4"]);
  });
  it("uses the path once a move has changed it", () => {
    const moved = record({ locationPath: "Freezer C > Shelf 1 / Box 9" });
    assert.deepEqual(locationCrumbs(moved).map((crumb) => crumb.value), ["Freezer C", "Shelf 1", "Box 9"]);
  });
  it("is empty when nothing is recorded", () => {
    assert.deepEqual(locationCrumbs(record({ locationPath: "", freezer: "", shelf: "", rack: "", box: "", position: "" })), []);
  });
});

describe("dates", () => {
  it("counts whole local days since storage", () => {
    assert.equal(daysSince("2026-10-21", now), 0);
    assert.equal(daysSince("2026-10-20", now), 1);
    assert.equal(daysSince("2026-10-01", now), 20);
    assert.equal(daysSince("", now), null);
    assert.equal(daysSince("not a date", now), null);
  });
  it("says how long ago a batch was stored", () => {
    assert.equal(storedAgo("2026-10-21", now), "Stored today");
    assert.equal(storedAgo("2026-10-20", now), "Stored yesterday");
    assert.equal(storedAgo("2026-10-01", now), "Stored 20 days ago");
    assert.equal(storedAgo("2026-10-23", now), "Stored in 2 days");
    assert.equal(storedAgo("", now), "");
  });
  it("shortens ages for list cells", () => {
    assert.equal(shortAge("2026-10-21", now), "today");
    assert.equal(shortAge("2026-09-01", now), "50 d");
    assert.equal(shortAge("2026-01-01", now), "9 mo");
    assert.equal(shortAge("2023-10-21", now), "3 y");
  });
});

describe("quantities", () => {
  it("rounds to readable figures", () => {
    assert.equal(formatNumber(2.4), "2.4");
    assert.equal(formatNumber(0.125), "0.125");
    assert.equal(formatNumber(12.345), "12.3");
    assert.equal(formatNumber(1250), "1,250");
    assert.equal(formatNumber(0), "0");
    assert.equal(formatNumber(null), "");
    assert.equal(formatQuantity(2.4, "mg/mL"), "2.4 mg/mL");
    assert.equal(formatQuantity(null, "mg"), "");
  });
  it("shows the micro sign for the engine's ASCII units", () => {
    assert.equal(displayUnit("uL"), "µL");
    assert.equal(displayUnit("ug"), "µg");
    assert.equal(displayUnit("uM"), "µM");
    assert.equal(displayUnit("mg/mL"), "mg/mL");
  });
  it("totals the volume left and switches to mL past 1 mL", () => {
    assert.equal(remainingVolume(record()), "300 µL");
    assert.equal(remainingVolume(record({ aliquotCount: 25, aliquotVolume: 100 })), "2.5 mL");
    assert.equal(remainingVolume(record({ aliquotVolume: null })), "");
    assert.equal(remainingVolume(record({ aliquotCount: 0 })), "0 µL");
  });
});

describe("eventSummary", () => {
  it("describes each kind of event", () => {
    assert.deepEqual(eventSummary({ eventType: "aliquot_used", aliquotsUsed: 2, fromLocation: "", toLocation: "" }), { title: "Used 2 aliquots", detail: "" });
    assert.deepEqual(eventSummary({ eventType: "aliquot_used", aliquotsUsed: 1, fromLocation: "", toLocation: "" }).title, "Used 1 aliquot");
    assert.deepEqual(eventSummary({ eventType: "moved", aliquotsUsed: 0, fromLocation: "Freezer A", toLocation: "Freezer B" }), { title: "Moved", detail: "Freezer A → Freezer B" });
    assert.equal(eventSummary({ eventType: "stored", aliquotsUsed: 0, fromLocation: "Freezer A", toLocation: "" }).detail, "Freezer A");
  });
});

describe("sortProteins", () => {
  const list = [
    record({ id: "a", name: "Lysozyme", updatedAt: "2026-10-03", storageDate: "2026-01-01", aliquotCount: 9 }),
    record({ id: "b", name: "barnase", updatedAt: "2026-10-05", storageDate: "2026-09-01", aliquotCount: 1 }),
    record({ id: "c", name: "Cas9", updatedAt: "2026-10-01", storageDate: "2026-10-10", aliquotCount: 0, status: "discarded" }),
    record({ id: "d", name: "Zif268", updatedAt: "2026-09-01", storageDate: "2025-01-01", aliquotCount: 4, favorite: true }),
  ];
  it("keeps favourites first in every order", () => {
    assert.deepEqual(sortProteins(list, "updated").map((entry) => entry.id), ["d", "b", "a", "c"]);
    assert.deepEqual(sortProteins(list, "stored").map((entry) => entry.id), ["d", "c", "b", "a"]);
    assert.deepEqual(sortProteins(list, "name").map((entry) => entry.id), ["d", "b", "c", "a"]);
  });
  it("puts discarded batches last when sorting by stock", () => {
    assert.deepEqual(sortProteins(list, "aliquots").map((entry) => entry.id), ["d", "b", "a", "c"]);
  });
  it("does not mutate its input", () => {
    const before = list.map((entry) => entry.id);
    sortProteins(list, "name");
    assert.deepEqual(list.map((entry) => entry.id), before);
  });
});

describe("form", () => {
  it("starts on today at -80 °C", () => {
    const form = emptyForm(now);
    assert.equal(form.storageDate, "2026-10-21");
    assert.equal(form.storageTemperature, "-80 °C");
  });
  it("splits and de-duplicates tags", () => {
    assert.deepEqual(parseTags("His6, GST; his6\n  TEV-cleaved ,"), ["His6", "GST", "TEV-cleaved"]);
  });
  it("round-trips a record", () => {
    const { payload, errors } = formToPayload(recordToForm(record()), record());
    assert.deepEqual(errors, {});
    assert.equal(payload.concentrationValue, 2.4);
    assert.equal(payload.aliquotCount, 6);
    assert.equal(payload.aliquotUnit, "µL");
    assert.equal(payload.locationPath, "Freezer A › Shelf 2 › Rack B › Box 3");
    assert.equal(payload.position, "C4");
    assert.deepEqual(payload.tags, ["His6"]);
    assert.equal(payload.status, "stored");
  });
  it("requires a name and checks numbers", () => {
    const form = { ...emptyForm(now), concentrationValue: "abc", purityPercent: "120", aliquotCount: "2.5", storageDate: "21/10/2026" };
    const { errors } = formToPayload(form);
    assert.equal(errors.name, "Name the protein");
    assert.equal(errors.concentrationValue, "Enter a number");
    assert.equal(errors.purityPercent, "Must be between 0 and 100");
    assert.equal(errors.aliquotCount, "Enter a whole number");
    assert.equal(errors.storageDate, "Use a date like 2026-10-21");
  });
  it("accepts a decimal comma and sends blanks as null", () => {
    const { payload, errors } = formToPayload({ ...emptyForm(now), name: "X", concentrationValue: "1,5" });
    assert.deepEqual(errors, {});
    assert.equal(payload.concentrationValue, 1.5);
    assert.equal(payload.yieldValue, null);
  });
  it("derives the status from the aliquot count", () => {
    const named = { ...emptyForm(now), name: "X" };
    assert.equal(formToPayload({ ...named, aliquotCount: "" }).payload.status, "stored");
    assert.equal(formToPayload({ ...named, aliquotCount: "1" }).payload.status, "low");
    assert.equal(formToPayload({ ...named, aliquotCount: "0" }, { status: "low", aliquotCount: 1 }).payload.status, "used_up");
    assert.equal(formToPayload({ ...named, aliquotCount: "0" }, { status: "stored", aliquotCount: 0 }).payload.status, "stored");
    assert.equal(formToPayload({ ...named, aliquotCount: "5" }, { status: "discarded", aliquotCount: 5 }).payload.status, "discarded");
  });
});
