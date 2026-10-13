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
  // TextDecoder drops a leading byte order mark.
  return new TextDecoder("utf-8").decode(bytes);
}

function isText(bytes: Uint8Array): boolean {
  // UTF-16 files start with a byte order mark and are full of zero bytes.
  if (startsWith(bytes, [0xff, 0xfe]) || startsWith(bytes, [0xfe, 0xff])) return true;
  // Other encodings are accepted (Excel still exports CSV in Windows-1252),
  // but binary files have zero bytes.
  return !bytes.includes(0);
}

/**
 * End of a <!DOCTYPE ...> declaration starting at `start`, internal subset
 * included, or -1 when it is not closed.
 */
function doctypeEnd(text: string, start: number): number {
  const close = text.indexOf(">", start);
  const open = text.indexOf("[", start);
  if (open !== -1 && (close === -1 || open < close)) {
    const subsetEnd = text.indexOf("]", open);
    if (subsetEnd === -1) return -1;
    const after = text.indexOf(">", subsetEnd);
    return after === -1 ? -1 : after + 1;
  }
  return close === -1 ? -1 : close + 1;
}

function isDoctype(text: string, index: number): boolean {
  return text.slice(index, index + 9).toUpperCase() === "<!DOCTYPE";
}

/**
 * Name of the root element of an XML text, after any XML declaration,
 * processing instructions, comments and DOCTYPE. Null when the text does not
 * start like that. A plain scan rather than a regular expression: patterns
 * with repeated comment groups backtrack exponentially on files made of many
 * comments.
 */
export function xmlRootName(text: string): string | null {
  let index = 0;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text.charAt(index))) index++;
    if (text.startsWith("<?", index)) {
      const end = text.indexOf("?>", index + 2);
      if (end === -1) return null;
      index = end + 2;
    } else if (text.startsWith("<!--", index)) {
      const end = text.indexOf("-->", index + 4);
      if (end === -1) return null;
      index = end + 3;
    } else if (isDoctype(text, index)) {
      const end = doctypeEnd(text, index);
      if (end === -1) return null;
      index = end;
    } else {
      return /^<([A-Za-z_][\w.:-]*)[\s/>]/.exec(text.slice(index, index + 256))?.[1] ?? null;
    }
  }
  return null;
}

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
      return isText(head) && xmlRootName(decode(head))?.toLowerCase() === "svg";
    case "drawio": {
      const root = isText(head) ? xmlRootName(decode(head))?.toLowerCase() : null;
      return root === "mxfile" || root === "mxgraphmodel";
    }
    case "text":
      return isText(head);
  }
}

// What makes an SVG run code or load other documents when it is opened on
// its own. The app shows SVG files through <img>, where none of this runs, so
// this guards links to the stored file. It reads tags only, not text, and
// matches names whatever their namespace prefix (<svg:script> runs too).
const ACTIVE_ELEMENTS = new Set([
  "script",
  "iframe",
  "frame",
  "frameset",
  "embed",
  "object",
  "applet",
  "handler",
  "listener",
  "meta",
  "base",
]);

// Checked on attribute values once entities are expanded, characters decoded,
// and spaces and control characters removed, as browsers do in URLs.
const SCRIPT_URL =
  /(?:java|vb|live)script:|data:(?:text\/(?:html|javascript)|application\/(?:xhtml\+xml|(?:x-)?javascript))/;

const PREDEFINED: Record<string, string> = { lt: "<", gt: ">", amp: "&", quot: '"', apos: "'" };

/** Local name, lower case: "svg:script" gives "script". */
function localName(name: string): string {
  return name.slice(name.lastIndexOf(":") + 1).toLowerCase();
}

function attributeValue(raw: string, entities: Map<string, string>): string {
  return raw
    .replace(
      /&([A-Za-z_][\w.-]*);/g,
      (match, name: string) => entities.get(name) ?? PREDEFINED[name] ?? match,
    )
    .replace(/&#x([0-9a-f]+);?/gi, (_, hex: string) =>
      String.fromCodePoint(Number.parseInt(hex, 16) % 0x110000),
    )
    .replace(/&#(\d+);?/g, (_, dec: string) => String.fromCodePoint(Number.parseInt(dec, 10) % 0x110000))
    .replace(/[\u0000-\u0020\u007f-\u009f]/g, "")
    .toLowerCase();
}

// <!ENTITY name "value">, read from a given position. Group 1 is a parameter
// entity, group 5 an external one.
const ENTITY_DECLARATION = /<!ENTITY\s+(%\s+)?([^\s"'>%]+)\s+(?:"([^"]*)"\s*|'([^']*)'\s*|([^>]*))>/iy;

/**
 * Reads the internal subset of a DOCTYPE. Only plain entities are allowed,
 * like the namespace URLs Illustrator declares: no attribute defaults, no
 * parameter or external entities, and no markup, references or script URL
 * in a value. Returns false when anything else is there.
 */
function readEntities(subset: string, entities: Map<string, string>): boolean {
  let index = 0;
  while (index < subset.length) {
    while (index < subset.length && /\s/.test(subset.charAt(index))) index++;
    if (index >= subset.length) break;
    if (subset.startsWith("<!--", index)) {
      const end = subset.indexOf("-->", index + 4);
      if (end === -1) return false;
      index = end + 3;
      continue;
    }
    ENTITY_DECLARATION.lastIndex = index;
    const match = ENTITY_DECLARATION.exec(subset);
    if (!match?.[2] || match[1] || match[5] !== undefined) return false;
    const value = match[3] ?? match[4] ?? "";
    if (/[<&%]/.test(value) || SCRIPT_URL.test(attributeValue(value, entities))) return false;
    entities.set(match[2], value);
    index = ENTITY_DECLARATION.lastIndex;
  }
  return true;
}

type StartTag = { name: string; attributes: [string, string][]; end: number };

const TAG_NAME = /<([A-Za-z_][\w.:-]*)/y;
const ATTRIBUTE_NAME = /[^\s=/>]+/y;

/** Reads the start tag at `start`, attribute values included. Null when it is not one. */
function readStartTag(text: string, start: number): StartTag | null {
  TAG_NAME.lastIndex = start;
  const name = TAG_NAME.exec(text)?.[1];
  if (!name) return null;
  const attributes: [string, string][] = [];
  let index = TAG_NAME.lastIndex;
  while (index < text.length) {
    while (index < text.length && /\s/.test(text.charAt(index))) index++;
    if (text.charAt(index) === ">") return { name, attributes, end: index + 1 };
    if (text.startsWith("/>", index)) return { name, attributes, end: index + 2 };
    ATTRIBUTE_NAME.lastIndex = index;
    const attribute = ATTRIBUTE_NAME.exec(text)?.[0];
    if (!attribute) {
      index++;
      continue;
    }
    index = ATTRIBUTE_NAME.lastIndex;
    while (index < text.length && /\s/.test(text.charAt(index))) index++;
    let value = "";
    if (text.charAt(index) === "=") {
      index++;
      while (index < text.length && /\s/.test(text.charAt(index))) index++;
      const quote = text.charAt(index);
      if (quote === '"' || quote === "'") {
        const close = text.indexOf(quote, index + 1);
        const end = close === -1 ? text.length : close;
        value = text.slice(index + 1, end);
        index = end + 1;
      } else {
        const start = index;
        while (index < text.length && !/[\s>]/.test(text.charAt(index))) index++;
        value = text.slice(start, index);
      }
    }
    attributes.push([attribute, value]);
  }
  return { name, attributes, end: text.length };
}

function isActiveTag(tag: StartTag, entities: Map<string, string>): boolean {
  if (ACTIVE_ELEMENTS.has(localName(tag.name))) return true;
  return tag.attributes.some(([rawName, rawValue]) => {
    const name = localName(rawName);
    const value = attributeValue(rawValue, entities);
    if (name.startsWith("on") || name === "srcdoc") return true;
    // <set attributeName="onclick"> or <animate attributeName="href"> rewrite them.
    if (name === "attributename" && (value.startsWith("on") || value === "href" || value.endsWith(":href"))) {
      return true;
    }
    return SCRIPT_URL.test(value);
  });
}

/**
 * Whether an SVG file contains scripts, event handlers, script URLs,
 * frames, a style sheet instruction or DTD tricks. Linear in the file size.
 */
export function svgHasActiveContent(bytes: Uint8Array): boolean {
  const text = decode(bytes);
  const entities = new Map<string, string>();
  // Index just after `token`, or -1. An unclosed comment, section or
  // instruction runs to the end of the file, so there is nothing after it.
  const after = (token: string, from: number) => {
    const at = text.indexOf(token, from);
    return at === -1 ? -1 : at + token.length;
  };
  let index = 0;
  while (index !== -1) {
    const lt = text.indexOf("<", index);
    if (lt === -1) return false;
    if (text.startsWith("<!--", lt)) {
      index = after("-->", lt + 4);
    } else if (text.startsWith("<![CDATA[", lt)) {
      index = after("]]>", lt + 9);
    } else if (text.startsWith("<?", lt)) {
      // xml-stylesheet can load XSLT, which turns the file into a page.
      if (/^<\?xml-stylesheet[\s?]/i.test(text.slice(lt, lt + 20))) return true;
      index = after("?>", lt + 2);
    } else if (isDoctype(text, lt)) {
      const end = doctypeEnd(text, lt);
      if (end === -1) return true;
      const open = text.indexOf("[", lt);
      const subset = open !== -1 && open < end ? text.slice(open + 1, text.lastIndexOf("]", end)) : "";
      if (!readEntities(subset, entities)) return true;
      index = end;
    } else if (text.startsWith("<!", lt) || text.startsWith("</", lt)) {
      index = after(">", lt);
    } else {
      const tag = readStartTag(text, lt);
      if (tag && isActiveTag(tag, entities)) return true;
      index = tag ? tag.end : lt + 1;
    }
  }
  return false;
}
