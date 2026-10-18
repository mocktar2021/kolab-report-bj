// @vitest-environment node
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { beforeAll, describe, expect, it } from "vitest";
import { deflatedSpaces, testPdf } from "../pdf/test-pdf";
import { readPlanInWorker } from "./read-job";
import { PlanReadError } from "./types";

// Reads plans the way the import route does: bundled by esbuild, in a child
// process with a memory limit and a deadline.

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/plans/${name}`, import.meta.url)));

async function errorKey(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof PlanReadError)) throw new Error(`expected a PlanReadError, got ${String(error)}`);
  return error.key;
}

let file: string;

beforeAll(async () => {
  file = path.join(mkdtempSync(path.join(tmpdir(), "plan-worker-")), "plan-worker.cjs");
  await build({
    entryPoints: [path.join(import.meta.dirname, "worker.ts")],
    outfile: file,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
  });
}, 60_000);

const soon = () => Date.now() + 20_000;

describe("readPlanInWorker", () => {
  it("reads a Word plan", async () => {
    const result = await readPlanInWorker("docx", fixture("tdr-titres.docx"), soon(), { file });
    expect(result.kind === "plan" && result.plan?.items.map((item) => item.title)).toEqual([
      "Contexte et justification",
      "Objectifs de l'étude",
      "Objectif général",
      "Objectifs spécifiques",
      "Méthodologie",
      "Livrables attendus",
    ]);
  });

  it("reads the text of a PDF", async () => {
    const result = await readPlanInWorker("pdf", fixture("tdr.pdf"), soon(), { file });
    expect(result).toMatchObject({ kind: "pdf", pages: 2 });
    expect(result.kind === "pdf" && result.text).toContain("2.2 Objectifs spécifiques");
  });

  it("reads pasted text sent as a text file", async () => {
    const bytes = new TextEncoder().encode("1. Contexte\n2. Objectifs\n2.1 Général");
    const result = await readPlanInWorker("txt", bytes, soon(), { file });
    expect(result.kind === "plan" && result.plan?.items.map((item) => item.level)).toEqual([1, 1, 2]);
  });

  it("says when a PDF has no text", async () => {
    const empty = new TextEncoder().encode(
      "%PDF-1.4\n1 0 obj << /Type /Catalog /Pages 2 0 R >> endobj\n2 0 obj << /Type /Pages /Kids [3 0 R] /Count 1 >> endobj\n3 0 obj << /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] >> endobj\ntrailer << /Root 1 0 R >>\n%%EOF",
    );
    expect(await errorKey(readPlanInWorker("pdf", empty, soon(), { file }))).toBe("pdfNoText");
  });

  // pdf.js decodes a stream outside the heap, which --max-old-space-size does
  // not limit: 2 MB here decode to 512 MB. The memory watch reads /proc.
  it.runIf(process.platform === "linux")(
    "calls a PDF too large when its streams pass the memory limit",
    async () => {
      const bomb = testPdf([["1. Contexte"]], { deflated: await deflatedSpaces(512) });
      expect(await errorKey(readPlanInWorker("pdf", bomb, soon(), { file, memoryMb: 300 }))).toBe("tooLarge");
    },
    30_000,
  );

  it("stops a read at the deadline", async () => {
    expect(await errorKey(readPlanInWorker("pdf", fixture("tdr.pdf"), Date.now() + 1, { file }))).toBe(
      "timeout",
    );
  });
});
