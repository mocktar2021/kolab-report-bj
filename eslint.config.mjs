import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Replaces the default ignores of eslint-config-next, so they are listed again.
  globalIgnores([
    ".next/**",
    "out/**",
    // Git worktrees of local agent sessions, each a full copy of the repository.
    ".claude/worktrees/**",
    "build/**",
    ".lighthouseci/**",
    // Playwright output, such as the HTML report of the smoke tests.
    "playwright-report/**",
    "test-results/**",
    "node_modules/**",
    "public/sw.js",
    "public/workbox-*.js",
    "public/swe-worker-*.js",
    "public/fallback-*.js",
    "src/lib/supabase/database.types.ts",
    "next-env.d.ts",
  ]),
]);

export default eslintConfig;
