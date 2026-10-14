import { loadBrowserSentry, loadedBrowserSentry } from "@/lib/monitoring/browser";

// Runs in the browser before the app starts (KRB-136). Sentry reports
// browser errors only when NEXT_PUBLIC_SENTRY_DSN is set, and loads after
// this file (src/lib/monitoring/browser.ts). Errors thrown before it is
// ready are kept and sent once it is. Events go to /monitoring on this
// origin (tunnelRoute in next.config.mjs), which passes them on to Sentry.
if (process.env.NEXT_PUBLIC_SENTRY_DSN) {
  const early: unknown[] = [];
  const onError = (event: ErrorEvent) => early.push(event.error ?? event.message);
  const onRejection = (event: PromiseRejectionEvent) => early.push(event.reason);
  window.addEventListener("error", onError);
  window.addEventListener("unhandledrejection", onRejection);

  void loadBrowserSentry().then((sentry) => {
    window.removeEventListener("error", onError);
    window.removeEventListener("unhandledrejection", onRejection);
    for (const error of early) sentry?.captureException(error);
  });
}

type RouterTransitionArgs = Parameters<typeof import("@sentry/nextjs").captureRouterTransitionStart>;

// Names page navigations for tracing, once Sentry has loaded.
export function onRouterTransitionStart(...args: RouterTransitionArgs) {
  loadedBrowserSentry()?.captureRouterTransitionStart(...args);
}
