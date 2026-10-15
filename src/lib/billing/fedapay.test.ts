// @vitest-environment node
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createToken,
  createTransaction,
  FEDAPAY_TIMEOUT_MS,
  getTransaction,
  getTransactionByMerchantReference,
  merchantReference,
  purchaseIdFromMerchantReference,
  type CreateTransactionInput,
} from "./fedapay";
import type { FedapayConfig } from "./settings";

const config: FedapayConfig = {
  environment: "sandbox",
  apiBaseUrl: "https://sandbox-api.fedapay.com",
  secretKey: "sk_sandbox_unit_test",
};

const PURCHASE_ID = "5b0f3a52-2c55-4f4c-9d1e-8c2b7f3e9a10";
const REFERENCE = `KR-${PURCHASE_ID}`;

const input: CreateTransactionInput = {
  description: "KolabReport, offre Cabinet, 1 mois, Cabinet Dossou",
  amountXof: 30_000,
  callbackUrl: `https://app.kolabreport.test/fr/organisations/o1/abonnement/retour/${PURCHASE_ID}`,
  merchantReference: REFERENCE,
  customMetadata: { purchase_id: PURCHASE_ID },
  customer: { email: "awa@cabinet.test", firstname: "Awa", lastname: "Dossou" },
};

/** A transaction as the API reference shows it, with fields we drop. */
const transaction = {
  id: 104,
  reference: "trx_Ab1_1700000000000",
  amount: 30_000,
  description: input.description,
  status: "pending",
  mode: null,
  fees: null,
  merchant_reference: REFERENCE,
  custom_metadata: { purchase_id: PURCHASE_ID },
  approved_at: null,
  customer_id: 9,
  receipt_url: "https://sandbox-process.fedapay.com/receipt/abc",
};

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function stubFetch(...responses: (Response | Error)[]) {
  const fetchMock = vi.fn();
  for (const response of responses) {
    if (response instanceof Error) fetchMock.mockRejectedValueOnce(response);
    else fetchMock.mockResolvedValueOnce(response);
  }
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

function sent(fetchMock: ReturnType<typeof vi.fn>, call = 0) {
  const [url, init] = fetchMock.mock.calls[call] as [string, RequestInit];
  return { url, init, headers: init.headers as Record<string, string> };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("merchant references", () => {
  it("are KR- and the purchase id, and give the id back", () => {
    expect(merchantReference(PURCHASE_ID.toUpperCase())).toBe(REFERENCE);
    expect(purchaseIdFromMerchantReference(REFERENCE)).toBe(PURCHASE_ID);
    expect(purchaseIdFromMerchantReference("KR-123")).toBeNull();
    expect(purchaseIdFromMerchantReference(`XX-${PURCHASE_ID}`)).toBeNull();
  });
});

describe("createTransaction", () => {
  it("posts an XOF transaction with the secret key and reads a wrapped answer", async () => {
    const fetchMock = stubFetch(json({ "v1/transaction": transaction }, 201));

    const result = await createTransaction(config, input);

    expect(result).toEqual({
      ok: true,
      value: {
        id: 104,
        reference: "trx_Ab1_1700000000000",
        status: "pending",
        amountXof: 30_000,
        feesXof: null,
        mode: null,
        merchantReference: REFERENCE,
        customMetadata: { purchase_id: PURCHASE_ID },
        approvedAt: null,
      },
    });
    const { url, init, headers } = sent(fetchMock);
    expect(url).toBe("https://sandbox-api.fedapay.com/v1/transactions");
    expect(init.method).toBe("POST");
    expect(init.redirect).toBe("error");
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(headers.Authorization).toBe("Bearer sk_sandbox_unit_test");
    expect(JSON.parse(String(init.body))).toEqual({
      description: input.description,
      amount: 30_000,
      currency: { iso: "XOF" },
      callback_url: input.callbackUrl,
      merchant_reference: REFERENCE,
      custom_metadata: { purchase_id: PURCHASE_ID },
      customer: { email: "awa@cabinet.test", firstname: "Awa", lastname: "Dossou" },
    });
  });

  it("reads an answer at the top level too", async () => {
    stubFetch(json(transaction, 201));
    const result = await createTransaction(config, input);
    expect(result.ok && result.value.id).toBe(104);
  });

  it("refuses bad input without calling FedaPay", async () => {
    const fetchMock = stubFetch();
    for (const bad of [
      { ...input, amountXof: 2500.5 },
      { ...input, amountXof: 0 },
      { ...input, merchantReference: "KR-123" },
      { ...input, callbackUrl: "javascript:alert(1)" },
      { ...input, customer: { email: "not an e-mail" } },
    ]) {
      const result = await createTransaction(config, bad);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "invalid_request", status: null, request: "POST /v1/transactions", transient: false },
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("drops unknown fields and reads an empty metadata list as none", async () => {
    stubFetch(json({ ...transaction, custom_metadata: [], fees: 540.4, mode: "momo_test" }, 201));
    const result = await createTransaction(config, input);
    expect(result.ok && result.value).toMatchObject({
      customMetadata: null,
      feesXof: 540,
      mode: "momo_test",
    });
    expect(result.ok && result.value).not.toHaveProperty("receipt_url");
    expect(result.ok && result.value).not.toHaveProperty("customer_id");
  });

  it("maps 4xx answers to codes and never passes FedaPay's text on", async () => {
    const cases = [
      [401, "unauthorized", false],
      [403, "unauthorized", false],
      [404, "not_found", false],
      [422, "rejected", false],
      [429, "unavailable", true],
    ] as const;
    for (const [status, code, transient] of cases) {
      stubFetch(
        json({ message: "Le client awa@cabinet.test a déjà payé", errors: { amount: ["x"] } }, status),
      );
      const result = await createTransaction(config, input);
      expect(result).toEqual({
        ok: false,
        error: { code, status, request: "POST /v1/transactions", transient, message: expect.any(String) },
      });
      expect(JSON.stringify(result)).not.toContain("awa@cabinet.test");
    }
  });

  it("calls a 5xx answer unavailable, and transient", async () => {
    stubFetch(new Response("<html>Bad gateway</html>", { status: 502 }));
    const result = await createTransaction(config, input);
    expect(result).toMatchObject({ ok: false, error: { code: "unavailable", status: 502, transient: true } });
    expect(JSON.stringify(result)).not.toContain("Bad gateway");
  });

  it("calls a 2xx answer that is not JSON, or not a transaction, invalid", async () => {
    for (const response of [
      new Response("<html>ok</html>", { status: 200 }),
      json({ "v1/transaction": { id: "abc", status: "pending", amount: 30_000 } }, 201),
      json({ id: 104, status: "pending", amount: "30000" }, 201),
      json({ id: 104, status: "pending", amount: 300.5 }, 201),
      json({ id: 104, amount: 30_000 }, 201),
      json(null, 201),
    ]) {
      stubFetch(response);
      const result = await createTransaction(config, input);
      expect(result).toMatchObject({
        ok: false,
        error: { code: "invalid_response", status: response.status, transient: false },
      });
    }
  });

  it("calls a refused connection a network error", async () => {
    stubFetch(new TypeError("fetch failed"));
    const result = await createTransaction(config, input);
    expect(result).toMatchObject({ ok: false, error: { code: "network", status: null, transient: true } });
  });

  it("gives up after the timeout and says the outcome is unknown", async () => {
    // A FedaPay that never answers. The signal is the client's own,
    // shortened here so the test does not wait 10 seconds.
    const realTimeout = AbortSignal.timeout.bind(AbortSignal);
    const timeout = vi.spyOn(AbortSignal, "timeout").mockImplementation(() => realTimeout(5));
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () => reject(init.signal?.reason));
          }),
      ),
    );

    const result = await createTransaction(config, input);

    expect(timeout).toHaveBeenCalledWith(FEDAPAY_TIMEOUT_MS);
    expect(FEDAPAY_TIMEOUT_MS).toBe(10_000);
    expect(result).toMatchObject({ ok: false, error: { code: "timeout", status: null, transient: true } });
  });

  it("treats a timeout while reading the body as a timeout", async () => {
    const response = new Response("{}", { status: 201 });
    vi.spyOn(response, "text").mockRejectedValue(
      new DOMException("The operation timed out.", "TimeoutError"),
    );
    stubFetch(response);
    const result = await createTransaction(config, input);
    expect(result).toMatchObject({ ok: false, error: { code: "timeout", status: 201 } });
  });
});

describe("createToken", () => {
  it("returns the payment page, wrapped or not", async () => {
    const token = { token: "tok_abc", url: "https://sandbox-process.fedapay.com/tok_abc" };
    for (const body of [token, { "v1/token": token }]) {
      const fetchMock = stubFetch(json(body));
      expect(await createToken(config, 104)).toEqual({ ok: true, value: token });
      const { url, init } = sent(fetchMock);
      expect(url).toBe("https://sandbox-api.fedapay.com/v1/transactions/104/token");
      expect(init.method).toBe("POST");
    }
  });

  it("refuses a page that is not http or https, and a bad id", async () => {
    stubFetch(json({ token: "t", url: "javascript:alert(1)" }));
    expect(await createToken(config, 104)).toMatchObject({ ok: false, error: { code: "invalid_response" } });
    const fetchMock = stubFetch();
    expect(await createToken(config, -1)).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(await createToken(config, 1.5)).toMatchObject({ ok: false, error: { code: "invalid_request" } });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("getTransaction", () => {
  it("reads an approved transaction", async () => {
    const approved = {
      ...transaction,
      status: "approved",
      mode: "mtn_open",
      fees: 540,
      approved_at: "2026-10-15T09:00:00Z",
    };
    const fetchMock = stubFetch(json({ "v1/transaction": approved }));
    const result = await getTransaction(config, 104);
    expect(result).toMatchObject({
      ok: true,
      value: {
        id: 104,
        status: "approved",
        amountXof: 30_000,
        feesXof: 540,
        approvedAt: "2026-10-15T09:00:00Z",
      },
    });
    const { url, init } = sent(fetchMock);
    expect(url).toBe("https://sandbox-api.fedapay.com/v1/transactions/104");
    expect(init.method).toBe("GET");
    expect(init.body).toBeUndefined();
  });

  it("keeps statuses FedaPay adds later", async () => {
    stubFetch(json({ ...transaction, status: "approved_partially_refunded" }));
    const result = await getTransaction(config, 104);
    expect(result.ok && result.value.status).toBe("approved_partially_refunded");
  });

  it("refuses an answer about another transaction", async () => {
    stubFetch(json({ ...transaction, id: 105 }));
    expect(await getTransaction(config, 104)).toMatchObject({
      ok: false,
      error: { code: "invalid_response", request: "GET /v1/transactions/104" },
    });
  });

  it("says not found on a 404", async () => {
    stubFetch(json({ message: "Not found" }, 404));
    expect(await getTransaction(config, 999)).toMatchObject({
      ok: false,
      error: { code: "not_found", status: 404, request: "GET /v1/transactions/999", transient: false },
    });
  });
});

describe("getTransactionByMerchantReference", () => {
  it("finds the transaction of a purchase, wrapped, unwrapped or in a list of one", async () => {
    for (const body of [
      { "v1/transaction": transaction },
      transaction,
      { "v1/transactions": [transaction] },
    ]) {
      const fetchMock = stubFetch(json(body));
      const result = await getTransactionByMerchantReference(config, REFERENCE);
      expect(result.ok && result.value.id).toBe(104);
      expect(sent(fetchMock).url).toBe(
        `https://sandbox-api.fedapay.com/v1/transactions/merchant/${REFERENCE}`,
      );
    }
  });

  it("says not found on a 404 or an empty list, after a create that timed out", async () => {
    stubFetch(json({ message: "Transaction not found" }, 404));
    expect(await getTransactionByMerchantReference(config, REFERENCE)).toMatchObject({
      ok: false,
      error: { code: "not_found", status: 404 },
    });
    stubFetch(json({ "v1/transactions": [] }));
    expect(await getTransactionByMerchantReference(config, REFERENCE)).toMatchObject({
      ok: false,
      error: { code: "not_found" },
    });
  });

  it("refuses an answer with another reference, or several transactions", async () => {
    stubFetch(json({ ...transaction, merchant_reference: "KR-00000000-0000-0000-0000-000000000000" }));
    expect(await getTransactionByMerchantReference(config, REFERENCE)).toMatchObject({
      ok: false,
      error: { code: "invalid_response" },
    });
    stubFetch(json({ "v1/transactions": [transaction, transaction] }));
    expect(await getTransactionByMerchantReference(config, REFERENCE)).toMatchObject({
      ok: false,
      error: { code: "invalid_response" },
    });
  });

  it("refuses a reference that is not ours without calling FedaPay", async () => {
    const fetchMock = stubFetch();
    expect(await getTransactionByMerchantReference(config, "../../v1/balances")).toMatchObject({
      ok: false,
      error: { code: "invalid_request" },
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
