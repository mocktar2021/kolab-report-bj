import { afterEach, describe, expect, it, vi } from "vitest";
import { CAPTCHA_FIELD, readCaptchaToken, turnstileSiteKey } from "./captcha";

function form(token?: string) {
  const data = new FormData();
  if (token !== undefined) data.set(CAPTCHA_FIELD, token);
  return data;
}

describe("turnstileSiteKey", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("is undefined when the variable is missing or blank", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    expect(turnstileSiteKey()).toBeUndefined();
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "  ");
    expect(turnstileSiteKey()).toBeUndefined();
  });

  it("returns the trimmed key", () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", " 1x00000000000000000000AA ");
    expect(turnstileSiteKey()).toBe("1x00000000000000000000AA");
  });
});

describe("readCaptchaToken", () => {
  it("lets every form through without a site key, and sends no token", () => {
    expect(readCaptchaToken(form(), undefined)).toEqual({ ok: true, token: undefined });
    expect(readCaptchaToken(form("abc"), undefined)).toEqual({ ok: true, token: undefined });
  });

  it("refuses a missing, blank or oversized token when captcha is on", () => {
    expect(readCaptchaToken(form(), "site-key")).toEqual({ ok: false });
    expect(readCaptchaToken(form("   "), "site-key")).toEqual({ ok: false });
    expect(readCaptchaToken(form("x".repeat(2049)), "site-key")).toEqual({ ok: false });
  });

  it("returns the token when captcha is on", () => {
    expect(readCaptchaToken(form(" token "), "site-key")).toEqual({ ok: true, token: "token" });
  });
});
