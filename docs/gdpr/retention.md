# Retention policy

How long KolabReport keeps each kind of personal data. The "Today" column is what the code and the migrations do as of 2026-10-14. The "Target" column is a rule the owner still has to decide, marked **to decide**, or the same as today. For report content the firm is the controller (see [`README.md`](README.md)): the firm decides when its reports go, and these rules are the defaults KolabReport applies for it.

Two facts shape most of the table:

- Since KRB-180 the app deletes a report (owners and admins, owners only for a final one), a workspace (its owners, or the organization owner) and an organization with all its workspaces (its owner). Who can delete what: [`docs/security/deletions.md`](../security/deletions.md). A deliverable can be deleted from its section page, and a member can leave or be removed. The app has no screen to delete an account or a section: an operator deletes them on request ([`data-subject-requests.md`](data-subject-requests.md)).
- Deleting a deliverable or an export row, directly or by a cascade (a deleted section, report, workspace or organization), queues its file. The delete functions of KRB-180 also queue every file stored under the folder of what goes, including one no row records. A daily job (KRB-166, `/api/cron/storage-cleanup`) removes the queued files. A deliverable's file waits at least 2 hours 15 minutes after its upload started, because a signed upload link stays valid 2 hours.

## Database

| Data | Where | Today | Target |
| --- | --- | --- | --- |
| Account | `auth.users`, `public.profiles` | Until an operator deletes it | Self-service deletion (follow-up). **To decide**: delete sign-ups never confirmed after a set time, and what happens to inactive accounts. |
| Sessions | `auth.sessions`, refresh tokens | Managed by Supabase Auth. Access tokens last 3,600 s and refresh tokens rotate (`supabase/config.toml`, to confirm on the hosted projects). Signing out ends the session of that browser only. | Provider default |
| Auth audit log | `auth.audit_log_entries` (user id, name, e-mail, IP address) | Nothing in the repository removes it | **To decide**, as a security log with a fixed period |
| Organizations and workspaces | `organizations`, `workspaces` | Until the organization owner deletes the organization, or a workspace owner the workspace, in the app. Deleting an organization deletes its workspaces. | Deleted or returned at the end of the firm's contract, as the customer DPA will say (**to confirm**) |
| Memberships | `workspace_members` | Until the member leaves or is removed, or the account or workspace is deleted | Same |
| Invitations | `workspace_invitations` (invitee e-mail, token hash) | The link works once and for 7 days. The row stays until the workspace or the inviter's account is deleted, and stays even when the invitee deletes their own account. | **To decide**: remove used, revoked and expired invitations after a set time |
| Reports and sections | `reports`, `report_sections` (text, accepted AI draft, assignee) | Until an owner or admin deletes the report in the app (an owner, for a final report), or its workspace or organization is deleted. When an assignee's account is deleted, their sections become unassigned. | Set by the firm |
| Deliverables | `deliverables` (file name, extracted text, uploader) | Until a section editor deletes the file in the app, or its section, report or workspace is deleted. An upload never finished is deleted, row and file, after one day, the next time the same person starts an upload in that section. | Same |
| AI generations | `ai_generations` | The whole row stays until the workspace is deleted, see [below](#ai-generations) | **To decide**: clear the content columns once the section is gone |
| Prompt templates | `prompt_library`, `prompt_rollouts` | Versions are never deleted, only archived, until the workspace is deleted. The author link becomes null when the author's account is deleted. | Same |
| Exports | `report_exports` | Until the report or workspace is deleted. An export still pending after 2 minutes is marked failed. | 90 days, see [below](#exports) |
| Status history | `report_status_events` | Until the report or workspace is deleted. The author link becomes null when the author's account is deleted. | Same |
| Notifications | `notifications` | Until the recipient's account, the report or the workspace is deleted | **To decide**: for example remove read notifications after a set time |
| AI cost alerts | `ai_cost_alerts` | One row per day, kept. No personal data. | Same |
| Deletion log | `private.audit_events`: who deleted a report, a workspace or an organization (user id), when, the ids and counts of what went. No title, name or content. | Kept. No foreign key, so it outlives the account and what it is about. | **To decide**: for example 12 months, then a job removes older rows |
| Billing of a deleted organization | `organization_billing`, `billing_entitlements`, `billing_ai_packs`, `billing_draft_usage` | Deleted with the organization. `private.billing_events` and `private.billing_trial_claims` stay: no foreign key, so a new organization of the same person gets no second trial. Deleting a workspace keeps the draft ledger of its organization. | Same |
| Payments and receipts (KRB-176) | `billing_purchases`, `billing_receipts`, their lines and payment events | Kept when the organization is deleted, with `organization_id` set to null: the receipt holds a copy of the buyer. Only the service role reads them after that. | 10 years under OHADA, **to confirm** with the accountant (ADR 001, A5) |

## Storage files

| Bucket | Today | Target |
| --- | --- | --- |
| `deliverables` | Removed by the app when a file is deleted from the section page, when an upload fails the checks, and when an unfinished upload is cleaned up. When the row goes with its section, report or workspace, the daily job removes the file. | Same |
| `exports` | A manual export is kept 90 days: the daily job deletes the row and then its file. A final snapshot is kept as long as its report, and the daily job removes it after the report is deleted. | Same |

The daily job runs at 03:00 UTC from Vercel Cron (`vercel.json`; on the Hobby plan, at some point in that hour) and only works when `CRON_SECRET` is set on the Vercel environment ([`docs/deployment.md`](../deployment.md#scheduled-jobs)). A report finalized, reopened and finalized again keeps one final snapshot per finalization, all of them as long as the report. Keeping only the latest one is **to decide**.

## AI generations

Each request for a draft is one row in `ai_generations`. It holds usage (tokens, cost, latency, model, requester, dates) and content (the draft in `output` and `raw_output`, the file names in `context_meta`, the requester's `feedback_comment`).

- Before migration `20261013230000_ai_generations_keep_usage.sql`, deleting a section deleted its generations, which took their tokens out of the hourly limit and the monthly budget. Now the row stays with `section_id` set to null, and only owners and admins can read it. Deleting the workspace removes it.
- That migration keeps the whole row, not only the usage. The draft text and file names of a deleted section stay until the workspace goes. Deleting a report in the app (KRB-180) does the same: its generations stay with `section_id` set to null.
- When the requester's account is deleted, `requested_by` becomes null. The rest of the row, `feedback_comment` included, stays.
- The hourly limit reads the last hour and the budget reads the current calendar month (UTC). The AI dashboard reads usage over a chosen period. None of them reads the content columns.

**To decide**: when a section is deleted, or when the month of a generation is over, set `output`, `raw_output` and `feedback_comment` to null and strip the file names from `context_meta`, keeping the usage columns. That keeps the limits, the budget and the dashboard working. It needs a migration and a job, so it is a follow-up.

Provider side: how long Anthropic or OpenAI keep prompts and outputs is set by their terms, **to confirm** ([`processors.md`](processors.md)). With tracing on, Langfuse keeps traces per its own settings: provider default.

## Exports

Policy since KRB-166:

- A manual export (`kind = 'manual'`, from the export buttons) is kept 90 days, then the daily job deletes its row and its file.
- The final snapshot (`kind = 'final'`, the PDF stored when a report becomes final) is kept as long as the report.
- When an export or deliverable row is deleted, by the app or by a cascade, the daily job removes its file.

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
- After a restore, apply again every erasure done since the backup date, from the request log (see [`data-subject-requests.md`](data-subject-requests.md)). Before copying a file back from `deleted/`, check the log too: it may have been deleted on request.

## Browser and device

| Data | Retention |
| --- | --- |
| Supabase session cookies | Until sign-out or the session ends |
| `kr-espace` cookie (current workspace id) | One year |
| `localStorage` (sidebar state, theme) | Until the person clears it. No personal data. |
| Pages kept by the service worker for offline reading | Removed at sign-out. The app shell and static files stay. |

## Out of scope

CI keeps test reports for 7 days and eval reports for 90 days on GitHub. They hold only the local seed accounts and the synthetic eval cases.
