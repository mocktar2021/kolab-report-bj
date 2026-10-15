import { z } from "zod";

// A receipt as stored (ADR 001, section 9): public.billing_receipts and its
// lines, with the seller, the buyer and the payment frozen at issue. The PDF
// is drawn from these rows only, never from the catalogue or the current
// billing details, so a receipt reads the same every time it is downloaded.

export const RECEIPT_ENVIRONMENTS = ["sandbox", "live", "mock", "manual"] as const;

export type ReceiptEnvironment = (typeof RECEIPT_ENVIRONMENTS)[number];

export type ReceiptLine = {
  position: number;
  label: string;
  /** YYYY-MM-DD in Benin time, or null. */
  periodStart: string | null;
  periodEnd: string | null;
  quantity: number;
  unitPriceHtXof: number;
  amountHtXof: number;
  taxCode: string | null;
  taxRate: number | null;
  taxXof: number;
};

export type Receipt = {
  number: string;
  kind: "receipt" | "credit_note";
  environment: ReceiptEnvironment;
  issuedAt: string;
  seller: {
    name: string;
    legalForm: string | null;
    address: string | null;
    ifu: string | null;
    rccm: string | null;
    email: string | null;
  };
  buyer: {
    /** The organization's name at issue. */
    name: string | null;
    /** The legal name of the billing details, or the organization's name. */
    legalName: string;
    address: string | null;
    taxId: string | null;
    billingEmail: string | null;
  };
  payment: {
    method: string | null;
    /** FedaPay's payment method, for example mtn_open or momo_test. */
    mode: string | null;
    fedapayTransactionId: number | null;
    fedapayReference: string | null;
    merchantReference: string | null;
    /** The bank's reference of a transfer recorded by the operator (KRB-179). */
    transferReference: string | null;
    paidAt: string | null;
  };
  totalHtXof: number;
  totalTaxXof: number;
  totalXof: number;
  /** The normalized invoice (e-MECeF) number, empty until the accountant answers (ADR 001, A2). */
  externalInvoiceNumber: string | null;
  lines: ReceiptLine[];
};

/** Columns of public.billing_receipts the PDF reads. */
export const RECEIPT_COLUMNS =
  "id, number, kind, environment, issued_at, seller, buyer, payment, total_ht_xof, total_tax_xof, total_xof, external_invoice_number";

/** Columns of public.billing_receipt_lines the PDF reads. */
export const RECEIPT_LINE_COLUMNS =
  "position, label, period_start, period_end, quantity, unit_price_ht_xof, amount_ht_xof, tax_code, tax_rate, tax_xof";

const text = z
  .string()
  .nullish()
  .transform((value) => (value && value.trim() ? value.trim() : null));
const amount = z.number().int().nonnegative();

const rowSchema = z.object({
  number: z.string().regex(/^(KR|AV)-\d{4}-\d{6}$/),
  kind: z.enum(["receipt", "credit_note"]),
  environment: z.enum(RECEIPT_ENVIRONMENTS),
  issued_at: z.string(),
  seller: z.object({
    name: z.string().min(1),
    legal_form: text,
    address: text,
    ifu: text,
    rccm: text,
    email: text,
  }),
  buyer: z.object({
    name: text,
    legal_name: text,
    address: text,
    tax_id: text,
    billing_email: text,
  }),
  payment: z.object({
    method: text,
    mode: text,
    fedapay_transaction_id: z.number().int().nullish(),
    fedapay_reference: text,
    merchant_reference: text,
    // Absent from the receipts issued before KRB-179.
    transfer_reference: text,
    paid_at: text,
  }),
  total_ht_xof: amount,
  total_tax_xof: amount,
  total_xof: amount,
  external_invoice_number: text,
});

const lineSchema = z.object({
  position: z.number().int().positive(),
  label: z.string().min(1),
  period_start: z.string().nullable(),
  period_end: z.string().nullable(),
  quantity: z.number().int().positive(),
  unit_price_ht_xof: amount,
  amount_ht_xof: amount,
  tax_code: z.string().nullable(),
  // numeric(5, 2) may come back as a string.
  tax_rate: z.coerce.number().nullable(),
  tax_xof: amount,
});

/**
 * The receipt and its lines as read from the database, or null when a row
 * does not have the expected shape or there is no line.
 */
export function parseReceipt(row: unknown, lines: readonly unknown[]): Receipt | null {
  const receipt = rowSchema.safeParse(row);
  const parsedLines = z.array(lineSchema).min(1).safeParse(lines);
  if (!receipt.success || !parsedLines.success) return null;
  const { data } = receipt;
  const legalName = data.buyer.legal_name ?? data.buyer.name;
  if (!legalName) return null;
  return {
    number: data.number,
    kind: data.kind,
    environment: data.environment,
    issuedAt: data.issued_at,
    seller: {
      name: data.seller.name,
      legalForm: data.seller.legal_form,
      address: data.seller.address,
      ifu: data.seller.ifu,
      rccm: data.seller.rccm,
      email: data.seller.email,
    },
    buyer: {
      name: data.buyer.name,
      legalName,
      address: data.buyer.address,
      taxId: data.buyer.tax_id,
      billingEmail: data.buyer.billing_email,
    },
    payment: {
      method: data.payment.method,
      mode: data.payment.mode,
      fedapayTransactionId: data.payment.fedapay_transaction_id ?? null,
      fedapayReference: data.payment.fedapay_reference,
      merchantReference: data.payment.merchant_reference,
      transferReference: data.payment.transfer_reference,
      paidAt: data.payment.paid_at,
    },
    totalHtXof: data.total_ht_xof,
    totalTaxXof: data.total_tax_xof,
    totalXof: data.total_xof,
    externalInvoiceNumber: data.external_invoice_number,
    lines: [...parsedLines.data]
      .sort((a, b) => a.position - b.position)
      .map((line) => ({
        position: line.position,
        label: line.label,
        periodStart: line.period_start,
        periodEnd: line.period_end,
        quantity: line.quantity,
        unitPriceHtXof: line.unit_price_ht_xof,
        amountHtXof: line.amount_ht_xof,
        taxCode: line.tax_code,
        taxRate: line.tax_rate,
        taxXof: line.tax_xof,
      })),
  };
}

/** Receipts of the FedaPay sandbox and of the local mock are test receipts. */
export function isTestReceipt(environment: ReceiptEnvironment): boolean {
  return environment === "sandbox" || environment === "mock";
}

/** "recu-KR-2026-000001.pdf". The number has only letters, digits and hyphens. */
export function receiptFileName(number: string): string {
  return `recu-${number.replace(/[^A-Za-z0-9-]/g, "")}.pdf`;
}

export const PAYMENT_METHOD_KEYS = [
  "mtn",
  "moov",
  "celtiis",
  "bmo",
  "coris",
  "card",
  "test",
  "fedapay",
  "bankTransfer",
  "manual",
] as const;

export type PaymentMethodKey = (typeof PAYMENT_METHOD_KEYS)[number];

/**
 * The key of the French label of a payment method (Billing.receipt.method),
 * from the method of the purchase and FedaPay's mode. An unknown mode reads
 * as a FedaPay payment.
 */
export function paymentMethodKey(method: string | null, mode: string | null): PaymentMethodKey {
  if (method === "bank_transfer") return "bankTransfer";
  if (method === "manual") return "manual";
  const value = (mode ?? "").toLowerCase();
  if (value.endsWith("_test")) return "test";
  if (value.startsWith("mtn")) return "mtn";
  if (value.startsWith("moov")) return "moov";
  if (value.startsWith("celtiis")) return "celtiis";
  if (value.startsWith("bmo")) return "bmo";
  if (value.startsWith("coris")) return "coris";
  if (/card|visa|mastercard/.test(value)) return "card";
  return "fedapay";
}
