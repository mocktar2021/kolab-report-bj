// Renders ad.html frame by frame with Playwright, either as stills (preview)
// or piped into ffmpeg as a 1080x1920 H.264 video.
//   node render.mjs stills 1.2 5 9.3 ...
//   node render.mjs video out.mp4 [fps] [durationSeconds] [fromFrame] [toFrame]
// CHROMIUM_PATH points at a browser when Playwright's own download is missing.
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const dir = path.dirname(fileURLToPath(import.meta.url));
const [mode, ...args] = process.argv.slice(2);
const cloudChromium = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.CHROMIUM_PATH || (fs.existsSync(cloudChromium) ? cloudChromium : undefined);

const browser = await chromium.launch({ executablePath });
const page = await browser.newPage({
  viewport: { width: 1080, height: 1920 },
  deviceScaleFactor: 1,
});
const timesFile = path.join(dir, "timings.json");
if (fs.existsSync(timesFile)) {
  const times = fs.readFileSync(timesFile, "utf8");
  await page.addInitScript(`window.TIMES = ${times};`);
}
// AD_ENDING=disponible renders the ending for once sign-up is open (KRB-244).
if (process.env.AD_ENDING) {
  await page.addInitScript(`window.AD_ENDING = ${JSON.stringify(process.env.AD_ENDING)};`);
}
await page.goto("file://" + path.join(dir, "ad.html"));
await page.evaluate(() => document.fonts.ready);

if (mode === "stills") {
  fs.mkdirSync(path.join(dir, "stills"), { recursive: true });
  for (const s of args) {
    const t = parseFloat(s);
    await page.evaluate(([t, f]) => window.renderAt(t, f), [t, Math.round(t * 30)]);
    await page.screenshot({
      path: path.join(dir, "stills", `t${t.toFixed(2)}.png`),
    });
  }
} else if (mode === "video") {
  const out = args[0];
  const fps = parseInt(args[1] || "30", 10);
  const dur = parseFloat(args[2] || "52");
  const total = Math.round(dur * fps);
  const from = parseInt(args[3] || "0", 10);
  const to = Math.min(parseInt(args[4] || String(total), 10), total);
  const ff = spawn(
    "ffmpeg",
    [
      "-y",
      "-loglevel",
      "error",
      "-f",
      "image2pipe",
      "-framerate",
      String(fps),
      "-c:v",
      "png",
      "-i",
      "-",
      "-c:v",
      "libx264",
      "-preset",
      "slow",
      "-crf",
      "18",
      "-pix_fmt",
      "yuv420p",
      "-movflags",
      "+faststart",
      out,
    ],
    { stdio: ["pipe", "inherit", "inherit"] },
  );
  for (let f = from; f < to; f++) {
    await page.evaluate(([t, f]) => window.renderAt(t, f), [f / fps, f]);
    const buf = await page.screenshot({ type: "png" });
    if (!ff.stdin.write(buf)) await new Promise((r) => ff.stdin.once("drain", r));
    if (f % 150 === 0) console.log(`frame ${f}/${total}`);
  }
  ff.stdin.end();
  await new Promise((r) => ff.on("close", r));
} else {
  console.error("usage: node render.mjs stills <t...> | video <out.mp4> [fps] [dur] [from] [to]");
  process.exitCode = 1;
}
await browser.close();
