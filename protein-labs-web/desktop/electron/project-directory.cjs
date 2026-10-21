// File > Set project directory (HOM-147). The engine keeps every project in one
// SQLite database, so the project directory is the folder that database lives
// in. These helpers hold no Electron state so they can be tested with Node.
const fs = require("node:fs");
const path = require("node:path");

const DATABASE_FILE = "protein_labs.sqlite3";

function databaseIn(directory) {
  return path.join(directory, DATABASE_FILE);
}

function readSettings(file) {
  try {
    const parsed = JSON.parse(fs.readFileSync(file, "utf8"));
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

// Written to a temporary file and renamed, so a crash mid-write cannot leave
// half a settings file that silently resets the chosen folder.
function writeSettings(file, settings) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  fs.writeFileSync(temporary, `${JSON.stringify(settings, null, 2)}\n`);
  fs.renameSync(temporary, file);
}

// The folder the engine should use: the saved choice when it still exists,
// otherwise the default. `missing` names a saved folder that has gone (an
// unplugged drive, a deleted folder) so the UI can say why it fell back.
function resolveProjectDirectory(settings, defaultDirectory) {
  const chosen = typeof settings.projectDirectory === "string" ? settings.projectDirectory : "";
  if (chosen && fs.existsSync(chosen) && fs.statSync(chosen).isDirectory()) {
    return { directory: chosen, isDefault: false, missing: null };
  }
  return { directory: defaultDirectory, isDefault: true, missing: chosen || null };
}

// SQLite's own files for one database. A folder holding any of them is not
// empty: a stray -wal or -shm would be replayed into whatever lands next to it.
const SQLITE_SUFFIXES = ["", "-wal", "-shm"];

// `leftovers` names SQLite side files with no database beside them (an
// interrupted copy, say); such a folder is neither empty nor a project folder.
function inspectDirectory(directory) {
  let writable = true;
  try { fs.accessSync(directory, fs.constants.W_OK); } catch { writable = false; }
  const database = databaseIn(directory);
  const hasProjects = fs.existsSync(database);
  const leftovers = hasProjects ? [] : SQLITE_SUFFIXES.filter((suffix) => suffix && fs.existsSync(`${database}${suffix}`)).map((suffix) => `${DATABASE_FILE}${suffix}`);
  return { writable, hasProjects, leftovers };
}

// Copies the database and its write-ahead log into an empty project directory.
// The engine runs SQLite in WAL mode, so recent saves can still sit in the
// -wal file; it must be stopped first so neither file changes mid-copy. The
// original stays where it was as a fallback copy.
//
// Both files are copied under temporary names and renamed into place with the
// main database last, so the folder only looks like it holds projects once the
// copy is complete. On any failure, every file this call created is removed.
function copyProjects(fromDatabase, toDirectory) {
  const target = databaseIn(toDirectory);
  const present = SQLITE_SUFFIXES.filter((suffix) => fs.existsSync(`${target}${suffix}`));
  if (present.length) {
    throw new Error(`${toDirectory} already holds Protein Lab database files (${present.map((suffix) => path.basename(target) + suffix).join(", ")}).`);
  }
  if (!fs.existsSync(fromDatabase)) return false;
  const parts = ["-wal", ""].filter((suffix) => fs.existsSync(`${fromDatabase}${suffix}`));
  const created = [];
  try {
    for (const suffix of parts) {
      const temporary = `${target}${suffix}.copying`;
      fs.rmSync(temporary, { force: true });
      // Recorded before copying: a copy that fails partway can still leave a
      // partial temporary file, and it must be cleaned up with the rest.
      created.push(temporary);
      fs.copyFileSync(`${fromDatabase}${suffix}`, temporary, fs.constants.COPYFILE_EXCL);
    }
    for (const suffix of parts) {
      fs.renameSync(`${target}${suffix}.copying`, `${target}${suffix}`);
      created.push(`${target}${suffix}`);
    }
  } catch (error) {
    for (const file of created) fs.rmSync(file, { force: true });
    throw error;
  }
  return true;
}

module.exports = { DATABASE_FILE, copyProjects, databaseIn, inspectDirectory, readSettings, resolveProjectDirectory, writeSettings };
