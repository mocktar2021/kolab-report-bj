import type { DraftErrorBody, DraftErrorKey, DraftErrorValues, DraftStreamEvent } from "./types";

// Browser side of POST /api/ai/sections/[id]/draft. A refusal is a JSON
// DraftErrorBody, a success is NDJSON: one DraftStreamEvent per line.

const ERROR_KEYS = {
  unauthenticated: true,
  forbidden: true,
  notFound: true,
  invalidRequest: true,
  noDeliverables: true,
  templateUnavailable: true,
  aiUnavailable: true,
  rateLimited: true,
  budgetExceeded: true,
  busy: true,
  invalidOutput: true,
  aborted: true,
  timeout: true,
  providerError: true,
  quotaExceeded: true,
  quotaExceededTrial: true,
  quotaExceededMission: true,
  quotaUsed: true,
  readOnly: true,
  templateNotIncluded: true,
  generic: true,
} satisfies Record<DraftErrorKey, true>;

export function isDraftErrorKey(value: unknown): value is DraftErrorKey {
  return typeof value === "string" && Object.hasOwn(ERROR_KEYS, value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * The event a decoded line holds, or null when its type is unknown or its
 * fields can't be used. An error key the client doesn't know becomes "generic".
 */
function toEvent(value: unknown): DraftStreamEvent | null {
  if (!isRecord(value)) return null;
  switch (value.type) {
    case "start":
      if (typeof value.generationId !== "string" || !Array.isArray(value.deliverables)) return null;
      return {
        type: "start",
        generationId: value.generationId,
        truncated: value.truncated === true,
        deliverables: value.deliverables as Extract<DraftStreamEvent, { type: "start" }>["deliverables"],
      };
    case "partial":
      return { type: "partial", object: value.object };
    case "repair":
      return { type: "repair" };
    case "done":
      if (typeof value.generationId !== "string" || typeof value.markdown !== "string") return null;
      if (!isRecord(value.output)) return null;
      return value as Extract<DraftStreamEvent, { type: "done" }>;
    case "error":
      return { type: "error", error: isDraftErrorKey(value.error) ? value.error : "generic" };
    default:
      return null;
  }
}

/**
 * Reads the NDJSON stream of a draft and calls `onEvent` for each event, in
 * order. Lines may be split across chunks and the last one may lack its
 * newline. Blank lines and unknown event types are skipped. Throws on a line
 * that isn't JSON, and when the request is aborted.
 */
export async function readDraftStream(
  response: Response,
  onEvent: (event: DraftStreamEvent) => void,
): Promise<void> {
  if (!response.body) throw new Error("The draft response has no body.");
  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";

  const handle = (line: string) => {
    if (line.trim() === "") return;
    const event = toEvent(JSON.parse(line));
    if (event) onEvent(event);
  };

  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      lines.forEach(handle);
    }
    buffer += decoder.decode();
    handle(buffer);
  } catch (error) {
    // Stops the download, which also stops the generation on the server.
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }
}

/** Seconds from a Retry-After header: a number of seconds or an HTTP date. */
function retryAfterHeader(value: string | null): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+$/.test(trimmed)) return Number(trimmed);
  const date = Date.parse(trimmed);
  if (Number.isNaN(date)) return undefined;
  return Math.max(0, Math.ceil((date - Date.now()) / 1000));
}

/** The numbers of a quota message, keeping only what has the expected type. */
function errorValues(value: unknown): DraftErrorValues | undefined {
  if (!isRecord(value)) return undefined;
  const values: DraftErrorValues = {};
  if (typeof value.max === "number" && Number.isInteger(value.max) && value.max >= 0) values.max = value.max;
  if (typeof value.date === "string" && value.date.length <= 40) values.date = value.date;
  return Object.keys(values).length > 0 ? values : undefined;
}

/** Quota messages need these values; without them the plain one is shown. */
const NEEDED_VALUES: Partial<Record<DraftErrorKey, (keyof DraftErrorValues)[]>> = {
  quotaExceeded: ["max", "date"],
  quotaExceededTrial: ["max"],
  quotaExceededMission: ["max"],
};

/**
 * What a refused request says (any status but 200). Falls back to "generic"
 * when the body isn't the expected JSON. `retryAfter` comes from the body,
 * or else from the Retry-After header.
 */
export async function draftRequestError(response: Response): Promise<DraftErrorBody> {
  let body: unknown = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  const record = isRecord(body) ? body : {};
  let error = isDraftErrorKey(record.error) ? record.error : "generic";
  const values = errorValues(record.values);
  if (NEEDED_VALUES[error]?.some((name) => values?.[name] === undefined)) error = "quotaUsed";
  const fromBody =
    typeof record.retryAfter === "number" && Number.isFinite(record.retryAfter) && record.retryAfter >= 0
      ? Math.ceil(record.retryAfter)
      : undefined;
  const retryAfter = fromBody ?? retryAfterHeader(response.headers.get("Retry-After"));
  return {
    error,
    ...(retryAfter === undefined ? {} : { retryAfter }),
    ...(values && error !== "quotaUsed" ? { values } : {}),
  };
}
