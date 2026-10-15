// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { sendBillingNotices } from "@/lib/billing/notices";
import { reconcilePendingPurchases } from "@/lib/billing/reconcile";
import { getBillingSettings } from "@/lib/billing/settings";
import { createAdminClient } from "@/lib/supabase/admin";
import { GET } from "./route";

vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/billing/notices", () => ({ sendBillingNotices: vi.fn() }));
vi.mock("@/lib/billing/reconcile", () => ({ reconcilePendingPurchases: vi.fn() }));
vi.mock("@/lib/billing/server", () => ({ applyDeps: vi.fn(() => ({})), stuckAlert: vi.fn() }));
vi.mock("@/lib/billing/settings", () => ({ getBillingSettings: vi.fn() }));

const SECRET = "un-secret-de-test-assez-long-pour-vercel";
const PATH = "http://localhost/api/cron/billing";

function call(authorization?: string) {
  return GET(new Request(PATH, { headers: authorization ? { authorization } : {} }));
}

beforeEach(() => {
  vi.unstubAllEnvs();
  vi.stubEnv("CRON_SECRET", SECRET);
  vi.mocked(createAdminClient).mockReturnValue({} as ReturnType<typeof createAdminClient>);
  vi.mocked(getBillingSettings).mockReturnValue({
    production: false,
    environment: "mock",
    api: { environment: "mock", apiBaseUrl: "http://127.0.0.1:4010", secretKey: "sk_mock_x" },
    webhook: null,
    alertEmail: null,
    problems: [],
  });
  vi.mocked(reconcilePendingPurchases).mockResolvedValue({ checked: 2, granted: 1, expired: 0, failed: 0 });
  vi.spyOn(console, "error").mockImplementation(() => undefined);
  vi.spyOn(console, "info").mockImplementation(() => undefined);
  vi.spyOn(console, "log").mockImplementation(() => undefined);
});

describe("GET /api/cron/billing", () => {
  it("refuses calls without the secret, or with another one", async () => {
    for (const authorization of [undefined, "Bearer ce-nest-pas-le-bon-secret-du-tout", SECRET]) {
      const response = await call(authorization);
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "unauthorized" });
    }
    expect(sendBillingNotices).not.toHaveBeenCalled();
    expect(reconcilePendingPurchases).not.toHaveBeenCalled();
  });

  it("refuses everything while CRON_SECRET is missing or short", async () => {
    vi.stubEnv("CRON_SECRET", "court");
    const response = await call("Bearer court");

    expect(response.status).toBe(401);
    expect(sendBillingNotices).not.toHaveBeenCalled();
  });

  it("answers the counts of each step, nothing else", async () => {
    vi.mocked(sendBillingNotices).mockResolvedValue({ notices: 3, emailsSent: 5, emailsFailed: 0, ok: true });

    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(200);
    expect(response.headers.get("cache-control")).toBe("private, no-store");
    expect(response.headers.get("x-request-id")).toBeTruthy();
    expect(await response.json()).toEqual({
      ok: true,
      steps: {
        notices: { ok: true, notices: 3, emailsSent: 5, emailsFailed: 0 },
        reconcile: { ok: true, checked: 2, granted: 1, expired: 0, failed: 0 },
      },
    });
  });

  it("answers 500 when a step failed, after running the others", async () => {
    vi.mocked(sendBillingNotices).mockResolvedValue({
      notices: 1,
      emailsSent: 1,
      emailsFailed: 1,
      ok: false,
    });

    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({
      ok: false,
      steps: {
        notices: { ok: false, notices: 1, emailsSent: 1, emailsFailed: 1 },
        reconcile: { ok: true, checked: 2, granted: 1, expired: 0, failed: 0 },
      },
    });
  });

  it("answers 500 when a pending payment could not be checked", async () => {
    vi.mocked(sendBillingNotices).mockResolvedValue({ notices: 0, emailsSent: 0, emailsFailed: 0, ok: true });
    vi.mocked(reconcilePendingPurchases).mockResolvedValue({ checked: 1, granted: 0, expired: 0, failed: 1 });

    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(500);
    expect((await response.json()).steps.reconcile).toEqual({
      ok: false,
      checked: 1,
      granted: 0,
      expired: 0,
      failed: 1,
    });
  });

  it("answers 500 when a step throws", async () => {
    vi.mocked(sendBillingNotices).mockRejectedValue(new Error("database down"));

    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(500);
    expect((await response.json()).steps.notices).toEqual({ ok: false });
    expect(reconcilePendingPurchases).toHaveBeenCalled();
  });

  it("answers 500 without details when the service role is not set", async () => {
    vi.mocked(createAdminClient).mockImplementation(() => {
      throw new Error("SUPABASE_SERVICE_ROLE_KEY is not set");
    });

    const response = await call(`Bearer ${SECRET}`);

    expect(response.status).toBe(500);
    expect(await response.json()).toEqual({ ok: false });
  });
});
