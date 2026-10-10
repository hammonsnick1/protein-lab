const { app, BrowserWindow, dialog, shell } = require("electron");
const { spawn } = require("node:child_process");
const fs = require("node:fs");
const http = require("node:http");
const path = require("node:path");

const API_HOST = "127.0.0.1";
const API_PORT = 8770;
let backendProcess;
let mainWindow;
let quitting = false;
let starting = true;
let backendFailure;
let backendOutput = "";
let startupLog;

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
  if (app.isPackaged) return path.join(process.resourcesPath, "backend", "protein-labs-backend");
  return path.resolve(__dirname, "../../../protein-labs/backend/dist/protein-labs-backend");
}

function webEntry() {
  if (app.isPackaged) return path.join(app.getAppPath(), "desktop-dist", "index.html");
  return path.resolve(__dirname, "../../desktop-dist/index.html");
}

function databasePath() {
  const dataDir = path.join(app.getPath("userData"), "data");
  fs.mkdirSync(dataDir, { recursive: true });
  return path.join(dataDir, "protein_labs.sqlite3");
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
  });
  backendProcess = child;
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
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^(?:https?:\/\/|mailto:)/.test(url)) void shell.openExternal(url);
    return { action: "deny" };
  });
  mainWindow.on("closed", () => { mainWindow = undefined; });
  mainWindow.webContents.on("render-process-gone", (_event, details) => {
    log(`Renderer stopped: ${JSON.stringify(details)}`);
    if (!quitting) dialog.showErrorBox("Protein Lab display stopped", `Please reopen Protein Lab. Startup details were saved to ${startupLog}.`);
  });
  await mainWindow.loadFile(path.resolve(__dirname, "../assets/starting.html"));
  if (await backendIsHealthy()) log("Connected to existing local engine.");
  else startBackend();
  await backendReady();
  if (quitting || !mainWindow) return;
  await mainWindow.loadFile(webEntry());
  starting = false;
  mainWindow.show();
  log(`Workspace loaded; visible=${mainWindow.isVisible()}`);
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
    dialog.showErrorBox("Protein Lab could not start", `${error instanceof Error ? error.message : String(error)}\n\nStartup log: ${startupLog || "unavailable"}`);
    app.quit();
  });
  app.on("window-all-closed", () => app.quit());
  app.on("before-quit", () => {
    log("Desktop closing.");
    quitting = true;
    if (backendProcess && !backendProcess.killed) backendProcess.kill("SIGTERM");
  });
}
