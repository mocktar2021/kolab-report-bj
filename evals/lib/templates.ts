import { createHash } from "node:crypto";
import { readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { z } from "zod";
import { MODEL_TIERS, OUTPUT_SCHEMAS, type ModelTier, type OutputSchema } from "@/lib/prompts/catalog";

// The global templates come from the migrations that insert them, so the
// evals always test the text the app ships. A later migration that adds a
// version of a template_key wins over the earlier one.

export const MIGRATIONS_DIR = "supabase/migrations";

export type EvalTemplate = {
  key: string;
  title: string;
  text: string;
  outputSchema: OutputSchema;
  tier: ModelTier;
  temperature: number;
  maxOutputTokens: number;
  /** First 8 hex characters of the sha256 of the text. */
  version: string;
  /** Migration file or prompt file the text comes from. */
  source: string;
};

/** The prompt version of a template text: a sha256 prefix, stable across runs. */
export function promptVersion(text: string): string {
  return createHash("sha256").update(text, "utf8").digest("hex").slice(0, 8);
}

// One row of the insert: (null, 'key', 'title', 'description', $tpl$text$tpl$,
// 'variables', 'output_schema', 'tier', temperature, max_output_tokens, ...
const ROW =
  /\(\s*null\s*,\s*'([a-z0-9-]+)'\s*,\s*'((?:[^']|'')*)'\s*,\s*'(?:[^']|'')*'\s*,\s*\$tpl\$([\s\S]*?)\$tpl\$\s*,\s*'[^']*'\s*,\s*'([a-z_]+)'\s*,\s*'([a-z]+)'\s*,\s*([0-9.]+)\s*,\s*([0-9]+)\s*,/g;

const rowSchema = z.object({
  outputSchema: z.enum(OUTPUT_SCHEMAS),
  tier: z.enum(MODEL_TIERS),
  temperature: z.number().min(0).max(1),
  maxOutputTokens: z.number().int().min(256).max(8192),
});

/** Global templates found in one SQL file, in file order. */
export function parseTemplates(sql: string, source: string): EvalTemplate[] {
  const templates: EvalTemplate[] = [];
  for (const match of sql.matchAll(ROW)) {
    const [, key = "", title = "", text = "", outputSchema, tier, temperature, maxOutputTokens] = match;
    const row = rowSchema.parse({
      outputSchema,
      tier,
      temperature: Number(temperature),
      maxOutputTokens: Number(maxOutputTokens),
    });
    templates.push({
      key,
      title: title.replaceAll("''", "'"),
      text,
      ...row,
      version: promptVersion(text),
      source,
    });
  }
  return templates;
}

/** The latest version of every global template, by template_key. */
export function loadGlobalTemplates(dir = resolve(MIGRATIONS_DIR)): Map<string, EvalTemplate> {
  const templates = new Map<string, EvalTemplate>();
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort();
  for (const name of files) {
    for (const template of parseTemplates(readFileSync(join(dir, name), "utf8"), `${MIGRATIONS_DIR}/${name}`))
      templates.set(template.key, template);
  }
  return templates;
}

/**
 * A template read from a file (--prompt-file), to test a new version before
 * it ships. It replaces the template of every case whose template has the
 * same output schema, and keeps that template's tier, temperature and token cap.
 */
export function templateFromFile(base: EvalTemplate, text: string, source: string): EvalTemplate {
  return { ...base, text, version: promptVersion(text), source };
}
