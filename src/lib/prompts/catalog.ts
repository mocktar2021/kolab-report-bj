// What a prompt template can use. The database checks the same lists
// (supabase/migrations/20261013210000_prompt_library_versions.sql). Labels,
// help and sample values are under Prompts in messages/fr.json.

/** Variables a template can use, in the order the editor offers them. */
export const PROMPT_VARIABLES = [
  "section_title",
  "section_instructions",
  "report_title",
  "report_context",
  "deliverables",
  "workspace_name",
] as const;

export type PromptVariable = (typeof PROMPT_VARIABLES)[number];

/** Structured outputs the draft generation can ask for (Story KRB-16). */
export const OUTPUT_SCHEMAS = [
  "section_draft",
  "executive_summary",
  "recommendations",
  "data_analysis",
] as const;

export type OutputSchema = (typeof OUTPUT_SCHEMAS)[number];

/** "standard" runs on AI_MODEL, "fast" on AI_MODEL_FAST. */
export const MODEL_TIERS = ["standard", "fast"] as const;

export type ModelTier = (typeof MODEL_TIERS)[number];

/** Mirrors the public.prompt_status enum. */
export const PROMPT_STATUSES = ["draft", "published", "archived"] as const;

export type PromptStatus = (typeof PROMPT_STATUSES)[number];

/** Same bounds as the checks on public.prompt_library. */
export const PROMPT_LIMITS = {
  titleMin: 2,
  titleMax: 200,
  descriptionMax: 500,
  templateMax: 20_000,
  changelogMax: 500,
  keyMax: 60,
  temperatureMin: 0,
  temperatureMax: 1,
  maxOutputTokensMin: 256,
  maxOutputTokensMax: 8192,
} as const;
