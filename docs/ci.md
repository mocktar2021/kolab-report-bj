# Continuous integration

Every pull request and every push to `master` runs two workflows in GitHub Actions, and CI also runs on its own every night. A third one, `deploy.yml`, ships `master` to staging and tags to production, then runs the smoke tests (`smoke.yml`) on what it deployed (see `docs/deployment.md` and `docs/operations/smoke-tests.md`).

## CI (`.github/workflows/ci.yml`)

What runs where (KRB-190, KRB-220):

| Job | Pull request | Push to `master` | Every night | Mondays | Manual run |
| --- | --- | --- | --- | --- | --- |
| What changed | yes | yes | yes | yes | yes |
| Lint, typecheck, unit tests, build | yes | yes | no | no | yes |
| Database and end-to-end tests | unless draft or docs only | no | if `master` changed | no | yes |
| Lighthouse | no | no | no | if `master` changed | yes |

The end-to-end tests run once per change, on its pull request, and no longer again on `master` after the merge (KRB-220). Every night at 00:29 UTC they run on `master`, when something was merged in the last 25 hours: that catches two PRs that pass alone and clash once both are merged. A failure there does not stop a deploy, so read it the next morning; GitHub e-mails the failure to whoever last changed the schedule in `ci.yml`. A draft PR skips the end-to-end tests until it is marked ready.

**What changed** lists the files the PR or the push changes (`scripts/ci-changed-code.sh`). When all of them are under `docs/` or end in `.md`, the change is docs only and the two long jobs are skipped. A file moved out of `src/` into `docs/` counts at both paths, so it is not docs only. When the script cannot tell (a new branch, a push whose previous commit is gone) or fails, every job runs. On a scheduled run it checks the date of the last commit of `master` instead: the nightly run goes on when it is less than 25 hours old, the Monday one when it is less than 170 hours old.

**Lint, typecheck, unit tests, build** runs in about 4 minutes:

1. `npm ci` with the npm cache from `actions/setup-node`.
2. Writing check on the PR: commit messages and changed files go through `write-like-mocktar` (skipped for Dependabot).
3. `format:check`, `lint`, `typecheck` and `npm test`. Vitest runs the test files side by side, except `src/lib/deliverables/parse-job.test.ts`, which runs alone after them (the `alone` project in `vitest.config.mts`): it runs a parse worker out of memory on purpose, and that slowed quick tests next to it past their 5 s timeout (KRB-191). A new test that loads the whole machine goes in that list.
4. `scripts/check-public-env.mjs` fails on `NEXT_PUBLIC_` variables named like secrets, since those ship to the browser.
5. `node scripts/audit-production.mjs` runs `npm audit --omit=dev` and fails on any high or critical advisory, unless `.github/accepted-advisories.json` accepts it. An accepted entry gives the GHSA id, the direct dependencies it may come through, the reason it does not apply and an expiry date. The job fails again once that date passes, or when the advisory comes through another dependency. What is accepted and why: `docs/security/dependencies.md`.
6. `next build` with placeholder Supabase variables and the `.next/cache` restored. `npm run build` then runs `scripts/check-pdf-fonts.mjs`, which fails when a route that draws a PDF does not ship pdfkit's standard fonts. Vercel deploys only the files the build traces, and pdfkit loads these fonts in a way the trace misses (KRB-189).

**Database and end-to-end tests** starts the local Supabase stack with the CLI version from `package-lock.json`, then:

1. `supabase db reset` applies every migration from an empty database.
2. `supabase test db` runs the pgTAP suite in `supabase/tests/`.
3. `npm run db:types` regenerates `src/lib/supabase/database.types.ts`. The job fails if the result differs from the committed file, so a migration always ships with its types.
4. Writes `.env.local` from `supabase status` (`scripts/ci-env-local.sh`), builds the app and runs the Playwright suite. Traces are kept as an artifact when a test fails.

The job takes 15 to 20 minutes: about 5 to start the stack and build, the rest for the Playwright suite on one worker. A slow runner adds about 30%, so the job stops at 35 minutes. When the suite alone passes 20 minutes on a normal runner, split it in two shards rather than raising the limit again (KRB-188).

**Lighthouse** (KRB-153) starts the same local stack, writes the same `.env.local` and builds the same way, then runs `scripts/lighthouse-ci.sh`: Lighthouse mobile, 5 runs on `/fr/connexion` and 5 on `/fr/tableau-de-bord` signed in as the seeded demo user, each run in its own Chrome (KRB-172). It fails when a median score is under the KRB-25 targets: performance 85, accessibility 95, best practices 95. The dashboard's performance floor is 75 until the app shell hydrates faster. The "Lighthouse scores" step prints the score of every run and what cost the most on the median run. The HTML and JSON reports are kept as the `lighthouse-reports` artifact for 14 days. It runs next to the end-to-end job, so it adds no wall-clock time to CI. Thresholds, budgets and how to run it locally: `docs/performance.md`.

Lighthouse does not run on PRs, nor after each merge since KRB-220. It runs on `master` every Monday at 00:47 UTC when something was merged that week, and by hand. A score under target fails that run but stops no deploy, so look at the Monday result. To check a PR that may change the scores (a heavy page, a new dependency, images), run CI by hand on its branch before the merge: **Actions > CI > Run workflow**, pick the branch. The results show on the PR's last commit. Check **Lighthouse only** to skip the checks and the end-to-end tests: about 7 minutes instead of 25, and a last step traces one dashboard load. The option is ignored on `master`, where every job runs.

The jobs are skipped with an `if:` on the job, never with `paths` or `paths-ignore` on the workflow. A skipped job counts as passed for a required check, so a docs-only PR can still merge. A workflow that never starts leaves its required checks pending, and the PR cannot merge.

### Actions minutes

On a private repo the Actions minutes are limited by the plan and the spending limit (**Settings > Billing and plans**). From 13 to 18 October 2026, CI used about 5,000 minutes, more than a month of the plan, and GitHub stopped starting jobs. A merged story cost about 100 minutes: the end-to-end tests on each push to its PR and again on `master`, Lighthouse after each merge, the deploy, and Dependabot rebasing its PRs on every merge.

Since KRB-220 a merged story costs about 40 minutes: about 23 per push to its PR (4 of checks, 19 of end-to-end tests), then on `master` about 5 of checks, 2 of CodeQL and 7 of deploy. The nightly end-to-end run adds about 19 minutes on days with a merge, Lighthouse about 8 on Mondays, the other scheduled workflows (backups, advisors, nightly evals) seconds to 3 minutes a day. Push fixes to a PR in one go rather than one by one: each push is a full run.

When every job of a run fails within a few seconds and the log does not open, the jobs never got a runner: the minutes or the spending limit are used up. Re-running does nothing until that is fixed. While it lasts, nothing deploys, since the deploy waits for CI on `master`.

## CodeQL (`.github/workflows/codeql.yml`)

Runs the `security-extended` queries on JavaScript and TypeScript on pushes to `master`, on PRs that touch code, and every Monday. The repo is private, so uploading to the Security tab needs GitHub Code Security. Until it is on, the results stay in the run: they are listed in the job summary, kept as a SARIF artifact, and any finding fails the job.

A finding that was reviewed and judged safe goes in `.github/codeql/accepted-findings.json` with its rule, file and the reason. The job then skips it. Keep that list short and review it when the file changes.

## Evals (`.github/workflows/evals-pr.yml`, `.github/workflows/evals.yml`)

On a PR that changes a prompt template migration, an output schema, the context builder, the repair logic, a model id or `evals/`, **Evals on PR** runs the `pr` subset of the AI golden set, posts one comment with the comparison against `evals/baseline/production.json` and fails on a threshold or a regression. Other PRs do not start it: its workflow lists those files in `paths` (KRB-220). It is not a required check, so they merge without it. A migration that does not touch `prompt_library` starts it and gets a notice. Without the API key secret it runs the mock model. **Evals** runs the full set at night after an AI change (KRB-223), and by hand. `docs/ai-evaluation.md` has the triggers, the limits and what to do when it fails.

## Dependabot (`.github/dependabot.yml`)

Checks npm packages and GitHub Actions once a month (KRB-220). Minor and patch bumps come grouped in one PR for production packages and one for dev packages. Majors come one by one, at most 5 open at a time. Actions are pinned to a commit SHA with the version in a comment, and Dependabot keeps both up to date.

Dependabot does not rebase its PRs on its own: it used to rebase each open PR on every merge to `master`, and each rebase ran CI. To bring one up to date before merging it, comment `@dependabot rebase` on it.

## Branch protection on `master`

GitHub settings, not files, so this part is manual. On a private repo, branch protection and rulesets need GitHub Pro (or a Team plan).

In **Settings > Rules > Rulesets > New branch ruleset**:

- Target: the default branch.
- Restrict deletions, block force pushes.
- Require a pull request before merging, with 1 approval and code owner review. Dismiss stale approvals on new commits.
- Require status checks to pass, with the branch up to date:
  - `Lint, typecheck, unit tests, build`
  - `Database and end-to-end tests`
  - `Lighthouse` (skipped on PRs, which counts as passed)
- Bypass list: add the repository admin role. GitHub does not let an author approve their own PR, so with a single maintainer the admin bypass is the only way to merge your own PRs.

The same ruleset from the terminal:

```sh
gh api repos/mocktar2021/kolab-report-bj/rulesets --method POST --input - <<'JSON'
{
  "name": "master",
  "target": "branch",
  "enforcement": "active",
  "conditions": { "ref_name": { "include": ["~DEFAULT_BRANCH"], "exclude": [] } },
  "bypass_actors": [{ "actor_id": 5, "actor_type": "RepositoryRole", "bypass_mode": "always" }],
  "rules": [
    { "type": "deletion" },
    { "type": "non_fast_forward" },
    {
      "type": "pull_request",
      "parameters": {
        "required_approving_review_count": 1,
        "require_code_owner_review": true,
        "dismiss_stale_reviews_on_push": true,
        "require_last_push_approval": false,
        "required_review_thread_resolution": false
      }
    },
    {
      "type": "required_status_checks",
      "parameters": {
        "strict_required_status_checks_policy": true,
        "required_status_checks": [
          { "context": "Lint, typecheck, unit tests, build" },
          { "context": "Database and end-to-end tests" },
          { "context": "Lighthouse" }
        ]
      }
    }
  ]
}
JSON
```

`actor_id` 5 is the built-in admin repository role.

## Running the same checks locally

```sh
npm run format:check && npm run lint && npm run typecheck && npm test && npm run build
node scripts/audit-production.mjs
npx supabase start
npx supabase db reset && npx supabase test db
npm run db:types && git diff --exit-code src/lib/supabase/database.types.ts
npm run test:e2e
sh scripts/lighthouse-ci.sh
```
