// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import * as Sentry from "@sentry/nextjs";
import { log } from "@/lib/log";
import {
  applyPurchase,
  FEDAPAY_XOF_CURRENCY_ID,
  transactionCurrency,
  type ApplyDeps,
  type PurchaseRef,
} from "./apply";
import type { FedapayResult, FedapayTransaction } from "./fedapay";
import type { FedapayConfig } from "./settings";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const PURCHASE_ID = "5b0f3a52-2c55-4f4c-9d1e-8c2b7f3e9a10";
const ORGANIZATION_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";
const REFERENCE = `KR-${PURCHASE_ID}`;

const api: FedapayConfig = {
  environment: "mock",
  apiBaseUrl: "http://127.0.0.1:4010",
  secretKey: "sk_mock_unit",
};

const purchase: PurchaseRef = {
  id: PURCHASE_ID,
  organizationId: ORGANIZATION_ID,
  environment: "mock",
  status: "pending",
  fedapayTransactionId: 104,
  merchantReference: REFERENCE,
  createdAt: "2026-10-15T09:00:00Z",
  lastCheckedAt: null,
};

const approved: FedapayTransaction = {
  id: 104,
  reference: "trx_mock_104",
  status: "approved",
  amountXof: 15_000,
  feesXof: 270,
  mode: "momo_test",
  merchantReference: REFERENCE,
  customMetadata: { purchase_id: PURCHASE_ID },
  approvedAt: "2026-10-15T09:01:00Z",
  currencyIso: null,
  currencyId: FEDAPAY_XOF_CURRENCY_ID,
};

const granted = {
  outcome: "granted",
  notice: null,
  entitlement_id: "e1",
  pack_id: null,
  ends_at: "2026-11-15T09:01:00Z",
  receipt_number: "KR-2026-000001",
};

function setup(
  options: {
    transaction?: FedapayResult<FedapayTransaction>;
    byReference?: FedapayResult<FedapayTransaction>;
    row?: unknown;
    error?: { message: string } | null;
  } = {},
) {
  const rpc = vi.fn().mockResolvedValue({ data: [options.row ?? granted], error: options.error ?? null });
  const getTransaction = vi.fn().mockResolvedValue(options.transaction ?? { ok: true, value: approved });
  const getTransactionByMerchantReference = vi
    .fn()
    .mockResolvedValue(options.byReference ?? { ok: true, value: approved });
  const notify = vi.fn().mockResolvedValue(undefined);
  const deps: ApplyDeps = {
    db: { rpc, from: vi.fn() } as unknown as ApplyDeps["db"],
    api,
    fedapay: { getTransaction, getTransactionByMerchantReference },
    notify,
  };
  return { deps, rpc, getTransaction, getTransactionByMerchantReference, notify };
}

const fedapayError = (code: "timeout" | "not_found" | "unauthorized") => ({
  ok: false as const,
  error: {
    code,
    status: code === "timeout" ? null : code === "not_found" ? 404 : 401,
    request: "GET /v1/transactions/104",
    transient: code === "timeout",
    message: "x",
  },
});

beforeEach(() => {
  vi.clearAllMocks();
});

describe("applyPurchase", () => {
  it("re-reads the purchase's own transaction and applies what FedaPay says", async () => {
    const { deps, rpc, getTransaction, notify } = setup();

    const result = await applyPurchase(deps, purchase, {
      source: "webhook",
      eventId: "42",
      eventName: "transaction.approved",
    });

    expect(getTransaction).toHaveBeenCalledWith(api, 104);
    expect(rpc).toHaveBeenCalledWith("billing_apply_transaction", {
      p_purchase_id: PURCHASE_ID,
      p_source: "webhook",
      p_transaction_id: 104,
      p_status: "approved",
      p_amount_xof: 15_000,
      p_environment: "mock",
      p_currency: "XOF",
      p_merchant_reference: REFERENCE,
      p_event_id: "42",
      p_event_name: "transaction.approved",
      p_reference: "trx_mock_104",
      p_mode: "momo_test",
      p_fees_xof: 270,
      p_approved_at: "2026-10-15T09:01:00Z",
    });
    expect(result).toMatchObject({
      ok: true,
      outcome: "granted",
      receiptNumber: "KR-2026-000001",
      endsAt: "2026-11-15T09:01:00Z",
    });
    expect(notify).toHaveBeenCalledWith({ purchase, result, source: "webhook" });
    expect(log.info).toHaveBeenCalledWith(
      "billing: purchase granted",
      expect.objectContaining({
        purchaseId: PURCHASE_ID,
        receiptNumber: "KR-2026-000001",
        source: "webhook",
      }),
    );
  });

  it("passes FedaPay's amount and reference as they are, so the database can refuse them", async () => {
    const { deps, rpc } = setup({
      transaction: { ok: true, value: { ...approved, amountXof: 1_000, merchantReference: "KR-other" } },
      row: { ...granted, outcome: "review", notice: "amount", receipt_number: null },
    });
    const result = await applyPurchase(deps, purchase, { source: "return" });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_amount_xof: 1_000, p_merchant_reference: "KR-other" });
    expect(result).toMatchObject({ ok: true, outcome: "review", notice: "amount" });
    expect(log.error).toHaveBeenCalledWith(
      "billing: purchase needs review",
      expect.objectContaining({ purchaseId: PURCHASE_ID, reason: "amount" }),
    );
  });

  it("finds a transaction never linked by the purchase's merchant reference", async () => {
    const { deps, getTransaction, getTransactionByMerchantReference } = setup();
    await applyPurchase(deps, { ...purchase, fedapayTransactionId: null }, { source: "reconcile" });
    expect(getTransaction).not.toHaveBeenCalled();
    expect(getTransactionByMerchantReference).toHaveBeenCalledWith(api, REFERENCE);
  });

  it("says when FedaPay has no transaction for it yet", async () => {
    const { deps, rpc } = setup({ byReference: fedapayError("not_found") });
    const result = await applyPurchase(
      deps,
      { ...purchase, fedapayTransactionId: null },
      { source: "reconcile" },
    );
    expect(result).toMatchObject({ ok: false, reason: "no_transaction" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("never touches a purchase of another FedaPay environment", async () => {
    const { deps, rpc, getTransaction } = setup();
    const result = await applyPurchase(deps, { ...purchase, environment: "live" }, { source: "webhook" });
    expect(result).toEqual({ ok: false, reason: "environment" });
    expect(getTransaction).not.toHaveBeenCalled();
    expect(rpc).not.toHaveBeenCalled();
  });

  it("applies nothing when FedaPay cannot be read", async () => {
    const { deps, rpc, notify } = setup({ transaction: fedapayError("timeout") });
    const result = await applyPurchase(deps, purchase, { source: "webhook" });
    expect(result).toMatchObject({ ok: false, reason: "fedapay", error: { code: "timeout" } });
    expect(rpc).not.toHaveBeenCalled();
    expect(notify).not.toHaveBeenCalled();
    expect(log.error).toHaveBeenCalledWith(
      "billing: fedapay request failed",
      expect.objectContaining({
        purchaseId: PURCHASE_ID,
        code: "timeout",
        request: "GET /v1/transactions/104",
      }),
    );
  });

  it("reports a failed grant to Sentry, tagged with the purchase", async () => {
    const { deps, notify } = setup({ error: { message: "deadlock detected" }, row: null });
    const result = await applyPurchase(deps, purchase, { source: "reconcile" });
    expect(result).toMatchObject({
      ok: false,
      reason: "database",
      transaction: { id: 104, status: "approved" },
    });
    expect(Sentry.captureException).toHaveBeenCalledWith(expect.any(Error), {
      tags: { purchaseId: PURCHASE_ID },
    });
    expect(notify).not.toHaveBeenCalled();
  });

  it("treats an unknown outcome as a failure", async () => {
    const { deps } = setup({ row: { ...granted, outcome: "maybe" } });
    expect(await applyPurchase(deps, purchase, { source: "return" })).toMatchObject({
      ok: false,
      reason: "database",
    });
  });

  it("logs a refund as a warning", async () => {
    const { deps } = setup({
      transaction: { ok: true, value: { ...approved, status: "refunded" } },
      row: { ...granted, outcome: "refunded", entitlement_id: null, receipt_number: null },
    });
    await applyPurchase(deps, purchase, { source: "webhook" });
    expect(log.warn).toHaveBeenCalledWith(
      "billing: refund seen",
      expect.objectContaining({ purchaseId: PURCHASE_ID }),
    );
  });

  it("works without e-mails", async () => {
    const { deps } = setup();
    const { notify, ...withoutNotify } = deps;
    void notify;
    expect(await applyPurchase(withoutNotify, purchase, { source: "return" })).toMatchObject({
      ok: true,
      outcome: "granted",
    });
  });
});

describe("transactionCurrency", () => {
  it("reads the ISO code first, then FedaPay's id for XOF, and nothing else", () => {
    expect(transactionCurrency({ ...approved, currencyIso: "XOF", currencyId: null })).toBe("XOF");
    expect(transactionCurrency({ ...approved, currencyIso: "EUR", currencyId: 1 })).toBe("EUR");
    expect(transactionCurrency({ ...approved, currencyIso: null, currencyId: 1 })).toBe("XOF");
    expect(transactionCurrency({ ...approved, currencyIso: null, currencyId: 2 })).toBeNull();
    expect(transactionCurrency({ ...approved, currencyIso: null, currencyId: null })).toBeNull();
  });

  it("sends no currency to the database when FedaPay does not say, which puts the payment in review", async () => {
    const { deps, rpc } = setup({ transaction: { ok: true, value: { ...approved, currencyId: null } } });
    await applyPurchase(deps, purchase, { source: "webhook" });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({ p_currency: undefined });
  });
});
