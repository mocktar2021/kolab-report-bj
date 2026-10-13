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
2. **Auth > SMTP**: a real sender (for example Brevo or Resend). The built-in sender is limited to a few e-mails per hour.
3. **Auth > Email templates**: paste the French templates from `supabase/templates/`, or run `npx supabase link` then `npx supabase config push` (KRB-58).
4. Nothing to create for storage: the `deliverables` bucket and its policies come from the migrations.
5. Keep the database password in your password manager. It goes in the GitHub environment below.

### 2. Vercel project (KRB-131)

1. Import the GitHub repository in Vercel. Framework: Next.js. Leave the build settings at their defaults.
2. `vercel.json` already turns off automatic deployments of `master`, so production only ships through `deploy.yml`. PR branches still get previews.
3. **Settings > Environment Variables**. Set each one for **Preview** with the staging values and for **Production** with the production values:

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
| `EMAIL_PROVIDER` | no | `brevo` or `resend`, for invitation e-mails |
| `EMAIL_FROM` | no | Sender, for example `KolabReport <noreply@kolabreport.com>`, on a domain verified with the provider |
| `BREVO_API_KEY` or `RESEND_API_KEY` | **yes**, mark Sensitive | API key of the chosen provider |

4. Note the **Team ID** (Settings > General, or your account ID on a personal plan) and the **Project ID** (project Settings > General). Create a token in Account Settings > Tokens.
5. Optional: add a staging domain (for example `staging.kolabreport.com`) to the project, and the production domain (KRB-134). HTTPS is automatic.

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
| `SUPABASE_PROJECT_REF` | variable | Project ref of that environment's project |
| `VERCEL_ORG_ID` | variable | Vercel Team ID |
| `VERCEL_PROJECT_ID` | variable | Vercel Project ID |
| `STAGING_DOMAIN` | variable, staging only, optional | Domain to point at each staging deployment |

Last, set the repository variable **`DEPLOY_ENABLED`** to `true` (Settings > Secrets and variables > Actions > Variables). Until then every job in `deploy.yml` is skipped.

## Secrets rules

- Secrets live in Vercel environment variables (marked Sensitive) and GitHub environment secrets, one value per environment. Never in the repository, never in `.env.example`.
- Anything named `NEXT_PUBLIC_*` ships to the browser. CI runs `scripts/check-public-env.mjs`, which fails on names like `NEXT_PUBLIC_*SECRET*` or `NEXT_PUBLIC_*TOKEN*`.
- The service role key bypasses RLS. Only `src/lib/supabase/admin.ts` reads it, and that module is server-only.
- If a secret leaks: rotate it in Supabase, Vercel or the provider first, then update the two places above, then redeploy.

## Releasing

1. Merge to `master`. CI runs, then `deploy.yml` applies the migrations to staging and deploys staging. Check it.
2. Tag the commit: `git tag v0.3.0 <sha> && git push origin v0.3.0`. Or run **Deploy** by hand with target `production` from `master`.
3. The **Check the release** job refuses a commit that is not on `master` or whose CI is not green, and lists the migrations added since the previous tag in the run summary.
4. The production job applies the migrations to production, then builds with the production settings and deploys. With required reviewers turned on, it first waits for your approval in the run.

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

**Database.** Migrations are not rolled back. Because they are expand-only, the previous app version keeps working on the migrated schema. Fix forward with a new migration and a new release. For data loss, restore from Supabase backups (daily backups come with the Pro plan, point-in-time recovery is an add-on) into a new project first, check it, then switch.

**Order for a bad release:** roll back the app in Vercel, open a Jira bug, fix on a branch, merge, tag a new version.
