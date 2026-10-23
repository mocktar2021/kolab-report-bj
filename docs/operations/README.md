# Operations

Runbooks for running KolabReport in production: what watches it, what backs it up, and what to do when something breaks (story KRB-23). Setup of the environments and their secrets is in [`docs/deployment.md`](../deployment.md).

| File | What it holds |
| --- | --- |
| [`launch.md`](launch.md) | The first production release: checks before the tag, the countdown page that goes up with it, launch day, severity levels, support, and the daily checks of the first week (KRB-162) |
| [`billing.md`](billing.md) | How access follows the plan, moving dates on staging, a reminder not sent, a workspace stuck in read-only, a manual grant, stuck purchases, purchases in review and refunds |
| [`backups.md`](backups.md) | What Supabase backs up per plan, our RPO and RTO, the nightly database dump and Storage copy, the restore drill and its log |
| [`monitoring.md`](monitoring.md) | Logs, Sentry, the uptime check on `/api/health` and its alert routing, the Supabase advisors, the database metrics and the billing job |
| [`smoke-tests.md`](smoke-tests.md) | The smoke tests after each deploy: what they check, the smoke account and workspace to set up, what a run leaves behind, what to do when they fail |

Scheduled jobs that support these pages:

| Job | Where | Schedule (UTC) |
| --- | --- | --- |
| Database dump | `.github/workflows/backup-database.yml` | 01:41 every night |
| Storage copy | `.github/workflows/backup-storage.yml` | 02:11 every night |
| Storage cleanup | Vercel Cron, `/api/cron/storage-cleanup` | Once a day in the 03:00 hour |
| Billing reminders and pending payments | Vercel Cron, `/api/cron/billing` | Once a day at 05:17 (06:17 in Cotonou) |
| Supabase advisors | `.github/workflows/supabase-advisors.yml` | 06:23 every morning |
