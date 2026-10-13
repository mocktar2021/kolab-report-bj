// Bundles the deliverable parsers into one file, build/parse-worker.cjs, for
// the worker thread that reads uploads (src/lib/deliverables/parse-job.ts).
// Next.js bundles the server code itself, but a worker thread needs a file
// it can start from. Runs before `next build` and `next dev`.
import { build } from "esbuild";

await build({
  entryPoints: ["src/lib/deliverables/parse/worker.ts"],
  outfile: "build/parse-worker.cjs",
  bundle: true,
  platform: "node",
  format: "cjs",
  target: "node20",
  minify: true,
  legalComments: "none",
  logLevel: "warning",
});
