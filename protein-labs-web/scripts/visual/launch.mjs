// Start a headless Chromium with the DevTools endpoint open.
//
// Kept here so a check is one command. Note the user-data-dir: without a fresh
// one, a Chromium already running on this machine adopts the request and the
// --remote-debugging-port is silently ignored.
import { spawn, spawnSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sleep } from "./cdp.mjs";

const CANDIDATES = ["chromium", "chromium-browser", "google-chrome", "google-chrome-stable"];

const onPath = (name) => spawnSync("sh", ["-c", `command -v ${name}`], { encoding: "utf8" }).stdout.trim();

/** First Chromium-family browser on $PATH. */
export function findChromium() {
  for (const name of CANDIDATES) {
    const resolved = onPath(name);
    if (resolved) return resolved;
  }
  throw new Error(`No Chromium found on PATH (tried ${CANDIDATES.join(", ")}). Set $CHROMIUM.`);
}

/**
 * Launch headless Chromium on `port` and resolve once CDP answers.
 * @returns {Promise<{port: number, stop: () => void}>}
 */
export async function launchChromium({ port, binary = process.env.CHROMIUM, args = [], timeout = 20000 } = {}) {
  const exe = binary || findChromium();
  const profile = mkdtempSync(join(tmpdir(), "visual-chrome-"));
  const child = spawn(
    exe,
    [
      "--headless=new",
      `--remote-debugging-port=${port}`,
      `--user-data-dir=${profile}`,
      "--no-first-run",
      "--no-default-browser-check",
      "--disable-gpu",
      // Do not pass --hide-scrollbars: Chromium treats the switch as present
      // whatever its value, and hiding scrollbars changes clientWidth, which
      // is exactly what the overflow checks measure.
      "--force-device-scale-factor=1",
      ...args,
      "about:blank",
    ],
    { stdio: "ignore" },
  );
  let exited = null;
  child.on("exit", (code) => { exited = code; });

  const started = Date.now();
  for (;;) {
    if (exited !== null) throw new Error(`Chromium (${exe}) exited with ${exited} before CDP came up.`);
    try {
      const response = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (response.ok) break;
    } catch { /* not listening yet */ }
    if (Date.now() - started > timeout) {
      child.kill("SIGKILL");
      throw new Error(`Chromium did not open CDP on ${port} within ${timeout}ms.`);
    }
    await sleep(150);
  }

  return {
    port,
    stop() {
      // Only ever kill the child we spawned. Never `pkill` by port pattern —
      // that takes out whichever concurrent agent run owns the other browser.
      child.kill("SIGKILL");
      rmSync(profile, { recursive: true, force: true });
    },
  };
}
