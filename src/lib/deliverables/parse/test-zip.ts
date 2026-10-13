// Test helper: builds ZIP archives byte by byte, so tests can make them lie.
import { deflateRawSync } from "node:zlib";

export type Part = { name: string; data: Uint8Array; method?: number; declaredSize?: number };
export type EndRecord = {
  entries?: number;
  directorySize?: number;
  directoryStart?: number;
  comment?: string;
};

/**
 * A ZIP archive, local headers and central directory included. Deflated
 * parts are compressed here; declaredSize and the end record can lie.
 */
export function zip(parts: Part[], end: EndRecord = {}): Uint8Array {
  const encoder = new TextEncoder();
  const chunks: Uint8Array[] = [];
  const records: Uint8Array[] = [];
  let offset = 0;
  for (const part of parts) {
    const name = encoder.encode(part.name);
    const method = part.method ?? 8;
    const data = method === 8 ? deflateRawSync(part.data) : part.data;
    const local = new Uint8Array(30 + name.length);
    const localView = new DataView(local.buffer);
    localView.setUint32(0, 0x04034b50, true);
    localView.setUint16(8, method, true);
    localView.setUint16(26, name.length, true);
    local.set(name, 30);
    const record = new Uint8Array(46 + name.length);
    const view = new DataView(record.buffer);
    view.setUint32(0, 0x02014b50, true);
    view.setUint16(10, method, true);
    view.setUint32(20, data.length, true);
    view.setUint32(24, part.declaredSize ?? part.data.length, true);
    view.setUint16(28, name.length, true);
    view.setUint32(42, offset, true);
    record.set(name, 46);
    chunks.push(local, data);
    records.push(record);
    offset += local.length + data.length;
  }
  const directorySize = records.reduce((sum, record) => sum + record.length, 0);
  const comment = encoder.encode(end.comment ?? "");
  const tail = new Uint8Array(22 + comment.length);
  const view = new DataView(tail.buffer);
  view.setUint32(0, 0x06054b50, true);
  view.setUint16(8, end.entries ?? parts.length, true);
  view.setUint16(10, end.entries ?? parts.length, true);
  view.setUint32(12, end.directorySize ?? directorySize, true);
  view.setUint32(16, end.directoryStart ?? offset, true);
  view.setUint16(20, comment.length, true);
  tail.set(comment, 22);
  return Buffer.concat([...chunks, ...records, tail]);
}
