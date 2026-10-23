# Subprocessors

These are the services that receive personal data from KolabReport. For report content KolabReport is itself a processor for the firms (see [`README.md`](README.md)), so for that data these services are subprocessors and the customer DPA has to list them. What each one receives comes from the code and the configuration in the repository. The repository holds no signed contract, so every DPA below is **to sign / to confirm**. Links are the providers' own legal pages, checked on 2026-10-14.

| Service | Used for | Region | DPA status |
| --- | --- | --- | --- |
| Supabase | Database, Auth, Storage, Realtime | EU West Paris (`eu-west-3`) | To sign / to confirm |
| Vercel | Hosting of the Next.js app and its functions | Functions in `cdg1` (Paris) | To sign / to confirm, needs Pro or Enterprise |
| Resend **or** Brevo | App e-mails (`EMAIL_PROVIDER`) and the Supabase Auth SMTP sender | Resend: US company. Brevo: France and Belgium. | To sign / to confirm, once one is chosen |
| Anthropic | AI drafts when `AI_PROVIDER=anthropic` (the default) or as fallback | US company, **to confirm** | To sign / to confirm |
| OpenAI | AI drafts when `AI_PROVIDER=openai` or as fallback | US company, **to confirm** | To sign / to confirm, only if used |
| Langfuse | Traces of AI calls, only with `AI_TRACING=true` | EU (Ireland) with the default `https://cloud.langfuse.com` | Only if tracing is turned on |
| Sentry | Error monitoring, only with `NEXT_PUBLIC_SENTRY_DSN` set | EU data storage location (`de.sentry.io`), US company | To sign / to confirm, before the DSN is set on production |
| Cloudflare R2 | Off-site copy of the Storage files, only once the `backup-storage.yml` secrets are set | EU jurisdiction bucket | To sign / to confirm, before the job runs on production |
| GitHub | Runs the nightly backup jobs and keeps the encrypted database dump 14 days, only once their secrets are set | Not chosen, US company | To confirm for this account's plan |
| FedaPay | Payment of the offers by mobile money and card, once billing is launched (KRB-179); the sandbox account on staging before that | To confirm | To confirm, see [FedaPay](#fedapay) |

## Supabase

- **Receives**: everything the app stores. Accounts and sessions (Auth), all tables in `public` (report content, files' extracted text, AI generations, invitations, notifications), the files in the `deliverables` and `exports` buckets, and its own request logs.
- **Region**: the staging and production projects are created in EU West Paris (`eu-west-3`), per `docs/deployment.md`. Clause 6.1 of Supabase's DPA lets Supabase process data wherever it or its subprocessors have facilities, under its transfer clauses. So support access or a subprocessor can sit outside the EU: check the subprocessor list.
- **DPA**: https://supabase.com/legal/customer-resources/data-processing-addendum
- **Subprocessors**: https://supabase.com/legal/customer-resources/subprocessor-list (Supabase offers a way to subscribe to changes on that page).
- **Status**: to sign / to confirm. Daily backups need the Pro plan (`docs/deployment.md`).

## Vercel

- **Receives**: every request between the browser and the app, and every page it renders. That covers report content in pages, form posts, session cookies (the proxy refreshes them), files that a function downloads from Supabase to parse, exports built in a function, and the prompts and drafts of AI calls, which go through a function. Uploads and downloads of files themselves go straight between the browser and Supabase through signed links. Function logs (what the app prints).
- **Region**: functions run in `cdg1` (Paris), set in `vercel.json`. Requests first reach Vercel's edge network, which is global. What that means for transfers outside the EU is **to confirm** in Vercel's DPA.
- **DPA**: https://vercel.com/legal/dpa. That page says it applies to Pro and Enterprise customers, so a Hobby plan has none.
- **Status**: to sign / to confirm, and check the plan.

## E-mail provider: Resend or Brevo

The code supports both (`src/lib/email/send.ts`), and `docs/deployment.md` names both for the Supabase Auth SMTP sender. Production should use one. Remove the other from this page once chosen.

- **Receives**: the recipient's e-mail, the subject and the body. Bodies hold names (inviter, person who changed a report's status), workspace and organization names, report titles, and links, including invitation links with their token and Auth links for confirmation and password reset (activity 5 in [`record-of-processing.md`](record-of-processing.md)).
- **Launch reminder** (KRB-239, Resend only): Resend also keeps the list of addresses left on the site before the launch, as contacts in the segment "KolabReport lancement", and sends them the launch e-mail as a broadcast. Activity 10 in [`record-of-processing.md`](record-of-processing.md).
- **Tracking**: check whether open and click tracking is on for transactional e-mails in the provider's settings, and turn it off unless it is needed.

### Resend

- **Region**: US company. Resend states that it is certified under the EU-US Data Privacy Framework (https://resend.com/changelog/data-privacy-framework-certification). Where it stores e-mail logs: **to confirm**.
- **DPA**: https://resend.com/legal/dpa. Resend's documentation says this DPA is pre-signed and in force once you sign up, with no counter-signature needed (https://resend.com/docs/knowledge-base/downloading-documents).
- **Subprocessors**: https://resend.com/legal/subprocessors
- **Status**: to confirm. Save a copy of the DPA version in force when the account was created.

### Brevo

- **Region**: Brevo's DPA (Annex 2) lists processing locations in France and Belgium, and group companies in India and the USA for customer support, covered by Standard Contractual Clauses (and the Data Privacy Framework for the USA).
- **What it keeps**: for transactional sending, Brevo's DPA (Annex 1) says it stores usage data: IP addresses, open and click rates from tracking, date and time, recipient, subject and content of the e-mail. The e-mail previews can be turned off in the settings.
- **DPA**: Appendix 3 of the Terms of Service, https://www.brevo.com/legal/termsofuse/
- **Status**: to confirm.

## LLM providers

The Vercel AI SDK talks to Anthropic (`@ai-sdk/anthropic`) or OpenAI (`@ai-sdk/openai`), chosen by `AI_PROVIDER` in `src/lib/ai/models.ts`. `AI_FALLBACK_PROVIDER` can add the other one as a fallback, called when the first fails before answering. The `mock` provider makes no external call and is refused in production. Each environment has its own API key (`docs/deployment.md`), so staging calls the provider too: keep real customer data out of staging.

- **Receives**: per draft, the system prompt and the filled template: section title and instructions, report title and description, workspace name, and the extracted text and file names of the section's parsed files (Word, Excel, CSV, text, Markdown, PDF), after masking when `AI_REDACT_PII=true`. Summary calls get parts of the same masked text. No user id, e-mail or requester name. Full list and what the masking covers: activity 4 in [`record-of-processing.md`](record-of-processing.md).
- **To confirm with each provider before launch**: how long it keeps API inputs and outputs, whether it uses them for training, where it processes them, and whether zero data retention is available for the account.

### Anthropic

- Default provider, with the default models `claude-sonnet-5-5` (standard) and `claude-haiku-5-5` (fast) in `src/lib/ai/models.ts`.
- **Region**: US company. Processing location: **to confirm**.
- **DPA**: Anthropic's privacy center says its DPA, with Standard Contractual Clauses, is incorporated into its Commercial Terms of Service. Commercial Terms: https://www.anthropic.com/legal/commercial-terms. DPA: https://www.anthropic.com/legal/data-processing-addendum
- **Status**: to confirm that the API account is under the Commercial Terms, and record the DPA version.

### OpenAI

- Used when `AI_PROVIDER=openai` (default models `gpt-5` and `gpt-5-mini`) or as the fallback.
- **Region**: US company. Processing location: **to confirm**.
- **DPA**: https://openai.com/policies/data-processing-addendum/. OpenAI's enterprise privacy page says it can sign a DPA with API customers (https://openai.com/enterprise-privacy/).
- **Status**: to sign, only if OpenAI is used in production. Otherwise leave `OPENAI_API_KEY` and `AI_FALLBACK_PROVIDER` empty there and remove this section.

## Langfuse (optional)

- **When**: only with `AI_TRACING=true` and the Langfuse keys set (`src/lib/ai/tracing.ts`). Off by default.
- **Receives**: one trace per draft with the generation id, workspace id, prompt version, model, tokens, latency, cost and error code. Prompt and output text only with `AI_TRACE_CONTENT=true`, which `.env.example` says needs a DPA with the vendor.
- **Region**: the default base URL `https://cloud.langfuse.com` is Langfuse's EU region, in Ireland (AWS `eu-west-1`), per https://langfuse.com/security/data-regions
- **DPA**: Langfuse's privacy FAQ says you can sign one: https://langfuse.com/security/privacy-faq
- **Status**: not needed while tracing is off. Any other OTLP backend set through `OTEL_EXPORTER_OTLP_ENDPOINT` would be a new subprocessor and has to be added here.

## Sentry (optional)

- **When**: only when `NEXT_PUBLIC_SENTRY_DSN` is set at build time (`src/lib/monitoring`, KRB-136). Off by default. Setup: [`docs/operations/monitoring.md`](../operations/monitoring.md#sentry).
- **Receives**: the errors of the browser, the server and the proxy: error type, message and stack trace, the Supabase user id of a signed-in user, the page or request URL without its query string, the route, the browser and OS (from the user agent), release and environment, and breadcrumbs (clicks, navigations, requests, console lines). In production, also 1 in 10 browser page loads and navigations as traces, and session counts for crash-free rates. No e-mail, name or IP address: the SDK's `dataCollection.userInfo` is off and the project setting "Prevent Storing of IP Addresses" has to be on. Before anything leaves, `src/lib/monitoring/scrub.ts` masks e-mail addresses, invitation tokens, auth codes and AI output in messages, and drops cookies, request bodies, headers other than user agent and content type, and extra context. An error message can still quote other data the code was handling: the scrubbing only catches the known cases.
- **Region**: the organization is created with the EU data storage location, so events, releases and source maps stay in the EU (API at `de.sentry.io`). Per https://docs.sentry.io/organization/data-storage-location/, some account data stays in the US whatever the region: users, tokens, DSN keys, project settings. Sentry is Functional Software, Inc., a US company.
- **DPA**: https://sentry.io/legal/dpa/ (version 5.1.0 of May 29, 2024 on 2026-10-14, with Standard Contractual Clauses). Subprocessors: https://sentry.io/legal/subprocessors/
- **Status**: to sign / to confirm before the DSN is set on production.

## Backups

Two nightly GitHub Actions jobs copy production data out of Supabase (KRB-141, KRB-142, [`docs/operations/backups.md`](../operations/backups.md)). Each one does nothing until its secrets are set. Once they run, the two services below receive customer data. Both are in the table at the top with that condition.

### Cloudflare R2 (optional)

- **When**: only once the `backup-storage.yml` secrets are set on a GitHub environment.
- **Receives**: a copy of every file in the `deliverables` and `exports` buckets, as uploaded (reports, spreadsheets, any personal data inside them), under their Storage paths (workspace and section ids, file names). A file deleted in the app moves to a `deleted/` prefix at the next nightly run and stays 30 more days, then a lifecycle rule removes it ([`retention.md`](retention.md#backups)). No database rows, no accounts.
- **Region**: the bucket is created with the **EU jurisdiction**, which Cloudflare says guarantees that its objects are stored in the EU, and it is reached through the `<account-id>.eu.r2.cloudflarestorage.com` endpoint (https://developers.cloudflare.com/r2/reference/data-location/). R2 encrypts objects at rest. Cloudflare's own access for support or its subprocessors: **to confirm** in the DPA.
- **DPA**: https://www.cloudflare.com/cloudflare-customer-dpa/ (version 6.4 of April 2026 was the latest on 2026-10-14). GDPR page with the subprocessor list: https://www.cloudflare.com/trust-hub/gdpr/
- **Status**: to sign / to confirm before the storage job runs on production. Another S3-compatible service can replace R2 (`BACKUP_S3_PROVIDER`): pick one with an EU region and a DPA, and update this section.

### GitHub (Actions runners and artifacts)

- **When**: once `backup-database.yml` or `backup-storage.yml` runs with its secrets.
- **Receives**: the GitHub-hosted runner of each run holds the plain database dump (every table, accounts and password hashes included) or the Storage files while the job runs, and deletes the machine afterwards. Only the database dump is kept: encrypted with age for our own key, as a run artifact, for 14 days. GitHub can't read it without the private key, which stays with the owner.
- **Region**: GitHub-hosted runners and artifacts are not in a region we choose. GitHub's DPA lets it transfer personal data to the United States or any country where GitHub or its subprocessors operate. A self-hosted runner in the EU would keep the plain data in the EU, at the cost of running that machine.
- **DPA**: GitHub Data Protection Agreement, part of the GitHub Customer Agreement: https://github.com/customer-terms/github-data-protection-agreement. Whether it covers this account's plan: **to confirm**.
- **Status**: to confirm before the backup jobs run on production.

## FedaPay

- **When**: the integration is in the code since KRB-176 (`src/lib/billing/fedapay.ts`, `src/lib/billing/checkout.ts`). Staging calls the sandbox account, which holds test payments only. Production calls the live account once billing is launched (KRB-179). The privacy policy and the CGV (KRB-159) already name it.
- **Receives from KolabReport**, when an owner starts a payment (`POST /v1/transactions`): the amount and currency, a description with the offer and the organization's name ("KolabReport, offre Cabinet, 1 mois, <organisation>"), the merchant reference (`KR-` and the purchase id), the purchase id as metadata, the address to send the buyer back to, and the buyer's e-mail address and first and last name from their profile. No phone number: the payer types it on FedaPay's page.
- **Receives from the payer**, on the FedaPay payment page: card or mobile money details, name, e-mail or phone number. KolabReport never sees them.
- **Sends back**: on the API and in webhooks, the transaction: id, reference, status, amount, currency, payment method, fees, dates and the merchant reference. Webhook bodies also carry the customer's e-mail and phone number. KolabReport keeps the ids, statuses, amounts, payment method and fees on the purchase (`public.billing_purchases`) and a status history without any payload (`private.billing_payment_events`). It never stores or logs a webhook body.
- **Role**: **to confirm**. A payment provider usually acts as a controller for the payment data it needs for its own obligations. The privacy policy lists it with the subprocessors and says it also processes payment data for its own account.
- **Region and terms**: **to confirm** on https://www.fedapay.com.

## Not subprocessors of customer data

- **GitHub, for the code and CI**: CI uses the local seed accounts and the synthetic eval cases, never customer data. The backup jobs are the exception, see [Backups](#backups).
- **Mailpit**: local and e2e only.

## When this list changes

Add the service here and in the record before it receives data, and tell the firms. How much notice they get, and whether they can object, is for the customer DPA to set (**to confirm**).
