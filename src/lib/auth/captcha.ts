// Cloudflare Turnstile on the sign-up, sign-in and reset request forms
// (KRB-58). Supabase Auth checks the token itself once captcha is on for the
// project, on /signup, /recover and the password grant of /token: the forms
// only pass it along. Setup and order: docs/deployment.md, "Auth settings".
//
// No zod here: the client forms import this file.

/** Name of the form field that carries the Turnstile token. */
export const CAPTCHA_FIELD = "captchaToken";

// Turnstile tokens are at most 2048 characters.
const MAX_TOKEN_LENGTH = 2048;

/**
 * The Turnstile site key, or undefined when captcha is off (local, CI). Next.js
 * inlines it at build time, in the browser and the server bundles alike, so
 * the forms and their actions always agree.
 */
export function turnstileSiteKey(): string | undefined {
  return process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() || undefined;
}

/**
 * The token to send to Supabase. `{ ok: false }` when captcha is on and the
 * form has no usable token: the action answers without calling Supabase.
 */
export function readCaptchaToken(
  formData: FormData,
  siteKey = turnstileSiteKey(),
): { ok: true; token: string | undefined } | { ok: false } {
  if (!siteKey) return { ok: true, token: undefined };
  const token = String(formData.get(CAPTCHA_FIELD) ?? "").trim();
  if (!token || token.length > MAX_TOKEN_LENGTH) return { ok: false };
  return { ok: true, token };
}
