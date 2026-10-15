import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

// Test files that load the whole machine on purpose. The parse worker test
// builds a document of 200 000 paragraphs and runs a worker out of memory,
// which slowed quick tests running next to it past their 5 s timeout
// (KRB-191). They run alone, after every other file.
const ALONE = ["src/lib/deliverables/parse-job.test.ts"];

export default defineConfig({
  esbuild: { jsx: "automatic" },
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // next/server-only throws outside a React Server Component build.
      "server-only": fileURLToPath(new URL("./vitest.server-only.ts", import.meta.url)),
    },
  },
  test: {
    environment: "jsdom",
    setupFiles: ["./vitest.setup.ts"],
    restoreMocks: true,
    projects: [
      {
        extends: true,
        test: {
          name: "unit",
          include: ["src/**/*.test.{ts,tsx}", "evals/**/*.test.ts", "scripts/**/*.test.ts"],
          exclude: [...configDefaults.exclude, ...ALONE],
          sequence: { groupOrder: 0 },
        },
      },
      {
        extends: true,
        test: {
          name: "alone",
          include: ALONE,
          sequence: { groupOrder: 1 },
        },
      },
    ],
  },
});
