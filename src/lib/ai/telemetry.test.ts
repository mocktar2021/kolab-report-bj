import { AsyncLocalStorage } from "node:async_hooks";
import { afterEach, describe, expect, it } from "vitest";
import { context, ROOT_CONTEXT, trace, type Context, type ContextManager } from "@opentelemetry/api";
import {
  BasicTracerProvider,
  InMemorySpanExporter,
  SimpleSpanProcessor,
} from "@opentelemetry/sdk-trace-base";
import { generateText } from "ai";
import { mockModel } from "./mock";
import { aiTelemetry } from "./telemetry";
import { isAiSpan, withDraftSpan } from "./tracing";

// What @vercel/otel registers in the app: the active span follows async calls.
class AsyncContextManager implements ContextManager {
  private readonly storage = new AsyncLocalStorage<Context>();

  active(): Context {
    return this.storage.getStore() ?? ROOT_CONTEXT;
  }

  with<A extends unknown[], F extends (...args: A) => ReturnType<F>>(
    active: Context,
    fn: F,
    thisArg?: ThisParameterType<F>,
    ...args: A
  ): ReturnType<F> {
    return this.storage.run(active, () => fn.call(thisArg, ...args));
  }

  bind<T>(_active: Context, target: T): T {
    return target;
  }

  enable(): this {
    return this;
  }

  disable(): this {
    this.storage.disable();
    return this;
  }
}

const TRACING_ON = { enabled: true, recordContent: false, urlTemplate: null };
const TRACING_OFF = { enabled: false, recordContent: false, urlTemplate: null };

function registerProvider(): InMemorySpanExporter {
  const exporter = new InMemorySpanExporter();
  context.setGlobalContextManager(new AsyncContextManager());
  trace.setGlobalTracerProvider(
    new BasicTracerProvider({ spanProcessors: [new SimpleSpanProcessor(exporter)] }),
  );
  return exporter;
}

describe("aiTelemetry (KRB-225)", () => {
  afterEach(() => {
    trace.disable();
    context.disable();
  });

  it("puts the AI SDK spans under the generation's trace, without the prompt", async () => {
    const exporter = registerProvider();
    const traceId = await withDraftSpan({ "kolab.generation_id": "g1" }, async (span) => {
      await generateText({
        model: mockModel(() => "Résumé du livrable."),
        prompt: "Texte confidentiel du livrable",
        telemetry: aiTelemetry(TRACING_ON, "kolab.summary"),
      });
      return span.traceId;
    });

    const spans = exporter.getFinishedSpans();
    const sdkSpans = spans.filter((span) => span.instrumentationScope.name !== "kolab-report");
    expect(sdkSpans.map((span) => span.name)).toEqual(["chat mock", "step 1", "invoke_agent mock"]);
    for (const span of sdkSpans) {
      // Exported by AiSpanFilter, in the generation's trace.
      expect(isAiSpan(span)).toBe(true);
      expect(span.spanContext().traceId).toBe(traceId);
      expect(JSON.stringify(span.attributes)).not.toContain("Texte confidentiel");
      expect(JSON.stringify(span.attributes)).not.toContain("Résumé du livrable");
    }
    const operation = sdkSpans.find((span) => span.name === "invoke_agent mock");
    expect(operation?.attributes["gen_ai.agent.name"]).toBe("kolab.summary");
    expect(operation?.attributes["gen_ai.usage.output_tokens"]).toBeGreaterThan(0);
  });

  it("sends no span when tracing is off, nor for a call that doesn't ask for one", async () => {
    const exporter = registerProvider();
    expect(aiTelemetry(TRACING_OFF, "kolab.summary")).toEqual({ isEnabled: false });
    await generateText({
      model: mockModel(() => "Réponse."),
      prompt: "Texte",
      telemetry: aiTelemetry(TRACING_OFF, "kolab.summary"),
    });
    // The plan reading passes no telemetry: no integration is registered for the process.
    await generateText({ model: mockModel(() => "Réponse."), prompt: "Texte" });
    expect(exporter.getFinishedSpans()).toEqual([]);
  });
});
