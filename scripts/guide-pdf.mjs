#!/usr/bin/env node
// Prints the user guide page (/fr/guide, KRB-199) to
// public/guide/guide-kolabreport.pdf with Chromium, the PDF linked from the
// page as "Télécharger le guide en PDF".
//
//   npm run build && npm run guide:pdf
//
// It starts `next start` on GUIDE_PDF_PORT (3900 by default) and stops it at
// the end, or uses GUIDE_BASE_URL when set (for example a server you already
// run). The page needs no account and no database: the guide is static.
// The path must match GUIDE_PDF_PATH in src/content/guide/pages.ts, which
// src/content/guide/guide.test.ts checks.

import { spawn } from "node:child_process";
import { writeFile } from "node:fs/promises";
import { createRequire } from "node:module";
import path from "node:path";
import { chromium } from "@playwright/test";

const OUTPUT = path.join(process.cwd(), "public", "guide", "guide-kolabreport.pdf");
const PORT = Number(process.env.GUIDE_PDF_PORT || 3900);
const given = process.env.GUIDE_BASE_URL?.trim().replace(/\/+$/, "");

/** A4 at 96 dpi, less the 16 mm side margins: the width the page is laid out at. */
const PRINT_WIDTH = 674;

async function waitFor(url, timeoutMs = 60_000) {
  const end = Date.now() + timeoutMs;
  while (Date.now() < end) {
    try {
      const response = await fetch(url, { redirect: "manual" });
      if (response.ok) return;
    } catch {
      // Not listening yet.
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  throw new Error(`${url} did not answer within ${timeoutMs / 1000} s. Did you run npm run build?`);
}

function startServer() {
  const next = createRequire(import.meta.url).resolve("next/dist/bin/next");
  const server = spawn(process.execPath, [next, "start", "-p", String(PORT)], {
    stdio: ["ignore", "ignore", "inherit"],
    env: process.env,
  });
  return server;
}

async function main() {
  const server = given ? null : startServer();
  const base = given ?? `http://localhost:${PORT}`;
  const browser = await chromium.launch();
  try {
    await waitFor(`${base}/fr/guide`);
    // Light theme and the print layout from the start, so the screenshots
    // load at the size the PDF shows them.
    const context = await browser.newContext({
      locale: "fr-FR",
      colorScheme: "light",
      viewport: { width: PRINT_WIDTH, height: 1000 },
      deviceScaleFactor: 1.5,
    });
    await context.addInitScript(() => window.localStorage.setItem("kolabreport:theme", "light"));
    const page = await context.newPage();
    await page.emulateMedia({ media: "print" });
    await page.goto(`${base}/fr/guide`, { waitUntil: "networkidle" });

    // next/image loads the screenshots lazily, when they come near the
    // window. Load them all now, then wait for them and for the fonts. The
    // first request of each one waits for the image optimizer.
    await page.evaluate(() => {
      for (const image of document.querySelectorAll('img[loading="lazy"]')) image.loading = "eager";
    });
    await page.waitForFunction(
      () => Array.from(document.images).every((image) => image.complete && image.naturalWidth > 0),
      undefined,
      { timeout: 120_000 },
    );
    await page.evaluate(() => document.fonts.ready);

    const pdf = await page.pdf({
      format: "A4",
      // White pages: the gray of the app's background would stop at the margins.
      printBackground: false,
      // Headings become bookmarks, and the PDF is tagged for screen readers.
      outline: true,
      tagged: true,
      margin: { top: "16mm", bottom: "18mm", left: "16mm", right: "16mm" },
      displayHeaderFooter: true,
      headerTemplate: "<span></span>",
      footerTemplate:
        '<div style="width:100%;font-family:sans-serif;font-size:8px;color:#6b7280;text-align:center;">Guide d\'utilisation de KolabReport, page <span class="pageNumber"></span> sur <span class="totalPages"></span></div>',
    });
    await writeFile(OUTPUT, pdf);
    console.log(`${path.relative(process.cwd(), OUTPUT)}: ${(pdf.length / 1024).toFixed(0)} KB`);
  } finally {
    await browser.close();
    server?.kill("SIGTERM");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
