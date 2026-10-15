// @vitest-environment node
import { describe, expect, it } from "vitest";
import { parseWebhookEvent } from "./webhook-event";

const REFERENCE = "KR-5b0f3a52-2c55-4f4c-9d1e-8c2b7f3e9a10";

describe("parseWebhookEvent", () => {
  it("reads the shape of FedaPay's docs and of our mock: name, object and entity", () => {
    expect(
      parseWebhookEvent({
        id: 7,
        name: "transaction.approved",
        object: "transaction",
        object_id: 104,
        entity: { id: 104, status: "approved", amount: 15_000, merchant_reference: REFERENCE },
      }),
    ).toEqual({ name: "transaction.approved", id: "7", transactionId: 104, merchantReference: REFERENCE });
  });

  it("reads the shape of the SDK's fixtures: type, entity and object_id", () => {
    expect(
      parseWebhookEvent({
        id: "evt_1",
        type: "transaction.declined",
        object_id: "104",
        entity: { id: "104" },
      }),
    ).toEqual({ name: "transaction.declined", id: "evt_1", transactionId: 104, merchantReference: null });
  });

  it("falls back on object_id, and unwraps an entity under v1/transaction", () => {
    expect(parseWebhookEvent({ name: "transaction.updated", object_id: 105 }).transactionId).toBe(105);
    expect(
      parseWebhookEvent({ name: "transaction.updated", entity: { "v1/transaction": { id: 106 } } })
        .transactionId,
    ).toBe(106);
    expect(parseWebhookEvent({ name: "transaction.updated", data: { id: 107 } }).transactionId).toBe(107);
  });

  it("never invents a transaction id", () => {
    for (const body of [
      { name: "transaction.approved", entity: { id: -1 } },
      { name: "transaction.approved", entity: { id: 1.5 } },
      { name: "transaction.approved", entity: { id: "104abc" } },
      { name: "transaction.approved", object_id: "" },
    ]) {
      expect(parseWebhookEvent(body).transactionId).toBeNull();
    }
  });

  it("reads nothing from a body that is not an object", () => {
    for (const body of [null, "transaction.approved", 42, [{ name: "transaction.approved" }]]) {
      expect(parseWebhookEvent(body)).toEqual({
        name: null,
        id: null,
        transactionId: null,
        merchantReference: null,
      });
    }
  });

  it("keeps no status or amount: the server asks FedaPay for those", () => {
    const event = parseWebhookEvent({
      name: "transaction.approved",
      entity: { id: 1, status: "approved", amount: 1 },
    });
    expect(Object.keys(event).sort()).toEqual(["id", "merchantReference", "name", "transactionId"]);
  });
});
