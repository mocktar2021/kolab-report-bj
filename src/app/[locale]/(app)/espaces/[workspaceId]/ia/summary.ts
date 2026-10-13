import type { PromptMetrics } from "@/lib/ai/metrics-server";

// Totals of the AI dashboard, computed from the rows per prompt version and
// model so the summary always matches the table below it.

export type MetricsSummary = {
  generations: number;
  fromRollout: number;
  /** Drafts accepted or discarded. */
  decided: number;
  acceptanceRate: number | null;
  rated: number;
  /** Share of thumbs up among the ratings, 0 to 1. */
  positiveShare: number | null;
  failed: number;
  /** Generations that succeeded or failed, the running ones left out. */
  finished: number;
  failureRate: number | null;
  /** USD, null when no row has a cost (no price configured). */
  cost: number | null;
};

/** Share of thumbs up from a mean rating between -1 (all down) and 1 (all up). */
export function positiveShare(meanRating: number | null): number | null {
  return meanRating === null ? null : (meanRating + 1) / 2;
}

function ratio(part: number, whole: number): number | null {
  return whole > 0 ? part / whole : null;
}

export function summarizeMetrics(rows: readonly PromptMetrics[]): MetricsSummary {
  let generations = 0;
  let fromRollout = 0;
  let accepted = 0;
  let decided = 0;
  let rated = 0;
  let ratingSum = 0;
  let failed = 0;
  let finished = 0;
  let cost: number | null = null;

  for (const row of rows) {
    generations += row.generations;
    fromRollout += row.fromRollout;
    accepted += row.accepted;
    decided += row.accepted + row.discarded;
    if (row.meanRating !== null && row.rated > 0) {
      rated += row.rated;
      ratingSum += row.meanRating * row.rated;
    }
    failed += row.failed;
    finished += row.succeeded + row.failed;
    if (row.cost !== null) cost = (cost ?? 0) + row.cost;
  }

  return {
    generations,
    fromRollout,
    decided,
    acceptanceRate: ratio(accepted, decided),
    rated,
    positiveShare: positiveShare(rated > 0 ? ratingSum / rated : null),
    failed,
    finished,
    failureRate: ratio(failed, finished),
    cost,
  };
}
