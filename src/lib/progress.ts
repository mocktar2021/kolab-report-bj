import type { SectionStatus } from "@/lib/sections";

// Part of a section's weight that counts as done, in halves: completed counts
// 1, in_progress 0.5 and not_started 0, as in the report_progress view.
const DONE_HALVES: Record<SectionStatus, number> = {
  not_started: 0,
  in_progress: 1,
  completed: 2,
};

/**
 * Weighted completion of some sections, from 0 to 100 with one decimal. Same
 * math as the report_progress view: round(100 * sum(w * s) / sum(w), 1), and 0
 * when there are no sections or the weights add up to 0.
 */
export function completionPercent(sections: readonly { weight: number; status: SectionStatus }[]): number {
  // Weights are numeric(6, 2) in the database. Counting in hundredths of a
  // weight and halves of a status keeps every sum an exact integer, so a
  // result like 12.25 is not read back as 12.2499999.
  let total = 0;
  let done = 0;
  for (const section of sections) {
    const weight = Math.round(section.weight * 100);
    total += 2 * weight;
    done += weight * DONE_HALVES[section.status];
  }
  if (total === 0) return 0;

  // The percent in tenths is 1000 * done / total. Postgres round() goes half
  // away from zero, which is floor(x + 0.5) on the absolute value.
  const numerator = 2000 * Math.abs(done) + Math.abs(total);
  const denominator = 2 * Math.abs(total);
  const tenths = (numerator - (numerator % denominator)) / denominator;
  const sign = Math.sign(done) * Math.sign(total);
  return sign === 0 ? 0 : (sign * tenths) / 10;
}
