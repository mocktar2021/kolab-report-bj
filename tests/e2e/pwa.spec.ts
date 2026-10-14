import http from "node:http";
import https from "node:https";
import type { AddressInfo } from "node:net";
import { expect, test, type APIRequestContext, type Page } from "@playwright/test";

// KRB-25: the installability checks Lighthouse ran before version 12, done
// with Chrome itself. KRB-156: a new version waits until the user updates.
// Both need the service worker, so they run on a production build.

const BANNER_TITLE = "Nouvelle version disponible";

type ManifestIcon = { src: string; sizes?: string; type?: string; purpose?: string };

async function serviceWorkerReady(page: Page) {
  return page.evaluate(async () => (await navigator.serviceWorker.ready).scope);
}

/** Width and height from a PNG header. */
function pngSize(png: Buffer) {
  expect(png.subarray(1, 4).toString("latin1")).toBe("PNG");
  return `${png.readUInt32BE(16)}x${png.readUInt32BE(20)}`;
}

async function checkIcon(request: APIRequestContext, manifestUrl: string, icon: ManifestIcon) {
  const url = new URL(icon.src, manifestUrl).href;
  const response = await request.get(url);
  expect(response.ok(), url).toBe(true);
  expect(response.headers()["content-type"], url).toBe("image/png");
  expect(pngSize(await response.body()), url).toBe(icon.sizes);
}

test("Chrome finds no installability error on /fr", async ({ page, context }) => {
  await page.goto("/fr");
  await serviceWorkerReady(page);

  const cdp = await context.newCDPSession(page);
  const { installabilityErrors } = await cdp.send("Page.getInstallabilityErrors");
  expect(installabilityErrors).toEqual([]);
  const manifest = await cdp.send("Page.getAppManifest");
  expect(manifest.errors).toEqual([]);
});

test("the manifest has what an install needs", async ({ page, request }) => {
  await page.goto("/fr");
  const href = await page.locator('link[rel="manifest"]').getAttribute("href");
  const manifestUrl = new URL(href ?? "", page.url()).href;
  const response = await request.get(manifestUrl);
  expect(response.ok()).toBe(true);
  expect(response.headers()["content-type"]).toContain("application/manifest+json");
  const manifest = await response.json();

  expect(manifest.name).toBeTruthy();
  expect(manifest.short_name).toBeTruthy();
  expect(manifest.display).toBe("standalone");
  expect(manifest.theme_color).toMatch(/^#[0-9a-f]{6}$/i);
  expect(manifest.background_color).toMatch(/^#[0-9a-f]{6}$/i);
  const scope = new URL(manifest.scope ?? ".", manifestUrl).href;
  expect(new URL(manifest.start_url, manifestUrl).href.startsWith(scope)).toBe(true);

  const icons: ManifestIcon[] = manifest.icons;
  const purposes = (icon: ManifestIcon) => (icon.purpose ?? "any").split(" ");
  const find = (sizes: string, purpose: string) =>
    icons.find((icon) => icon.sizes === sizes && purposes(icon).includes(purpose));
  for (const [sizes, purpose] of [
    ["192x192", "any"],
    ["512x512", "any"],
    ["512x512", "maskable"],
  ] as const) {
    const icon = find(sizes, purpose);
    expect(icon, `${sizes} ${purpose}`).toBeDefined();
    if (icon) await checkIcon(request, manifestUrl, icon);
  }
});

test("a service worker registers and controls the page after a reload", async ({ page }) => {
  await page.goto("/fr");
  expect(await serviceWorkerReady(page)).toBe(new URL("/", page.url()).href);

  await page.reload();
  const controller = await page.evaluate(() => navigator.serviceWorker.controller?.scriptURL ?? null);
  expect(controller).toBe(new URL("/sw.js", page.url()).href);
});

test("the network coming back reloads the offline page, and no other page", async ({ page, context }) => {
  const navigations: string[] = [];
  page.on("request", (request) => {
    if (request.isNavigationRequest()) navigations.push(request.url());
  });
  const toggleNetwork = async () => {
    await context.setOffline(true);
    await context.setOffline(false);
  };

  await page.goto("/fr");
  navigations.length = 0;
  await page.evaluate(() => {
    window.addEventListener("online", () => document.body.setAttribute("data-e2e-online", ""), {
      once: true,
    });
  });
  await toggleNetwork();
  await expect(page.locator("body[data-e2e-online]")).toHaveCount(1);
  // A reload would have asked for the page before this request.
  expect(
    await page.evaluate(async () => (await fetch("/manifest.webmanifest", { cache: "no-store" })).ok),
  ).toBe(true);
  expect(navigations).toEqual([]);

  await page.goto("/fr/hors-ligne");
  const reloaded = page.waitForEvent("load");
  await toggleNetwork();
  await reloaded;
  expect(page.url()).toMatch(/\/fr\/hors-ligne$/);
});

// Playwright cannot route the browser's own fetch of /sw.js, so the next
// deploy is simulated by a proxy in front of the app. Once nextDeploy() is
// called, /sw.js gets this extra code, which also tells the versions apart.
const NEXT_VERSION = `
// e2e: next deploy
self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "E2E_VERSION") event.ports[0].postMessage("next");
});
`;

async function startAppProxy(target: string) {
  const upstream = new URL(target);
  const client = upstream.protocol === "https:" ? https : http;
  let deployed = false;

  const server = http.createServer((req, res) => {
    const url = new URL(req.url ?? "/", upstream);
    const isWorker = deployed && url.pathname === "/sw.js";
    const headers = { ...req.headers, host: upstream.host };
    if (isWorker) headers["accept-encoding"] = "identity";

    const forward = client.request(url, { method: req.method, headers }, (response) => {
      if (!isWorker) {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
        return;
      }
      const chunks: Buffer[] = [];
      response.on("data", (chunk: Buffer) => chunks.push(chunk));
      response.on("end", () => {
        const body = Buffer.concat([...chunks, Buffer.from(NEXT_VERSION)]);
        const rest = { ...response.headers };
        delete rest.etag;
        delete rest["last-modified"];
        delete rest["transfer-encoding"];
        res.writeHead(response.statusCode ?? 502, { ...rest, "content-length": body.length });
        res.end(body);
      });
    });
    forward.on("error", () => res.destroy());
    req.pipe(forward);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    // 127.0.0.1 is a secure context, like localhost: service workers run.
    url: `http://127.0.0.1:${port}`,
    nextDeploy() {
      deployed = true;
    },
    close() {
      server.closeAllConnections();
      return new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

/** "next" when the next deploy's worker controls the page. The current one does not answer. */
function controllingVersion(page: Page) {
  return page.evaluate(
    () =>
      new Promise<string>((resolve) => {
        const channel = new MessageChannel();
        channel.port1.onmessage = (event) => resolve(String(event.data));
        navigator.serviceWorker.controller?.postMessage({ type: "E2E_VERSION" }, [channel.port2]);
        setTimeout(() => resolve("no answer"), 5_000);
      }),
  );
}

function waitingWorker(page: Page) {
  return page.evaluate(async () => Boolean((await navigator.serviceWorker.getRegistration())?.waiting));
}

test("a new version waits for the user, then reloads the page once", async ({ context, baseURL }) => {
  // Each version precaches the app shell before it installs: about 20 s in all.
  test.setTimeout(90_000);
  const proxy = await startAppProxy(baseURL ?? "http://localhost:3000");
  try {
    // Two tabs on the current version. The first visit installs the worker.
    const page = await context.newPage();
    await page.goto(`${proxy.url}/fr`);
    await serviceWorkerReady(page);
    await page.reload();
    const otherTab = await context.newPage();
    await otherTab.goto(`${proxy.url}/fr`);
    const banner = page.getByRole("status").filter({ hasText: BANNER_TITLE });
    const otherBanner = otherTab.getByRole("status").filter({ hasText: BANNER_TITLE });
    await expect(banner).toHaveCount(0);

    // A deploy, then the tab checks for it as it does every hour.
    proxy.nextDeploy();
    await page.evaluate(async () => {
      await (await navigator.serviceWorker.getRegistration())?.update();
    });
    await expect(banner).toBeVisible();
    await expect(banner.getByRole("button", { name: "Mettre à jour" })).toBeVisible();
    await expect(banner.getByRole("button", { name: "Plus tard" })).toBeVisible();
    // The banner does not take the focus, and the new worker waits.
    expect(await banner.evaluate((node) => node.contains(document.activeElement))).toBe(false);
    expect(await waitingWorker(page)).toBe(true);
    await expect(otherBanner).toBeVisible();

    let loads = 0;
    let otherLoads = 0;
    page.on("load", () => loads++);
    otherTab.on("load", () => otherLoads++);

    const reloaded = page.waitForEvent("load");
    await banner.getByRole("button", { name: "Mettre à jour" }).click();
    await reloaded;

    // The page came back under the new worker, with nothing left to update.
    expect(await controllingVersion(page)).toBe("next");
    expect(await waitingWorker(page)).toBe(false);
    await expect(banner).toHaveCount(0);
    expect(loads).toBe(1);

    // The other tab now runs under the new worker too, but keeps its page
    // (and any text in it) until its user reloads.
    expect(await controllingVersion(otherTab)).toBe("next");
    expect(otherLoads).toBe(0);
    await expect(otherBanner).toBeVisible();
    const otherReloaded = otherTab.waitForEvent("load");
    await otherBanner.getByRole("button", { name: "Mettre à jour" }).click();
    await otherReloaded;
    await expect(otherBanner).toHaveCount(0);
    expect(otherLoads).toBe(1);
  } finally {
    await proxy.close();
  }
});
