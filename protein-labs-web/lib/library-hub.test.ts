import { describe, it } from "vitest";
import assert from "node:assert/strict";
import { LIBRARY_TABS, createLibraryOpener, LIBRARY_TILE, isLibraryTab, libraryCount, libraryStorage, nextLibraryTab, storageSentence, summarizePlaces } from "./library-hub.ts";

describe("library tile labels", () => {
  it("names both libraries", () => {
    assert.equal(LIBRARY_TILE.title, "Vector and protein library");
    assert.equal(LIBRARY_TILE.subtitle, "Saved vectors and proteins");
    assert.deepEqual(LIBRARY_TABS.map((tab) => tab.label), ["Vectors", "Proteins"]);
  });

  it("counts each library in its own words", () => {
    assert.equal(libraryCount("vectors", 1), "1 vector");
    assert.equal(libraryCount("vectors", 0), "0 vectors");
    assert.equal(libraryCount("proteins", 1200), `${(1200).toLocaleString()} proteins`);
    assert.equal(libraryCount("proteins", null), "… proteins");
  });

  it("names the busiest storage places first", () => {
    assert.equal(summarizePlaces(undefined), "");
    assert.equal(summarizePlaces([{ value: "Fridge 2", count: 1 }, { value: "Freezer A", count: 4 }]), "Freezer A, Fridge 2");
    assert.equal(summarizePlaces([{ value: "B", count: 2 }, { value: "A", count: 2 }, { value: "C", count: 1 }, { value: "D", count: 1 }, { value: "", count: 9 }]), "A, B and 2 more");
    assert.equal(summarizePlaces([{ value: "−80 #2 › Shelf 3 › Box 7", count: 1 }, { value: "−80 #2 › Shelf 1", count: 1 }, { value: "Cold room › Shelf 1", count: 1 }]), "−80 #2, Cold room");
  });
});

describe("library tab switching", () => {
  it("moves with the arrow keys and wraps", () => {
    assert.equal(nextLibraryTab("vectors", "ArrowRight"), "proteins");
    assert.equal(nextLibraryTab("proteins", "ArrowRight"), "vectors");
    assert.equal(nextLibraryTab("vectors", "ArrowLeft"), "proteins");
    assert.equal(nextLibraryTab("proteins", "ArrowLeft"), "vectors");
  });

  it("jumps to the ends with Home and End and ignores other keys", () => {
    assert.equal(nextLibraryTab("proteins", "Home"), "vectors");
    assert.equal(nextLibraryTab("vectors", "End"), "proteins");
    assert.equal(nextLibraryTab("vectors", "Enter"), null);
    assert.equal(nextLibraryTab("vectors", "a"), null);
  });

  it("switches tabs in place once the library is open, even through an opener made earlier", () => {
    // The opener is made once while the dashboard
    // shows, then used after the library page has opened.
    let view = "home";
    const calls: string[] = [];
    const open = createLibraryOpener({ currentView: () => view, switchTab: (tab) => calls.push(`switch:${tab}`), openView: (tab) => { calls.push(`open:${tab}`); view = "library"; } });
    open("vectors");
    open("proteins");
    view = "manual";
    open("vectors");
    assert.deepEqual(calls, ["open:vectors", "switch:proteins", "open:vectors"]);
  });

  it("accepts only the two tabs", () => {
    assert.equal(isLibraryTab("vectors"), true);
    assert.equal(isLibraryTab("proteins"), true);
    assert.equal(isLibraryTab("reports"), false);
    assert.equal(isLibraryTab(undefined), false);
  });
});

describe("library storage", () => {
  it("uses the desktop project folder when the bridge is present", () => {
    const storage = libraryStorage({ directory: "/home/lab/Protein Lab", database: "/home/lab/Protein Lab/protein-labs.sqlite3", isDefault: true, missing: null, canChange: true }, "/ignored/db.sqlite3");
    assert.deepEqual(storage, { folder: "/home/lab/Protein Lab", database: "/home/lab/Protein Lab/protein-labs.sqlite3", canReveal: true, canChange: true, missing: null });
    assert.equal(storageSentence("proteins", storage), "Proteins are saved in the project database in");
  });

  it("falls back to the engine database folder in the web build", () => {
    const storage = libraryStorage(null, "C:\\Lab\\data\\protein-labs.sqlite3");
    assert.equal(storage.folder, "C:\\Lab\\data");
    assert.equal(storage.canReveal, false);
    assert.equal(storage.canChange, false);
  });

  it("explains where things go before the engine connects", () => {
    const storage = libraryStorage(null, "");
    assert.equal(storage.folder, "");
    assert.match(storageSentence("vectors", storage), /^Vectors are saved in the project database once the local engine is connected/);
  });
});
