import { PARSE_LIMITS, ParseError } from "./types";

const END_OF_CENTRAL_DIRECTORY = 0x06054b50;
const CENTRAL_DIRECTORY_ENTRY = 0x02014b50;

/**
 * Entry count and total unpacked size declared in a ZIP's central directory
 * (.docx and .xlsx files are ZIP archives). Null when the directory cannot
 * be read, or uses ZIP64, which no Office file of 50 MB needs.
 */
export function zipContents(bytes: Uint8Array): { entries: number; unpackedBytes: number } | null {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const lowest = Math.max(0, bytes.length - 22 - 0xffff);
  for (let end = bytes.length - 22; end >= lowest; end--) {
    if (view.getUint32(end, true) !== END_OF_CENTRAL_DIRECTORY) continue;
    const entries = view.getUint16(end + 10, true);
    const directorySize = view.getUint32(end + 12, true);
    const directoryStart = view.getUint32(end + 16, true);
    if (entries === 0xffff || directoryStart === 0xffffffff || directoryStart + directorySize > end)
      return null;

    let position = directoryStart;
    let unpackedBytes = 0;
    for (let index = 0; index < entries; index++) {
      if (position + 46 > end || view.getUint32(position, true) !== CENTRAL_DIRECTORY_ENTRY) return null;
      const size = view.getUint32(position + 24, true);
      if (size === 0xffffffff) return null;
      unpackedBytes += size;
      position +=
        46 +
        view.getUint16(position + 28, true) +
        view.getUint16(position + 30, true) +
        view.getUint16(position + 32, true);
    }
    return { entries, unpackedBytes };
  }
  return null;
}

/**
 * Refuses archives that would unpack to too much before a parser opens them.
 * The sizes are the ones the file declares: a forged archive can still lie,
 * and the parse timeout and the function's memory limit are the backstop.
 */
export function guardZip(bytes: Uint8Array): void {
  const contents = zipContents(bytes);
  if (!contents) throw new ParseError("corrupt");
  if (
    contents.entries > PARSE_LIMITS.maxZipEntries ||
    contents.unpackedBytes > PARSE_LIMITS.maxUnpackedBytes
  ) {
    throw new ParseError("tooLarge");
  }
}
