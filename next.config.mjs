import withPWAInit from "@ducanh2912/next-pwa";
import { withSentryConfig } from "@sentry/nextjs/config";
import createNextIntlPlugin from "next-intl/plugin";
import { canUploadSourceMaps, sentryEnvironment, sentryRelease } from "./src/lib/monitoring/release.mjs";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "";
const isDev = process.env.NODE_ENV === "development";
// Set by Vercel at build time: "preview" for PR and staging deployments.
const isVercelPreview = process.env.VERCEL_ENV === "preview";

// Sentry (KRB-136): fixed at build time so the browser, server and edge
// bundles report the same release and environment (src/lib/monitoring).
const sentry = {
  release: sentryRelease(process.env),
  environment: sentryEnvironment(process.env),
  uploadSourceMaps: canUploadSourceMaps(process.env),
};

/**
 * Content-Security-Policy for every page. Scripts stay limited to this origin
 * (plus inline ones: Next.js, the theme and sidebar scripts), data only goes
 * to this origin and Supabase, and no other site can frame the app.
 */
function contentSecurityPolicy() {
  const supabase = supabaseUrl ? new URL(supabaseUrl) : null;
  const supabaseOrigin = supabase ? supabase.origin : "";
  const supabaseSocket = supabase
    ? `${supabase.protocol === "https:" ? "wss:" : "ws:"}//${supabase.host}`
    : "";
  // The Vercel toolbar on preview deployments (comments, feedback).
  const toolbar = isVercelPreview ? "https://vercel.live" : "";

  const directives = {
    "default-src": ["'self'"],
    // Next.js inlines its bootstrap scripts. Nonces would need every page to
    // render per request, including the static landing and sign-in pages.
    "script-src": ["'self'", "'unsafe-inline'", isDev ? "'unsafe-eval'" : "", toolbar],
    "style-src": ["'self'", "'unsafe-inline'", toolbar],
    "img-src": [
      "'self'",
      "data:",
      "blob:",
      supabaseOrigin,
      toolbar,
      isVercelPreview ? "https://vercel.com" : "",
    ],
    "font-src": ["'self'", toolbar, isVercelPreview ? "https://assets.vercel.com" : ""],
    "connect-src": [
      "'self'",
      supabaseOrigin,
      supabaseSocket,
      toolbar,
      isVercelPreview ? "wss://ws-us3.pusher.com" : "",
    ],
    "frame-src": [toolbar || "'none'"],
    "worker-src": ["'self'"],
    "manifest-src": ["'self'"],
    "object-src": ["'none'"],
    "base-uri": ["'self'"],
    "form-action": ["'self'"],
    "frame-ancestors": ["'none'"],
  };

  const policy = Object.entries(directives).map(
    ([name, sources]) => `${name} ${sources.filter(Boolean).join(" ")}`,
  );
  // Only over HTTPS: on http://localhost it would break every request.
  if (appUrl.startsWith("https://")) policy.push("upgrade-insecure-requests");
  return policy.join("; ");
}

const withPWA = withPWAInit({
  dest: "public",
  // UpdateBanner (src/components/pwa) registers the service worker itself, so
  // it listens for a waiting version before registering (KRB-156).
  register: false,
  // The service worker is disabled in dev unless explicitly requested,
  // otherwise stale caches make local development painful.
  disable: process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_PWA_ENABLE_IN_DEV !== "true",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  // Reloading every page when the network comes back would throw away text
  // being edited. Only the offline page reloads itself (ReloadWhenOnline).
  reloadOnOnline: false,
  cacheStartUrl: true,
  dynamicStartUrl: true,
  fallbacks: {
    // Served when a navigation fails and the page is not in cache.
    document: "/fr/hors-ligne",
  },
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    disableDevLogs: true,
    // A new version installs, then waits: open pages keep the code they
    // started with. "Mettre à jour" in UpdateBanner sends SKIP_WAITING, and
    // clientsClaim lets the new version take over the open pages right away.
    skipWaiting: false,
    clientsClaim: true,
    // Custom rules are evaluated before the defaults.
    runtimeCaching: [
      // These matchers are copied into sw.js as source text, so they must not
      // use variables from this file.
      {
        // Supabase REST, Auth, Storage, Realtime and Functions: multi-tenant
        // data never goes into a shared cache.
        urlPattern: ({ url }) => /^\/(rest|auth|storage|realtime|functions|graphql)\/v1\//.test(url.pathname),
        handler: "NetworkOnly",
      },
      {
        // Route handlers (AI generation, signed upload URLs) are dynamic.
        urlPattern: ({ url, sameOrigin }) => sameOrigin && url.pathname.startsWith("/api/"),
        handler: "NetworkOnly",
      },
      {
        // Auth and invitation pages depend on the session (signed-in users
        // are redirected), so they always come from the server. Invitation
        // URLs also hold a secret token that must not sit in a cache.
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin &&
          /^\/[a-z]{2}\/(connexion|inscription|mot-de-passe-oublie|reinitialiser-mot-de-passe|auth\/|invitations\/)/.test(
            url.pathname,
          ),
        handler: "NetworkOnly",
      },
    ],
  },
});

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Read by src/lib/monitoring/options.ts.
  env: {
    NEXT_PUBLIC_SENTRY_RELEASE: sentry.release ?? "",
    NEXT_PUBLIC_SENTRY_ENVIRONMENT: sentry.environment,
  },
  images: {
    remotePatterns: supabaseUrl
      ? [
          {
            protocol: new URL(supabaseUrl).protocol.replace(":", ""),
            hostname: new URL(supabaseUrl).hostname,
            pathname: "/storage/v1/object/**",
          },
        ]
      : [],
  },
  experimental: {
    serverActions: {
      bodySizeLimit: "2mb",
    },
  },
  // The deliverable parsers run from their own bundle (scripts/build-parse-worker.mjs).
  // Only the routes that start a read ship it: the upload check, and the
  // section page whose "Relancer l'analyse" action starts one.
  outputFileTracingIncludes: {
    "/api/deliverables/[id]/complete": ["./build/parse-worker.cjs"],
    "/[locale]/espaces/[workspaceId]/sections/[sectionId]": ["./build/parse-worker.cjs"],
  },
  async redirects() {
    // French is the only locale: legacy/English entry points land on French routes.
    return [
      { source: "/login", destination: "/fr/connexion", permanent: true },
      { source: "/en/:path*", destination: "/fr/:path*", permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "Content-Security-Policy", value: contentSecurityPolicy() },
          // Browsers ignore it over plain HTTP, so it is safe locally too.
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          { key: "Cross-Origin-Opener-Policy", value: "same-origin" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
        ],
      },
      {
        // The service worker must always be revalidated so updates ship.
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache, no-store, must-revalidate" },
          { key: "Service-Worker-Allowed", value: "/" },
        ],
      },
      {
        source: "/manifest.webmanifest",
        headers: [
          { key: "Content-Type", value: "application/manifest+json" },
          { key: "Cache-Control", value: "public, max-age=3600" },
        ],
      },
    ];
  },
};

/**
 * Sentry build options. Without SENTRY_AUTH_TOKEN, SENTRY_ORG and
 * SENTRY_PROJECT (CI, local builds) the build talks to no Sentry server and
 * makes no source maps. Setup: docs/operations/monitoring.md.
 * @type {import("@sentry/nextjs/config").SentryBuildOptions}
 */
const sentryBuildOptions = {
  org: process.env.SENTRY_ORG,
  project: process.env.SENTRY_PROJECT,
  authToken: process.env.SENTRY_AUTH_TOKEN,
  // Browser events go to /monitoring on this origin, which passes them on to
  // Sentry: the CSP only allows 'self' and Supabase in connect-src, and ad
  // blockers block sentry.io. src/middleware.ts skips this path.
  tunnelRoute: "/monitoring",
  // Upload logs in CI only, and nothing at all when there is no upload.
  silent: !process.env.CI || !sentry.uploadSourceMaps,
  // No build telemetry to Sentry.
  telemetry: false,
  release: {
    name: sentry.release,
    create: sentry.uploadSourceMaps,
    // Linking commits needs the GitHub integration in Sentry.
    setCommits: false,
    deploy: sentry.uploadSourceMaps ? { env: sentry.environment } : false,
  },
  sourcemaps: {
    disable: !sentry.uploadSourceMaps,
    // Browser source maps are uploaded, then deleted: they never ship.
    deleteSourcemapsAfterUpload: true,
  },
  widenClientFileUpload: true,
  // A Sentry outage must not block a deploy: warn and go on.
  errorHandler(error) {
    console.warn(`sentry: source map upload failed, the build goes on (${error.message})`);
  },
  bundleSizeOptimizations: { excludeDebugStatements: true },
  // No server tracing, so dependencies are not rewritten at build time.
  buildTimeInstrumentation: false,
};

export default withSentryConfig(withPWA(withNextIntl(nextConfig)), sentryBuildOptions);
