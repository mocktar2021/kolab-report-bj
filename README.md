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

The service worker is disabled in development. To test offline behaviour, run `npm run build && npm start`, or set `NEXT_PUBLIC_PWA_ENABLE_IN_DEV=true`.

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
| `/fr/tableau-de-bord` | Dashboard of the current workspace, or the "create your first workspace" screen |
| `/fr/espaces/nouveau` | Wizard: organization, workspace, first report |
| `/fr/espaces/{id}/membres` | Members and roles (owners and admins) |
| `/fr/rapports/{id}` | Report sections, with assignment and weights for owners and admins |

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
- The end-to-end suite signs up a new user, confirms the e-mail through Mailpit, signs in and out, and resets the password. It also creates a workspace with the wizard and checks the roles: assignment by the owner, admins kept away from owners, read-only experts and viewers.
- The workspace tests create users with the service-role key, so `.env.local` needs `SUPABASE_SERVICE_ROLE_KEY` (from `npx supabase status`). `playwright.config.ts` loads `.env.local`.

## Git hooks

`npm install` sets up husky:

- **pre-commit** formats and lints staged files with lint-staged.
- **commit-msg** runs the `write-like-mocktar` checker on the message (skipped when Python 3 is missing).

## Continuous integration

GitHub Actions runs on every PR and every push to `master`:

- **Lint, typecheck, unit tests, build**: Prettier, ESLint, TypeScript, Vitest, `npm audit` and `next build`.
- **Database and end-to-end tests**: starts Supabase, runs `db reset` and the pgTAP suite, fails if `database.types.ts` is out of date, then runs Playwright.
- **CodeQL**: security queries on the TypeScript code.

Dependabot opens update PRs every Monday. `docs/ci.md` has the details and the branch protection setup.

## Deployment

Staging and production each have their own Supabase project and Vercel settings. After CI passes on `master`, `.github/workflows/deploy.yml` applies the migrations to staging, then deploys staging. A `v*` tag does the same for production. Every PR also gets a Vercel preview on the staging database. `docs/deployment.md` has the one-time setup, the secrets map, the release steps, the migration rules and the rollback runbook.

Every page sends a Content-Security-Policy, HSTS and the usual security headers (`next.config.mjs`).

## Data model and security

Tables: `organizations`, `profiles`, `workspaces`, `workspace_members`, `reports`, `report_sections`, `deliverables`, `prompt_library`, plus the `report_progress` view.

- Every tenant row carries `workspace_id`, and RLS is enabled on every table.
- Roles per workspace: `owner`, `admin`, `expert`, `viewer`.
- Owners and admins manage reports, sections and members. Experts read their workspace and write only to sections assigned to them. A trigger blocks experts from reassigning, moving or re-weighting sections.
- `create_workspace_with_owner()` creates the organization, the workspace and the first report in one transaction, with the caller as owner. It is the only function in `public` that the API exposes, and only to signed-in users.
- A workspace always keeps at least one owner (error `KR001`). Admins manage admins, experts and viewers, never owners, and only the `role` column of a membership can change.
- A section can only be assigned to an owner, admin or expert of its workspace (error `KR002`). It goes back to "unassigned" when that person leaves or becomes a viewer.
- Server actions check the role again with `requireWorkspaceRole()` in `src/lib/workspaces/server.ts` before writing, on top of RLS.
- Authorization helpers live in the `private` schema (not exposed by the API) as `SECURITY DEFINER` functions with an empty `search_path`.
- Deliverables are stored in the private `deliverables` bucket under `{workspace_id}/{section_id}/{uuid}-{filename}`, with a 50 MB limit and a MIME allow-list.
- `report_progress` computes weighted completion (completed = 1, in progress = 0.5, not started = 0) and runs with the caller's permissions. `report_sections` is published to Supabase Realtime for the live dashboard.

Serverless code must connect through the Supavisor pooler in transaction mode (port 6543, `DATABASE_URL`). Use the direct connection (port 5432, `DIRECT_URL`) only for migrations and admin tools.

## Backlog

`docs/jira/BACKLOG.md` holds the epics, stories, acceptance criteria and sprint plan. `docs/jira/kolabreport-jira-import.csv` is the same backlog in Jira CSV import format. The issues are tracked in the Jira project KRB.
