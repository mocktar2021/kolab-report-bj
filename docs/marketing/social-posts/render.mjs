// Renders every image of posts.html to PNG (KRB-246):
// 6 slides x 3 formats x 2 endings, in out/<ending>/<format>/.
//   node render.mjs                 all of them
//   node render.mjs disponible fil  one ending and one format
// CHROMIUM_PATH points at a browser when Playwright's own download is missing.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const dir = path.dirname(fileURLToPath(import.meta.url));
const FORMATS = { fil: 1350, carre: 1080, story: 1920 };
const SLIDES = ["accroche", "plan", "equipe", "ia", "rapport", "essai"];
const [onlyEnding, onlyFormat] = process.argv.slice(2);
const endings = onlyEnding ? [onlyEnding] : ["lancement", "disponible"];
const formats = onlyFormat ? [onlyFormat] : Object.keys(FORMATS);

const cloudChromium = "/opt/pw-browsers/chromium";
const executablePath =
  process.env.CHROMIUM_PATH || (fs.existsSync(cloudChromium) ? cloudChromium : undefined);
const browser = await chromium.launch({ executablePath });

let failed = 0;
for (const e of endings) {
  for (const f of formats) {
    const page = await browser.newPage({ viewport: { width: 1080, height: FORMATS[f] } });
    const out = path.join(dir, "out", e, f);
    fs.mkdirSync(out, { recursive: true });
    for (const [i, name] of SLIDES.entries()) {
      await page.goto(`file://${path.join(dir, "posts.html")}?f=${f}&s=${i + 1}&e=${e}`);
      const problems = await page.evaluate(() => window.FIT);
      const file = path.join(out, `${i + 1}-${name}.png`);
      await page.locator("#post").screenshot({ path: file });
      if (problems.length) {
        failed++;
        console.error(`${path.relative(dir, file)}: ${problems.join(", ")}`);
      }
    }
    await page.close();
  }
}
await browser.close();
console.log(failed ? `${failed} image(s) to fix` : "all images fit");
process.exitCode = failed ? 1 : 0;
