import { z } from "zod";
import { MODEL_TIERS, OUTPUT_SCHEMAS, PROMPT_LIMITS } from "./catalog";
import { checkTemplate } from "./template";

// Messages are keys under Prompts.fieldErrors in messages/fr.json.
export type PromptFieldErrorKey =
  | "titleLength"
  | "descriptionLength"
  | "templateEmpty"
  | "templateLength"
  | "templateUnclosed"
  | "templateUnknown"
  | "changelogRequired"
  | "changelogLength"
  | "outputSchema"
  | "modelTier"
  | "temperatureRange"
  | "maxOutputTokensRange"
  | "invalidCharacters";

/** Postgres refuses text with a NUL character. */
const noNul = (value: string) => !value.includes("\u0000");

/** Characters as Postgres counts them (char_length): an emoji is one, not two. */
const characters = (value: string) => [...value].length;

/** An empty field becomes null, anything else a number. */
const optionalNumber = (key: PromptFieldErrorKey, min: number, max: number, integer = false) =>
  z
    .union([z.null(), z.number(), z.string()])
    .transform((value) => {
      const text = typeof value === "string" ? value.trim() : value;
      return text === "" || text === null ? null : Number(String(text).replace(",", "."));
    })
    .pipe(
      z
        .number({ error: key })
        .min(min, key)
        .max(max, key)
        .refine((value) => !integer || Number.isInteger(value), key)
        .nullable(),
    );

/**
 * A new version of a template, as the editor sends it. `isFirstVersion`
 * decides whether the changelog may stay empty.
 */
export function promptVersionSchema(isFirstVersion: boolean) {
  return z
    .object({
      title: z
        .string()
        .trim()
        .refine(noNul, "invalidCharacters")
        .refine(
          (value) =>
            characters(value) >= PROMPT_LIMITS.titleMin && characters(value) <= PROMPT_LIMITS.titleMax,
          "titleLength",
        ),
      description: z
        .string()
        .trim()
        .max(PROMPT_LIMITS.descriptionMax, "descriptionLength")
        .refine(noNul, "invalidCharacters")
        .transform((value) => value || null),
      template: z
        .string()
        .max(PROMPT_LIMITS.templateMax, "templateLength")
        .refine(noNul, "invalidCharacters")
        .refine((value) => value.trim().length > 0, "templateEmpty"),
      outputSchema: z.enum(OUTPUT_SCHEMAS, { message: "outputSchema" }),
      modelTier: z.enum(MODEL_TIERS, { message: "modelTier" }),
      temperature: optionalNumber(
        "temperatureRange",
        PROMPT_LIMITS.temperatureMin,
        PROMPT_LIMITS.temperatureMax,
      ),
      maxOutputTokens: optionalNumber(
        "maxOutputTokensRange",
        PROMPT_LIMITS.maxOutputTokensMin,
        PROMPT_LIMITS.maxOutputTokensMax,
        true,
      ),
      changelog: z
        .string()
        .trim()
        .max(PROMPT_LIMITS.changelogMax, "changelogLength")
        .refine(noNul, "invalidCharacters")
        .refine((value) => isFirstVersion || value.length > 0, "changelogRequired")
        .transform((value) => value || null),
      publish: z.boolean(),
    })
    .superRefine((value, ctx) => {
      const check = checkTemplate(value.template);
      if (check.unclosed) ctx.addIssue({ code: "custom", path: ["template"], message: "templateUnclosed" });
      else if (check.unknown.length > 0)
        ctx.addIssue({ code: "custom", path: ["template"], message: "templateUnknown" });
    });
}

export type PromptVersionInput = z.input<ReturnType<typeof promptVersionSchema>>;
export type PromptVersion = z.output<ReturnType<typeof promptVersionSchema>>;

/** First error key per field, from a zod error whose messages are PromptFieldErrorKey values. */
export function promptFieldErrors(error: z.ZodError): Partial<Record<string, PromptFieldErrorKey>> {
  const errors: Partial<Record<string, PromptFieldErrorKey>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && !errors[field]) errors[field] = issue.message as PromptFieldErrorKey;
  }
  return errors;
}
