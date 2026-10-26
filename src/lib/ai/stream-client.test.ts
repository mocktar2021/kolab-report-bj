import { describe, expect, it, vi } from "vitest";
import { draftRequestError, readDraftStream } from "./stream-client";
import type { DraftStreamEvent } from "./types";

const encoder = new TextEncoder();

/** A 200 response whose body arrives in exactly these chunks. */
function chunked(chunks: (string | Uint8Array)[]): Response {
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks)
        controller.enqueue(typeof chunk === "string" ? encoder.encode(chunk) : chunk);
      controller.close();
    },
  });
  return new Response(body, { headers: { "Content-Type": "application/x-ndjson" } });
}

async function collect(response: Response): Promise<DraftStreamEvent[]> {
  const events: DraftStreamEvent[] = [];
  await readDraftStream(response, (event) => events.push(event));
  return events;
}

const start = {
  type: "start",
  generationId: "11111111-1111-4111-8111-111111111111",
  truncated: false,
  deliverables: [],
};

describe("readDraftStream", () => {
  it("reads one event per line, in order", async () => {
    const lines = [start, { type: "partial", object: { summary: "Le" } }, { type: "repair" }];
    const events = await collect(chunked([lines.map((line) => JSON.stringify(line)).join("\n") + "\n"]));
    expect(events.map((event) => event.type)).toEqual(["start", "partial", "repair"]);
    expect(events[1]).toEqual({ type: "partial", object: { summary: "Le" } });
  });

  it("joins lines split across chunks", async () => {
    const text = `${JSON.stringify(start)}\n${JSON.stringify({ type: "partial", object: { summary: "Résumé" } })}\n`;
    const events = await collect(chunked([text.slice(0, 7), text.slice(7, 60), text.slice(60)]));
    expect(events).toHaveLength(2);
    expect(events[1]).toEqual({ type: "partial", object: { summary: "Résumé" } });
  });

  it("decodes a character split between two chunks", async () => {
    const bytes = encoder.encode(`${JSON.stringify({ type: "partial", object: { summary: "Été" } })}\n`);
    // "É" takes two bytes in UTF-8: cut between them.
    const cut = bytes.indexOf(0xc3) + 1;
    const events = await collect(chunked([bytes.slice(0, cut), bytes.slice(cut)]));
    expect(events).toEqual([{ type: "partial", object: { summary: "Été" } }]);
  });

  it("reads a last line without a newline", async () => {
    const events = await collect(chunked([`${JSON.stringify(start)}\n`, JSON.stringify({ type: "repair" })]));
    expect(events.map((event) => event.type)).toEqual(["start", "repair"]);
  });

  it("skips blank lines, CRLF endings and unknown event types", async () => {
    const events = await collect(
      chunked([
        `\n${JSON.stringify(start)}\r\n   \n`,
        `${JSON.stringify({ type: "usage", tokens: 12 })}\n`,
        `${JSON.stringify({ kind: "start" })}\n${JSON.stringify([1, 2])}\n`,
        `${JSON.stringify({ type: "repair" })}\n\n`,
      ]),
    );
    expect(events.map((event) => event.type)).toEqual(["start", "repair"]);
  });

  it("skips known events that miss their fields", async () => {
    const events = await collect(
      chunked([
        `${JSON.stringify({ type: "start", truncated: true })}\n`,
        `${JSON.stringify({ type: "done", generationId: "x" })}\n`,
      ]),
    );
    expect(events).toEqual([]);
  });

  it("passes done events through", async () => {
    const done = {
      type: "done",
      generationId: start.generationId,
      output: { schema: "executive_summary", value: { summary: "Texte", key_points: ["Un"], sources: [] } },
      markdown: "Texte",
    };
    expect(await collect(chunked([JSON.stringify(done)]))).toEqual([done]);
  });

  it("turns an unknown error key into generic", async () => {
    const events = await collect(
      chunked([
        `${JSON.stringify({ type: "error", error: "invalidOutput" })}\n`,
        `${JSON.stringify({ type: "error", error: "somethingNew" })}\n`,
      ]),
    );
    expect(events).toEqual([
      { type: "error", error: "invalidOutput" },
      { type: "error", error: "generic" },
    ]);
  });

  it("throws on a line that isn't JSON and stops reading", async () => {
    const onEvent = vi.fn();
    await expect(
      readDraftStream(
        chunked([`${JSON.stringify(start)}\n{"type": "partial", "obj\n`, '{"type":"repair"}\n']),
        onEvent,
      ),
    ).rejects.toThrow(SyntaxError);
    expect(onEvent).toHaveBeenCalledTimes(1);
  });

  it("throws when the stream errors, for example on abort", async () => {
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode(`${JSON.stringify(start)}\n`));
        controller.error(new DOMException("The operation was aborted.", "AbortError"));
      },
    });
    const onEvent = vi.fn();
    await expect(readDraftStream(new Response(body), onEvent)).rejects.toThrow("aborted");
  });

  it("handles an empty body", async () => {
    expect(await collect(chunked([]))).toEqual([]);
  });
});

describe("draftRequestError", () => {
  it("reads the error key and retryAfter from the body", async () => {
    const response = Response.json({ error: "rateLimited", retryAfter: 120 }, { status: 429 });
    expect(await draftRequestError(response)).toEqual({ error: "rateLimited", retryAfter: 120 });
  });

  it("takes retryAfter from the Retry-After header when the body has none", async () => {
    const response = Response.json(
      { error: "budgetExceeded" },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
    expect(await draftRequestError(response)).toEqual({ error: "budgetExceeded", retryAfter: 3600 });
  });

  it("reads a Retry-After date", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-13T10:00:00Z"));
    try {
      const response = Response.json(
        { error: "rateLimited" },
        { status: 429, headers: { "Retry-After": "Tue, 13 Oct 2026 10:05:00 GMT" } },
      );
      expect(await draftRequestError(response)).toEqual({ error: "rateLimited", retryAfter: 300 });
    } finally {
      vi.useRealTimers();
    }
  });

  it("ignores a Retry-After header it can't read", async () => {
    const response = Response.json(
      { error: "rateLimited" },
      { status: 429, headers: { "Retry-After": "soon" } },
    );
    expect(await draftRequestError(response)).toEqual({ error: "rateLimited" });
  });

  it("falls back to generic on a body that isn't JSON", async () => {
    const response = new Response("<html>Bad gateway</html>", { status: 502 });
    expect(await draftRequestError(response)).toEqual({ error: "generic" });
  });

  it("falls back to generic on an unknown key or an empty body", async () => {
    expect(await draftRequestError(Response.json({ error: "teapot" }, { status: 418 }))).toEqual({
      error: "generic",
    });
    expect(await draftRequestError(new Response(null, { status: 500 }))).toEqual({ error: "generic" });
    expect(await draftRequestError(Response.json(["forbidden"], { status: 403 }))).toEqual({
      error: "generic",
    });
  });

  it("ignores a retryAfter that isn't a positive number", async () => {
    const response = Response.json({ error: "rateLimited", retryAfter: "60" }, { status: 429 });
    expect(await draftRequestError(response)).toEqual({ error: "rateLimited" });
  });

  it("reads the numbers of a quota refusal", async () => {
    const response = Response.json(
      { error: "quotaExceeded", retryAfter: 1_339_200, values: { max: 60, date: "1 novembre 2026" } },
      { status: 402, headers: { "Retry-After": "1339200" } },
    );
    expect(await draftRequestError(response)).toEqual({
      error: "quotaExceeded",
      retryAfter: 1_339_200,
      values: { max: 60, date: "1 novembre 2026" },
    });
    const trial = Response.json({ error: "quotaExceededTrial", values: { max: 20 } }, { status: 402 });
    expect(await draftRequestError(trial)).toEqual({ error: "quotaExceededTrial", values: { max: 20 } });
  });

  it("shows the quota message without numbers when they are missing or malformed", async () => {
    const missing = Response.json({ error: "quotaExceeded", values: { max: 60 } }, { status: 402 });
    expect(await draftRequestError(missing)).toEqual({ error: "quotaUsed" });
    const malformed = Response.json(
      { error: "quotaExceededMission", values: { max: "80" } },
      { status: 402 },
    );
    expect(await draftRequestError(malformed)).toEqual({ error: "quotaUsed" });
  });

  it("names the deliverable read in part, or shows the plain message without its name", async () => {
    const named = Response.json(
      { error: "deliverableReadInPart", values: { name: "rapport-provisoire-v1.pdf" } },
      { status: 422 },
    );
    expect(await draftRequestError(named)).toEqual({
      error: "deliverableReadInPart",
      values: { name: "rapport-provisoire-v1.pdf" },
    });
    const unnamed = Response.json({ error: "deliverableReadInPart" }, { status: 422 });
    expect(await draftRequestError(unnamed)).toEqual({ error: "deliverablesReadInPart" });
    const tooLong = Response.json(
      { error: "deliverableReadInPart", values: { name: "x".repeat(301) } },
      { status: 422 },
    );
    expect(await draftRequestError(tooLong)).toEqual({ error: "deliverablesReadInPart" });
  });

  it("knows the refusal of deliverables too large for the model", async () => {
    expect(await draftRequestError(Response.json({ error: "contextTooLarge" }, { status: 413 }))).toEqual({
      error: "contextTooLarge",
    });
  });

  it("knows the other refusals of the plan", async () => {
    for (const error of ["readOnly", "templateNotIncluded"]) {
      expect(await draftRequestError(Response.json({ error }, { status: 403 }))).toEqual({ error });
    }
  });
});
