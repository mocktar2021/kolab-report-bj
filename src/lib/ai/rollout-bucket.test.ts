import { describe, expect, it } from "vitest";
import { inRollout, rolloutBucket } from "./rollout-bucket";

const ROLLOUT = "6b7d1f8e-3c2a-4d5e-9f10-2a3b4c5d6e7f";

function sections(count: number): string[] {
  return Array.from(
    { length: count },
    (_, index) => `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
  );
}

describe("rolloutBucket", () => {
  it("gives the same bucket for the same rollout and section, whatever the case", () => {
    const section = "AAAAAAAA-0000-4000-8000-000000000001";
    expect(rolloutBucket(ROLLOUT, section)).toBe(rolloutBucket(ROLLOUT.toUpperCase(), section.toLowerCase()));
    expect(rolloutBucket(ROLLOUT, section)).toBeGreaterThanOrEqual(0);
    expect(rolloutBucket(ROLLOUT, section)).toBeLessThan(100);
  });

  it("spreads sections about evenly", () => {
    const share = sections(10_000).filter((section) =>
      inRollout({ id: ROLLOUT, percent: 20 }, section),
    ).length;
    expect(share).toBeGreaterThan(1800);
    expect(share).toBeLessThan(2200);
  });

  it("only adds sections when the percentage grows", () => {
    const all = sections(2000);
    const at10 = all.filter((section) => inRollout({ id: ROLLOUT, percent: 10 }, section));
    const at40 = new Set(all.filter((section) => inRollout({ id: ROLLOUT, percent: 40 }, section)));
    expect(at10.every((section) => at40.has(section))).toBe(true);
  });

  it("draws other sections for another rollout", () => {
    const all = sections(500);
    const first = all.filter((section) => inRollout({ id: ROLLOUT, percent: 50 }, section)).join();
    const second = all
      .filter((section) => inRollout({ id: "11111111-2222-4333-8444-555555555555", percent: 50 }, section))
      .join();
    expect(first).not.toBe(second);
  });
});
