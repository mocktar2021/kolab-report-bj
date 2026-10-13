import { Budget, caseSpend, upfrontSpend } from "./budget";
import type { LoadedCase } from "./case";
import { runCase, type CaseResult, type RunDeps } from "./runner";

// Runs the selected cases a few at a time, in order, and asks the budget
// before each one starts.

export type ExecuteOptions = {
  concurrency: number;
  budget: Budget;
  depsFor: (value: LoadedCase) => RunDeps;
  onResult?: (result: CaseResult, done: number) => void;
  onSkip?: (value: LoadedCase) => void;
};

export type Execution = {
  /** Results of the cases that ran, in selection order. */
  results: CaseResult[];
  /** Ids of the cases the budget kept from starting, in selection order. */
  skipped: string[];
};

export async function executeCases(
  cases: readonly LoadedCase[],
  options: ExecuteOptions,
): Promise<Execution> {
  const slots: (CaseResult | undefined)[] = new Array(cases.length);
  const skipped = new Set<string>();
  let done = 0;
  let next = 0;
  const workers = Array.from(
    { length: Math.max(1, Math.min(options.concurrency, cases.length)) },
    async () => {
      while (next < cases.length) {
        const index = next++;
        const value = cases[index];
        if (!value) continue;
        const deps = options.depsFor(value);
        if (!options.budget.start(value.id, upfrontSpend(value, deps))) {
          skipped.add(value.id);
          options.onSkip?.(value);
          continue;
        }
        const result = await runCase(value, deps);
        options.budget.finish(value.id, caseSpend(result, deps.settings));
        slots[index] = result;
        options.onResult?.(result, ++done);
      }
    },
  );
  await Promise.all(workers);
  return {
    results: slots.filter((result): result is CaseResult => result !== undefined),
    skipped: cases.filter((value) => skipped.has(value.id)).map((value) => value.id),
  };
}
