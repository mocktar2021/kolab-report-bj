import { dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({
  baseDirectory: dirname(fileURLToPath(import.meta.url)),
});

const eslintConfig = [
  ...compat.extends("next/core-web-vitals", "next/typescript"),
  {
    ignores: [
      ".next/**",
      // Git worktrees of local agent sessions, each a full copy of the repository.
      ".claude/worktrees/**",
      "build/**",
      "node_modules/**",
      "public/sw.js",
      "public/workbox-*.js",
      "public/swe-worker-*.js",
      "public/fallback-*.js",
      "src/lib/supabase/database.types.ts",
      "next-env.d.ts",
    ],
  },
];

export default eslintConfig;
