import { AuthApiError, AuthSessionMissingError } from "@supabase/supabase-js";
import { describe, expect, it } from "vitest";
import { authErrorKey } from "./errors";

const apiError = (status: number, code: string) => new AuthApiError("message", status, code);

describe("authErrorKey", () => {
  it.each([
    ["weak_password", 422, "weakPassword"],
    ["same_password", 422, "samePassword"],
    ["email_not_confirmed", 400, "emailNotConfirmed"],
    ["over_email_send_rate_limit", 429, "rateLimited"],
    ["over_request_rate_limit", 429, "rateLimited"],
    ["otp_expired", 403, "sessionExpired"],
  ] as const)("maps %s to %s", (code, status, key) => {
    expect(authErrorKey(apiError(status, code))).toBe(key);
  });

  it("treats a missing session as an expired link", () => {
    expect(authErrorKey(new AuthSessionMissingError())).toBe("sessionExpired");
  });

  it("falls back on the HTTP status for unknown codes", () => {
    expect(authErrorKey(apiError(429, "something_new"))).toBe("rateLimited");
    expect(authErrorKey(apiError(500, "unexpected_failure"))).toBe("unknown");
  });
});
