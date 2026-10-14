import type { init } from "@sentry/nextjs";
import { scrubBreadcrumb, scrubEvent, scrubSpan } from "./scrub";

type SentryOptions = NonNullable<Parameters<typeof init>[0]>;

// Sentry error monitoring (KRB-136). All three values are inlined at build
// time: the DSN from the environment, the release and the environment from
// next.config.mjs (./release.mjs). Without a DSN, Sentry stays off: nothing
// initializes and nothing is sent. Setup: docs/operations/monitoring.md.
const DSN = process.env.NEXT_PUBLIC_SENTRY_DSN?.trim() || undefined;
const RELEASE = process.env.NEXT_PUBLIC_SENTRY_RELEASE || undefined;
const ENVIRONMENT = process.env.NEXT_PUBLIC_SENTRY_ENVIRONMENT || "development";

// SDK v11 replaced sendDefaultPii with these categories, and collects most of
// them unless told not to. Everything is off here, so the scrubber in
// ./scrub.ts is a second line, not the only one.
const dataCollection: SentryOptions["dataCollection"] = {
  userInfo: false,
  cookies: false,
  httpHeaders: { request: { allow: ["user-agent", "content-type"] }, response: false },
  httpBodies: [],
  urlQueryParams: false,
  graphQL: { document: false, variables: false },
  genAI: { inputs: false, outputs: false },
  databaseQueryData: false,
  queues: false,
  stackFrameVariables: false,
};

function commonOptions(dsn: string): SentryOptions {
  return {
    dsn,
    release: RELEASE,
    environment: ENVIRONMENT,
    // Every error is sent.
    sampleRate: 1,
    dataCollection,
    beforeSend: scrubEvent,
    beforeBreadcrumb: scrubBreadcrumb,
    beforeSendSpan: scrubSpan,
    // Errors only: no Sentry Logs or Metrics, even if a library emits some.
    beforeSendLog: () => null,
    beforeSendMetric: () => null,
  };
}

/**
 * For src/instrumentation-client.ts, or undefined to leave Sentry off. No
 * Session Replay, no feedback widget and no profiling: none of their
 * integrations is added.
 */
export function browserSentryOptions(): SentryOptions | undefined {
  if (!DSN) return undefined;
  return {
    ...commonOptions(DSN),
    // Page loads and navigations, 1 in 10 in production, none elsewhere.
    tracesSampleRate: ENVIRONMENT === "production" ? 0.1 : 0,
  };
}

/** For the Node.js and Edge runtimes (src/instrumentation.ts), or undefined to leave Sentry off. */
export function serverSentryOptions(): SentryOptions | undefined {
  if (!DSN) return undefined;
  return {
    ...commonOptions(DSN),
    // Errors only on the server: no tracesSampleRate, so no server spans.
    // enableOpenTelemetrySetup: false is v11's name for v10's
    // skipOpenTelemetrySetup: true. Without it @sentry/nextjs registers its
    // own OpenTelemetry tracer provider, and the AI tracing of
    // src/lib/ai/tracing.ts (AI_TRACING=true) could no longer register the
    // one that exports AI spans. Sentry keeps requests apart with
    // AsyncLocalStorage, so errors still get the right user id without it.
    enableOpenTelemetrySetup: false,
  };
}
