import {
  APICallError,
  type Experimental_BatchV4,
  type Experimental_BatchV4Error,
  type Experimental_BatchV4Status,
  type Experimental_TextBatchV4Request,
  type LanguageModelV4,
  type LanguageModelV4CallOptions,
  type LanguageModelV4GenerateResult,
} from "@ai-sdk/provider";
import type { AiSettings } from "@/lib/ai/models";

// Sends the eval's model calls through the provider's batch API, at half
// price on Anthropic (KRB-229). BatchQueue.model() stands in for a real
// model: each call waits in a queue, and after a short quiet spell the queue
// goes out as one batch. Each result goes back to its caller as the real
// model would have returned it, so generateText still checks the structured
// output, and the runner still repairs and judges as with the standard API.
// A runner waiting on a batch uses Actions minutes: past the deadline the
// open batch is cancelled, and what it did not finish goes to the real model.

export type BatchQueueOptions = {
  /** Clock time (ms) after which no call waits for a batch. */
  deadline: number;
  /** Quiet spell after the last call before the queue goes out. */
  gatherMs?: number;
  /** The queue goes out at the latest this long after its first call. */
  maxGatherMs?: number;
  /** Time between two status checks. */
  pollMs?: number;
  /** How long a cancelled batch gets to end before its calls go to the real model. */
  cancelGraceMs?: number;
  log?: (line: string) => void;
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
};

export type BatchStats = {
  batches: number;
  /** Calls answered by a batch. */
  batched: number;
  /** Calls a batch answered with an error, given back to the caller as an API error. */
  failed: number;
  /** Calls sent to the real model: past the deadline, or after a batch problem. */
  direct: number;
};

type Pending = {
  id: string;
  direct: LanguageModelV4;
  call: LanguageModelV4CallOptions;
  resolve: (result: LanguageModelV4GenerateResult) => void;
  reject: (error: unknown) => void;
};

/** HTTP status of an Anthropic error type, so generateText retries what it would retry. */
const ERROR_STATUS: Record<string, number> = {
  invalid_request_error: 400,
  authentication_error: 401,
  billing_error: 402,
  permission_error: 403,
  not_found_error: 404,
  request_too_large: 413,
  rate_limit_error: 429,
  api_error: 500,
  overloaded_error: 529,
};

/** The call options a batch request carries. Headers and the abort signal stay out. */
function batchOptions(call: LanguageModelV4CallOptions): Experimental_TextBatchV4Request["options"] {
  return {
    prompt: call.prompt,
    maxOutputTokens: call.maxOutputTokens,
    temperature: call.temperature,
    stopSequences: call.stopSequences,
    topP: call.topP,
    topK: call.topK,
    presencePenalty: call.presencePenalty,
    frequencyPenalty: call.frequencyPenalty,
    seed: call.seed,
    reasoning: call.reasoning,
    responseFormat: call.responseFormat,
    toolChoice: call.toolChoice,
    tools: call.tools,
    providerOptions: call.providerOptions,
  };
}

function itemError(error: Experimental_BatchV4Error, batchId: string, id: string): APICallError {
  const type = error.type ?? error.code ?? "error";
  return new APICallError({
    message: `Batch request failed: ${type}: ${error.message}`,
    url: `batch:${batchId}`,
    requestBodyValues: { batchId, requestId: id },
    statusCode: error.statusCode ?? ERROR_STATUS[type] ?? 500,
  });
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : String(error).slice(0, 300);
}

function minutes(ms: number): string {
  return `${(ms / 60_000).toFixed(1)} min`;
}

export class BatchQueue {
  readonly stats: BatchStats = { batches: 0, batched: 0, failed: 0, direct: 0 };
  private queue: Pending[] = [];
  private timer: ReturnType<typeof setTimeout> | null = null;
  private firstQueuedAt = 0;
  private count = 0;
  private readonly gatherMs: number;
  private readonly maxGatherMs: number;
  private readonly pollMs: number;
  private readonly cancelGraceMs: number;
  private readonly log: (line: string) => void;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;

  constructor(
    private readonly api: Experimental_BatchV4,
    private readonly options: BatchQueueOptions,
  ) {
    this.gatherMs = options.gatherMs ?? 2000;
    this.maxGatherMs = options.maxGatherMs ?? 10_000;
    this.pollMs = options.pollMs ?? 15_000;
    this.cancelGraceMs = options.cancelGraceMs ?? 120_000;
    this.log = options.log ?? (() => {});
    this.now = options.now ?? Date.now;
    this.sleep = options.sleep ?? ((ms) => new Promise((resolve) => setTimeout(resolve, ms)));
  }

  /** A model that answers through the batch queue, and falls back to `direct`. */
  model(direct: LanguageModelV4): LanguageModelV4 {
    return {
      specificationVersion: "v4",
      provider: direct.provider,
      modelId: direct.modelId,
      supportedUrls: direct.supportedUrls,
      doGenerate: (call) => this.enqueue(direct, call),
      doStream: () => Promise.reject(new Error("A batch model does not stream.")),
    };
  }

  private enqueue(direct: LanguageModelV4, call: LanguageModelV4CallOptions) {
    if (this.now() >= this.options.deadline) {
      this.stats.direct++;
      return direct.doGenerate(call);
    }
    return new Promise<LanguageModelV4GenerateResult>((resolve, reject) => {
      const now = this.now();
      if (this.queue.length === 0) this.firstQueuedAt = now;
      this.queue.push({ id: `r${++this.count}`, direct, call, resolve, reject });
      if (this.timer) clearTimeout(this.timer);
      const wait = Math.max(0, Math.min(this.gatherMs, this.firstQueuedAt + this.maxGatherMs - now));
      this.timer = setTimeout(() => this.flush(), wait);
    });
  }

  private flush(): void {
    this.timer = null;
    const items = this.queue.splice(0);
    if (items.length === 0) return;
    // The wait cap passed while these waited: a new batch would only be cancelled.
    if (this.now() >= this.options.deadline) {
      this.sendDirect(items);
      return;
    }
    void this.run(items).catch((error: unknown) => {
      // A bug here would leave the runner waiting forever: answer directly instead.
      this.log(`Batch queue error (${messageOf(error)}): ${items.length} call(s) sent directly.`);
      this.sendDirect(items);
    });
  }

  private sendDirect(items: readonly Pending[]): void {
    for (const item of items) {
      this.stats.direct++;
      Promise.resolve(item.direct.doGenerate(item.call)).then(item.resolve, item.reject);
    }
  }

  private async run(items: Pending[]): Promise<void> {
    const startedAt = this.now();
    let batchId: string;
    let status: Experimental_BatchV4Status;
    try {
      const started = await this.api.doStartBatch({
        requests: items.map((item) => ({
          id: item.id,
          type: "text" as const,
          modelId: item.direct.modelId,
          options: batchOptions(item.call),
        })),
      });
      batchId = started.batchId;
      status = started;
      // Each request repeats the same warnings (a setting the model ignores): once each is enough.
      const warnings = new Map<string, number>();
      for (const { warning } of started.warnings) {
        const text = "details" in warning && warning.details ? warning.details : JSON.stringify(warning);
        warnings.set(text, (warnings.get(text) ?? 0) + 1);
      }
      for (const [text, count] of warnings) this.log(`Batch warning (${count} call(s)): ${text}`);
    } catch (error) {
      this.log(`Batch not started (${messageOf(error)}): ${items.length} call(s) sent directly.`);
      this.sendDirect(items);
      return;
    }
    this.stats.batches++;
    this.log(`Batch ${batchId}: ${items.length} call(s) sent.`);

    let cancelledAt: number | null = null;
    while (status.status === "pending") {
      if (cancelledAt === null && this.now() >= this.options.deadline) {
        cancelledAt = this.now();
        try {
          if (!this.api.doCancelBatch) throw new Error("no cancellation");
          await this.api.doCancelBatch({ batchId });
          this.log(`Batch ${batchId}: wait cap reached, batch cancelled.`);
        } catch (error) {
          this.log(`Batch ${batchId}: wait cap reached, cancel failed (${messageOf(error)}).`);
          cancelledAt = -Infinity;
        }
      }
      if (cancelledAt !== null && this.now() - cancelledAt >= this.cancelGraceMs) {
        this.log(
          `Batch ${batchId}: still running after the wait cap, ${items.length} call(s) sent directly.`,
        );
        this.sendDirect(items);
        return;
      }
      await this.sleep(this.pollMs);
      try {
        status = await this.api.doGetBatchStatus({ batchId });
      } catch (error) {
        // A failed status check is tried again at the next poll; the deadline bounds the wait.
        this.log(`Batch ${batchId}: status check failed (${messageOf(error)}).`);
      }
    }
    if (status.status === "failed") {
      this.log(
        `Batch ${batchId} failed (${status.error?.message ?? status.rawStatus ?? "no reason"}): ${items.length} call(s) sent directly.`,
      );
      this.sendDirect(items);
      return;
    }

    const byId = new Map(items.map((item) => [item.id, item]));
    const settle: (() => void)[] = [];
    const retry: Pending[] = [];
    let answered = 0;
    let failed = 0;
    const reader = (await this.api.doGetBatchResults({ batchId })).getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      const item = byId.get(value.id);
      if (!item || value.type !== "text") continue;
      byId.delete(value.id);
      if (value.status === "succeeded") {
        const result = value.result;
        answered++;
        settle.push(() => item.resolve(result));
      } else if (value.status === "failed") {
        const error = itemError(value.error, batchId, value.id);
        failed++;
        this.log(`Batch ${batchId}: call ${value.id} failed: ${error.message}`);
        settle.push(() => item.reject(error));
      } else {
        // Cancelled at the wait cap, or expired.
        retry.push(item);
      }
    }
    retry.push(...byId.values());
    this.stats.batched += answered;
    this.stats.failed += failed;
    this.log(
      `Batch ${batchId}: ended in ${minutes(this.now() - startedAt)}, ${answered} answered${
        failed > 0 ? `, ${failed} failed` : ""
      }${retry.length > 0 ? `, ${retry.length} sent directly` : ""}.`,
    );
    // All at once, so the cases go on together and their next calls share a batch.
    for (const done of settle) done();
    this.sendDirect(retry);
  }
}

/** The settings with every price halved: what the Batch API charges, for the cost estimates. */
export function batchPrices(settings: AiSettings): AiSettings {
  const half = (price: AiSettings["prices"]["standard"]) =>
    price && { inputPerMTok: price.inputPerMTok / 2, outputPerMTok: price.outputPerMTok / 2 };
  return {
    ...settings,
    prices: { standard: half(settings.prices.standard), fast: half(settings.prices.fast) },
  };
}
