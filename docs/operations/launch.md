# Launch and hypercare

Runbook for the first production release (KRB-26, KRB-162): what must be true before the tag, the countdown page that goes up with the tag (KRB-239), what happens on launch day, how customers reach us, and what we check every day during the first week. The setup of the environments is in [`docs/deployment.md`](../deployment.md). The billing steps of the launch are in [`billing.md`](billing.md#the-launch).

## Decisions for the product owner

The product owner took every proposal on 2026-10-17. Change a line here when a decision changes.

| Decision | Choice | Decided |
| --- | --- | --- |
| Support channel | `support@mocktar.com`, the address the legal pages and the error messages already give. A WhatsApp Business number as a second channel, if customers ask for one | 2026-10-17 |
| Support hours during hypercare | Monday to Saturday, 08:00 to 20:00 in Cotonou (07:00 to 19:00 UTC) | 2026-10-17 |
| Who is on call | The product owner, with Olakounle Akinotcho as backup. She has Vercel access for a rollback. Sentry's free plan has one user, the product owner, who forwards her what she needs (2026-10-20) | 2026-10-17 |
| Launch day | Tuesday 27 October 2026 at 09:00 in Cotonou (08:00 UTC), when sign-up opens. The rule stays: a Tuesday or Wednesday morning, never a Friday or the day before a holiday | 2026-10-23 |
| Who tags the release | The product owner | 2026-10-17 |
| Countdown before the launch | The tag goes out before the launch, as soon as Vercel is on Pro, so the ads can point to the site. Until 09:00 on 27 October, production shows a countdown and a form to get one e-mail at the opening, and sign-up is closed. Sign-in works. Sign-up opens by itself at 09:00, with no deploy: the date is in `src/lib/launch.ts` (KRB-239). Staging never shows the countdown | 2026-10-23 |
| Auth e-mails per hour | `email_sent` in `supabase/config.toml` goes from 30 to 100 for the launch (next section) | 2026-10-17 |
| Plans for the launch | Free plans, with no budget for paid ones now. Supabase Free: no daily backups, so the nightly dump and the Storage copy are the only ones, and the leaked password check stays off. Sentry Developer: one user, the product owner. GitHub Actions within the free minutes (KRB-220). Runs of the eval suite cost money: the nightly run only runs after an AI change (KRB-223), and the baseline run waits (KRB-160). Vercel is the exception, see the next lines. To revisit with the first payments: ADR 001, Q16 planned Supabase and Vercel Pro before the first paid customer | 2026-10-20 |
| Hosting | Vercel Pro, 20 USD a month, upgraded before the tag: production takes payments, which the free Hobby plan does not allow ([Vercel plan](#vercel-plan)) | 2026-10-23 |
| AI drafts at launch | On. The eval gate passed twice on the full set with PR 115 (KRB-224): drafts think before they write, section drafts have no key points list, and no draft has a long dash or a stock phrase. Production needs the AI key, `AI_DRAFTS_ENABLED=true` and the cost alert variables (next section). The nightly **Evals** workflow stays on: it only runs after an AI change. Off on 2026-10-22, while the drafts did not pass | 2026-10-23 |
| E-mails | Resend Free: 100 e-mails a day and 3,000 a month, auth e-mails and app e-mails together. On the daily check of hypercare | 2026-10-22 |

## Before the tag

Every line is checked before the tag, and again on the morning of the launch for the ones that can change. The last column is where each line stood after the settings session of 2026-10-23.

| Check | Where | Jira | On 2026-10-23 |
| --- | --- | --- | --- |
| Supabase stays on Free (decided 2026-10-20). Free pauses a project after 7 days without activity: use production during the week before the tag, and restore it from the dashboard if it paused | Supabase, project `krsccuejegzqianrzstc` | KRB-130 | Up: the nightly dump reached it |
| GitHub integration of the production project with **Deploy to production** and **Automatic branching** off | Supabase, project `krsccuejegzqianrzstc`, **Project Settings > Integrations** | KRB-130 | Both off. Automatic branching needs Pro |
| GitHub environment `production`: Supabase ref and password, `AUTH_SITE_URL`, smoke test settings | GitHub, **Settings > Environments** | KRB-132 | Set, except the smoke settings: launch day |
| Vercel Production variables, `NEXT_PUBLIC_APP_URL` as a plain variable. The plan goes to Pro before the tag ([Vercel plan](#vercel-plan)) | Vercel, **Settings > Environment Variables** | KRB-131 | Set. Plan: before the tag |
| Check settings on `production` with no ✗ | **Actions > Check settings**, [steps below](#production-settings-step-by-step) | KRB-157 | "Ready to deploy, 1 to look at": the smoke tests, set on launch day. Every AI line passes (KRB-235) |
| Auth settings applied to production: site URL, redirect URLs, SMTP, French templates, rate limits | **Actions > Supabase Auth settings**, first with `--dry-run` | KRB-158 | Applied on 2026-10-21. The captcha goes on after the deploy (launch day) |
| Turnstile: `NEXT_PUBLIC_TURNSTILE_SITE_KEY` on Vercel Production, not Sensitive, and `TURNSTILE_SECRET_KEY` on the GitHub `production` environment. `AUTH_CAPTCHA_ENABLED` stays unset until launch day | Cloudflare **Turnstile**, widget `KolabReport`; [deployment](../deployment.md#turnstile-captcha) | KRB-157 | Done |
| SMTP sender on `kolabreport.com` with SPF, DKIM and DMARC passing | The e-mail provider's domain page | KRB-158 | `email.kolabreport.com` verified on Resend on 2026-10-21 |
| FedaPay live: fees unticked, live webhook, live keys on Production only | [`deployment.md`](../deployment.md#4-fedapay-krb-176) | KRB-157 | Done |
| The accountant's answers on VAT, e-MECeF and the receipt mentions | ADR 001, A1 to A6 | KRB-26 | e-MECeF done: normalized invoices are issued on SFE en ligne after each payment ([billing](billing.md#normalized-invoice-e-mecef)). TPS confirmed on 2026-10-23, so no VAT and net prices (KRB-237). Still open: the wording of the no-VAT mention (A4) and credit notes (A3). Not a blocker: with the 30-day launch period no customer has to pay before late November |
| `AI_DAILY_COST_ALERT_USD`, `AI_ALERT_EMAIL` and the `AI_PRICE_*` variables on Production | [AI evaluation](../ai-evaluation.md#cost-alert-and-fallback-model) | KRB-160 | Set on Production and staging (Check settings, KRB-235) |
| Eval gate passed on the production model, then `ANTHROPIC_API_KEY` and `AI_DRAFTS_ENABLED=true` on Production. `AI_DRAFT_EFFORT` stays unset (`high`) | [AI evaluation](../ai-evaluation.md) | KRB-224 | Gate passed on 2026-10-23 (PR 115, two full runs: fidélité 4.23 and structure 3.77 on average). Variables set on Production and staging, `AI_DRAFTS_ENABLED=true` confirmed by the product owner |
| Sentry alert rules for `production`: new issue, regression, spike, sent to the product owner, the only member on the free plan | [Monitoring](monitoring.md#alert-rules) | KRB-23 | Done |
| Uptime check on `https://kolabreport.com/api/health` with the `kolabreport-ops` contact point | [Monitoring](monitoring.md#uptime) | KRB-139 | Set up, check disabled and rule paused until launch day |
| Nightly dump and Storage copy set up for production | [Backups](backups.md#setup) | KRB-23 | Done. Both skip cleanly until the first deploy |
| Smoke account and workspace created on production | [Smoke tests](smoke-tests.md#setup-once-per-environment) | KRB-161 | After the tag: it needs the deployed site ([countdown](#the-tag-and-the-countdown)) |
| `master` green, staging deployed from it, smoke tests green on staging, no open P1 | GitHub Actions | | Before the tag |

**Auth e-mails.** With a custom SMTP sender, Supabase sends at most `email_sent` auth e-mails per hour for the whole project. Sign-up confirmations and password resets share it. At 30, an announcement could bring more sign-ups in an hour than that, and the next ones would get no confirmation e-mail. It is 100 since KRB-162: the merge to `master` pushed it to staging, and the Auth settings workflow for production applies it there.

### Vercel plan

Decided on 2026-10-22: Vercel Pro, 20 USD a month, upgraded before the tag. Since KRB-239 the tag comes before the launch, so the plan goes to Pro on 2026-10-23 or 24. Vercel's fair use guidelines keep the free Hobby plan to non-commercial personal use, and count "any method of requesting or processing payment from visitors of the site" and "advertising the sale of a product or service" as commercial use. KolabReport sells plans and takes FedaPay payments, so production on Hobby goes against Vercel's terms, and Vercel can stop the project. The other way out, a host whose free plan allows commercial use, means moving the deploy (`deploy.yml`, `vercel.json`, the cron jobs).

## Production settings, step by step

For the setup session before the tag (KRB-157, KRB-158). Each step names what to set; the values and the reasons are in [`deployment.md`](../deployment.md). Nothing here needs a paid plan.

1. **Supabase**, project `krsccuejegzqianrzstc`: note the database password, the anon key, the service role key and the session pooler string (**Project Settings > Database** and **API**). In **Integrations**, keep **Deploy to production** and **Automatic branching** off.
2. **GitHub environment `production`** (**Settings > Environments**):
   - for `deploy.yml`: the secrets `SUPABASE_ACCESS_TOKEN`, `SUPABASE_DB_PASSWORD`, `VERCEL_TOKEN` and `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` (a new one, `openssl rand -base64 32`, never staging's), and the variables `SUPABASE_PROJECT_REF`, `VERCEL_ORG_ID` and `VERCEL_PROJECT_ID`;
   - for the Auth settings: `AUTH_SITE_URL` set to `https://kolabreport.com`, then `SMTP_PASS` and `SMTP_ADMIN_EMAIL` once the sending domain is verified;
   - for the nightly backup, the only one on the Free plan: `SUPABASE_DB_URL` and `BACKUP_AGE_RECIPIENT`, then the Storage copy ([backups](backups.md#setup));
   - for Sentry: `SENTRY_AUTH_TOKEN`, `SENTRY_ORG`, `SENTRY_PROJECT` and `NEXT_PUBLIC_SENTRY_DSN`.
3. **Vercel**, Production target (**Settings > Environment Variables**), from the table in [`deployment.md`](../deployment.md#2-vercel-project-krb-131): `NEXT_PUBLIC_APP_URL` set to `https://kolabreport.com` (plain, not Sensitive), `APP_ENV` set to `production`, the URL and keys of the production project, and a new `CRON_SECRET`. Payments (`FEDAPAY_*`, with `live`) wait for FedaPay to approve the account, e-mails for the verified domain. AI drafts need `ANTHROPIC_API_KEY`, `AI_DRAFTS_ENABLED=true`, `AI_DAILY_COST_ALERT_USD`, `AI_ALERT_EMAIL` and the `AI_PRICE_*` variables. Each feature stays off until its variables are set.
4. **Actions > Check settings > Run workflow** on `production`. Fix every ✗. A ! is a feature still off or an optional setting.
5. **Actions > Supabase Auth settings > Run workflow** on `production`: the French templates, the password policy, the rate limits and, with `AUTH_SITE_URL`, the site URL and the redirect list `https://kolabreport.com/**`. Run it again once the SMTP settings are in.
6. After the first deploy: the smoke account and workspace ([smoke tests](smoke-tests.md#setup-once-per-environment)), then `SMOKE_BASE_URL` set to `https://kolabreport.com`, `SMOKE_EMAIL` and `SMOKE_PASSWORD` on the environment, and Check settings again.

## The tag and the countdown

As soon as Vercel is on Pro, in this order. Production then shows the countdown until 09:00 on 27 October (KRB-239).

| Step | Who |
| --- | --- |
| Upgrade Vercel to Pro. Run the "Before the tag" lines again and **Actions > Check settings** on `production`: no ✗ | Product owner, then on call |
| Tag the release: `git tag v1.0.0 <sha> && git push origin v1.0.0`. Watch the **Deploy** run: release check, production migrations (the billing launch migration among them), build, deploy. The smoke tests are skipped with a warning: `SMOKE_BASE_URL` comes with the smoke account, below | Product owner, then on call |
| **Countdown.** In a private window: `https://kolabreport.com` shows "Ouverture le mardi 27 octobre à 9 h" and the countdown in place of the buttons. `/fr/inscription` shows the countdown and the reminder form, no sign-up form. `/fr/connexion` shows the sign-in form | On call |
| **Reminder setup.** In the Resend account that sends from `email.kolabreport.com`: create the segment "KolabReport lancement" and an API key with **Full access** (adding a contact needs it, a sending key gets a 401). On Vercel, Production: replace `RESEND_API_KEY` with that key (Sensitive) and set `RESEND_LAUNCH_SEGMENT_ID` to the segment's id. Redeploy with a tag (KRB-243) | Product owner |
| **Reminder.** Leave a test address in the form: "C'est noté." shows. In Resend, **Audience > Contacts**, the segment "KolabReport lancement" lists it. Then delete that contact. If the form answers that the address could not be saved, Vercel **Logs** show a `launch reminder` line: "skipped" names the missing variable, `Resend refused the contact` with 401 means the key may only send, and `Resend refused the segment` with 404 means the segment is in another Resend account | On call |
| **Uptime on.** Grafana: enable the check `kolabreport-production-health`, then resume the rule "KolabReport production down". In **Explore**, `probe_success{job="kolabreport-production-health"}` shows one series per probe at 1 ([monitoring](monitoring.md#uptime)). Then the **alert test**: point the check at `https://kolabreport.com/api/health-test` for 3 to 5 minutes, the "KolabReport production down" e-mail arrives, set the target back and the resolved e-mail follows | On call |
| **Captcha on.** In a private window, open `https://kolabreport.com/fr/connexion`: the "Vérification anti-robot" box shows and passes. Wait a few seconds and reload: it passes again (KRB-242). Only then set the variable `AUTH_CAPTCHA_ENABLED` to `true` on the GitHub `production` environment, and run **Actions > Supabase Auth settings** for `production`: its log lists `security_captcha_enabled`. If the box does not show, leave the variable unset and open a P2: sign-in and sign-up work without the captcha | On call |
| **Our accounts.** Sign-up is closed on the site, so create the owner's account and the smoke account in Supabase, project `krsccuejegzqianrzstc`, **Authentication > Users > Add user > Create new user**, with **Auto Confirm User** ticked. Sign in on the site and fill the name on `/fr/compte` | Product owner |
| **Smoke account.** Its workspace, then Institution with `grant.mjs`, reason "usage interne", because its trial allows one report and the tests add a second one ([smoke tests](smoke-tests.md#setup-once-per-environment), [billing](billing.md#a-period-without-a-payment)). Then set `SMOKE_BASE_URL`, `SMOKE_EMAIL` and `SMOKE_PASSWORD` on the GitHub `production` environment. Run **Smoke tests** for `production`, then **Check settings**: "Ready to deploy." with nothing left to look at. If the signed-in checks fail at sign-in on the captcha, keep the captcha on and follow KRB-234 | On call |
| **Billing.** Institution for our own organizations, one real payment of the smallest offer, receipt, its normalized invoice on SFE en ligne, refund and its credit note ([billing](billing.md#the-launch)) | Product owner |
| **Ads.** They can point to `https://kolabreport.com` from here | Product owner |

A fix merged before the launch reaches production with a new tag (`v1.0.1`). The countdown stays: the date is in the code.

## Launch day

In this order. Each step needs the one before it. T is 09:00 in Cotonou, 08:00 UTC.

| When | Step | Who |
| --- | --- | --- |
| The day before | Run the "Before the tag" lines that can change and **Actions > Check settings** on `production`: no ✗. Write the launch e-mail as a draft broadcast in Resend for the segment "KolabReport lancement", from `email.kolabreport.com` | Product owner, then on call |
| T minus 30 min | CI on `master`, smoke tests on production, Vercel and Supabase status pages, Supabase production not paused | On call |
| T | Sign-up opens by itself, with no deploy. In a private window, `https://kolabreport.com` shows the buttons again and `/fr/inscription` the sign-up form. A page opened before 09:00 changes at 09:00 without a reload. The home page was built before 09:00: a script in it shows the buttons from then on, and the next release builds it without the countdown | On call |
| T plus 5 min | **Launch e-mail.** Look over the segment's contacts first and delete addresses that look made up or came in a burst: the form has a bot trap but no rate limit. Then send the broadcast. Resend counts the contacts (1,000 free) and set no cap on broadcasts on 2026-10-23. If the segment holds more than 50 addresses, check first in Resend **Settings > Usage** that a broadcast does not count in the 100 e-mails a day: sign-up confirmations need them. If it does, ask the product owner before sending | Product owner |
| T plus 10 min | Check by hand on `https://kolabreport.com`, in a private window: sign up with a new address and get the e-mail, sign in, request a reset link and get it, create a workspace, upload a file, export to .docx, change a section in a second browser and see the dashboard refresh. Ask for one AI draft on the section with the file: the text starts after a short wait while the model thinks (a whole draft took 16 s at p50 and 25 to 33 s at p95 in the evals), then shows a summary and the body with no "Points clés" list | On call |
| T plus 1 h | Announce: messages to the first customers | Product owner |
| T plus 4 h, then evening | Short check: Sentry, uptime, sign-ups, e-mails sent on Resend (the daily check below) | On call |
| The next morning | First nightly backups with data: **Backup database** uploads an encrypted dump, and **Backup storage** copies `deliverables` and `exports` to R2. It is the first run that writes to R2, so it also tests the R2 key: a red run is a P2 the same day ([backups](backups.md)) | On call |
| Once the launch e-mail is sent | The reminder form is gone, so the app no longer needs a Full access key. Create a **Sending access** key for `email.kolabreport.com`, put it in `RESEND_API_KEY` on Vercel, Production, redeploy with the next tag, then delete the Full access key in Resend | On call |
| By 26 November | Delete the contacts of the segment "KolabReport lancement" in Resend. The privacy notice promises it within 30 days of the launch e-mail | Product owner |

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

Data visible to the wrong workspace is also a personal data breach. Firms are told without undue delay, and the authority within 72 hours where KolabReport is the controller. Follow the [breach procedure](../gdpr/breach.md): who decides, the first hour, and who to tell.

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
| E-mails sent | Resend, **Metrics** of the KolabReport account | The day's count against the free plan's 100 a day and 3,000 a month. Past 70 in a day, tell the product owner |
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
