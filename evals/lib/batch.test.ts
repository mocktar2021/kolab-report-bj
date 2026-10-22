// @vitest-environment node
import { createAnthropic } from "@ai-sdk/anthropic";
import {
  APICallError,
  type Experimental_BatchV4,
  type Experimental_BatchV4Status,
  type Experimental_TextBatchV4ItemResult,
  type Experimental_TextBatchV4Request,
  type LanguageModelV4,
  type LanguageModelV4GenerateResult,
} from "@ai-sdk/provider";
import { generateText, Output } from "ai";
import { describe, expect, it } from "vitest";
import { z } from "zod";
import { mockModel } from "@/lib/ai/mock";
import { noThinking, readAiSettings } from "@/lib/ai/models";
import { BatchQueue, batchPrices } from "./batch";

type Run = { id: string; requests: Experimental_TextBatchV4Request[]; polls: number; cancelled: boolean };

/** A batch API in memory. Each test says when a batch ends and what each request gets. */
class FakeBatch implements Experimental_BatchV4 {
  readonly specificationVersion = "v4";
  readonly provider = "fake.batch";
  readonly supportedUrls = {};
  readonly runs: Run[] = [];

  constructor(
    private readonly behavior: {
      start?: () => void;
      status?: (run: Run) => Experimental_BatchV4Status["status"];
      result?: (request: Experimental_TextBatchV4Request, run: Run) => Experimental_TextBatchV4ItemResult;
    } = {},
  ) {}

  async doStartBatch({ requests }: { requests: readonly unknown[] }) {
    this.behavior.start?.();
    const run: Run = {
      id: `b${this.runs.length + 1}`,
      requests: requests as Experimental_TextBatchV4Request[],
      polls: 0,
      cancelled: false,
    };
    this.runs.push(run);
    return { batchId: run.id, status: "pending" as const, warnings: [] };
  }

  async doGetBatchStatus({ batchId }: { batchId: string }) {
    const run = this.find(batchId);
    run.polls++;
    return { status: this.behavior.status?.(run) ?? ("completed" as const) };
  }

  async doGetBatchResults({ batchId }: { batchId: string }) {
    const run = this.find(batchId);
    const result = this.behavior.result ?? succeed;
    return new ReadableStream<Experimental_TextBatchV4ItemResult>({
      start(controller) {
        for (const request of run.requests) controller.enqueue(result(request, run));
        controller.close();
      },
    });
  }

  async doCancelBatch({ batchId }: { batchId: string }) {
    this.find(batchId).cancelled = true;
    return {};
  }

  private find(batchId: string): Run {
    const run = this.runs.find((item) => item.id === batchId);
    if (!run) throw new Error(`no batch ${batchId}`);
    return run;
  }
}

function promptOf(request: Experimental_TextBatchV4Request): string {
  return request.options.prompt
    .map((message) =>
      typeof message.content === "string"
        ? message.content
        : message.content.map((part) => ("text" in part ? part.text : "")).join(""),
    )
    .join("\n");
}

function answer(text: string): LanguageModelV4GenerateResult {
  return {
    content: [{ type: "text", text }],
    finishReason: { unified: "stop", raw: "end_turn" },
    usage: {
      inputTokens: { total: 10, noCache: 10, cacheRead: undefined, cacheWrite: undefined },
      outputTokens: { total: 5, text: 5, reasoning: undefined },
    },
    warnings: [],
  };
}

/** Answers {"n": <the number in the prompt>}. */
function succeed(request: Experimental_TextBatchV4Request): Experimental_TextBatchV4ItemResult {
  const n = Number(promptOf(request).match(/\d+/)?.[0] ?? 0);
  return { type: "text", id: request.id, status: "succeeded", result: answer(JSON.stringify({ n })) };
}

const schema = z.object({ n: z.number() });

/** The real model behind the batch: answers n = 99, so a direct call shows. */
const direct = mockModel(() => JSON.stringify({ n: 99 }), "claude-test");

function ask(queue: BatchQueue, n: number) {
  return generateText({
    model: queue.model(direct),
    output: Output.object({ schema }),
    prompt: `Nombre ${n}`,
    maxRetries: 0,
  });
}

/** A clock the queue's sleeps move forward, so the wait cap can pass in a test. */
function clock(start = 1_000_000): {
  time: () => number;
  now: () => number;
  sleep: (ms: number) => Promise<void>;
} {
  let time = start;
  return {
    time: () => time,
    now: () => time,
    sleep: async (ms) => {
      time += ms;
      await new Promise((resolve) => setTimeout(resolve, 0));
    },
  };
}

const FAST = { gatherMs: 5, pollMs: 10 };

describe("BatchQueue", () => {
  it("answers calls made together from one batch, structured output included", async () => {
    const api = new FakeBatch();
    const queue = new BatchQueue(api, { ...FAST, deadline: Date.now() + 60_000 });
    const [one, two, three] = await Promise.all([ask(queue, 1), ask(queue, 2), ask(queue, 3)]);
    expect([one.output.n, two.output.n, three.output.n]).toEqual([1, 2, 3]);
    expect(api.runs).toHaveLength(1);
    expect(api.runs[0]?.requests).toHaveLength(3);
    expect(api.runs[0]?.requests[0]?.modelId).toBe("claude-test");
    expect(api.runs[0]?.requests[0]?.options.responseFormat).toMatchObject({ type: "json" });
    expect(queue.stats).toEqual({ batches: 1, batched: 3, direct: 0 });
  });

  it("puts a call made after the queue went out in the next batch", async () => {
    const api = new FakeBatch();
    const queue = new BatchQueue(api, { ...FAST, deadline: Date.now() + 60_000 });
    const first = await ask(queue, 1);
    const second = await ask(queue, 2);
    expect([first.output.n, second.output.n]).toEqual([1, 2]);
    expect(api.runs.map((run) => run.requests.length)).toEqual([1, 1]);
  });

  it("waits while the batch is pending", async () => {
    const time = clock();
    const api = new FakeBatch({ status: (run) => (run.polls < 3 ? "pending" : "completed") });
    const queue = new BatchQueue(api, { ...FAST, ...time, deadline: time.time() + 60_000 });
    const result = await ask(queue, 4);
    expect(result.output.n).toBe(4);
    expect(api.runs[0]?.polls).toBe(3);
  });

  it("turns a failed request into the API error a direct call would throw", async () => {
    const api = new FakeBatch({
      result: (request) => ({
        type: "text",
        id: request.id,
        status: "failed",
        error: {
          type: promptOf(request).includes("1") ? "invalid_request_error" : "overloaded_error",
          message: "non",
        },
      }),
    });
    const queue = new BatchQueue(api, { ...FAST, deadline: Date.now() + 60_000 });
    const [bad, busy] = await Promise.allSettled([ask(queue, 1), ask(queue, 2)]);
    expect(bad.status).toBe("rejected");
    expect(busy.status).toBe("rejected");
    const badError = bad.status === "rejected" ? bad.reason : null;
    const busyError = busy.status === "rejected" ? busy.reason : null;
    expect(APICallError.isInstance(badError) && [badError.statusCode, badError.isRetryable]).toEqual([
      400,
      false,
    ]);
    expect(APICallError.isInstance(busyError) && [busyError.statusCode, busyError.isRetryable]).toEqual([
      529,
      true,
    ]);
  });

  it("past the wait cap, cancels the batch and sends what it did not finish to the real model", async () => {
    const time = clock();
    const api = new FakeBatch({
      status: (run) => (run.cancelled ? "completed" : "pending"),
      // The first request was done before the cancel, the second was not.
      result: (request, run) =>
        request.id === run.requests[0]?.id
          ? succeed(request)
          : { type: "text", id: request.id, status: "cancelled" },
    });
    const logs: string[] = [];
    const queue = new BatchQueue(api, {
      ...FAST,
      ...time,
      deadline: time.time() + 100,
      log: (line) => logs.push(line),
    });
    const [one, two] = await Promise.all([ask(queue, 1), ask(queue, 2)]);
    expect([one.output.n, two.output.n]).toEqual([1, 99]);
    expect(api.runs[0]?.cancelled).toBe(true);
    expect(queue.stats).toEqual({ batches: 1, batched: 1, direct: 1 });
    expect(logs.join("\n")).toMatch(/wait cap reached, batch cancelled/);
  });

  it("gives up on a cancelled batch that does not end", async () => {
    const time = clock();
    const api = new FakeBatch({ status: () => "pending" });
    const queue = new BatchQueue(api, {
      ...FAST,
      ...time,
      deadline: time.time() + 100,
      cancelGraceMs: 1000,
    });
    const [one, two] = await Promise.all([ask(queue, 1), ask(queue, 2)]);
    expect([one.output.n, two.output.n]).toEqual([99, 99]);
    expect(queue.stats).toEqual({ batches: 1, batched: 0, direct: 2 });
  });

  it("after the wait cap, sends new calls straight to the real model", async () => {
    const api = new FakeBatch();
    const queue = new BatchQueue(api, { ...FAST, deadline: Date.now() - 1 });
    const result = await ask(queue, 5);
    expect(result.output.n).toBe(99);
    expect(api.runs).toHaveLength(0);
    expect(queue.stats.direct).toBe(1);
  });

  it("sends queued calls to the real model when the wait cap passes before the queue goes out", async () => {
    const time = clock();
    const api = new FakeBatch();
    const queue = new BatchQueue(api, { ...FAST, ...time, deadline: time.time() + 100 });
    const pending = ask(queue, 7);
    await time.sleep(200);
    const result = await pending;
    expect(result.output.n).toBe(99);
    expect(api.runs).toHaveLength(0);
  });

  it("sends the calls to the real model when the batch does not start", async () => {
    const api = new FakeBatch({
      start: () => {
        throw new Error("refused");
      },
    });
    const queue = new BatchQueue(api, { ...FAST, deadline: Date.now() + 60_000 });
    const [one, two] = await Promise.all([ask(queue, 1), ask(queue, 2)]);
    expect([one.output.n, two.output.n]).toEqual([99, 99]);
    expect(queue.stats).toEqual({ batches: 0, batched: 0, direct: 2 });
  });

  it("sends the calls to the real model when the batch fails", async () => {
    const api = new FakeBatch({ status: () => "failed" });
    const queue = new BatchQueue(api, { ...FAST, deadline: Date.now() + 60_000 });
    const result = await ask(queue, 6);
    expect(result.output.n).toBe(99);
    expect(queue.stats).toEqual({ batches: 1, batched: 0, direct: 1 });
  });
});

describe("batchPrices", () => {
  it("halves the prices that are set and leaves the others empty", () => {
    const settings = readAiSettings({
      AI_PROVIDER: "anthropic",
      AI_PRICE_INPUT_PER_MTOK: "3",
      AI_PRICE_OUTPUT_PER_MTOK: "15",
    });
    const halved = batchPrices(settings);
    expect(halved.prices).toEqual({ standard: { inputPerMTok: 1.5, outputPerMTok: 7.5 }, fast: null });
    expect(settings.prices.standard).toEqual({ inputPerMTok: 3, outputPerMTok: 15 });
  });
});

describe("BatchQueue with the Anthropic provider", () => {
  it("sends the request a direct call sends, and reads the results file back", async () => {
    const api = "https://api.anthropic.com/v1/messages";
    const sent: { url: string; method: string; headers: Headers; body: unknown }[] = [];
    let ids: string[] = [];
    const message = {
      id: "msg_1",
      type: "message",
      role: "assistant",
      model: "claude-sonnet-5-5",
      content: [{ type: "text", text: JSON.stringify({ n: 7 }) }],
      stop_reason: "end_turn",
      stop_sequence: null,
      usage: { input_tokens: 10, output_tokens: 5 },
    };
    const batch = (ended: boolean) => ({
      id: "msgbatch_1",
      type: "message_batch",
      processing_status: ended ? "ended" : "in_progress",
      request_counts: {
        processing: ended ? 0 : 1,
        succeeded: ended ? 1 : 0,
        errored: 0,
        canceled: 0,
        expired: 0,
      },
      created_at: "2026-10-22T20:00:00Z",
      expires_at: "2026-10-23T20:00:00Z",
      results_url: ended ? `${api}/batches/msgbatch_1/results` : null,
    });
    const fetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      const method = init?.method ?? "GET";
      const body: unknown = typeof init?.body === "string" ? JSON.parse(init.body) : null;
      sent.push({ url, method, headers: new Headers(init?.headers), body });
      if (method === "POST" && url === api) return Response.json(message);
      if (method === "POST" && url === `${api}/batches`) {
        ids = (body as { requests: { custom_id: string }[] }).requests.map((request) => request.custom_id);
        return Response.json(batch(false));
      }
      if (url === `${api}/batches/msgbatch_1`) return Response.json(batch(true));
      if (url === `${api}/batches/msgbatch_1/results`) {
        const lines = ids.map((id) =>
          JSON.stringify({ custom_id: id, result: { type: "succeeded", message } }),
        );
        return new Response(lines.join("\n"), { headers: { "content-type": "application/x-jsonl" } });
      }
      return new Response("not found", { status: 404 });
    };
    const anthropic = createAnthropic({ apiKey: "sk-test", fetch });
    const call = (model: LanguageModelV4) =>
      generateText({
        model,
        output: Output.object({ schema }),
        instructions: "Répondez en JSON.",
        prompt: "Nombre 7",
        temperature: 0.2,
        maxOutputTokens: 500,
        providerOptions: noThinking(),
        maxRetries: 0,
      });

    const directResult = await call(anthropic("claude-sonnet-5-5"));
    const queue = new BatchQueue(anthropic.experimental_batch(), { ...FAST, deadline: Date.now() + 60_000 });
    const batchResult = await call(queue.model(anthropic("claude-sonnet-5-5")));

    expect(batchResult.output).toEqual(directResult.output);
    expect(batchResult.usage.inputTokens).toBe(10);
    const directBody = sent.find((request) => request.url === api)?.body as Record<string, unknown>;
    const start = sent.find((request) => request.url === `${api}/batches` && request.method === "POST");
    const params = (start?.body as { requests: { params: Record<string, unknown> }[] }).requests[0]?.params;
    // Same model, prompt, schema, output cap and thinking setting as the direct call.
    expect(params).toEqual(directBody);
    expect(JSON.stringify(params)).toMatch(/output_(format|config)/);
    expect(start?.headers.get("x-api-key")).toBe("sk-test");
    expect(start?.headers.get("anthropic-beta") ?? "").toBe(
      sent.find((request) => request.url === api)?.headers.get("anthropic-beta") ?? "",
    );
  });
});
