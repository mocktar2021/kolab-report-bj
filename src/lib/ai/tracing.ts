import {
  isSpanContextValid,
  SpanStatusCode,
  trace,
  type Attributes,
  type Context,
  type Span,
} from "@opentelemetry/api";
import type { ReadableSpan, SpanExporter, SpanProcessor } from "@opentelemetry/sdk-trace-base";

// Traces of AI calls (Story KRB-17). With AI_TRACING=true, src/instrumentation.ts
// registers OpenTelemetry and sends spans over OTLP: to Langfuse when its
// keys are set, else to OTEL_EXPORTER_OTLP_ENDPOINT. Each generation is one
// trace: a "kolab.ai.draft" root span with prompt version, model, tokens,
// latency, cost and error, and the AI SDK's spans below it. Only these
// spans leave the server, not the app's other requests. Prompt and output
// text stay out unless AI_TRACE_CONTENT=true (it needs a DPA with the vendor).

type Env = Record<string, string | undefined>;

export type TracingDestination = { url: string; headers: Record<string, string> };

const LANGFUSE_CLOUD_EU = "https://cloud.langfuse.com";

function isOn(value: string | undefined): boolean {
  return value === "true" || value === "1";
}

/** "key=value,key2=value2", the format of OTEL_EXPORTER_OTLP_HEADERS. */
export function parseOtlpHeaders(value: string | undefined): Record<string, string> {
  const headers: Record<string, string> = {};
  for (const pair of (value ?? "").split(",")) {
    const at = pair.indexOf("=");
    if (at <= 0) continue;
    const name = pair.slice(0, at).trim();
    const headerValue = decodeURIComponent(pair.slice(at + 1).trim());
    if (name) headers[name] = headerValue;
  }
  return headers;
}

/** Where spans go, or null when tracing is off or has nowhere to go. */
export function tracingDestination(env: Env): TracingDestination | null {
  if (!isOn(env.AI_TRACING)) return null;
  const publicKey = env.LANGFUSE_PUBLIC_KEY?.trim();
  const secretKey = env.LANGFUSE_SECRET_KEY?.trim();
  if (publicKey && secretKey) {
    const base = (env.LANGFUSE_BASE_URL?.trim() || LANGFUSE_CLOUD_EU).replace(/\/+$/, "");
    if (!/^https:\/\//.test(base) && !/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/.test(base)) return null;
    const credentials = Buffer.from(`${publicKey}:${secretKey}`).toString("base64");
    return {
      url: `${base}/api/public/otel/v1/traces`,
      headers: { Authorization: `Basic ${credentials}` },
    };
  }
  const endpoint = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim() || env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint) return null;
  const url = env.OTEL_EXPORTER_OTLP_TRACES_ENDPOINT?.trim()
    ? endpoint
    : `${endpoint.replace(/\/+$/, "")}/v1/traces`;
  return { url, headers: parseOtlpHeaders(env.OTEL_EXPORTER_OTLP_HEADERS) };
}

/** Spans of AI calls: ours and the AI SDK's. */
export function isAiSpan(name: string): boolean {
  return name.startsWith("kolab.ai") || name.startsWith("ai.");
}

/** Passes only AI spans to the exporting processor. */
export class AiSpanFilter implements SpanProcessor {
  constructor(private readonly inner: SpanProcessor) {}

  onStart(span: Parameters<SpanProcessor["onStart"]>[0], parentContext: Context): void {
    if (isAiSpan(span.name)) this.inner.onStart(span, parentContext);
  }

  onEnd(span: ReadableSpan): void {
    if (isAiSpan(span.name)) this.inner.onEnd(span);
  }

  forceFlush(): Promise<void> {
    return this.inner.forceFlush();
  }

  shutdown(): Promise<void> {
    return this.inner.shutdown();
  }
}

// Next.js bundles src/instrumentation.ts apart from the routes, so each
// bundle gets its own copy of this module. The flag lives on globalThis and
// the routes read the state from the span, not from a module variable.
const REGISTERED = Symbol.for("kolab.ai.tracing.registered");
const state = globalThis as typeof globalThis & { [REGISTERED]?: boolean };

/** Called once from src/instrumentation.ts, on the Node.js runtime. */
export async function registerTracing(env: Env = process.env): Promise<boolean> {
  if (state[REGISTERED]) return true;
  const destination = tracingDestination(env);
  if (!destination) {
    if (isOn(env.AI_TRACING))
      console.warn("ai tracing: AI_TRACING is on but no Langfuse keys or OTLP endpoint are set");
    return false;
  }
  const [{ registerOTel, OTLPHttpProtoTraceExporter }, { BatchSpanProcessor }] = await Promise.all([
    import("@vercel/otel"),
    import("@opentelemetry/sdk-trace-base"),
  ]);
  const exporter: SpanExporter = new OTLPHttpProtoTraceExporter(destination);
  registerOTel({
    serviceName: "kolab-report",
    attributes: { "deployment.environment": env.APP_ENV ?? env.VERCEL_ENV ?? "development" },
    // No automatic instrumentation: only the spans below are exported.
    instrumentations: [],
    spanProcessors: [new AiSpanFilter(new BatchSpanProcessor(exporter))],
  });
  state[REGISTERED] = true;
  return true;
}

export type DraftSpan = {
  /** The trace id when tracing is on, for the generation row. */
  traceId: string | null;
  set(attributes: Attributes): void;
  fail(errorCode: string): void;
};

/**
 * Runs `work` inside a new trace for one generation. The AI SDK's spans
 * started in `work` become its children. Without tracing, the API's no-op
 * tracer makes this free. `name` starts with "kolab.ai" so the span is
 * exported: "kolab.ai.template_writer" for "Rédiger avec l'IA" (KRB-198).
 */
export async function withDraftSpan<T>(
  attributes: Attributes,
  work: (span: DraftSpan) => Promise<T>,
  name: `kolab.ai.${string}` = "kolab.ai.draft",
): Promise<T> {
  const tracer = trace.getTracer("kolab-report");
  return tracer.startActiveSpan(name, { root: true, attributes }, async (span: Span) => {
    const spanContext = span.spanContext();
    const draftSpan: DraftSpan = {
      // The no-op tracer used without tracing gives a span that doesn't record.
      traceId: span.isRecording() && isSpanContextValid(spanContext) ? spanContext.traceId : null,
      set: (more) => span.setAttributes(more),
      fail: (errorCode) => {
        span.setAttribute("kolab.error_code", errorCode);
        span.setStatus({ code: SpanStatusCode.ERROR, message: errorCode });
      },
    };
    try {
      return await work(draftSpan);
    } finally {
      span.end();
    }
  });
}

/** Sends the spans still waiting, before a serverless function is frozen. */
export async function flushTraces(): Promise<void> {
  if (!state[REGISTERED]) return;
  const provider = trace.getTracerProvider() as { getDelegate?: () => unknown };
  const delegate = (provider.getDelegate?.() ?? provider) as { forceFlush?: () => Promise<void> };
  await delegate.forceFlush?.().catch(() => undefined);
}
