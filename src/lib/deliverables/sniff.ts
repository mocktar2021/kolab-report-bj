import type { FileSignature } from "./file-types";

/** Bytes read from the start of a stored file for the checks below. */
export const SNIFF_BYTES = 4096;

function startsWith(bytes: Uint8Array, prefix: readonly number[], offset = 0): boolean {
  if (bytes.length < offset + prefix.length) return false;
  return prefix.every((byte, index) => bytes[offset + index] === byte);
}

function ascii(text: string): number[] {
  return Array.from(text, (char) => char.charCodeAt(0));
}

const ZIP = [0x50, 0x4b, 0x03, 0x04];
const OLE = [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const JPEG = [0xff, 0xd8, 0xff];
const PDF = ascii("%PDF-");

function decode(bytes: Uint8Array): string {
  return new TextDecoder("utf-8").decode(bytes).replace(/^﻿/, "");
}

function isText(bytes: Uint8Array): boolean {
  // UTF-16 files start with a byte order mark and are full of zero bytes.
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return true;
  // Other encodings are accepted (Excel still exports CSV in Windows-1252),
  // but binary files have zero bytes.
  return !bytes.includes(0);
}

// Optional XML declaration, comments and a DOCTYPE without an internal subset.
const XML_PROLOG = String.raw`^\s*(?:<\?xml[^>]*\?>\s*)?(?:<!--[\s\S]*?-->\s*|<!DOCTYPE[^>\[]*>\s*)*`;
const SVG_ROOT = new RegExp(`${XML_PROLOG}<svg[\\s>]`, "i");
const DRAWIO_ROOT = new RegExp(`${XML_PROLOG}<(?:mxfile|mxGraphModel)[\\s>]`, "i");

/** Whether the first bytes of a stored file match what its extension promises. */
export function matchesSignature(signature: FileSignature, head: Uint8Array): boolean {
  switch (signature) {
    case "zip":
      return startsWith(head, ZIP);
    case "ole":
      return startsWith(head, OLE);
    case "pdf":
      // The header may come after a little junk, within the first 1024 bytes.
      for (let offset = 0; offset <= 1024; offset++) {
        if (startsWith(head, PDF, offset)) return true;
      }
      return false;
    case "png":
      return startsWith(head, PNG);
    case "jpeg":
      return startsWith(head, JPEG);
    case "webp":
      return startsWith(head, ascii("RIFF")) && startsWith(head, ascii("WEBP"), 8);
    case "svg":
      return isText(head) && SVG_ROOT.test(decode(head));
    case "drawio":
      return isText(head) && DRAWIO_ROOT.test(decode(head));
    case "text":
      return isText(head);
  }
}

// Things that make an SVG run code or load other documents when it is
// opened on its own. The app shows SVG files through <img>, where none of
// this runs, so this is a second line of defence for direct links.
const ACTIVE_SVG_PATTERNS = [
  /<script[\s/>]/i,
  /<(?:iframe|embed|object|handler|listener)[\s/>]/i,
  /<!ENTITY/i,
  /[\s/]on[a-z]+\s*=/i,
  /attributeName\s*=\s*["']?\s*(?:on[a-z]+|href|xlink:href)/i,
  /(?:java|vb)script\s*:/i,
  /data\s*:\s*text\/html/i,
];

function decodeCharacterReferences(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16) % 0x110000),
    )
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10) % 0x110000));
}

/** Whether a whole SVG file contains scripts, event handlers or similar. */
export function svgHasActiveContent(bytes: Uint8Array): boolean {
  const text = decodeCharacterReferences(decode(bytes));
  // Browsers drop tabs and line breaks inside URLs ("java\nscript:").
  const variants = [text.replace(/[\t\n\r]/g, " "), text.replace(/[\t\n\r]/g, "")];
  return ACTIVE_SVG_PATTERNS.some((pattern) => variants.some((variant) => pattern.test(variant)));
}
