import { describe, expect, it } from "vitest";
import { loadBrowserSentry, loadedBrowserSentry } from "./browser";

describe("loadBrowserSentry", () => {
  it("leaves Sentry off without a DSN", async () => {
    expect(process.env.NEXT_PUBLIC_SENTRY_DSN).toBeFalsy();
    await expect(loadBrowserSentry()).resolves.toBeNull();
    expect(loadedBrowserSentry()).toBeNull();
  });
});
