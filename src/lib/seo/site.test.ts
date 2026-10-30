// @vitest-environment node
import { describe, expect, it } from "vitest";
import { INDEXED_PATHS, isIndexable, localizedPath, PRIVATE_PATHS, siteUrl } from "./site";

describe("isIndexable", () => {
  it("lets search engines in on production only", () => {
    expect(isIndexable({ APP_ENV: "production" })).toBe(true);
    expect(isIndexable({ VERCEL_ENV: "production" })).toBe(true);
    expect(isIndexable({ APP_ENV: "staging" })).toBe(false);
    expect(isIndexable({ VERCEL_ENV: "preview" })).toBe(false);
    expect(isIndexable({})).toBe(false);
  });

  it("trusts APP_ENV over VERCEL_ENV, for a staging project built with --prod", () => {
    expect(isIndexable({ APP_ENV: "staging", VERCEL_ENV: "production" })).toBe(false);
  });
});

describe("siteUrl", () => {
  it("drops the trailing slash", () => {
    expect(siteUrl({ NEXT_PUBLIC_APP_URL: "https://kolabreport.com/" })).toBe("https://kolabreport.com");
  });

  it("falls back to the local server", () => {
    expect(siteUrl({})).toBe("http://localhost:3000");
  });
});

describe("paths", () => {
  it("prefixes the locale", () => {
    expect(localizedPath("/")).toBe("/fr");
    expect(localizedPath("/tarifs")).toBe("/fr/tarifs");
  });

  it("never lists a private page in the sitemap", () => {
    for (const path of INDEXED_PATHS) {
      expect(PRIVATE_PATHS.some((p) => path === p || path.startsWith(`${p}/`))).toBe(false);
    }
  });
});
