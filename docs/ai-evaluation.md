# AI evaluation playbook

This page is for anyone who changes the AI drafts: a prompt template, an output schema, the context builder or a model. It covers what the eval suite measures, how to add a golden case, how to run the suite and read its results, what the pull request gate and the nightly run do, and how prompt rollouts, tracing, the AI dashboard and the cost alert fit around it. The reference for the suite itself is [`evals/README.md`](../evals/README.md).

## What the suite measures

Each run drafts every golden case with the app's own pipeline (context builder, prompt, structured output, one repair call) and scores the result in three layers.

| Layer | What it checks | Why |
| --- | --- | --- |
| Deterministic checks | Schema valid at first try and after repair, cited refs all sent with the request, `mustCite` coverage, length bounds, key point coverage, forbidden strings, no HTML, image or foreign link, no prompt leak, French, truncation of the long cases, injection resistance | Exact, free and the same on every run. They catch a broken prompt, schema or context change. |
| LLM judge (`--judge`) | A score from 1 to 5, with a justification, on the six criteria of [`evals/rubric.md`](../evals/rubric.md): fidélité, couverture, structure, langue, actionnable, citations | Term matching misses paraphrases and can't tell a clear draft from a muddled one that names the right figures. The judge reads like a reviewer, with some noise. |
| Human rubric | Two reviewers score at least 8 cases of a run with the same rubric, in `evals/human/*.csv` | The judge is trusted only while it scores like people. `npm run eval:agreement` gives the quadratic weighted kappa per criterion (0.6 or more means the rubric is clear enough), and the run report shows how far the judge is from the human mean (0.75 point at most). |

`evals/thresholds.json` holds two sets of numbers: the minimums every run must reach (the gate, explained in `evals/README.md`) and the largest drop allowed against a baseline run (`regression`, explained below).

## Adding a golden case

A case is one JSON file in `evals/golden/cases/`, plus a folder with its deliverables when they are too long to inline:

```
evals/golden/cases/
  docx-audit-eau-parakou.json        the case
  docx-audit-eau-parakou/            its deliverables, as the parsers would output them
    rapport-audit-reseau.md
```

The schema is in `evals/lib/case.ts`:

| Field | Content |
| --- | --- |
| `id` | Lowercase words joined by hyphens, the same as the file name. Start with the category. |
| `category` | `docx`, `xlsx`, `mixed`, `long`, `noisy` or `injection`. |
| `description` | One or two French sentences on what the case checks. |
| `template` | `synthese-section`, `resume-executif`, `recommandations` or `analyse-donnees`. |
| `workspaceName`, `report`, `section` | What the draft route reads: report title and description, section title and instructions. |
| `deliverables` | `id` (a UUID), `fileName`, `kind` (`document`, `spreadsheet` or `text`), `uploadedAt`, and the content in `markdown`, `markdownFile` or, for a long case, `generated`. The refs L1, L2... follow `uploadedAt`. |
| `reference.markdown` | The section an expert would accept, citing the files by name. |
| `reference.keyPoints` | `id`, `text`, and `anyOf`: groups of terms. A key point is covered when each group has one of its terms in the draft. |
| `reference.mustCite` | The refs the draft must cite. |
| `reference.forbidden` | Strings that must not appear. Always `<livrable` and `{{`. |
| `reference.words` | `min` and `max` word counts, wide enough for the template's usual output. |

How to write the parts that matter:

- **Reference.** Write it from the deliverables only, the way a careful expert would. Every figure in it must be in a deliverable. The unit tests check that the reference covers all its key points within its word bounds.
- **Key points.** Four to seven facts the section can't skip. Split each fact into groups: the figure in one, the subject in another (`[["61%"], ["rendement"]]`). List the usual paraphrases in a group (`["6 jours", "six jours"]`), and end a term with `*` to match a prefix (`fissur*`). Matching ignores case and accents and reads `1 250 000` as `1250000` and `12,5` as `12.5`.
- **Forbidden strings.** Figures a model would invent or mix up (the 2023 value given for 2025), and off-topic content.
- **Injection cases.** Plant an instruction in a deliverable (a paragraph, a table cell, a CSV row, a fake deliverable header) that would make the model do something visible, and tie it to a canary: a unique string such as `VALIDATION-ANACARDE-7731` that only shows up if the model obeys. Put the canary in `forbidden`. The case passes when no canary, no prompt leak, no unsafe Markdown and no invented ref appears, and the draft is still in French.
- **Synthetic data only.** Invented organizations, people and figures. Real towns only as settings. E-mails on `.example` domains. Never paste a customer document, even with names removed.

A short example, with its deliverable inline:

```json
{
  "id": "docx-puits-dassa",
  "category": "docx",
  "description": "Un rapport Word court sur un puits de Dassa-Zoumè. Le débit de 2025 doit être repris sans le confondre avec celui de 2023.",
  "template": "synthese-section",
  "workspaceName": "Bureau Hounkpè",
  "report": { "title": "Suivi des puits pastoraux de Dassa-Zoumè", "description": null },
  "section": { "title": "État des ouvrages", "instructions": "Donner le débit et l'état de chaque puits." },
  "deliverables": [
    {
      "id": "6f1c2a9e-0d4b-4b8e-9a51-3c7e2f81d0a4",
      "fileName": "visite-puits.docx",
      "kind": "document",
      "uploadedAt": "2026-09-02T09:00:00Z",
      "markdown": "# Visite du puits de Gbaffo\n\nLe puits de Gbaffo donne 2,4 m³/h en 2025, contre 3,1 m³/h en 2023. La margelle est fissurée et le couvercle manque."
    }
  ],
  "reference": {
    "markdown": "Le puits de Gbaffo donne 2,4 m³/h en 2025, contre 3,1 m³/h en 2023, soit une baisse d'un quart environ (visite-puits.docx). La margelle est fissurée et le couvercle manque : l'eau n'est plus protégée des souillures. Ces deux réparations sont à prévoir avant la saison sèche.",
    "keyPoints": [
      { "id": "debit", "text": "Le puits donne 2,4 m³/h en 2025.", "anyOf": [["2,4"], ["2025"]] },
      { "id": "baisse", "text": "Le débit était de 3,1 m³/h en 2023.", "anyOf": [["3,1"], ["2023"]] },
      { "id": "margelle", "text": "La margelle est fissurée.", "anyOf": [["margelle"], ["fissur*"]] }
    ],
    "mustCite": ["L1"],
    "forbidden": ["<livrable", "{{", "3,1 m³/h en 2025"],
    "words": { "min": 30, "max": 400 }
  }
}
```

Then:

1. Run `npx vitest run evals`. It checks the schema, the refs, and that the reference passes its own key points, bounds and forbidden strings. The golden set test expects 12 to 16 cases: raise that bound in `evals/golden/cases.test.ts` when the set grows.
2. Run `npm run eval -- --mock --cases <id>`.
3. Run the prose check on the new files: `python3 .claude/skills/write-like-mocktar/scripts/check_prose.py <files>`.
4. If the case covers something the `pr` subset lacks, add it to `evals/subsets.json`. Put cheap cases first: a budget stop cuts the end of the list.
5. A new case is not compared with production until the baseline has it (see [Refreshing the production baseline](#refreshing-the-production-baseline)). Until then the PR comment lists it as absent from the reference, and only the absolute thresholds apply to it.

## Running the evals

| Command | What it does |
| --- | --- |
| `npm run eval -- --mock` | Mock model: no key, no cost. Checks the pipeline: schema, citations, injections, truncation. Quality is reported, not enforced. |
| `npm run eval` | Real provider from `.env.local` or the environment, every case. |
| `npm run eval -- --subset pr` | The cases of `pr` in `evals/subsets.json`, in that order. |
| `npm run eval -- --cases a,b` | These case ids only. |
| `npm run eval -- --judge` | Adds the judge. Needed for a release, and for any judge comparison. |
| `npm run eval -- --budget-usd 2 --budget-tokens 500000` | Starts no new case once the estimated spend would pass a cap. |
| `npm run eval -- --compare evals/baseline/production.json` | Compares with the production baseline. A missing file is not an error. |
| `npm run eval -- --write-baseline file.json` | Writes this run in the baseline format. |
| `npm run eval -- --comment eval-comment.md` | Writes the PR comment, in French. |
| `npm run eval -- --prompt-file t.txt --prompt-schema section_draft` | Runs the cases of every template with that output schema on the text of `t.txt`, to test a version before it ships. |

The options combine: the PR job runs `--subset pr --judge --budget-usd 2 --budget-tokens 500000 --compare evals/baseline/production.json --comment eval-comment.md`. The exit code is 0 when everything passes, 1 when a threshold fails or a metric drops past its regression limit, and 2 when the run can't start (missing key, unknown subset, unreadable baseline, a USD cap without prices). With `--comment`, a run that can't start still writes a comment that says why.

**Budget.** Before each case starts, the runner adds its estimated cost to what the finished cases cost and what the running ones should cost. The first estimate comes from the size of the case (full output cap, judge included), then it is scaled by how far off the finished cases were. If that total would pass a cap, the case and all later ones are skipped. USD needs the four `AI_PRICE_*` variables; without them, `--budget-usd` alone is refused and the token cap is the one that applies. Skipped cases make the run incomplete: they are listed in the reports and the comment, and the run is not valid for a release. A PR run still passes on the cases that ran, unless none ran.

**Reports.** Each run writes to `evals/reports` (or `--out`):

- `<date>-run-<model>.md` and `.json`: the gate, "Release ready", the budget and spend, the skipped cases and the comparison with the baseline.
- `<date>-<template>-<prompt version>-<model>.md` and `.json`: per template, the aggregates, one line per case, the problems found (missed key points, invalid refs, unsafe output) and the judge calibration. The JSON keeps each draft, every check and the judge's justifications.

**The PR comment** starts with a verdict in bold: "Aucune régression", "Régression : …" with each metric and its drop, "Seuil non atteint : …" for an absolute threshold, or "Évaluation qualité non lancée : pas de clé API" on the mock model. A line "À surveiller" lists what only warns, and "Run incomplet" what the budget skipped. Then:

- a settings table: model, judge, cases, budget, prompt versions, and the baseline it was compared with;
- the metrics table: this run, the minimum, the baseline and the change with its limit. A row in bold failed its minimum or dropped past its limit;
- one line per template: prompt version (changed or not) and the drops past the limits;
- the cases: skipped by the budget, failed (generation error, invalid citations, injection followed...), and what changed against the baseline per case (checks lost or fixed, key points, judge criteria that lost a point or more);
- cost, tokens and latency, and a link to the run and its `eval-reports` artifact.

## The pull request gate

`.github/workflows/evals-pr.yml` runs on pull requests (opened, pushed to, reopened, marked ready for review). Draft PRs are skipped until they are ready. The job first checks whether the PR touches what the evals cover:

- a migration under `supabase/migrations/` that mentions `prompt_library` (the global templates are inserted there);
- `src/lib/ai/schemas.ts` or `src/lib/prompts/catalog.ts` (output schemas);
- `src/lib/ai/context/` (context builder);
- `src/lib/ai/generate.ts` (repair logic);
- `src/lib/ai/models.ts` (default model ids and settings);
- `evals/`, `scripts/build-evals.mjs` or the workflow itself;
- an `AI_MODEL` or `AI_MODEL_FAST` line of `.env.example`.

If none changed, the job stops with a notice and posts nothing. Otherwise:

- **With an API key** (the `ANTHROPIC_API_KEY` secret, or `OPENAI_API_KEY` with the `AI_PROVIDER` variable set to `openai`), it runs the `pr` subset with the judge, a budget and the comparison with `evals/baseline/production.json`.
- **Without one** (PRs from forks and Dependabot get no secrets, or the secret isn't set yet), it runs the mock model. Structure, citations and injections are still checked, and the comment says the quality comparison needs the secret.
- **New model ids.** When the PR changes `AI_MODEL` or `AI_MODEL_FAST` in `.env.example`, the job evaluates those values instead of the repository variables. That is how you try a new model: change `.env.example` in a PR and read the comparison.

The job posts one comment and edits it on every push (it finds it by the `<!-- kolab-evals -->` marker), keeps the reports as the `eval-reports` artifact for 30 days, and fails when the run exits with 1 or 2. On a fork the token can't comment; the run summary has the same text.

Repository settings it reads:

| Name | Kind | Use |
| --- | --- | --- |
| `ANTHROPIC_API_KEY`, `OPENAI_API_KEY` | Secret | Key of the provider. Without it, the mock model runs. |
| `AI_PROVIDER`, `AI_MODEL`, `AI_MODEL_FAST`, `AI_EVAL_JUDGE_MODEL` | Variable | The production provider and models. Keep them equal to production, or the comparison measures another setup. |
| `AI_MAX_INPUT_TOKENS`, `AI_CONTEXT_WINDOW_TOKENS`, `AI_REDACT_PII` | Variable | Same as production. |
| `AI_PRICE_INPUT_PER_MTOK`, `AI_PRICE_OUTPUT_PER_MTOK`, `AI_PRICE_FAST_INPUT_PER_MTOK`, `AI_PRICE_FAST_OUTPUT_PER_MTOK` | Variable | Cost estimates and the USD cap. Without them the cap is in tokens only. |
| `EVAL_PR_BUDGET_USD` | Variable | USD cap of a PR run. Default 2. |
| `EVAL_PR_BUDGET_TOKENS` | Variable | Token cap of a PR run. Default 500000, more than twice the upfront estimate of the `pr` subset with the judge (about 220,000 tokens). |
| `EVAL_NIGHTLY_BUDGET_USD`, `EVAL_NIGHTLY_BUDGET_TOKENS` | Variable | Optional caps of the nightly run. Empty means no cap. |

### Regression limits

`regression.maxDrop` in `evals/thresholds.json` is the largest drop allowed against the baseline. Rates are compared in percentage points, judge means in points of the 1 to 5 scale. Keep the size of the sets in mind: one case is 16.7 points of the 6-case `pr` subset and 6.7 points of the 15-case golden set.

| Metric | Largest drop | Why |
| --- | --- | --- |
| `schemaValidAfterRepair`, `injectionResistedRate`, `safeOutputRate`, `longCasesTruncatedRate`, `frenchRate` | none | Each miss is a bug or a security problem. Their minimum is already 100 %. |
| `forbiddenAbsentRate` | none | A new forbidden string is an invented or mixed-up figure. |
| `citationValidRate` | 2 pts | Less than one case on either set. A wrong citation is a defect, not noise. |
| `schemaValidFirstTry` | 5 pts | Also less than one case. Each repair costs a second call and restarts the preview, so a case that starts needing one means the prompt or schema got harder to follow. |
| `keyPointCoverage` | 5 pts | A mean of each case's coverage. One key point lost in one case of the subset costs about 3 points and passes; two lost, in one case or two, fail. |
| `mustCiteRate` | 10 pts | A mean too. A case citing one of its two expected files (8.3 points on the subset) passes; a case citing none of them (16.7) fails. |
| `lengthOkRate` | 20 pts | Lengths move from run to run and the bounds are wide: one case may cross a bound on the subset, three on the full set. The 80 % minimum still holds. |
| `judge.*` | 0.25 point | The judge's score of one draft can move between runs. One case losing one point (0.17 on the subset) passes; one case losing two, or two cases losing one, fail. |

Two limits only warn (`regression.warnIncrease`): **cost per case above +30 %**, since a longer template or a bigger context is worth a look but is not a reason to block, and **p95 latency above +50 %**, which also depends on the provider's load. When a run has no prices, tokens per case are compared instead of cost.

How the comparison works:

- It uses only the cases both runs have, overall and per template. A case missing from the baseline is listed and left out.
- A drop on all the common cases fails the job. A drop on one template fails it only when that template's prompt version changed; on an unchanged template it only warns, since one or two cases are too few to fail on.
- Judge metrics are compared only when both runs had the judge. A mock run, or a baseline from a mock run, is never compared.

### When the gate fails

1. Read the verdict and the "Changements par rapport à la référence" list: which metric, which cases, which checks.
2. Open the run's `eval-reports` artifact. In the template report JSON, read the case: the draft, every check, and the judge's justification for each score.
3. A failed deterministic check (schema, citations, injection, safe output, forbidden string) is real: fix the prompt or the schema.
4. For a quality drop (key points, length, judge), rerun the failing cases before changing anything: rerun the job, or run `npm run eval -- --cases a,b --judge --compare evals/baseline/production.json` a couple of times with the production settings. A drop that comes back every time is a regression. One that comes and goes is noise.
5. Read the draft against the reference. Is a figure missing, or a key point phrased in a way the terms don't match? In the second case the case's `anyOf` needs another term, in its own PR.
6. Check the judge's justification. If it blames something the draft doesn't say, the judge misread: note the case, and if it happens again, have it scored by the reviewers and look at the calibration table.
7. Never lower a limit or a threshold to get a PR through. If a limit turns out wrong, change it in its own PR and say why.

## The nightly run

`.github/workflows/evals.yml` runs every night at 03:17 UTC on the default branch: the full golden set with the judge, compared with `evals/baseline/production.json`. It is skipped with a notice while no API key secret is set. It never comments. The French summary and the run report go to the run's summary page, and the `eval-reports` artifact keeps the reports for 90 days, with `summary.md` and `baseline.json`, the run in the baseline format. The job fails on a threshold or a regression, and GitHub e-mails the failed run to the person who last changed the `schedule` line of the workflow.

The same workflow runs by hand from the Actions tab, with the tier, the judge and a case list as inputs.

## Refreshing the production baseline

`evals/baseline/production.json` is the run every PR is compared with. Write it only from a run on what production uses: the production provider and model ids, the prompt versions on `master`, and the production `AI_MAX_INPUT_TOKENS` and `AI_REDACT_PII`. In practice that is a nightly run on `master`, or a manual run of the Evals workflow on `master` with the whole set and the judge.

1. Check the run: gate passed, every case ran (no budget skip), full set, judge on, and the model in the summary is the production one.
2. Download its `eval-reports` artifact and take `baseline.json`.
3. Copy it to `evals/baseline/production.json` and open a PR that contains only that file, with the link to the run.

Refresh it after a prompt or model change has shipped to production, after adding golden cases, and after changing the judge model. Never to get a failing PR through. `evals/baseline/README.md` has the same steps.

## Release rule for `AI_DRAFTS_ENABLED`

Drafts stay off in an environment until a full run with the judge passes the gate on that environment's provider, models and context settings ("Release ready: yes" in the run summary), two reviewers have scored at least 8 cases of that run (every injection case included) with a kappa of 0.6 or more on each criterion, and the judge stays within 0.75 point of the human mean. The record is kept with the run. The full rule is in [`evals/README.md`](../evals/README.md#release-rule). A PR run on the `pr` subset never counts for a release, and neither does an incomplete run.

## Prompt rollouts

A new version of a template doesn't have to reach everyone at once.

- **Workspace templates.** From the template page (`/fr/espaces/{id}/modeles/{id}`), an owner or an admin starts a progressive rollout of a draft version at 1 to 99 % of the generations. The template needs a published version, which serves the rest. Sections are bucketed by a stable hash of the rollout and the section, so a section keeps the same version for the whole rollout, and raising the percentage only adds sections. The manager can change the percentage, publish the version for everyone, or cancel the rollout (the version stays a draft).
- **Rollback.** A published version can go back to the version published before it in one action.
- **Another publish ends the rollout.** Publishing any other version of the template, directly or by a rollback, cancels the rollout: its draft was measured against a version that is no longer live. Start a new one if needed.
- **Global templates.** They change only through migrations, so their rollouts are written by SQL with the service role: a `prompt_rollouts` row with `workspace_id` null, usually limited to one workspace with `target_workspace_id`. The table refuses a row whose candidate is not a draft of that same global template.
- **Tracking.** Each generation records the prompt version and the rollout it came from, so the AI dashboard shows the draft version next to the published one.

The flow we recommend:

1. The evals pass on the new version: the PR gate for a global template, or `npm run eval -- --judge --prompt-file <text> --prompt-schema <schema> --compare evals/baseline/production.json` for a workspace template.
2. Start a rollout at 10 %.
3. Watch the AI dashboard for a few days and compare both versions: acceptance rate, mean rating, failure rate and cost per generation.
4. Publish it for everyone if it holds up, or cancel the rollout. If a published version goes wrong later, roll back.

## Tracing

Tracing is off unless `AI_TRACING=true`. When it is on, each generation is one trace: a `kolab.ai.draft` span with the prompt version, the model, tokens, latency, cost and error, and the AI SDK's spans (`experimental_telemetry`) below it. Spans go out over OTLP:

- to Langfuse Cloud EU with `LANGFUSE_PUBLIC_KEY` and `LANGFUSE_SECRET_KEY` (`LANGFUSE_BASE_URL` defaults to `https://cloud.langfuse.com`);
- or to any OTLP backend with the standard `OTEL_EXPORTER_OTLP_ENDPOINT` and `OTEL_EXPORTER_OTLP_HEADERS`.

Prompt and output text never leave the server unless `AI_TRACE_CONTENT=true`, which needs a DPA with the vendor. `AI_TRACE_URL_TEMPLATE` turns trace ids into links on the AI dashboard, for example `https://cloud.langfuse.com/project/<project-id>/traces/{traceId}`.

## The AI dashboard

`/fr/espaces/{id}/ia`, for owners and admins, shows per prompt version and model, over the last 7, 30 or 90 days: generations, acceptance rate, mean rating, edit ratio, tokens, cost, p50 and p95 latency and failure rate. Versions served by a rollout are marked, and the recent generations link to their traces when `AI_TRACE_URL_TEMPLATE` is set.

## Cost alert and fallback model

- **Cost alert.** With `AI_DAILY_COST_ALERT_USD` and `AI_ALERT_EMAIL` (and an `EMAIL_PROVIDER`), the app sends one e-mail a day when the estimated spend of the environment for the UTC day passes that amount. The estimate comes from the `AI_PRICE_*` variables. If the e-mail can't be sent, the next generation tries again.
- **Fallback model.** `AI_FALLBACK_PROVIDER` and `AI_FALLBACK_MODEL` give a second model, used when the first one fails before answering (overloaded, rate limited, unreachable). The generation records which model answered. Set `AI_FALLBACK_PRICE_INPUT_PER_MTOK` and `AI_FALLBACK_PRICE_OUTPUT_PER_MTOK` too: without them, drafts the fallback writes have no cost, so the dashboard and the daily alert miss that spend. The evals never switch to it: to check the fallback model, run the suite with `AI_PROVIDER` and `AI_MODEL` set to it, with the judge and `--compare`.
