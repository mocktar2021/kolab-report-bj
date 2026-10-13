import { diffLines } from "diff";

export type DiffLine = { kind: "added" | "removed" | "same"; text: string };

/** Beyond this many changed lines the history says the versions differ too much to show. */
const MAX_EDIT_LENGTH = 2000;

/**
 * Line by line changes from one version of a template to the next. Null
 * when they differ too much: the diff then stops instead of using the
 * server's time on a template rewritten from scratch.
 */
export function diffTemplates(before: string, after: string): DiffLine[] | null {
  const parts = diffLines(before, after, { maxEditLength: MAX_EDIT_LENGTH });
  if (!parts) return null;
  return parts.flatMap((part) => {
    const kind = part.added ? "added" : part.removed ? "removed" : "same";
    const text = part.value.endsWith("\n") ? part.value.slice(0, -1) : part.value;
    return text.split("\n").map((line) => ({ kind, text: line }) satisfies DiffLine);
  });
}
