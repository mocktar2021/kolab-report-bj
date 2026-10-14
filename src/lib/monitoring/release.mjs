// Release and environment of Sentry events (KRB-136). next.config.mjs calls
// these at build time and inlines the result into every bundle, so the
// browser, the server and the edge runtime report the same values. Plain
// JavaScript so next.config.mjs can import it; types in release.d.mts.

/** @typedef {Record<string, string | undefined>} Env */

/** @param {string | undefined} value */
function filled(value) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}

/**
 * The git commit SHA of the build. SENTRY_RELEASE wins when set: deploy.yml
 * sets it on staging, where GITHUB_SHA is the tip of master and not
 * necessarily the commit being built. `vercel pull` writes the VERCEL_GIT_*
 * variables empty, so empty values count as missing.
 *
 * @param {Env} env
 * @returns {string | undefined}
 */
export function sentryRelease(env) {
  return filled(env.SENTRY_RELEASE) ?? filled(env.VERCEL_GIT_COMMIT_SHA) ?? filled(env.GITHUB_SHA);
}

/**
 * Staging deploys use Vercel's Preview target, so "preview" reports as
 * "staging". Local builds and CI report as "development".
 *
 * @param {Env} env
 * @returns {"production" | "staging" | "development"}
 */
export function sentryEnvironment(env) {
  if (env.VERCEL_ENV === "production") return "production";
  if (env.VERCEL_ENV === "preview") return "staging";
  return "development";
}

/**
 * Source maps go to Sentry only when the build has all three settings. CI
 * and local builds have none and skip the upload.
 *
 * @param {Env} env
 * @returns {boolean}
 */
export function canUploadSourceMaps(env) {
  return Boolean(filled(env.SENTRY_AUTH_TOKEN) && filled(env.SENTRY_ORG) && filled(env.SENTRY_PROJECT));
}
