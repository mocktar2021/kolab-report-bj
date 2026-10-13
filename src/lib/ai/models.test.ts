import { describe, expect, it } from "vitest";
import { estimateCost, estimateFallbackCost, readAiSettings } from "./models";

const usage = { inputTokens: 1_000_000, outputTokens: 500_000 };

describe("fallback model settings", () => {
  it("needs a provider, a model and that provider's key", () => {
    expect(
      readAiSettings({ AI_FALLBACK_PROVIDER: "openai", AI_FALLBACK_MODEL: "gpt-5" }).fallback,
    ).toBeNull();
    expect(
      readAiSettings({ AI_FALLBACK_PROVIDER: "openai", AI_FALLBACK_MODEL: "gpt-5", OPENAI_API_KEY: "sk-1" })
        .fallback,
    ).toEqual({ provider: "openai", model: "gpt-5", price: null });
  });

  it("is off with the mock provider", () => {
    expect(
      readAiSettings({
        AI_PROVIDER: "mock",
        AI_FALLBACK_PROVIDER: "openai",
        AI_FALLBACK_MODEL: "gpt-5",
        OPENAI_API_KEY: "sk-1",
      }).fallback,
    ).toBeNull();
  });

  it("prices the drafts the fallback writes with its own prices", () => {
    const settings = readAiSettings({
      AI_PRICE_INPUT_PER_MTOK: "3",
      AI_PRICE_OUTPUT_PER_MTOK: "15",
      AI_FALLBACK_PROVIDER: "openai",
      AI_FALLBACK_MODEL: "gpt-5",
      OPENAI_API_KEY: "sk-1",
      AI_FALLBACK_PRICE_INPUT_PER_MTOK: "1.25",
      AI_FALLBACK_PRICE_OUTPUT_PER_MTOK: "10",
    });
    expect(estimateCost(settings, "standard", usage)).toBe(10.5);
    expect(estimateFallbackCost(settings, usage)).toBe(6.25);
  });

  it("gives no cost for the fallback without its prices", () => {
    const settings = readAiSettings({
      AI_PRICE_INPUT_PER_MTOK: "3",
      AI_PRICE_OUTPUT_PER_MTOK: "15",
      AI_FALLBACK_PROVIDER: "openai",
      AI_FALLBACK_MODEL: "gpt-5",
      OPENAI_API_KEY: "sk-1",
    });
    expect(estimateFallbackCost(settings, usage)).toBeNull();
    expect(estimateFallbackCost(readAiSettings({}), usage)).toBeNull();
  });
});
