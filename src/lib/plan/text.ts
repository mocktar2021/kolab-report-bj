import { stripLeadingNumber } from "./numbering";
import { PLAN_LIMITS } from "./types";

// Plain text out of what a plan holds: Markdown marks, escapes and the
// numbers in front of titles go. Section titles and instructions are plain
// text in the app.

// Every repeat is bounded, so a line full of marks costs linear time.
const INLINE_RULES: [RegExp, string][] = [
  // Images and links keep their text.
  [/!\[([^\]\n]{0,500})\]\([^)\n]{0,2000}\)/g, "$1"],
  [/\[([^\]\n]{1,500})\]\(<?[^)>\n]{0,2000}>?\)/g, "$1"],
  [/<(https?:\/\/[^>\s]{1,2000})>/g, "$1"],
  // HTML tags, such as a <br> in Markdown.
  [/<\/?[a-z][a-z0-9-]{0,30}(?:\s[^<>\n]{0,500})?\/?>/gi, " "],
  // Emphasis, strikethrough and code, when the marks surround text.
  // Underscores inside a word, as in a file name, stay.
  [/\*\*(?=\S)([^\n]{0,500}?\S)\*\*/g, "$1"],
  [/(?<![\p{L}\p{N}_])__(?=\S)([^\n]{0,500}?\S)__(?![\p{L}\p{N}_])/gu, "$1"],
  [/\*(?=[^\s*])([^\n*]{0,500}?[^\s*])\*/g, "$1"],
  [/(?<![\p{L}\p{N}_])_(?=[^\s_])([^\n_]{0,500}?[^\s_])_(?![\p{L}\p{N}_])/gu, "$1"],
  [/~~(?=\S)([^\n]{0,500}?\S)~~/g, "$1"],
  [/`([^`\n]{1,500})`/g, "$1"],
  // Markdown escapes: "1\." is "1.".
  [/\\([\\`*_{}[\]()#+\-.!|~<>&=:])/g, "$1"],
];

/** One line of Markdown or plain text, without its inline marks. */
export function plainInline(text: string): string {
  let plain = text;
  for (const [pattern, replacement] of INLINE_RULES) plain = plain.replace(pattern, replacement);
  return plain;
}

/** Control and invisible format characters, tabs and line breaks excepted. */
const CONTROL = /(?![\t\n])[\p{Cc}\p{Cf}]/gu;

/** Text Postgres stores and the model reads: no NUL or invisible character, no lone surrogate. */
export function cleanText(text: string): string {
  return text.toWellFormed().replace(/\r\n?/g, "\n").replace(CONTROL, "");
}

/**
 * Cuts at a space near `max` and adds `mark`. Lengths count UTF-16 units,
 * like the form fields and zod, which is never less than what Postgres
 * counts.
 */
function cutAt(text: string, max: number, mark: string): string {
  if (text.length <= max) return text;
  const room = max - mark.length;
  // Never half of an emoji.
  const head = text.slice(0, /[\uD800-\uDBFF]/.test(text.charAt(room - 1)) ? room - 1 : room);
  const space = head.search(/\s\S*$/);
  return `${(space > room * 0.6 ? head.slice(0, space) : head).trimEnd()}${mark}`;
}

/** A title as the section gets it: one line of plain text, no number in front, at most 200 characters. */
export function cleanTitle(raw: string): string {
  const line = plainInline(cleanText(raw).replace(/\s+/g, " ").trim())
    .replace(/\s+/g, " ")
    .trim()
    // A closing run of "#" in a Markdown heading, and a colon at the end.
    .replace(/\s+#+$/, "")
    .replace(/\s*:$/, "")
    .trim();
  return cutAt(stripLeadingNumber(line).trim(), PLAN_LIMITS.maxTitleChars, "…");
}

/** Instructions as the section gets them: plain text, at most 4000 characters, blank lines kept single. */
export function cleanInstructions(raw: string): string {
  const text = cleanText(raw)
    .split("\n")
    .map((line) => line.replace(/[ \t]+$/, ""))
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
  return cutAt(text, PLAN_LIMITS.maxInstructionsChars, " […]");
}
