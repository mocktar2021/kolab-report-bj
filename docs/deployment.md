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
2. **Auth > SMTP**, **Auth > Email templates**, the password policy, the rate limits and the captcha: set by the `supabase-auth-settings.yml` workflow from the repository, see [Auth settings](#auth-settings). Don't use `npx supabase config push` for this: it sends the whole local `[auth]` section, localhost URLs included.
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
| `NEXT_PUBLIC_TURNSTILE_SITE_KEY` | no | Cloudflare Turnstile site key. Without it the forms show no captcha. Set it before turning the captcha on in Supabase, see [Turnstile captcha](#turnstile-captcha) |
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
| `ACCOUNT_DELETION_LOG_EMAIL` | no | Mailbox, read by operators only, that gets the account id and the date of each account deleted in the app. It is the list to delete again after a backup restore (`docs/gdpr/data-subject-requests.md`, step 7). Needs `EMAIL_PROVIDER`. Empty: deletions still work and the app logs a warning once |
| `CRON_SECRET` | **yes**, mark Sensitive | Random string of at least 16 characters, one per environment (`openssl rand -hex 32`). Vercel Cron sends it to the scheduled jobs, see [Scheduled jobs](#scheduled-jobs) |
| `FEDAPAY_ENVIRONMENT` | no | `sandbox` for Preview, `live` for Production. Anything else turns payments off, see [FedaPay](#4-fedapay-krb-176) |
| `FEDAPAY_SECRET_KEY` | **yes**, mark Sensitive | Secret API key of the FedaPay account: the sandbox one for Preview, the live one for Production |
| `FEDAPAY_WEBHOOK_SECRET` | **yes**, mark Sensitive | Secret of the webhook endpoint created in that FedaPay account |
| `FEDAPAY_API_BASE_URL` | no | Leave it unset on Vercel. Only the mock uses it, locally and in CI. Production refuses any value |
| `BILLING_ALERT_EMAIL` | no | Operator address for payment alerts: a payment in review, a refund, a payment that cannot be granted. Without it the alerts are only logged |

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

Every deploy ends with the smoke tests (KRB-161). Their settings go on the same two environments: `SMOKE_BASE_URL`, the smoke account (`SMOKE_EMAIL`, `SMOKE_PASSWORD`) and the optional ones, listed in [`docs/operations/smoke-tests.md`](operations/smoke-tests.md#setup-once-per-environment) with the one-time setup of the account and its workspace. Without `SMOKE_BASE_URL` the smoke run is skipped with a warning; without the account, only the public checks run.

`supabase-advisors.yml` reuses `SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` from the first table. The repository variable **`ADVISORS_ENVIRONMENTS`** (optional, a JSON list such as `["staging"]`) picks the environments it checks. Without it, it checks `staging` and `production`.

### 4. FedaPay (KRB-176)

Owners pay the offers through FedaPay: the app sends them to FedaPay's payment page, FedaPay calls a webhook when the payment changes, and the app grants the offer after reading the transaction back from FedaPay's API. How it is protected: [`docs/security/fedapay-webhook.md`](security/fedapay-webhook.md). Design: [ADR 001](adr/001-billing-and-fedapay.md), section 8.

FedaPay has two separate accounts in one dashboard: test (sandbox) and live. Staging and PR previews use the sandbox, production uses live. Do the steps below once in each.

1. **API keys**: on the API keys page of the FedaPay dashboard, copy the secret key into `FEDAPAY_SECRET_KEY` on Vercel (Preview for the sandbox key, Production for the live key), marked Sensitive. Set `FEDAPAY_ENVIRONMENT` to `sandbox` for Preview and `live` for Production. The app needs no public key.
2. **Webhook**: on the Webhooks page of the dashboard, create one:
   - URL on staging (sandbox account): `https://kolabreport.mocktar.com/api/billing/fedapay/webhook`
   - URL on production (live account): `https://<production domain>/api/billing/fedapay/webhook`, once the production domain is set up (KRB-134)
   - Events: every `transaction.*` event.
   - Untick **"Désactiver le webhook lorsque l'application génère des erreurs"**. Otherwise ten failed deliveries during an outage switch the webhook off for good.
   - Copy the endpoint's secret into `FEDAPAY_WEBHOOK_SECRET` on Vercel, in the same environment as the key, marked Sensitive.
3. **Staging behind Vercel Authentication**: Deployment Protection (step 7 of the Vercel project) answers 401 to FedaPay on the staging domain. Either turn it off for the staging domain, or create a secret in **Vercel > Settings > Deployment Protection > Protection Bypass for Automation**, and add it to the sandbox webhook as the custom header `x-vercel-protection-bypass: <secret>`. Production has no such protection.
4. **Redeploy** the environment: the app reads these variables when it starts.
5. **Check** with the sandbox checklist of ADR 001, section 13, items 1 to 9. The test mobile money method is `momo_test`, with 66000001 for a payment that succeeds and any other number for one that fails.

How the environments meet:

- PR previews share the staging database and the sandbox account. `NEXT_PUBLIC_APP_URL` of Preview is the staging domain, so FedaPay sends the buyer back to staging, and the webhook only calls staging. Both write to the same database, so a payment started on a preview is granted there.
- A deployment only applies purchases of its own FedaPay environment, and production refuses anything but `live`. A sandbox payment can never grant on production.
- Locally and in CI, `FEDAPAY_ENVIRONMENT=mock` points the app at `tests/fedapay-mock/server.mjs`, which Playwright starts on port 4010 (`scripts/ci-env-local.sh` writes the values).

If a key or the webhook secret leaks: regenerate it in the FedaPay dashboard, update Vercel, redeploy. A webhook signed with the old secret then gets 401.

To find purchases that are stuck, in the SQL editor:

```sql
select id, offer, status, review_reason, amount_xof, fedapay_status, created_at, last_checked_at
from public.billing_purchases
where status in ('pending', 'review') and created_at < now() - interval '1 hour'
order by created_at;
```

A `review` purchase was paid at FedaPay with an amount, currency, merchant reference or environment that does not match. Check the transaction in the FedaPay dashboard, then grant by hand (KRB-179) or refund it.

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
- The same run deletes the events of the deletion log (`private.audit_events`, KRB-180) older than 12 months.

Setup: set `CRON_SECRET` on the Vercel project (table above). Vercel sends it as `Authorization: Bearer <CRON_SECRET>`. Without it, or with fewer than 16 characters, the route answers 401 to every call and logs why. On the Hobby plan a daily job runs at some point within the scheduled hour.

To run it by hand, for example on staging:

```bash
curl -H "Authorization: Bearer $CRON_SECRET" https://<app-domain>/api/cron/storage-cleanup
```

It answers counts only, for example `{"expiredExports":0,"expiredAuditEvents":0,"removed":12,"failed":0,"timedOut":false,"ok":true}`. `timedOut: true` means the queue was not empty after 45 seconds. A 500 means a database call or a removal failed: check the function logs. Failed removals stay queued for the next run. To see what is waiting, in the SQL editor:

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

## Auth settings

Confirmation, password reset, invitation and e-mail change messages come from Supabase Auth, not from the app, and so do the password policy, the rate limits and the captcha check. `supabase-auth-settings.yml` (KRB-170, KRB-58) pushes them to a project from the repository:

- the French subjects and templates declared in `supabase/config.toml` (`supabase/templates/*.html`), always;
- the password policy and the rate limits of `supabase/config.toml`, always (see below);
- the custom SMTP sender and the e-mail rate limit, once `SMTP_PASS` and `SMTP_ADMIN_EMAIL` are set on the environment;
- the site URL and redirect URLs, once `AUTH_SITE_URL` is set;
- the Turnstile captcha, once `AUTH_CAPTCHA_ENABLED` is `true` and `TURNSTILE_SECRET_KEY` is set (see [Turnstile captcha](#turnstile-captcha)).

It changes only those fields (`scripts/supabase-auth-settings.mjs`, `--dry-run` lists them) and prints field names, never values. A push to `master` that touches `supabase/config.toml` or the templates updates staging. Run it by hand for production: **Actions > Supabase Auth settings > Run workflow**.

Setup, per GitHub environment (`staging`, `production`):

| Name | Kind | Value |
| --- | --- | --- |
| `SMTP_PASS` | secret | A Resend API key with **Sending access** on the verified domain only, for example named `kolabreport-supabase-smtp-staging` |
| `SMTP_ADMIN_EMAIL` | variable | Sender address on the verified domain, for example `noreply@email.kolabreport.mocktar.com` |
| `SMTP_SENDER_NAME` | variable, optional | Default `KolabReport` |
| `SMTP_HOST` / `SMTP_PORT` / `SMTP_USER` | variables, optional | Default `smtp.resend.com`, `465`, `resend`. Set them for Brevo or another provider |
| `AUTH_SITE_URL` | variable, optional | The app's origin, for example `https://kolabreport.mocktar.com`. Then the redirect list is `<origin>/**` |
| `AUTH_REDIRECT_URLS` | variable, optional | More redirect URLs, separated by commas, for example `https://*-<vercel-team-slug>.vercel.app/**` on staging |
| `TURNSTILE_SECRET_KEY` | secret, optional | Secret key of the Turnstile widget |
| `AUTH_CAPTCHA_ENABLED` | variable, optional | `true` turns the captcha on, `false` turns it off. Unset leaves it as it is. Set `true` only after the steps below |

`SUPABASE_ACCESS_TOKEN` and `SUPABASE_PROJECT_REF` are the ones `deploy.yml` already uses.

### Password policy and rate limits

`supabase/config.toml` holds the values for the local stack and the hosted projects. Change them there, the workflow pushes them on the merge to `master`.

Passwords need **10 characters, with at least one letter (a to z, without accent) and one digit** (`minimum_password_length = 10`, `password_requirements = "letters_digits"`). This refuses a 10 digit phone number or a single word such as `motdepasse`, and asks for no capital letter or symbol, which are slow to type on a phone and push people toward `Motdepasse1!`. The sign-up and new password forms check the same rules (`src/lib/auth/password-policy.ts`, and a test fails if the two drift apart). Existing accounts with a shorter password still sign in: the rule applies when they choose a new one. Supabase's leaked password check needs the Pro plan; turn it on in **Auth > Providers > Email** once the project is on Pro.

| `[auth.rate_limit]` key | Management API field | Value | What it limits |
| --- | --- | --- | --- |
| `sign_in_sign_ups` | `rate_limit_otp` | 30 per 5 minutes, per IP | Sign-ups, reset requests, resent e-mails and password changes |
| `token_verifications` | `rate_limit_verify` | 30 per 5 minutes, per IP | Confirmation and reset links opened (`/fr/auth/callback`) |
| `token_refresh` | `rate_limit_token_refresh` | 150 per 5 minutes, per IP | Password sign-ins and session refreshes |
| `email_sent` | `rate_limit_email_sent` | 30 per hour, whole project | Auth e-mails. Sent only with custom SMTP, which it needs |

The forms and the middleware call Supabase from the Vercel servers, so the per IP limits count many visitors behind a few Vercel addresses. That is why they stay at the Supabase defaults: lower values would block real users first, and the captcha stops scripts. If people see "Trop de tentatives" at busy times, raise `token_refresh` or `sign_in_sign_ups`. SMS, anonymous and Web3 sign-ins are off, so their limits are not pushed.

### Turnstile captcha

Cloudflare Turnstile protects sign-up, sign-in and reset requests. The widget is on the three forms, and Supabase Auth checks the token: once the captcha is on, Supabase refuses `/signup`, `/recover` and password sign-in without a valid token. So the order matters. **Deploy the app with the site key first, then turn the captcha on in Supabase.** The other way round, nobody can sign up, sign in or reset a password until the app catches up.

1. **Cloudflare**: **Turnstile > Add widget**. Name `KolabReport`, mode **Managed**, pre-clearance **No**. Hostnames: `kolabreport.mocktar.com` (it covers its subdomains, a staging domain under it included) and the production domain if it is another one. Copy the site key and the secret key.
2. **Vercel**, **Settings > Environment Variables**: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = the site key, for **Production**, not marked Sensitive (`vercel pull` cannot read Sensitive values, and the build inlines this one). For **Preview**, see the note below.
3. **Deploy**: a variable change on Vercel needs a new build. Run **Deploy** again for staging, or tag a release for production: `deploy.yml` builds with the key (`vercel pull` brings it). Open `/fr/inscription` and check the "Vérification anti-robot" box shows and passes. Sign-up and sign-in keep working: Supabase ignores the token while its captcha is off.
4. **GitHub**, on the environment you just deployed (`production` for Vercel's Production): add the secret `TURNSTILE_SECRET_KEY` = the secret key, then the variable `AUTH_CAPTCHA_ENABLED` = `true`.
5. **Actions > Supabase Auth settings > Run workflow** for that environment. The log lists `security_captcha_enabled`, `security_captcha_provider` and `security_captcha_secret`. The script refuses to run when `AUTH_CAPTCHA_ENABLED` is `true` without the secret.
6. Check: create an account with a new address, sign in, and request a reset link.

To turn it off, for example if the widget fails for everyone, set `AUTH_CAPTCHA_ENABLED` to `false` and run the workflow again. Remove the site key from Vercel only after that.

**Preview and staging.** Vercel builds PR previews and the staging deployment with the Preview variables. Turnstile does not accept wildcard hostnames, so the real site key fails on `*.vercel.app` preview URLs. Pick one:

- Use Cloudflare's test keys on staging: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` = `1x00000000000000000000AA` for Preview on Vercel, and `TURNSTILE_SECRET_KEY` = `1x0000000000000000000000000000000AA` on the `staging` GitHub environment. The widget always passes, so previews keep working and staging runs the whole captcha path, without real protection.
- Or leave Preview without a site key and `staging` without `AUTH_CAPTCHA_ENABLED`: no captcha on staging.

Locally and in CI there is no site key and the local Supabase stack keeps its captcha off (`[auth.captcha]` is commented out in `supabase/config.toml`), so the e2e tests need no widget. The test helpers that sign in with the anon key would fail against a project with the captcha on: they only run against the local stack.

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
