// Ports for a visual check, derived from the run rather than hard-coded.
//
// Every copy of the old harness defaulted to the same 8951/8952/945x. Paperclip
// runs agents against this machine in parallel, so on HOM-332 a concurrent run
// already held those ports: the engine and static server silently failed to
// bind, every health check answered 200 from *someone else's* services, and the
// wrong bundle got driven for several minutes. Deriving from $PAPERCLIP_RUN_ID
// makes a collision essentially impossible; `assertFree` catches the rest.
import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { pathToFileURL } from "node:url";

/** Usable, unprivileged, below the ephemeral range Linux hands out by default. */
const LOW = 20000;
const SPAN = 20000;

/**
 * Deterministic engine/http/cdp port triple for a seed.
 *
 * Pure and stable: the same seed always yields the same ports, so a second
 * script in the same run talks to the first script's services.
 */
export function portsFromSeed(seed) {
  const digest = createHash("sha256").update(String(seed || "visual")).digest();
  const base = LOW + (digest.readUInt32BE(0) % SPAN);
  return { engine: base, http: base + 1, cdp: base + 2 };
}

/** Ports for the current run (override any of them with the matching env var). */
export function runPorts(seed = process.env.PAPERCLIP_RUN_ID ?? process.env.USER ?? "visual") {
  const derived = portsFromSeed(seed);
  return {
    engine: Number(process.env.ENGINE_PORT ?? derived.engine),
    http: Number(process.env.HTTP_PORT ?? derived.http),
    cdp: Number(process.env.CDP_PORT ?? derived.cdp),
  };
}

/** Resolve true when nothing holds `port`. */
export const isFree = (port) =>
  new Promise((resolve) => {
    const server = createServer();
    server.once("error", () => resolve(false));
    server.listen(port, "127.0.0.1", () => server.close(() => resolve(true)));
  });

/** Throw unless every port is free, so a collision fails before anything boots. */
export async function assertFree(ports) {
  const taken = [];
  for (const [name, port] of Object.entries(ports)) if (!(await isFree(port))) taken.push(`${name}=${port}`);
  if (taken.length) {
    throw new Error(
      `Visual harness: port(s) already in use: ${taken.join(", ")}. Another run may be holding them; ` +
        `set ENGINE_PORT/HTTP_PORT/CDP_PORT to free ports instead of killing the other process.`,
    );
  }
}

// `node scripts/visual/ports.mjs` prints this run's ports as shell assignments.
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  for (const [name, port] of Object.entries(runPorts())) console.log(`${name.toUpperCase()}_PORT=${port}`);
}
