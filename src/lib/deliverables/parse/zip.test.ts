// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { PARSE_LIMITS, ParseError } from "./types";
import { guardZip, zipContents } from "./zip";

const fixture = (name: string) =>
  readFileSync(new URL(`../../../../tests/fixtures/deliverables/${name}`, import.meta.url));

const NAME = new TextEncoder().encode("word/document.xml");
const ENTRY_LENGTH = 46 + NAME.length;

type EndRecord = { entries?: number; directorySize?: number; directoryStart?: number; comment?: string };

/**
 * A central directory with one entry per size, then the end record. zipContents
 * never reads local headers, so the archive holds nothing else.
 */
function centralDirectory(sizes: number[], end: EndRecord = {}): Uint8Array {
  const comment = new TextEncoder().encode(end.comment ?? "");
  const directorySize = sizes.length * ENTRY_LENGTH;
  const bytes = new Uint8Array(directorySize + 22 + comment.length);
  const view = new DataView(bytes.buffer);
  sizes.forEach((size, index) => {
    const at = index * ENTRY_LENGTH;
    view.setUint32(at, 0x02014b50, true);
    view.setUint32(at + 20, size, true); // compressed size
    view.setUint32(at + 24, size, true); // unpacked size
    view.setUint16(at + 28, NAME.length, true);
    bytes.set(NAME, at + 46);
  });
  view.setUint32(directorySize, 0x06054b50, true);
  view.setUint16(directorySize + 8, end.entries ?? sizes.length, true);
  view.setUint16(directorySize + 10, end.entries ?? sizes.length, true);
  view.setUint32(directorySize + 12, end.directorySize ?? directorySize, true);
  view.setUint32(directorySize + 16, end.directoryStart ?? 0, true);
  view.setUint16(directorySize + 20, comment.length, true);
  bytes.set(comment, directorySize + 22);
  return bytes;
}

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

const MB = 1024 * 1024;

describe("zipContents", () => {
  it("reads the central directory of a real docx", () => {
    expect(zipContents(fixture("etude-thermique.docx"))).toEqual({ entries: 7, unpackedBytes: 7728 });
  });

  it("reads bytes that sit inside a larger buffer", () => {
    const docx = fixture("etude-thermique.docx");
    const padded = new Uint8Array(docx.length + 64);
    padded.set(docx, 37);
    expect(zipContents(padded.subarray(37, 37 + docx.length))).toEqual({ entries: 7, unpackedBytes: 7728 });
  });

  it("adds up the declared sizes of a hand made directory", () => {
    expect(zipContents(centralDirectory([100, 200, 0]))).toEqual({ entries: 3, unpackedBytes: 300 });
  });

  it("finds the end record before an archive comment", () => {
    expect(zipContents(centralDirectory([10], { comment: "Exporté par Word" }))).toEqual({
      entries: 1,
      unpackedBytes: 10,
    });
  });

  it("reads an empty archive", () => {
    expect(zipContents(centralDirectory([]))).toEqual({ entries: 0, unpackedBytes: 0 });
  });
});

describe("guardZip", () => {
  it("lets a real docx through", () => {
    expect(guardKey(fixture("etude-thermique.docx"))).toBeNull();
  });

  it("refuses an archive that declares more than 100 MB unpacked", () => {
    const bytes = centralDirectory([60 * MB, 60 * MB]);
    expect(bytes.length).toBeLessThan(200);
    expect(guardKey(bytes)).toBe("tooLarge");
  });

  it("allows exactly the unpacked size limit", () => {
    expect(guardKey(centralDirectory([PARSE_LIMITS.maxUnpackedBytes]))).toBeNull();
    expect(guardKey(centralDirectory([PARSE_LIMITS.maxUnpackedBytes, 1]))).toBe("tooLarge");
  });

  it("refuses an archive with more than 5000 entries", () => {
    expect(guardKey(centralDirectory(Array(PARSE_LIMITS.maxZipEntries).fill(1)))).toBeNull();
    expect(guardKey(centralDirectory(Array(PARSE_LIMITS.maxZipEntries + 1).fill(1)))).toBe("tooLarge");
  });

  it.each([
    ["an empty file", new Uint8Array()],
    ["a file shorter than an end record", new Uint8Array(21)],
    ["text", new TextEncoder().encode("Ceci n'est pas une archive. ".repeat(20))],
    ["illisible.docx", fixture("illisible.docx")],
    ["a directory that runs past the end record", centralDirectory([10], { directorySize: 1000 })],
    ["a directory that starts past the end record", centralDirectory([10], { directoryStart: 500 })],
    ["more entries than the directory holds", centralDirectory([10, 20], { entries: 3 })],
  ])("calls %s corrupt", (_, bytes) => {
    expect(guardKey(bytes)).toBe("corrupt");
  });

  it("calls a directory entry with a wrong signature corrupt", () => {
    const bytes = centralDirectory([10, 20]);
    bytes[ENTRY_LENGTH] = 0x00;
    expect(guardKey(bytes)).toBe("corrupt");
  });

  it.each([
    ["the entry count", centralDirectory([10], { entries: 0xffff })],
    ["the directory offset", centralDirectory([10], { directoryStart: 0xffffffff })],
    ["an entry size", centralDirectory([0xffffffff])],
  ])("calls ZIP64 markers in %s corrupt", (_, bytes) => {
    expect(guardKey(bytes)).toBe("corrupt");
  });
});
