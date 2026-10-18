// @vitest-environment node
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { build } from "esbuild";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { deflatedSpaces, testPdf } from "../pdf/test-pdf";
import { parseInWorker } from "./parse-job";
import { zip } from "./parse/test-zip";
import { ParseError } from "./parse/types";

// Runs the parsers the way the app does: bundled by esbuild, in a child
// process with memory limits and a deadline. No database here.
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));

const fixture = (name: string) =>
  new Uint8Array(readFileSync(new URL(`../../../tests/fixtures/deliverables/${name}`, import.meta.url)));

const text = (value: string) => new TextEncoder().encode(value);

/** A .docx whose body holds this many one-word paragraphs. */
function docxWithParagraphs(count: number): Uint8Array {
  const word = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
  return zip([
    {
      name: "[Content_Types].xml",
      data: text(
        '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>',
      ),
    },
    {
      name: "_rels/.rels",
      data: text(
        '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>',
      ),
    },
    {
      name: "word/document.xml",
      data: text(
        `<w:document xmlns:w="${word}"><w:body>${"<w:p><w:r><w:t>mot</w:t></w:r></w:p>".repeat(count)}</w:body></w:document>`,
      ),
    },
  ]);
}

async function errorKey(work: Promise<unknown>): Promise<string> {
  const error = await work.then(
    () => null,
    (reason: unknown) => reason,
  );
  if (!(error instanceof ParseError)) throw new Error(`expected a ParseError, got ${String(error)}`);
  return error.key;
}

let file: string;

beforeAll(async () => {
  file = path.join(mkdtempSync(path.join(tmpdir(), "parse-worker-")), "parse-worker.cjs");
  await build({
    entryPoints: [path.join(import.meta.dirname, "parse/worker.ts")],
    outfile: file,
    bundle: true,
    platform: "node",
    format: "cjs",
    logLevel: "silent",
  });
}, 30_000);

const soon = () => Date.now() + 20_000;

describe("parseInWorker", () => {
  it("reads a docx", async () => {
    const result = await parseInWorker("docx", fixture("etude-thermique.docx"), soon(), { file });
    expect(result.status === "parsed" && result.markdown).toContain("# Étude thermique du bâtiment");
  });

  it("reads a CSV", async () => {
    const result = await parseInWorker("csv", fixture("releves.csv"), soon(), { file });
    expect(result).toMatchObject({ status: "parsed", meta: { kind: "spreadsheet" } });
  });

  it("reads a PDF, and keeps one without text as is", async () => {
    const result = await parseInWorker("pdf", testPdf([["Plan masse", "Surface : 1 200 m²"]]), soon(), {
      file,
    });
    expect(result).toMatchObject({ status: "parsed", markdown: "Plan masse\nSurface : 1 200 m²" });
    const scan = await parseInWorker("pdf", testPdf([[]], { image: true }), soon(), { file });
    expect(scan).toMatchObject({ status: "skipped", meta: { kind: "pdf", reason: "noText" } });
  });

  it("passes on the parser's error", async () => {
    expect(await errorKey(parseInWorker("docx", fixture("illisible.docx"), soon(), { file }))).toBe(
      "corrupt",
    );
  });

  it("stops the worker at the deadline", async () => {
    const work = parseInWorker("docx", docxWithParagraphs(50_000), Date.now() + 50, { file });
    expect(await errorKey(work)).toBe("timeout");
  });

  it("calls a file too large when the worker runs out of memory, and the server keeps going", async () => {
    const work = parseInWorker("docx", docxWithParagraphs(200_000), soon(), { file, heapMb: 32 });
    expect(await errorKey(work)).toBe("tooLarge");
    const result = await parseInWorker("docx", fixture("etude-thermique.docx"), soon(), { file });
    expect(result.status).toBe("parsed");
  }, 30_000);

  // pdf.js decodes a stream outside the heap, which --max-old-space-size does
  // not limit: 2 MB here decode to 512 MB. The memory watch reads /proc.
  it.runIf(process.platform === "linux")(
    "calls a PDF too large when its streams pass the memory limit, and the server keeps going",
    async () => {
      const bomb = testPdf([["Titre"]], { deflated: await deflatedSpaces(512) });
      const work = parseInWorker("pdf", bomb, soon(), { file, memoryMb: 300 });
      expect(await errorKey(work)).toBe("tooLarge");
      const result = await parseInWorker("pdf", testPdf([["Titre"]]), soon(), { file, memoryMb: 300 });
      expect(result.status).toBe("parsed");
    },
    30_000,
  );
});
