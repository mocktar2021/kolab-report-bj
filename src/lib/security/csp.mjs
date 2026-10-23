// Content-Security-Policy of every response (next.config.mjs), the service
// worker's included. Plain JavaScript because next.config.mjs imports it.

/** Cloudflare Turnstile serves its script and its iframe from here (KRB-58). */
export const TURNSTILE_ORIGIN = "https://challenges.cloudflare.com";

/**
 * Content-Security-Policy for every page. Scripts stay limited to this origin
 * (plus inline ones: Next.js, the theme and sidebar scripts), data only goes
 * to this origin and Supabase, and no other site can frame the app.
 *
 * Turnstile, only in builds that have a site key (src/lib/auth/captcha.ts),
 * needs its script and its iframe from challenges.cloudflare.com. Every page
 * allows them: a client-side navigation from the landing page to the sign-in
 * page keeps the landing page's policy.
 *
 * @param {Record<string, string | undefined>} env
 */
export function contentSecurityPolicy(env) {
  const supabase = env.NEXT_PUBLIC_SUPABASE_URL ? new URL(env.NEXT_PUBLIC_SUPABASE_URL) : null;
  const supabaseOrigin = supabase ? supabase.origin : "";
  const supabaseSocket = supabase
    ? `${supabase.protocol === "https:" ? "wss:" : "ws:"}//${supabase.host}`
    : "";
  const isDev = env.NODE_ENV === "development";
  // Set by Vercel at build time: "preview" for PR and staging deployments.
  const isVercelPreview = env.VERCEL_ENV === "preview";
  // The Vercel toolbar on preview deployments (comments, feedback).
  const toolbar = isVercelPreview ? "https://vercel.live" : "";
  const turnstile = env.NEXT_PUBLIC_TURNSTILE_SITE_KEY?.trim() ? TURNSTILE_ORIGIN : "";

  const directives = {
    "default-src": ["'self'"],
    // Next.js inlines its bootstrap scripts. Nonces would need every page to
    // render per request, including the static landing and sign-in pages.
    "script-src": ["'self'", "'unsafe-inline'", isDev ? "'unsafe-eval'" : "", toolbar, turnstile],
    "style-src": ["'self'", "'unsafe-inline'", toolbar],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      supabaseOrigin,
      toolbar,
      isVercelPreview ? "https://vercel.com" : "",
    ],
    "font-src": ["'self'", toolbar, isVercelPreview ? "https://assets.vercel.com" : ""],
    "connect-src": [
      "'self'",
      supabaseOrigin,
      supabaseSocket,
      toolbar,
      isVercelPreview ? "wss://ws-us3.pusher.com" : "",
      // Once the service worker controls a page, it fetches the Turnstile
      // script for it, and a worker's fetch() follows connect-src of the
      // policy sent with /sw.js, which is this one. Without it the widget
      // fails on every visit after the first one (KRB-242).
      turnstile,
    ],
    "frame-src": toolbar || turnstile ? [toolbar, turnstile] : ["'none'"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives).map(
    ([name, sources]) => `${name} ${sources.filter(Boolean).join(" ")}`,
  );
  // Only over HTTPS: on http://localhost it would break every request.
  if (env.NEXT_PUBLIC_APP_URL?.startsWith("https://")) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}
