// @vitest-environment node
import { AuthApiError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { requestPasswordReset } from "./actions";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/env", () => ({ publicEnv: { NEXT_PUBLIC_APP_URL: "https://kolab.test" } }));

const resetPasswordForEmail = vi.fn();

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  resetPasswordForEmail.mockResolvedValue({ data: {}, error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { resetPasswordForEmail } } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("requestPasswordReset", () => {
  it("sends no captcha token without a site key", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    const state = await requestPasswordReset({ status: "idle" }, form({ email: "aicha@kolab.test" }));
    expect(state).toEqual({ status: "sent", email: "aicha@kolab.test" });
    expect(resetPasswordForEmail.mock.calls[0]![1].captchaToken).toBeUndefined();
  });

  describe("with a site key", () => {
    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    });

    it("refuses a form without a token before calling Supabase", async () => {
      const state = await requestPasswordReset({ status: "idle" }, form({ email: "aicha@kolab.test" }));
      expect(state).toEqual({
        status: "error",
        fieldErrors: { captcha: "captchaRequired" },
        email: "aicha@kolab.test",
      });
      expect(resetPasswordForEmail).not.toHaveBeenCalled();
    });

    it("passes the token to Supabase and shows a refused one", async () => {
      resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: new AuthApiError("captcha protection: request disallowed", 400, "captcha_failed"),
      });
      const state = await requestPasswordReset(
        { status: "idle" },
        form({ email: "aicha@kolab.test", captchaToken: "token-1" }),
      );
      expect(resetPasswordForEmail.mock.calls[0]![1].captchaToken).toBe("token-1");
      expect(state).toMatchObject({ status: "error", fieldErrors: { captcha: "captchaRequired" } });
    });

    it("still says nothing about unknown addresses", async () => {
      resetPasswordForEmail.mockResolvedValue({
        data: {},
        error: new AuthApiError("User not found", 400, "user_not_found"),
      });
      const state = await requestPasswordReset(
        { status: "idle" },
        form({ email: "inconnu@kolab.test", captchaToken: "token-1" }),
      );
      expect(state).toEqual({ status: "sent", email: "inconnu@kolab.test" });
    });
  });
});
