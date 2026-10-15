// @vitest-environment node
import { createHmac } from "node:crypto";
import { describe, expect, it } from "vitest";
import {
  parseSignatureHeader,
  signatureHeader,
  verifyWebhookSignature,
  WEBHOOK_TOLERANCE_SECONDS,
} from "./webhook-signature";

const SECRET = "wh_sandbox_unit_test_secret";
const NOW = new Date("2026-10-15T09:00:00Z");
const T = Math.floor(NOW.getTime() / 1000);
// A raw body with spaces and a non-ASCII character: the HMAC covers the bytes as sent.
const BODY = '{"name": "transaction.approved", "entity": {"id": 104, "description": "Offre Indépendant"}}';

/** The SDK's algorithm, written out again here: HMAC-SHA256 of "<t>.<body>", in hex. */
function sdkSignature(timestamp: number, body: string, secret = SECRET) {
  return createHmac("sha256", secret).update(`${timestamp}.${body}`, "utf8").digest("hex");
}

function verify(header: string | null, rawBody: string | Uint8Array = BODY, now = NOW) {
  return verifyWebhookSignature({ header, rawBody, secret: SECRET, now });
}

describe("verifyWebhookSignature", () => {
  it("accepts a header signed with the endpoint secret", () => {
    expect(verify(`t=${T},s=${sdkSignature(T, BODY)}`)).toEqual({ ok: true, timestamp: T });
  });

  it("accepts the body as bytes, and upper-case hex", () => {
    const bytes = new TextEncoder().encode(BODY);
    expect(verify(`t=${T},s=${sdkSignature(T, BODY).toUpperCase()}`, bytes)).toEqual({
      ok: true,
      timestamp: T,
    });
  });

  it("accepts the header when any of several s= values matches, in any order", () => {
    const other = sdkSignature(T, BODY, "wh_sandbox_old_secret");
    expect(verify(`t=${T},s=${other},s=${sdkSignature(T, BODY)}`).ok).toBe(true);
    expect(verify(`s=${sdkSignature(T, BODY)}, t=${T}`).ok).toBe(true);
  });

  it("refuses a header signed with another secret", () => {
    const header = `t=${T},s=${sdkSignature(T, BODY, "wh_sandbox_someone_else")}`;
    expect(verify(header)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a body changed after signing, even by one space", () => {
    const header = `t=${T},s=${sdkSignature(T, BODY)}`;
    expect(verify(header, BODY.replace("104", "105"))).toEqual({ ok: false, reason: "signature" });
    expect(verify(header, BODY.replace(": ", ":"))).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a timestamp changed after signing", () => {
    expect(verify(`t=${T + 1},s=${sdkSignature(T, BODY)}`)).toEqual({ ok: false, reason: "signature" });
  });

  it("refuses a delivery older or further ahead than the tolerance", () => {
    expect(WEBHOOK_TOLERANCE_SECONDS).toBe(300);
    const old = T - 301;
    const ahead = T + 301;
    expect(verify(`t=${old},s=${sdkSignature(old, BODY)}`)).toEqual({ ok: false, reason: "stale" });
    expect(verify(`t=${ahead},s=${sdkSignature(ahead, BODY)}`)).toEqual({ ok: false, reason: "stale" });
    // The edges are inside.
    expect(verify(`t=${T - 300},s=${sdkSignature(T - 300, BODY)}`).ok).toBe(true);
    expect(verify(`t=${T + 300},s=${sdkSignature(T + 300, BODY)}`).ok).toBe(true);
  });

  it("refuses a missing or empty header", () => {
    expect(verify(null)).toEqual({ ok: false, reason: "missing" });
    expect(verifyWebhookSignature({ header: undefined, rawBody: BODY, secret: SECRET })).toEqual({
      ok: false,
      reason: "missing",
    });
    expect(verify("   ")).toEqual({ ok: false, reason: "missing" });
  });

  it("refuses a malformed header", () => {
    const s = sdkSignature(T, BODY);
    for (const header of [
      s,
      `s=${s}`,
      `t=${T}`,
      `t=${T},s=`,
      `t=abc,s=${s}`,
      `t=-${T},s=${s}`,
      `t=${T}.5,s=${s}`,
      `t=${T},v1=${s}`,
      `t=${T},s=${s},${"x".repeat(2000)}`,
    ]) {
      expect(verify(header), header.slice(0, 40)).toEqual({ ok: false, reason: "malformed" });
    }
  });

  it("refuses s= values that are not 64 hex characters", () => {
    const s = sdkSignature(T, BODY);
    expect(verify(`t=${T},s=${s.slice(0, 63)}`)).toEqual({ ok: false, reason: "signature" });
    expect(verify(`t=${T},s=${s}00`)).toEqual({ ok: false, reason: "signature" });
    expect(verify(`t=${T},s=${"z".repeat(64)}`)).toEqual({ ok: false, reason: "signature" });
  });

  it("trusts nothing with an empty secret", () => {
    const header = `t=${T},s=${createHmac("sha256", "").update(`${T}.${BODY}`).digest("hex")}`;
    expect(verifyWebhookSignature({ header, rawBody: BODY, secret: "", now: NOW })).toEqual({
      ok: false,
      reason: "no_secret",
    });
  });
});

describe("parseSignatureHeader", () => {
  it("reads the timestamp and every signature", () => {
    expect(parseSignatureHeader("t=1700000000,s=aa,s=bb")).toEqual({
      timestamp: 1700000000,
      signatures: ["aa", "bb"],
    });
  });
});

describe("signatureHeader", () => {
  it("signs like FedaPay, so verify accepts it", () => {
    const header = signatureHeader(BODY, SECRET, NOW);
    expect(header).toBe(`t=${T},s=${sdkSignature(T, BODY)}`);
    expect(verify(header).ok).toBe(true);
  });
});
