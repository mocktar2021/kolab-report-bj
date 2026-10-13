import { estimateTokens, SYSTEM_PROMPT } from "@/lib/ai/context";
import { estimateCost, type AiSettings } from "@/lib/ai/models";
import type { LoadedCase } from "./case";
import { JUDGE_MAX_TOKENS } from "./judge";
import type { CaseResult, RunDeps, TokenUsage } from "./runner";

// Spending cap of a run (--budget-usd, --budget-tokens). Before a case
// starts, the run adds its estimate to what the finished cases cost and what
// the running ones are expected to cost. If that passes a cap, the case and
// every later one are skipped, and the run is incomplete.
//
// A case's estimate starts from its size (upfrontSpend, on the high side:
// full output cap, judge included), then is scaled by what the finished
// cases really cost against their own estimates. USD needs the AI_PRICE_*
// variables of both tiers; without them only the token cap can be checked.

export type Spend = { usd: number; tokens: number };

export type BudgetLimits = { usd: number | null; tokens: number | null };

export type BudgetSummary = {
  limits: BudgetLimits;
  /** USD can be measured: both tiers have a price. */
  priced: boolean;
  /** Estimated spend of the cases that ran, judge included. USD is null without prices. */
  spent: { usd: number | null; tokens: number };
  /** Case ids not started, in the order they were refused. */
  skipped: string[];
};

const ZERO: TokenUsage = { inputTokens: 0, outputTokens: 0 };
const EPSILON = 1e-9;

/** Both tiers have a price, so a cost in USD can be estimated for every call. */
export function hasPrices(settings: AiSettings): boolean {
  return settings.prices.standard !== null && settings.prices.fast !== null;
}

function cost(settings: AiSettings, tier: "standard" | "fast", usage: TokenUsage): number {
  return estimateCost(settings, tier, usage) ?? 0;
}

function total(usage: TokenUsage): number {
  return usage.inputTokens + usage.outputTokens;
}

/** A first estimate of a case's spend from its size, before anything ran. */
export function upfrontSpend(value: LoadedCase, deps: RunDeps): Spend {
  const { settings, template } = deps;
  const prompt = estimateTokens(SYSTEM_PROMPT) + estimateTokens(template.text);
  const source = estimateTokens(
    value.input.deliverables.map((deliverable) => deliverable.markdown).join("\n\n"),
  );
  const kept = Math.min(source, settings.maxInputTokens);
  const overflow = source - kept;
  const output = template.maxOutputTokens || settings.defaultMaxOutputTokens;
  const draft: TokenUsage = { inputTokens: prompt + kept, outputTokens: output };
  // Overflow chunks are read once by the fast model, which writes short summaries.
  const summaries: TokenUsage = { inputTokens: overflow, outputTokens: Math.ceil(overflow / 10) };
  const judge: TokenUsage = deps.judge
    ? {
        inputTokens:
          draft.inputTokens +
          estimateTokens(deps.judge.rubric) +
          estimateTokens(value.reference.markdown) +
          output,
        outputTokens: JUDGE_MAX_TOKENS,
      }
    : ZERO;
  return {
    usd:
      cost(settings, deps.tier, draft) +
      cost(settings, "fast", summaries) +
      cost(settings, "standard", judge),
    tokens: total(draft) + total(summaries) + total(judge),
  };
}

/** What a finished case cost: draft, summaries and judge (priced as the standard tier). */
export function caseSpend(result: CaseResult, settings: AiSettings): Spend {
  const judge = result.judge && "scores" in result.judge ? result.judge.usage : ZERO;
  return {
    usd:
      (result.generation.costUsd ?? 0) + (result.summaries.costUsd ?? 0) + cost(settings, "standard", judge),
    tokens: total(result.generation.usage) + total(result.summaries.usage) + total(judge),
  };
}

type Reservation = { upfront: Spend; estimate: Spend };

export class Budget {
  private spent: Spend = { usd: 0, tokens: 0 };
  /** Upfront estimates of the finished cases, to scale the next ones. */
  private finishedUpfront: Spend = { usd: 0, tokens: 0 };
  private readonly running = new Map<string, Reservation>();
  private readonly skipped: string[] = [];
  private stopped = false;

  constructor(
    readonly limits: BudgetLimits,
    /** Both tiers have a price: the USD cap can be checked. */
    readonly priced: boolean,
  ) {}

  /** The estimate of a case: its upfront estimate scaled by how far off the finished ones were. */
  estimate(upfront: Spend): Spend {
    const ratio = (actual: number, guess: number) => (guess > 0 ? actual / guess : 1);
    return {
      usd: upfront.usd * ratio(this.spent.usd, this.finishedUpfront.usd),
      tokens: upfront.tokens * ratio(this.spent.tokens, this.finishedUpfront.tokens),
    };
  }

  /**
   * Call before a case starts. True when it may run. False when its estimate,
   * added to the spend so far and to the cases still running, passes a cap:
   * that case and every later one are skipped.
   */
  start(id: string, upfront: Spend): boolean {
    if (this.stopped) {
      this.skipped.push(id);
      return false;
    }
    const estimate = this.estimate(upfront);
    let usd = this.spent.usd + estimate.usd;
    let tokens = this.spent.tokens + estimate.tokens;
    for (const reservation of this.running.values()) {
      usd += reservation.estimate.usd;
      tokens += reservation.estimate.tokens;
    }
    const overUsd = this.priced && this.limits.usd !== null && usd > this.limits.usd + EPSILON;
    const overTokens = this.limits.tokens !== null && tokens > this.limits.tokens + EPSILON;
    if (overUsd || overTokens) {
      this.stopped = true;
      this.skipped.push(id);
      return false;
    }
    this.running.set(id, { upfront, estimate });
    return true;
  }

  /** Call when a started case ends, with what it cost. */
  finish(id: string, actual: Spend): void {
    const reservation = this.running.get(id);
    this.running.delete(id);
    this.spent = { usd: this.spent.usd + actual.usd, tokens: this.spent.tokens + actual.tokens };
    if (reservation) {
      this.finishedUpfront = {
        usd: this.finishedUpfront.usd + reservation.upfront.usd,
        tokens: this.finishedUpfront.tokens + reservation.upfront.tokens,
      };
    }
  }

  summary(): BudgetSummary {
    return {
      limits: { ...this.limits },
      priced: this.priced,
      spent: { usd: this.priced ? this.spent.usd : null, tokens: this.spent.tokens },
      skipped: [...this.skipped],
    };
  }
}
