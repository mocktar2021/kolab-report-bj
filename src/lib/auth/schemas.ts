import { z } from "zod";

// Messages are keys under Auth.errors in messages/fr.json.
export const emailSchema = z.string().trim().toLowerCase().email("emailInvalid");

// 72 bytes is the bcrypt limit used by Supabase Auth.
export const newPasswordSchema = z.string().min(8, "passwordTooShort").max(72, "passwordTooLong");

export type FieldErrorKey =
  | "nameRequired"
  | "emailInvalid"
  | "passwordTooShort"
  | "passwordTooLong"
  | "passwordMismatch";

/** First error key per field, from a zod error whose messages are FieldErrorKey values. */
export function fieldErrors<T extends string>(error: z.ZodError): Partial<Record<T, FieldErrorKey>> {
  const out: Partial<Record<T, FieldErrorKey>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as T | undefined;
    if (field && !out[field]) out[field] = issue.message as FieldErrorKey;
  }
  return out;
}
