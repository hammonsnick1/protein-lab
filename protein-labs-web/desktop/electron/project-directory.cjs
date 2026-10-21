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

function inspectDirectory(directory) {
  let writable = true;
  try { fs.accessSync(directory, fs.constants.W_OK); } catch { writable = false; }
  return { writable, hasProjects: fs.existsSync(databaseIn(directory)) };
}

// Copies the database and its write-ahead log into an empty project directory.
// The engine runs SQLite in WAL mode, so recent saves can still sit in the
// -wal file; it must be stopped first so neither file changes mid-copy. The
// original stays where it was as a fallback copy.
function copyProjects(fromDatabase, toDirectory) {
  const target = databaseIn(toDirectory);
  if (fs.existsSync(target)) throw new Error(`${toDirectory} already holds Protein Lab projects.`);
  if (!fs.existsSync(fromDatabase)) return false;
  fs.copyFileSync(fromDatabase, target, fs.constants.COPYFILE_EXCL);
  if (fs.existsSync(`${fromDatabase}-wal`)) fs.copyFileSync(`${fromDatabase}-wal`, `${target}-wal`, fs.constants.COPYFILE_EXCL);
  return true;
}

module.exports = { DATABASE_FILE, copyProjects, databaseIn, inspectDirectory, readSettings, resolveProjectDirectory, writeSettings };
