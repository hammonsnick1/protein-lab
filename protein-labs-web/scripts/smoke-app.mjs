// Smoke-tests an installed or unpacked desktop build: launches it with
// `--smoke-test` on a throwaway profile, which starts the bundled engine,
// renders the workspace and exits 0, or exits 1 if any step fails.
//
//   node scripts/smoke-app.mjs <path to the app executable> [extra switches]
//
// Linux CI runs this under xvfb-run and passes --no-sandbox.
import { spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const [executable, ...extra] = process.argv.slice(2);
if (!executable || !fs.existsSync(executable)) {
  console.error(`App not found: ${executable}`);
  process.exit(1);
}

const profile = fs.mkdtempSync(path.join(os.tmpdir(), "protein-labs-app-"));
const app = spawn(path.resolve(executable), ["--smoke-test", `--user-data-dir=${profile}`, ...extra], {
  stdio: "inherit",
  env: { ...process.env, APPIMAGE_EXTRACT_AND_RUN: "1" },
});

const timeout = setTimeout(() => {
  console.error("The app did not finish its smoke test within 180 s.");
  app.kill("SIGKILL");
}, 180_000);

app.on("exit", (code, signal) => {
  clearTimeout(timeout);
  const log = path.join(profile, "logs", "desktop.log");
  console.log(`--- ${log}`);
  console.log(fs.existsSync(log) ? fs.readFileSync(log, "utf8") : "(no log written)");
  const passed = code === 0 && fs.existsSync(log) && fs.readFileSync(log, "utf8").includes("Smoke test passed.");
  console.log(passed ? "App smoke test passed." : `App smoke test failed (exit ${signal || code}).`);
  process.exit(passed ? 0 : 1);
});
