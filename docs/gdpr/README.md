# GDPR documentation

This folder documents how KolabReport handles personal data: what it processes and why, who it shares it with, how long it keeps it, and how to answer a person who asks for their data or for its deletion. It answers Jira KRB-151 (part of KRB-24): a record of processing, the DPA with the LLM provider, a retention policy and the export and deletion procedure. Every fact here comes from the repository (migrations, code, `.env.example`, `docs/deployment.md`) or from the providers' public legal pages. Anything the repository can't tell, such as signed contracts or the legal entity's details, is marked **to confirm**.

This is not legal advice. A lawyer should review these documents before launch.

| File | What it holds |
| --- | --- |
| [`record-of-processing.md`](record-of-processing.md) | Record of processing activities (Article 30), one table per activity |
| [`processors.md`](processors.md) | Subprocessors, what each one receives, region and DPA status |
| [`retention.md`](retention.md) | How long each kind of data is kept, today and as targeted |
| [`data-subject-requests.md`](data-subject-requests.md) | Operator runbook for access, export, rectification and erasure requests |

## Owner and review

| | |
| --- | --- |
| Product | KolabReport, operated by Mocktar Technologies |
| Maintained by | Mocktar Tairou (Mocktar Technologies) |
| Last reviewed | 2026-10-14 |
| Contact for data requests | support@mocktar.com, the address the legal pages give (KRB-159) |

Update these pages in the same pull request as the change when you:

- add a migration with a table or column that holds personal data (update the record, the retention table and the queries in the runbook),
- wire a new external service, or change `AI_PROVIDER`, `AI_FALLBACK_PROVIDER`, `EMAIL_PROVIDER` or the tracing settings (update `processors.md`),
- change how long something is kept, or add a cleanup job (update `retention.md`).

Review the whole folder at least once a year, and before each new type of customer data goes in (for example a new file type that the AI reads).

## Controller and processor roles

KolabReport hosts the work of consulting firms. Each firm creates an organization and workspaces, invites its experts and writes expertise reports for its own clients. That gives KolabReport two roles. **Both are assumptions the owner must confirm with a lawyer**, and the customer contract has to say the same thing.

| Data | Role of KolabReport (Mocktar Technologies) | Who decides |
| --- | --- | --- |
| Report content: reports, sections, uploaded deliverables, AI drafts, exports, workspace prompt templates, status history and notifications | **Processor**, on behalf of the firm | The firm is the controller. It decides what goes into a report, who works on it and how long it stays. |
| Team roster of a workspace: members, roles, invitations | **Processor** for the firm | The firm's owners and admins choose who joins and with which role |
| Account data: sign-up, e-mail, name, password, sessions, sign-in history | **Controller** | KolabReport decides how accounts work |
| Security logs, abuse limits (AI hourly limit, monthly token budget), AI cost and quality metrics | **Controller** | KolabReport runs and protects the service |

What follows from it, still to confirm:

- As a processor, KolabReport needs an Article 28 contract (a DPA) with each firm, and lists its subprocessors in it. `processors.md` is the list.
- A request from someone named in a report (a client of the firm, a person in a deliverable) goes to the firm. KolabReport helps the firm answer, it doesn't answer for it. `data-subject-requests.md` says how.
- Requests about an account (access, correction, deletion) are answered by KolabReport directly.

## Open actions for the owner

Nothing in the repository shows that any of these is done.

Contracts and roles:

- [ ] Confirm the roles above with a lawyer, and the details of Mocktar Technologies as the legal entity (full name, address, registration, country of establishment).
- [ ] Ask the lawyer whether an EU representative (Article 27) is needed given where Mocktar Technologies is established, whether Benin's data protection law also applies to firms and users in Benin, and whether a DPO or a DPIA is needed for AI processing of report content.
- [ ] Write the customer DPA that KolabReport signs with each firm (Article 28), with the subprocessor list from `processors.md`.
- [ ] Accept or sign the DPA of each subprocessor and record the date in `processors.md`: Supabase, Vercel (its DPA page says it covers Pro and Enterprise customers), the e-mail provider, the LLM provider(s), Langfuse if tracing is turned on, and Sentry once its DSN is set.
- [ ] Choose the production e-mail provider (`EMAIL_PROVIDER` and the Supabase Auth SMTP sender: Resend or Brevo) and remove the other one from `processors.md`.
- [ ] Choose the production LLM provider and model, and the fallback (`AI_FALLBACK_PROVIDER`) if any. For each one, confirm in its terms how long it keeps API inputs and outputs and whether it uses them for training. Ask whether zero data retention is available.

People and pages:

- [x] Name a contact for data requests (an e-mail address that someone reads) and add it to the table above.
- [x] Publish a privacy policy page in French (politique de confidentialité) under `/fr`, with the mentions légales and CGU (KRB-6.6.3). Done in KRB-159: `/fr/confidentialite`, `/fr/mentions-legales`, `/fr/cgu`, `/fr/cgv` and `/fr/accord-traitement-donnees`. The page must follow this folder: see [`docs/legal.md`](../legal.md) for how to update it and the points a lawyer still has to review.
- [ ] Decide what the customer terms say about sensitive data in deliverables. The masking before AI calls covers e-mails, phone numbers, IBANs, French social security numbers and card numbers, not names, postal addresses or health details (see `record-of-processing.md`).
- [ ] Write a short breach procedure: who decides, how firms are told without undue delay (as processor), and how the supervisory authority is told within 72 hours when KolabReport is the controller.

Configuration and engineering:

- [ ] Check production settings: `AI_REDACT_PII=true` (the default), `AI_TRACE_CONTENT=false` unless a DPA with the tracing vendor is signed, e-mail confirmation on in Supabase Auth.
- [x] Merge KRB-166 (daily storage cleanup and 90-day retention of exports) and describe the job in `retention.md`.
- [ ] Set `CRON_SECRET` on the Vercel production environment, so the daily storage cleanup runs there.
- [ ] Decide the retention rules still open in `retention.md`: AI generation content after its section is deleted, notifications, invitations, status history, accounts never confirmed or inactive, and the Supabase Auth audit log.
- [ ] Set up the nightly backups of production (database dump and Storage copy, `docs/operations/backups.md`), and decide on the Supabase Pro plan and point-in-time recovery. Their retention is in `retention.md`.
- [ ] Build self-service data export and account deletion (proposed follow-up at the end of `data-subject-requests.md`). Until then, an operator answers requests with the runbook.
- [ ] Keep a log of answered requests (date, type, user id, what was done), so erasures can be applied again after a backup restore.
