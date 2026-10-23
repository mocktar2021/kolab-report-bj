// @vitest-environment node
import { AuthApiError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { signUp } from "./actions";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_APP_URL: "https://kolab.test" } }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "fr") }));
vi.mock("@/i18n/navigation", () => ({ redirect: vi.fn() }));

const authSignUp = vi.fn();

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const valid = { fullName: "Aïcha Kossou", email: "aicha@kolab.test", password: "chaufferie2026" };

beforeEach(() => {
  authSignUp.mockResolvedValue({ data: { session: null }, error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { signUp: authSignUp } } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signUp", () => {
  it("refuses before the launch in production, without calling Supabase", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-10-27T07:59:59.000Z"));
    vi.stubEnv("APP_ENV", "production");
    try {
      const state = await signUp({ status: "idle" }, form(valid));
      expect(state).toEqual({
        status: "error",
        formError: "signUpClosed",
        values: { fullName: valid.fullName, email: valid.email },
      });
      expect(authSignUp).not.toHaveBeenCalled();
    } finally {
      vi.useRealTimers();
    }
  });

  it("applies the password policy before calling Supabase", async () => {
    const state = await signUp({ status: "idle" }, form({ ...valid, password: "chaufferie" }));
    expect(state).toMatchObject({
      status: "error",
      fieldErrors: { password: "passwordNeedsLetterAndDigit" },
    });
    expect(authSignUp).not.toHaveBeenCalled();
  });

  it("sends no captcha token without a site key", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const state = await signUp({ status: "idle" }, form(valid));
    expect(state).toEqual({ status: "checkEmail", email: "aicha@kolab.test" });
    expect(authSignUp.mock.calls[0]![0].options.captchaToken).toBeUndefined();
  });

  describe("with a site key", () => {
    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    });

    it("refuses a form without a token, with the field errors, before calling Supabase", async () => {
      const state = await signUp({ status: "idle" }, form({ ...valid, fullName: "" }));
      expect(state).toMatchObject({
        status: "error",
        fieldErrors: { fullName: "nameRequired", captcha: "captchaRequired" },
      });
      expect(authSignUp).not.toHaveBeenCalled();
    });

    it("passes the token to Supabase", async () => {
      await signUp({ status: "idle" }, form({ ...valid, captchaToken: "token-1" }));
      expect(authSignUp.mock.calls[0]![0].options.captchaToken).toBe("token-1");
    });

    it("shows a token Supabase refused next to the widget", async () => {
      authSignUp.mockResolvedValue({
        data: { session: null },
        error: new AuthApiError("captcha protection: request disallowed", 400, "captcha_failed"),
      });
      const state = await signUp({ status: "idle" }, form({ ...valid, captchaToken: "used" }));
      expect(state).toEqual({
        status: "error",
        fieldErrors: { captcha: "captchaRequired" },
        values: { fullName: valid.fullName, email: valid.email },
      });
    });
  });
});
