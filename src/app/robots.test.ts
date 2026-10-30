// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import robots from "./robots";
import sitemap from "./sitemap";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("robots.txt", () => {
  it("shuts every crawler out of staging", () => {
    vi.stubEnv("APP_ENV", "staging");
    expect(robots()).toEqual({ rules: { userAgent: "*", disallow: "/" } });
  });

  it("opens production but the app, and points to the sitemap", () => {
    vi.stubEnv("APP_ENV", "production");
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://kolabreport.com");
    const file = robots();
    const [rules] = [file.rules].flat();
    if (!rules) throw new Error("robots.txt has no rules");

    expect(rules.allow).toBe("/");
    expect(rules.disallow).toEqual(
      expect.arrayContaining([
        "/api/",
        "/fr/tableau-de-bord",
        "/fr/espaces",
        "/fr/compte",
        "/fr/invitations",
      ]),
    );
    expect(rules.disallow).not.toContain("/fr/tarifs");
    expect(file.sitemap).toBe("https://kolabreport.com/sitemap.xml");
  });
});

describe("sitemap.xml", () => {
  it("lists the public pages with full addresses", () => {
    vi.stubEnv("NEXT_PUBLIC_APP_URL", "https://kolabreport.com");
    const urls = sitemap().map((entry) => entry.url);

    expect(urls).toEqual(
      expect.arrayContaining([
        "https://kolabreport.com/fr",
        "https://kolabreport.com/fr/tarifs",
        "https://kolabreport.com/fr/guide",
        "https://kolabreport.com/fr/inscription",
        "https://kolabreport.com/fr/mentions-legales",
        "https://kolabreport.com/fr/confidentialite",
        "https://kolabreport.com/fr/cgu",
        "https://kolabreport.com/fr/cgv",
        "https://kolabreport.com/fr/accord-traitement-donnees",
      ]),
    );
    expect(urls).toHaveLength(9);
  });
});
