import { createAnthropic } from "@ai-sdk/anthropic";
import { createOpenAI } from "@ai-sdk/openai";
import type { LanguageModelV1 } from "ai";
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
  redactPii: boolean;
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

export function readAiSettings(env: Env): AiSettings {
  const provider = setting(z.enum(AI_PROVIDERS), env.AI_PROVIDER, "anthropic");
  const production = env.APP_ENV === "production" || env.VERCEL_ENV === "production";
  const key =
    provider === "anthropic" ? env.ANTHROPIC_API_KEY : provider === "openai" ? env.OPENAI_API_KEY : "";
  const configured =
    provider === "mock" ? !production : Boolean(key && key.trim() && !key.startsWith("your-"));
  const fallbackModel = provider === "openai" ? "gpt-5" : "claude-sonnet-5-5";
  const fallbackFast = provider === "openai" ? "gpt-5-mini" : "claude-haiku-5-5";

  return {
    provider,
    models: {
      standard: setting(z.string().min(1), env.AI_MODEL, fallbackModel),
      fast: setting(z.string().min(1), env.AI_MODEL_FAST, fallbackFast),
    },
    draftsEnabled: setting(flag, env.AI_DRAFTS_ENABLED, false),
    configured,
    defaultMaxOutputTokens: setting(positiveInt.max(8192), env.AI_MAX_OUTPUT_TOKENS, 4096),
    defaultTemperature: setting(z.coerce.number().min(0).max(1), env.AI_TEMPERATURE, 0.3),
    contextWindowTokens: setting(positiveInt, env.AI_CONTEXT_WINDOW_TOKENS, 200_000),
    maxInputTokens: setting(positiveInt.min(4000), env.AI_MAX_INPUT_TOKENS, 60_000),
    rateLimitPerHour: setting(positiveInt, env.AI_RATE_LIMIT_PER_HOUR, 30),
    monthlyTokenBudget: setting(positiveInt, env.AI_MONTHLY_TOKEN_BUDGET, 2_000_000),
    redactPii: setting(flag, env.AI_REDACT_PII, true),
    prices: {
      standard: price(env, "AI_PRICE_INPUT_PER_MTOK", "AI_PRICE_OUTPUT_PER_MTOK"),
      fast: price(env, "AI_PRICE_FAST_INPUT_PER_MTOK", "AI_PRICE_FAST_OUTPUT_PER_MTOK"),
    },
  };
}

/**
 * The model for a tier, or null when the provider can't be called. The mock
 * provider has no model here: callers build one with mockModel() for the
 * output they expect.
 */
export function providerModel(settings: AiSettings, tier: ModelTier, env: Env): LanguageModelV1 | null {
  if (!settings.configured) return null;
  const modelId = settings.models[tier];
  switch (settings.provider) {
    case "anthropic":
      return createAnthropic({ apiKey: env.ANTHROPIC_API_KEY })(modelId);
    case "openai":
      return createOpenAI({ apiKey: env.OPENAI_API_KEY, compatibility: "strict" })(modelId, {
        structuredOutputs: true,
      });
    case "mock":
      return null;
  }
}

/** Cost in USD of a call, or null when the tier has no price set. */
export function estimateCost(
  settings: AiSettings,
  tier: ModelTier,
  usage: { inputTokens: number; outputTokens: number },
): number | null {
  const tierPrice = settings.prices[tier];
  if (!tierPrice) return null;
  return (
    (usage.inputTokens * tierPrice.inputPerMTok + usage.outputTokens * tierPrice.outputPerMTok) / 1_000_000
  );
}
