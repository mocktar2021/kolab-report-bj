import { inflateRawSync } from "node:zlib";
import { PARSE_LIMITS, ParseError } from "./types";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;
const LOCAL_FILE_HEADER = 0x04034b50;
const STORED = 0;
const DEFLATED = 8;

export type ZipEntry = {
  name: string;
  method: number;
  compressedSize: number;
  localOffset: number;
};

/**
 * Entries of a ZIP's central directory (.docx and .xlsx files are ZIP
 * archives), read the way JSZip reads them: the last end record, then every
 * record from the directory start. Null when the records don't match the
 * end record, or when the archive uses ZIP64, which no Office file of 50 MB
 * needs.
 */
export function zipEntries(bytes: Uint8Array): ZipEntry[] | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let end = -1;
  for (let index = bytes.length - 4; index >= Math.max(0, bytes.length - 22 - 0xffff); index--) {
    if (view.getUint32(index, true) === END_OF_CENTRAL_DIRECTORY) {
      end = index;
      break;
    }
  }
  if (end < 0 || end + 22 > bytes.length) return null;
  const counts = [4, 6, 8, 10].map((offset) => view.getUint16(end + offset, true));
  const directorySize = view.getUint32(end + 12, true);
  const directoryStart = view.getUint32(end + 16, true);
  if (counts.includes(0xffff) || directorySize === 0xffffffff || directoryStart === 0xffffffff) return null;
  // JSZip moves every offset when the directory doesn't end at the end record.
  if (directoryStart + directorySize !== end) return null;

  const entries: ZipEntry[] = [];
  let position = directoryStart;
  while (position + 46 <= end && view.getUint32(position, true) === CENTRAL_DIRECTORY_ENTRY) {
    const nameLength = view.getUint16(position + 28, true);
    const entry: ZipEntry = {
      name: new TextDecoder().decode(bytes.subarray(position + 46, position + 46 + nameLength)),
      method: view.getUint16(position + 10, true),
      compressedSize: view.getUint32(position + 20, true),
      localOffset: view.getUint32(position + 42, true),
    };
    if ([entry.compressedSize, view.getUint32(position + 24, true), entry.localOffset].includes(0xffffffff))
      return null;
    entries.push(entry);
    position += 46 + nameLength + view.getUint16(position + 30, true) + view.getUint16(position + 32, true);
  }
  return position === end && entries.length === counts[3] ? entries : null;
}

/** Bytes of an entry once unpacked, at most `budget`: past it, unpacking stops. */
function unpackedSize(method: number, data: Uint8Array, budget: number): number {
  let size: number;
  if (method === STORED) {
    size = data.length;
  } else if (method === DEFLATED) {
    try {
      size = inflateRawSync(data, { maxOutputLength: Math.max(budget, 1) }).length;
    } catch (error) {
      const tooLarge = (error as { code?: string }).code === "ERR_BUFFER_TOO_LARGE";
      throw new ParseError(tooLarge ? "tooLarge" : "corrupt");
    }
  } else {
    throw new ParseError("corrupt");
  }
  if (size > budget) throw new ParseError("tooLarge");
  return size;
}

/**
 * Refuses archives that unpack to too much before a parser opens them. Every
 * entry is unpacked and measured: the sizes an archive declares can lie.
 */
export function guardZip(bytes: Uint8Array): void {
  const entries = zipEntries(bytes);
  if (!entries) throw new ParseError("corrupt");
  if (entries.length > PARSE_LIMITS.maxZipEntries) throw new ParseError("tooLarge");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let total = 0;
  let xml = 0;
  for (const entry of entries) {
    const header = entry.localOffset;
    if (header + 30 > bytes.length || view.getUint32(header, true) !== LOCAL_FILE_HEADER)
      throw new ParseError("corrupt");
    const start = header + 30 + view.getUint16(header + 26, true) + view.getUint16(header + 28, true);
    if (start + entry.compressedSize > bytes.length) throw new ParseError("corrupt");
    const isXml = /\.(?:xml|rels)$/i.test(entry.name);
    const budget = Math.min(
      PARSE_LIMITS.maxUnpackedBytes - total,
      isXml ? PARSE_LIMITS.maxXmlBytes - xml : Number.POSITIVE_INFINITY,
    );
    const size = unpackedSize(entry.method, bytes.subarray(start, start + entry.compressedSize), budget);
    total += size;
    if (isXml) xml += size;
  }
}
