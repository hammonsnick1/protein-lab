import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const projectDir = path.resolve(desktopDir, "..");

// The desktop bundle has no Node at runtime, so the API origin is baked in at
// build time. Without this the NEXT_PUBLIC_PROTEIN_LABS_API override that the
// README documents is silently ignored and the app always uses port 8770.
const configuredApi = process.env.NEXT_PUBLIC_PROTEIN_LABS_API ?? "";

// The page's CSP names the API origin explicitly, so an override has to be
// reflected there too; otherwise connect-src blocks every request to it and
// the documented override cannot work. 'self' additionally allows serving the
// UI and API from one origin, which is how the dev proxy runs.
function cspPlugin(api: string) {
  return {
    name: "protein-labs-csp",
    transformIndexHtml(html: string) {
      const origins = ["'self'", "http://127.0.0.1:8770", api].filter(Boolean);
      return html.replace(
        /connect-src [^;"]+/,
        `connect-src ${[...new Set(origins)].join(" ")}`,
      );
    },
  };
}

export default defineConfig({
  root: desktopDir,
  base: "./",
  plugins: [react(), cspPlugin(configuredApi)],
  resolve: { alias: { "@": projectDir } },
  // Only inject when configured: an injected empty string would switch the
  // packaged app to same-origin requests, which has no server behind it.
  define: configuredApi ? { __PROTEIN_LABS_API__: JSON.stringify(configuredApi) } : {},
  build: {
    outDir: path.join(projectDir, "desktop-dist"),
    emptyOutDir: true,
    sourcemap: false,
  },
});
