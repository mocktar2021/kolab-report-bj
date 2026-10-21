# Production baseline

`production.json` in this folder is the eval run that pull requests and the nightly run compare with (`--compare evals/baseline/production.json`). It doesn't exist yet: until it does, the comparison says there is no baseline and only the absolute thresholds of `evals/thresholds.json` apply.

This folder is separate from `evals/baselines/` in the release rule (`evals/README.md`), which keeps the run summaries of releases. The file is written by `--write-baseline` and never by hand. It holds the model and provider, the prompt version of each template, the output schema and context versions, the date, whether the judge ran, the aggregates, and the numbers of each case, so a run on a subset is compared on the cases both runs have.

## Creating or refreshing it

Only from a run on what production uses: the production provider and model ids, the prompt versions on `master`, the production `AI_MAX_INPUT_TOKENS` and `AI_REDACT_PII`, the whole golden set, the judge on, and no case skipped by a budget.

1. Take a nightly run of the **Evals** workflow on `master`, or start one by hand on `master` with the judge and no case list.
2. Check its summary: gate passed, every case ran, and the model is the production one.
3. Copy `baseline.json` to `evals/baseline/production.json`. It is in the `eval-reports` artifact, and in the run log: the **Summary** step prints it in a folded `baseline.json` group.
4. Open a PR with only that file and the link to the run.

From a terminal with the production settings, `npm run eval -- --judge --write-baseline evals/baseline/production.json` writes the same file, but a CI run leaves a record anyone can check.

Refresh it after a prompt or model change has shipped to production, after adding golden cases, and after changing the judge model. Never to get a failing PR through. The full playbook is in [`docs/ai-evaluation.md`](../../docs/ai-evaluation.md).
