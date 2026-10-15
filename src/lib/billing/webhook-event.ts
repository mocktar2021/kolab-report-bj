// Reads a FedaPay webhook body once its signature is checked (ADR 001, 8.4).
// Only what finds the purchase comes out of it: the event's name and id, the
// transaction id and the merchant reference. Status and amount are never
// read here: the server asks FedaPay's API for them.
//
// The exact body is not documented (ADR 001, section 14). FedaPay's docs
// speak of a name and the object; the SDK's event fixtures show type,
// entity and object_id. Both are read, the entity first.

export type WebhookEvent = {
  /** "transaction.approved", from name or type. Null when there is neither. */
  name: string | null;
  /** FedaPay's event id, as text, for deduplication. */
  id: string | null;
  /** From entity.id, else object_id. */
  transactionId: number | null;
  /** From entity.merchant_reference, to find a purchase whose transaction was never linked. */
  merchantReference: string | null;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function text(value: unknown, max: number): string | null {
  if (typeof value === "number" && Number.isSafeInteger(value)) return String(value);
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed && trimmed.length <= max ? trimmed : null;
}

function positiveId(value: unknown): number | null {
  const number = typeof value === "string" && /^\d{1,15}$/.test(value.trim()) ? Number(value) : value;
  return typeof number === "number" && Number.isSafeInteger(number) && number > 0 ? number : null;
}

/** The transaction object of the event, wrapped under "v1/transaction" or not. */
function entityOf(body: Record<string, unknown>): Record<string, unknown> | null {
  for (const candidate of [body.entity, body.object, body.data]) {
    if (!isRecord(candidate)) continue;
    const inner = candidate["v1/transaction"] ?? candidate.transaction;
    return isRecord(inner) ? inner : candidate;
  }
  return null;
}

export function parseWebhookEvent(body: unknown): WebhookEvent {
  if (!isRecord(body)) return { name: null, id: null, transactionId: null, merchantReference: null };
  const entity = entityOf(body);
  return {
    name: text(body.name, 100) ?? text(body.type, 100),
    id: text(body.id, 100),
    transactionId: positiveId(entity?.id) ?? positiveId(body.object_id),
    merchantReference: text(entity?.merchant_reference, 100),
  };
}
