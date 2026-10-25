import { randomBytes } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { CAPTCHA_FIELD } from "../../src/lib/auth/captcha";

// Settings of a smoke run, read from the environment. The suite only uses
// what a real user has: the site's URL, an account and its password. It never
// reads .env.local and never needs the service-role key.
// Runbook: docs/operations/smoke-tests.md.

function setting(name: string): string | undefined {
  const value = process.env[name]?.trim();
  return value ? value : undefined;
}

export const smoke = {
  /** Dedicated smoke account, owner of the smoke workspace. */
  email: setting("SMOKE_EMAIL"),
  password: setting("SMOKE_PASSWORD"),
  /** The smoke workspace, by id, or else by name. */
  workspaceId: setting("SMOKE_WORKSPACE_ID"),
  workspaceName: setting("SMOKE_WORKSPACE_NAME") ?? "Smoke tests",
  /** "true" runs the AI draft check, which calls the real model. */
  ai: setting("SMOKE_AI")?.toLowerCase() === "true",
  /** Mailbox with plus-addressing: each run signs up a new address on it. */
  signupEmail: setting("SMOKE_SIGNUP_EMAIL"),
  /** Commit the deploy shipped. /api/health must report it. */
  expectedRelease: setting("SMOKE_EXPECTED_RELEASE"),
  /** Lets the run through Vercel Deployment Protection. */
  vercelBypassSecret: setting("VERCEL_AUTOMATION_BYPASS_SECRET"),
};

export const hasAccount = Boolean(smoke.email && smoke.password);

// Both files hold cookies (the session, the Vercel bypass), so they live in
// the temp folder, never in the report or test-results folders that CI keeps.

/** Session of the smoke account, written by sign-in.setup.ts. */
export const SESSION_FILE = join(tmpdir(), "kolabreport-smoke-session.json");

/** Vercel bypass cookie, written by global-setup.ts. */
export const BYPASS_FILE = join(tmpdir(), "kolabreport-smoke-vercel-bypass.json");

/** Section the signed-in checks add to the smoke report when it has none yet. */
export const SMOKE_SECTION_TITLE = "Section smoke";

/** Prefix of every file the suite uploads. The cleanup deletes files with this prefix only. */
export const FILE_PREFIX = "smoke-";

/** Prefix of the report each run creates and deletes. The cleanup deletes reports with this prefix only. */
export const REPORT_PREFIX = "smoke-rapport-";

/**
 * True when the page's form has the Turnstile captcha, as on production
 * (KRB-58). A headless browser may never get a token, and the action then
 * answers "Confirmez que vous n'êtes pas un robot." without calling Supabase.
 */
export async function captchaOn(page: Page): Promise<boolean> {
  return (await page.locator(`input[name="${CAPTCHA_FIELD}"]`).count()) > 0;
}

/**
 * True on /fr/inscription before the launch: production shows the countdown
 * and the reminder form in place of the sign-up form (KRB-239).
 */
export async function signUpClosed(page: Page): Promise<boolean> {
  return (await page.getByText("Les inscriptions ne sont pas encore ouvertes.").count()) > 0;
}

/** Why the sign-up checks are skipped while signUpClosed() is true. */
export const SIGN_UP_CLOSED_REASON =
  "Sign-up opens at the launch (src/lib/launch.ts). Until then the page shows the reminder form (KRB-239)";

/** Short tag that makes a run's names unique, for example 20261014-210133-k3f9. */
export function runTag(): string {
  const stamp = new Date().toISOString().replace(/[-:]/g, "").replace("T", "-").slice(0, 15);
  return `${stamp}-${randomBytes(2).toString("hex")}`;
}

/**
 * Types a secret into a field without leaving it in the report: fill() puts
 * the value in the step title ("Fill "…"") that the HTML report shows, and
 * evaluate() does not. Works for controlled and plain inputs alike.
 */
export async function fillSecret(field: Locator, value: string) {
  await field.evaluate((input, text) => {
    const element = input as HTMLInputElement;
    const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
    setValue?.call(element, text);
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
  }, value);
}

/**
 * A new address on the sign-up mailbox: "me@example.com" gives
 * "me+kolabreport-smoke-<tag>@example.com", and "me+smoke@example.com" gives
 * "me+smoke-<tag>@example.com".
 */
export function signupAddress(mailbox: string, tag: string): string {
  const at = mailbox.lastIndexOf("@");
  if (at <= 0) throw new Error("SMOKE_SIGNUP_EMAIL is not an e-mail address");
  const local = mailbox.slice(0, at);
  const domain = mailbox.slice(at + 1);
  return local.includes("+") ? `${local}-${tag}@${domain}` : `${local}+kolabreport-smoke-${tag}@${domain}`;
}

/** Escapes a text for use inside a regular expression. */
export function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
