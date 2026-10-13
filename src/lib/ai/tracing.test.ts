import { describe, expect, it, vi } from "vitest";
import type { ReadableSpan, SpanProcessor } from "@opentelemetry/sdk-trace-base";
import { AiSpanFilter, isAiSpan, parseOtlpHeaders, tracingDestination, withDraftSpan } from "./tracing";

describe("tracingDestination", () => {
  it("is off unless AI_TRACING is on", () => {
    expect(tracingDestination({ LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" })).toBeNull();
    expect(
      tracingDestination({ AI_TRACING: "false", OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example" }),
    ).toBeNull();
  });

  it("sends to Langfuse Cloud EU with basic auth by default", () => {
    expect(
      tracingDestination({ AI_TRACING: "true", LANGFUSE_PUBLIC_KEY: "pk-1", LANGFUSE_SECRET_KEY: "sk-1" }),
    ).toEqual({
      url: "https://cloud.langfuse.com/api/public/otel/v1/traces",
      headers: { Authorization: `Basic ${Buffer.from("pk-1:sk-1").toString("base64")}` },
    });
  });

  it("uses another Langfuse host when set, and refuses plain http outside localhost", () => {
    const keys = { AI_TRACING: "true", LANGFUSE_PUBLIC_KEY: "pk", LANGFUSE_SECRET_KEY: "sk" };
    expect(tracingDestination({ ...keys, LANGFUSE_BASE_URL: "https://langfuse.kolab.example/" })?.url).toBe(
      "https://langfuse.kolab.example/api/public/otel/v1/traces",
    );
    expect(tracingDestination({ ...keys, LANGFUSE_BASE_URL: "http://localhost:3001" })?.url).toBe(
      "http://localhost:3001/api/public/otel/v1/traces",
    );
    expect(tracingDestination({ ...keys, LANGFUSE_BASE_URL: "http://langfuse.example" })).toBeNull();
  });

  it("falls back to the standard OTLP variables", () => {
    expect(
      tracingDestination({
        AI_TRACING: "1",
        OTEL_EXPORTER_OTLP_ENDPOINT: "https://otel.example/",
        OTEL_EXPORTER_OTLP_HEADERS: "x-api-key=abc,x-team=kolab%20bj",
      }),
    ).toEqual({
      url: "https://otel.example/v1/traces",
      headers: { "x-api-key": "abc", "x-team": "kolab bj" },
    });
    expect(
      tracingDestination({
        AI_TRACING: "true",
        OTEL_EXPORTER_OTLP_TRACES_ENDPOINT: "https://otel.example/traces",
      })?.url,
    ).toBe("https://otel.example/traces");
  });

  it("has nowhere to send without keys or endpoint", () => {
    expect(tracingDestination({ AI_TRACING: "true" })).toBeNull();
  });
});

describe("parseOtlpHeaders", () => {
  it("skips malformed pairs", () => {
    expect(parseOtlpHeaders("a=1,,=2,b,c = 3")).toEqual({ a: "1", c: "3" });
    expect(parseOtlpHeaders(undefined)).toEqual({});
  });
});

describe("AiSpanFilter", () => {
  it("passes only AI spans to the exporting processor", () => {
    const inner = {
      onStart: vi.fn(),
      onEnd: vi.fn(),
      forceFlush: vi.fn(),
      shutdown: vi.fn(),
    } satisfies SpanProcessor;
    const filter = new AiSpanFilter(inner);
    for (const name of [
      "kolab.ai.draft",
      "ai.streamObject",
      "ai.streamObject.doStream",
      "GET /fr",
      "fetch POST",
    ]) {
      filter.onEnd({ name } as ReadableSpan);
    }
    expect(inner.onEnd.mock.calls.map(([span]) => (span as ReadableSpan).name)).toEqual([
      "kolab.ai.draft",
      "ai.streamObject",
      "ai.streamObject.doStream",
    ]);
    expect(isAiSpan("aide")).toBe(false);
  });
});

describe("withDraftSpan", () => {
  it("runs the work and gives no trace id when tracing isn't registered", async () => {
    const result = await withDraftSpan({ "kolab.generation_id": "g1" }, async (span) => {
      span.set({ "kolab.status": "succeeded" });
      span.fail("timeout");
      return span.traceId;
    });
    expect(result).toBeNull();
  });
});
