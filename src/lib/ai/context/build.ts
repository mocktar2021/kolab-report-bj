import { createHash } from "node:crypto";
import { storableText } from "@/lib/deliverables/parse/markdown";
import { PROMPT_VARIABLES } from "@/lib/prompts/catalog";
import { checkTemplate, renderTemplate } from "@/lib/prompts/template";
import type { SourceRefs } from "../schemas";
import type { ContextDeliverable, ContextInput, DeliverableUse, TemplateVariables } from "../types";
import {
  SUMMARY_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  deliverableBlock,
  escapeDelimiters,
  summaryBlock,
} from "./guards";
import { redactPii, type PiiKind } from "./redact";
import { CHARS_PER_TOKEN, estimateTokens } from "./tokens";

// Builds the template variables of a draft from the parsed deliverables
// (KRB-94) and keeps the prompt under the token budget (KRB-95).
//
// planContext decides what goes in, step by step, and logs each step as a
// TruncationDecision:
//   1. Deliverables are ordered by upload time, then id, and numbered L1,
//      L2... This order is also the priority for cuts and summaries.
//   2. Each one is cleaned, its personal data masked when configured, and
//      anything that looks like one of our tags escaped.
//   3. Tables keep their header and the first tableRowCap rows.
//   4. A deliverable above perDeliverableTokens is cut.
//   5. The total is shared fairly (water-filling): small files stay whole and
//      big ones get the same share of what remains. When that share falls
//      under minDeliverableTokens, the last deliverables are left out, name
//      only, until it doesn't.
//   6. What was cut goes to overflow chunks. The first maxSummaryChunks are
//      summarized by the caller, the rest is left out.
// finalizeContext then puts the summaries in (reduce step).
//
// Cuts happen at line boundaries, never inside a table row. A line longer
// than 1,000 characters may be cut after a space. Sizes are counted in
// characters, so the estimate of the final prompt is an upper bound and
// stays under maxInputTokens. Everything here is pure and deterministic:
// the same input gives the same context and hash.

export const CONTEXT_VERSION = 1;

export type ContextBudget = {
  /** Tokens the whole prompt (system + rendered template) may use. */
  maxInputTokens: number;
  /** Cap for one deliverable's own content, before summaries. */
  perDeliverableTokens: number;
  /** Rows kept per Markdown table, header excluded. */
  tableRowCap: number;
  /** Below this share a deliverable is left out (name only) rather than cut to a stub. */
  minDeliverableTokens: number;
  /** Size of one overflow chunk sent to the summarizer. */
  summaryChunkTokens: number;
  /** At most this many chunks are summarized per generation, in priority order. */
  maxSummaryChunks: number;
  /** Output cap of one summary. */
  summaryOutputTokens: number;
};

/** Kept even when the settings or the model leave less room. */
const MIN_INPUT_TOKENS = 2_000;
/** Room left in the context window for message framing and tokenizer error. */
const SAFETY_TOKENS = 2_000;
const SAFETY_RATIO = 1.1;
/** Summaries may take this share of the prompt at most. */
const SUMMARY_SHARE = 0.25;
/**
 * A summary is capped at summaryOutputTokens real tokens. French runs about
 * 4 characters per token, so its text is cut at 4 characters per output
 * token, which keeps the estimate of the prompt an upper bound.
 */
const SUMMARY_CHARS_PER_TOKEN = 4;
/** Wrapper and separator of one summary block, in tokens, for the budget. */
const SUMMARY_WRAPPER_TOKENS = 20;

function whole(value: number): number {
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

export function contextBudget(params: {
  contextWindowTokens: number;
  maxOutputTokens: number;
  maxInputTokens: number;
}): ContextBudget {
  const output = Math.max(0, whole(params.maxOutputTokens));
  const fromWindow = Math.floor((whole(params.contextWindowTokens) - output - SAFETY_TOKENS) / SAFETY_RATIO);
  const maxInputTokens = Math.max(MIN_INPUT_TOKENS, Math.min(whole(params.maxInputTokens), fromWindow));
  const minDeliverableTokens = 400;
  const summaryOutputTokens = 500;
  const summaryTokens =
    Math.ceil((summaryOutputTokens * SUMMARY_CHARS_PER_TOKEN) / CHARS_PER_TOKEN) + SUMMARY_WRAPPER_TOKENS;
  return {
    maxInputTokens,
    perDeliverableTokens: Math.max(minDeliverableTokens, Math.min(20_000, Math.floor(maxInputTokens * 0.4))),
    tableRowCap: 60,
    minDeliverableTokens,
    // A summary call stays under maxInputTokens too, system prompt included.
    summaryChunkTokens: Math.min(6_000, Math.max(1_000, maxInputTokens - 1_000)),
    // 6 at the default 60,000 tokens, fewer on a small budget.
    maxSummaryChunks: Math.min(6, Math.floor((maxInputTokens * SUMMARY_SHARE) / summaryTokens)),
    summaryOutputTokens,
  };
}

/**
 * One step of the plan, for the logs. `ref` is the deliverable's ref, or the
 * variable name when PII was masked in a template value.
 */
export type TruncationDecision =
  | { ref: string; action: "rowsCut"; rows: number }
  | { ref: string; action: "capped"; fromTokens: number; toTokens: number }
  | { ref: string; action: "cut"; fromTokens: number; toTokens: number }
  | { ref: string; action: "dropped"; tokens: number }
  | { ref: string; action: "summarized"; chunks: number; tokens: number }
  | { ref: string; action: "leftOut"; chunks: number; tokens: number }
  | { ref: string; action: "redacted"; counts: Partial<Record<PiiKind, number>> };

/** Part of a deliverable that didn't fit, to summarize. `id` is the key of its summary. */
export type OverflowChunk = {
  id: string;
  ref: string;
  fileName: string;
  kind: ContextDeliverable["kind"];
  part: number;
  text: string;
  tokens: number;
  /** summaryOutputTokens of the budget. */
  maxOutputTokens: number;
};

export type PlanEntry = {
  ref: string;
  id: string;
  fileName: string;
  kind: ContextDeliverable["kind"];
  /** Cleaned content kept in the main prompt, before notes and summaries. Empty when dropped. */
  kept: string;
  /** Estimate of the parsed Markdown as received. */
  originalTokens: number;
  /** Estimate of `kept`. */
  keptTokens: number;
  rowsCut: number;
  /** Cut to perDeliverableTokens. */
  capped: boolean;
  /** Cut to fit the total. */
  cut: boolean;
  /** Left out for lack of room: only its name is sent. */
  dropped: boolean;
  /** Overflow chunks beyond maxSummaryChunks, not summarized. */
  leftOutChunks: number;
  /** sha256 hex of the parsed Markdown as received. */
  hash: string;
};

export type ContextPlan = {
  /** Deliverables in context order, with what was kept so far. */
  entries: PlanEntry[];
  /** Chunks to summarize before finalizeContext, in priority order. Empty when everything fit. */
  overflow: OverflowChunk[];
  decisions: TruncationDecision[];
  /** Estimate of the main call's prompt, summaries included at their output cap. */
  estimatedInputTokens: number;
  /** Estimate of all the summary calls together: input plus output. */
  estimatedSummaryTokens: number;
  /** Every variable but deliverables, cleaned and capped. */
  variables: Omit<TemplateVariables, "deliverables">;
  template: string;
  budget: ContextBudget;
};

export type BuiltContext = {
  variables: TemplateVariables;
  /** ["L1", "L2", ...] in context order. */
  refs: SourceRefs;
  /** Ref to file name, for citations people can read. */
  names: ReadonlyMap<string, string>;
  deliverables: DeliverableUse[];
  truncated: boolean;
  estimatedInputTokens: number;
  decisions: TruncationDecision[];
  /** sha256 hex of the context version, variables and refs: same input, same hash. */
  inputHash: string;
  /** sha256 hex of each deliverable's original parsed Markdown, by deliverable id. */
  deliverableHashes: Record<string, string>;
};

// French text the model reads around the deliverables.

const NO_INSTRUCTIONS = "(aucune consigne)";
const NO_CONTEXT = "(aucun contexte fourni)";
const NO_TITLE = "(sans titre)";
const NO_NAME = "(sans nom)";
const DELIVERABLES_HEADING = "Livrables fournis :";
const DROPPED_NOTE = "[Contenu non repris faute de place. Seul le nom de ce livrable est connu.]";
const CUT_NOTES = {
  summarized: "[Livrable coupé ici. La suite est résumée juste après.]",
  partly:
    "[Livrable coupé ici. Une partie de la suite est résumée juste après, le reste n'a pas pu être repris.]",
  lost: "[Livrable coupé ici. La suite n'a pas pu être reprise.]",
} as const;
/** Room for "\n\n" and the longest cut note. */
const NOTE_RESERVE = 2 + Math.max(...Object.values(CUT_NOTES).map((note) => note.length));
/** Between two blocks. */
const SEPARATOR = "\n\n";

function rowsNote(rows: number): string {
  return rows === 1 ? "(1 ligne non reprise)" : `(${rows} lignes non reprises)`;
}

function failedNote(ref: string, part: number): string {
  return `[${ref}, partie ${part} : le résumé a échoué, cette partie n'est pas reprise.]`;
}

function cutNote(summarized: number, leftOut: number): string {
  if (summarized === 0) return CUT_NOTES.lost;
  return leftOut === 0 ? CUT_NOTES.summarized : CUT_NOTES.partly;
}

// Values the template uses besides the deliverables.

const VALUE_MAX_CHARS = 4_000;
const TITLE_MAX_CHARS = 500;
const NAME_MAX_CHARS = 200;

function isBlank(code: number): boolean {
  return code === 32 || code === 9 || code === 10 || code === 13;
}

function isHighSurrogate(code: number): boolean {
  return code >= 0xd800 && code <= 0xdbff;
}

const ELLIPSIS = " […]";

/** At most `max` characters, cut after a space when there is one in the last half. */
function capChars(text: string, max: number): string {
  if (text.length <= max) return text;
  const limit = max - ELLIPSIS.length;
  let end = limit;
  while (end > limit / 2 && !isBlank(text.charCodeAt(end - 1))) end--;
  if (end <= limit / 2) end = isHighSurrogate(text.charCodeAt(limit - 1)) ? limit - 1 : limit;
  return `${text.slice(0, end).trimEnd()}${ELLIPSIS}`;
}

function nonZero(counts: Record<PiiKind, number>): Partial<Record<PiiKind, number>> | null {
  const kept = Object.entries(counts).filter(([, count]) => count > 0);
  return kept.length > 0 ? (Object.fromEntries(kept) as Partial<Record<PiiKind, number>>) : null;
}

/** Text from the database, PII masked when asked, line breaks as "\n". */
function clean(
  raw: string,
  redact: boolean,
): { text: string; counts: Partial<Record<PiiKind, number>> | null } {
  let text = storableText(raw).replace(/\r\n?/g, "\n");
  let counts: Partial<Record<PiiKind, number>> | null = null;
  if (redact) {
    const result = redactPii(text);
    text = result.text;
    counts = nonZero(result.counts);
  }
  return { text: escapeDelimiters(text).trim(), counts };
}

/** Values people typed are user input too: cleaned, escaped and capped like the deliverables. */
function templateValues(
  input: ContextInput,
  redact: boolean,
  decisions: TruncationDecision[],
): Omit<TemplateVariables, "deliverables"> {
  const value = (name: string, raw: string | null, max: number, fallback: string) => {
    const result = clean(raw ?? "", redact);
    if (result.counts) decisions.push({ ref: name, action: "redacted", counts: result.counts });
    return result.text ? capChars(result.text, max) : fallback;
  };
  return {
    section_title: value("section_title", input.section.title, TITLE_MAX_CHARS, NO_TITLE),
    section_instructions: value(
      "section_instructions",
      input.section.instructions,
      VALUE_MAX_CHARS,
      NO_INSTRUCTIONS,
    ),
    report_title: value("report_title", input.report.title, TITLE_MAX_CHARS, NO_TITLE),
    report_context: value("report_context", input.report.description, VALUE_MAX_CHARS, NO_CONTEXT),
    workspace_name: value("workspace_name", input.workspaceName, NAME_MAX_CHARS, NO_NAME),
  };
}

// Content as segments: whole lines, or pieces of a very long line. A cut
// only happens before a segment that allows it, so tables stay whole rows.

/** A longer line is split, at a space when there is one, so a stub can still keep something. */
const PIECE_CHARS = 1_000;

type Segment = {
  text: string;
  /** "\n" after the last piece of a line, "" between pieces of one line. */
  tail: string;
  /** The kept part may end right before this segment. */
  cutBefore: boolean;
  /** Header and separator lines of the table this row belongs to. */
  header: string | null;
};

type Content = {
  segments: Segment[];
  /** sums[i] is the length of the first i segments, tails included. */
  sums: number[];
  rowsCut: number;
};

function pieces(line: string): string[] {
  if (line.length <= PIECE_CHARS) return [line];
  const result: string[] = [];
  let start = 0;
  while (line.length - start > PIECE_CHARS) {
    let end = start + PIECE_CHARS;
    const floor = start + PIECE_CHARS / 2;
    while (end > floor && !isBlank(line.charCodeAt(end - 1))) end--;
    if (end <= floor) {
      end = start + PIECE_CHARS;
      if (isHighSurrogate(line.charCodeAt(end - 1))) end--;
    }
    result.push(line.slice(start, end));
    start = end;
  }
  result.push(line.slice(start));
  return result;
}

function isTableLine(line: string): boolean {
  return line.includes("|") && line.trim() !== "";
}

function isTableSeparator(line: string): boolean {
  return line.includes("|") && line.includes("-") && /^[\s|:-]+$/.test(line);
}

/** Splits the content into segments and applies the table row cap. */
function segment(text: string, rowCap: number): Content {
  const segments: Segment[] = [];
  const add = (line: string, cutBefore: boolean, header: string | null, splittable: boolean) => {
    const parts = pieces(line);
    parts.forEach((part, index) =>
      segments.push({
        text: part,
        tail: index === parts.length - 1 ? "\n" : "",
        cutBefore: index === 0 ? cutBefore : splittable,
        header,
      }),
    );
  };
  const lines = text.split("\n");
  let rowsCut = 0;
  let index = 0;
  while (index < lines.length) {
    const line = lines[index] ?? "";
    const next = lines[index + 1];
    if (next === undefined || !isTableLine(line) || !isTableSeparator(next)) {
      add(line, true, null, true);
      index++;
      continue;
    }
    // A table: the header, separator and first row stay together.
    const header = `${line}\n${next}`;
    add(line, true, null, false);
    add(next, false, null, false);
    index += 2;
    let rows = 0;
    while (index < lines.length && isTableLine(lines[index] ?? "")) {
      if (rows < rowCap) add(lines[index] ?? "", rows > 0, header, false);
      rows++;
      index++;
    }
    if (rows > rowCap) {
      rowsCut += rows - rowCap;
      add("", true, null, true);
      add(rowsNote(rows - rowCap), false, null, true);
      if ((lines[index] ?? "").trim() !== "") add("", true, null, true);
    }
  }
  const sums = [0];
  for (const item of segments) sums.push((sums.at(-1) ?? 0) + item.text.length + item.tail.length);
  return { segments, sums, rowsCut };
}

/** Length of the first `count` segments, without the line break after the last one. */
function keptLength(content: Content, count: number): number {
  if (count === 0) return 0;
  return (content.sums[count] ?? 0) - (content.segments[count - 1]?.tail.length ?? 0);
}

/**
 * How many segments fit in `maxChars`, ending where a cut is allowed. When
 * only blank lines would be left out, nothing is cut.
 */
function cutIndex(content: Content, maxChars: number): number {
  const total = content.segments.length;
  let low = 0;
  let high = total;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (keptLength(content, middle) <= maxChars) low = middle;
    else high = middle - 1;
  }
  let index = low;
  while (index > 0 && index < total && !content.segments[index]?.cutBefore) index--;
  for (let rest = index; rest < total; rest++) {
    if (content.segments[rest]?.text.trim()) return index;
  }
  return total;
}

function render(content: Content, from: number, to: number): string {
  const parts: string[] = [];
  for (let index = from; index < to; index++) {
    const item = content.segments[index];
    if (item) parts.push(index < to - 1 ? item.text + item.tail : item.text);
  }
  return parts.join("");
}

/**
 * Overflow split into chunks of at most `maxChars`, at segment boundaries.
 * A chunk that starts inside a table repeats its header.
 */
function chunkOverflow(content: Content, from: number, maxChars: number): string[] {
  const chunks: string[] = [];
  let current: string[] = [];
  let length = 0;
  const flush = () => {
    const text = current.join("").trim();
    if (text) chunks.push(text);
    current = [];
    length = 0;
  };
  for (let index = from; index < content.segments.length; index++) {
    const item = content.segments[index];
    if (!item) continue;
    if (current.length > 0 && length + item.text.length > maxChars) flush();
    if (current.length === 0 && item.header !== null && item.header.length <= maxChars / 4) {
      current.push(`${item.header}\n`);
      length += item.header.length + 1;
    }
    current.push(item.text + item.tail);
    length += item.text.length + item.tail.length;
  }
  flush();
  return chunks;
}

/** Equal share of `available` for the deliverables above it, or Infinity when they all fit. */
function waterLevel(sizes: readonly number[], available: number): number {
  if (sizes.reduce((sum, size) => sum + size, 0) <= available) return Infinity;
  const sorted = [...sizes].sort((a, b) => a - b);
  let remaining = available;
  let count = sorted.length;
  for (const size of sorted) {
    if (size * count > remaining) break;
    remaining -= size;
    count--;
  }
  return Math.max(0, Math.floor(remaining / count));
}

function compareText(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A time without an offset is read as UTC, not in the server's time zone. An invalid one sorts last. */
function uploadTime(deliverable: ContextDeliverable): number {
  const value = deliverable.uploadedAt.trim();
  const time = Date.parse(/[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/.test(value) ? `${value}Z` : value);
  return Number.isNaN(time) ? Infinity : time;
}

/** Upload time, then id. The other keys only make the order total. */
function compareDeliverables(a: ContextDeliverable, b: ContextDeliverable): number {
  const timeA = uploadTime(a);
  const timeB = uploadTime(b);
  if (timeA !== timeB) return timeA < timeB ? -1 : 1;
  return (
    compareText(a.uploadedAt, b.uploadedAt) ||
    compareText(a.id, b.id) ||
    compareText(a.fileName, b.fileName) ||
    compareText(a.markdown, b.markdown)
  );
}

function tokensOf(chars: number): number {
  return Math.ceil(chars / CHARS_PER_TOKEN);
}

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/** The user prompt. A template without {{deliverables}} still gets them, at the end. */
function promptFor(template: string, variables: TemplateVariables): string {
  const rendered = renderTemplate(template, variables);
  if (checkTemplate(template).variables.includes("deliverables")) return rendered;
  const head = rendered.trimEnd();
  return `${head ? `${head}\n\n` : ""}${DELIVERABLES_HEADING}\n\n${variables.deliverables}`;
}

/**
 * The deliverables variable: one block per deliverable, a note at the end of
 * a cut one, then its summaries. `part` renders one overflow chunk.
 */
function renderDeliverables(
  entries: readonly PlanEntry[],
  overflow: readonly OverflowChunk[],
  part: (chunk: OverflowChunk) => string,
): string {
  const blocks: string[] = [];
  for (const entry of entries) {
    const use = { ref: entry.ref, fileName: entry.fileName, kind: entry.kind };
    if (entry.dropped) {
      blocks.push(deliverableBlock(use, DROPPED_NOTE));
      continue;
    }
    const chunks = overflow.filter((chunk) => chunk.ref === entry.ref);
    const note = entry.capped || entry.cut ? cutNote(chunks.length, entry.leftOutChunks) : "";
    blocks.push(deliverableBlock(use, [entry.kept, note].filter(Boolean).join("\n\n")));
    for (const chunk of chunks) blocks.push(part(chunk));
  }
  return blocks.join(SEPARATOR);
}

function summaryMaxChars(budget: ContextBudget): number {
  return budget.summaryOutputTokens * SUMMARY_CHARS_PER_TOKEN;
}

export function summaryPrompt(chunk: OverflowChunk): {
  system: string;
  prompt: string;
  maxOutputTokens: number;
} {
  const block = deliverableBlock(
    { ref: chunk.ref, fileName: chunk.fileName, kind: chunk.kind, part: chunk.part },
    chunk.text,
  );
  return {
    system: SUMMARY_SYSTEM_PROMPT,
    prompt: `Résumez la partie ${chunk.part} du livrable ${chunk.ref}.\n\n${block}`,
    maxOutputTokens: chunk.maxOutputTokens,
  };
}

type Prepared = {
  deliverable: ContextDeliverable;
  ref: string;
  content: Content;
  /** Length after the row cap. */
  fullChars: number;
  /** Segments left after the per-deliverable cap. */
  capIndex: number;
  decisions: TruncationDecision[];
};

/** Plans what goes in the prompt. Throws when no deliverable has content. */
export function planContext(
  input: ContextInput,
  budget: ContextBudget,
  options: { redactPii: boolean; template: string },
): ContextPlan {
  const sorted = [...input.deliverables]
    .filter((deliverable) => storableText(deliverable.markdown).trim() !== "")
    .sort(compareDeliverables);
  if (sorted.length === 0) throw new Error("planContext: no deliverable with parsed content");

  const decisions: TruncationDecision[] = [];
  const variables = templateValues(input, options.redactPii, decisions);

  // Steps 2 to 4, one deliverable at a time.
  const prepared: Prepared[] = sorted.map((deliverable, index) => {
    const ref = `L${index + 1}`;
    const own: TruncationDecision[] = [];
    const cleaned = clean(deliverable.markdown, options.redactPii);
    if (cleaned.counts) own.push({ ref, action: "redacted", counts: cleaned.counts });
    const content = segment(cleaned.text, budget.tableRowCap);
    if (content.rowsCut > 0) own.push({ ref, action: "rowsCut", rows: content.rowsCut });
    const fullChars = keptLength(content, content.segments.length);
    const capIndex = cutIndex(content, budget.perDeliverableTokens * CHARS_PER_TOKEN);
    return { deliverable, ref, content, fullChars, capIndex, decisions: own };
  });

  // Step 5, in characters. The deliverables text appears once per
  // {{deliverables}} in the template, and the prompt must leave room for
  // the system prompt.
  const systemTokens = estimateTokens(SYSTEM_PROMPT);
  const promptChars = (budget.maxInputTokens - systemTokens - 1) * CHARS_PER_TOKEN;
  const fixedChars = promptFor(options.template, { ...variables, deliverables: "" }).length;
  const copies = promptFor(options.template, { ...variables, deliverables: "x" }).length - fixedChars;
  const perCopy = Math.floor((promptChars - fixedChars) / copies);
  const overhead = prepared.reduce(
    (sum, item) =>
      sum +
      deliverableBlock(
        { ref: item.ref, fileName: item.deliverable.fileName, kind: item.deliverable.kind },
        "",
      ).length +
      SEPARATOR.length +
      NOTE_RESERVE,
    0,
  );
  const lastRef = `L${prepared.length}`;
  const summaryReserve =
    SEPARATOR.length +
    Math.max(
      summaryBlock(lastRef, 999_999, "x".repeat(summaryMaxChars(budget))).length,
      failedNote(lastRef, 999_999).length,
    );
  const sizes = prepared.map((item) => keptLength(item.content, item.capIndex));
  const minChars = budget.minDeliverableTokens * CHARS_PER_TOKEN;

  const fit = (reserve: number) => {
    const base = perCopy - overhead - reserve;
    let active = prepared.length;
    let level = 0;
    while (active > 0) {
      const available = base - (prepared.length - active) * DROPPED_NOTE.length;
      level = available > 0 ? waterLevel(sizes.slice(0, active), available) : 0;
      if (level >= minChars) break;
      active--;
    }
    const kept = prepared.map((item, index) => {
      if (index >= active) return 0;
      if ((sizes[index] ?? 0) <= level) return item.capIndex;
      return cutIndex(item.content, level);
    });
    const overflows = kept.some(
      (count, index) => index < active && count < (prepared[index]?.content.segments.length ?? 0),
    );
    return { active, kept, overflows };
  };
  let result = fit(0);
  if (result.overflows && budget.maxSummaryChunks > 0) result = fit(budget.maxSummaryChunks * summaryReserve);

  // Step 6: overflow chunks in priority order.
  const chunkChars = budget.summaryChunkTokens * CHARS_PER_TOKEN;
  const overflow: OverflowChunk[] = [];
  const entries: PlanEntry[] = prepared.map((item, index) => {
    const { deliverable, ref, content } = item;
    const dropped = index >= result.active;
    const keptCount = result.kept[index] ?? 0;
    const kept = dropped ? "" : render(content, 0, keptCount).trimEnd();
    const capped = item.capIndex < content.segments.length;
    const cut = !dropped && keptCount < item.capIndex;
    const own = item.decisions;
    if (capped) {
      own.push({
        ref,
        action: "capped",
        fromTokens: tokensOf(item.fullChars),
        toTokens: tokensOf(sizes[index] ?? 0),
      });
    }
    let leftOutChunks = 0;
    if (dropped) {
      own.push({ ref, action: "dropped", tokens: tokensOf(item.fullChars) });
    } else {
      if (cut) {
        own.push({
          ref,
          action: "cut",
          fromTokens: tokensOf(sizes[index] ?? 0),
          toTokens: estimateTokens(kept),
        });
      }
      let leftOutTokens = 0;
      chunkOverflow(content, keptCount, chunkChars).forEach((text, chunkIndex) => {
        const chunk: OverflowChunk = {
          id: `${ref}-${chunkIndex + 1}`,
          ref,
          fileName: deliverable.fileName,
          kind: deliverable.kind,
          part: chunkIndex + 1,
          text,
          tokens: estimateTokens(text),
          maxOutputTokens: budget.summaryOutputTokens,
        };
        if (overflow.length < budget.maxSummaryChunks) {
          overflow.push(chunk);
        } else {
          leftOutChunks++;
          leftOutTokens += chunk.tokens;
        }
      });
      if (leftOutChunks > 0)
        own.push({ ref, action: "leftOut", chunks: leftOutChunks, tokens: leftOutTokens });
    }
    decisions.push(...own);
    return {
      ref,
      id: deliverable.id,
      fileName: deliverable.fileName,
      kind: deliverable.kind,
      kept,
      originalTokens: estimateTokens(deliverable.markdown),
      keptTokens: estimateTokens(kept),
      rowsCut: content.rowsCut,
      capped,
      cut,
      dropped,
      leftOutChunks,
      hash: sha256(deliverable.markdown),
    };
  });

  // Upper bound: every summary at its longest, or the failure note when longer.
  const longest = "x".repeat(summaryMaxChars(budget));
  const worst = renderDeliverables(entries, overflow, (chunk) => {
    const block = summaryBlock(chunk.ref, chunk.part, longest);
    const note = failedNote(chunk.ref, chunk.part);
    return block.length >= note.length ? block : note;
  });
  const estimatedInputTokens =
    systemTokens + estimateTokens(promptFor(options.template, { ...variables, deliverables: worst }));
  const estimatedSummaryTokens = overflow.reduce((sum, chunk) => {
    const call = summaryPrompt(chunk);
    return sum + estimateTokens(call.system) + estimateTokens(call.prompt) + call.maxOutputTokens;
  }, 0);

  return {
    entries,
    overflow,
    decisions,
    estimatedInputTokens,
    estimatedSummaryTokens,
    variables,
    template: options.template,
    budget,
  };
}

/** A summary as it goes in: cleaned, escaped and cut to its cap. Empty counts as failed. */
function cleanSummary(text: string, max: number): string {
  const cleaned = escapeDelimiters(storableText(text).replace(/\r\n?/g, "\n")).trim();
  return capChars(cleaned, max);
}

/**
 * Reduce step: puts each summary after the kept part of its deliverable. A
 * null summary (the call failed) leaves a short French note instead, and
 * counts as truncated. A chunk missing from `summaries` counts as failed.
 */
export function finalizeContext(
  plan: ContextPlan,
  summaries: ReadonlyMap<string, string | null>,
): BuiltContext {
  const max = summaryMaxChars(plan.budget);
  const used = new Map<string, string>();
  for (const chunk of plan.overflow) {
    const text = cleanSummary(summaries.get(chunk.id) ?? "", max);
    if (text) used.set(chunk.id, text);
  }
  const deliverablesText = renderDeliverables(plan.entries, plan.overflow, (chunk) => {
    const text = used.get(chunk.id);
    return text === undefined ? failedNote(chunk.ref, chunk.part) : summaryBlock(chunk.ref, chunk.part, text);
  });
  const variables: TemplateVariables = { ...plan.variables, deliverables: deliverablesText };

  const decisions = [...plan.decisions];
  const deliverables: DeliverableUse[] = plan.entries.map((entry) => {
    const chunks = plan.overflow.filter((chunk) => chunk.ref === entry.ref);
    const summarized = chunks.filter((chunk) => used.has(chunk.id));
    const failed = chunks.filter((chunk) => !used.has(chunk.id));
    const sourceTokens = (list: OverflowChunk[]) => list.reduce((sum, chunk) => sum + chunk.tokens, 0);
    if (summarized.length > 0) {
      decisions.push({
        ref: entry.ref,
        action: "summarized",
        chunks: summarized.length,
        tokens: sourceTokens(summarized),
      });
    }
    if (failed.length > 0) {
      decisions.push({
        ref: entry.ref,
        action: "leftOut",
        chunks: failed.length,
        tokens: sourceTokens(failed),
      });
    }
    const summaryTokens = summarized.reduce(
      (sum, chunk) => sum + estimateTokens(used.get(chunk.id) ?? ""),
      0,
    );
    return {
      ref: entry.ref,
      id: entry.id,
      fileName: entry.fileName,
      originalTokens: entry.originalTokens,
      keptTokens: entry.keptTokens + summaryTokens,
      truncated: entry.rowsCut > 0 || entry.capped || entry.cut || entry.dropped,
      summarized: summarized.length > 0,
      dropped: entry.dropped,
      rowsCut: entry.rowsCut,
    };
  });

  const [first, ...rest] = plan.entries.map((entry) => entry.ref);
  if (first === undefined) throw new Error("finalizeContext: the plan has no deliverable");
  const refs: SourceRefs = [first, ...rest];
  const prompt = promptFor(plan.template, variables);

  return {
    variables,
    refs,
    names: new Map(plan.entries.map((entry) => [entry.ref, entry.fileName])),
    deliverables,
    truncated: deliverables.some((use) => use.truncated),
    estimatedInputTokens: estimateTokens(SYSTEM_PROMPT) + estimateTokens(prompt),
    decisions,
    inputHash: sha256(
      JSON.stringify([CONTEXT_VERSION, PROMPT_VARIABLES.map((name) => [name, variables[name]]), refs]),
    ),
    deliverableHashes: Object.fromEntries(plan.entries.map((entry) => [entry.id, entry.hash])),
  };
}

/** System prompt and user prompt for the main call: the template rendered with the variables. */
export function buildPrompt(template: string, built: BuiltContext): { system: string; prompt: string } {
  return { system: SYSTEM_PROMPT, prompt: promptFor(template, built.variables) };
}
