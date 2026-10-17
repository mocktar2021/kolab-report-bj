import { expect, test } from "@playwright/test";

// KRB-138: every page, redirect and logged API call answers with the request
// id its log lines carry, so a user can quote it.
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
const VERCEL_ID = "cdg1::iad1::e2e-1760450000000-0123456789ab";

test("pages and redirects send a new request id each time", async ({ request }) => {
  const page = await request.get("/fr");
  const pageId = page.headers()["x-request-id"];
  expect(pageId).toMatch(UUID);

  const redirect = await request.get("/fr/tableau-de-bord", { maxRedirects: 0 });
  expect(redirect.status()).toBe(307);
  expect(redirect.headers()["location"]).toContain("/fr/connexion?next=");
  expect(redirect.headers()["x-request-id"]).toMatch(UUID);
  expect(redirect.headers()["x-request-id"]).not.toBe(pageId);
});

test("Vercel's id is reused, and an id sent by the client is not", async ({ request }) => {
  const fromVercel = await request.get("/fr/connexion", { headers: { "x-vercel-id": VERCEL_ID } });
  expect(fromVercel.headers()["x-request-id"]).toBe(VERCEL_ID);

  const forged = await request.get("/fr/connexion", { headers: { "x-request-id": "forged" } });
  expect(forged.headers()["x-request-id"]).toMatch(UUID);

  const api = await request.get("/api/health", { headers: { "x-vercel-id": VERCEL_ID } });
  expect(api.headers()["x-request-id"]).toBe(VERCEL_ID);
});

test("the Sentry tunnel route skips the proxy", async ({ request }) => {
  const response = await request.get("/monitoring", { maxRedirects: 0 });
  expect(response.headers()["x-request-id"]).toBeUndefined();
});
