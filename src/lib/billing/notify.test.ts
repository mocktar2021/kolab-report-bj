// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/log";
import type { Applied, AppliedEvent, BillingDb, PurchaseRef } from "./apply";
import { sendPurchaseNotices } from "./notify";

vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/email/send", () => ({ sendEmail: vi.fn() }));

const PURCHASE_ID = "5b0f3a52-2c55-4f4c-9d1e-8c2b7f3e9a10";
const ORGANIZATION_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";

const purchase: PurchaseRef = {
  id: PURCHASE_ID,
  organizationId: ORGANIZATION_ID,
  environment: "mock",
  status: "pending",
  fedapayTransactionId: 104,
  merchantReference: `KR-${PURCHASE_ID}`,
  createdAt: "2026-10-15T08:00:00Z",
  lastCheckedAt: null,
};

function applied(outcome: Applied["outcome"], notice: string | null = null): AppliedEvent {
  return {
    purchase,
    source: "webhook",
    result: {
      ok: true,
      outcome,
      notice,
      transaction: {
        id: 104,
        reference: null,
        status: "approved",
        amountXof: 49_000,
        feesXof: null,
        mode: null,
        merchantReference: null,
        customMetadata: null,
        approvedAt: null,
        currencyIso: "XOF",
        currencyId: 1,
      },
      entitlementId: null,
      packId: null,
      endsAt: null,
      receiptNumber: null,
    },
  };
}

const details = {
  organization_id: ORGANIZATION_ID,
  organization_name: "Cabinet A",
  offer: "cabinet_1m",
  offer_label: "Cabinet, 1 mois",
  quantity: 1,
  amount_xof: 49_000,
  buyer_email: "Awa@Cabinet.test",
  billing_email: "awa@cabinet.test",
  plan: "cabinet",
  ends_at: "2026-11-15T09:00:00Z",
  drafts: null,
  receipt_number: "KR-2026-000001",
};

function setup(claims: Record<string, boolean>) {
  const rpc = vi.fn(
    (name: string, args: Record<string, unknown>): Promise<{ data: unknown; error: null }> => {
      if (name === "billing_claim_notice")
        return Promise.resolve({ data: claims[args.p_kind as string] ?? false, error: null });
      if (name === "billing_confirmation_details") return Promise.resolve({ data: [details], error: null });
      return Promise.reject(new Error(`unexpected rpc ${name}`));
    },
  );
  const send = vi.fn().mockResolvedValue(true);
  return { db: { rpc, from: vi.fn() } as unknown as BillingDb, rpc, send };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("sendPurchaseNotices", () => {
  it("claims the confirmation, then sends it once to the buyer and the billing address", async () => {
    const { db, rpc, send } = setup({ confirmation: true });
    await sendPurchaseNotices(db, applied("granted"), {
      alertEmail: "ops@mocktar.test",
      appUrl: "https://kolabreport.test/",
      send,
    });
    expect(rpc).toHaveBeenCalledWith("billing_claim_notice", {
      p_purchase_id: PURCHASE_ID,
      p_kind: "confirmation",
    });
    // The same address in two cases is one e-mail.
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({
      to: "awa@cabinet.test",
      subject: "Paiement reçu, reçu KR-2026-000001",
    });
    expect(send.mock.calls[0]?.[0].text).toContain(
      `https://kolabreport.test/fr/organisations/${ORGANIZATION_ID}/abonnement`,
    );
  });

  it("sends nothing when the confirmation was already claimed", async () => {
    const { db, rpc, send } = setup({ confirmation: false });
    await sendPurchaseNotices(db, applied("already_granted"), {
      alertEmail: null,
      appUrl: "https://x.test",
      send,
    });
    expect(rpc).not.toHaveBeenCalledWith("billing_confirmation_details", expect.anything());
    expect(send).not.toHaveBeenCalled();
  });

  it("alerts the operator on a review, with what did not match", async () => {
    const { db, send } = setup({ review: true });
    await sendPurchaseNotices(db, applied("review", "amount"), {
      alertEmail: "ops@mocktar.test",
      appUrl: "https://x.test",
      send,
    });
    expect(send).toHaveBeenCalledTimes(1);
    expect(send.mock.calls[0]?.[0]).toMatchObject({ to: "ops@mocktar.test" });
    expect(send.mock.calls[0]?.[0].text).toContain("Écart : amount");
  });

  it("alerts on a refund, a payment after expiry and a possible duplicate", async () => {
    const { db, rpc, send } = setup({ refund: true, paid_after_expiry: true, confirmation: false });
    const options = { alertEmail: "ops@mocktar.test", appUrl: "https://x.test", send };
    await sendPurchaseNotices(db, applied("refunded"), options);
    await sendPurchaseNotices(db, applied("granted", "paid_after_expiry"), options);
    expect(rpc.mock.calls.map(([, args]) => args.p_kind)).toEqual([
      "refund",
      "confirmation",
      "paid_after_expiry",
    ]);
    expect(send).toHaveBeenCalledTimes(2);
  });

  it("only logs an alert when BILLING_ALERT_EMAIL is not set", async () => {
    const { db, rpc, send } = setup({ review: true });
    await sendPurchaseNotices(db, applied("review", "currency"), {
      alertEmail: null,
      appUrl: "https://x.test",
      send,
    });
    expect(rpc).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
    expect(log.warn).toHaveBeenCalledWith(
      "billing: alert not sent, BILLING_ALERT_EMAIL is not set",
      expect.objectContaining({ kind: "review", purchaseId: PURCHASE_ID }),
    );
  });

  it("never throws", async () => {
    const { db, rpc } = setup({ confirmation: true });
    rpc.mockImplementation(() => Promise.reject(new Error("network")));
    await expect(
      sendPurchaseNotices(db, applied("granted"), { alertEmail: null, appUrl: "https://x.test" }),
    ).resolves.toBeUndefined();
    expect(log.error).toHaveBeenCalled();
  });
});
