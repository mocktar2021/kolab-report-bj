// Context builder of the AI draft (KRB-94, KRB-95, KRB-99). Pure functions:
// the route and the eval runner do the I/O and the summary calls.

export {
  CONTEXT_VERSION,
  buildPrompt,
  contextBudget,
  finalizeContext,
  planContext,
  summaryPrompt,
  type BuiltContext,
  type ContextBudget,
  type ContextPlan,
  type OverflowChunk,
  type PlanEntry,
  type TruncationDecision,
} from "./build";
export {
  FINAL_CHECKS,
  SUMMARY_SYSTEM_PROMPT,
  SYSTEM_PROMPT,
  deliverableBlock,
  escapeDelimiters,
  summaryBlock,
} from "./guards";
export { PII_PLACEHOLDERS, redactPii, type PiiKind } from "./redact";
export { CHARS_PER_TOKEN, estimateTokens } from "./tokens";
