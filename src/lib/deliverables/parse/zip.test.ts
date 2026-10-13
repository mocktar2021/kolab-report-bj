// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { zip } from "./test-zip";
import { PARSE_LIMITS, ParseError } from "./types";
import { guardZip, zipEntries } from "./zip";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../../tests/fixtures/deliverables/${name}`, import.meta.url));

const MB = 1024 * 1024;

const text = (value: string) => new TextEncoder().encode(value);
const zeros = (size: number) => new Uint8Array(size);
const DOCUMENT = { name: "word/document.xml", data: text("<w:document/>") };

/** Key of the ParseError guardZip throws, or null when it lets the bytes through. */
function guardKey(bytes: Uint8Array): string | null {
  try {
    guardZip(bytes);
    return null;
  } catch (error) {
    if (error instanceof ParseError) return error.key;
    throw error;
  }
}

describe("zipEntries", () => {
  it("reads the entries of a real docx", () => {
    const entries = zipEntries(fixture("etude-thermique.docx"));
    expect(entries).toHaveLength(7);
    expect(entries?.map((entry) => entry.name)).toContain("word/document.xml");
  });

  it("reads bytes that sit inside a larger buffer", () => {
    const docx = fixture("etude-thermique.docx");
    const padded = new Uint8Array(docx.length + 64);
    padded.set(docx, 37);
    expect(zipEntries(padded.subarray(37, 37 + docx.length))).toHaveLength(7);
  });

  it("finds the end record before an archive comment", () => {
    expect(zipEntries(zip([DOCUMENT], { comment: "Exporté par Word" }))).toEqual([
      { name: "word/document.xml", method: 8, compressedSize: expect.any(Number), localOffset: 0 },
    ]);
  });

  it("reads an empty archive", () => {
    expect(zipEntries(zip([]))).toEqual([]);
  });

  // JSZip reads every record it finds, whatever the count says.
  it.each([
    ["fewer", 1],
    ["more", 3],
  ])("refuses an end record that counts %s entries than the directory holds", (_, entries) => {
    const parts = [DOCUMENT, { name: "word/styles.xml", data: text("<w:styles/>") }];
    expect(zipEntries(zip(parts, { entries }))).toBeNull();
  });
});

describe("guardZip", () => {
  it("lets a real docx through", () => {
    expect(guardKey(fixture("etude-thermique.docx"))).toBeNull();
  });

  it("lets an empty archive through", () => {
    expect(guardKey(zip([]))).toBeNull();
  });

  it("measures what entries unpack to instead of trusting the declared size", () => {
    const bomb = zip([
      { name: "word/media/image1.png", data: zeros(PARSE_LIMITS.maxUnpackedBytes + 1), declaredSize: 10 },
    ]);
    expect(bomb.length).toBeLessThan(200 * 1024);
    expect(guardKey(bomb)).toBe("tooLarge");
  });

  it("allows exactly the unpacked size limit", () => {
    const half = PARSE_LIMITS.maxUnpackedBytes / 2;
    const media = (index: number, size: number) => ({
      name: `word/media/image${index}.png`,
      data: zeros(size),
    });
    expect(guardKey(zip([media(1, half), media(2, half)]))).toBeNull();
    expect(guardKey(zip([media(1, half), media(2, half + 1)]))).toBe("tooLarge");
  });

  it("holds the XML parts to their own limit", () => {
    const xml = zeros(PARSE_LIMITS.maxXmlBytes + 1);
    expect(guardKey(zip([{ name: "word/document.xml", data: xml }]))).toBe("tooLarge");
    expect(guardKey(zip([{ name: "xl/_rels/workbook.xml.rels", data: xml }]))).toBe("tooLarge");
    expect(guardKey(zip([{ name: "word/media/image1.png", data: xml }]))).toBeNull();
    const stored = zip([{ name: "word/document.xml", data: xml, method: 0 }]);
    expect(guardKey(stored)).toBe("tooLarge");
  });

  it("refuses an archive with more than 5000 entries", () => {
    const parts = (count: number) =>
      Array.from({ length: count }, (_, index) => ({ name: `p${index}.xml`, data: text("x") }));
    expect(guardKey(zip(parts(PARSE_LIMITS.maxZipEntries)))).toBeNull();
    expect(guardKey(zip(parts(PARSE_LIMITS.maxZipEntries + 1)))).toBe("tooLarge");
  });

  it("stays quick on a deflated megabyte", () => {
    const start = performance.now();
    expect(guardKey(zip([{ name: "word/document.xml", data: zeros(MB) }]))).toBeNull();
    expect(performance.now() - start).toBeLessThan(5000);
  });

  it.each([
    ["an empty file", new Uint8Array()],
    ["a file shorter than an end record", new Uint8Array(21)],
    ["text", text("Ceci n'est pas une archive. ".repeat(20))],
    ["illisible.docx", fixture("illisible.docx")],
    ["a directory larger than declared", zip([DOCUMENT], { directorySize: 10 })],
    ["a directory that starts after its declared start", zip([DOCUMENT], { directoryStart: 0 })],
    ["an unknown compression method", zip([{ ...DOCUMENT, method: 12 }])],
  ])("calls %s corrupt", (_, bytes) => {
    expect(guardKey(bytes)).toBe("corrupt");
  });

  it("calls a directory record with a wrong signature corrupt", () => {
    const bytes = zip([DOCUMENT, DOCUMENT]);
    const record = bytes.length - 22 - 2 * (46 + DOCUMENT.name.length) + 46 + DOCUMENT.name.length;
    bytes[record] = 0x00;
    expect(guardKey(bytes)).toBe("corrupt");
  });

  it("calls a missing local header corrupt", () => {
    const bytes = zip([DOCUMENT]);
    bytes[0] = 0x00;
    expect(guardKey(bytes)).toBe("corrupt");
  });

  it("calls broken deflated data corrupt", () => {
    const bytes = zip([{ name: "word/document.xml", data: text("<w:document>".repeat(100)) }]);
    bytes.fill(0xff, 30 + DOCUMENT.name.length, 30 + DOCUMENT.name.length + 8);
    expect(guardKey(bytes)).toBe("corrupt");
  });

  it.each([
    ["the entry count", zip([DOCUMENT], { entries: 0xffff })],
    ["the directory offset", zip([DOCUMENT], { directoryStart: 0xffffffff })],
    ["an entry size", zip([{ ...DOCUMENT, declaredSize: 0xffffffff }])],
  ])("calls ZIP64 markers in %s corrupt", (_, bytes) => {
    expect(guardKey(bytes)).toBe("corrupt");
  });
});
