import { createHash } from "node:crypto";
import { storableText } from "@/lib/deliverables/parse/markdown";
import { PROMPT_VARIABLES } from "@/lib/prompts/catalog";
import { checkTemplate, renderTemplate } from "@/lib/prompts/template";
import type { SourceRefs } from "../schemas";
import type { ContextDeliverable, ContextInput, DeliverableUse, TemplateVariables } from "../types";
import { FINAL_CHECKS, SYSTEM_PROMPT, deliverableBlock, escapeDelimiters } from "./guards";
import { redactPii, type PiiKind } from "./redact";
import { estimateTokens } from "./tokens";

// Builds the template variables of a draft from the parsed deliverables
// (KRB-94). The model reads every deliverable whole (KRB-253): nothing is
// cut, capped or summarized. When the prompt doesn't fit the budget, there
// is no draft, and the caller says so.
//
// buildContext, step by step:
//   1. Deliverables are ordered by upload time, then id, and numbered L1,
//      L2... in that order.
//   2. Each one is cleaned, its personal data masked when configured, and
//      anything that looks like one of our tags escaped.
//   3. The prompt is rendered and its size estimated. Sizes are counted in
//      characters, so the estimate is an upper bound.
// Everything here is pure and deterministic: the same input gives the same
// context and hash.

export const CONTEXT_VERSION = 2;

export type ContextBudget = {
  /** Tokens the whole prompt (system + rendered template) may use. */
  maxInputTokens: number;
};

/** Kept even when the settings or the model leave less room. */
const MIN_INPUT_TOKENS = 2_000;
/** Room left in the context window for message framing and tokenizer error. */
const SAFETY_TOKENS = 2_000;
const SAFETY_RATIO = 1.1;

function whole(value: number): number {
  return Number.isFinite(value) ? Math.floor(value) : 0;
}

/** What the prompt may use: the setting, within the model's window once the answer has its room. */
export function contextBudget(params: {
  contextWindowTokens: number;
  maxOutputTokens: number;
  maxInputTokens: number;
}): ContextBudget {
  const output = Math.max(0, whole(params.maxOutputTokens));
  const fromWindow = Math.floor((whole(params.contextWindowTokens) - output - SAFETY_TOKENS) / SAFETY_RATIO);
  return { maxInputTokens: Math.max(MIN_INPUT_TOKENS, Math.min(whole(params.maxInputTokens), fromWindow)) };
}

/** Personal data masked in a deliverable or a template value, for the logs. */
export type ContextDecision = { ref: string; action: "redacted"; counts: Partial<Record<PiiKind, number>> };

export type BuiltContext = {
  variables: TemplateVariables;
  /** ["L1", "L2", ...] in context order. */
  refs: SourceRefs;
  /** Ref to file name, for citations people can read. */
  names: ReadonlyMap<string, string>;
  deliverables: DeliverableUse[];
  estimatedInputTokens: number;
  decisions: ContextDecision[];
  /** sha256 hex of the context version, variables and refs: same input, same hash. */
  inputHash: string;
  /** sha256 hex of each deliverable's original parsed Markdown, by deliverable id. */
  deliverableHashes: Record<string, string>;
};

/** The context, or how far the prompt goes past the budget. */
export type ContextResult =
  | { fits: true; context: BuiltContext }
  | { fits: false; estimatedInputTokens: number; maxInputTokens: number };

// French text the model reads around the deliverables.

const NO_INSTRUCTIONS = "(aucune consigne)";
const NO_CONTEXT = "(aucun contexte fourni)";
const NO_TITLE = "(sans titre)";
const NO_NAME = "(sans nom)";
const DELIVERABLES_HEADING = "Livrables fournis :";
/** Between two blocks. */
const SEPARATOR = "\n\n";

// Values the template uses besides the deliverables. The database keeps
// them shorter than these caps, which only guard against a bad row.

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

/** Values people typed are user input too: cleaned and escaped like the deliverables. */
function templateValues(
  input: ContextInput,
  redact: boolean,
  decisions: ContextDecision[],
): Omit<TemplateVariables, "deliverables"> {
  const value = (name: string, raw: string | null, max: number, fallback: string) => {
    const result = clean(raw ?? "", redact);
    if (result.counts) decisions.push({ ref: name, action: "redacted", counts: result.counts });
    return result.text ? capChars(result.text, max) : fallback;
  };
  // A subsection says which section it belongs to, with any template.
  const title = value("section_title", input.section.title, TITLE_MAX_CHARS, NO_TITLE);
  const parent = input.section.parentTitle
    ? value("parent_section_title", input.section.parentTitle, TITLE_MAX_CHARS, "")
    : "";
  return {
    section_title: parent ? `${title} (sous-section de « ${parent} »)` : title,
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

function sha256(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex");
}

/**
 * The user prompt. A template without {{deliverables}} still gets them, at the
 * end. FINAL_CHECKS closes every prompt, whatever the template.
 */
function promptFor(template: string, variables: TemplateVariables): string {
  const rendered = renderTemplate(template, variables);
  if (checkTemplate(template).variables.includes("deliverables")) return `${rendered}\n\n${FINAL_CHECKS}`;
  const head = rendered.trimEnd();
  return `${head ? `${head}\n\n` : ""}${DELIVERABLES_HEADING}\n\n${variables.deliverables}\n\n${FINAL_CHECKS}`;
}

/**
 * The context of a draft: every deliverable whole, or `fits: false` when the
 * prompt would pass budget.maxInputTokens. Throws when no deliverable has
 * content.
 */
export function buildContext(
  input: ContextInput,
  budget: ContextBudget,
  options: { redactPii: boolean; template: string },
): ContextResult {
  const sorted = [...input.deliverables]
    .filter((deliverable) => storableText(deliverable.markdown).trim() !== "")
    .sort(compareDeliverables);
  const [first, ...rest] = sorted.map((_, index) => `L${index + 1}`);
  if (first === undefined) throw new Error("buildContext: no deliverable with parsed content");
  const refs: SourceRefs = [first, ...rest];
  const refOf = (index: number) => refs[index] ?? `L${index + 1}`;

  const decisions: ContextDecision[] = [];
  const values = templateValues(input, options.redactPii, decisions);
  const blocks: string[] = [];
  const deliverables: DeliverableUse[] = sorted.map((deliverable, index) => {
    const ref = refOf(index);
    const cleaned = clean(deliverable.markdown, options.redactPii);
    if (cleaned.counts) decisions.push({ ref, action: "redacted", counts: cleaned.counts });
    // A file name can hold an e-mail or an IBAN too.
    const promptName = options.redactPii ? redactPii(deliverable.fileName).text : deliverable.fileName;
    blocks.push(deliverableBlock({ ref, fileName: promptName, kind: deliverable.kind }, cleaned.text));
    return {
      ref,
      id: deliverable.id,
      fileName: deliverable.fileName,
      originalTokens: estimateTokens(deliverable.markdown),
      keptTokens: estimateTokens(cleaned.text),
      truncated: false,
      summarized: false,
      dropped: false,
      rowsCut: 0,
    };
  });

  const variables: TemplateVariables = { ...values, deliverables: blocks.join(SEPARATOR) };
  const estimatedInputTokens =
    estimateTokens(SYSTEM_PROMPT) + estimateTokens(promptFor(options.template, variables));
  if (estimatedInputTokens > budget.maxInputTokens) {
    return { fits: false, estimatedInputTokens, maxInputTokens: budget.maxInputTokens };
  }

  return {
    fits: true,
    context: {
      variables,
      refs,
      names: new Map(sorted.map((deliverable, index) => [refOf(index), deliverable.fileName])),
      deliverables,
      estimatedInputTokens,
      decisions,
      inputHash: sha256(
        JSON.stringify([CONTEXT_VERSION, PROMPT_VARIABLES.map((name) => [name, variables[name]]), refs]),
      ),
      deliverableHashes: Object.fromEntries(
        sorted.map((deliverable) => [deliverable.id, sha256(deliverable.markdown)]),
      ),
    },
  };
}

/** System prompt and user prompt for the main call: the template rendered with the variables. */
export function buildPrompt(template: string, built: BuiltContext): { system: string; prompt: string } {
  return { system: SYSTEM_PROMPT, prompt: promptFor(template, built.variables) };
}
