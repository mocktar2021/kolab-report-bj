// @vitest-environment node
import { AuthApiError } from "@supabase/supabase-js";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { signIn } from "./actions";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/invitations/accept", () => ({ acceptPendingInvitations: vi.fn() }));
vi.mock("next-intl/server", () => ({ getLocale: vi.fn(async () => "fr") }));
vi.mock("@/i18n/navigation", () => ({ redirect: vi.fn() }));

const signInWithPassword = vi.fn();

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

const credentials = { email: "aicha@kolab.test", password: "Kolab-test-2026" };

beforeEach(() => {
  signInWithPassword.mockResolvedValue({ data: {}, error: null });
  vi.mocked(createClient).mockResolvedValue({ auth: { signInWithPassword } } as never);
});

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("signIn", () => {
  it("sends no captcha token without a site key", async () => {
    vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "");
    await signIn({}, form(credentials));
    expect(signInWithPassword.mock.calls[0]![0].options.captchaToken).toBeUndefined();
  });

  describe("with a site key", () => {
    beforeEach(() => {
      vi.stubEnv("NEXT_PUBLIC_TURNSTILE_SITE_KEY", "site-key");
    });

    it("refuses a form without a token before calling Supabase", async () => {
      expect(await signIn({}, form(credentials))).toEqual({
        error: "captchaRequired",
        email: "aicha@kolab.test",
      });
      expect(signInWithPassword).not.toHaveBeenCalled();
    });

    it("passes the token to Supabase and keeps a refused one apart from wrong credentials", async () => {
      signInWithPassword.mockResolvedValue({
        data: {},
        error: new AuthApiError("captcha protection: request disallowed", 400, "captcha_failed"),
      });
      const state = await signIn({}, form({ ...credentials, captchaToken: "token-1" }));
      expect(signInWithPassword.mock.calls[0]![0].options.captchaToken).toBe("token-1");
      expect(state).toEqual({ error: "captchaRequired", email: "aicha@kolab.test" });
    });
  });
});
