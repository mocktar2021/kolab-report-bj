import { expect, test } from "@playwright/test";
import { runTag, smoke } from "./support";

// Always on, no account needed, nothing written: public pages, the health
// endpoint, PWA files and headers. The one sign-in attempt uses an address
// that has no account.

const PUBLIC_PAGES = ["/fr", "/fr/connexion", "/fr/inscription", "/fr/mot-de-passe-oublie"];

test.describe("public pages", { tag: "@public" }, () => {
  test("GET /api/health answers 200 with the database check", async ({ request }) => {
    const response = await request.get("/api/health");
    expect(
      response.status(),
      "401 or 403 here usually means Vercel Deployment Protection: see docs/operations/smoke-tests.md",
    ).toBe(200);
    expect(response.headers()["cache-control"]).toContain("no-store");
    const body = await response.json();
    expect(body).toMatchObject({ status: "ok", checks: { database: "ok" } });
    expect(body.release === null || /^[0-9a-f]{7}$/.test(body.release)).toBe(true);

    // The site must serve the commit the deploy just shipped. Vercel only
    // reports it when the deployment carries its git metadata.
    if (smoke.expectedRelease) {
      if (body.release === null) {
        test.info().annotations.push({
          type: "warning",
          description: "/api/health reports no release, so the deployed commit could not be checked.",
        });
      } else {
        expect(body.release, "the site serves another commit than the one just deployed").toBe(
          smoke.expectedRelease.slice(0, 7).toLowerCase(),
        );
      }
    }
  });

  test("the landing page loads in French", async ({ page }) => {
    await page.goto("/fr");
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByRole("heading", { level: 1 })).toContainText("Une section par expert.");
    await expect(page.getByRole("link", { name: "Se connecter" }).first()).toBeVisible();
  });

  test("the root redirects to /fr", async ({ page }) => {
    await page.goto("/");
    await expect(page).toHaveURL(/\/fr$/);
  });

  test("the sign-in, sign-up and password reset pages load in French", async ({ page }) => {
    await page.goto("/fr/connexion");
    await expect(page).toHaveTitle(/Connexion/);
    await expect(page.locator("html")).toHaveAttribute("lang", "fr");
    await expect(page.getByLabel("Adresse e-mail")).toBeVisible();
    await expect(page.getByLabel("Mot de passe", { exact: true })).toBeVisible();

    await page.goto("/fr/inscription");
    await expect(page.getByRole("heading", { name: "Créer un compte" })).toBeVisible();
    await expect(page.getByLabel("Nom complet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Créer mon compte" })).toBeVisible();

    await page.goto("/fr/mot-de-passe-oublie");
    await expect(page.getByRole("heading", { name: "Mot de passe oublié" })).toBeVisible();
  });

  test("protected pages send visitors to sign-in", async ({ page }) => {
    await page.goto("/fr/tableau-de-bord");
    await expect(page).toHaveURL(/\/fr\/connexion\?next=%2Ffr%2Ftableau-de-bord$/);
  });

  test("wrong credentials get the generic French error", async ({ page }) => {
    // Goes through the server action to Supabase Auth, so Auth is reachable.
    await page.goto("/fr/connexion");
    await page.getByLabel("Adresse e-mail").fill(`personne-${runTag()}@example.com`);
    await page.getByLabel("Mot de passe", { exact: true }).fill("pas-le-bon-mot-de-passe");
    await page.getByRole("button", { name: "Se connecter" }).click();
    await expect(page.getByRole("main").getByRole("alert")).toHaveText(
      "Adresse e-mail ou mot de passe incorrect.",
    );
  });

  test("the PWA manifest, service worker and icons are served", async ({ request }) => {
    const manifest = await request.get("/manifest.webmanifest");
    expect(manifest.ok()).toBe(true);
    expect(manifest.headers()["content-type"]).toContain("application/manifest+json");
    expect((await manifest.json()).lang).toBe("fr");

    const worker = await request.get("/sw.js");
    expect(worker.ok()).toBe(true);
    expect(worker.headers()["cache-control"]).toContain("no-cache");

    for (const path of [
      "/favicon.ico",
      "/icons/icon.svg",
      "/icons/icon-192.png",
      "/icons/icon-maskable-512.png",
    ]) {
      expect((await request.get(path)).ok(), path).toBe(true);
    }
  });

  test("pages send the security headers", async ({ request, baseURL }) => {
    const response = await request.get("/fr");
    expect(response.ok()).toBe(true);
    const headers = response.headers();
    const csp = headers["content-security-policy"] ?? "";
    expect(csp).toContain("default-src 'self'");
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("object-src 'none'");
    if (baseURL?.startsWith("https://")) {
      // next.config.mjs adds it when NEXT_PUBLIC_APP_URL is an https URL.
      expect(csp, "NEXT_PUBLIC_APP_URL is not the https URL of this site").toContain(
        "upgrade-insecure-requests",
      );
    }
    expect(headers["strict-transport-security"]).toContain("max-age=");
    expect(headers["x-content-type-options"]).toBe("nosniff");
    expect(headers["x-frame-options"]).toBe("DENY");
    expect(headers["referrer-policy"]).toBe("strict-origin-when-cross-origin");
    expect(headers["permissions-policy"]).toContain("camera=()");
    expect(headers["x-powered-by"]).toBeUndefined();
  });

  test("public pages log no error, break no CSP rule and load every file", async ({ page, baseURL }) => {
    const origin = new URL(baseURL ?? "").origin;
    const errors: string[] = [];
    const failed: string[] = [];
    page.on("console", (message) => {
      // The Vercel toolbar on preview deployments is not part of the app.
      if (message.type() === "error" && !message.location().url.startsWith("https://vercel.live/")) {
        errors.push(message.text());
      }
    });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.url().startsWith(origin) && response.status() >= 400) {
        failed.push(`${response.status()} ${new URL(response.url()).pathname}`);
      }
    });

    for (const path of PUBLIC_PAGES) {
      await page.goto(path);
      // Lets lazy chunks, the service worker and prefetches load.
      await page.waitForLoadState("networkidle");
    }

    const csp = errors.filter((text) => text.includes("Content Security Policy"));
    expect(csp, "CSP violations").toEqual([]);
    expect(errors, "console errors").toEqual([]);
    expect(failed, "requests to the site that failed").toEqual([]);
  });
});
