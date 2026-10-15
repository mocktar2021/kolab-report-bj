// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { offerTerms } from "./catalog";
import {
  customerFromBuyer,
  returnUrl,
  startPurchase,
  transactionDescription,
  type CheckoutDeps,
  type CheckoutRequest,
} from "./checkout";
import type { FedapayResult, FedapayToken, FedapayTransaction } from "./fedapay";
import type { FedapayConfig } from "./settings";

vi.mock("@sentry/nextjs", () => ({ captureException: vi.fn() }));
vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));

const api: FedapayConfig = {
  environment: "mock",
  apiBaseUrl: "http://127.0.0.1:4010",
  secretKey: "sk_mock_unit",
};
const APP_URL = "https://kolabreport.test";
const ORGANIZATION_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";
const WORKSPACE_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const PURCHASE_ID = "5b0f3a52-2c55-4f4c-9d1e-8c2b7f3e9a10";
const REFERENCE = `KR-${PURCHASE_ID}`;
const PAY_URL = "http://127.0.0.1:4010/pay/abc";

const request: CheckoutRequest = {
  organizationId: ORGANIZATION_ID,
  offer: "cabinet_1m",
  quantity: 1,
  workspaceId: null,
  buyer: { id: "u1", email: "awa@cabinet.test", name: "Awa Dossou Ahouansou" },
};

function transaction(overrides: Partial<FedapayTransaction> = {}): FedapayTransaction {
  return {
    id: 104,
    reference: "trx_104",
    status: "pending",
    amountXof: 49_000,
    feesXof: null,
    mode: null,
    merchantReference: REFERENCE,
    customMetadata: null,
    approvedAt: null,
    currencyIso: null,
    currencyId: 1,
    ...overrides,
  };
}

type CreatedRow = {
  purchase_id: string | null;
  merchant_reference: string | null;
  fedapay_transaction_id: number | null;
  reused: boolean;
  refusal: string | null;
};

const NEW_PURCHASE: CreatedRow = {
  purchase_id: PURCHASE_ID,
  merchant_reference: REFERENCE,
  fedapay_transaction_id: null,
  reused: false,
  refusal: null,
};

function setup(
  options: {
    created?: CreatedRow[];
    create?: FedapayResult<FedapayTransaction>;
    existing?: FedapayResult<FedapayTransaction>;
    byReference?: FedapayResult<FedapayTransaction>;
    token?: FedapayResult<FedapayToken>;
  } = {},
) {
  const created = [...(options.created ?? [NEW_PURCHASE])];
  const rpc = vi.fn((name: string, args?: Record<string, unknown>) => {
    void args;
    if (name === "billing_create_purchase") return Promise.resolve({ data: [created.shift()], error: null });
    if (name === "billing_set_transaction") return Promise.resolve({ data: null, error: null });
    if (name === "billing_apply_transaction") {
      return Promise.resolve({
        data: [
          {
            outcome: "granted",
            notice: null,
            entitlement_id: "e1",
            pack_id: null,
            ends_at: null,
            receipt_number: "KR-2026-000009",
          },
        ],
        error: null,
      });
    }
    return Promise.reject(new Error(`unexpected rpc ${name}`));
  });
  const maybeSingle = vi.fn(
    (): Promise<{ data: unknown; error: null }> =>
      Promise.resolve({ data: { name: "Cabinet Dossou" }, error: null }),
  );
  const from = vi.fn((table: string) => ({
    select: () => ({
      eq: () => ({
        maybeSingle:
          table === "billing_purchases"
            ? () =>
                Promise.resolve({
                  data: {
                    id: PURCHASE_ID,
                    organization_id: ORGANIZATION_ID,
                    environment: "mock",
                    status: "pending",
                    fedapay_transaction_id: 104,
                    merchant_reference: REFERENCE,
                    created_at: "2026-10-15T08:00:00Z",
                    last_checked_at: null,
                  },
                  error: null,
                })
            : maybeSingle,
      }),
    }),
  }));
  const fedapay = {
    createTransaction: vi.fn().mockResolvedValue(options.create ?? { ok: true, value: transaction() }),
    createToken: vi
      .fn()
      .mockResolvedValue(options.token ?? { ok: true, value: { token: "abc", url: PAY_URL } }),
    getTransaction: vi.fn().mockResolvedValue(options.existing ?? { ok: true, value: transaction() }),
    getTransactionByMerchantReference: vi.fn().mockResolvedValue(
      options.byReference ?? {
        ok: false,
        error: { code: "not_found", status: 404, request: "GET", transient: false, message: "x" },
      },
    ),
  };
  const deps: CheckoutDeps = {
    db: { rpc, from } as unknown as CheckoutDeps["db"],
    api,
    appUrl: APP_URL,
    fedapay,
    notify: vi.fn().mockResolvedValue(undefined),
  };
  return { deps, rpc, fedapay };
}

const timeout = {
  ok: false as const,
  error: {
    code: "timeout" as const,
    status: null,
    request: "POST /v1/transactions",
    transient: true,
    message: "x",
  },
};

beforeEach(() => {
  vi.clearAllMocks();
});

describe("startPurchase", () => {
  it("creates the purchase from the catalogue, then the FedaPay transaction, and returns the payment page", async () => {
    const { deps, rpc, fedapay } = setup();

    const result = await startPurchase(deps, request);

    expect(result).toEqual({ ok: true, purchaseId: PURCHASE_ID, url: PAY_URL });
    expect(rpc).toHaveBeenCalledWith("billing_create_purchase", {
      p_organization_id: ORGANIZATION_ID,
      p_offer: "cabinet_1m",
      p_offer_label: "Cabinet, 1 mois",
      p_catalog_version: 1,
      p_quantity: 1,
      p_terms: offerTerms("cabinet_1m"),
      p_amount_ht_xof: 49_000,
      p_tax_xof: 0,
      p_environment: "mock",
      p_created_by: "u1",
      p_workspace_id: undefined,
      p_reuse: true,
    });
    expect(fedapay.createTransaction).toHaveBeenCalledWith(api, {
      description: "KolabReport, offre Cabinet, 1 mois, Cabinet Dossou",
      amountXof: 49_000,
      callbackUrl: `${APP_URL}/fr/organisations/${ORGANIZATION_ID}/abonnement/retour/${PURCHASE_ID}`,
      merchantReference: REFERENCE,
      customMetadata: { purchase_id: PURCHASE_ID },
      customer: { email: "awa@cabinet.test", firstname: "Awa", lastname: "Dossou Ahouansou" },
    });
    expect(rpc).toHaveBeenCalledWith("billing_set_transaction", {
      p_purchase_id: PURCHASE_ID,
      p_transaction_id: 104,
      p_status: "pending",
    });
    expect(fedapay.createToken).toHaveBeenCalledWith(api, 104);
  });

  it("charges packs by quantity and sends the workspace of a pass", async () => {
    const { deps, rpc } = setup({ create: { ok: true, value: transaction({ amountXof: 36_000 }) } });
    await startPurchase(deps, { ...request, offer: "ai_pack_100", quantity: 3 });
    expect(rpc.mock.calls[0]?.[1]).toMatchObject({
      p_offer: "ai_pack_100",
      p_quantity: 3,
      p_amount_ht_xof: 36_000,
    });

    const pass = setup({ create: { ok: true, value: transaction({ amountXof: 39_000 }) } });
    await startPurchase(pass.deps, { ...request, offer: "mission_pass", workspaceId: WORKSPACE_ID });
    expect(pass.rpc.mock.calls[0]?.[1]).toMatchObject({
      p_offer: "mission_pass",
      p_workspace_id: WORKSPACE_ID,
    });
  });

  it("refuses unknown offers, bad quantities and a workspace without a pass, before anything else", async () => {
    for (const bad of [
      { ...request, offer: "institution" },
      { ...request, offer: "cabinet_1m", quantity: 2 },
      { ...request, offer: "ai_pack_100", quantity: 11 },
      { ...request, offer: "mission_pass", workspaceId: null },
      { ...request, offer: "cabinet_1m", workspaceId: WORKSPACE_ID },
    ]) {
      const { deps, rpc } = setup();
      expect(await startPurchase(deps, bad)).toEqual({ ok: false, error: "invalidOffer" });
      expect(rpc).not.toHaveBeenCalled();
    }
  });

  it("passes the database's refusals on", async () => {
    for (const refusal of ["forbidden", "review", "missionWorkspace", "packNeedsPlan", "packLimit"]) {
      const { deps, fedapay } = setup({ created: [{ ...NEW_PURCHASE, purchase_id: null, refusal }] });
      expect(await startPurchase(deps, request)).toEqual({ ok: false, error: refusal });
      expect(fedapay.createTransaction).not.toHaveBeenCalled();
    }
  });

  it("finds the transaction by merchant reference when the create timed out", async () => {
    const { deps, fedapay, rpc } = setup({
      create: timeout,
      byReference: { ok: true, value: transaction() },
    });
    expect(await startPurchase(deps, request)).toMatchObject({ ok: true, url: PAY_URL });
    expect(fedapay.getTransactionByMerchantReference).toHaveBeenCalledWith(api, REFERENCE);
    expect(rpc).toHaveBeenCalledWith(
      "billing_set_transaction",
      expect.objectContaining({ p_transaction_id: 104 }),
    );
  });

  it("gives up when FedaPay cannot be reached and has no transaction", async () => {
    const { deps, rpc } = setup({ create: timeout });
    expect(await startPurchase(deps, request)).toEqual({ ok: false, error: "unavailable" });
    expect(rpc).not.toHaveBeenCalledWith("billing_set_transaction", expect.anything());
  });

  it("never links a transaction for another amount", async () => {
    const { deps, rpc } = setup({ create: { ok: true, value: transaction({ amountXof: 1_000 }) } });
    expect(await startPurchase(deps, request)).toEqual({ ok: false, error: "unavailable" });
    expect(rpc).not.toHaveBeenCalledWith("billing_set_transaction", expect.anything());
  });

  it("pays a pending order again on its own transaction", async () => {
    const { deps, fedapay } = setup({
      created: [{ ...NEW_PURCHASE, fedapay_transaction_id: 104, reused: true }],
      existing: { ok: true, value: transaction({ status: "declined" }) },
    });
    expect(await startPurchase(deps, request)).toEqual({ ok: true, purchaseId: PURCHASE_ID, url: PAY_URL });
    expect(fedapay.createTransaction).not.toHaveBeenCalled();
    expect(fedapay.createToken).toHaveBeenCalledWith(api, 104);
  });

  it("sends the buyer to the return page when the pending order turns out to be paid", async () => {
    const { deps, fedapay, rpc } = setup({
      created: [{ ...NEW_PURCHASE, fedapay_transaction_id: 104, reused: true }],
      existing: { ok: true, value: transaction({ status: "approved" }) },
    });
    expect(await startPurchase(deps, request)).toEqual({
      ok: true,
      purchaseId: PURCHASE_ID,
      url: returnUrl(APP_URL, ORGANIZATION_ID, PURCHASE_ID),
    });
    expect(rpc).toHaveBeenCalledWith(
      "billing_apply_transaction",
      expect.objectContaining({ p_source: "checkout" }),
    );
    expect(fedapay.createToken).not.toHaveBeenCalled();
  });

  it("starts a new purchase when the pending order has expired at FedaPay", async () => {
    const other = "6c1f4b63-3d66-4a5d-8e2f-9d3c8a4f0b21";
    const { deps, rpc, fedapay } = setup({
      created: [
        { ...NEW_PURCHASE, fedapay_transaction_id: 104, reused: true },
        { ...NEW_PURCHASE, purchase_id: other, merchant_reference: `KR-${other}` },
      ],
      existing: { ok: true, value: transaction({ status: "expired" }) },
      create: { ok: true, value: transaction({ id: 105, merchantReference: `KR-${other}` }) },
    });
    expect(await startPurchase(deps, request)).toEqual({ ok: true, purchaseId: other, url: PAY_URL });
    expect(
      rpc.mock.calls.filter(([name]) => name === "billing_create_purchase").map(([, args]) => args?.p_reuse),
    ).toEqual([true, false]);
    expect(fedapay.createToken).toHaveBeenCalledWith(api, 105);
  });
});

describe("customerFromBuyer", () => {
  it("splits the name, and sends only the e-mail when the name is the e-mail", () => {
    expect(customerFromBuyer({ id: "u", email: "a@b.test", name: "Awa" })).toEqual({
      email: "a@b.test",
      firstname: "Awa",
    });
    expect(customerFromBuyer({ id: "u", email: "a@b.test", name: "a@b.test" })).toEqual({
      email: "a@b.test",
    });
    expect(customerFromBuyer({ id: "u", email: "a@b.test", name: null })).toEqual({ email: "a@b.test" });
  });
});

describe("transactionDescription", () => {
  it("names the offer, the quantity and the organization, in 255 characters at most", () => {
    expect(transactionDescription("ai_pack_100", 3, "Cabinet A")).toBe(
      "KolabReport, offre Pack IA, 100 brouillons IA (x3), Cabinet A",
    );
    expect(transactionDescription("cabinet_1m", 1, "x".repeat(400))).toHaveLength(255);
  });
});
