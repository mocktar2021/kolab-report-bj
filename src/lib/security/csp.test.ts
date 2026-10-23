import { describe, expect, it } from "vitest";
import { contentSecurityPolicy, TURNSTILE_ORIGIN } from "./csp.mjs";

const SUPABASE = "https://abcdefghijklmnop.supabase.co";
const SITE_KEY = "0x4AAAAAAAexample";

/** The policy as a map: directive name to its sources. */
function directives(env: Record<string, string | undefined>) {
  return new Map(
    contentSecurityPolicy(env)
      .split("; ")
      .map((entry) => {
        const [name, ...sources] = entry.split(" ");
        return [name, sources] as const;
      }),
  );
}

describe("contentSecurityPolicy", () => {
  it("keeps scripts, data and frames to this origin and Supabase without a captcha", () => {
    const policy = directives({ NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NODE_ENV: "production" });
    expect(policy.get("script-src")).toEqual(["'self'", "'unsafe-inline'"]);
    expect(policy.get("connect-src")).toEqual(["'self'", SUPABASE, "wss://abcdefghijklmnop.supabase.co"]);
    expect(policy.get("frame-src")).toEqual(["'none'"]);
    expect(policy.get("frame-ancestors")).toEqual(["'none'"]);
    expect(contentSecurityPolicy({})).not.toContain(TURNSTILE_ORIGIN);
  });

  it("allows the Turnstile script, its iframe and the service worker's fetch of the script", () => {
    // KRB-242: the service worker's fetch() follows connect-src. Without
    // Cloudflare there, the widget failed on every visit after the first one.
    const policy = directives({ NEXT_PUBLIC_SUPABASE_URL: SUPABASE, NEXT_PUBLIC_TURNSTILE_SITE_KEY: SITE_KEY });
    expect(policy.get("script-src")).toContain(TURNSTILE_ORIGIN);
    expect(policy.get("frame-src")).toEqual([TURNSTILE_ORIGIN]);
    expect(policy.get("connect-src")).toContain(TURNSTILE_ORIGIN);
  });

  it("treats a blank site key as no captcha", () => {
    expect(contentSecurityPolicy({ NEXT_PUBLIC_TURNSTILE_SITE_KEY: "  " })).not.toContain(TURNSTILE_ORIGIN);
  });

  it("allows the Vercel toolbar on preview deployments only", () => {
    expect(directives({ VERCEL_ENV: "preview" }).get("frame-src")).toEqual(["https://vercel.live"]);
    expect(contentSecurityPolicy({ VERCEL_ENV: "production" })).not.toContain("vercel");
  });

  it("allows eval in development only", () => {
    expect(directives({ NODE_ENV: "development" }).get("script-src")).toContain("'unsafe-eval'");
    expect(contentSecurityPolicy({ NODE_ENV: "production" })).not.toContain("'unsafe-eval'");
  });

  it("upgrades insecure requests only when the app is served over HTTPS", () => {
    expect(contentSecurityPolicy({ NEXT_PUBLIC_APP_URL: "https://kolabreport.com" })).toMatch(
      /; upgrade-insecure-requests$/,
    );
    expect(contentSecurityPolicy({ NEXT_PUBLIC_APP_URL: "http://localhost:3000" })).not.toContain(
      "upgrade-insecure-requests",
    );
  });
});
