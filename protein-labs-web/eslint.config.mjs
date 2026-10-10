import js from "@eslint/js";
import globals from "globals";
import reactHooks from "eslint-plugin-react-hooks";
import tseslint from "typescript-eslint";
import { defineConfig, globalIgnores } from "eslint/config";

// The desktop app is plain React, so it lints with typescript-eslint and the
// React Hooks rules directly. It used to extend eslint-config-next, which
// pulled the whole Next.js framework in as a dependency for lint alone.
export default defineConfig([
  globalIgnores(["desktop-dist/**", "release/**", "dist/**", "build/**"]),
  js.configs.recommended,
  ...tseslint.configs.recommended,
  reactHooks.configs["recommended-latest"],
  {
    languageOptions: {
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    files: ["desktop/electron/**/*.cjs"],
    rules: {
      "@typescript-eslint/no-require-imports": "off",
    },
  },
  {
    files: ["components/ui/**/*.{ts,tsx}"],
    rules: {
      // Vendored verbatim from shadcn. Keep the registry source intact while
      // the stricter rules apply to the app's own code.
      "@typescript-eslint/no-unused-vars": "off",
      "react-hooks/purity": "off",
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);
