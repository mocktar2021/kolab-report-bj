import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV4 } from "@ai-sdk/provider";
import { z } from "zod";
import type { ModelTier } from "@/lib/prompts/catalog";

// AI settings read from the environment (see .env.example). No "server-only"
// here so the eval runner can use it from Node. The app reads it through
// src/lib/ai/config.ts, which is server-only. A value that doesn't parse
// falls back to its default instead of breaking every page.

export const AI_PROVIDERS = ["anthropic", "openai", "mock"] as const;

export type AiProvider = (typeof AI_PROVIDERS)[number];

export type ModelPrice = { inputPerMTok: number; outputPerMTok: number };

export type AiSettings = {
  provider: AiProvider;
  models: Record<ModelTier, string>;
  /** Off until the golden set passes its thresholds (evals/README.md). */
  draftsEnabled: boolean;
  /** The provider can be called: it has a key, or it is the mock outside production. */
  configured: boolean;
  defaultMaxOutputTokens: number;
  defaultTemperature: number;
  contextWindowTokens: number;
  /** Ceiling for one prompt, whatever the model accepts, to keep the cost of a draft in check. */
  maxInputTokens: number;
  rateLimitPerHour: number;
  monthlyTokenBudget: number;
  /** "Rédiger avec l'IA" calls per person and UTC day, on the new template page (KRB-198). */
  templateWriterPerDay: number;
  redactPii: boolean;
  /** OpenTelemetry spans for each generation (KRB-17). Off unless AI_TRACING=true. */
  tracing: {
    enabled: boolean;
    /** Prompts and outputs go into the spans. Needs a DPA with the tracing vendor. */
    recordContent: boolean;
    /** A trace link with "{traceId}" in it, for the dashboard. */
    urlTemplate: string | null;
  };
  /** A second provider and model, used when the first fails before answering. */
  fallback: { provider: "anthropic" | "openai"; model: string; price: ModelPrice | null } | null;
  /** Estimated USD spend per UTC day that triggers one alert e-mail, and where it goes. */
  costAlert: { dailyUsd: number; email: string } | null;
  /** USD per million tokens. Null when not set: the cost estimate stays empty. */
  prices: Record<ModelTier, ModelPrice | null>;
};

type Env = Record<string, string | undefined>;

function setting<T>(schema: z.ZodType<T, z.ZodTypeDef, unknown>, value: string | undefined, fallback: T): T {
  if (value === undefined || value.trim() === "") return fallback;
  const parsed = schema.safeParse(value.trim());
  return parsed.success ? parsed.data : fallback;
}

const positiveInt = z.coerce.number().int().positive();
const nonNegative = z.coerce.number().nonnegative();
const flag = z.enum(["true", "false", "1", "0"]).transform((value) => value === "true" || value === "1");

function price(env: Env, input: string, output: string): ModelPrice | null {
  const inputPerMTok = setting(nonNegative.nullable(), env[input], null);
  const outputPerMTok = setting(nonNegative.nullable(), env[output], null);
  return inputPerMTok === null || outputPerMTok === null ? null : { inputPerMTok, outputPerMTok };
}

const traceUrlTemplate = z
  .string()
  .url()
  .refine((value) => /^https?:\/\//.test(value) && value.includes("{traceId}"));

function hasKey(value: string | undefined): boolean {
  return Boolean(value && value.trim() && !value.startsWith("your-"));
}

/** The fallback model, when it is set, differs from the main provider's setup and has a key. */
function fallbackSetting(env: Env, provider: AiProvider): AiSettings["fallback"] {
  const fallbackProvider = setting(
    z.enum(["anthropic", "openai"]).nullable(),
    env.AI_FALLBACK_PROVIDER,
    null,
  );
  const model = setting(z.string().min(1).nullable(), env.AI_FALLBACK_MODEL, null);
  if (!fallbackProvider || !model || provider === "mock") return null;
  const key = fallbackProvider === "anthropic" ? env.ANTHROPIC_API_KEY : env.OPENAI_API_KEY;
  if (!hasKey(key)) return null;
  return {
    provider: fallbackProvider,
    model,
    price: price(env, "AI_FALLBACK_PRICE_INPUT_PER_MTOK", "AI_FALLBACK_PRICE_OUTPUT_PER_MTOK"),
  };
}

function costAlertSetting(env: Env): AiSettings["costAlert"] {
  const dailyUsd = setting(z.coerce.number().positive().nullable(), env.AI_DAILY_COST_ALERT_USD, null);
  const email = setting(z.string().email().nullable(), env.AI_ALERT_EMAIL, null);
  return dailyUsd !== null && email ? { dailyUsd, email } : null;
}

export function readAiSettings(env: Env): AiSettings {
  const provider = setting(z.enum(AI_PROVIDERS), env.AI_PROVIDER, "anthropic");
  const production = env.APP_ENV === "production" || env.VERCEL_ENV === "production";
  const key =
    provider === "anthropic" ? env.ANTHROPIC_API_KEY : provider === "openai" ? env.OPENAI_API_KEY : "";
  const configured = provider === "mock" ? !production : hasKey(key);
  const defaultModel = provider === "openai" ? "gpt-5" : "claude-sonnet-5-5";
  const defaultFast = provider === "openai" ? "gpt-5-mini" : "claude-haiku-5-5";

  return {
    provider,
    models: {
      standard: setting(z.string().min(1), env.AI_MODEL, defaultModel),
      fast: setting(z.string().min(1), env.AI_MODEL_FAST, defaultFast),
    },
    draftsEnabled: setting(flag, env.AI_DRAFTS_ENABLED, false),
    configured,
    defaultMaxOutputTokens: setting(positiveInt.max(8192), env.AI_MAX_OUTPUT_TOKENS, 4096),
    defaultTemperature: setting(z.coerce.number().min(0).max(1), env.AI_TEMPERATURE, 0.3),
    contextWindowTokens: setting(positiveInt, env.AI_CONTEXT_WINDOW_TOKENS, 200_000),
    maxInputTokens: setting(positiveInt.min(4000), env.AI_MAX_INPUT_TOKENS, 60_000),
    rateLimitPerHour: setting(positiveInt, env.AI_RATE_LIMIT_PER_HOUR, 30),
    monthlyTokenBudget: setting(positiveInt, env.AI_MONTHLY_TOKEN_BUDGET, 2_000_000),
    templateWriterPerDay: setting(positiveInt.max(1000), env.AI_TEMPLATE_WRITER_PER_DAY, 20),
    redactPii: setting(flag, env.AI_REDACT_PII, true),
    tracing: {
      enabled: setting(flag, env.AI_TRACING, false),
      recordContent: setting(flag, env.AI_TRACE_CONTENT, false),
      urlTemplate: setting(traceUrlTemplate.nullable(), env.AI_TRACE_URL_TEMPLATE, null),
    },
    fallback: fallbackSetting(env, provider),
    costAlert: costAlertSetting(env),
    prices: {
      standard: price(env, "AI_PRICE_INPUT_PER_MTOK", "AI_PRICE_OUTPUT_PER_MTOK"),
      fast: price(env, "AI_PRICE_FAST_INPUT_PER_MTOK", "AI_PRICE_FAST_OUTPUT_PER_MTOK"),
    },
  };
}

/**
 * OpenAI through the Chat Completions API, as before AI SDK 5 made the
 * Responses API the default. Structured outputs use a strict JSON schema
 * by default since AI SDK 6, so the schema is enforced as it was with
 * `structuredOutputs: true`.
 */
function openAiChat(env: Env, modelId: string): LanguageModelV4 {
  return createOpenAI({ apiKey: env.OPENAI_API_KEY }).chat(modelId);
}

/**
 * The model for a tier, or null when the provider can't be called. The mock
 * provider has no model here: callers build one with mockModel() for the
 * output they expect.
 */
export function providerModel(settings: AiSettings, tier: ModelTier, env: Env): LanguageModelV4 | null {
  if (!settings.configured) return null;
  const modelId = settings.models[tier];
  switch (settings.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(modelId);
    case "openai":
      return openAiChat(env, modelId);
    case "mock":
      return null;
  }
}

/**
 * Provider options for drafts and summaries: no thinking before the answer.
 * Claude Sonnet 5 and later think by default, and thinking counts inside
 * `maxOutputTokens`, so a long context left too little room for the JSON.
 * The Anthropic provider sends `between_tools` to Sonnet 5.5, `disabled` to
 * models that accept it, and drops it for models that always think. Other
 * providers ignore it. A new object each time, since callers may mutate it.
 */
export function noThinking(): { anthropic: { thinking: { type: "disabled" } } } {
  return { anthropic: { thinking: { type: "disabled" } } };
}

/** The fallback model, or null when none is set. */
export function fallbackModel(settings: AiSettings, env: Env): LanguageModelV4 | null {
  if (!settings.fallback) return null;
  const { provider, model } = settings.fallback;
  return provider === "anthropic"
    ? createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(model)
    : openAiChat(env, model);
}

/** The link to a trace, or null without a template. */
export function traceUrl(settings: AiSettings, traceId: string | null): string | null {
  if (!traceId || !settings.tracing.urlTemplate) return null;
  return settings.tracing.urlTemplate.replace("{traceId}", encodeURIComponent(traceId));
}

type Usage = { inputTokens: number; outputTokens: number };

function costAt(modelPrice: ModelPrice | null, usage: Usage): number | null {
  if (!modelPrice) return null;
  return (
    (usage.inputTokens * modelPrice.inputPerMTok + usage.outputTokens * modelPrice.outputPerMTok) / 1_000_000
  );
}

/** Cost in USD of a call, or null when the tier has no price set. */
export function estimateCost(settings: AiSettings, tier: ModelTier, usage: Usage): number | null {
  return costAt(settings.prices[tier], usage);
}

/** Cost in USD of a call answered by the fallback model, or null without its price. */
export function estimateFallbackCost(settings: AiSettings, usage: Usage): number | null {
  return costAt(settings.fallback?.price ?? null, usage);
}
