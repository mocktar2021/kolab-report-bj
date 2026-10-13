import "server-only";
import type { LanguageModelV1 } from "ai";
import type { ModelTier } from "@/lib/prompts/catalog";
import { providerModel, readAiSettings, type AiSettings } from "./models";

/** AI settings of this server, read once per process. */
let settings: AiSettings | null = null;

export function aiSettings(): AiSettings {
  settings ??= readAiSettings(process.env);
  return settings;
}

/** "enabled": drafts can be asked for. Otherwise why not, for the section page. */
export type DraftAvailability = "enabled" | "disabled" | "unconfigured";

export function draftAvailability(): DraftAvailability {
  const current = aiSettings();
  if (!current.configured) return "unconfigured";
  return current.draftsEnabled ? "enabled" : "disabled";
}

/** The provider's model for a tier. Null for the mock provider, which builds its own per request. */
export function modelFor(tier: ModelTier): LanguageModelV1 | null {
  return providerModel(aiSettings(), tier, process.env);
}
