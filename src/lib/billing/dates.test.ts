import { describe, expect, it } from "vitest";
import { calendarDaysUntil, formatBillingDate } from "./dates";

describe("formatBillingDate", () => {
  it("writes the day in Porto-Novo time", () => {
    // 23:30 UTC is already the next day in Porto-Novo (UTC+1).
    expect(formatBillingDate("2026-10-31T23:30:00Z")).toBe("1 novembre 2026");
  });
});

describe("calendarDaysUntil", () => {
  it("counts calendar days in Porto-Novo, not 24-hour periods", () => {
    const end = "2026-10-21T13:00:00Z";
    expect(calendarDaysUntil(end, new Date("2026-10-14T04:17:00Z"))).toBe(7);
    expect(calendarDaysUntil(end, new Date("2026-10-20T22:59:00Z"))).toBe(1);
    // 23:00 UTC on the 20th is midnight on the 21st in Porto-Novo.
    expect(calendarDaysUntil(end, new Date("2026-10-20T23:00:00Z"))).toBe(0);
    expect(calendarDaysUntil(end, new Date("2026-10-22T04:17:00Z"))).toBe(-1);
  });
});
