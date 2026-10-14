import { z } from "zod";
import { hasLetterAndDigit, PASSWORD_MAX_BYTES, PASSWORD_MIN_LENGTH, passwordBytes } from "./password-policy";

// Messages are keys under Auth.errors in messages/fr.json.
export const emailSchema = z.string().trim().toLowerCase().email("emailInvalid");

// The policy lives in password-policy.ts, shared with the forms.
export const newPasswordSchema = z
  .string()
  .min(PASSWORD_MIN_LENGTH, "passwordTooShort")
  .refine((value) => passwordBytes(value) <= PASSWORD_MAX_BYTES, "passwordTooLong")
  .refine(hasLetterAndDigit, "passwordNeedsLetterAndDigit");

export type FieldErrorKey =
  | "nameRequired"
  | "emailInvalid"
  | "passwordTooShort"
  | "passwordTooLong"
  | "passwordNeedsLetterAndDigit"
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
