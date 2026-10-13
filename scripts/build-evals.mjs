// Bundles the eval runner (evals/run.ts) into build/evals.mjs, so `npm run
// eval` runs it with plain node. esbuild resolves the "@/" paths of
// tsconfig.json; packages from node_modules stay as imports. The app's
// "server-only" marker throws outside Next.js, so it becomes an empty module.
import { build } from "esbuild";

/** @type {import("esbuild").Plugin} */
const serverOnly = {
  name: "server-only",
  setup(builder) {
    builder.onResolve({ filter: /^server-only$/ }, () => ({ path: "server-only", namespace: "empty" }));
    builder.onLoad({ filter: /.*/, namespace: "empty" }, () => ({ contents: "export {};", loader: "js" }));
  },
};

await build({
  entryPoints: ["evals/run.ts"],
  outfile: "build/evals.mjs",
  bundle: true,
  platform: "node",
  format: "esm",
  target: "node20",
  packages: "external",
  plugins: [serverOnly],
  legalComments: "none",
  logLevel: "warning",
});
