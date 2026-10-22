// Smoke-tests a built scientific engine: starts it on a throwaway database,
// waits for /v1/health, checks one Biopython-backed calculation, then stops it.
//
//   node scripts/smoke-engine.mjs <path to protein-labs-backend[.exe]>
//
// Used by the release workflow on every OS, because PyInstaller builds each
// platform's engine natively and a missing hidden import only shows at runtime.
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const executable = process.argv[2];
const port = 8770;
const base = `http://127.0.0.1:${port}`;
// Human haemoglobin beta (P68871); its average mass is 15,998.21 Da.
const HBB = "MVHLTPEEKSAVTALWGKVNVDEVGGEALGRLLVVYPWTQRFFESFGDLSTPDAVMGNPKVKAHGKKVLGAFSDGLAHLDNLKGTFATLSELHCDKLHVDPENFRLLGNVLVCVLAHHFGKEFTPPVQAAYQKVVAGVANALAHKYH";

if (!executable || !fs.existsSync(executable)) {
  console.error(`Engine not found: ${executable}`);
  process.exit(1);
}

const scratch = fs.mkdtempSync(path.join(os.tmpdir(), "protein-labs-engine-"));
let output = "";
const engine = spawn(path.resolve(executable), ["--host", "127.0.0.1", "--port", String(port), "--database", path.join(scratch, "projects.sqlite3")], {
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
engine.stdout.on("data", (chunk) => { output += chunk; });
engine.stderr.on("data", (chunk) => { output += chunk; });
let exited = false;
engine.on("exit", () => { exited = true; });

// The PyInstaller bootloader runs the engine as a child process, so the whole
// tree has to go on Windows.
function stop() {
  if (exited) return;
  if (process.platform === "win32") spawnSync("taskkill", ["/pid", String(engine.pid), "/t", "/f"], { stdio: "ignore" });
  else engine.kill("SIGTERM");
}

async function request(route, body) {
  const response = await fetch(`${base}${route}`, body === undefined ? {} : {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw new Error(`${route} answered ${response.status}`);
  return response.json();
}

try {
  // A onefile engine unpacks itself on first start; Windows Defender scans
  // every file, so allow well over a minute.
  const deadline = Date.now() + 120_000;
  let health;
  while (!health) {
    if (exited) throw new Error("The engine exited before answering.");
    if (Date.now() > deadline) throw new Error("The engine did not answer /v1/health within 120 s.");
    health = await request("/v1/health").catch(() => undefined);
    if (!health) await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (health.service !== "protein-labs") throw new Error(`Unexpected health reply: ${JSON.stringify(health)}`);
  console.log(`Engine healthy: ${JSON.stringify(health)}`);

  const { result } = await request("/v1/protein-planner/analyze-sequence", { sequence: HBB });
  if (Math.abs(result.molecularWeightDa - 15998.21) > 0.05) throw new Error(`HBB mass came back as ${result.molecularWeightDa} Da.`);
  console.log(`HBB: ${result.molecularWeightDa.toFixed(2)} Da, pI ${result.theoreticalPI.toFixed(2)}`);
  console.log("Engine smoke test passed.");
} catch (error) {
  console.error(`Engine smoke test failed: ${error instanceof Error ? error.message : error}`);
  console.error(output.slice(-4000));
  process.exitCode = 1;
} finally {
  stop();
}
