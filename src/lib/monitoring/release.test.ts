import { describe, expect, it } from "vitest";
import { canUploadSourceMaps, sentryEnvironment, sentryRelease } from "./release.mjs";

const SHA = "3f2c9a1e8b7d6c5f4e3a2b1c0d9e8f7a6b5c4d3e";
const OTHER_SHA = "9e8d7c6b5a4f3e2d1c0b9a8f7e6d5c4b3a2f1e0d";

describe("sentryRelease", () => {
  it("uses the Vercel commit SHA, then GITHUB_SHA", () => {
    expect(sentryRelease({ VERCEL_GIT_COMMIT_SHA: SHA, GITHUB_SHA: OTHER_SHA })).toBe(SHA);
    expect(sentryRelease({ GITHUB_SHA: OTHER_SHA })).toBe(OTHER_SHA);
  });

  it("prefers SENTRY_RELEASE, which deploy.yml sets to the commit it checked out", () => {
    expect(
      sentryRelease({ SENTRY_RELEASE: SHA, VERCEL_GIT_COMMIT_SHA: OTHER_SHA, GITHUB_SHA: OTHER_SHA }),
    ).toBe(SHA);
  });

  it("treats the empty values written by vercel pull as missing", () => {
    expect(sentryRelease({ SENTRY_RELEASE: "", VERCEL_GIT_COMMIT_SHA: "  ", GITHUB_SHA: SHA })).toBe(SHA);
  });

  it("has no release outside CI and Vercel", () => {
    expect(sentryRelease({})).toBeUndefined();
  });
});

describe("sentryEnvironment", () => {
  it("maps the Vercel targets to production and staging", () => {
    expect(sentryEnvironment({ VERCEL_ENV: "production" })).toBe("production");
    expect(sentryEnvironment({ VERCEL_ENV: "preview" })).toBe("staging");
  });

  it("is development everywhere else", () => {
    expect(sentryEnvironment({ VERCEL_ENV: "development" })).toBe("development");
    expect(sentryEnvironment({ APP_ENV: "production" })).toBe("development");
    expect(sentryEnvironment({})).toBe("development");
  });
});

describe("canUploadSourceMaps", () => {
  const settings = { SENTRY_AUTH_TOKEN: "sntrys_test", SENTRY_ORG: "kolab", SENTRY_PROJECT: "kolab-report" };

  it("needs the token, the organization and the project", () => {
    expect(canUploadSourceMaps(settings)).toBe(true);
    expect(canUploadSourceMaps({ ...settings, SENTRY_AUTH_TOKEN: undefined })).toBe(false);
    expect(canUploadSourceMaps({ ...settings, SENTRY_ORG: "" })).toBe(false);
    expect(canUploadSourceMaps({ ...settings, SENTRY_PROJECT: " " })).toBe(false);
  });

  it("is off in CI and local builds, which have none of them", () => {
    expect(canUploadSourceMaps({ CI: "true" })).toBe(false);
  });
});
