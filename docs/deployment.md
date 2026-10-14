# Deployment

Three environments, each with its own Supabase project and its own secrets.

| Environment | App | Supabase project | Deployed by |
| --- | --- | --- | --- |
| Local | `npm run dev` / `npm run start` | `npx supabase start` | you |
| Preview | Vercel preview URL per PR | staging | Vercel Git integration, on every PR |
| Staging | Vercel preview deployment of `master` (optional `STAGING_DOMAIN`) | staging | `deploy.yml`, after CI passes on `master` |
| Production | Vercel production deployment | production | `deploy.yml`, on a `v*` tag or a manual run |

Order is always **migrations first, then the app**. A new app version never runs against a database that has not been migrated yet.

## One-time setup

### 1. Supabase projects (KRB-130)

Create two projects, `kolabreport-staging` and `kolabreport-production`, in the **EU West (Paris)** region (`eu-west-3`), next to the Vercel functions (`cdg1` in `vercel.json`). For each one:

1. **Auth > URL Configuration**: Site URL = the app URL of that environment. Redirect URLs: `https://<app-domain>/fr/auth/callback`, plus `https://*-<vercel-team-slug>.vercel.app/**` on staging so PR previews can sign in.
2. **Auth > SMTP** and **Auth > Email templates**: set by the `supabase-auth-emails.yml` workflow from the repository, see [Auth e-mails](#auth-e-mails). Don't use `npx supabase config push` for this: it sends the whole local `[auth]` section, localhost URLs included.
3. Without custom SMTP, Supabase only delivers Auth e-mails to members of the Supabase team, about 30 an hour, from "Supabase Auth".
4. Nothing to create for storage: the `deliverables` and `exports` buckets and their policies come from the migrations.
5. **Database > Publications**: keep Realtime on for `supabase_realtime` (the default). The migrations add `report_sections` to it, so an open master report picks up a new section order from another session. Without Realtime the page still works and refreshes when the tab comes back into focus.
6. Keep the database password in your password manager. It goes in the GitHub environment below.

### 2. Vercel project (KRB-131)

1. Import the GitHub repository in Vercel. Framework: Next.js. Leave the build settings at their defaults.
2. `vercel.json` already turns off automatic deployments of `master` and `production`, so production only ships through `deploy.yml`. PR branches still get previews.
3. Create a `production` branch from `master` on GitHub, then set it as the production branch in **Settings > Environments > Production > Branch Tracking**. Nobody pushes to it. Vercel refuses a Preview domain on its production branch, and the staging domain has to follow `master` (step 6).
4. **Settings > Environment Variables**. Set each one for **Preview** with the staging values and for **Production** with the production values. Mark only the secrets as Sensitive: `deploy.yml` builds with `vercel pull`, which cannot read Sensitive values, so a Sensitive `NEXT_PUBLIC_*` variable reaches the build empty and the build stops.

| Variable | Secret? | Value |
| --- | --- | --- |
| `NEXT_PUBLIC_APP_URL` | no | App URL of the environment |
| `NEXT_PUBLIC_SUPABASE_URL` | no | Project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | no | Anon (publishable) key |
| `SUPABASE_SERVICE_ROLE_KEY` | **yes**, mark Sensitive | Service role key |
| `DATABASE_URL` / `DIRECT_URL` | **yes**, mark Sensitive | Pooler strings, see `.env.example` |
| `ANTHROPIC_API_KEY` / `OPENAI_API_KEY` | **yes**, mark Sensitive | One key per environment |
| `APP_ENV` | no | `staging` or `production` |
| `AI_PROVIDER`, `AI_MODEL`, other `AI_*` | no | See `.env.example` |
| `AI_DRAFTS_ENABLED` | no | `true` only once the eval suite passes on the model of that environment (`evals/README.md`) |
| `LANGFUSE_PUBLIC_KEY` / `LANGFUSE_SECRET_KEY` | **yes** for the secret key, mark Sensitive | Tracing of AI calls, with `AI_TRACING=true` (`docs/ai-evaluation.md`) |
| `AI_FALLBACK_PROVIDER`, `AI_FALLBACK_MODEL`, `AI_FALLBACK_PRICE_INPUT_PER_MTOK`, `AI_FALLBACK_PRICE_OUTPUT_PER_MTOK`, `AI_DAILY_COST_ALERT_USD`, `AI_ALERT_EMAIL` | no | Fallback model, its price, and the daily cost alert, see `.env.example` |
| `EMAIL_PROVIDER` | no | `brevo` or `resend`, for invitation and report e-mails. Without it, or without the matching key, the app shows the invitation link to copy and logs `sendEmail skipped` with the reason |
| `EMAIL_FROM` | no | Sender on a domain verified with the provider, for example `KolabReport <noreply@email.kolabreport.mocktar.com>` with Resend |
| `BREVO_API_KEY` or `RESEND_API_KEY` | **yes**, mark Sensitive | API key of the chosen provider |
| `CRON_SECRET` | **yes**, mark Sensitive | Random string of at least 16 characters, one per environment (`openssl rand -hex 32`). Vercel Cron sends it to the scheduled jobs, see [Scheduled jobs](#scheduled-jobs) |

5. Note the **Team ID** (Settings > General, or your account ID on a personal plan) and the **Project ID** (project Settings > General). Create a token in Account Settings > Tokens.
6. Optional: add the staging domain in **Settings > Domains**, connected to **Preview** and the branch `master`, then add the CNAME record Vercel shows at your DNS provider. `deploy.yml` points it at each staging deployment. The production domain comes with KRB-134. HTTPS is automatic.
7. **Deployment Protection**: Vercel Authentication puts a Vercel login in front of preview domains, the staging domain included. Turn it off when people without a Vercel account test staging. The app's own login still applies.

### 3. GitHub environments (KRB-132)

In **Settings > Environments**, create `staging` and `production`. On a private repository this needs GitHub Pro (the same plan the branch ruleset in `docs/ci.md` needs).

- `staging`: limit deployment branches to `master`.
- `production`: limit deployment branches and tags to `master` and `v*`. That is the release gate: production only deploys when someone pushes a `v*` tag or runs the workflow by hand.
- GitHub offers **Required reviewers** on private repositories only with Enterprise. If the repository becomes public or moves to Enterprise, turn it on for `production` (yourself): the run then also waits for a click.

On each environment:

| Name | Kind | Value |
| --- | --- | --- |
| `SUPABASE_ACCESS_TOKEN` | secret | Supabase personal access token (Account > Access Tokens) |
| `SUPABASE_DB_PASSWORD` | secret | Database password of that environment's project |
| `VERCEL_TOKEN` | secret | Vercel token |
| `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` | secret | 32 random bytes in base64 (`openssl rand -base64 32`), one per environment, never changed afterwards. Next.js derives server action ids from it. Without it every build gets a random key, so a form opened before a deploy fails once the deploy is live |
| `SUPABASE_PROJECT_REF` | variable | Project ref of that environment's project |
| `VERCEL_ORG_ID` | variable | Vercel Team ID |
| `VERCEL_PROJECT_ID` | variable | Vercel Project ID |
| `STAGING_DOMAIN` | variable, staging only, optional | Domain to point at each staging deployment |

Last, set the repository variable **`DEPLOY_ENABLED`** to `true` (Settings > Secrets and variables > Actions > Variables > Repository variables). Until then every job in `deploy.yml` is skipped. It has to be a repository variable: the jobs check it before they enter an environment, so a copy on an environment is never read.

For the backups and the advisors check (KRB-141, KRB-142, KRB-144), on `production`, and on `staging` too if you want it backed up. Each job prints a notice and does nothing while its values are missing. Setup steps: [`docs/operations/backups.md`](operations/backups.md#setup).

| Name | Kind | Value |
| --- | --- | --- |
| `SUPABASE_DB_URL` | secret, optional | Session pooler string of that environment's project (port 5432, same value as `DIRECT_URL` in Vercel), for `backup-database.yml` |
| `BACKUP_AGE_RECIPIENT` | variable, optional | age public key (`age1...`) that encrypts the nightly dump. The private key stays in the password manager. |
| `SUPABASE_S3_ENDPOINT` | secret, optional | `https://<project-ref>.storage.supabase.co/storage/v1/s3`, for `backup-storage.yml` |
| `SUPABASE_S3_REGION` | secret, optional | `eu-west-3` |
| `SUPABASE_S3_ACCESS_KEY_ID` / `SUPABASE_S3_SECRET_ACCESS_KEY` | secret, optional | Storage S3 access key of that project. It reads and deletes every file and bypasses RLS. |
| `BACKUP_S3_ENDPOINT` | secret, optional | Off-site bucket endpoint, `https://<account-id>.eu.r2.cloudflarestorage.com` for Cloudflare R2 in the EU |
| `BACKUP_S3_ACCESS_KEY_ID` / `BACKUP_S3_SECRET_ACCESS_KEY` | secret, optional | R2 API token with Object Read & Write on that bucket only |
| `BACKUP_S3_BUCKET` | secret, optional | Bucket name, for example `kolabreport-backup-production` |
| `BACKUP_S3_PROVIDER` | variable, optional | rclone provider name of the off-site bucket. Default `Cloudflare`. |
| `BACKUP_MAX_DELETE` | variable, optional | Most files one run may remove from a bucket's mirror before it stops with an error. Default `200`. Raise it for one run after a large deletion ([`backups.md`](operations/backups.md)). |

Every deploy ends with the smoke tests (KRB-161). Their settings go on the same two environments: `SMOKE_BASE_URL`, the smoke account (`SMOKE_EMAIL`, `SMOKE_PASSWORD`) and the optional ones, listed in [`docs/operations/smoke-tests.md`](operations/smoke-tests.md#setup-once-per-environment) with the one-time setup of the account and its workspace. Without them only the public checks run.

`supabase-advisors.yml` reuses `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` from the first table. The repository variable **`ADVISORS_ENVIRONMENTS`** (optional, a JSON list such as `["staging"]`) picks the environments it checks. Without it, it checks `staging` and `production`.

## Secrets rules

- Secrets live in Vercel environment variables (marked Sensitive) and GitHub environment secrets, one value per environment. Never in the repository, never in `.env.example`.
- Anything named `NEXT_PUBLIC_*` ships to the browser. CI runs `scripts/check-public-env.mjs`, which fails on names like `NEXT_PUBLIC_*SECRET*` or `NEXT_PUBLIC_*TOKEN*`.
- The service role key bypasses RLS. Only `src/lib/supabase/admin.ts` reads it, and that module is server-only.
- If a secret leaks: rotate it in Supabase, Vercel or the provider first, then update the two places above, then redeploy.

## Scheduled jobs

`vercel.json` declares the Vercel Cron jobs. Vercel runs them on the production deployment only, so staging never runs them on its own.

| Path | Schedule (UTC) | What it does |
| --- | --- | --- |
| `/api/cron/storage-cleanup` | `0 3 * * *`, once a day | Deletes the exports made with the export buttons that are more than 90 days old, then removes from Storage the files of deleted deliverables, exports, reports and workspaces (KRB-166). The PDF stored when a report became final stays as long as the report. |

How the storage cleanup works:

- Deleting a row of `deliverables` or `report_exports`, directly or through a deleted report or workspace, queues the file's path in `private.storage_cleanup_queue` (a trigger, in the same transaction).
- The job takes the queue in batches of 100 and removes the objects with the service role. It stops after 45 seconds and the next run carries on.
- The file of a deliverable waits until 2 hours 15 minutes after it was registered: until then its signed upload URL can still put a file at that path.
- A failed removal stays in the queue with its error and is tried again the next day.

Setup: set `CRON_SECRET` on the Vercel project (table above). Vercel sends it as `Authorization: Bearer <CRON_SECRET>`. Without it, or with fewer than 16 characters, the route answers 401 to every call and logs why. On the Hobby plan a daily job runs at some point within the scheduled hour.

To run it by hand, for example on staging:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<app-domain>/api/cron/storage-cleanup
```

It answers counts only, for example `{"expiredExports":0,"removed":12,"failed":0,"timedOut":false,"ok":true}`. `timedOut: true` means the queue was not empty after 45 seconds. A 500 means a database call or a removal failed: check the function logs. Failed removals stay queued for the next run. To see what is waiting, in the SQL editor:

```sql
select bucket, count(*), max(attempts), max(last_error) from private.storage_cleanup_queue group by bucket;
```

## Backups and monitoring

Three scheduled GitHub workflows run from `master`, next to the Vercel Cron job above. GitHub e-mails their failures.

| Workflow | Schedule (UTC) | What it does |
| --- | --- | --- |
| `backup-database.yml` | `41 1 * * *` | Logical dump of the production database, encrypted with age, kept 14 days as an artifact (KRB-141) |
| `backup-storage.yml` | `11 2 * * *` | Copies the `deliverables` and `exports` buckets to an R2 bucket in the EU, deleted files kept 30 days (KRB-142) |
| `supabase-advisors.yml` | `23 6 * * *` | Security and performance advisors of each project, fails on an `ERROR` lint (KRB-144) |

The runbooks are in `docs/operations/`:

- [`backups.md`](operations/backups.md): what Supabase backs up per plan, our RPO and RTO, setup, the restore drill and its log.
- [`monitoring.md`](operations/monitoring.md): uptime check on `/api/health`, Sentry, logs, advisors and database metrics.
- [`smoke-tests.md`](operations/smoke-tests.md): the checks that run after each deploy, their setup, what they leave behind and what to do when they fail.

## Auth e-mails

Confirmation, password reset, invitation and e-mail change messages come from Supabase Auth, not from the app. `supabase-auth-emails.yml` (KRB-170) pushes them to a project from the repository:

- the French subjects and templates declared in `supabase/config.toml` (`supabase/templates/*.html`), always;
- the custom SMTP sender, once `SMTP_PASS` and `SMTP_ADMIN_EMAIL` are set on the environment;
- the site URL and redirect URLs, once `AUTH_SITE_URL` is set.

It changes only those fields (`scripts/supabase-auth-emails.mjs`, `--dry-run` lists them). A push to `master` that touches the templates updates staging. Run it by hand for production: **Actions > Supabase Auth e-mails > Run workflow**.

Setup, per GitHub environment (`staging`, `production`):

| Name | Kind | Value |
| --- | --- | --- |
| `SMTP_PASS` | secret | A Resend API key with **Sending access** on the verified domain only, for example named `kolabreport-supabase-smtp-staging` |
| `SMTP_ADMIN_EMAIL` | variable | Sender address on the verified domain, for example `noreply@email.kolabreport.mocktar.com` |
| `SMTP_SENDER_NAME` | variable, optional | Default `KolabReport` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` | variables, optional | Default `smtp.resend.com`, `465`, `resend`. Set them for Brevo or another provider |
| `AUTH_SITE_URL` | variable, optional | The app's origin, for example `https://kolabreport.mocktar.com`. Then the redirect list is `<origin>/**` |
| `AUTH_REDIRECT_URLS` | variable, optional | More redirect URLs, separated by commas, for example `https://*-<vercel-team-slug>.vercel.app/**` on staging |

`SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` are the ones `deploy.yml` already uses. With custom SMTP, Supabase starts at 30 Auth e-mails an hour (**Auth > Rate Limits**); raise it if needed.

## Releasing

1. Merge to `master`. CI runs, then `deploy.yml` applies the migrations to staging, deploys staging and runs the smoke tests on it. Check it.
2. Tag the commit: `git tag v0.3.0 <sha> && git push origin v0.3.0`. Or run **Deploy** by hand with target `production` from `master`.
3. The **Check the release** job refuses a commit that is not on `master` or whose CI is not green, and lists the migrations added since the previous tag in the run summary.
4. The production job applies the migrations to production, then builds with the production settings and deploys. With required reviewers turned on, it first waits for your approval in the run.
5. The smoke tests run on production. When they fail, the run fails: [`docs/operations/smoke-tests.md`](operations/smoke-tests.md#when-it-fails) says what to check, and when to roll back.

## Writing migrations

Production keeps serving the previous app version while a migration runs, and a rollback only rolls back the app. So every migration must work with both the old and the new app version (expand, then contract):

- **Add, don't change.** New columns are nullable or have a default. New tables come with their RLS policies in the same file.
- **Renaming a column or table takes two releases.** First add the new one, write to both and backfill. Remove the old one in a later release, once no deployed version reads it.
- **No destructive change without a backfill**: no `drop column`, `drop table` or type narrowing until the data is copied and the code no longer uses it.
- **Keep locks short.** On large tables, put data backfills in their own migration and check how long they lock the table on staging before releasing.
- **Never edit a migration that has run on staging.** Write a new one.
- Run `npx supabase db reset`, `npx supabase test db` and `npm run db:types` locally. CI does the same, and fails if the types are stale.

## Rollback

**App.** In Vercel, open the project, **Deployments**, pick the last good production deployment and choose **Instant Rollback**. From a terminal: `npx vercel rollback <deployment-url> --token=...`. It takes a few seconds and needs no rebuild. After a rollback, Vercel stops moving the production domain to new deployments: once the fix is deployed, promote it in the dashboard or with `npx vercel promote <deployment-url>`.

**Database.** Migrations are not rolled back. Because they are expand-only, the previous app version keeps working on the migrated schema. Fix forward with a new migration and a new release. For data loss, restore into a new project first, check it, then switch: from the nightly dump on the Free plan, from Supabase's daily backups or point-in-time recovery on Pro. Storage files come back from the R2 copy. Steps: [`docs/operations/backups.md`](operations/backups.md#restore-drill).

**Order for a bad release:** roll back the app in Vercel, open a Jira bug, fix on a branch, merge, tag a new version.
