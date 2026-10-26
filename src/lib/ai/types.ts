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
  // The AI reads every deliverable whole or not at all (KRB-253): one was
  // read only in part when it was uploaded, or all of them together pass
  // what the model can read at once.
  | "deliverableReadInPart"
  | "deliverablesReadInPart"
  | "contextTooLarge"
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
  | "readOnly"
  | "templateNotIncluded"
  | "generic";

/**
 * What the messages show: {max} drafts and the {date} the month's allowance
 * comes back for the quota ones, the {name} of a deliverable read in part.
 */
export type DraftErrorValues = { max?: number; date?: string; name?: string };

/**
 * Body of a refused request (any status but 200). 429 answers also carry a
 * Retry-After header, as does a 402 for the month's drafts.
 */
export type DraftErrorBody = { error: DraftErrorKey; retryAfter?: number; values?: DraftErrorValues };

/** What the request body of POST /api/ai/sections/[id]/draft holds. */
export type DraftRequest = { promptVersionId: string };

/**
 * How one deliverable made it into the context. Since KRB-253 every one goes
 * in whole; the cut flags describe drafts made before, still in the history.
 */
export type DeliverableUse = {
  /** Short id the model cites: L1, L2... in context order. */
  ref: string;
  id: string;
  fileName: string;
  /** Token estimate of the parsed Markdown as stored. */
  originalTokens: number;
  /** Token estimate of what was sent, summary included. */
  keptTokens: number;
  /** Some of the content was cut, summarized or left out (before KRB-253). */
  truncated: boolean;
  /** Part of the content was replaced by a summary (before KRB-253). */
  summarized: boolean;
  /** Nothing of the content fit: only its name was sent (before KRB-253). */
  dropped: boolean;
  /** Table rows left out by the row cap (before KRB-253). */
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
