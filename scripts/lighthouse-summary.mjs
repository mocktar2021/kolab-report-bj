// Prints what Lighthouse CI measured, from the reports it writes to
// .lighthouseci/reports (KRB-172). `lhci assert` only prints the assertions
// that fail, and the report artifact is a download away. This puts in the
// job log, for each page: the performance score of every run and their
// median, then for the run Lighthouse CI picked as the median: the main
// metrics, the scripts that cost the most main thread, and the long tasks.
//
//   node scripts/lighthouse-summary.mjs [reports folder]
import { readFileSync } from "node:fs";
import { join } from "node:path";

const dir = process.argv[2] ?? ".lighthouseci/reports";

let manifest;
try {
  manifest = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf8"));
} catch {
  console.log(`No Lighthouse reports in ${dir}.`);
  process.exit(0);
}

const ms = (value) => `${Math.round(value)} ms`;
const kib = (bytes) => `${Math.round(bytes / 1024)} KiB`;
const score = (value) => (value == null ? "n/a" : Math.round(value * 100));
const short = (url) => url.replace(/^https?:\/\/[^/]+/, "").replace(/^\/_next\/static\//, "");

const pages = new Map();
for (const entry of manifest) {
  const path = new URL(entry.url).pathname;
  if (!pages.has(path)) pages.set(path, []);
  pages.get(path).push(entry);
}

for (const [path, runs] of pages) {
  const scores = runs.map((run) => run.summary.performance);
  const sorted = [...scores].sort((a, b) => a - b);
  const median = sorted[Math.floor(sorted.length / 2)];
  console.log(`\n${path}: performance ${scores.map(score).join(", ")} (median ${score(median)})`);

  const representative = runs.find((run) => run.isRepresentativeRun) ?? runs[0];
  const lhr = JSON.parse(readFileSync(representative.jsonPath, "utf8"));
  const audit = (id) => lhr.audits[id] ?? {};
  const metric = (id) => audit(id).numericValue ?? 0;
  const scripts = (audit("resource-summary").details?.items ?? []).find(
    (item) => item.resourceType === "script",
  );

  console.log(
    `  median run: FCP ${ms(metric("first-contentful-paint"))}, LCP ${ms(metric("largest-contentful-paint"))},` +
      ` TBT ${ms(metric("total-blocking-time"))}, SI ${ms(metric("speed-index"))},` +
      ` CLS ${metric("cumulative-layout-shift").toFixed(3)}, server ${ms(metric("server-response-time"))},` +
      ` JavaScript ${kib(scripts?.transferSize ?? 0)} in ${scripts?.requestCount ?? 0} files,` +
      ` benchmark index ${Math.round(lhr.environment?.benchmarkIndex ?? 0)}`,
  );

  console.log("  main thread per script (total, of which scripting):");
  for (const item of (audit("bootup-time").details?.items ?? []).slice(0, 8)) {
    console.log(
      `    ${ms(item.total).padStart(8)} ${ms(item.scripting ?? 0).padStart(8)}  ${short(item.url)}`,
    );
  }

  console.log("  long tasks (start, duration):");
  for (const task of (audit("long-tasks").details?.items ?? []).slice(0, 8)) {
    console.log(`    ${ms(task.startTime).padStart(8)} ${ms(task.duration).padStart(8)}  ${short(task.url)}`);
  }
}
