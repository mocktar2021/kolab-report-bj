import { browserSentryOptions } from "./options";

// Sentry in the browser (KRB-136), loaded on demand. Imported statically, the
// SDK added about 70 kB to the JavaScript every page loads, even with
// Sentry off. Here the import sits behind the DSN inlined at build time:
// without one the build drops it, and with one it comes in its own file once
// the page has started.

type SentryModule = typeof import("@sentry/nextjs");

let loaded: SentryModule | null = null;
let loading: Promise<SentryModule | null> | undefined;

/** Loads and starts Sentry once. Resolves to null while Sentry is off. */
export function loadBrowserSentry(): Promise<SentryModule | null> {
  // Read literally, so the build can see the value and drop the import.
  if (!process.env.NEXT_PUBLIC_SENTRY_DSN) return Promise.resolve(null);
  loading ??= import("@sentry/nextjs")
    .then((sentry) => {
      const options = browserSentryOptions();
      if (!options) return null;
      sentry.init(options);
      loaded = sentry;
      return sentry;
    })
    .catch(() => null);
  return loading;
}

/** Sentry if it has loaded, else null. Never starts the load. */
export function loadedBrowserSentry(): SentryModule | null {
  return loaded;
}
