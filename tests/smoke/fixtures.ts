import { test as base } from "@playwright/test";

/**
 * The beacon of Cloudflare Web Analytics on the public pages (KRB-255). The
 * smoke tests block it so a deploy adds no visit to the count (KRB-256). The
 * browser checks the CSP before it sends the request, so a CSP problem with
 * the beacon still shows in the public pages test.
 */
export const WEB_ANALYTICS_ORIGINS = [
  "https://static.cloudflareinsights.com/",
  "https://cloudflareinsights.com/",
];

/** Playwright's test, with the analytics beacon blocked in every browser context. */
export const test = base.extend({
  context: async ({ context }, provide) => {
    await context.route(
      (url) => WEB_ANALYTICS_ORIGINS.some((origin) => url.href.startsWith(origin)),
      (route) => route.abort("blockedbyclient"),
    );
    await provide(context);
  },
});

export { expect } from "@playwright/test";
