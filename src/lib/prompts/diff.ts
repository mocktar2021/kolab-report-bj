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

/** Unchanged lines kept around each change. */
const CONTEXT = 3;

export type DiffBlock =
  { kind: "line"; line: DiffLine; index: number } | { kind: "skip"; count: number; index: number };

/** The diff with long runs of unchanged lines folded into one "n lignes inchangées" row. */
export function foldUnchanged(lines: DiffLine[]): DiffBlock[] {
  const keep = lines.map(() => false);
  lines.forEach((line, index) => {
    if (line.kind === "same") return;
    const from = Math.max(0, index - CONTEXT);
    const to = Math.min(lines.length - 1, index + CONTEXT);
    for (let near = from; near <= to; near++) keep[near] = true;
  });

  const blocks: DiffBlock[] = [];
  let runStart = -1;
  const closeRun = (end: number) => {
    if (runStart === -1) return;
    // Folding one or two lines saves nothing, so they stay.
    if (end - runStart <= 2) {
      for (let index = runStart; index < end; index++) {
        blocks.push({ kind: "line", line: lines[index] as DiffLine, index });
      }
    } else {
      blocks.push({ kind: "skip", count: end - runStart, index: runStart });
    }
    runStart = -1;
  };
  lines.forEach((line, index) => {
    if (keep[index]) {
      closeRun(index);
      blocks.push({ kind: "line", line, index });
    } else if (runStart === -1) {
      runStart = index;
    }
  });
  closeRun(lines.length);
  return blocks;
}
