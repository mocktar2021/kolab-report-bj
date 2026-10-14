import { describe, expect, it } from "vitest";
import { completionPercent } from "./progress";

describe("completionPercent", () => {
  it("weights each section like the report_progress view", () => {
    // Same sections as supabase/tests/report_progress_test.sql: (0 + 2 + 0.5) / 4.
    const sections = [
      { weight: 1, status: "not_started" as const },
      { weight: 2, status: "completed" as const },
      { weight: 1, status: "in_progress" as const },
    ];
    expect(completionPercent(sections)).toBe(62.5);

    // The SQL test then moves s1 to in_progress.
    sections[0] = { weight: 1, status: "in_progress" };
    expect(completionPercent(sections)).toBe(75);
  });

  it("returns 0 without sections", () => {
    expect(completionPercent([])).toBe(0);
  });

  it("returns 0 when the weights add up to 0", () => {
    expect(completionPercent([{ weight: 0, status: "completed" }])).toBe(0);
    expect(
      completionPercent([
        { weight: 0, status: "completed" },
        { weight: 0, status: "in_progress" },
      ]),
    ).toBe(0);
  });

  it("ignores a section of weight 0 next to others", () => {
    expect(
      completionPercent([
        { weight: 0, status: "not_started" },
        { weight: 1, status: "completed" },
      ]),
    ).toBe(100);
  });

  it("returns 100 when every section is completed", () => {
    expect(
      completionPercent([
        { weight: 1, status: "completed" },
        { weight: 2.5, status: "completed" },
      ]),
    ).toBe(100);
  });

  it("returns 0 when nothing is started", () => {
    expect(completionPercent([{ weight: 3, status: "not_started" }])).toBe(0);
  });

  it("counts a section in progress as half done", () => {
    expect(completionPercent([{ weight: 1, status: "in_progress" }])).toBe(50);
  });

  it("rounds to one decimal", () => {
    const one = { weight: 1, status: "completed" as const };
    const none = { weight: 1, status: "not_started" as const };
    expect(completionPercent([one, none, none])).toBe(33.3);
    expect(completionPercent([one, one, none])).toBe(66.7);
  });

  it("rounds an exact half up, like round(x, 1) in Postgres", () => {
    // 100 * 0.21 / 1.12 = 18.75 exactly. Plain floating point math gives
    // 18.749999 and rounds it to 18.7.
    expect(
      completionPercent([
        { weight: 0.21, status: "completed" },
        { weight: 0.91, status: "not_started" },
      ]),
    ).toBe(18.8);
    // 100 * 0.5 * 0.27 / 1.2 = 11.25.
    expect(
      completionPercent([
        { weight: 0.27, status: "in_progress" },
        { weight: 0.93, status: "not_started" },
      ]),
    ).toBe(11.3);
  });
});
