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
  | "maxOutputTokensRange";

/** "" from an empty field becomes null, other values a number. */
const optionalNumber = (key: PromptFieldErrorKey, min: number, max: number, integer = false) =>
  z
    .union([z.literal(""), z.number(), z.string()])
    .transform((value) => (value === "" ? null : Number(String(value).replace(",", "."))))
    .pipe(
      z
        .number({ invalid_type_error: key })
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
        .min(PROMPT_LIMITS.titleMin, "titleLength")
        .max(PROMPT_LIMITS.titleMax, "titleLength"),
      description: z
        .string()
        .trim()
        .max(PROMPT_LIMITS.descriptionMax, "descriptionLength")
        .transform((value) => value || null),
      template: z
        .string()
        .max(PROMPT_LIMITS.templateMax, "templateLength")
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
