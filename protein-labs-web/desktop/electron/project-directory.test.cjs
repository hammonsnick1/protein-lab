// File > Set project directory helpers (HOM-147).
// Run with `node --test desktop/electron/project-directory.test.cjs`.
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { describe, it } = require("node:test");

const { copyProjects, databaseIn, inspectDirectory, readSettings, resolveProjectDirectory, writeSettings } = require("./project-directory.cjs");

const scratch = () => fs.mkdtempSync(path.join(os.tmpdir(), "protein-lab-dir-"));

describe("settings", () => {
  it("round-trips the chosen folder and treats a damaged file as empty", () => {
    const file = path.join(scratch(), "nested", "settings.json");
    assert.deepEqual(readSettings(file), {});
    writeSettings(file, { projectDirectory: "/data/lab" });
    assert.deepEqual(readSettings(file), { projectDirectory: "/data/lab" });
    fs.writeFileSync(file, "{not json");
    assert.deepEqual(readSettings(file), {});
    fs.writeFileSync(file, "[1,2]");
    assert.deepEqual(readSettings(file), {});
  });
});

describe("resolveProjectDirectory", () => {
  it("uses the saved folder while it exists", () => {
    const chosen = scratch();
    assert.deepEqual(resolveProjectDirectory({ projectDirectory: chosen }, "/default"), { directory: chosen, isDefault: false, missing: null });
  });

  it("falls back to the default and names a saved folder that has gone", () => {
    const gone = path.join(scratch(), "unplugged");
    assert.deepEqual(resolveProjectDirectory({ projectDirectory: gone }, "/default"), { directory: "/default", isDefault: true, missing: gone });
    assert.deepEqual(resolveProjectDirectory({}, "/default"), { directory: "/default", isDefault: true, missing: null });
  });
});

describe("copyProjects", () => {
  it("copies the database with its write-ahead log and leaves the original in place", () => {
    const from = scratch();
    const to = scratch();
    fs.writeFileSync(databaseIn(from), "main");
    fs.writeFileSync(`${databaseIn(from)}-wal`, "recent saves");
    assert.equal(inspectDirectory(to).hasProjects, false);
    assert.equal(copyProjects(databaseIn(from), to), true);
    assert.equal(fs.readFileSync(databaseIn(to), "utf8"), "main");
    assert.equal(fs.readFileSync(`${databaseIn(to)}-wal`, "utf8"), "recent saves");
    assert.equal(fs.existsSync(databaseIn(from)), true);
    assert.deepEqual(inspectDirectory(to), { writable: true, hasProjects: true });
  });

  it("never overwrites projects already in the target folder", () => {
    const from = scratch();
    const to = scratch();
    fs.writeFileSync(databaseIn(from), "main");
    fs.writeFileSync(databaseIn(to), "theirs");
    assert.throws(() => copyProjects(databaseIn(from), to), /already holds/);
    assert.equal(fs.readFileSync(databaseIn(to), "utf8"), "theirs");
  });

  it("reports nothing to copy when there is no database yet", () => {
    assert.equal(copyProjects(databaseIn(scratch()), scratch()), false);
  });
});
