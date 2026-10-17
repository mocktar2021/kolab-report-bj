# Launch and hypercare

Runbook for the first production release (KRB-26, KRB-162): what must be true before the tag, what happens on launch day, how customers reach us, and what we check every day during the first week. The setup of the environments is in [`docs/deployment.md`](../deployment.md). The billing steps of the launch are in [`billing.md`](billing.md#the-launch).

## Decisions for the product owner

The product owner took every proposal on 2026-10-17. Change a line here when a decision changes.

| Decision | Choice | Decided |
| --- | --- | --- |
| Support channel | `support@mocktar.com`, the address the legal pages and the error messages already give. A WhatsApp Business number as a second channel, if customers ask for one | 2026-10-17 |
| Support hours during hypercare | Monday to Saturday, 08:00 to 20:00 in Cotonou (07:00 to 19:00 UTC) | 2026-10-17 |
| Who is on call | The product owner, with a named backup who can roll back in Vercel and read Sentry. The backup is named before the launch day | 2026-10-17 |
| Launch day | A Tuesday or Wednesday morning in Cotonou. Never a Friday or the day before a holiday. The date is set once the "Before the tag" lines are done | 2026-10-17 |
| Who tags the release | The product owner | 2026-10-17 |
| Auth e-mails per hour | `email_sent` in `supabase/config.toml` goes from 30 to 100 for the launch (next section) | 2026-10-17 |

## Before the tag

Every line is checked the day before, and again on the morning of the launch for the ones that can change.

| Check | Where | Jira |
| --- | --- | --- |
| Supabase organization moved to Pro, as planned for the release day: Free has no daily backups and pauses a project after 7 days without activity | Supabase, organization **Billing** | KRB-130 |
| GitHub integration of the production project with **Deploy to production** and **Automatic branching** off (Deploy to production checked off on 2026-10-17) | Supabase, project `krsccuejegzqianrzstc`, **Project Settings > Integrations** | KRB-130 |
| GitHub environment `production`: Supabase ref and password, `AUTH_SITE_URL`, smoke test settings | GitHub, **Settings > Environments** | KRB-132 |
| Vercel Production variables, `NEXT_PUBLIC_APP_URL` as a plain variable, and Vercel Pro on the release day | Vercel, **Settings > Environment Variables** | KRB-131 |
| Auth settings applied to production: site URL, redirect URLs, SMTP, French templates, rate limits, captcha | **Actions > Supabase Auth settings**, first with `--dry-run` | KRB-158 |
| SMTP sender on `kolabreport.com` with SPF, DKIM and DMARC passing | The e-mail provider's domain page | KRB-158 |
| FedaPay live: fees unticked, live webhook, live keys on Production only | [`deployment.md`](../deployment.md#4-fedapay-krb-176) | KRB-157 |
| The accountant's answers on VAT, e-MECeF and the receipt mentions | ADR 001, A1 to A6 | KRB-26 |
| `AI_DAILY_COST_ALERT_USD`, `AI_ALERT_EMAIL` and the `AI_PRICE_*` variables on Production | [AI evaluation](../ai-evaluation.md#cost-alert-and-fallback-model) | KRB-160 |
| Eval baseline on the production model passed, then `AI_DRAFTS_ENABLED=true` | [AI evaluation](../ai-evaluation.md) | KRB-160 |
| Sentry alert rules for `production`: new issue, regression, spike | [Monitoring](monitoring.md#alert-rules) | KRB-23 |
| Uptime check on `https://kolabreport.com/api/health` with the `kolabreport-ops` contact point | [Monitoring](monitoring.md#uptime) | KRB-23 |
| Nightly dump and Storage copy set up for production | [Backups](backups.md#setup) | KRB-23 |
| Smoke account and workspace created on production | [Smoke tests](smoke-tests.md#setup-once-per-environment) | KRB-161 |
| `master` green, staging deployed from it, smoke tests green on staging, no open P1 | GitHub Actions | |

**Auth e-mails.** With a custom SMTP sender, Supabase sends at most `email_sent` auth e-mails per hour for the whole project. Sign-up confirmations and password resets share it. At 30, an announcement could bring more sign-ups in an hour than that, and the next ones would get no confirmation e-mail. It is 100 since KRB-162: the merge to `master` pushed it to staging, and the Auth settings workflow for production applies it there.

## Launch day

| When | Step | Who |
| --- | --- | --- |
| T minus 30 min | Run the "Before the tag" lines that can change: CI on `master`, staging smoke tests, Vercel and Supabase status pages | On call |
| T | Tag the release: `git tag v1.0.0 <sha> && git push origin v1.0.0` | Product owner |
| T to T plus 15 min | Watch the **Deploy** run: release check, production migrations (the billing launch migration among them), build, deploy, smoke tests | On call |
| T plus 15 min | Check by hand on `https://kolabreport.com`, in a private window: sign up with a new address and get the e-mail, sign in, create a workspace, upload a file, ask for an AI draft, export to .docx, change a section in a second browser and see the dashboard refresh | On call |
| T plus 30 min | Billing after the release: Institution for our own organizations, one real payment of the smallest offer, receipt, refund ([billing](billing.md#the-launch)) | Product owner |
| T plus 1 h | Announce: the launch e-mail and messages to the first customers | Product owner |
| T plus 4 h, then evening | Short check: Sentry, uptime, sign-ups, AI cost (the daily check below) | On call |

**Roll back the app** (Vercel **Instant Rollback**, [Rollback](../deployment.md#rollback)) when any of these happens after the deploy:

- the smoke tests fail and the failure affects users;
- sign-up, sign-in or the dashboard is broken for everyone;
- Sentry shows a spike on a page every user opens;
- a payment is taken and the plan is not given.

Migrations are not rolled back. They are expand-only, so the previous app version keeps working on the new schema. Fix forward with a new release.

## Severity and response

| Level | Examples | First answer | What we do |
| --- | --- | --- | --- |
| P1 | Site down, sign-in broken, data of one workspace visible to another, a payment taken without access | 30 min during support hours, and outside them for the on-call person when an alert fires | Roll back first if a release caused it. Tell the affected customers. Jira bug with label `incident`, then a short write-up in it |
| P2 | One feature broken with a way around it: export, upload, AI draft, a reminder not sent | Same day | Jira bug, fix within 2 working days |
| P3 | Wrong text, layout issue, a question | Next working day | Jira item in the backlog |

Data visible to the wrong workspace is also a personal data breach. Firms are told without undue delay, and the authority within 72 hours where KolabReport is the controller. The full breach procedure is still an open item in [`docs/gdpr/README.md`](../gdpr/README.md).

## Support

- Requests arrive at the support channel. The on-call person answers in French, with `vous`.
- Ask for: the workspace name, the page, the time, a screenshot, and the "Référence : ..." line when the error page shows one. That reference is the error digest: search for it in Sentry and in the logs ([Monitoring](monitoring.md#logs)).
- A bug becomes a Jira item with label `support` and the customer's words in the description, without personal data beyond the workspace name.
- Billing questions (a payment pending, a refund, a plan to change): [`billing.md`](billing.md).
- Account deletion and data export requests: the account page does both. For anything else on personal data, [`docs/gdpr/README.md`](../gdpr/README.md).

## Hypercare: the first 7 days

Every day at 09:00 in Cotonou, about 15 minutes. Write the result as one comment on KRB-26: "Day N: nothing to report" or the issues found with their Jira keys.

| Check | Where | Look for |
| --- | --- | --- |
| Errors | Sentry, project for `production`, **Issues** of the last 24 h | New issues, regressions, any issue with more than 10 users |
| Uptime | Grafana Cloud, the synthetic check | Any failed check, p95 response time going up |
| Deploys and jobs | GitHub Actions: Deploy, Smoke tests, backup-database, backup-storage, supabase-advisors | Any red run |
| Crons | Vercel, **Logs**, `/api/cron/billing` and `/api/cron/storage-cleanup` | One successful run each per day |
| Billing | [Monitoring](monitoring.md#billing) | Reminders not sent, purchases pending or in review |
| AI cost and latency | The daily cost alert e-mail, and the query below in the SQL editor of production | Cost per day against the alert amount, p95 cost per draft over 0.10 USD, failure rate over 5%, p95 latency going up |
| Database | Supabase, **Reports** and the advisors e-mail | CPU, connections, new advisor findings |
| Auth e-mails | Supabase, **Logs > Auth** | Rate limit errors on sign-up or recovery |
| Usage | The query below | Sign-ups and new workspaces per day |

Read-only queries for the SQL editor of production:

```sql
-- AI drafts per day: count, failures, cost (USD), p95 cost per draft and latency.
select date_trunc('day', created_at) as day,
       count(*) as drafts,
       count(*) filter (where status = 'failed') as failed,
       round(sum(cost_estimate), 2) as cost_usd,
       percentile_cont(0.95) within group (order by cost_estimate) as p95_cost_usd,
       percentile_cont(0.5) within group (order by latency_ms) as p50_ms,
       percentile_cont(0.95) within group (order by latency_ms) as p95_ms
from public.ai_generations
where created_at > now() - interval '7 days'
group by 1
order by 1 desc;

-- "Rédiger avec l'IA" calls per day.
select date_trunc('day', created_at) as day,
       count(*) as calls,
       count(*) filter (where status = 'failed') as failed,
       round(sum(cost_estimate), 2) as cost_usd
from public.prompt_assist_calls
where created_at > now() - interval '7 days'
group by 1
order by 1 desc;

-- Sign-ups and new workspaces per day.
select date_trunc('day', created_at) as day, count(*) as sign_ups
from auth.users
where created_at > now() - interval '7 days'
group by 1
order by 1 desc;

select date_trunc('day', created_at) as day, count(*) as workspaces
from public.workspaces
where created_at > now() - interval '7 days'
group by 1
order by 1 desc;
```

**End of hypercare**, after day 7, when:

- no P1 is open and every P2 has a planned fix;
- the Sentry spike threshold is set from the real error rate;
- the p95 cost per draft stays under 60 FCFA, about 0.10 USD (ADR 001, Q13), or the Pack IA price is looked at again;
- `email_sent` stays at 100 or goes back down, from the auth e-mails sent per hour during the week;
- the daily check becomes a weekly one, on Monday morning.

Then close acceptance criterion 3 of KRB-26.

## Status pages and consoles

| Service | Status | Console |
| --- | --- | --- |
| Vercel | https://www.vercel-status.com | https://vercel.com/tairoumocktar-9966s-projects/kolab-report-bj |
| Supabase | https://status.supabase.com | https://supabase.com/dashboard/project/krsccuejegzqianrzstc |
| Sentry | https://status.sentry.io | Sentry, the KolabReport project |
| GitHub Actions | https://www.githubstatus.com | https://github.com/mocktar2021/kolab-report-bj/actions |
| FedaPay | | FedaPay dashboard, Live mode |
| Anthropic | https://status.anthropic.com | Anthropic Console |
