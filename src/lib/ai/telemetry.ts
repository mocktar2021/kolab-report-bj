import { OpenTelemetry } from "@ai-sdk/otel";
import { trace } from "@opentelemetry/api";
import type { TelemetryOptions } from "ai";
import type { AiSettings } from "./models";
import { AI_SDK_TRACER } from "./tracing";

// AI SDK 7 emits its spans only through an integration from @ai-sdk/otel
// (KRB-225). It is passed per call instead of registered for the whole
// process: a registered integration traces every call and records prompts by
// default, so a call without these options, such as the plan reading, would
// start sending spans. The spans use the tracer provider that tracing.ts
// registers, and land under the generation's trace.

/** Telemetry of one AI SDK call. Prompts and outputs stay out unless AI_TRACE_CONTENT is on. */
export function aiTelemetry(tracing: AiSettings["tracing"], functionId: string): TelemetryOptions {
  if (!tracing.enabled) return { isEnabled: false };
  return {
    isEnabled: true,
    recordInputs: tracing.recordContent,
    recordOutputs: tracing.recordContent,
    functionId,
    integrations: new OpenTelemetry({ tracer: trace.getTracer(AI_SDK_TRACER) }),
  };
}
