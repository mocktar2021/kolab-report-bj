// What the main thread does while a page loads, from the trace of one
// Lighthouse run (KRB-172). The Lighthouse report says how long each long
// task is, and "Unattributable" when no script is on its stack. This prints
// what those tasks are made of: style and layout, paint, parsing, garbage
// collection or script, each with its time. For a task with nothing measured
// inside, it lists every trace event of the renderer during it, then when
// each chunk of the HTML arrived.
//
//   LHCI_PROFILE=<profile folder> node scripts/lighthouse-trace.mjs <url>
//
// The page must be served already (next start). For a signed-in page, Chrome
// starts from the profile of scripts/lighthouse-profile.mjs, as in
// scripts/lighthouse-ci.sh. Times are unthrottled: the simulated times of the
// report are about 4 times longer.
import { createRequire } from "node:module";
import lighthouse from "lighthouse";
import { MainThreadTasks } from "lighthouse/core/lib/tracehouse/main-thread-tasks.js";
import { TraceProcessor } from "lighthouse/core/lib/tracehouse/trace-processor.js";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const { chromium } = require("playwright");

const url = process.argv[2];
if (!url) {
  console.error("Usage: node scripts/lighthouse-trace.mjs <url>");
  process.exit(1);
}

const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  userDataDir: process.env.LHCI_PROFILE,
  args: ["--no-sandbox"],
});
let result;
try {
  const page = await browser.newPage();
  result = await lighthouse(url, { onlyCategories: ["performance"], logLevel: "error" }, undefined, page);
} finally {
  await browser.close();
}

const { lhr, artifacts } = result;
const processed = TraceProcessor.processTrace(artifacts.Trace);
const { timestamps } = processed;
const origin = timestamps.timeOrigin;
const ms = (value) => `${Math.round(value)} ms`.padStart(8);
const short = (link) => link.replace(/^https?:\/\/[^/]+/, "").replace(/^\/_next\/static\//, "");

const navigation = TraceProcessor.processNavigation(processed).timings;
console.log(`${url}: performance ${Math.round(lhr.categories.performance.score * 100)}`);
console.log(
  `  observed: first paint ${ms(navigation.firstPaint ?? 0)}, FCP ${ms(navigation.firstContentfulPaint)},` +
    ` LCP ${ms(navigation.largestContentfulPaint ?? 0)}, DOMContentLoaded ${ms(navigation.domContentLoaded ?? 0)},` +
    ` load ${ms(navigation.load ?? 0)}`,
);

const breakdown = lhr.audits["mainthread-work-breakdown"].details?.items ?? [];
console.log(
  `  main thread, simulated: ${breakdown.map((item) => `${item.groupLabel} ${Math.round(item.duration)} ms`).join(", ")}`,
);

const tasks = MainThreadTasks.getMainThreadTasks(
  processed.mainThreadEvents,
  processed.frames,
  timestamps.traceEnd,
  origin,
);

/** Self time per trace event name under a task, the longest first. */
function partsOf(task) {
  const parts = new Map();
  const visit = (node) => {
    const name =
      node.event.name === "EvaluateScript" || node.event.name === "FunctionCall"
        ? `${node.event.name} ${short(node.event.args?.data?.url ?? "") || "(no url)"}`
        : node.event.name;
    parts.set(name, (parts.get(name) ?? 0) + node.selfTime);
    node.children.forEach(visit);
  };
  visit(task);
  return [...parts].sort((a, b) => b[1] - a[1]).filter(([, time]) => time >= 2);
}

console.log("  tasks of 20 ms or more, unthrottled (start, duration, script):");
for (const task of tasks.filter((t) => !t.parent && t.duration >= 20)) {
  const script = task.attributableURLs.length ? short(task.attributableURLs[0]) : "Unattributable";
  console.log(`  ${ms(task.startTime)} ${ms(task.duration)}  ${script}`);
  for (const [name, time] of partsOf(task).slice(0, 8)) console.log(`             ${ms(time)}  ${name}`);
}

// A long task with nothing measured inside: every trace event of the
// renderer during it, on any thread, to see what the main thread waits for.
const threadNames = new Map();
for (const event of artifacts.Trace.traceEvents) {
  if (event.ph === "M" && event.name === "thread_name")
    threadNames.set(`${event.pid}:${event.tid}`, event.args.name);
}
const { pid } = processed.mainThreadEvents[0];
for (const task of tasks.filter((t) => !t.parent && t.duration >= 50 && !t.attributableURLs.length)) {
  const from = origin + task.startTime * 1000;
  const to = origin + task.endTime * 1000;
  const seen = new Map();
  for (const event of artifacts.Trace.traceEvents) {
    if (event.pid !== pid || event.ts < from || event.ts > to || event.ph === "M") continue;
    const key = `${threadNames.get(`${event.pid}:${event.tid}`) ?? event.tid} ${event.ph} ${event.name}`;
    const entry = seen.get(key) ?? { count: 0, first: event.ts, time: 0 };
    entry.count += 1;
    entry.time += (event.dur ?? 0) / 1000;
    seen.set(key, entry);
  }
  console.log(
    `  events during the task at ${ms(task.startTime)} (thread, phase, name: count, first at, time):`,
  );
  for (const [key, entry] of [...seen].sort((a, b) => a[1].first - b[1].first).slice(0, 40)) {
    console.log(`    ${key}: ${entry.count}, ${ms((entry.first - origin) / 1000)}, ${ms(entry.time)}`);
  }
}

// When the HTML arrived: a streamed page comes in several chunks.
const log = artifacts.DevtoolsLog;
const documentRequest = log.find(
  (entry) => entry.method === "Network.requestWillBeSent" && entry.params.type === "Document",
);
if (documentRequest) {
  const id = documentRequest.params.requestId;
  const at = (seconds) => ms(seconds * 1000 - origin / 1000);
  console.log("  the HTML document (ms after navigation start):");
  for (const entry of log) {
    if (entry.params?.requestId !== id) continue;
    if (entry.method === "Network.responseReceived") {
      console.log(`  ${at(entry.params.timestamp)}  response headers`);
    } else if (entry.method === "Network.dataReceived") {
      console.log(`  ${at(entry.params.timestamp)}  ${entry.params.dataLength} bytes`);
    } else if (entry.method === "Network.loadingFinished") {
      console.log(
        `  ${at(entry.params.timestamp)}  done, ${entry.params.encodedDataLength} bytes on the wire`,
      );
    }
  }
}

// When each script of the page ran, against the first paint: Lighthouse counts
// a script that ran before the observed paint as needed for LCP.
const firstRuns = new Map();
for (const event of processed.mainThreadEvents) {
  const scriptUrl = event.name === "EvaluateScript" ? event.args?.data?.url : undefined;
  if (scriptUrl && !firstRuns.has(scriptUrl)) firstRuns.set(scriptUrl, (event.ts - origin) / 1000);
}
console.log("  first run of each script (ms after navigation start):");
for (const [scriptUrl, time] of [...firstRuns].sort((a, b) => a[1] - b[1]).slice(0, 25)) {
  console.log(`  ${ms(time)}  ${short(scriptUrl)}`);
}
