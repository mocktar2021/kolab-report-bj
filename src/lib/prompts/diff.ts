import { diffLines } from "diff";

export type DiffLine = { kind: "added" | "removed" | "same"; text: string };

/** Beyond this many changed lines, or this long, the history says the versions differ too much to show. */
const MAX_EDIT_LENGTH = 2000;
const TIMEOUT_MS = 100;

/**
 * Line by line changes from one version of a template to the next. Null
 * when they differ too much: the diff then stops instead of using the
 * server's time on a template rewritten from scratch.
 */
export function diffTemplates(before: string, after: string): DiffLine[] | null {
  // A last line with or without its newline is the same line.
  const parts = diffLines(before, after, {
    maxEditLength: MAX_EDIT_LENGTH,
    timeout: TIMEOUT_MS,
    ignoreNewlineAtEof: true,
  });
  if (!parts) return null;
  return parts.flatMap((part) => {
    const kind = part.added ? "added" : part.removed ? "removed" : "same";
    const text = part.value.endsWith("\n") ? part.value.slice(0, -1) : part.value;
    return text.split("\n").map((line) => ({ kind, text: line }) satisfies DiffLine);
  });
}
