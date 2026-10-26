// Context builder of the AI draft (KRB-94, KRB-99, KRB-253). Pure functions:
// the route and the eval runner do the I/O.

export {
  CONTEXT_VERSION,
  buildContext,
  buildPrompt,
  contextBudget,
  type BuiltContext,
  type ContextBudget,
  type ContextDecision,
  type ContextResult,
} from "./build";
export { FINAL_CHECKS, SYSTEM_PROMPT, deliverableBlock, escapeDelimiters } from "./guards";
export { PII_PLACEHOLDERS, redactPii, type PiiKind } from "./redact";
export { CHARS_PER_TOKEN, estimateTokens } from "./tokens";
