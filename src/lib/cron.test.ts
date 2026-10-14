// @vitest-environment node
import { describe, expect, it } from "vitest";
import { cronSecretIsUsable, isCronAuthorized } from "./cron";

const SECRET = "4f1c9a0b7e2d6c3a8b5f0e1d2c3b4a59";

describe("isCronAuthorized", () => {
  it("accepts the bearer header Vercel Cron sends", () => {
    expect(isCronAuthorized(`Bearer ${SECRET}`, SECRET)).toBe(true);
  });

  it("refuses a missing, wrong or differently shaped header", () => {
    expect(isCronAuthorized(null, SECRET)).toBe(false);
    expect(isCronAuthorized("", SECRET)).toBe(false);
    expect(isCronAuthorized(SECRET, SECRET)).toBe(false);
    expect(isCronAuthorized(`bearer ${SECRET}`, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET.slice(0, -1)}x`, SECRET)).toBe(false);
    expect(isCronAuthorized(`Bearer ${SECRET}${SECRET}`, SECRET)).toBe(false);
  });

  it("refuses everything while the secret is missing or too short", () => {
    expect(isCronAuthorized("Bearer undefined", undefined)).toBe(false);
    expect(isCronAuthorized("Bearer ", "")).toBe(false);
    expect(isCronAuthorized("Bearer court", "court")).toBe(false);
    expect(cronSecretIsUsable(undefined)).toBe(false);
    expect(cronSecretIsUsable("x".repeat(15))).toBe(false);
    expect(cronSecretIsUsable("x".repeat(16))).toBe(true);
  });
});
