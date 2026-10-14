# Retention policy

How long KolabReport keeps each kind of personal data. The "Today" column is what the code and the migrations do as of 2026-10-14. The "Target" column is either work in progress (KRB-166) or a rule the owner still has to decide, marked **to decide**. For report content the firm is the controller (see [`README.md`](README.md)): the firm decides when its reports go, and these rules are the defaults KolabReport applies for it.

Two facts shape most of the table:

- The app has no screen to delete an account, an organization, a workspace, a report or a section. A deliverable can be deleted from its section page, and a member can leave or be removed. Everything else is deleted by an operator on request ([`data-subject-requests.md`](data-subject-requests.md)).
- Deleting a row in the database does not delete its file in Storage, except when the app deletes a deliverable itself. Files of rows removed by a cascade (a deleted section, report or workspace) stay in the bucket until the cleanup job of KRB-166 removes them.

## Database

| Data | Where | Today | Target |
| --- | --- | --- | --- |
| Account | `auth.users`, `public.profiles` | Until an operator deletes it | Self-service deletion (follow-up). **To decide**: delete sign-ups never confirmed after a set time, and what happens to inactive accounts. |
| Sessions | `auth.sessions`, refresh tokens | Managed by Supabase Auth. Access tokens last 3,600 s and refresh tokens rotate (`supabase/config.toml`, to confirm on the hosted projects). Signing out ends the session of that browser only. | Provider default |
| Auth audit log | `auth.audit_log_entries` (user id, name, e-mail, IP address) | Nothing in the repository removes it | **To decide**, as a security log with a fixed period |
| Organizations and workspaces | `organizations`, `workspaces` | Until an operator deletes them. Deleting an organization deletes its workspaces. | Deleted or returned at the end of the firm's contract, as the customer DPA will say (**to confirm**) |
| Memberships | `workspace_members` | Until the member leaves or is removed, or the account or workspace is deleted | Same |
| Invitations | `workspace_invitations` (invitee e-mail, token hash) | The link works once and for 7 days. The row stays until the workspace or the inviter's account is deleted, and stays even when the invitee deletes their own account. | **To decide**: remove used, revoked and expired invitations after a set time |
| Reports and sections | `reports`, `report_sections` (text, accepted AI draft, assignee) | Until an operator deletes them, or the workspace is deleted. When an assignee's account is deleted, their sections become unassigned. | Set by the firm |
| Deliverables | `deliverables` (file name, extracted text, uploader) | Until a section editor deletes the file in the app, or its section, report or workspace is deleted. An upload never finished is deleted, row and file, after one day, the next time the same person starts an upload in that section. | Same, plus the KRB-166 cleanup for files |
| AI generations | `ai_generations` | The whole row stays until the workspace is deleted, see [below](#ai-generations) | **To decide**: clear the content columns once the section is gone |
| Prompt templates | `prompt_library`, `prompt_rollouts` | Versions are never deleted, only archived, until the workspace is deleted. The author link becomes null when the author's account is deleted. | Same |
| Exports | `report_exports` | Until the report or workspace is deleted. An export still pending after 2 minutes is marked failed. | 90 days, see [below](#exports) |
| Status history | `report_status_events` | Until the report or workspace is deleted. The author link becomes null when the author's account is deleted. | Same |
| Notifications | `notifications` | Until the recipient's account, the report or the workspace is deleted | **To decide**: for example remove read notifications after a set time |
| AI cost alerts | `ai_cost_alerts` | One row per day, kept. No personal data. | Same |

## Storage files

| Bucket | Today | Target (KRB-166) |
| --- | --- | --- |
| `deliverables` | Removed by the app when a file is deleted from the section page, when an upload fails the checks, and when an unfinished upload is cleaned up. Files whose row went with a section, report or workspace stay. | A daily job removes stored files whose row no longer exists |
| `exports` | Removed only when the app fails to record an export it just stored. Every other file stays, including after its report is deleted. | Manual exports kept 90 days. The final snapshot of a report kept as long as the report. The daily job removes files whose row no longer exists. |

KRB-166 is not merged yet. Update this page with what the job does once it is: how often it runs, whether it deletes the export row with its file, and what it does with older final snapshots. A report can be finalized, reopened and finalized again, which stores one final snapshot per finalization. Whether all of them are kept, or only the latest, is **to decide** in KRB-166.

## AI generations

Each request for a draft is one row in `ai_generations`. It holds usage (tokens, cost, latency, model, requester, dates) and content (the draft in `output` and `raw_output`, the file names in `context_meta`, the requester's `feedback_comment`).

- Before migration `20261013230000_ai_generations_keep_usage.sql`, deleting a section deleted its generations, which took their tokens out of the hourly limit and the monthly budget. Now the row stays with `section_id` set to null, and only owners and admins can read it. Deleting the workspace removes it.
- That migration keeps the whole row, not only the usage. The draft text and file names of a deleted section stay until the workspace goes.
- When the requester's account is deleted, `requested_by` becomes null. The rest of the row, `feedback_comment` included, stays.
- The hourly limit reads the last hour and the budget reads the current calendar month (UTC). The AI dashboard reads usage over a chosen period. None of them reads the content columns.

**To decide**: when a section is deleted, or when the month of a generation is over, set `output`, `raw_output` and `feedback_comment` to null and strip the file names from `context_meta`, keeping the usage columns. That keeps the limits, the budget and the dashboard working. It needs a migration and a job, so it is a follow-up.

Provider side: how long Anthropic or OpenAI keep prompts and outputs is set by their terms, **to confirm** ([`processors.md`](processors.md)). With tracing on, Langfuse keeps traces per its own settings: provider default.

## Exports

Target policy, being built in KRB-166:

- A manual export (`kind = 'manual'`, from the export buttons) is kept 90 days, then removed.
- The final snapshot (`kind = 'final'`, the PDF stored when a report becomes final) is kept as long as the report.
- A daily job removes files in the `exports` and `deliverables` buckets whose row no longer exists.

## Logs

Nothing in the repository sets a log retention, so each one is the provider's default for the plan in use.

| Log | Retention |
| --- | --- |
| Vercel function and request logs | Provider default |
| Supabase logs (API, database, Auth, Storage) | Provider default |
| E-mail provider logs (Resend or Brevo) | Provider default. Brevo's DPA lists what it keeps for transactional e-mails ([`processors.md`](processors.md)). |
| Langfuse traces, when tracing is on | Provider default, or the project's own setting |
| LLM provider logs of API calls | Per the provider's terms, **to confirm** |

## Backups

- Supabase daily backups come with the Pro plan, and point-in-time recovery is an add-on (`docs/deployment.md`). Turning them on and testing a restore is KRB-6.3.4, not done yet. Their retention is the provider's default for the plan: write it here once they are on.
- Data deleted from the database stays in the backups until they expire. After a restore, apply again every erasure done since the backup date, from the request log (see [`data-subject-requests.md`](data-subject-requests.md)).
- A backup of Storage files is planned (KRB-6.3.5) and not built. Whether Supabase's own backups include Storage files is **to confirm**.

## Browser and device

| Data | Retention |
| --- | --- |
| Supabase session cookies | Until sign-out or the session ends |
| `kr-espace` cookie (current workspace id) | One year |
| `localStorage` (sidebar state, theme) | Until the person clears it. No personal data. |
| Pages kept by the service worker for offline reading | Removed at sign-out. The app shell and static files stay. |

## Out of scope

CI keeps test reports for 7 days and eval reports for 90 days on GitHub. They hold only the local seed accounts and the synthetic eval cases.
