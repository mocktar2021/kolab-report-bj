import withPWAInit from "@ducanh2912/next-pwa";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./src/i18n/request.ts");

const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";

const withPWA = withPWAInit({
  dest: "public",
  register: true,
  // The service worker is disabled in dev unless explicitly requested,
  // otherwise stale caches make local development painful.
  disable: process.env.NODE_ENV === "development" && process.env.NEXT_PUBLIC_PWA_ENABLE_IN_DEV !== "true",
  cacheOnFrontEndNav: true,
  aggressiveFrontEndNavCaching: true,
  reloadOnOnline: true,
  cacheStartUrl: true,
  dynamicStartUrl: true,
  fallbacks: {
    // Served when a navigation fails and the page is not in cache.
    document: "/fr/hors-ligne",
  },
  extendDefaultRuntimeCaching: true,
  workboxOptions: {
    disableDevLogs: true,
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
        // Auth pages depend on the session (signed-in users are redirected),
        // so they always come from the server.
        urlPattern: ({ url, sameOrigin }) =>
          sameOrigin &&
          /^\/[a-z]{2}\/(connexion|inscription|mot-de-passe-oublie|reinitialiser-mot-de-passe|auth\/)/.test(
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

export default withPWA(withNextIntl(nextConfig));
