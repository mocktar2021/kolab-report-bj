# Retention policy

How long KolabReport keeps each kind of personal data. The "Today" column is what the code and the migrations do as of 2026-10-15. The "Target" column is a rule the owner still has to decide, marked **to decide**, or the same as today. For report content the firm is the controller (see [`README.md`](README.md)): the firm decides when its reports go, and these rules are the defaults KolabReport applies for it.

Two facts shape most of the table:

- Since KRB-180 the app deletes a report (owners and admins, owners only for a final one), a workspace (its owners, or the organization owner) and an organization with all its workspaces (its owner). Who can delete what: [`docs/security/deletions.md`](../security/deletions.md). Since KRB-186 a person deletes their own account on `/fr/compte`. A deliverable can be deleted from its section page, and a member can leave or be removed. The app has no screen to delete a section: an operator deletes one on request, and the account of someone who can't sign in ([`data-subject-requests.md`](data-subject-requests.md)).
- Deleting a deliverable or an export row, directly or by a cascade (a deleted section, report, workspace or organization), queues its file. The delete functions of KRB-180 also queue every file stored under the folder of what goes, including one no row records. A daily job (KRB-166, `/api/cron/storage-cleanup`) removes the queued files. A deliverable's file waits at least 2 hours 15 minutes after its upload started, because a signed upload link stays valid 2 hours.

## Database

| Data | Where | Today | Target |
| --- | --- | --- | --- |
| Account | `auth.users`, `public.profiles` | Until the person deletes it on `/fr/compte`, or an operator does when they can't sign in. Not possible while they own an organization or are the only owner of a workspace. | **To decide**: delete sign-ups never confirmed after a set time, and what happens to inactive accounts. |
| Sessions | `auth.sessions`, refresh tokens | Managed by Supabase Auth. Access tokens last 3,600 s and refresh tokens rotate (`supabase/config.toml`, to confirm on the hosted projects). Signing out ends the session of that browser only. | Provider default |
| Auth audit log | `auth.audit_log_entries` (user id, name, e-mail, IP address) | Nothing in the repository removes it | **To decide**, as a security log with a fixed period |
| Organizations and workspaces | `organizations`, `workspaces` | Until the organization owner deletes the organization, or a workspace owner the workspace, in the app. Deleting an organization deletes its workspaces. | Deleted or returned at the end of the firm's contract, as the customer DPA will say (**to confirm**) |
| Memberships | `workspace_members` | Until the member leaves or is removed, or the account or workspace is deleted | Same |
| Invitations | `workspace_invitations` (invitee e-mail, token hash) | The link works once and for 7 days. The row stays until the workspace is deleted. When the inviter's account is deleted, it stays with no inviter and an open link keeps working. Deleting the invitee's account deletes the invitations sent to their address. | **To decide**: remove used, revoked and expired invitations after a set time |
| Reports and sections | `reports`, `report_sections` (text, accepted AI draft, assignee) | Until an owner or admin deletes the report in the app (an owner, for a final report), or its workspace or organization is deleted. When an assignee's account is deleted, their sections become unassigned. When the creator's account is deleted, the report stays with no creator. | Set by the firm |
| Deliverables | `deliverables` (file name, extracted text, uploader) | Until a section editor deletes the file in the app, or its section, report or workspace is deleted. An upload never finished is deleted, row and file, after one day, the next time the same person starts an upload in that section. When the uploader's account is deleted, the file stays with no uploader. | Same |
| AI generations | `ai_generations` | The row stays until the workspace is deleted. Once its section is gone, only the usage columns keep data: the text is cleared. See [below](#ai-generations) | Same |
| Template writer calls | `prompt_assist_calls` (user id, model, tokens, cost; no text) | Until the workspace is deleted. The user link becomes null when the account is deleted. | Same |
| PDF plan readings | `plan_import_calls` (user id, report, model, tokens, cost; no text) | Until the workspace is deleted. The report link becomes null when the report is deleted, the user link when the account is deleted. The plan file itself is never stored (KRB-196). | Same |
| Prompt templates | `prompt_library`, `prompt_rollouts` | Versions are never deleted, only archived, until the workspace is deleted. The author link becomes null when the author's account is deleted. | Same |
| Exports | `report_exports` | Until the report or workspace is deleted. An export still pending after 2 minutes is marked failed. | 90 days, see [below](#exports) |
| Status history | `report_status_events` | Until the report or workspace is deleted. The author link becomes null when the author's account is deleted. | Same |
| Notifications | `notifications` | Until the recipient's account, the report or the workspace is deleted. A renewal reminder (KRB-178) stays until the recipient's account, the organization or the period it is about is deleted. | **To decide**: for example remove read notifications after a set time |
| Renewal reminders sent | `private.billing_notices` (period id, kind, when, how many e-mails went out or failed). No address and no name. | Deleted with the period, so with the organization or the mission workspace | Same |
| AI cost alerts | `ai_cost_alerts` | One row per day, kept. No personal data. | Same |
| Deletion log | `private.audit_events`: who deleted a report, a workspace or an organization (user id), when, the ids and counts of what went. Since KRB-186, also who handed an organization to whom (user ids). No title, name or content. | 12 months. The daily cleanup job (`/api/cron/storage-cleanup`) calls `expire_audit_events(12)`, which deletes older events. No foreign key, so an event outlives the account and what it is about until then. | Same |
| Billing of a deleted organization | `organization_billing`, `billing_entitlements`, `billing_ai_packs`, `billing_draft_usage` | Deleted with the organization. `private.billing_events` and `private.billing_trial_claims` stay: no foreign key, so a new organization of the same person gets no second trial. Deleting a workspace keeps the draft ledger of its organization. | Same |
| Purchases | `billing_purchases` (offer, amounts, status, FedaPay transaction id, reference, payment method and fees, the buyer's user id) | Nothing deletes them. They stay when the organization or the pass's workspace is deleted (the link becomes null) and when the buyer's account is deleted (`created_by` becomes null). | 10 years, as accounting records, **to confirm** with the accountant (ADR 001, question A5) |
| Receipts | `billing_receipts`, `billing_receipt_lines` (number, seller and buyer frozen at issue, lines, totals, payment method and FedaPay references) | Never changed or deleted once issued, by anyone, the service role included (trigger). They stay when the organization is deleted, with `organization_id` set to null. | 10 years, **to confirm** (A5) |
| Payment events | `private.billing_payment_events` (purchase, path, FedaPay event id and name, status, amount, date, no payload) | Deleted with their purchase, so in practice kept as long as it | 10 years, with the purchase |
| Trial claims | `private.billing_trial_claims` (user id, SHA-256 hash of the e-mail address, organization, date). No address and no name. | Kept with no time limit, after the account is deleted too, so a person gets one free trial (ADR 001, KRB-186) | Same: no time limit, decided by the product owner on 2026-10-15 |
| Account deletion tries | `private.account_deletion_attempts` (user id, start and end) | Deleted with the account. A try older than a day goes at the person's next try. | Same |
| Record of deleted accounts | E-mails to `ACCOUNT_DELETION_LOG_EMAIL` (account id, date, environment), outside the database so a restore can't roll it back | 35 days in that mailbox, then a rule of the mailbox deletes them: they only need to outlive the oldest backups, 14 days for the database and about 32 days for files ([below](#backups)). The e-mail provider keeps its logs for its own period. | Same |

## Storage files

| Bucket | Today | Target |
| --- | --- | --- |
| `deliverables` | Removed by the app when a file is deleted from the section page, when an upload fails the checks, and when an unfinished upload is cleaned up. When the row goes with its section, report or workspace, the daily job removes the file. | Same |
| `exports` | A manual export is kept 90 days: the daily job deletes the row and then its file. A final snapshot is kept as long as its report, and the daily job removes it after the report is deleted. | Same |

The daily job runs at 03:00 UTC from Vercel Cron (`vercel.json`; on the Hobby plan, at some point in that hour) and only works when `CRON_SECRET` is set on the Vercel environment ([`docs/deployment.md`](../deployment.md#scheduled-jobs)). A report finalized, reopened and finalized again keeps one final snapshot per finalization, all of them as long as the report. Keeping only the latest one is **to decide**.

## AI generations

Each request for a draft is one row in `ai_generations`. It holds usage (tokens, cost, latency, model, requester, dates) and content (the draft in `output` and `raw_output`, the file names in `context_meta`, the requester's `feedback_comment`).

- Before migration `20261013230000_ai_generations_keep_usage.sql`, deleting a section deleted its generations, which took their tokens out of the hourly limit and the monthly budget. Now the row stays with `section_id` set to null, and only owners and admins can read it. Deleting the workspace removes it.
- Decided in KRB-180: when the section goes, with its report or alone, a trigger clears the text of its generations. `output`, `raw_output` and `feedback_comment` become null, and `context_meta` keeps only the number of files used, the token estimate and whether usage was estimated. `content_cleared_at` records when. A draft still running when its section goes is cleared when the app records its end.
- What stays: tokens, cost, latency, model, prompt version, status, the decision, the edit distance, the rating, the requester and the dates. The hourly limit, the monthly budget, the draft ledger and the AI dashboard keep working. The SHA-256 hashes of the context stay too: they cannot give the text back.
- Deleting a workspace or an organization deletes its generations. Only the draft ledger (`billing_draft_usage`) stays, with ids, months and statuses and no text.
- When the requester's account is deleted, `requested_by` becomes null and the deletion clears `feedback_comment` (KRB-186). The rest of the row stays while the section exists.
- The hourly limit reads the last hour and the budget reads the current calendar month (UTC). The AI dashboard reads usage over a chosen period. None of them reads the content columns.

**To decide**: also clear the text of generations whose section still exists once their month is over. That needs a job, so it is a follow-up.

With `AI_TRACE_CONTENT=true`, Langfuse traces hold the prompt and the output. Clearing a generation does not touch its trace, which follows the Langfuse retention setting.

Provider side: how long Anthropic or OpenAI keep prompts and outputs is set by their terms, **to confirm** ([`processors.md`](processors.md)). With tracing on, Langfuse keeps traces per its own settings: provider default.

## Exports

Policy since KRB-166:

- A manual export (`kind = 'manual'`, from the export buttons) is kept 90 days, then the daily job deletes its row and its file.
- The final snapshot (`kind = 'final'`, the PDF stored when a report becomes final) is kept as long as the report.
- When an export or deliverable row is deleted, by the app or by a cascade, the daily job removes its file.

## Billing records

Purchases, receipts and payment events are accounting records (ADR 001, section 9). Since KRB-177:

- A receipt is never stored as a file. `GET /api/billing/receipts/[id]` draws the PDF each time from the receipt rows, so there is nothing to clean up in Storage. Whether a PDF drawn again from frozen rows is enough, or the original file must be kept, is question A5 for the accountant.
- The receipt keeps the buyer's details as they were on the day it was issued: legal name (or the organization's name), address, IFU and billing e-mail. Changing the billing details on the billing page only changes the next receipts.
- When an organization is deleted, its purchases and receipts stay with `organization_id` set to null. From then on only the service role reads them, for the accountant or a tax check. An erasure request does not remove them while the legal retention runs (Article 17(3)(b)); the answer to the person says so ([`data-subject-requests.md`](data-subject-requests.md)).
- No job deletes billing records after 10 years yet. The receipt trigger refuses every delete, so that job needs its own migration once the period is confirmed.

## Logs

Nothing in the repository sets a log retention, so each one is the provider's default for the plan in use.

| Log | Retention |
| --- | --- |
| Vercel function and request logs | Provider default |
| Supabase logs (API, database, Auth, Storage) | Provider default |
| E-mail provider logs (Resend or Brevo) | Provider default. Brevo's DPA lists what it keeps for transactional e-mails ([`processors.md`](processors.md)). |
| Langfuse traces, when tracing is on | Provider default, or the project's own setting |
| Sentry errors and traces, when `NEXT_PUBLIC_SENTRY_DSN` is set | Plan default: errors 30 days on Developer and 90 days on Team and Business, traces 30 days (https://docs.sentry.io/security-legal-pii/security/data-retention-periods/) |
| LLM provider logs of API calls | Per the provider's terms, **to confirm** |
| Cloudflare Web Analytics page views of the public pages, when `NEXT_PUBLIC_CF_WEB_ANALYTICS_SITE_TAG` is set | Unsampled 7 days, then a sample of about 10% (https://developers.cloudflare.com/web-analytics/faq/) |

## Backups

How long data deleted in the app survives in the backups (KRB-141, KRB-142). Setup, restore and drill: [`docs/operations/backups.md`](../operations/backups.md). The two GitHub jobs do nothing until their secrets are set; the Supabase rows depend on the plan.

| Copy | Holds | Kept |
| --- | --- | --- |
| Nightly database dump (`backup-database.yml`), encrypted with age, stored as a GitHub artifact | Every table: accounts and password hashes, report content, AI generations, Storage metadata | 14 days, then GitHub deletes the artifact |
| Supabase daily backups | The database, without Storage files | 7 days on Pro. None on the Free plan, which both projects use today. |
| Supabase point-in-time recovery | The database, to the second | The window bought, 7 days at the lowest price. Pro add-on, not on. |
| Storage mirror (`backup-storage.yml`), `mirror/` in a Cloudflare R2 bucket in the EU | The current files of `deliverables` and `exports` | As long as the file exists in the app |
| Storage mirror, `deleted/<date>/` | Files deleted or replaced in the app | 30 days after the nightly run that moved them there, then an R2 lifecycle rule removes them |

What that means for a deletion:

- A row deleted from the database is out of every dump 14 days later. On Pro, Supabase's daily backups keep it 7 days, and PITR keeps it for its window.
- A file deleted in the app, by a user or by the daily storage cleanup, leaves `mirror/` at the next nightly run, so within a day. Its copy under `deleted/` expires 30 days later, and Cloudflare removes expired objects within about 24 hours. The file is gone from every copy at most about 32 days after the deletion.
- Supabase's database backups hold no Storage files, only their rows (Supabase docs: "Database backups do not include objects you store via the Storage API").
- After a restore, apply again every erasure done since the backup date, from the request log and the record of deleted accounts (see [`data-subject-requests.md`](data-subject-requests.md#step-7-after-a-backup-restore)). Before copying a file back from `deleted/`, check the log too: it may have been deleted on request.

## Browser and device

| Data | Retention |
| --- | --- |
| Supabase session cookies | Until sign-out or the session ends |
| `kr-espace` cookie (current workspace id) | One year |
| `localStorage` (sidebar state, theme) | Until the person clears it. No personal data. |
| Pages kept by the service worker for offline reading | Removed at sign-out. The app shell and static files stay. |

## Launch reminder

| Data | Where | Today | Target |
| --- | --- | --- | --- |
| E-mail addresses left before the launch (KRB-239) | Resend contacts, segment "KolabReport lancement". Nothing in the app's database. | Until the launch e-mail goes out on 27 October 2026, then the operator deletes the segment's contacts in Resend within 30 days ([`docs/operations/launch.md`](../operations/launch.md)). A contact who unsubscribes earlier stays marked as unsubscribed until then. | Same |

## Out of scope

CI keeps test reports for 7 days and eval reports for 90 days on GitHub. They hold only the local seed accounts and the synthetic eval cases.
