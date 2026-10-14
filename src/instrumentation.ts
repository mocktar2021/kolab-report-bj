import * as Sentry from "@sentry/nextjs";
import { forwardedRequestId } from "./lib/log/request-id";
import { serverSentryOptions } from "./lib/monitoring/options";

// Runs once when the server starts (Next.js instrumentation hook), on the
// Node.js and the Edge runtime. Sentry reports errors on both, only when
// NEXT_PUBLIC_SENTRY_DSN is set (src/lib/monitoring/options.ts). Tracing of
// AI calls is registered on the Node.js runtime only, and only when
// AI_TRACING is on (src/lib/ai/tracing.ts). Sentry does not register an
// OpenTelemetry tracer provider, so the two do not overlap.
export async function register() {
  const sentryOptions = serverSentryOptions();
  if (sentryOptions) Sentry.init(sentryOptions);

  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { registerTracing } = await import("./lib/ai/tracing");
  await registerTracing();
}

// Errors of server components, route handlers, server actions and the
// middleware, tagged with the request id their log lines carry (KRB-138).
// Does nothing while Sentry is off.
export const onRequestError: typeof Sentry.captureRequestError = (error, request, context) => {
  const requestId = forwardedRequestId({
    get: (name) => [request.headers[name]].flat()[0] ?? null,
  });
  Sentry.withScope((scope) => {
    if (requestId) scope.setTag("request_id", requestId);
    Sentry.captureRequestError(error, request, context);
  });
};
