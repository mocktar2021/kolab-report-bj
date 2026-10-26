import type { ParseMeta } from "@/lib/deliverables/parse/types";
import type { PromptVariable } from "@/lib/prompts/catalog";
import type { DraftOutput } from "./schemas";

// Shared between the draft route, the context builder, the review UI and the
// eval runner. Messages for DraftErrorKey are under AiDraft.errors in
// messages/fr.json.

/** Why a generation was refused or failed. */
export type DraftErrorKey =
  | "unauthenticated"
  | "forbidden"
  | "notFound"
  | "invalidRequest"
  | "noDeliverables"
  | "templateUnavailable"
  | "aiUnavailable"
  | "rateLimited"
  | "budgetExceeded"
  | "busy"
  | "invalidOutput"
  | "aborted"
  | "timeout"
  | "providerError"
  // The organization's plan (ADR 001): AI drafts used up for the month, the
  // trial or the pass; a read-only workspace; a custom template on a plan
  // without them.
  | "quotaExceeded"
  | "quotaExceededTrial"
  | "quotaExceededMission"
  | "quotaUsed"
  // The token volume that goes with those drafts (KRB-252): a draft left,
  // but not the tokens for this one.
  | "tokensExceeded"
  | "tokensExceededTrial"
  | "tokensExceededMission"
  | "tokensUsed"
  | "readOnly"
  | "templateNotIncluded"
  | "generic";

/**
 * What the quota messages show: {max} drafts, the token {volume} ("3 millions
 * de jetons"), and the {date} the month's allowance comes back.
 */
export type DraftErrorValues = { max?: number; volume?: string; date?: string };

/**
 * Body of a refused request (any status but 200). 429 answers also carry a
 * Retry-After header, as does a 402 for the month's drafts.
 */
export type DraftErrorBody = { error: DraftErrorKey; retryAfter?: number; values?: DraftErrorValues };

/** What the request body of POST /api/ai/sections/[id]/draft holds. */
export type DraftRequest = { promptVersionId: string };

/** How one deliverable made it into the context. */
export type DeliverableUse = {
  /** Short id the model cites: L1, L2... in context order. */
  ref: string;
  id: string;
  fileName: string;
  /** Token estimate of the parsed Markdown before any cut. */
  originalTokens: number;
  /** Token estimate of what was sent, summary included. */
  keptTokens: number;
  /** Some of the content was cut, summarized or left out. */
  truncated: boolean;
  /** Part of the content was replaced by a summary (map-reduce). */
  summarized: boolean;
  /** Nothing of the content fit: only its name was sent. */
  dropped: boolean;
  /** Table rows left out by the row cap. */
  rowsCut: number;
};

/**
 * One line of the NDJSON stream the draft route answers with. The client
 * reads them in order: start, partials, maybe repair then more partials,
 * then done or error.
 */
export type DraftStreamEvent =
  | {
      type: "start";
      generationId: string;
      truncated: boolean;
      deliverables: DeliverableUse[];
    }
  /** The object so far. Not checked: fields may be missing or cut. */
  | { type: "partial"; object: unknown }
  /** The first answer failed the schema and the model is asked once to fix it. The preview starts over. */
  | { type: "repair" }
  | { type: "done"; generationId: string; output: DraftOutput; markdown: string }
  | { type: "error"; error: DraftErrorKey };

/** A parsed deliverable, as the context builder receives it. */
export type ContextDeliverable = {
  id: string;
  fileName: string;
  kind: ParseMeta["kind"];
  markdown: string;
  uploadedAt: string;
};

/** Everything the template variables are built from. */
export type ContextInput = {
  workspaceName: string;
  report: { title: string; description: string | null };
  /** parentTitle: the section a subsection belongs to (KRB-195), null for a section. */
  section: { title: string; instructions: string | null; parentTitle?: string | null };
  deliverables: ContextDeliverable[];
};

export type TemplateVariables = Record<PromptVariable, string>;

/** What ai_generations.context_meta holds. */
export type GenerationContextMeta = {
  version: 1;
  deliverables: DeliverableUse[];
  /** The context builder's truncation log. */
  decisions: unknown[];
  estimatedInputTokens: number;
  /** A call ended before its usage was reported, so part of the token count is estimated. */
  usageEstimated: boolean;
};
