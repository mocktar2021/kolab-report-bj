# Continuous integration

Every pull request and every push to `master` runs two workflows in GitHub Actions. A third one, `deploy.yml`, ships `master` to staging and tags to production, then runs the smoke tests (`smoke.yml`) on what it deployed (see `docs/deployment.md` and `docs/operations/smoke-tests.md`).

## CI (`.github/workflows/ci.yml`)

**Lint, typecheck, unit tests, build** runs in about 4 minutes:

1. `npm ci` with the npm cache from `actions/setup-node`.
2. Writing check on the PR: commit messages and changed files go through `write-like-mocktar` (skipped for Dependabot).
3. `format:check`, `lint`, `typecheck` and `npm test`.
4. `scripts/check-public-env.mjs` fails on `NEXT_PUBLIC_` variables named like secrets, since those ship to the browser.
5. `node scripts/audit-production.mjs` runs `npm audit --omit=dev` and fails on any high or critical advisory, unless `.github/accepted-advisories.json` accepts it. An accepted entry gives the GHSA id, the direct dependencies it may come through, the reason it does not apply and an expiry date. The job fails again once that date passes, or when the advisory comes through another dependency. What is accepted and why: `docs/security/dependencies.md`.
6. `next build` with placeholder Supabase variables and the `.next/cache` restored.

**Database and end-to-end tests** starts the local Supabase stack with the CLI version from `package-lock.json`, then:

1. `supabase db reset` applies every migration from an empty database.
2. `supabase test db` runs the pgTAP suite in `supabase/tests/`.
3. `npm run db:types` regenerates `src/lib/supabase/database.types.ts`. The job fails if the result differs from the committed file, so a migration always ships with its types.
4. Writes `.env.local` from `supabase status` (`scripts/ci-env-local.sh`), builds the app and runs the Playwright suite. Traces are kept as an artifact when a test fails.

The job takes 15 to 20 minutes: about 5 to start the stack and build, the rest for the Playwright suite on one worker. A slow runner adds about 30%, so the job stops at 35 minutes. When the suite alone passes 20 minutes on a normal runner, split it in two shards rather than raising the limit again (KRB-188).

**Lighthouse** (KRB-153) starts the same local stack, writes the same `.env.local` and builds the same way, then runs `npx lhci autorun`: Lighthouse mobile, 3 runs on `/fr/connexion` and 3 on `/fr/tableau-de-bord` signed in as the seeded demo user. It fails when a median score is under the KRB-25 targets: performance 85, accessibility 95, best practices 95. The dashboard's performance floor is 65 until KRB-172 brings it to 85. The HTML and JSON reports are kept as the `lighthouse-reports` artifact for 14 days. It runs next to the end-to-end job, so it adds no wall-clock time to CI. Thresholds, budgets and how to run it locally: `docs/performance.md`.

All three jobs run on every PR, not only on PRs that touch `supabase/`, so they can be required checks.

## CodeQL (`.github/workflows/codeql.yml`)

Runs the `security-extended` queries on JavaScript and TypeScript on pushes to `master`, on PRs that touch code, and every Monday. The repo is private, so uploading to the Security tab needs GitHub Code Security. Until it is on, the results stay in the run: they are listed in the job summary, kept as a SARIF artifact, and any finding fails the job.

A finding that was reviewed and judged safe goes in `.github/codeql/accepted-findings.json` with its rule, file and the reason. The job then skips it. Keep that list short and review it when the file changes.

## Evals (`.github/workflows/evals-pr.yml`, `.github/workflows/evals.yml`)

On a PR that changes a prompt template migration, an output schema, the context builder, the repair logic, a model id or `evals/`, **Evals on PR** runs the `pr` subset of the AI golden set, posts one comment with the comparison against `evals/baseline/production.json` and fails on a threshold or a regression. Other PRs get a notice and no comment. Without the API key secret it runs the mock model. **Evals** runs the full set every night and by hand. `docs/ai-evaluation.md` has the triggers, the limits and what to do when it fails.

## Dependabot (`.github/dependabot.yml`)

Checks npm packages and GitHub Actions every Monday. Minor and patch bumps come grouped in one PR for production packages and one for dev packages. Majors come one by one, at most 5 open at a time. Actions are pinned to a commit SHA with the version in a comment, and Dependabot keeps both up to date.

## Branch protection on `master`

GitHub settings, not files, so this part is manual. On a private repo, branch protection and rulesets need GitHub Pro (or a Team plan).

In **Settings > Rules > Rulesets > New branch ruleset**:

- Target: the default branch.
- Restrict deletions, block force pushes.
- Require a pull request before merging, with 1 approval and code owner review. Dismiss stale approvals on new commits.
- Require status checks to pass, with the branch up to date:
  - `Lint, typecheck, unit tests, build`
  - `Database and end-to-end tests`
  - `Lighthouse`
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
npx lhci autorun
```
