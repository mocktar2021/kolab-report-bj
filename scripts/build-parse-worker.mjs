// Bundles the file readers into the files their child processes start from:
// build/parse-worker.cjs for the deliverables (src/lib/deliverables/parse-job.ts)
// and build/plan-worker.cjs for plan imports (src/lib/plan/read-job.ts, KRB-196).
// Next.js bundles the server code itself, but a child process needs a file it
// can start from. Runs before `next build` and `next dev`.
import { build } from "esbuild";

const workers = [
  { entry: "src/lib/deliverables/parse/worker.ts", out: "build/parse-worker.cjs" },
  { entry: "src/lib/plan/worker.ts", out: "build/plan-worker.cjs" },
];

await Promise.all(
  workers.map(({ entry, out }) =>
    build({
      entryPoints: [entry],
      outfile: out,
      bundle: true,
      platform: "node",
      format: "cjs",
      target: "node20",
      minify: true,
      legalComments: "none",
      logLevel: "warning",
    }),
  ),
);
