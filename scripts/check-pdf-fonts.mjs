// Every route that draws a PDF must ship pdfkit's standard fonts. pdfkit loads
// them with require("#standard-fonts/...") at run time, which the build trace
// misses, so next.config.mjs adds them (outputFileTracingIncludes). Each font
// file also requires a shared glyph table in standard-fonts/chunks/. Vercel
// deploys only the traced files: a route without all of them fails on every
// PDF, while next start, with all of node_modules, works (KRB-189).
// Runs after next build (npm run build), so a missing file stops the build.
import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";

const FONTS_DIR = "node_modules/pdfkit/js/standard-fonts";

const PDF_ROUTES = {
  "receipt download": ".next/server/app/api/billing/receipts/[id]/route.js.nft.json",
  "report export": ".next/server/app/api/reports/[id]/exports/route.js.nft.json",
  "final report snapshot": ".next/server/app/[locale]/(app)/rapports/[reportId]/page.js.nft.json",
};

// Every .cjs file pdfkit may load, the chunks included. Their names carry a
// hash that changes with each pdfkit release, so they are read from disk.
const fonts = readdirSync(FONTS_DIR, { recursive: true })
  .map((file) => path.posix.join(FONTS_DIR, String(file).split(path.sep).join("/")))
  .filter((file) => file.endsWith(".cjs"));

const missing = [];
if (!fonts.some((file) => file.includes("/chunks/"))) {
  missing.push(`no chunk file under ${FONTS_DIR}/chunks: check how this pdfkit version loads its fonts`);
}
for (const [name, trace] of Object.entries(PDF_ROUTES)) {
  let files;
  try {
    files = JSON.parse(readFileSync(trace, "utf8")).files;
  } catch (error) {
    missing.push(`${name}: no build trace at ${trace} (${error.code ?? error.message})`);
    continue;
  }
  for (const font of fonts) {
    if (!files.some((file) => file.endsWith(font))) missing.push(`${name}: ${trace} does not ship ${font}`);
  }
}

if (missing.length > 0) {
  console.error("PDF fonts missing from the build (see outputFileTracingIncludes in next.config.mjs):");
  for (const line of missing) console.error(`- ${line}`);
  process.exit(1);
}
console.log(`PDF fonts traced for ${Object.keys(PDF_ROUTES).length} routes (${fonts.length} files each).`);
