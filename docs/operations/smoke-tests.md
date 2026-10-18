# Smoke tests

A short Playwright suite that checks a deployed environment the way a user would (KRB-161, for the go-live checklist KRB-26). `deploy.yml` runs it after every staging and production deploy, and a failure fails the deploy run. It never starts a local server and never uses the service-role key: it only has the site's URL and a dedicated smoke account, like any user.

```bash
npx playwright install chromium   # once
SMOKE_BASE_URL=https://kolabreport.mocktar.com npx playwright test -c playwright.smoke.config.ts
npx playwright show-report playwright-report/smoke
```

`npm run test:smoke` does the same with `SMOKE_BASE_URL` already exported. Without the account variables, only the public checks run.

## What it checks

Each test carries a tag, so `--grep @public` (or `@sign-up`, `@signed-in`, `@ai`) runs one mode.

| Mode | Runs when | Checks |
| --- | --- | --- |
| `@public` | always | `/api/health` answers 200 with `database: ok`, and reports the deployed commit when `deploy.yml` passes it. The landing, sign-in, sign-up and password reset pages load in French. `/` goes to `/fr`, and `/fr/tableau-de-bord` sends a visitor to sign-in. Wrong credentials get the generic French error, so Supabase Auth answers. The manifest, `sw.js` and icons are served. Every page sends the security headers. The four public pages log no console error, break no CSP rule, and no request to the site answers 4xx or 5xx |
| `@sign-up` | always | The sign-up form shows its three French errors. The server action rejects the input before calling Supabase, so nothing is created |
| `@sign-up` | `SMOKE_SIGNUP_EMAIL` is set | Signs up a new address on that mailbox and expects "Vérifiez votre boîte mail" |
| `@signed-in` | `SMOKE_EMAIL` and `SMOKE_PASSWORD` are set | Signs in through the form and selects the smoke workspace. The dashboard shows its figures and its report. The workspace wizard, with "Nouvelle organisation" picked on the first step, checks each of its three steps, and the check stops before "Créer l'espace de travail". Then it opens the report and its first section, uploads `smoke-<tag>.md`, waits for "Analysé", opens the preview, exports the report as .docx and checks the file. The file is deleted through the page. Then it creates a report `smoke-rapport-<tag>` with "Nouveau rapport", deletes it with "Supprimer le rapport" and checks the dashboard says so (KRB-180). The session is ended |
| `@ai` | also `SMOKE_AI=true` | Uploads `smoke-ia-<tag>.md`, waits for "Analysé", generates a draft, waits for "Brouillon prêt", rejects it, deletes the file. One call to the real model per run |

How this covers the second criterion of KRB-26:

| Criterion | Check |
| --- | --- |
| Signup | Form checks always. A real sign-up with `SMOKE_SIGNUP_EMAIL` |
| Login | `sign in with the smoke account`, plus the wrong credentials check |
| Workspace creation | Each step of the wizard, not submitted (see below). The smoke workspace itself was created with it |
| Report creation and deletion | A report made with "Nouveau rapport" and deleted from its page, on every deploy (KRB-180) |
| Upload, parse | The Markdown file, up to "Analysé" and its preview |
| AI draft | `@ai`, with `SMOKE_AI=true` |
| Dashboard | Figures and report card of the smoke workspace |
| Export | The .docx download, checked as a zip file |

The wizard is never submitted on a deployed site: every run would create a workspace, and an organization unless the smoke one is picked. Since KRB-180 the app can delete both, so the suite could submit it and delete them at the end; for now it works in one smoke workspace made once by hand. Reports are different: each run creates its own with "Nouveau rapport" and deletes it at the end, so nothing is left behind.

## What a run creates and how it is cleaned up

| What | Per run | Cleanup |
| --- | --- | --- |
| `smoke-*.md` files in the smoke section | 1, or 2 with `@ai` | Deleted through the page after each test, failed tests included. The next run deletes any `smoke-*` file left in the section by a run that stopped halfway. Other files in the section are never touched |
| A report `smoke-rapport-<tag>` in the smoke workspace | 1 | Deleted through its page at the end of its test. When a run stops halfway, the same test of the next run deletes every `smoke-rapport-*` report first. Other reports are never touched |
| A .docx export of the smoke report | 1 | Listed in "Exports récents". The storage cleanup job deletes exports after 90 days ([Scheduled jobs](../deployment.md#scheduled-jobs)) |
| A session of the smoke account | 1 | Ended by the `sign out the smoke account` step, which runs even when checks fail |
| A rejected AI generation (`@ai`) | 1 | Kept in the AI usage history on purpose. It shows in the AI dashboard of the smoke workspace and counts toward its budget |
| An unconfirmed account and one e-mail (`SMOKE_SIGNUP_EMAIL`) | 1 | By hand, see below |
| "Section smoke" in the smoke report | only on the first run, when the report has no section | Kept: later runs use it |

Delete the accounts made by the real sign-up check from time to time, in the Supabase dashboard of that project: **Authentication > Users**, search for the address tag (for example `kolabreport-smoke`), select and delete. Or in the SQL editor, with your own mailbox:

```sql
delete from auth.users
where email like 'you+kolabreport-smoke-%@example.com'
  and email_confirmed_at is null;
```

Their profile goes with them. Never click the confirmation links. Each sign-up also uses one of the project's Auth e-mails, 100 an hour since the launch settings (KRB-162, **Auth > Rate Limits**), shared with real users.

## Setup, once per environment

1. **Smoke account.** On the site itself, sign up at `/fr/inscription` with a mailbox you control, for example `you+smoke-staging@example.com`, and a long random password from the password manager. Confirm the address with the e-mail. Use this account for nothing else.
2. **Smoke workspace.** Signed in as that account, create the workspace with the wizard: organization `Smoke tests`, workspace `Smoke tests`, report `Rapport smoke`. Invite nobody. Keep the report as a draft: a final report refuses uploads. The first run adds "Section smoke" to it. The account must stay an owner of the workspace: only owners and admins create and delete reports. Once billing is enforced, the trial allows one active report, so the smoke organization needs a plan with room for a second one (Cabinet or Institution), granted by hand like the owner's other organizations (ADR 001, section 10).
3. **AI drafts** (for `@ai`): the environment needs `AI_DRAFTS_ENABLED=true` and its provider key on Vercel ([deployment](../deployment.md)).
4. **Vercel Deployment Protection.** With the default Standard Protection, Vercel Authentication covers every URL except the production domains: preview deployments, so the staging domain, and the generated deployment URLs, production ones included. Either turn it off for the URL the tests use, or create a **Protection Bypass for Automation** (project **Settings > Deployment Protection**) and store it as `VERCEL_AUTOMATION_BYPASS_SECRET`. The suite trades it for Vercel's bypass cookie before the first test, so the secret is not in the report.
5. **GitHub environment settings** (**Settings > Environments**, on `staging` and on `production`):

| Name | Kind | Value |
| --- | --- | --- |
| `SMOKE_BASE_URL` | variable | Public URL of the environment: `https://kolabreport.mocktar.com` on staging, `https://kolabreport.com` on production. Without it the run is skipped with a warning, so deploys stay green until the setup is done. The URL the deploy step answers is never used: Vercel Authentication protects generated deployment URLs |
| `SMOKE_EMAIL` | secret | E-mail of the smoke account |
| `SMOKE_PASSWORD` | secret | Its password |
| `SMOKE_WORKSPACE_ID` | variable, optional | Id of the smoke workspace, from the URL of its members page `/fr/espaces/<id>/membres`. Without it, the workspace is found by name |
| `SMOKE_WORKSPACE_NAME` | variable, optional | Default `Smoke tests` |
| `SMOKE_AI` | variable, optional | `true` runs the AI draft check |
| `SMOKE_SIGNUP_EMAIL` | secret, optional | Mailbox with plus-addressing for the real sign-up check, for example `you+kolabreport-smoke@example.com`. Each run signs up `you+kolabreport-smoke-<tag>@example.com` |
| `VERCEL_AUTOMATION_BYPASS_SECRET` | secret, optional | See step 4 |

Suggested: on production, set all of them. Releases are rare, so one model call and one test account per release is cheap, and that is what KRB-26 asks for. On staging, which deploys on every merge, set the account and keep `SMOKE_AI` and `SMOKE_SIGNUP_EMAIL` for when you want them.

## In GitHub

`.github/workflows/smoke.yml` holds the job:

- `deploy.yml` calls it after `Deploy to staging` and after `Deploy to production`, with the deployed URL and commit. It checks out that commit, so the tests match the deployed code. A failure fails the deploy run and shows as annotations on it.
- **Actions > Smoke tests > Run workflow** runs it by hand on `staging` or `production`, with `SMOKE_BASE_URL` of that environment. **Use workflow from** picks the branch or tag whose tests run: pick the tag deployed on production.
- The run summary lists which modes ran and why the others did not.
- One run per environment at a time (concurrency group `smoke-<environment>`), since two runs would share the smoke section. A run waiting for its turn is replaced by a newer one.
- It reads the environment's secrets without making a deployment entry. With required reviewers on the environment, it waits for approval like the deploy.
- The `smoke-report-<environment>-<attempt>` artifact holds the HTML report for 14 days, with the trace and a full-page screenshot of each failed test.

The report never holds the password: the sign-in step runs without a trace and keeps the typed values out of the step titles. A failure trace does show the smoke account's e-mail, which the app's sidebar displays, and the session cookie of the run, which the sign-out step ends.

## When it fails

1. Open the failed run. The annotation names the test and the reason. For more, download the artifact and run `npx playwright show-report <folder>`, then open the trace of the failed test.
2. Each test already had one retry. If the failure looks like a network blip, re-run the failed job once.
3. If users are affected (pages down, sign-in broken, console errors), roll back the app in Vercel first ([Rollback](../deployment.md#rollback)), then fix forward. The smoke tests never roll back on their own.

| Failure | Likely cause |
| --- | --- |
| `/api/health` answers 401 or 403 | Vercel Deployment Protection: step 4 of the setup |
| `/api/health` answers 503 | The database is down or slow: [monitoring](monitoring.md) |
| "the site serves another commit than the one just deployed" | The domain points at another deployment: check the domain in Vercel, or a newer deploy has replaced this one |
| Console errors, CSP violations, failed requests | A public page is broken for every visitor. The test lists the messages and paths |
| "The smoke account could not sign in" | The message says why: wrong password, or the address was never confirmed |
| "has no workspace", "is not a workspace the smoke account manages" | Setup step 2, or `SMOKE_WORKSPACE_ID` / `SMOKE_WORKSPACE_NAME` |
| "the smoke report is final" | Reopen the report as a draft |
| "The report was not created: …" | The message is the app's. "Limite de rapports actifs" means the smoke organization has no room for a second report: setup step 2 |
| "the delete action is missing" | The smoke account is not an owner or admin of the smoke workspace any more |
| "reports of the smoke tests are left in the smoke workspace" | The deletion failed: delete the `smoke-rapport-*` reports by hand from their page |
| "The upload failed" | Storage or the upload routes: the function logs of `/api/deliverables/*` |
| "the read of … did not succeed" | The file reader: logs of `/api/deliverables/[id]/complete` |
| No download after "Exporter en .docx" | The export route or the `exports` bucket. The page shows the export error in the screenshot |
| "drafts are off or have no published template" | `AI_DRAFTS_ENABLED` or the provider key on that environment |
| "The draft failed" | Provider error, rate limit or budget: [AI evaluation](../ai-evaluation.md) |
| "files of the smoke tests are left in the section" | The cleanup failed: delete the `smoke-*` files of "Section smoke" by hand |

Do not run the suite from your machine while a deploy runs its own on the same environment: both would work in the smoke section.

## Files

| File | Role |
| --- | --- |
| `playwright.smoke.config.ts` | Projects `public`, `sign-in`, `signed-in` and `sign-out`. One worker, one retry, 60 s per test (3 min for the upload, 4 min for the AI draft), 15 s per action and assertion, 30 s per navigation, 12 min for the run |
| `tests/smoke/support.ts` | The `SMOKE_*` settings and small helpers |
| `tests/smoke/global-setup.ts` | Vercel bypass cookie, and removal of the cookie files at the end |
| `tests/smoke/public.spec.ts`, `tests/smoke/sign-up.spec.ts` | Checks without an account |
| `tests/smoke/sign-in.setup.ts`, `tests/smoke/sign-out.teardown.ts` | The session of the smoke account |
| `tests/smoke/signed-in.spec.ts`, `tests/smoke/section.ts`, `tests/smoke/report.ts` | Signed-in and AI checks |
| `.github/workflows/smoke.yml` | The job, called by `deploy.yml` or run by hand |

The end-to-end suite (`tests/e2e`, `npm run test:e2e`) and the unit tests (`npm test`) do not include these files.
