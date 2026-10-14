import { expect, test } from "@playwright/test";

// KRB-139: the uptime monitor's endpoint answers without a session, checks
// the database and is never cached.
test("GET /api/health answers 200 with the database check", async ({ request }) => {
  const response = await request.get("/api/health");

  expect(response.status()).toBe(200);
  expect(response.headers()["cache-control"]).toContain("no-store");
  const body = await response.json();
  expect(body).toMatchObject({ status: "ok", checks: { database: "ok" } });
  expect(body.release === null || /^[0-9a-f]{7}$/.test(body.release)).toBe(true);
  expect(Date.parse(body.time)).not.toBeNaN();
  expect(Object.keys(body).sort()).toEqual(["checks", "release", "status", "time"]);
});

test("/api/health only answers GET", async ({ request }) => {
  expect((await request.post("/api/health")).status()).toBe(405);
});
