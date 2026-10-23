// @vitest-environment node
import { describe, expect, it } from "vitest";
import { LAUNCH_AT, isPrelaunch, prelaunchUntil } from "./launch";

const before = new Date("2026-10-27T07:59:59.000Z");
const production = { APP_ENV: "production" };

describe("launch gate", () => {
  it("is set for 9:00 on 27 October in Cotonou", () => {
    expect(LAUNCH_AT.toLocaleString("fr-FR", { timeZone: "Africa/Porto-Novo" })).toBe("27/10/2026 09:00:00");
  });

  it("holds production until the launch second", () => {
    expect(isPrelaunch(before, production)).toBe(true);
    expect(isPrelaunch(before, { VERCEL_ENV: "production" })).toBe(true);
    expect(isPrelaunch(LAUNCH_AT, production)).toBe(false);
    expect(isPrelaunch(new Date("2026-11-02T10:00:00.000Z"), production)).toBe(false);
  });

  it("never holds staging, previews, CI or a local run", () => {
    expect(isPrelaunch(before, { APP_ENV: "staging", VERCEL_ENV: "preview" })).toBe(false);
    expect(isPrelaunch(before, { VERCEL_ENV: "preview" })).toBe(false);
    expect(isPrelaunch(before, {})).toBe(false);
  });

  it("gives the client the launch time only while production waits", () => {
    expect(prelaunchUntil(before, production)).toBe("2026-10-27T08:00:00.000Z");
    expect(prelaunchUntil(LAUNCH_AT, production)).toBeUndefined();
    expect(prelaunchUntil(before, {})).toBeUndefined();
  });
});
