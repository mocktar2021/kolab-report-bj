import { WEB_ANALYTICS_SCRIPT_ORIGIN } from "@/lib/security/csp.mjs";

/**
 * Cloudflare Web Analytics beacon (KRB-255): page views of the public pages,
 * without cookies. Only the public pages render it, never the app pages, so
 * no report content sits next to a third-party script.
 *
 * `spa: false` counts full page loads only, which is how visitors arrive
 * from a link. A visitor who moves into the app without reloading keeps the
 * script, but it sends no new page view.
 *
 * A plain script tag, not next/script: the browser runs it only when it loads
 * a public page itself. next/script would also load it on a client-side
 * navigation from an app page, and the beacon would then report the address
 * the browser first loaded, an app page.
 *
 * Nothing without NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN: local, CI, previews
 * and staging load no beacon. The CSP allows Cloudflare only in that case
 * (src/lib/security/csp.mjs).
 */
export function WebAnalytics() {
  const token = process.env.NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN?.trim();
  if (!token) return null;
  return (
    <script
      defer
      src={`${WEB_ANALYTICS_SCRIPT_ORIGIN}/beacon.min.js`}
      data-cf-beacon={JSON.stringify({ token, spa: false })}
    />
  );
}
