// Temporary check for KRB-172: does a Lighthouse run land in a renderer
// process that an earlier page of the same site left behind? Lighthouse CI
// shares one Chrome between runs when it signs in with a puppeteerScript.
//
//   node scripts/lighthouse-reuse.mjs <url> [runs] [extra Chrome flag]
import { createRequire } from "node:module";
import lighthouse from "lighthouse";
import { MainThreadTasks } from "lighthouse/core/lib/tracehouse/main-thread-tasks.js";
import { TraceProcessor } from "lighthouse/core/lib/tracehouse/trace-processor.js";
import puppeteer from "puppeteer-core";

const require = createRequire(import.meta.url);
const signIn = require("./lighthouse-login.cjs");
const { chromium } = require("playwright");

const [url, runs = "4", flag] = process.argv.slice(2);
const browser = await puppeteer.launch({
  executablePath: process.env.CHROME_PATH || chromium.executablePath(),
  args: ["--no-sandbox", ...(flag ? [flag] : [])],
});
const session = await browser.target().createCDPSession();
// Renderer pid to the CPU time it has used, in seconds. A spare renderer that
// Chrome keeps ready has used almost none; one that showed a page, much more.
const renderers = async () =>
  new Map(
    (await session.send("SystemInfo.getProcessInfo")).processInfo
      .filter((info) => info.type === "renderer")
      .map((info) => [info.id, info.cpuTime]),
  );

console.log(`${url}, Chrome flag: ${flag ?? "none"}`);
await signIn(browser, { url });
for (let run = 1; run <= Number(runs); run++) {
  const before = await renderers();
  const page = await browser.newPage();
  const { lhr, artifacts } = await lighthouse(
    url,
    { onlyCategories: ["performance"], logLevel: "error" },
    undefined,
    page,
  );
  await page.close();
  const processed = TraceProcessor.processTrace(artifacts.Trace, { timeOriginDeterminationMethod: "auto" });
  const { pid } = processed.mainThreadEvents[0];
  const tasks = MainThreadTasks.getMainThreadTasks(
    processed.mainThreadEvents,
    processed.frames,
    processed.timestamps.traceEnd,
    processed.timestamps.timeOrigin,
  );
  const stall = Math.max(
    0,
    ...tasks.filter((t) => !t.parent && !t.attributableURLs.length).map((t) => t.duration),
  );
  console.log(
    `  run ${run}: score ${Math.round(lhr.categories.performance.score * 100)},` +
      ` TBT ${Math.round(lhr.audits["total-blocking-time"].numericValue)} ms,` +
      ` renderer ${pid} ${before.has(pid) ? `had used ${before.get(pid).toFixed(2)} s of CPU` : "new"},` +
      ` longest unattributed task ${Math.round(stall)} ms`,
  );
}
await browser.close();
