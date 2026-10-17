import "server-only";
import { z } from "zod";
import type { FedapayConfig } from "./settings";

// A small FedaPay client with fetch (ADR 001, section 8.8): the four calls of
// the payment flow and nothing else. Every call returns a result instead of
// throwing. An error carries a fixed code, the HTTP status and the request
// line, never FedaPay's own text, which can hold customer data. Callers log
// "billing: fedapay request failed" with those fields and the purchase id.
//
// Answers are read defensively (ADR 001, section 14): the SDK's fixtures
// wrap objects under a "v1/transaction" key, the API reference shows them at
// the top level, and both are accepted. Unknown fields are dropped, so no raw
// payload with an e-mail or a phone number travels further than this file.

/** Each call gives up after this long (AbortSignal.timeout). */
export const FEDAPAY_TIMEOUT_MS = 10_000;

/** Statuses of ADR 001, section 14. FedaPay can send others, such as "approved_partially_refunded". */
export const FEDAPAY_STATUSES = [
  "pending",
  "approved",
  "declined",
  "canceled",
  "refunded",
  "transferred",
  "expired",
] as const;

export type FedapayErrorCode =
  /** Our input failed validation. Nothing was sent. */
  | "invalid_request"
  /** No answer within FEDAPAY_TIMEOUT_MS. A create may still have gone through. */
  | "timeout"
  /** The request could not be sent or the connection broke. A create may still have gone through. */
  | "network"
  /** 5xx or 429. A create may have gone through, and a later call may work. */
  | "unavailable"
  /** 401 or 403: wrong key, or a key of the other mode. */
  | "unauthorized"
  /** 404. */
  | "not_found"
  /** Any other 4xx, for example a validation error or a merchant reference already used. */
  | "rejected"
  /** A 2xx answer that is not JSON or not the expected object. */
  | "invalid_response";

export type FedapayError = {
  code: FedapayErrorCode;
  /** FedaPay's HTTP status, null when there was no answer. */
  status: number | null;
  /** Method and path, for logs, for example "POST /v1/transactions". No key, no query string. */
  request: string;
  /** The outcome is unknown or may change: look up by merchant reference before creating again. */
  transient: boolean;
  /** A fixed English sentence for logs. */
  message: string;
};

export type FedapayResult<T> = { ok: true; value: T } | { ok: false; error: FedapayError };

/** A transaction as KolabReport reads it. Amounts are whole XOF. */
export type FedapayTransaction = {
  id: number;
  reference: string | null;
  /** One of FEDAPAY_STATUSES, or another status FedaPay adds later. */
  status: string;
  amountXof: number;
  /** Rounded to whole XOF. Null until FedaPay knows them. */
  feesXof: number | null;
  /** Payment method, for example "mtn_open" or "momo_test". */
  mode: string | null;
  /**
   * ISO code when FedaPay sends a currency object or code, null otherwise.
   * The API reference only lists currency_id on a transaction.
   */
  currencyIso: string | null;
  /** FedaPay's id of the currency, null when absent. */
  currencyId: number | null;
  merchantReference: string | null;
  customMetadata: Record<string, unknown> | null;
  approvedAt: string | null;
};

/** The payment page of a transaction. */
export type FedapayToken = { token: string; url: string };

export type FedapayCustomer = { email: string; firstname?: string; lastname?: string };

export type CreateTransactionInput = {
  /** Shown to the customer, for example "KolabReport, offre Cabinet, 1 mois, Cabinet Dossou". */
  description: string;
  /** Whole XOF, from the catalogue, never from the browser. */
  amountXof: number;
  /** FedaPay sends the customer back here with ?id=&status=. */
  callbackUrl: string;
  /** merchantReference(purchase id). FedaPay refuses a second transaction with the same one. */
  merchantReference: string;
  /** Non-sensitive data only, for example { purchase_id }. */
  customMetadata?: Record<string, string | number>;
  /** No phone number: the customer types it on FedaPay's page. */
  customer: FedapayCustomer;
};

const UUID = "[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}";
const MERCHANT_REFERENCE = new RegExp(`^KR-(${UUID})$`);

/** The merchant reference of a purchase: "KR-" and the purchase id (ADR 001, section 8.2). */
export function merchantReference(purchaseId: string): string {
  return `KR-${purchaseId.toLowerCase()}`;
}

/** The purchase id inside a merchant reference, or null when it is not one of ours. */
export function purchaseIdFromMerchantReference(reference: string): string | null {
  return MERCHANT_REFERENCE.exec(reference)?.[1] ?? null;
}

const MESSAGES: Record<FedapayErrorCode, string> = {
  invalid_request: "FedaPay request not sent: invalid input",
  timeout: "FedaPay did not answer in time",
  network: "FedaPay could not be reached",
  unavailable: "FedaPay is unavailable",
  unauthorized: "FedaPay refused the API key",
  not_found: "FedaPay found nothing",
  rejected: "FedaPay refused the request",
  invalid_response: "FedaPay sent an unexpected answer",
};

const TRANSIENT = new Set<FedapayErrorCode>(["timeout", "network", "unavailable"]);

function failure(
  code: FedapayErrorCode,
  status: number | null,
  request: string,
): { ok: false; error: FedapayError } {
  return {
    ok: false,
    error: { code, status, request, transient: TRANSIENT.has(code), message: MESSAGES[code] },
  };
}

function httpCode(status: number): FedapayErrorCode {
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 404) return "not_found";
  if (status === 429 || status >= 500) return "unavailable";
  return "rejected";
}

function isTimeout(error: unknown): boolean {
  // Checked by name: the DOMException class differs between runtimes.
  const name = typeof error === "object" && error !== null && "name" in error ? error.name : null;
  return name === "TimeoutError" || name === "AbortError";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** The object under "v1/<name>" or "<name>" when FedaPay wraps it, else the answer itself. */
function unwrap(body: unknown, name: string): unknown {
  if (!isRecord(body)) return body;
  for (const key of [`v1/${name}`, name]) {
    const inner = body[key];
    if (isRecord(inner) || Array.isArray(inner)) return inner;
  }
  return body;
}

type Answer = { ok: true; status: number; body: unknown } | { ok: false; error: FedapayError };

async function call(
  config: FedapayConfig,
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<Answer> {
  const request = `${method} ${path}`;
  let response: Response;
  try {
    response = await fetch(`${config.apiBaseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${config.secretKey}`,
        Accept: "application/json",
        ...(body === undefined ? {} : { "Content-Type": "application/json" }),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(FEDAPAY_TIMEOUT_MS),
      cache: "no-store",
      // A redirect would resend the key to another address: fail instead.
      redirect: "error",
    });
  } catch (error) {
    return failure(isTimeout(error) ? "timeout" : "network", null, request);
  }

  if (!response.ok) {
    // FedaPay's error text stays here: it can quote the customer.
    await response.body?.cancel().catch(() => {});
    return failure(httpCode(response.status), response.status, request);
  }

  let text: string;
  try {
    text = await response.text();
  } catch (error) {
    return failure(isTimeout(error) ? "timeout" : "network", response.status, request);
  }
  try {
    return { ok: true, status: response.status, body: JSON.parse(text) };
  } catch {
    return failure("invalid_response", response.status, request);
  }
}

const optionalText = z
  .string()
  .nullish()
  .transform((value) => value ?? null);

/** "XOF" from { iso: "XOF" } or "xof", null from anything else. */
function currencyIso(value: unknown): string | null {
  const iso = isRecord(value) ? value.iso : value;
  return typeof iso === "string" && /^[A-Za-z]{3}$/.test(iso) ? iso.toUpperCase() : null;
}

const transactionSchema = z
  .object({
    id: z.number().int().positive(),
    reference: optionalText,
    status: z.string().min(1),
    amount: z.number().int().nonnegative(),
    fees: z.number().nonnegative().nullish(),
    mode: optionalText,
    merchant_reference: optionalText,
    // An empty map can come back as [] from a PHP API: read it as no metadata.
    custom_metadata: z.unknown().optional(),
    approved_at: optionalText,
    // An object such as { iso: "XOF" } when FedaPay includes it, or a code.
    currency: z.unknown().optional(),
    currency_id: z.number().int().nullish(),
  })
  .transform((raw): FedapayTransaction => ({
    id: raw.id,
    reference: raw.reference,
    status: raw.status,
    amountXof: raw.amount,
    feesXof: raw.fees == null ? null : Math.round(raw.fees),
    mode: raw.mode,
    merchantReference: raw.merchant_reference,
    customMetadata: isRecord(raw.custom_metadata) ? raw.custom_metadata : null,
    approvedAt: raw.approved_at,
    currencyIso: currencyIso(raw.currency),
    currencyId: raw.currency_id ?? null,
  }));

const tokenSchema = z.object({
  token: z.string().min(1),
  url: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//.test(value)),
});

function parsed<T>(
  schema: z.ZodType<T, z.ZodTypeDef, unknown>,
  value: unknown,
  status: number,
  request: string,
): FedapayResult<T> {
  const result = schema.safeParse(value);
  return result.success ? { ok: true, value: result.data } : failure("invalid_response", status, request);
}

const createInputSchema = z.object({
  description: z.string().trim().min(1).max(255),
  amountXof: z.number().int().positive().max(1_000_000_000),
  callbackUrl: z
    .string()
    .url()
    .refine((value) => /^https?:\/\//.test(value)),
  merchantReference: z.string().regex(MERCHANT_REFERENCE),
  customMetadata: z.record(z.union([z.string().max(200), z.number()])).optional(),
  customer: z.object({
    email: z.string().email(),
    firstname: z.string().trim().max(100).optional(),
    lastname: z.string().trim().max(100).optional(),
  }),
});

/** POST /v1/transactions: a pending XOF transaction for one purchase. */
export async function createTransaction(
  config: FedapayConfig,
  input: CreateTransactionInput,
): Promise<FedapayResult<FedapayTransaction>> {
  const request = "POST /v1/transactions";
  const checked = createInputSchema.safeParse(input);
  if (!checked.success) return failure("invalid_request", null, request);
  const { description, amountXof, callbackUrl, customMetadata, customer } = checked.data;

  const answer = await call(config, "POST", "/v1/transactions", {
    description,
    amount: amountXof,
    currency: { iso: "XOF" },
    callback_url: callbackUrl,
    merchant_reference: checked.data.merchantReference,
    ...(customMetadata ? { custom_metadata: customMetadata } : {}),
    customer: {
      email: customer.email,
      ...(customer.firstname ? { firstname: customer.firstname } : {}),
      ...(customer.lastname ? { lastname: customer.lastname } : {}),
    },
  });
  if (!answer.ok) return answer;
  return parsed(transactionSchema, unwrap(answer.body, "transaction"), answer.status, request);
}

function transactionPath(transactionId: number): string | null {
  return Number.isSafeInteger(transactionId) && transactionId > 0
    ? `/v1/transactions/${transactionId}`
    : null;
}

/** POST /v1/transactions/{id}/token: the payment page to send the customer to. Ask a new one for each attempt. */
export async function createToken(
  config: FedapayConfig,
  transactionId: number,
): Promise<FedapayResult<FedapayToken>> {
  const path = transactionPath(transactionId);
  if (!path) return failure("invalid_request", null, "POST /v1/transactions/{id}/token");
  const answer = await call(config, "POST", `${path}/token`, {});
  if (!answer.ok) return answer;
  return parsed(tokenSchema, unwrap(answer.body, "token"), answer.status, `POST ${path}/token`);
}

/** GET /v1/transactions/{id}: the status, amount and reference to trust, whatever a webhook or a URL said. */
export async function getTransaction(
  config: FedapayConfig,
  transactionId: number,
): Promise<FedapayResult<FedapayTransaction>> {
  const path = transactionPath(transactionId);
  if (!path) return failure("invalid_request", null, "GET /v1/transactions/{id}");
  const request = `GET ${path}`;
  const answer = await call(config, "GET", path);
  if (!answer.ok) return answer;
  const result = parsed(transactionSchema, unwrap(answer.body, "transaction"), answer.status, request);
  // Never act on another transaction than the one asked for.
  if (result.ok && result.value.id !== transactionId)
    return failure("invalid_response", answer.status, request);
  return result;
}

/**
 * GET /v1/transactions/merchant/{reference}: finds the transaction of a
 * purchase, for example after a create that timed out. The error code is
 * "not_found" when FedaPay has none.
 */
export async function getTransactionByMerchantReference(
  config: FedapayConfig,
  reference: string,
): Promise<FedapayResult<FedapayTransaction>> {
  if (!MERCHANT_REFERENCE.test(reference)) {
    return failure("invalid_request", null, "GET /v1/transactions/merchant/{reference}");
  }
  const path = `/v1/transactions/merchant/${encodeURIComponent(reference)}`;
  const request = `GET ${path}`;
  const answer = await call(config, "GET", path);
  if (!answer.ok) return answer;

  // A single transaction is expected. A list of one is read the same way.
  let body = unwrap(answer.body, "transaction");
  if (body === answer.body) body = unwrap(answer.body, "transactions");
  if (Array.isArray(body)) {
    if (body.length === 0) return failure("not_found", answer.status, request);
    if (body.length > 1) return failure("invalid_response", answer.status, request);
    body = body[0];
  }
  const result = parsed(transactionSchema, body, answer.status, request);
  if (result.ok && result.value.merchantReference !== reference) {
    return failure("invalid_response", answer.status, request);
  }
  return result;
}
