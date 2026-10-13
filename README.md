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

Requirements: Node.js 20.11 or later, and Docker if you want a local Supabase stack.

```bash
npm install
cp .env.example .env.local     # then fill in the values
npx supabase start             # local Postgres, Auth, Storage on :54321
npx supabase db reset          # applies supabase/migrations
npm run dev                    # http://localhost:3000, redirects to /fr
```

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
| `npm run db:types` | Generate `src/lib/supabase/database.types.ts` |
| `npm run test:e2e` | Playwright end-to-end tests (needs a build and the local Supabase stack) |

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

French is the only locale. Every page lives under `/fr`, and `/` redirects there. Unauthenticated visitors are redirected to `/fr/connexion?redirectTo=...`. Public routes are listed in `src/middleware.ts`. To add a locale later, extend `routing.locales` in `src/i18n/routing.ts` and add `messages/<locale>.json`.

## Authentication

Routes: `/fr/connexion`, `/fr/inscription`, `/fr/mot-de-passe-oublie`, `/fr/reinitialiser-mot-de-passe`, and `/fr/auth/callback` for e-mail links.

- E-mail templates are in French in `supabase/templates/`. Their links carry a `token_hash`, so they work even when the e-mail is opened on another device.
- Auth settings (site URL, redirect allowlist, 8-character minimum password, confirmations, rate limits) live in `supabase/config.toml`. To apply them and the templates to a hosted project, run `npx supabase link` then `npx supabase config push`, and check the result in the dashboard.
- Local e-mails land in Mailpit at http://127.0.0.1:54324.
- The service worker never caches auth pages or Supabase requests, and signing out clears the pages kept for offline reading.

## End-to-end tests

```bash
npx supabase start
npm run build
npm run test:e2e
```

The suite signs up a new user, confirms the e-mail through Mailpit, signs in and out, and resets the password.

## Data model and security

Tables: `organizations`, `profiles`, `workspaces`, `workspace_members`, `reports`, `report_sections`, `deliverables`, `prompt_library`, plus the `report_progress` view.

- Every tenant row carries `workspace_id`, and RLS is enabled on every table.
- Roles per workspace: `owner`, `admin`, `expert`, `viewer`.
- Owners and admins manage reports, sections and members. Experts read their workspace and write only to sections assigned to them. A trigger blocks experts from reassigning, moving or re-weighting sections.
- Authorization helpers live in the `private` schema (not exposed by the API) as `SECURITY DEFINER` functions with an empty `search_path`.
- Deliverables are stored in the private `deliverables` bucket under `{workspace_id}/{section_id}/{uuid}-{filename}`, with a 50 MB limit and a MIME allow-list.
- `report_progress` computes weighted completion (completed = 1, in progress = 0.5, not started = 0) and runs with the caller's permissions. `report_sections` is published to Supabase Realtime for the live dashboard.

Serverless code must connect through the Supavisor pooler in transaction mode (port 6543, `DATABASE_URL`). Use the direct connection (port 5432, `DIRECT_URL`) only for migrations and admin tools.

## Backlog

`docs/jira/BACKLOG.md` holds the epics, stories, acceptance criteria and sprint plan. `docs/jira/kolabreport-jira-import.csv` is the same backlog in Jira CSV import format. The issues are tracked in the Jira project KRB.
