// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { log } from "@/lib/log";
import type { ApplyDeps } from "./apply";
import type { FedapayResult, FedapayTransaction } from "./fedapay";
import { reconcilePendingPurchases } from "./reconcile";
import type { FedapayConfig } from "./settings";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const api: FedapayConfig = {
  environment: "sandbox",
  apiBaseUrl: "https://sandbox-api.fedapay.com",
  secretKey: "sk_sandbox_unit",
};
const ORGANIZATION_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";

const ids = {
  paid: "00000000-0000-4000-8000-000000000001",
  waiting: "00000000-0000-4000-8000-000000000002",
  lost: "00000000-0000-4000-8000-000000000003",
  broken: "00000000-0000-4000-8000-000000000004",
  stuck: "00000000-0000-4000-8000-000000000005",
  abandoned: "00000000-0000-4000-8000-000000000006",
};

function pendingRow(id: string, transactionId: number | null) {
  return {
    purchase_id: id,
    organization_id: ORGANIZATION_ID,
    fedapay_transaction_id: transactionId,
    merchant_reference: `KR-${id}`,
    created_at: "2026-10-13T08:00:00Z",
  };
}

function transaction(id: number, status: string, approvedAt: string | null = null): FedapayTransaction {
  return {
    id,
    reference: `trx_${id}`,
    status,
    amountXof: 15_000,
    feesXof: null,
    mode: null,
    merchantReference: null,
    customMetadata: null,
    approvedAt,
    currencyIso: "XOF",
    currencyId: 1,
  };
}

function setup(options: {
  pending: ReturnType<typeof pendingRow>[];
  transactions: Record<number, FedapayResult<FedapayTransaction>>;
  byReference?: FedapayResult<FedapayTransaction>;
  outcomes: Record<string, string | null>;
  checked?: Record<string, string>;
}) {
  const rpc = vi.fn((name: string, args: Record<string, unknown>) => {
    if (name === "billing_pending_purchases") return Promise.resolve({ data: options.pending, error: null });
    if (name === "billing_apply_transaction") {
      const outcome = options.outcomes[args.p_purchase_id as string];
      return Promise.resolve(
        outcome
          ? {
              data: [
                {
                  outcome,
                  notice: null,
                  entitlement_id: null,
                  pack_id: null,
                  ends_at: null,
                  receipt_number: null,
                },
              ],
              error: null,
            }
          : { data: null, error: { message: "could not serialize access" } },
      );
    }
    if (name === "billing_check_pending") {
      return Promise.resolve({
        data: options.checked?.[args.p_purchase_id as string] ?? "pending",
        error: null,
      });
    }
    return Promise.reject(new Error(`unexpected rpc ${name}`));
  });
  const getTransaction = vi.fn((_config: FedapayConfig, id: number) =>
    Promise.resolve(options.transactions[id] as FedapayResult<FedapayTransaction>),
  );
  const getTransactionByMerchantReference = vi.fn().mockResolvedValue(
    options.byReference ?? {
      ok: false,
      error: { code: "not_found", status: 404, request: "GET", transient: false, message: "x" },
    },
  );
  const notify = vi.fn().mockResolvedValue(undefined);
  const deps: ApplyDeps = {
    db: { rpc, from: vi.fn() } as unknown as ApplyDeps["db"],
    api,
    fedapay: { getTransaction, getTransactionByMerchantReference },
    notify,
  };
  return { deps, rpc, getTransaction, getTransactionByMerchantReference, notify };
}

beforeEach(() => {
  vi.clearAllMocks();
});

describe("reconcilePendingPurchases", () => {
  it("checks every pending purchase with FedaPay and grants the paid ones", async () => {
    const { deps, rpc, getTransaction, getTransactionByMerchantReference } = setup({
      pending: [pendingRow(ids.paid, 11), pendingRow(ids.waiting, 12), pendingRow(ids.lost, null)],
      transactions: {
        11: { ok: true, value: transaction(11, "approved") },
        12: { ok: true, value: transaction(12, "pending") },
      },
      outcomes: { [ids.paid]: "granted", [ids.waiting]: "pending" },
      checked: { [ids.waiting]: "expired", [ids.lost]: "pending" },
    });

    const summary = await reconcilePendingPurchases(deps, {
      organizationId: ORGANIZATION_ID,
      limit: 5,
      recheckAfter: "1 minute",
    });

    expect(rpc).toHaveBeenCalledWith("billing_pending_purchases", {
      p_environment: "sandbox",
      p_limit: 5,
      p_organization_id: ORGANIZATION_ID,
      p_recheck_after: "1 minute",
    });
    expect(getTransaction).toHaveBeenCalledWith(api, 11);
    expect(getTransaction).toHaveBeenCalledWith(api, 12);
    expect(getTransactionByMerchantReference).toHaveBeenCalledWith(api, `KR-${ids.lost}`);
    // Each applied with the reconcile source.
    expect(
      rpc.mock.calls
        .filter(([name]) => name === "billing_apply_transaction")
        .map(([, args]) => args.p_source),
    ).toEqual(["reconcile", "reconcile"]);
    // Still pending, or nothing at FedaPay: checked, and expired after 48 hours.
    expect(
      rpc.mock.calls
        .filter(([name]) => name === "billing_check_pending")
        .map(([, args]) => args.p_purchase_id),
    ).toEqual([ids.waiting, ids.lost]);
    expect(summary).toEqual({ checked: 3, granted: 1, expired: 1, failed: 0 });
    expect(log.info).toHaveBeenCalledWith(
      "billing: reconcile finished",
      expect.objectContaining({ checked: 3, granted: 1, expired: 1, failed: 0 }),
    );
  });

  it("counts FedaPay and database failures, and goes on with the next purchase", async () => {
    const { deps } = setup({
      pending: [pendingRow(ids.broken, 21), pendingRow(ids.paid, 22), pendingRow(ids.waiting, 23)],
      transactions: {
        21: {
          ok: false,
          error: { code: "unavailable", status: 503, request: "GET", transient: true, message: "x" },
        },
        22: { ok: true, value: transaction(22, "approved") },
        23: { ok: true, value: transaction(23, "approved", new Date().toISOString()) },
      },
      outcomes: { [ids.paid]: "granted", [ids.waiting]: null },
    });
    const onStuck = vi.fn().mockResolvedValue(undefined);
    expect(await reconcilePendingPurchases(deps, { onStuck })).toEqual({
      checked: 1,
      granted: 1,
      expired: 0,
      failed: 2,
    });
    // Approved a moment ago: not stuck yet.
    expect(onStuck).not.toHaveBeenCalled();
  });

  it("does not count a checkout FedaPay never got a transaction for as a failure", async () => {
    // Both were looked up by merchant reference and FedaPay has nothing:
    // nothing was paid. The older one is past 48 hours and expires.
    const { deps, rpc, getTransaction } = setup({
      pending: [pendingRow(ids.lost, null), pendingRow(ids.abandoned, null)],
      transactions: {},
      outcomes: {},
      checked: { [ids.lost]: "pending", [ids.abandoned]: "expired" },
    });
    expect(await reconcilePendingPurchases(deps)).toEqual({ checked: 2, granted: 0, expired: 1, failed: 0 });
    expect(getTransaction).not.toHaveBeenCalled();
    expect(
      rpc.mock.calls
        .filter(([name]) => name === "billing_check_pending")
        .map(([, args]) => args.p_purchase_id),
    ).toEqual([ids.lost, ids.abandoned]);
    expect(log.error).not.toHaveBeenCalled();
  });

  it("counts a 404 for a transaction the purchase already links as a failure", async () => {
    // FedaPay created that transaction: losing it should never happen.
    const { deps, rpc } = setup({
      pending: [pendingRow(ids.broken, 41)],
      transactions: {
        41: {
          ok: false,
          error: { code: "not_found", status: 404, request: "GET", transient: false, message: "x" },
        },
      },
      outcomes: {},
    });
    expect(await reconcilePendingPurchases(deps)).toEqual({ checked: 0, granted: 0, expired: 0, failed: 1 });
    expect(rpc.mock.calls.map(([name]) => name)).toEqual(["billing_pending_purchases"]);
    expect(log.error).toHaveBeenCalledWith(
      "billing: fedapay request failed",
      expect.objectContaining({ purchaseId: ids.broken, status: 404, code: "not_found" }),
    );
  });

  it("alerts when a payment approved more than 15 minutes ago still cannot be granted", async () => {
    const approvedAt = new Date(Date.now() - 20 * 60 * 1000).toISOString();
    const { deps } = setup({
      pending: [pendingRow(ids.stuck, 31)],
      transactions: { 31: { ok: true, value: transaction(31, "approved", approvedAt) } },
      outcomes: { [ids.stuck]: null },
    });
    const onStuck = vi.fn().mockResolvedValue(undefined);
    await reconcilePendingPurchases(deps, { onStuck });
    expect(onStuck).toHaveBeenCalledWith(expect.objectContaining({ id: ids.stuck }), 31);
  });

  it("reports a failure when the pending purchases cannot be listed", async () => {
    const { deps, rpc } = setup({ pending: [], transactions: {}, outcomes: {} });
    rpc.mockImplementationOnce(() => Promise.resolve({ data: null, error: { message: "timeout" } }));
    expect(await reconcilePendingPurchases(deps)).toEqual({ checked: 0, granted: 0, expired: 0, failed: 1 });
  });

  it("asks for 20 purchases by default, of this deployment's environment only", async () => {
    const { deps, rpc } = setup({ pending: [], transactions: {}, outcomes: {} });
    await reconcilePendingPurchases(deps);
    expect(rpc).toHaveBeenCalledWith("billing_pending_purchases", {
      p_environment: "sandbox",
      p_limit: 20,
      p_organization_id: undefined,
      p_recheck_after: undefined,
    });
  });
});
