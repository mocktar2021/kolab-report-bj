import type { RichText } from "./types";

export type RichToken =
  | { kind: "text"; text: string }
  | { kind: "strong"; text: string }
  | { kind: "code"; text: string }
  | { kind: "link"; text: string; href: string };

// [label](href), **bold** or `code`. No nesting: the legal texts don't need it.
const MARK = /\[([^\]]+)\]\(([^)\s]+)\)|\*\*([^*]+)\*\*|`([^`]+)`/g;

/** Splits a rich text string into plain text, bold, code and links. */
export function parseRichText(source: RichText): RichToken[] {
  const tokens: RichToken[] = [];
  let last = 0;
  for (const match of source.matchAll(MARK)) {
    const [whole, label, href, strong, code] = match;
    if (match.index > last) tokens.push({ kind: "text", text: source.slice(last, match.index) });
    if (label !== undefined && href !== undefined) tokens.push({ kind: "link", text: label, href });
    else if (strong !== undefined) tokens.push({ kind: "strong", text: strong });
    else if (code !== undefined) tokens.push({ kind: "code", text: code });
    last = match.index + whole.length;
  }
  if (last < source.length) tokens.push({ kind: "text", text: source.slice(last) });
  return tokens;
}

export type LinkTarget =
  /** Another page of the app, without the locale: "/cgu#contenus". */
  | { kind: "page"; path: string; hash: string | null }
  /** A section of the same page: "#cookies". */
  | { kind: "anchor"; hash: string }
  /** An https:// URL or a mailto: address. */
  | { kind: "external"; href: string };

/** What a link in a legal text points to, or null when the href is not allowed. */
export function linkTarget(href: string): LinkTarget | null {
  if (href.startsWith("#") && href.length > 1) return { kind: "anchor", hash: href.slice(1) };
  if (href.startsWith("/") && !href.startsWith("//")) {
    const [path = "/", hash] = href.split("#", 2);
    return { kind: "page", path, hash: hash || null };
  }
  if (href.startsWith("https://") || href.startsWith("mailto:")) return { kind: "external", href };
  return null;
}
