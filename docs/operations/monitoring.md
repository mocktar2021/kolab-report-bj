# Monitoring

Where to look when something breaks in staging or production.

## Logs

Server code logs through `log` from `src/lib/log` (KRB-138), never through `console`. Client components and scripts keep `console`.

### Line format

One JSON object per line:

```json
{"level":"error","msg":"exports: could not store the file","time":"2026-10-14T16:02:11.402Z","requestId":"cdg1::iad1::abcde-1760450000000-0123456789ab","error":"The resource already exists"}
```

| Key | Holds |
| --- | --- |
| `level` | `info`, `warn` or `error` |
| `msg` | A fixed English text, `area: what happened`. It never changes, so you can search on it |
| `time` | When the code logged, ISO 8601 in UTC |
| `requestId` | The id of the request, `null` outside one (at startup, for example) |
| any other key | What changes from one line to the next: ids, counts, the error |

`info` and `warn` lines go to stdout, `error` lines to stderr. Vercel shows stdout as info and stderr as error, so a `warn` line shows as info in the dashboard. Filter on the `level` key of the line instead.

The logger keeps these out of every line:

- Text under a key that looks like `email`, `password`, `token`, `secret`, `authorization`, `cookie`, `api_key`, `content`, `prompt`, `output` or `markdown` becomes `"[redacted]"`, at any depth. Numbers and booleans stay, so `outputTokens: 300` still shows.
- An e-mail address in any text becomes `[email]`.
- An error becomes `{ name, message, stack }`, plus its `cause`. Its other properties are dropped: AI SDK errors carry the request they failed on, prompt included.

These rules catch mistakes. Still, never pass report text, file contents or a person's e-mail in a field: log the id of the row instead.

### Request ids

Every line of a request carries the same id:

- **Pages and server actions**: the middleware (`src/middleware.ts`) takes Vercel's `x-vercel-id`, or makes up a UUID when it is missing (locally). It passes the id to the page in the request header `x-request-id`, which `headers()` reads, and returns it in the `x-request-id` response header.
- **Route handlers under `/api`**: the middleware skips them. The ones that log are wrapped in `withRequestId`, which picks the id the same way and returns `x-request-id` too. Wrap any new route handler that logs.
- **Work after the answer**: `after()`, the AI draft stream and the parse worker keep the id of the request that started them.

`getRequestId()` from `src/lib/log` returns the id, for example to tag an error report.

### Find the lines of a request

1. Get the id. Someone reporting a problem can copy the `x-request-id` response header from the browser's network tab. On Vercel it is the same value as the `x-vercel-id` header.
2. In the Vercel dashboard, open the project's **Logs** tab and paste the id in the search box. The free text search covers the log message, which is our JSON line. Use the search box, not the `requestId` filter: that filter works on Vercel's own id.
3. Widen the time range if the lines are older than the default view.

Vercel keeps runtime logs 1 hour on Hobby, 1 day on Pro and 30 days with Observability Plus. Per request it keeps at most 256 lines and 1 MB, and 256 KB per line.

### Log drains (later)

A drain sends every log line to another service, which keeps it longer and indexes it. Drains need the Vercel **Pro** plan (or Enterprise), and Vercel bills their usage on top of the plan. Nothing changes in the app: the lines are already JSON.

Set one up once 1 day of logs is too short:

1. Vercel dashboard > **Team Settings > Drains > Add Drain**, for **Logs**.
2. Projects: KolabReport. Sources: at least functions, where our lines come from. Environments: production, plus preview for staging.
3. Point it at the service:
   - **Better Stack**: create an HTTP source in Better Stack Telemetry. In Vercel, pick a custom endpoint with the NDJSON format, the endpoint `https://<ingesting host>` and a custom header `Authorization: Bearer <source token>`. The host and the token are on the source's **Configure** page.
   - **Axiom**: install the Axiom app from the Vercel Marketplace and select the project. It creates the drain and sends the logs to the `vercel` dataset.
4. Open a page, copy its `x-request-id` and check that its lines arrive.

Each drained entry holds our line in its `message` field, next to Vercel's own fields (path, status code, deployment). Search on the id as text, or parse the line. In Axiom:

```kusto
['vercel']
| extend line = parse_json(message)
| where line.requestId == "cdg1::iad1::abcde-1760450000000-0123456789ab"
```

The Better Stack source token is a secret: keep it in your password manager with the others (`docs/deployment.md`).

## Sentry

Sentry gets the errors of the browser, server components, route handlers, server actions and the middleware (KRB-136). Each event carries the release (the git commit SHA), the environment and the Supabase user id, and its stack trace is readable thanks to the source maps uploaded during the build. Sentry is off until `NEXT_PUBLIC_SENTRY_DSN` is set: without it nothing initializes and nothing is sent.

### What it sends

| Sent | Never sent |
| --- | --- |
| Error type, message and stack trace | E-mail, name or IP address of the user |
| Release, environment: `production` (Vercel Production), `staging` (Vercel Preview, PR previews included), `development` (everything else) | Cookies, request bodies, headers other than `user-agent` and `content-type` |
| User id (Supabase UUID), only on pages and requests of a signed-in user | Query strings and fragments of URLs, invitation tokens, auth codes |
| Page URL and route without the query string, browser and OS | Report text, section content, AI prompts and outputs, local variables |
| Breadcrumbs (clicks, navigations, requests, console lines), scrubbed the same way | Session Replay, user feedback, profiles, Sentry Logs and Metrics: none is set up |

On top of errors, the browser sends 1 page load or navigation trace in 10 in production, none elsewhere, and session counts for crash-free rates. The server sends errors only.

The SDK collects as little as it can (`dataCollection` in `src/lib/monitoring/options.ts`), then `src/lib/monitoring/scrub.ts` cleans every event, breadcrumb and span before it leaves: it keeps the user id only, drops `extra`, cookies, bodies and headers, strips query strings, and masks e-mails, `/fr/invitations/<token>`, auth codes and the model output that AI SDK errors put in their message. Its tests are in `scrub.test.ts`. Change both together.

### How it is wired

| File | Role |
| --- | --- |
| `src/instrumentation-client.ts` | Starts Sentry in the browser, names navigations (`onRouterTransitionStart`) |
| `src/instrumentation.ts` | Starts Sentry on the Node.js and Edge runtimes, reports request errors (`onRequestError`) |
| `src/lib/monitoring/options.ts` | Options shared by all three: DSN, release, environment, sample rates, data collection |
| `src/lib/monitoring/release.mjs` | Release and environment, computed at build time by `next.config.mjs` |
| `src/lib/supabase/user.ts`, `src/components/monitoring/monitoring-user.tsx` | Set the user id on the server (`getCurrentUser`) and in the browser (signed-in layout) |
| `next.config.mjs` | `withSentryConfig`: tunnel, source map upload, release |

- **Tunnel**: the browser posts events to `/monitoring` on our own origin and Next.js passes them on to Sentry's EU ingest host. The CSP keeps `connect-src` to `'self'` and Supabase, and ad blockers don't drop the events. `src/middleware.ts` skips `/monitoring`. The server sends its events to Sentry directly.
- **OpenTelemetry**: Sentry runs with `enableOpenTelemetrySetup: false` and no server tracing, so it registers no tracer provider. The AI tracing (`AI_TRACING=true`, `docs/ai-evaluation.md`) keeps its own and still exports its spans.
- **Source maps**: the build uploads them only when `SENTRY_AUTH_TOKEN`, `SENTRY_ORG` and `SENTRY_PROJECT` are all set, then deletes the browser ones so they never ship. A failed upload prints a warning and the build goes on. CI and local builds have none of the three and skip the upload without a word.
- **Release**: the commit SHA from `SENTRY_RELEASE`, `VERCEL_GIT_COMMIT_SHA` or `GITHUB_SHA`, the first one set. `deploy.yml` sets `SENTRY_RELEASE` on staging, where `GITHUB_SHA` is the tip of `master` rather than the commit it deploys.

### Set up Sentry (once)

1. Create the organization at [sentry.io](https://sentry.io). Under **Data Storage Location**, pick **European Union**. It can't be changed later: the only way out is a new organization. Events, releases and source maps then stay in the EU (API at `de.sentry.io`). Sentry keeps some account data in the US whatever the region: users, tokens, DSN keys, project settings.
2. Create one project, platform **Next.js**, for example `kolab-report`. Staging and production share it and the environment tells them apart.
3. **Project Settings > Security & Privacy**: turn on **Prevent Storing of IP Addresses**, and keep **Data Scrubber** and **Use Default Scrubbers** on.
4. **Project Settings > Client Keys (DSN)**: copy the DSN. It isn't a secret: it ships in the browser bundle.
5. **Settings > Developer Settings > Organization Tokens**: create a token for the deploy workflow. Its access is fixed to CI work (`org:ci`: create releases, upload source maps), the same as a personal token with `project:releases` and `org:read`, and it isn't tied to a person. Keep it in your password manager.

### Where each value goes

On the GitHub environments `staging` and `production` (**Settings > Environments**, `docs/deployment.md`):

| Name | Kind | Value |
| --- | --- | --- |
| `SENTRY_AUTH_TOKEN` | secret | The organization token |
| `SENTRY_ORG` | variable | Organization slug |
| `SENTRY_PROJECT` | variable | Project slug, for example `kolab-report` |
| `NEXT_PUBLIC_SENTRY_DSN` | variable | The DSN, the same on both |

`deploy.yml` passes the four to `vercel build`. The DSN, release and environment end up in the bundles at build time, so the Vercel project needs no Sentry variable at run time.

On Vercel: nothing. Keep `NEXT_PUBLIC_SENTRY_DSN` off the Vercel project, so PR previews, which Vercel builds itself, stay out of Sentry. If you want them in, add the DSN to Vercel's Preview environment: they report as `staging`, without source maps.

Locally: leave `NEXT_PUBLIC_SENTRY_DSN` empty. To try Sentry, set it in `.env.local`, run `npm run build && npm run start` and throw an error: it reports as `development`.

### Alert rules

In Sentry, **Monitors > Alerts > Create Alert**, for the project and the `production` environment. For each rule, set the action to **Notify on preferred channel** with **Member**: you, for now. Sentry e-mails through each person's notification settings (**User Settings > Notifications**: keep e-mail on for issue alerts).

| Rule | Trigger | Throttling |
| --- | --- | --- |
| New issue | **A new issue is created** | Every trigger |
| Regression | **A resolved issue regresses** | Every trigger |
| Spike | **Number of events** in an issue, **more than** 50 in 1 hour | 60 minutes |

Tune the spike threshold once you know the normal error rate. Add the same three rules for `staging` if you want its errors by e-mail too. Name each rule after what it does, for example "Production new issue by e-mail".

### Check it works

After a deploy with the four values set, throw an error in the browser on the deployed site (the Sentry docs have a test button) and open **Issues**: the event shows the release, the environment, a user id when you were signed in, and a readable stack trace. **Settings > Projects > Source Maps** lists the uploaded files for the release.

## Uptime

Goal (KRB-139, story KRB-23): when production is unavailable for more than 2 minutes, the team gets an alert.

### What to check

`GET https://<production domain>/api/health`. The route is public, never cached (`Cache-Control: no-store`) and skipped by the middleware. It calls `public.health_check()` through the Supabase API with the anon key:

| Situation | Status | Body |
| --- | --- | --- |
| App and database up | `200` | `{"status":"ok","checks":{"database":"ok"},"release":"<short commit>","time":"..."}` |
| Database down, or slower than 3 seconds | `503` | `{"status":"error","checks":{"database":"error"},...}` |
| Vercel or the app down | No answer, a timeout or a `5xx` from Vercel | |

Monitor settings, whatever the service:

| Setting | Value |
| --- | --- |
| Request | `GET`, follow no redirect |
| Up when | Status `200` **and** the body contains the keyword `"status":"ok"` (quotes included) |
| Timeout | 10 seconds |
| Interval | 1 minute or less |
| Alert | After 2 failed checks in a row, or failed from 2 locations at once |
| Locations | Europe |

With a 1-minute interval and an alert on the second failure, an outage that starts just after a check alerts after at most 2 minutes. A 30-second interval brings that to about 1 minute.

### Which service

Checked on 2026-10-14:

| Service | Free plan | Meets 2 minutes? |
| --- | --- | --- |
| Better Stack | 10 monitors, 3-minute checks, 1 status page. Paid plans check every 30 seconds (https://betterstack.com/docs/uptime/check-frequency/). | No on Free: one check every 3 minutes |
| UptimeRobot | 50 monitors, 5-minute interval, keyword monitors, 1 basic status page. The pricing page presents Free as "for hobby and non-profit projects". Solo checks every 60 seconds for $12 a month billed yearly, Team every 30 seconds (https://uptimerobot.com/pricing/). | No on Free. Yes on Solo. |
| Grafana Cloud Synthetic Monitoring | 100,000 API test executions a month. One HTTP check every minute from 2 locations is 2 x 43,200 = 86,400 a month (https://grafana.com/docs/grafana-cloud/platform/pricing-and-usage/synthetic-monitoring/). | Yes, and free |

Pick:

- **Now, free**: Grafana Cloud Synthetic Monitoring, in the same Grafana Cloud account as the database metrics below. One account, one place for the alert routing.
- **Paid, simplest**: UptimeRobot Solo or a paid Better Stack plan, with the settings above.
- Better Stack Free or UptimeRobot Free alone do not meet the target. One of them can still run next to Grafana as a second opinion and for a public status page.

### Set up Grafana Cloud Synthetic Monitoring

1. Grafana Cloud stack in an EU region (the same one as for the metrics).
2. In Grafana Cloud, open Synthetic Monitoring and add an **HTTP** check:
   - Job name `kolabreport-production-health`, target `https://<production domain>/api/health`.
   - Probe locations: two in Europe.
   - Frequency: 1 minute. Timeout: 10 seconds.
   - Validation: status code `200`, and the body must match the regular expression `"status":"ok"`.
3. **Alerting > Alert rules > New alert rule**, on the Prometheus data source of the stack:

   ```promql
   max by (job) (probe_success{job="kolabreport-production-health"})
   ```

   Condition: below `1`, so it fires only when every probe failed its last run. Two locations failing together is the confirmation, so set the pending period to 0. Evaluate every minute. The worst case is then about 2 minutes from the start of the outage. Check the labels in **Explore** first: Synthetic Monitoring names the series after the check's job name. Label `severity=critical`.
4. Send it to the contact point below. Then point the check at a wrong path for a few minutes to see the alert arrive, and set it back.

### Alert routing

- One contact point, `kolabreport-ops`, for the uptime alert and the database alerts below.
- E-mail: the owner's address. Add a second person when there is one.
- Slack (optional): a `#kolabreport-alerts` channel, through the Slack integration of the contact point. Keep e-mail on as well: Slack notifications get muted.
- GitHub e-mails the failures of the scheduled jobs (`backup-database.yml`, `backup-storage.yml`, `supabase-advisors.yml`) to the person who last changed their `cron` line, if Actions notifications are on in **GitHub > Settings > Notifications**.
- Status page (optional): Better Stack Free and UptimeRobot Free each include one. It only makes sense once customers rely on it.

### When the uptime alert fires

1. Open `/api/health` yourself. `503` with `"database":"error"`: open the Supabase dashboard of production (paused project, Supabase incident on https://status.supabase.com, database CPU or connections in the next section).
2. No answer or a Vercel error: check https://www.vercel-status.com and the latest deployment. A bad release: roll back as in `docs/deployment.md`.
3. Find the failing requests in the logs (see [Logs](#logs)) and open a Jira bug.

The health answer holds no personal data, so the uptime service receives none.

## Advisors and database metrics

### Supabase advisors (`supabase-advisors.yml`)

Every morning at 06:23 UTC, and by hand from the Actions tab, the workflow reads the advisors of each Supabase project (KRB-144):

- `GET https://api.supabase.com/v1/projects/{ref}/advisors/security`
- `GET https://api.supabase.com/v1/projects/{ref}/advisors/performance`

Both are marked experimental in the Management API reference (https://supabase.com/docs/reference/api/v1-get-security-advisors). If Supabase changes them, the job fails with the HTTP code and the paths need an update.

- It runs once per environment listed in the repository variable `ADVISORS_ENVIRONMENTS`, a JSON list. Without the variable it runs `["staging", "production"]`.
- It uses the `SUPABASE_ACCESS_TOKEN` secret and the `SUPABASE_PROJECT_REF` variable that `deploy.yml` already uses. An environment without them gets a notice. A fine-grained token needs the `advisors_read` permission.
- The run summary lists each lint name with its level and count. It prints no object name, no detail and no secret.
- Any `ERROR` lint fails the job, so GitHub e-mails you. `WARN` and `INFO` lints are only listed.
- On 2026-10-14 staging had no `ERROR`. Its `WARN` and `INFO` lints are intended and explained in section 8 of `docs/security/audit-2026-10.md`.
- The job uses `deployment: false`: no deployment shows up in the environment's history. Required reviewers on `production` would still hold its run every morning. If you turn them on, set `ADVISORS_ENVIRONMENTS` to `["staging"]`, or approve the run.

When it fails: open **Advisors** in the Supabase dashboard of that environment. It names the object and links the fix. Fix it with a migration (`docs/deployment.md`), deploy, then run the workflow by hand.

### Database metrics with Grafana Cloud

Every Supabase project exposes about 200 Postgres and server metrics in the Prometheus format. The Metrics API is in beta, so names can change (https://supabase.com/docs/guides/observability/metrics).

| | |
| --- | --- |
| Endpoint | `https://<project-ref>.supabase.co/customer/v1/privileged/metrics` |
| Auth | HTTP Basic: user `service_role`, password a secret API key (`sb_secret_...`), or the legacy service role key |
| Scrape interval | 1 minute |
| Grafana Cloud free tier | 10,000 active series, 14 days of retention, 3 active users (https://grafana.com/pricing/) |

Setup:

1. Supabase, production project, **Project Settings > API Keys**: create a secret key named `grafana-metrics`, used for nothing else, so you can revoke it alone. It has the same power as the service role key: it bypasses RLS. It only goes into Grafana Cloud.
2. Either **Integrations > Grafana Cloud** in the Supabase dashboard, which sets up the scrape job and a dashboard in one click, or by hand in Grafana Cloud, **Connections > Add new connection > Supabase**: project ref, the endpoint above, the secret key, interval 1 minute (https://supabase.com/docs/guides/observability/metrics/grafana-cloud).
3. Import the dashboard of https://github.com/supabase/supabase-grafana if the integration did not add it.
4. Add the alert rules below, on the contact point `kolabreport-ops`. Replace `<ref>` with the production project ref, and check each query in **Explore** first: the beta can rename a label.

| Alert | Query | Fires when | Why |
| --- | --- | --- | --- |
| Database down | `pg_up{supabase_project_ref="<ref>"}` | `== 0` for 5 minutes | Postgres stopped answering the exporter. From Supabase's example alerts. |
| CPU | `100 - avg by (supabase_project_ref) (rate(node_cpu_seconds_total{supabase_project_ref="<ref>", mode="idle"}[5m])) * 100` | `> 80` for 15 minutes | Shared CPU on Nano and Micro: slow pages before errors |
| Disk and database size | `max by (mountpoint) (100 * (1 - node_filesystem_avail_bytes{supabase_project_ref="<ref>", service_type="db", fstype!~"rootfs\|tmpfs"} / node_filesystem_size_bytes{supabase_project_ref="<ref>", service_type="db", fstype!~"rootfs\|tmpfs"}))`, and on the Free plan `max(pg_database_size_mb{supabase_project_ref="<ref>"})` | Disk `> 80` for 15 minutes. Database `> 400` (MB) | A full disk stops writes. The Free plan's Nano compute is sized for a 500 MB database. |
| Connections | `sum(pg_stat_database_num_backends{supabase_project_ref="<ref>"})` | `> 48` for 10 minutes | 80% of the 60 connections of Nano and Micro. Raise it to 72 on Small (90). |

Thresholds come from the compute table of the Supabase docs (https://supabase.com/docs/guides/platform/compute-and-disk). Update them when the compute size changes. Memory (`node_memory_MemAvailable_bytes` against `node_memory_MemTotal_bytes`) is on the dashboard if you want a fifth rule. Replication lag needs no alert: we have no read replica.

When an alert fires: the Supabase dashboard has the slow queries (**Observability > Query Performance**) and the connections. The usual fixes are an index, a smaller query, or the next compute size.

The metrics are counters about the database server and hold no personal data. Grafana Cloud only holds the metrics key.

## Billing

What to watch once billing is on (`private.billing_settings.enforced`). What to do when something is wrong is in [`billing.md`](billing.md).

### The daily job

Vercel Cron calls `/api/cron/billing` at 05:17 UTC (`docs/deployment.md`). A run that fails answers 500 and shows as failed under **Settings > Cron Jobs > View Logs** in the Vercel dashboard. The answer holds counts only, per step: `notices` (reminders claimed by this run), `emailsSent`, `emailsFailed`.

Its log lines, all with the request id of the run:

| Message | Level | Fields | Means |
| --- | --- | --- | --- |
| `billing: reminder sent` | info | entitlementId, organizationId, kind, recipients | Every recipient of the reminder got its e-mail |
| `billing: reminder skipped` | warn | entitlementId, kind, reason (`no recipient` or `e-mail failed`), sent, failed | Nobody to write to, or some e-mails failed. The reminder is not sent again by the next run |
| `billing: could not claim the reminders` | error | error | The database call failed: nothing was claimed, the next run tries again |
| `billing: could not record a reminder` | error | entitlementId, kind, error | The e-mails went out but their count was not stored |
| `billing: unexpected reminder` | error | entitlementId | A claimed row could not be read: nothing was sent for it |
| `billing: cron step failed` | error | step, error | A step threw. The next steps still ran |
| `billing: cron finished` | info | ok, and one key per step | End of the run |
| `billing: CRON_SECRET is missing or too short, every call is refused` | error | | Set `CRON_SECRET` on Vercel |

The lines hold ids and counts, never an address or a name.

### Reminders that did not go out

Every claimed reminder has a row in `private.billing_notices`. `emailed_at` stays null when the run stopped before sending, and `emails_failed` counts the e-mails the provider refused. In the SQL editor:

```sql
select n.entitlement_id, n.kind, n.claimed_at, n.emailed_at, n.emails_sent, n.emails_failed,
       e.organization_id, e.plan, e.ends_at
from private.billing_notices n
join public.billing_entitlements e on e.id = n.entitlement_id
where n.claimed_at > now() - interval '7 days'
  and (n.emailed_at is null or n.emails_failed > 0)
order by n.claimed_at desc;
```

### Workspaces that changed state

The job writes an audit event when a period it reminds about enters its grace or read-only. The ten latest:

```sql
select organization_id, kind, details ->> 'plan' as plan, details ->> 'ends_at' as ends_at, created_at
from private.billing_events
where kind in ('entered_grace', 'entered_read_only')
order by created_at desc
limit 10;
```

The events follow the job, the state does not: a workspace is read-only from the end of its grace, whether the job ran or not.

### Purchases

To fill after PR 176-2 merges: the purchase log lines of ADR 001, section 12 (`billing: checkout started`, `billing: purchase granted`, `billing: purchase needs review`, `billing: reconcile finished` and the others), the alerts sent to `BILLING_ALERT_EMAIL`, and the query for stuck purchases of section 12.
