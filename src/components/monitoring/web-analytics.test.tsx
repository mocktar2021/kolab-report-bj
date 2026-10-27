import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { WebAnalytics } from "./web-analytics";

describe("WebAnalytics", () => {
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("renders nothing without a token", () => {
    vi.stubEnv("NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN", "");
    expect(renderToStaticMarkup(<WebAnalytics />)).toBe("");
    vi.stubEnv("NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN", "  ");
    expect(renderToStaticMarkup(<WebAnalytics />)).toBe("");
  });

  it("loads the beacon with the token and counts full page loads only", () => {
    vi.stubEnv("NEXT_PUBLIC_CF_WEB_ANALYTICS_TOKEN", "abc123");
    const html = renderToStaticMarkup(<WebAnalytics />);
    expect(html).toContain('src="https://static.cloudflareinsights.com/beacon.min.js"');
    expect(html).toContain("defer");
    const config = /data-cf-beacon="([^"]*)"/.exec(html)?.[1] ?? "";
    expect(JSON.parse(config.replaceAll("&quot;", '"'))).toEqual({ token: "abc123", spa: false });
  });
});
