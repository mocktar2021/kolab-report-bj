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

## Supabase

- **Receives**: everything the app stores. Accounts and sessions (Auth), all tables in `public` (report content, files' extracted text, AI generations, invitations, notifications), the files in the `deliverables` and `exports` buckets, and its own request logs.
- **Region**: the staging and production projects are created in EU West Paris (`eu-west-3`), per `docs/deployment.md`. Clause 6.1 of Supabase's DPA lets Supabase process data wherever it or its subprocessors have facilities, under its transfer clauses. So support access or a subprocessor can sit outside the EU: check the subprocessor list.
- **DPA**: https://supabase.com/legal/customer-resources/data-processing-addendum
- **Subprocessors**: https://supabase.com/legal/customer-resources/subprocessor-list (Supabase offers a way to subscribe to changes on that page).
- **Status**: to sign / to confirm. Daily backups need the Pro plan (`docs/deployment.md`).

## Vercel

- **Receives**: every request between the browser and the app, and every page it renders. That covers report content in pages, form posts, session cookies (the middleware refreshes them), files that a function downloads from Supabase to parse, exports built in a function, and the prompts and drafts of AI calls, which go through a function. Uploads and downloads of files themselves go straight between the browser and Supabase through signed links. Function logs (what the app prints).
- **Region**: functions run in `cdg1` (Paris), set in `vercel.json`. Requests first reach Vercel's edge network, which is global. What that means for transfers outside the EU is **to confirm** in Vercel's DPA.
- **DPA**: https://vercel.com/legal/dpa. That page says it applies to Pro and Enterprise customers, so a Hobby plan has none.
- **Status**: to sign / to confirm, and check the plan.

## E-mail provider: Resend or Brevo

The code supports both (`src/lib/email/send.ts`), and `docs/deployment.md` names both for the Supabase Auth SMTP sender. Production should use one. Remove the other from this page once chosen.

- **Receives**: the recipient's e-mail, the subject and the body. Bodies hold names (inviter, person who changed a report's status), workspace and organization names, report titles, and links, including invitation links with their token and Auth links for confirmation and password reset (activity 5 in [`record-of-processing.md`](record-of-processing.md)).
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

- **Receives**: per draft, the system prompt and the filled template: section title and instructions, report title and description, workspace name, and the extracted text and file names of the section's parsed files (Word, Excel, CSV, text, Markdown), after masking when `AI_REDACT_PII=true`. Summary calls get parts of the same masked text. No user id, e-mail or requester name. Full list and what the masking covers: activity 4 in [`record-of-processing.md`](record-of-processing.md).
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

## Not subprocessors of customer data

- **GitHub**: holds the code and runs CI. CI uses the local seed accounts and the synthetic eval cases, never customer data.
- **Mailpit**: local and e2e only.
- **Sentry**: planned in KRB-6.3.1, not wired. Add it here when it is.

## When this list changes

Add the service here and in the record before it receives data, and tell the firms. How much notice they get, and whether they can object, is for the customer DPA to set (**to confirm**).
