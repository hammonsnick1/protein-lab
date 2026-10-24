const { app, BrowserWindow, dialog, ipcMain, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");
const { copyProjects, databaseIn, inspectDirectory, readSettings, resolveProjectDirectory, writeSettings } = require("./project-directory.cjs");

const API_HOST = "127.0.0.1";
const API_PORT = 8770;
let backendProcess;
let mainWindow;
let quitting = false;
let starting = true;
let backendFailure;
let backendOutput = "";
let startupLog;
// True only for an engine this window spawned; an engine that was already
// running belongs to someone else and cannot be moved to another folder.
let ownsEngine = false;
let switchingDirectory = false;
// `--smoke-test` (used by the release workflow): start this build's own
// engine, load the workspace, then exit 0, or exit 1 on any startup failure
// instead of showing a dialog nobody can dismiss.
const smokeTest = app.commandLine.hasSwitch("smoke-test");

// Taskbar grouping and pinned shortcuts on Windows match on this id, which
// electron-builder also writes into the installer's shortcuts.
if (process.platform === "win32") app.setAppUserModelId("org.proteinlabs.desktop");

// Use the compositor actually running on Linux. Forcing X11 on a Wayland desktop can
// leave an invisible process while Xwayland repeatedly restarts. Vulkan must
// be disabled separately; changing Ozone platforms does not disable it.
const requestedOzone = process.env.PROTEIN_LABS_OZONE_PLATFORM;
const onWayland = Boolean(process.env.WAYLAND_DISPLAY || process.env.XDG_SESSION_TYPE === "wayland");
if (process.platform === "linux") {
  app.commandLine.appendSwitch("ozone-platform", requestedOzone || (onWayland ? "wayland" : "x11"));
  const disabled = app.commandLine.getSwitchValue("disable-features").split(",").filter(Boolean);
  app.commandLine.appendSwitch("disable-features", [...new Set([...disabled, "Vulkan"])].join(","));
}

function log(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stderr.write(`[protein-labs] ${line}`);
  if (startupLog) {
    try { fs.appendFileSync(startupLog, line); } catch { /* Logging must not prevent startup. */ }
  }
}

function backendExecutable() {
  const name = process.platform === "win32" ? "protein-labs-backend.exe" : "protein-labs-backend";
  if (app.isPackaged) return path.join(process.resourcesPath, "backend", name);
  return path.resolve(__dirname, "../../../protein-labs/backend/dist", name);
}

// On Windows the PyInstaller bootloader runs the engine as a child process
// and Node's kill() ends only the bootloader, leaving the engine on the port,
// so the whole tree is ended with taskkill there.
function killEngine(child, signal = "SIGTERM") {
  if (process.platform !== "win32") {
    child.kill(signal);
    return;
  }
  spawn("taskkill", ["/pid", String(child.pid), "/t", "/f"], { stdio: "ignore", windowsHide: true })
    .on("error", () => child.kill());
}

function webEntry() {
  if (app.isPackaged) return path.join(app.getAppPath(), "desktop-dist", "index.html");
  return path.resolve(__dirname, "../../desktop-dist/index.html");
}

function settingsPath() {
  return path.join(app.getPath("userData"), "settings.json");
}

function defaultProjectDirectory() {
  return path.join(app.getPath("userData"), "data");
}

function projectDirectory() {
  return resolveProjectDirectory(readSettings(settingsPath()), defaultProjectDirectory());
}

function databasePath() {
  const { directory, missing } = projectDirectory();
  if (missing) log(`Project directory ${missing} is missing; using ${directory}.`);
  fs.mkdirSync(directory, { recursive: true });
  return databaseIn(directory);
}

function backendIsHealthy(timeoutMs = 1500) {
  return new Promise((resolve) => {
    let settled = false;
    let request;
    const finish = (healthy) => {
      if (settled) return;
      settled = true;
      clearTimeout(deadline);
      resolve(healthy);
    };
    const deadline = setTimeout(() => {
      finish(false);
      request?.destroy();
    }, timeoutMs);
    request = http.get(
      { host: API_HOST, port: API_PORT, path: "/v1/health" },
      (response) => {
        let body = "";
        response.setEncoding("utf8");
        response.on("data", (chunk) => {
          body += chunk;
          if (body.length > 65536) { finish(false); request.destroy(); }
        });
        response.on("error", () => finish(false));
        response.on("aborted", () => finish(false));
        response.on("end", () => {
          try {
            const health = JSON.parse(body);
            finish(response.statusCode === 200 && health.service === "protein-labs");
          } catch {
            finish(false);
          }
        });
      },
    );
    request.on("error", () => finish(false));
  });
}

function startBackend() {
  const executable = backendExecutable();
  if (!fs.existsSync(executable)) throw new Error(`Scientific engine is missing: ${executable}`);
  backendFailure = undefined;
  backendOutput = "";
  log(`Starting local engine; database=${databasePath()}`);
  const child = spawn(executable, ["--host", API_HOST, "--port", String(API_PORT), "--database", databasePath()], {
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PYTHONUNBUFFERED: "1" },
    // The engine is a console program; without this Windows opens a terminal.
    windowsHide: true,
  });
  backendProcess = child;
  ownsEngine = true;
  child.stderr.on("data", (data) => {
    backendOutput = (backendOutput + data.toString()).slice(-8000);
    process.stderr.write(`[protein-labs] ${data}`);
  });
  child.on("error", (error) => {
    backendFailure = error;
    log(`Engine spawn failed: ${error.message}`);
  });
  child.on("exit", async (code, signal) => {
    if (backendProcess === child) backendProcess = undefined;
    if (quitting) return;
    backendFailure = new Error(`Local engine exited (${signal || code}).\n${backendOutput}`);
    log(backendFailure.message);
    // A folder switch stops the engine on purpose and reports its own errors.
    if (switchingDirectory) return;
    if (!starting && !(await backendIsHealthy()) && !quitting) {
      dialog.showErrorBox(
        "Protein Lab engine stopped",
        `The local scientific engine ended unexpectedly. Restart Protein Lab to reconnect it.\n\nDetails: ${startupLog}`,
      );
    }
  });
}

async function backendReady(timeoutMs = 30000) {
  const started = Date.now();
  while (!quitting && Date.now() - started < timeoutMs) {
    if (await backendIsHealthy()) return;
    if (backendFailure) throw backendFailure;
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("The local scientific engine did not become ready within 30 seconds.");
}

function stopBackend(timeoutMs = 8000) {
  const child = backendProcess;
  if (!child || child.exitCode !== null || child.signalCode !== null) return Promise.resolve();
  return new Promise((resolve) => {
    const force = setTimeout(() => killEngine(child, "SIGKILL"), timeoutMs);
    child.once("exit", () => { clearTimeout(force); resolve(); });
    killEngine(child);
  });
}

function projectDirectoryState() {
  const { directory, isDefault, missing } = projectDirectory();
  return { directory, database: databaseIn(directory), isDefault, missing, canChange: ownsEngine };
}

async function restartBackend() {
  switchingDirectory = true;
  try {
    await stopBackend();
    startBackend();
    await backendReady();
  } finally {
    switchingDirectory = false;
  }
}

// Asks for a folder, decides with the user whether to copy the current
// projects there, then restarts the engine on that folder's database. If the
// engine cannot start there, the previous folder is restored.
async function chooseProjectDirectory() {
  if (!mainWindow) return { status: "cancelled" };
  const current = projectDirectory();
  if (!ownsEngine) {
    return { status: "error", message: "Protein Lab is connected to an engine it did not start, so it cannot move that engine to another folder. Quit the other engine and reopen Protein Lab, then try again." };
  }
  const picked = await dialog.showOpenDialog(mainWindow, {
    title: "Set project directory",
    defaultPath: current.directory,
    buttonLabel: "Use this folder",
    properties: ["openDirectory", "createDirectory"],
  });
  if (picked.canceled || !picked.filePaths[0]) return { status: "cancelled" };
  const target = path.resolve(picked.filePaths[0]);
  if (target === path.resolve(current.directory)) return { status: "unchanged", state: projectDirectoryState() };
  const { writable, hasProjects, leftovers } = inspectDirectory(target);
  if (!writable) return { status: "error", message: `Protein Lab cannot save in ${target}. Choose a folder you can write to.` };
  if (leftovers.length) return { status: "error", message: `${target} holds ${leftovers.join(" and ")} without its database, probably from an interrupted copy. Remove ${leftovers.length > 1 ? "those files" : "that file"} or choose another folder.` };

  let copy = false;
  if (hasProjects) {
    const answer = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "Set project directory",
      message: "This folder already holds Protein Lab projects.",
      detail: `Protein Lab will open the projects in ${target}. The projects in ${current.directory} stay where they are.`,
      buttons: ["Open these projects", "Cancel"],
      defaultId: 0,
      cancelId: 1,
    });
    if (answer.response !== 0) return { status: "cancelled" };
  } else {
    const answer = await dialog.showMessageBox(mainWindow, {
      type: "question",
      title: "Set project directory",
      message: "Copy your current projects into this folder?",
      detail: `New projects will be saved in ${target}. Copying brings your existing projects with you; the originals stay in ${current.directory}.`,
      buttons: ["Copy my projects", "Start empty", "Cancel"],
      defaultId: 0,
      cancelId: 2,
    });
    if (answer.response === 2) return { status: "cancelled" };
    copy = answer.response === 0;
  }

  const previous = readSettings(settingsPath());
  log(`Switching project directory to ${target} (copy=${copy}).`);
  try {
    switchingDirectory = true;
    await stopBackend();
    const copied = copy ? copyProjects(databaseIn(current.directory), target) : false;
    writeSettings(settingsPath(), { ...previous, projectDirectory: target });
    await restartBackend();
    return { status: "changed", copied, state: projectDirectoryState() };
  } catch (error) {
    log(`Switching project directory failed: ${error instanceof Error ? error.stack : error}`);
    writeSettings(settingsPath(), previous);
    try { await restartBackend(); } catch (restartError) { log(`Restarting the previous engine failed: ${restartError}`); }
    return { status: "error", message: `Protein Lab could not use ${target}: ${error instanceof Error ? error.message.split("\n")[0] : String(error)}. Your projects are still in ${projectDirectory().directory}.` };
  } finally {
    switchingDirectory = false;
  }
}

function fromMainWindow(event) {
  return Boolean(mainWindow) && event.sender === mainWindow.webContents;
}

ipcMain.handle("project-directory:get", (event) => (fromMainWindow(event) ? projectDirectoryState() : null));
ipcMain.handle("project-directory:choose", (event) => (fromMainWindow(event) ? chooseProjectDirectory() : { status: "cancelled" }));
ipcMain.handle("project-directory:open", async (event) => {
  if (!fromMainWindow(event)) return "";
  return shell.openPath(projectDirectory().directory);
});

// Stops the engine this run started, then exits with the smoke-test result.
async function exitSmokeTest(code) {
  quitting = true;
  await stopBackend();
  app.exit(code);
}

// Passes once React has rendered the workspace into #root.
async function finishSmokeTest() {
  const deadline = Date.now() + 15000;
  const mounted = () => mainWindow.webContents.executeJavaScript("document.getElementById('root')?.childElementCount > 0");
  while (!(await mounted())) {
    if (Date.now() > deadline) throw new Error("The workspace page loaded but never rendered.");
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  log("Smoke test passed.");
  await exitSmokeTest(0);
}

async function createWindow() {
  const logDir = path.join(app.getPath("userData"), "logs");
  fs.mkdirSync(logDir, { recursive: true });
  startupLog = path.join(logDir, "desktop.log");
  if (fs.existsSync(startupLog) && fs.statSync(startupLog).size > 1024 * 1024) {
    fs.renameSync(startupLog, `${startupLog}.previous`);
  }
  log(`Desktop starting; platform=${process.platform}; ozone=${app.commandLine.getSwitchValue("ozone-platform")}; packaged=${app.isPackaged}`);
  mainWindow = new BrowserWindow({
    width: 1480,
    height: 940,
    minWidth: 900,
    minHeight: 650,
    backgroundColor: "#eee8dc",
    title: "Protein Lab",
    icon: path.resolve(__dirname, "../assets/icon.png"),
    show: true,
    autoHideMenuBar: true,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true, preload: path.join(__dirname, "preload.cjs") },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(?:https?:\/\/|mailto:)/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => { mainWindow = undefined; });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log(`Renderer stopped: ${JSON.stringify(details)}`);
    if (smokeTest) return void exitSmokeTest(1);
    if (!quitting) dialog.showErrorBox("Protein Lab display stopped", `Please reopen Protein Lab. Startup details were saved to ${startupLog}.`);
  });
  await mainWindow.loadFile(path.resolve(__dirname, "../assets/starting.html"));
  if (await backendIsHealthy()) {
    if (smokeTest) throw new Error(`Another engine already answers on port ${API_PORT}, so this build's own engine cannot be tested.`);
    log("Connected to existing local engine.");
  } else startBackend();
  await backendReady();
  if (quitting || !mainWindow) return;
  await mainWindow.loadFile(webEntry());
  starting = false;
  mainWindow.show();
  log(`Workspace loaded; visible=${mainWindow.isVisible()}`);
  if (smokeTest) await finishSmokeTest();
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    log("Another launch requested; focusing the existing window.");
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.whenReady().then(createWindow).catch((error) => {
    if (quitting) return;
    log(`Startup failed: ${error instanceof Error ? error.stack : error}`);
    if (smokeTest) return exitSmokeTest(1);
    dialog.showErrorBox("Protein Lab could not start", `${error instanceof Error ? error.message : String(error)}\n\nStartup log: ${startupLog || "unavailable"}`);
    app.quit();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    log("Desktop closing.");
    quitting = true;
    if (backendProcess && !backendProcess.killed) killEngine(backendProcess);
  });
}
