import { createHmac, timingSafeEqual } from "node:crypto";

// The X-FEDAPAY-SIGNATURE check of ADR 001, section 8.4, written from the
// algorithm of FedaPay's Node SDK (fedapay 1.2.5, src/Webhook.ts):
//
//   X-FEDAPAY-SIGNATURE: t=<unix seconds>,s=<hex HMAC-SHA256>
//
// The HMAC is computed over "<t>.<raw body>" with the endpoint's webhook
// secret. Any of several s= values may match. Unlike the SDK, a timestamp
// too far ahead is refused too, not only one too old.
//
// No "server-only" import: it holds no secret, and end-to-end tests sign
// webhooks with signatureHeader().

export const WEBHOOK_SIGNATURE_HEADER = "x-fedapay-signature";

/** Seconds a signed delivery stays valid, before or after now. The SDK's default. */
export const WEBHOOK_TOLERANCE_SECONDS = 300;

/** A real header is about 80 characters. Anything far longer is not one. */
const MAX_HEADER_LENGTH = 1024;

export type WebhookSignatureFailure =
  /** No header, or an empty one. */
  | "missing"
  /** No t=, a t= that is not a whole number, or no s=. */
  | "malformed"
  /** No s= matches the body and the secret. */
  | "signature"
  /** A valid signature, but the timestamp is outside the tolerance. */
  | "stale"
  /** The secret is empty, so nothing can be trusted. */
  | "no_secret";

export type WebhookSignatureResult =
  | { ok: true; timestamp: number }
  | { ok: false; reason: WebhookSignatureFailure };

export type ParsedSignatureHeader = { timestamp: number; signatures: string[] };

/** Reads "t=<unix>,s=<hex>[,s=<hex>...]". Null when there is no usable t= or s=. */
export function parseSignatureHeader(header: string): ParsedSignatureHeader | null {
  if (header.length > MAX_HEADER_LENGTH) return null;
  let timestamp: number | null = null;
  const signatures: string[] = [];
  for (const part of header.split(",")) {
    const separator = part.indexOf("=");
    if (separator < 0) continue;
    const key = part.slice(0, separator).trim();
    const value = part.slice(separator + 1).trim();
    if (key === "t") {
      if (!/^\d{1,12}$/.test(value)) return null;
      timestamp = Number(value);
    } else if (key === "s" && value) {
      signatures.push(value);
    }
  }
  return timestamp === null || signatures.length === 0 ? null : { timestamp, signatures };
}

function hmac(secret: string, timestamp: number, rawBody: string | Uint8Array): Buffer {
  const mac = createHmac("sha256", secret);
  mac.update(`${timestamp}.`);
  mac.update(rawBody);
  return mac.digest();
}

/** True when the hex value is the expected HMAC, compared in constant time. */
function matches(expected: Buffer, candidate: string): boolean {
  if (!/^[0-9a-f]{64}$/i.test(candidate)) return false;
  return timingSafeEqual(expected, Buffer.from(candidate, "hex"));
}

export type VerifyWebhookInput = {
  /** The X-FEDAPAY-SIGNATURE value, null when absent. */
  header: string | null | undefined;
  /** The body exactly as received, before any JSON parsing. */
  rawBody: string | Uint8Array;
  secret: string;
  /** For tests. Defaults to the current time. */
  now?: Date;
};

/** Checks a webhook delivery. Read the body as text first, parse the JSON only after this passes. */
export function verifyWebhookSignature(input: VerifyWebhookInput): WebhookSignatureResult {
  if (!input.secret) return { ok: false, reason: "no_secret" };
  const header = input.header?.trim();
  if (!header) return { ok: false, reason: "missing" };
  const parsed = parseSignatureHeader(header);
  if (!parsed) return { ok: false, reason: "malformed" };

  const expected = hmac(input.secret, parsed.timestamp, input.rawBody);
  // Every candidate is checked, so the time taken does not depend on which one matches.
  const matched = parsed.signatures.reduce(
    (found, candidate) => matches(expected, candidate) || found,
    false,
  );
  if (!matched) return { ok: false, reason: "signature" };

  const nowSeconds = Math.floor((input.now ?? new Date()).getTime() / 1000);
  if (Math.abs(nowSeconds - parsed.timestamp) > WEBHOOK_TOLERANCE_SECONDS)
    return { ok: false, reason: "stale" };
  return { ok: true, timestamp: parsed.timestamp };
}

/** The header FedaPay would send for this body, for tests. The mock server signs the same way. */
export function signatureHeader(
  rawBody: string | Uint8Array,
  secret: string,
  now: Date = new Date(),
): string {
  const timestamp = Math.floor(now.getTime() / 1000);
  return `t=${timestamp},s=${hmac(secret, timestamp, rawBody).toString("hex")}`;
}
