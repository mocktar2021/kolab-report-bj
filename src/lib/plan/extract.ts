import type { PlanLine } from "./lines";
import { parseNumbering, type Numbering } from "./numbering";
import { cleanInstructions, cleanTitle, plainInline } from "./text";
import { PLAN_LIMITS, type ExtractedPlan, type PlanItem, type PlanLevel, type PlanSource } from "./types";

// Reads the plan of a document from its lines (./lines.ts, ./docx.ts).
//
// Headings: the two shallowest heading levels become sections and
// subsections, so a plan written with "##" and "###" works too. A single
// heading on top of deeper ones is the document's title and is left out.
// Deeper headings go into the instructions.
//
// Numbered lines, when headings give less: the first kind of number met
// ("1.", "I.", "A)", a Word numbered list...) marks the sections, the next
// kind the subsections, and "1.1" numbers are the subsections when the
// sections are "1.", "2.". A number counts only when it follows the one
// before it at its level, so a list that restarts at 1 inside a section
// stays in its text. Deeper numbers go into the instructions.
//
// The text under each title becomes its instructions. Text before the first
// title is left out.

/** A numbered line longer than this, or ending like a sentence, is text, not a title. */
const MAX_TITLE_LINE = 160;

/** Raw text gathered per item: the instructions keep 4000 characters of it. */
const MAX_RAW_INSTRUCTIONS = PLAN_LIMITS.maxInstructionsChars * 2;

/** What import_report_plan takes, before cleaning. */
export type RawPlanItem = { title: string; level: number; instructions?: string | null };

/**
 * Cleans titles and instructions, drops items left without a title, makes
 * the first item a section and keeps at most maxItems. Null when nothing is
 * left. Used for every source, the AI's answer included.
 */
export function finishPlan(raw: readonly RawPlanItem[], source: PlanSource): ExtractedPlan | null {
  const items: PlanItem[] = [];
  for (const item of raw) {
    const title = cleanTitle(item.title);
    if (!title) continue;
    items.push({
      title,
      level: items.length === 0 || item.level !== 2 ? 1 : 2,
      instructions: cleanInstructions(item.instructions ?? ""),
    });
  }
  if (items.length === 0) return null;
  return {
    items: items.slice(0, PLAN_LIMITS.maxItems),
    source,
    truncated: items.length > PLAN_LIMITS.maxItems,
  };
}

/** Items being read, with their text so far. */
class Items {
  private readonly items: { title: string; level: PlanLevel; body: string[]; size: number }[] = [];

  get count(): number {
    return this.items.length;
  }

  add(title: string, level: PlanLevel) {
    this.items.push({ title, level, body: [], size: 0 });
  }

  /** A line of instructions for the current item. Ignored before the first one. */
  line(text: string) {
    const current = this.items.at(-1);
    if (!current || current.size > MAX_RAW_INSTRUCTIONS) return;
    current.body.push(text);
    current.size += text.length + 1;
  }

  blank() {
    const current = this.items.at(-1);
    if (current && current.body.length > 0 && current.body.at(-1) !== "") current.body.push("");
  }

  finish(source: PlanSource): ExtractedPlan | null {
    return finishPlan(
      this.items.map((item) => ({
        title: item.title,
        level: item.level,
        instructions: item.body.join("\n"),
      })),
      source,
    );
  }
}

/** A line of text as it goes into the instructions. */
function bodyLine(line: Extract<PlanLine, { kind: "text" }>): string {
  const text = plainInline(line.text);
  if (line.list) return `${"  ".repeat(Math.min(line.list.depth, 4))}- ${text}`;
  return `${" ".repeat(Math.min(line.indent, 8))}${text}`;
}

function fromHeadings(lines: readonly PlanLine[]): ExtractedPlan | null {
  const headings = lines.filter(
    (line): line is Extract<PlanLine, { kind: "heading" }> =>
      line.kind === "heading" && cleanTitle(line.text) !== "",
  );
  if (headings.length === 0) return null;

  const top = Math.min(...headings.map((heading) => heading.depth));
  const atTop = headings.filter((heading) => heading.depth === top);
  // One heading above all the others, first in the document: its title.
  const title = atTop.length === 1 && atTop[0] === headings[0] && headings.length > 1 ? headings[0] : null;
  const depths = [...new Set(headings.filter((h) => h !== title).map((h) => h.depth))].sort((a, b) => a - b);
  const [sectionDepth, subsectionDepth] = depths;

  const items = new Items();
  for (const line of lines) {
    if (line.kind === "blank") items.blank();
    else if (line.kind === "text") items.line(bodyLine(line));
    else if (line === title) continue;
    else if (line.depth === sectionDepth) items.add(line.text, 1);
    else if (line.depth === subsectionDepth) items.add(line.text, 2);
    else items.line(plainInline(line.text));
  }
  return items.finish("headings");
}

type Candidate = { key: string; numbering: Numbering | null };

/** Spaces before a number, rounded so 2, 3 and 4 spaces of nesting each make a level. */
function indentLevel(indent: number): number {
  return Math.min(Math.floor(indent / 2), 3);
}

function looksLikeTitle(text: string): boolean {
  const trimmed = text.trim();
  return trimmed.length > 0 && trimmed.length <= MAX_TITLE_LINE && !/[;,]$/.test(trimmed);
}

function fromNumbers(lines: readonly PlanLine[]): ExtractedPlan | null {
  /** The last number seen with each key, at the current place in the document. */
  const last = new Map<string, number>();
  let sectionKey: string | null = null;
  let subsectionKey: string | null = null;
  let sectionNumber: number | null = null;
  let sectionFamily: Numbering["family"] | null = null;

  // "1.", "2." for sections and "1.1", "2.1" for subsections is so common
  // that "1.1" takes the second level even when another list comes first.
  let dottedSubsections = false;

  const candidateOf = (line: PlanLine): Candidate | null => {
    if (line.kind === "blank" || (line.kind === "text" && (line.code || line.list?.ordered === false)))
      return null;
    if (line.kind === "text" && line.list) {
      return looksLikeTitle(line.text) ? { key: `list:${line.list.depth}`, numbering: null } : null;
    }
    // "**1. Contexte**" and "1\. Contexte" are numbered too.
    const numbering = parseNumbering(plainInline(line.text).trim());
    if (!numbering || !looksLikeTitle(numbering.rest)) return null;
    const indent = line.kind === "text" ? indentLevel(line.indent) : 0;
    if (numbering.family === "dotted") return { key: `dotted:${numbering.values.length}`, numbering };
    const key = `${numbering.family}${numbering.delimiter}@${indent}`;
    if (numbering.romanValue === null) return { key, numbering };
    // A single I, V, X or L: a letter or a Roman numeral, whichever
    // follows the list it would belong to.
    const romanKey = key.replace("letter", "roman");
    const asRoman = { key: romanKey, numbering: { ...numbering, values: [numbering.romanValue] } };
    const asLetter = { key, numbering };
    const lastRoman = last.get(romanKey);
    const lastLetter = last.get(key);
    if (lastRoman !== undefined && numbering.romanValue === lastRoman + 1) return asRoman;
    if (lastLetter !== undefined && numbering.values[0] === lastLetter + 1) return asLetter;
    if (numbering.romanValue === 1 || romanKey === sectionKey || romanKey === subsectionKey) return asRoman;
    return asLetter;
  };

  let first: Candidate | null = null;
  for (const line of lines) {
    first = candidateOf(line);
    if (first) break;
  }
  if (!first) return null;
  if (first.numbering?.family === "decimal") {
    dottedSubsections = lines.some((line) => {
      if (line.kind === "blank") return false;
      const numbering = parseNumbering(plainInline(line.text).trim());
      return (
        numbering?.family === "dotted" && numbering.values.length === 2 && looksLikeTitle(numbering.rest)
      );
    });
    if (dottedSubsections) subsectionKey = "dotted:2";
  }

  /** The number follows the one before it at this level, within a small gap for a typo. */
  const follows = (candidate: Candidate): boolean => {
    if (!candidate.numbering) return true;
    const value = candidate.numbering.values.at(-1) ?? 0;
    const previous = last.get(candidate.key);
    return previous === undefined ? value <= 50 : value > previous && value <= previous + 5;
  };

  const items = new Items();
  for (const line of lines) {
    if (line.kind === "blank") {
      items.blank();
      continue;
    }
    const candidate = candidateOf(line);
    let level: PlanLevel | null = null;
    if (candidate) {
      if (sectionKey === null) {
        sectionKey = candidate.key;
        sectionFamily = candidate.numbering?.family ?? null;
      }
      if (candidate.key === sectionKey && follows(candidate)) {
        level = 1;
      } else if (items.count > 0 && candidate.key !== sectionKey) {
        if (subsectionKey === null) subsectionKey = candidate.key;
        const values = candidate.numbering?.values ?? [];
        // "3.1" belongs under "3.", not under "2.".
        const underSection =
          candidate.numbering?.family !== "dotted" ||
          sectionFamily !== "decimal" ||
          values.slice(0, -1).join(".") === String(sectionNumber);
        if (candidate.key === subsectionKey && underSection && follows(candidate)) level = 2;
      }
    }
    // The title keeps its number here: finishPlan takes it off.
    if (candidate && level === 1) {
      items.add(line.text, 1);
      if (candidate.numbering) last.set(candidate.key, candidate.numbering.values.at(-1) ?? 0);
      sectionNumber = candidate.numbering?.values[0] ?? null;
      // Subsections start again under each section.
      if (subsectionKey) last.delete(subsectionKey);
    } else if (candidate && level === 2) {
      items.add(line.text, 2);
      if (candidate.numbering) last.set(candidate.key, candidate.numbering.values.at(-1) ?? 0);
    } else if (line.kind === "heading") {
      items.line(plainInline(line.text));
    } else {
      items.line(bodyLine(line));
    }
  }
  return items.finish("numbers");
}

/**
 * The plan of a document, or null when it has no structure to read.
 * Headings win when there are at least three of them, or at least as many
 * as numbered titles.
 */
export function extractPlan(lines: readonly PlanLine[]): ExtractedPlan | null {
  const byHeadings = fromHeadings(lines);
  const byNumbers = fromNumbers(lines);
  const headingCount = byHeadings?.items.length ?? 0;
  const numberCount = byNumbers?.items.length ?? 0;
  if (byHeadings && (headingCount >= 3 || headingCount >= numberCount)) return byHeadings;
  return byNumbers ?? byHeadings;
}
