// Test config. Vitest ran without one until components that use the "@/"
// alias needed rendering in a test: `components/ui/button.tsx` imports
// "@/lib/utils", so a component test could not load it. The alias matches
// `tsconfig.json` and `desktop/vite.config.ts`; nothing else is changed, so
// the default include patterns and the Node environment still apply.
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL(".", import.meta.url)).replace(/\/$/, "") },
  },
});
