import { z } from "zod";

// The billing details form of the billing page (KRB-177): the buyer columns
// of public.organization_billing, copied into the next receipts. Lengths
// and the e-mail rule match the checks of that table
// (supabase/migrations/20261015100000_billing_entitlements.sql). An empty
// field clears the column. Messages are keys under Billing.page.details.errors
// in messages/fr.json.

export const BILLING_DETAILS_FIELDS = ["legalName", "address", "taxId", "billingEmail"] as const;

export type BillingDetailsField = (typeof BILLING_DETAILS_FIELDS)[number];

export type BillingDetailsErrorKey =
  | "legalNameLength"
  | "addressLength"
  | "taxIdInvalid"
  | "emailInvalid"
  | "forbidden"
  | "failed";

/** Trimmed, with runs of spaces and line breaks made one space; empty becomes null. */
function clean(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const text = value.replace(/\s+/g, " ").trim();
  return text === "" ? null : text;
}

export const billingDetailsSchema = z.object({
  legalName: z.preprocess(clean, z.string().min(2, "legalNameLength").max(200, "legalNameLength").nullable()),
  address: z.preprocess(clean, z.string().max(500, "addressLength").nullable()),
  // IFU in Benin is 13 digits; other countries write theirs with letters,
  // spaces, dots, hyphens or slashes.
  taxId: z.preprocess(
    clean,
    z
      .string()
      .max(40, "taxIdInvalid")
      .regex(/^[\p{L}\p{N}][\p{L}\p{N} ./-]*$/u, "taxIdInvalid")
      .nullable(),
  ),
  billingEmail: z.preprocess(
    (value) => clean(value)?.toLowerCase() ?? null,
    z
      .string()
      .max(254, "emailInvalid")
      .regex(/^[^@\s]+@[^@\s]+\.[^@\s]+$/, "emailInvalid")
      .nullable(),
  ),
});

export type BillingDetails = z.infer<typeof billingDetailsSchema>;

/** First error key per field, from a billingDetailsSchema error. */
export function billingDetailsErrors(
  error: z.ZodError,
): Partial<Record<BillingDetailsField, BillingDetailsErrorKey>> {
  const out: Partial<Record<BillingDetailsField, BillingDetailsErrorKey>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0];
    if (typeof field === "string" && (BILLING_DETAILS_FIELDS as readonly string[]).includes(field)) {
      out[field as BillingDetailsField] ??= issue.message as BillingDetailsErrorKey;
    }
  }
  return out;
}
