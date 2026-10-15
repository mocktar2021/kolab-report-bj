// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { applyPurchase, loadPurchase } from "@/lib/billing/apply";
import { applyDeps } from "@/lib/billing/server";
import { getBillingSettings, type BillingSettings } from "@/lib/billing/settings";
import { signatureHeader } from "@/lib/billing/webhook-signature";
import { log } from "@/lib/log";
import { POST } from "./route";

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withRequestId: (handler: (request: Request) => Promise<Response>) => handler,
}));
vi.mock("@/lib/billing/settings", () => ({ getBillingSettings: vi.fn() }));
vi.mock("@/lib/billing/server", () => ({ applyDeps: vi.fn() }));
vi.mock("@/lib/billing/apply", () => ({ applyPurchase: vi.fn(), loadPurchase: vi.fn() }));

const SECRET = "wh_mock_unit_secret";
const PURCHASE_ID = "5b0f3a52-2c55-4f4c-9d1e-8c2b7f3e9a10";
const api = { environment: "mock" as const, apiBaseUrl: "http://127.0.0.1:4010", secretKey: "sk_mock_unit" };

const settings: BillingSettings = {
  production: false,
  environment: "mock",
  api,
  webhook: { secret: SECRET, api },
  alertEmail: null,
  problems: [],
};

const purchase = { id: PURCHASE_ID, environment: "mock", fedapayTransactionId: 104 };

const rpc = vi.fn();

function event(overrides: Record<string, unknown> = {}) {
  return JSON.stringify({
    id: 7,
    name: "transaction.approved",
    object: "transaction",
    object_id: 104,
    entity: { id: 104, status: "approved", amount: 1, merchant_reference: `KR-${PURCHASE_ID}` },
    ...overrides,
  });
}

function delivery(body: string, header: string | null = signatureHeader(body, SECRET)) {
  return new Request("http://localhost:3000/api/billing/fedapay/webhook", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(header ? { "X-FEDAPAY-SIGNATURE": header } : {}) },
    body,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(getBillingSettings).mockReturnValue(settings);
  vi.mocked(applyDeps).mockReturnValue({ db: { rpc, from: vi.fn() } as never, api });
  rpc.mockResolvedValue({ data: [{ purchase_id: PURCHASE_ID, event_seen: false }], error: null });
  vi.mocked(loadPurchase).mockResolvedValue(purchase as never);
  vi.mocked(applyPurchase).mockResolvedValue({ ok: true, outcome: "granted" } as never);
});

describe("POST /api/billing/fedapay/webhook", () => {
  it("re-reads and applies a signed transaction event, then answers 200", async () => {
    const response = await POST(delivery(event()));
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
    expect(rpc).toHaveBeenCalledWith("billing_find_purchase", {
      p_environment: "mock",
      p_transaction_id: 104,
      p_merchant_reference: `KR-${PURCHASE_ID}`,
      p_event_id: "7",
    });
    expect(applyPurchase).toHaveBeenCalledWith(expect.anything(), purchase, {
      source: "webhook",
      eventId: "7",
      eventName: "transaction.approved",
    });
  });

  it("refuses a missing, wrong or stale signature with 401, and logs no body", async () => {
    const body = event();
    const stale = signatureHeader(body, SECRET, new Date(Date.now() - 10 * 60 * 1000));
    for (const header of [null, "t=1,s=abc", signatureHeader(body, "wh_other"), stale]) {
      const response = await POST(delivery(body, header));
      expect(response.status).toBe(401);
      expect(await response.json()).toEqual({ error: "invalid signature" });
    }
    expect(rpc).not.toHaveBeenCalled();
    expect(applyPurchase).not.toHaveBeenCalled();
    expect(JSON.stringify(vi.mocked(log.warn).mock.calls)).not.toContain("merchant_reference");
  });

  it("checks the signature on the raw body: a body changed after signing is refused", async () => {
    const header = signatureHeader(event(), SECRET);
    const response = await POST(delivery(event({ object_id: 105 }), header));
    expect(response.status).toBe(401);
  });

  it("answers 400 to a signed body that is not JSON", async () => {
    const response = await POST(delivery("not json"));
    expect(response.status).toBe(400);
  });

  it("answers 413 to a body over 100 KB, before checking anything", async () => {
    const response = await POST(delivery(event({ padding: "x".repeat(100_001) })));
    expect(response.status).toBe(413);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 200 and does nothing for events that are not about a transaction", async () => {
    const response = await POST(delivery(event({ name: "customer.created" })));
    expect(response.status).toBe(200);
    expect(rpc).not.toHaveBeenCalled();
  });

  it("answers 200 for a transaction of no purchase here", async () => {
    rpc.mockResolvedValue({ data: [], error: null });
    const response = await POST(delivery(event()));
    expect(response.status).toBe(200);
    expect(applyPurchase).not.toHaveBeenCalled();
  });

  it("answers 200 right away to an event already applied", async () => {
    rpc.mockResolvedValue({ data: [{ purchase_id: PURCHASE_ID, event_seen: true }], error: null });
    const response = await POST(delivery(event()));
    expect(response.status).toBe(200);
    expect(loadPurchase).not.toHaveBeenCalled();
    expect(applyPurchase).not.toHaveBeenCalled();
  });

  it("answers 500 when FedaPay or the database fails, so FedaPay delivers again", async () => {
    for (const reason of ["fedapay", "database"]) {
      vi.mocked(applyPurchase).mockResolvedValueOnce({ ok: false, reason } as never);
      const response = await POST(delivery(event()));
      expect(response.status).toBe(500);
      expect(await response.json()).toEqual({ error: "retry" });
    }
    rpc.mockResolvedValueOnce({ data: null, error: { message: "connection refused" } });
    expect((await POST(delivery(event()))).status).toBe(500);
  });

  it("answers 503 when the FedaPay settings of this deployment are incomplete", async () => {
    vi.mocked(getBillingSettings).mockReturnValue({
      ...settings,
      webhook: null,
      problems: ["webhook_secret_missing"],
    });
    const response = await POST(delivery(event()));
    expect(response.status).toBe(503);
    expect(rpc).not.toHaveBeenCalled();
  });
});
