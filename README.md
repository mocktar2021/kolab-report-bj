# KolabReport

KolabReport is a French-language progressive web app for writing expert reports as a team. A coordinator splits a report into sections, assigns each section to an expert, experts upload their deliverables (.docx, .xlsx, images, diagrams), an AI engine drafts each section from those deliverables, and the coordinator assembles the final master report while tracking completion section by section.

## Stack

- Next.js 15 (App Router, TypeScript, Server Actions)
- Tailwind CSS 3 and shadcn/ui primitives (Radix UI)
- Supabase: Postgres with row-level security, Auth, Storage, Realtime
- Vercel AI SDK with Anthropic or OpenAI as the model provider
- next-intl for French routing and messages (`/fr/...`)
- @ducanh2912/next-pwa (maintained fork of `next-pwa`) for the service worker

## Getting started

Requirements: Node.js 20.11 or later, Docker for the local Supabase stack, and Python 3 for the commit message check (optional).

```bash
npm install                    # also installs the git hooks
npx supabase start             # Postgres, Auth, Storage and Mailpit, applies supabase/migrations
cp .env.example .env.local
```

Fill `.env.local` with the values printed by `npx supabase status`:

| Variable | Local value |
| --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `API_URL` (http://127.0.0.1:54321) |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | `ANON_KEY` |
| `SUPABASE_SERVICE_ROLE_KEY` | `SERVICE_ROLE_KEY`, only for server scripts |
| `NEXT_PUBLIC_APP_URL` | http://localhost:3000 (must match `site_url` in `supabase/config.toml`) |

Then run `npm run dev` and open http://localhost:3000. Sign-up e-mails arrive in Mailpit at http://127.0.0.1:54324. `npx supabase db reset` rebuilds the database from the migrations.

The service worker is disabled in development. To test offline behaviour, run `npm run build && npm start`, or set `NEXT_PUBLIC_PWA_ENABLE_IN_DEV=true`. `docs/pwa.md` explains how updates reach open tabs and how to test them.

## Demo data

`supabase/seed.sql` adds a demo workspace after the migrations, on `npx supabase start` with a new database and on every `npx supabase db reset`. It stays local: `supabase db push` only runs it with `--include-seed`, which `npm run db:push` and the deploy workflow never pass, so staging and production never get these accounts.

All demo accounts use the password `Kolab-demo-2026`:

| E-mail | Name | Role |
| --- | --- | --- |
| `awa.dossou@kolabreport.test` | Awa Dossou | owner |
| `koffi.agossou@kolabreport.test` | Koffi Agossou | admin |
| `rachida.yessoufou@kolabreport.test` | Rachida Yessoufou | expert |
| `sylvain.kouagou@kolabreport.test` | Sylvain Kouagou | expert |
| `prudence.ahouansou@kolabreport.test` | Prudence Ahouansou | viewer |

They share the workspace "Eau potable Atacora" (organization Cabinet Sèdo Conseil) and its draft report "Rapport d'évaluation à mi-parcours": 8 sections in French, 2 completed, 2 in progress and 4 not started, 2 of them unassigned. There are no deliverables and no AI drafts.

To add the demo data to a database you already use, without a reset, run the file with psql. It skips the rows that already exist, so running it again changes nothing:

```bash
docker exec -i supabase_db_kolab-report-bj psql -U postgres -v ON_ERROR_STOP=1 < supabase/seed.sql
```

The seeded rows have fixed ids starting with `5eed0000`. The pgTAP and Playwright suites create their own data and do not depend on them.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Development server |
| `npm run build` | Production build (also generates `public/sw.js`) |
| `npm run lint` | ESLint |
| `npm run typecheck` | TypeScript without emitting |
| `npm run db:reset` | Recreate the local database from migrations |
| `npm run db:push` | Apply migrations to the linked Supabase project |
| `npm run db:types` | Generate `src/lib/supabase/database.types.ts` (commit it with every migration) |
| `npm test` | Vitest unit tests |
| `npm run test:db` | pgTAP RLS tests (needs the local Supabase stack) |
| `npm run test:e2e` | Playwright end-to-end tests (needs a build and the local Supabase stack) |
| `npm run format` | Format with Prettier (`format:check` to only check) |

## Project layout

```
messages/fr.json                 French UI strings
public/manifest.webmanifest      PWA manifest
public/icons/                    App icons (192, 512, maskable, Apple touch)
src/middleware.ts                Locale routing, session refresh, auth guard
src/i18n/                        next-intl routing and request config
src/lib/supabase/                Browser, server, middleware and service-role clients
src/app/[locale]/                Localized routes (connexion, tableau-de-bord, hors-ligne)
supabase/migrations/             Schema, RLS policies, storage bucket
docs/jira/                       Product backlog and Jira import file
```

## Routing and localization

French is the only locale. Every page lives under `/fr`, and `/` redirects there. Unauthenticated visitors are redirected to `/fr/connexion?next=...`. Public routes are listed in `src/middleware.ts`. Signed-in pages live in the `src/app/[locale]/(app)` route group, which adds the app shell:

| Route | Page |
| --- | --- |
| `/fr/tableau-de-bord` | Dashboard of the current workspace, or the "create your first workspace" screen. Owners and admins get "Nouveau rapport", a dialog that asks for the title and opens the new report |
| `/fr/espaces/nouveau` | Wizard: organization, workspace, first report. The first step lists the organizations the user can add a workspace to, with the one of the current workspace checked, plus "Nouvelle organisation". Someone who manages none types the name of a new one |
| `/fr/espaces/{id}/membres` | Members, roles and invitations (owners and admins) |
| `/fr/invitations/{token}` | Invitation link from the e-mail (works signed out) |
| `/fr/rapports/{id}` | Report sections, with assignment and weights for owners and admins |
| `/fr/espaces/{id}/sections/{id}` | One section: its status, its deliverables with what the app read from them, and for the people who can edit it the upload zone, delete and "Relancer l'analyse" |
| `/fr/espaces/{id}/modeles` | Prompt library: the workspace's templates, then the global ones (read-only), with "Nouveau modèle" for owners and admins |
| `/fr/espaces/{id}/modeles/{id}` | One version of a template: settings, text, history and the diff with the version before. Owners and admins publish, archive, add a version, or customize a global template |
| `/fr/espaces/{id}/modeles/nouveau` | Editor for a new template (owners and admins). `?depuis={id}` starts from an existing version, global or not |
| `/fr/espaces/{id}/modeles/{id}/modifier` | Editor for the next version of a workspace template (owners and admins) |

Route handlers under `src/app/api` (not localized, skipped by the middleware, so each one checks the session itself):

| Route | Purpose |
| --- | --- |
| `POST /api/deliverables/upload-url` | Registers a file for a section and returns a signed upload URL |
| `POST /api/deliverables/{id}/complete` | Checks the stored file, then keeps it or deletes it |
| `GET /api/deliverables/{id}/file` | Redirects members to a 60-second signed URL (`?apercu` shows images inline) |
| `POST /api/ai/sections/{id}/draft` | Streams an AI draft of a section from a published template, as NDJSON events (assigned expert or manager) |

The workspace picked in the sidebar switcher is kept in the `kr-espace` cookie. The server checks the membership each time it reads it. To add a locale later, extend `routing.locales` in `src/i18n/routing.ts` and add `messages/<locale>.json`.

## Authentication

Routes: `/fr/connexion`, `/fr/inscription`, `/fr/mot-de-passe-oublie`, `/fr/reinitialiser-mot-de-passe`, and `/fr/auth/callback` for e-mail links.

- E-mail templates are in French in `supabase/templates/`. Their links carry a `token_hash`, so they work even when the e-mail is opened on another device.
- Auth settings (site URL, redirect allowlist, 8-character minimum password, confirmations, rate limits) live in `supabase/config.toml`. To apply them and the templates to a hosted project, run `npx supabase link` then `npx supabase config push`, and check the result in the dashboard.
- Local e-mails land in Mailpit at http://127.0.0.1:54324.
- The service worker never caches auth pages or Supabase requests, and signing out clears the pages kept for offline reading.

## Tests

| Layer | Where | Command |
| --- | --- | --- |
| Unit | `src/**/*.test.ts(x)` | `npm test` |
| Database (RLS) | `supabase/tests/*_test.sql`, fixture in `fixtures.psql` | `npm run test:db` |
| End-to-end | `tests/e2e/` | `npm run build && npm run test:e2e` |

- The RLS suite checks every table for the owner, admin, expert and viewer roles, a member of another tenant, a user without workspace and signed-out visitors. Add a test file with every new table.
- The end-to-end suite signs up a new user, confirms the e-mail through Mailpit, signs in and out, and resets the password. It also creates a workspace with the wizard, adds a second one to the same organization, creates a report from the dashboard, and checks the roles: assignment by the owner, admins kept away from owners, read-only experts and viewers.
- Invitation e-mails go through `EMAIL_PROVIDER` (`brevo`, `resend`, or `mailpit` for the local stack, see `.env.example`). Without one, the members page shows the link to send by hand. The e2e suite reads them from Mailpit.
- The workspace tests create users with the service-role key, so `.env.local` needs `SUPABASE_SERVICE_ROLE_KEY` (from `npx supabase status`). `playwright.config.ts` loads `.env.local`.
- Playwright also starts a FedaPay mock (`tests/fedapay-mock/server.mjs`) on `127.0.0.1:4010`, so port 4010 must be free. With the `FEDAPAY_*` mock values of `.env.example` in `.env.local`, payments never reach FedaPay.

## Git hooks

`npm install` sets up husky:

- **pre-commit** formats and lints staged files with lint-staged.
- **commit-msg** runs the `write-like-mocktar` checker on the message (skipped when Python 3 is missing).

## Continuous integration

GitHub Actions runs on every PR and every push to `master`:

- **Lint, typecheck, unit tests, build**: Prettier, ESLint, TypeScript, Vitest, `npm audit` and `next build`.
- **Database and end-to-end tests**: starts Supabase, runs `db reset` and the pgTAP suite, fails if `database.types.ts` is out of date, then runs Playwright.
- **CodeQL**: security queries on the TypeScript code.
- **Evals on PR**: on PRs that change a prompt template, an output schema, the context builder or a model id, runs a subset of the AI golden set, comments the comparison with production and fails on a regression. The full set runs every night. See `docs/ai-evaluation.md`.

Dependabot opens update PRs every Monday. `docs/ci.md` has the details and the branch protection setup.

## Deployment

Staging and production each have their own Supabase project and Vercel settings. After CI passes on `master`, `.github/workflows/deploy.yml` applies the migrations to staging, then deploys staging. A `v*` tag does the same for production. Every PR also gets a Vercel preview on the staging database. `docs/deployment.md` has the one-time setup, the secrets map, the release steps, the migration rules and the rollback runbook.

Every page sends a Content-Security-Policy, HSTS and the usual security headers (`next.config.mjs`).

## Data model and security

Tables: `organizations`, `profiles`, `workspaces`, `workspace_members`, `reports`, `report_sections`, `deliverables`, `prompt_library`, `ai_generations`, plus the `report_progress`, `prompt_templates` and `ai_generation_metrics` views.

- Every tenant row carries `workspace_id`, and RLS is enabled on every table.
- Roles per workspace: `owner`, `admin`, `expert`, `viewer`.
- Owners and admins manage reports, sections and members. Experts read their workspace and write only to sections assigned to them. A trigger blocks experts from reassigning, moving or re-weighting sections.
- `create_workspace_with_owner()` creates the organization, the workspace and the first report in one transaction, with the caller as owner. `create_workspace_in_organization()` does the same inside an existing organization, for its owner and for the owners and admins of its workspaces, the rule of the insert policy on `workspaces`. `my_manageable_organizations()` lists those organizations for the wizard. Only signed-in users can call them.
- A workspace always keeps at least one owner (error `KR001`). Admins manage admins, experts and viewers, never owners, and only the `role` column of a membership can change.
- A section can only be assigned to an owner, admin or expert of its workspace (error `KR002`). It goes back to "unassigned" when that person leaves or becomes a viewer.
- Server actions check the role again with `requireWorkspaceRole()` in `src/lib/workspaces/server.ts` before writing, on top of RLS.
- Invitations (`workspace_invitations`) store only the SHA-256 of the link token, last 7 days and work once. Admins cannot invite owners. Invitees join from the link, or when they sign in with that address confirmed, so someone invited before having an account joins on first login. Errors `KR003` to `KR007` cover invalid, used, expired, wrong-account and already-member cases.
- Billing limits (ADR 001, `docs/adr/001-billing-and-fedapay.md`): the organization's plan caps its members (distinct people with a role other than viewer, open invitations included), its active reports, its AI drafts and its custom prompt templates. Triggers and `start_ai_generation()` check them under one lock per organization, and a read-only workspace is refused first. Errors `KR040` (member limit), `KR041` (member limit when accepting), `KR042` (report limit), `KR043` (read-only) and `KR044` (no custom templates); the draft route answers 402 when the AI drafts are used up and 403 for read-only or a custom template. AI drafts are counted in `billing_draft_usage` when they succeed, per organization, and stay counted when the workspace is deleted. Nothing is checked while `private.billing_settings.enforced` is false, which it is on staging and production until the launch (KRB-179). The seed turns it on for local and CI runs.
- Authorization helpers live in the `private` schema (not exposed by the API) as `SECURITY DEFINER` functions with an empty `search_path`.
- Deliverables are stored in the private `deliverables` bucket under `{workspace_id}/{section_id}/{uuid}-{filename}`, with a 50 MB limit (5 MB for SVG) and a MIME allow-list kept in sync with `src/lib/deliverables/file-types.ts`. Files go from the browser straight to storage, never through the app server:
  1. `upload-url` checks the role, the type and the size, adds a `deliverables` row with `uploaded_at` empty, and signs an upload URL for that exact path.
  2. The browser sends the file to that URL.
  3. `complete` reads the stored object and compares its size, its type and its first bytes with the extension. SVG files (5 MB at most, measured on the stored object) are read whole and refused when they contain scripts, event handlers, script URLs, frames, a style sheet instruction or a DTD beyond plain entities, whatever the namespace prefix. A file that passes gets `uploaded_at` (written by the service role only). Otherwise the object and its row are deleted.
- Once a file is kept, the app reads it with the service role after answering the request (`next/server` `after()`, see `src/lib/deliverables/parse-job.ts`). Word (mammoth), Excel (exceljs), CSV and text files become Markdown in `parsed_content`, which the AI draft will use. `parse_meta` holds the kind, the sheets and rows kept, a word count and a token estimate. Other formats are kept but marked `skipped` ("Non analysé"). Text and Markdown files are kept as written and previewed as plain text.
- The parsers run in a child process with a 512 MB heap and no environment, so no server key, killed after 45 seconds (download included). A file that needs more memory or time fails on its own and leaves the server alone. `npm run build` and `npm run dev` first bundle the parsers into `build/parse-worker.cjs` (`npm run build:worker`), which `next.config.mjs` ships with the routes that start a read. Run it again after changing a parser while `next dev` is running.
- Other safeguards: a .docx or .xlsx is unpacked and measured before it is opened (100 MB in all, 20 MB of XML, 5000 files; the sizes an archive declares are not trusted), 20 sheets of 200 rows and 30 columns, 200,000 characters of Markdown. Text read from a file is escaped so it can't turn into headings, lists, links or HTML. A read still running after 5 minutes, or a file that was never read, can be retried.
- Users cannot write `uploaded_at` or the parse results, or rename a file once registered. In storage they can only create the object of a pending row of their own, never replace or delete one, and read only checked files of their workspaces. The app deletes objects with the service role once their row is gone. So the file the server checked is the one that stays, and an unchecked file cannot be shared. Only the uploader, while the section is still theirs, or a manager deletes a file.
- AI drafts (`src/lib/ai`, `POST /api/ai/sections/{id}/draft`): the assigned expert or a manager picks a published template, and the route builds the context from the section and its parsed deliverables, then streams an object checked against the template's output schema (`src/lib/ai/schemas.ts`). A draft that fails the schema gets one repair call, then fails without touching the section. Deliverables go to the model inside `<livrable>` blocks that their text can't close, under a system prompt that treats them as data, and e-mails, phone numbers, IBAN, social security and card numbers are masked first (`AI_REDACT_PII`). When they don't fit the prompt budget, tables keep their first rows, each file is capped, the budget is shared evenly in upload order, and the overflow is summarized by the fast model; the page says what was cut. Model output is shown as Markdown without HTML or images, and its links as text with their address.
- Each request is a row of `ai_generations`, written with the service role: prompt version, model, parameters, input hashes, truncation log, token usage, latency, cost estimate (when `AI_PRICE_*` is set) and the raw answer. `start_ai_generation()` applies the hourly limit per user (`AI_RATE_LIMIT_PER_HOUR`) and the monthly token budget per workspace (`AI_MONTHLY_TOKEN_BUDGET`) under a lock and before any model call, so the route answers 429 with `Retry-After`; one draft runs per section at a time. A stopped or failed call still counts, with an estimate when the provider didn't report its usage, and generations outlive their section so deleting one doesn't reset the counts. A draft is a proposal: `accept_ai_generation()` puts it, edited or not, in `report_sections.content` (and moves a section not started to in progress), `discard_ai_generation()` drops it, and both check that the caller can edit the section and that the section didn't change since the page loaded. The person who asked rates it (thumbs and a comment). `ai_generation_metrics` sums outcomes, ratings and edit distance per prompt version and model.
- Section text (KRB-18, KRB-197): the text is stored as Markdown in `report_sections.content` and saved with `save_section_content()`, which refuses a save over a newer version and returns the saved text to compare. The editor opens in a "Texte" tab, a Tiptap editor that only offers what the Markdown view draws (headings, bold, italic, strikethrough, lists, links, tables, quotes, code), next to a "Markdown" tab on the same text. `src/lib/rich-text/markdown.ts` reads the Markdown with the remark parser of the view and the exports, and writes the blocks the person didn't change back byte for byte. Pasted HTML goes through `src/lib/rich-text/paste.ts` first: no scripts, styles, images or media, links to http, https and mailto only, Word lists and tables turned into Markdown lists and tables. The last tab used is kept per device in localStorage (`kolabreport:section-editor-mode`).
- Drafts stay off until `AI_DRAFTS_ENABLED=true`, which an environment gets only once the eval suite (`evals/`) passes on its model. `AI_PROVIDER=mock` answers fixed text without a key for local work and the end-to-end tests, and is refused in production.
- `report_progress` computes weighted completion (completed = 1, in progress = 0.5, not started = 0) and runs with the caller's permissions. `report_sections` is published to Supabase Realtime for the live dashboard.

Serverless code must connect through the Supavisor pooler in transaction mode (port 6543, `DATABASE_URL`). Use the direct connection (port 5432, `DIRECT_URL`) only for migrations and admin tools.

## Backlog

`docs/jira/BACKLOG.md` holds the epics, stories, acceptance criteria and sprint plan. `docs/jira/kolabreport-jira-import.csv` is the same backlog in Jira CSV import format. The issues are tracked in the Jira project KRB.
