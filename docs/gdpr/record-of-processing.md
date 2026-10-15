# Record of processing activities

This is the Article 30 record for KolabReport. It lists each processing activity with its purpose, legal basis, the people and data concerned, who receives the data, transfers outside the EU, how long the data stays and how it is protected. The data categories come from the schema in `supabase/migrations/*.sql` and from the code that writes and sends data (`src/lib`, `src/app/api`). The roles and legal bases are proposals: they are marked as such and need a lawyer's review (see [`README.md`](README.md)).

| | |
| --- | --- |
| Organization keeping the record | Mocktar Technologies, établissement, C 1357 Houeyiho, 07BP91 Cotonou, République du Bénin. RCCM COTONOU N° RB/COT/26 A 119654, IFU 1200900488800. Same details as `src/content/legal/publisher.ts`. |
| Contact for data protection | support@mocktar.com |
| EU representative, DPO | **To confirm** whether either is needed |
| Last updated | 2026-10-14 |
| Database, Auth and Storage | Supabase, region EU West Paris (`eu-west-3`), per `docs/deployment.md` |
| App server | Vercel, functions in `cdg1` (Paris), per `vercel.json` |

Processors are described in [`processors.md`](processors.md) and retention in [`retention.md`](retention.md). The tables below link to them instead of repeating them.

## 1. Accounts and authentication

| Field | Entry |
| --- | --- |
| Role | Controller (assumption to confirm) |
| Purpose | Create an account, confirm the e-mail address, sign in, reset the password, keep the session, show a person's name to their co-members |
| Legal basis (proposed) | Contract, Article 6(1)(b), with the person who signs up. Legitimate interest, Article 6(1)(f), for sign-in security (sessions, audit log). |
| Data subjects | People who sign up: owners, admins, experts and viewers of the firms' workspaces |
| Data categories | `auth.users`: e-mail, password hash (Supabase Auth uses bcrypt, see `src/lib/auth/schemas.ts`), confirmation and recovery tokens with their timestamps, last sign-in, `raw_user_meta_data.full_name` from the sign-up form. `auth.sessions`: IP address, user agent, created and refreshed times. `auth.identities`, refresh and one-time tokens. `auth.audit_log_entries`: account events (sign-in, sign-up) with user id, name, e-mail and IP address. `public.profiles`: e-mail, full name, `avatar_url` and `job_title` (no screen fills these two yet), locale. In the browser: Supabase session cookies, the `kr-espace` cookie (id of the current workspace, one year), and `localStorage` keys for the sidebar and theme. |
| Recipients | Supabase (Auth and database), Vercel (the middleware refreshes the session cookie on each request), the e-mail provider for Auth e-mails (Supabase Auth SMTP, templates in `supabase/templates/`). Members of a shared workspace see each other's name and e-mail (RLS policy `profiles: read self and co-members`). |
| Transfers outside the EU | See Supabase, Vercel and the e-mail provider in [`processors.md`](processors.md) |
| Retention | Until the account is deleted. No rule yet for accounts never confirmed or inactive. See [`retention.md`](retention.md). |
| Security measures | Passwords of 8 to 72 characters, e-mail confirmation (`enable_confirmations = true` in `supabase/config.toml`, to confirm on the hosted projects), refresh token rotation, the sign-up form answers the same whether or not the e-mail already has an account, RLS on `profiles`, HTTPS with HSTS. The offline caches of the PWA are cleared on sign-out (`src/lib/pwa/clear-offline-caches.ts`). |

## 2. Workspace membership and invitations

| Field | Entry |
| --- | --- |
| Role | Processor for the firm (assumption to confirm) |
| Purpose | Let a firm create its organization and workspaces, invite people by e-mail with a role, and limit what each role can do |
| Legal basis | Set by the firm, as controller. On KolabReport's side, the customer contract. |
| Data subjects | Members, and invitees who may not have an account yet |
| Data categories | `organizations`: name, slug, `owner_id`. `workspaces`: name, description, `created_by`. `workspace_members`: user, role, `invited_by`, date joined. `workspace_invitations`: invitee e-mail, role, SHA-256 hash of the link token (the token itself is never stored), `invited_by`, expiry, accepted and revoked dates, `accepted_by`. |
| Recipients | Supabase, Vercel, the e-mail provider (invitation e-mail, activity 5). Owners and admins of the workspace see its invitations. Anyone holding an invitation link sees, through `invitation_preview`, the invitee e-mail, the inviter's name, the workspace and organization names, the role and the expiry. |
| Transfers outside the EU | See [`processors.md`](processors.md) |
| Retention | A membership lasts until the person leaves or is removed, or the workspace is deleted. An invitation link is valid 7 days and works once, but the row stays until the workspace or the inviter's account is deleted. See [`retention.md`](retention.md). |
| Security measures | Token stored as a hash only, single use, accepted only by the confirmed e-mail it was sent to. Admins cannot invite or manage owners. A workspace always keeps one owner (`guard_last_owner`, migration `20261013150000_workspace_rbac.sql`). RLS on every table. |

## 3. Report content and uploaded deliverables

| Field | Entry |
| --- | --- |
| Role | Processor for the firm (assumption to confirm) |
| Purpose | Let a firm's team write expertise reports together: sections, assignments, uploaded files and their extracted text, review and finalization |
| Legal basis | Set by the firm, as controller |
| Data subjects | Members, as authors, assignees and uploaders. Any person named in a report or a file: clients of the firm, beneficiaries, staff of audited organizations. What the files contain is up to the firm, so special category data can't be ruled out. |
| Data categories | `reports`: title, description, status, due date, `created_by`. `report_sections`: title, instructions, content (Markdown, up to 100,000 characters), `ai_draft` (the accepted AI draft), `assigned_to`, status and dates. `deliverables`: file name, type, size, storage path, extracted text (`parsed_content`, for Word, Excel, CSV, text and Markdown files), `parse_meta`, `uploaded_by`. Files in the `deliverables` bucket: Word, Excel, CSV, PowerPoint, PDF, text, images and diagrams, 50 MB at most. `report_status_events`: who moved a report between draft, review and final, and when. |
| Recipients | Supabase (database, Storage, Realtime: section changes reach the open pages of members), Vercel (renders pages, reads and parses files in a function). Members of the workspace, according to their role. The LLM provider only when a member asks for an AI draft (activity 4). |
| Transfers outside the EU | See [`processors.md`](processors.md) |
| Retention | Until the firm deletes it or the workspace is deleted. Stored files of rows deleted by cascade are removed by the daily cleanup job (KRB-166). See [`retention.md`](retention.md). |
| Security measures | RLS by workspace and role: viewers read, experts write only the sections assigned to them, owners and admins manage. A final report is frozen until an owner reopens it. Private bucket, files read through signed links valid 60 seconds after an access check. Uploads go to a path registered beforehand and are checked (size, type, first bytes, scripts in SVG refused). Users can't replace or delete a stored file: the app removes it with the service role once the row is gone. |

## 4. AI draft generation

| Field | Entry |
| --- | --- |
| Role | Processor for the draft itself, asked for by a member of the firm. Controller for usage metering, limits, the cost alert and quality metrics. Both are assumptions to confirm. |
| Purpose | Propose a draft of a section from its instructions and the files uploaded to it. Count tokens and cost against the limits. Measure draft quality per prompt version (acceptance, edits, ratings). |
| Legal basis (proposed) | Set by the firm for the draft. Legitimate interest, Article 6(1)(f), for metering, abuse limits and quality. |
| Data subjects | The member who asks. People named in the section, the report or the files. |
| What the AI provider receives | The system prompt and the prompt template filled with: section title and instructions, report title and description, workspace name, and the extracted text of the section's parsed files, each with its file name. PDF, PowerPoint, images and diagrams are not read, so they are never sent. Long files are cut, and the parts that don't fit are summarized by extra calls to the fast model, which get the same masked text. The app adds no user id, e-mail or name of the person asking. Details below. |
| Data categories stored | `ai_generations`: `requested_by`, section, workspace, prompt version and rollout, provider, model, parameters, SHA-256 hashes of the context and of each file's text, `context_meta` (files used with their original names, token estimates, what was cut or summarized, how many items were masked), `output` (the structured draft), `raw_output` (raw model text, up to 200,000 characters), tokens, cost estimate, latency, status, error code, accepted or discarded, edit distance, rating, `feedback_comment` (up to 1,000 characters), trace id. `prompt_library`: workspace templates with title, description, text, changelog and `created_by`. `prompt_rollouts`: `created_by`. `ai_cost_alerts`: one row per day with amounts, no personal data. |
| Recipients | The LLM provider set by `AI_PROVIDER` (Anthropic or OpenAI), and the one in `AI_FALLBACK_PROVIDER` when set and the first call fails before answering. Supabase, Vercel. With `AI_TRACING=true` only: Langfuse or another OTLP backend (activity 8). In the app, owners, admins and the section's editors see the drafts, and owners and admins see the AI dashboard. |
| Transfers outside the EU | Anthropic and OpenAI are US companies. See [`processors.md`](processors.md) for safeguards and their status. |
| Retention | A generation row stays until the workspace is deleted. When its section or report is deleted, the row stays with `section_id` set to null so its usage still counts (migration `20261013230000_ai_generations_keep_usage.sql`), and its text is cleared: `output`, `raw_output`, `feedback_comment` and the file names in `context_meta` (KRB-180). Provider side: per its terms, **to confirm**. See [`retention.md`](retention.md). |
| Security measures | Drafts are off until the eval suite passes (`AI_DRAFTS_ENABLED`). Personal data masking (below). Prompt injection guards: file text sits inside `<livrable>` blocks that user text can't open or close (`src/lib/ai/context/guards.ts`). Per-user hourly limit (30 by default), per-workspace monthly token budget (2,000,000 by default), one draft at a time per section, prompt capped at 60,000 tokens by default. A draft reaches the section only when the expert accepts it. Rows are written by the service role after the app's access checks, and read through RLS. Prompt and output text stay out of traces unless `AI_TRACE_CONTENT=true`. |

### Masking before AI calls

With `AI_REDACT_PII=true`, the default in `src/lib/ai/models.ts`, the context builder (`src/lib/ai/context/redact.ts`) replaces these with a placeholder before anything goes to the provider, in the template values, the file text and the file names:

| Masked | How it is found |
| --- | --- |
| E-mail addresses | Pattern |
| Phone numbers | Benin numbers with `+229` or `00229`, French numbers with `0X`, `+33` or `0033` |
| IBANs | Pattern and checksum |
| French social security numbers (NIR) | Pattern |
| Card numbers | 13 to 19 digits that pass the Luhn check |

Not masked: names of people, postal addresses, other identity or tax numbers, dates of birth, and anything else written in plain text, such as health details. The customer terms should say so (open action in [`README.md`](README.md)).

## 5. Transactional e-mails

| Field | Entry |
| --- | --- |
| Role | Controller for Auth e-mails. Processor for invitations and report status e-mails, sent for the firm. Assumptions to confirm. |
| Purpose | Confirm an e-mail address, reset a password, invite someone to a workspace, tell members that a report changed status. A daily AI cost alert goes to the operator. |
| Legal basis (proposed) | Contract for Auth e-mails. Set by the firm for invitations and status e-mails. |
| Data subjects | Users and invitees |
| Data categories | Recipient e-mail in every case. Auth e-mails: confirmation, recovery and e-mail change links. Invitation (`src/lib/email/invitation-email.ts`): inviter's name, workspace and organization names, role, link with the token, expiry date. Status e-mail (`src/lib/email/report-status-email.ts`): report title, workspace name, name of the person who changed the status, link to the report. Cost alert: environment name and amounts only, sent to `AI_ALERT_EMAIL`. |
| Recipients | The e-mail provider: Resend or Brevo through `EMAIL_PROVIDER` for the app's e-mails, and the SMTP sender set in Supabase Auth for Auth e-mails. Then the recipient's mailbox provider. |
| Transfers outside the EU | See [`processors.md`](processors.md) |
| Retention | The app keeps no copy of sent e-mails. The provider keeps its own logs: provider default, **to confirm**. |
| Security measures | API keys stored as Sensitive variables, user-written names escaped in the HTML, links lead to pages that check access again. |

## 6. Exports

| Field | Entry |
| --- | --- |
| Role | Processor for the firm (assumption to confirm) |
| Purpose | Let owners and admins download a report as `.docx` or PDF, and keep a PDF snapshot of a report when it becomes final |
| Legal basis | Set by the firm, as controller |
| Data subjects | Members (each section's assignee is printed: "Responsable : name"), and anyone named in the report |
| Data categories | `report_exports`: who exported, when, format, file name, size, number of sections, kind (`manual` or `final`), the status change of a final snapshot. Files in the `exports` bucket: the report content. |
| Recipients | Supabase Storage, Vercel (builds the file in a function), owners and admins of the workspace |
| Transfers outside the EU | See [`processors.md`](processors.md) |
| Retention | Manual exports 90 days. The final snapshot as long as its report. The daily cleanup job (KRB-166) removes the files. See [`retention.md`](retention.md). |
| Security measures | Only owners and admins export or list exports (RLS). Private bucket with no policies: only the service role writes and signs. Download links last 60 seconds and are signed after an RLS check. 20 exports per person, workspace and hour. |

## 7. Notifications

| Field | Entry |
| --- | --- |
| Role | Processor for the firm (assumption to confirm) |
| Purpose | Tell members in the app that a report changed status |
| Legal basis | Set by the firm, as controller |
| Data subjects | Owners, admins and experts with a section in the report, and the person who made the change |
| Data categories | `notifications`: recipient, workspace, status change, created and read dates. `report_status_events`: who changed the status, from and to, when. |
| Recipients | Supabase, Vercel. Each recipient sees only their own notifications, while they are a member. |
| Transfers outside the EU | See [`processors.md`](processors.md) |
| Retention | Until the recipient's account, the report or the workspace is deleted. No time limit today. See [`retention.md`](retention.md). |
| Security measures | RLS: recipients only, and only `read_at` can be changed by them |

## 8. Technical logs and monitoring

| Field | Entry |
| --- | --- |
| Role | Controller |
| Purpose | Run, debug and secure the service, and catch abuse and cost spikes |
| Legal basis (proposed) | Legitimate interest, Article 6(1)(f): security and operation of the service |
| Data subjects | Users and visitors of the site |
| Data categories | Vercel function logs: what the app prints (error messages, counts; the code avoids printing e-mails and report content) plus the request data Vercel records by default. Supabase logs of the API, database, Auth and Storage, which can include IP addresses: provider default. `auth.audit_log_entries` (activity 1). AI traces when `AI_TRACING=true`: generation id, workspace id, prompt version, model, tokens, latency, cost and error code, no prompt or output text unless `AI_TRACE_CONTENT=true` (`src/lib/ai/tracing.ts`). Sentry when `NEXT_PUBLIC_SENTRY_DSN` is set (`src/lib/monitoring`): errors of the browser, the server and the middleware with their message and stack trace, the Supabase user id of a signed-in user (no e-mail, name or IP address), the URL without its query string, the route, browser and OS, release and environment, scrubbed breadcrumbs, and in production 1 in 10 browser page loads as traces. Delivery logs at the e-mail provider. |
| Recipients | Vercel, Supabase, the e-mail provider, Langfuse or the OTLP backend when tracing is on, Sentry when its DSN is set. People with access to these dashboards: **to confirm** (list them, and check two-factor sign-in on each account). |
| Transfers outside the EU | See [`processors.md`](processors.md) |
| Retention | Provider defaults. Nothing in the repository sets a log retention. See [`retention.md`](retention.md). |
| Security measures | Only AI spans leave the server when tracing is on (`AiSpanFilter`). Sentry gets the user id and nothing else about the user. Before sending, `src/lib/monitoring/scrub.ts` drops cookies, request bodies, headers other than user agent and content type, query strings and extra context, and masks e-mail addresses, invitation tokens, auth codes and AI output in messages (unit tests in `scrub.test.ts`). Browser events go through `/monitoring` on the app's own origin, and the Sentry organization is in the EU region. |

## Measures that apply to every activity

- Row-level security on every table in `public`. Policies call `SECURITY DEFINER` helpers in the `private` schema with a fixed `search_path`. Signed-out visitors have no table access, signed-in users have only the privileges the app needs, often column by column (migrations `20261013130000_tighten_table_privileges.sql` and later).
- The service-role client (`src/lib/supabase/admin.ts`) is server-only and every query made with it is scoped by `workspace_id`.
- Secrets live in Vercel and GitHub environment variables, one value per environment, never in the repository. CI fails on a `NEXT_PUBLIC_*` name that looks like a secret.
- Security headers on every page: Content-Security-Policy, HSTS, `X-Frame-Options: DENY`, `X-Content-Type-Options: nosniff`, Referrer-Policy (`next.config.mjs`).
- The service worker never caches Supabase or `/api/` responses, nor the auth and invitation pages.
- Encryption at rest and in transit inside each provider: per the provider, **to confirm** in its DPA.

## Out of scope

- The eval suite uses synthetic cases only: organizations, people and documents are invented (`evals/README.md`). The local seed accounts (`supabase/seed.sql`) never reach staging or production.
- Fonts come from `next/font/google`, which downloads them at build time and serves them from the app. Browsers don't call Google.
