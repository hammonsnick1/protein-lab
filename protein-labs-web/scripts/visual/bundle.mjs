// Prove the bundle being served is the one you just built.
//
// `curl /` returning 200 only proves *something* is listening. On HOM-332 a
// concurrent run held the harness's hard-coded ports, so the static server
// never bound, the health check passed against the other agent's server, and
// the wrong bundle got driven for several minutes before the missing tab gave
// it away. This compares the served bytes against the files on disk, so a
// stale or foreign server fails before any screenshot is taken.
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { join } from "node:path";

const sha = (data) => createHash("sha256").update(data).digest("hex").slice(0, 12);

/** Entry assets Vite references from index.html. */
const entryAssets = (html) =>
  [...html.matchAll(/(?:src|href)="([^"]*\/assets\/[^"]+\.(?:js|css))"/g)].map((match) => match[1]);

const fetchBytes = async (url) => {
  let response;
  try {
    response = await fetch(url);
  } catch (cause) {
    throw new Error(`Visual harness: nothing served ${url} (${cause.message}). Is the static server running?`);
  }
  if (!response.ok) throw new Error(`Visual harness: ${url} returned ${response.status}.`);
  return Buffer.from(await response.arrayBuffer());
};

/**
 * Throw unless `base` serves exactly the build in `dist`.
 *
 * @param {object} options
 * @param {string} options.base origin the browser will be pointed at
 * @param {string} options.dist build directory on disk (e.g. `desktop-dist`)
 * @param {string} [options.marker] string your change puts in the bundle; when
 *   given, at least one served asset must contain it. Belt and braces for the
 *   case where you rebuilt without the change you think you are looking at.
 * @returns {Promise<{base: string, dist: string, assets: string[]}>}
 */
export async function assertServedBundle({ base, dist, marker }) {
  const origin = base.replace(/\/+$/, "");

  let local;
  try {
    local = await readFile(join(dist, "index.html"), "utf8");
  } catch (cause) {
    throw new Error(`Visual harness: no build at ${dist}/index.html (${cause.message}). Run \`npm run build\` first.`);
  }

  const served = (await fetchBytes(`${origin}/index.html`)).toString("utf8");
  if (served.trim() !== local.trim()) {
    throw new Error(
      `Visual harness: ${origin} is NOT serving ${dist}.\n` +
        `  served index.html sha=${sha(served)} (${served.length} bytes)\n` +
        `  on-disk index.html sha=${sha(local)} (${local.length} bytes)\n` +
        `Most likely another run holds this port. Pick free ports (scripts/visual/ports.mjs) ` +
        `and serve with an explicit -d ${dist}.`,
    );
  }

  const assets = entryAssets(local);
  if (!assets.length) throw new Error(`Visual harness: ${dist}/index.html references no /assets/ entry; unexpected build layout.`);

  let markerSeen = false;
  for (const asset of assets) {
    const path = join(dist, asset.replace(/^\/+/, "").replace(/^.*?assets\//, "assets/"));
    const [onDisk, overWire] = await Promise.all([readFile(path), fetchBytes(`${origin}${asset.startsWith("/") ? "" : "/"}${asset}`)]);
    if (!onDisk.equals(overWire)) {
      throw new Error(
        `Visual harness: ${origin}${asset} differs from ${path}\n` +
          `  served sha=${sha(overWire)} (${overWire.length} bytes), on-disk sha=${sha(onDisk)} (${onDisk.length} bytes)\n` +
          `Another server is answering on this port, or the build changed under you.`,
      );
    }
    if (marker && overWire.includes(marker)) markerSeen = true;
  }

  if (marker && !markerSeen) {
    throw new Error(
      `Visual harness: none of the served assets (${assets.join(", ")}) contain the marker ${JSON.stringify(marker)}. ` +
        `The served bundle predates your change — rebuild before screenshotting.`,
    );
  }

  return { base: origin, dist, assets };
}
