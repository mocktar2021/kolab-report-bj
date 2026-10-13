# KolabReport Jira Backlog (zero to production)

KolabReport is a French-language PWA (Next.js 15 App Router, Supabase, Vercel AI SDK) where workspace owners split a report into sections, assign them to experts, collect expert deliverables (.docx, .xlsx, images, diagrams), generate AI-assisted section drafts from versioned prompt templates, and assemble a master report with real-time progress tracking.

**Totals:** 6 epics · 20 stories · 131 sub-tasks · **116 story points**. 22 sub-tasks are marked *(scaffolded in initial commit, verify)*.

Conventions: summaries and descriptions are in English; French UI strings and routes are quoted as-is. Issue IDs (`KRB-EPIC-n`, `KRB-n.m`, `KRB-n.m.k`) are import keys only; Jira assigns real keys on import.

## Table of contents

- [How to import into Jira](#how-to-import-into-jira)
- [Sprint plan](#sprint-plan)
- [Roles & RBAC matrix](#roles--rbac-matrix)
- [EPIC 1: Project Foundation & PWA Infrastructure](#epic-1-project-foundation--pwa-infrastructure)
- [EPIC 2: Authentication & Workspace RBAC](#epic-2-authentication--workspace-rbac)
- [EPIC 3: Expert Deliverables & File Ingestion Pipeline](#epic-3-expert-deliverables--file-ingestion-pipeline)
- [EPIC 4: AI Prompt Library & Synthesis Engine](#epic-4-ai-prompt-library--synthesis-engine)
- [EPIC 5: Master Report Synthesis & Progress Tracking](#epic-5-master-report-synthesis--progress-tracking)
- [EPIC 6: CI/CD, Observability & Production Deployment](#epic-6-cicd-observability--production-deployment)

## How to import into Jira

1. File: `docs/jira/kolabreport-jira-import.csv` (UTF-8, comma-separated, RFC 4180 quoting, one header row).
2. Jira Cloud: **Settings (⚙) > System > External System Import > CSV** (for a single project you can also use *Project > ⋯ > Import issues*). Select the file, keep delimiter `,` and encoding `UTF-8`, and choose the target project (suggested key: `KRB`).
3. Map the columns:

| CSV column | Jira field | Notes |
|---|---|---|
| Issue ID | Issue ID | Import-only key used to link parents; not kept as the Jira key. |
| Issue Type | Issue Type | Values: `Epic`, `Story`, `Sub-task` (map to `Subtask` if your project names it that way). |
| Summary | Summary | |
| Description | Description | Plain text; acceptance criteria inline as GIVEN/WHEN/THEN. |
| Parent | Parent | Refers to an Issue ID in the same file: Story → Epic, Sub-task → Story. |
| Priority | Priority | `Highest`, `High`, `Medium`. |
| Story Points | Story Points (or *Story point estimate* in team-managed projects) | Stories only. |
| Labels | Labels | Space-separated; Jira splits on spaces into separate labels. |
| Epic Name | Epic Name | Epics only. Leave unmapped if your Jira no longer has this field. |

4. Epics, stories and sub-tasks must be in the same import file (they are) so that `Parent` resolves. On older Jira Server/Data Center, if Parent does not link stories to epics, map `Parent` for stories to **Epic Link** by re-importing stories with an `Epic Link` column set to the epic's *Epic Name*.
5. After import: create the sprints below, drag stories into them, and turn the sub-task checklists here into the Definition of Ready for refinement.

## Sprint plan

Two-week sprints, assuming a team of ~2 full-stack developers (velocity ≈ 18–22 points). Sub-tasks are not estimated; story points sit on stories.

| Sprint | Weeks | Goal | Stories | Points |
|---|---|---|---|---|
| Sprint 1 | 1–2 | Foundation, schema, CI | 1.1 Next.js & PWA Initialization, 1.2 Supabase Client & Database Schema Migration, 1.3 Developer Tooling & Test Harness, 6.1 CI Pipeline (GitHub Actions) | 19 |
| Sprint 2 | 3–4 | Auth, RBAC, environments | 2.1 Supabase Auth Flow (French UI), 2.2 Workspace Management & RBAC, 6.2 Environments, Secrets & Migration Promotion | 18 |
| Sprint 3 | 5–6 | Invitations, uploads, parsing | 2.3 Member Invitations, 3.1 Multi-format Upload Pipeline, 3.2 Expert Section Workspace | 21 |
| Sprint 4 | 7–8 | Prompt library & AI drafts (with golden-set eval) | 4.1 Prompt Library, 4.2 AI Section Draft Generation | 18 |
| Sprint 5 | 9–10 | AI observability, master report, dashboard | 4.3 LLM Observability, Prompt Versioning & Evaluation Pipeline, 5.1 Collaborative Master Document Builder, 5.2 Real-Time Completion Dashboard | 21 |
| Sprint 6 | 11–12 | Hardening & go-live | 5.3 Report Review & Finalization Workflow, 6.3 Observability, Error Monitoring & Backups, 6.4 Security Review & RLS Audit, 6.5 Lighthouse PWA, Performance & Accessibility Audit, 6.6 Go-Live Checklist & Launch | 19 |
| Hypercare | 13–14 | Post-launch monitoring, bug fixes, eval baseline refresh | None (buffer) | 0 |
| **Total** | | | | **116** |

Milestones: end of Sprint 2 = staging environment with auth and RBAC; end of Sprint 4 = AI drafts behind a feature flag with golden-set baseline; end of Sprint 6 = production go-live.

## Roles & RBAC matrix

Roles come from the `workspace_role` enum and are per workspace (a user can be `expert` in one workspace and `owner` in another). RLS is the source of truth; server actions and UI mirror it.

| Capability | owner | admin | expert | viewer |
|---|---|---|---|---|
| View workspace, reports, all sections | Yes | Yes | Yes (member workspaces only) | Yes (member workspaces only) |
| Create workspace (becomes owner) | Yes | Yes | Yes | Yes |
| Edit workspace settings | Yes | Yes | No | No |
| Delete workspace / transfer ownership | Yes | No | No | No |
| Invite members / change roles | Yes (any role) | Yes (not owner) | No | No |
| Create / reorder / delete sections, assign experts, set weights | Yes | Yes | No | No |
| Edit section content & status | All sections | All sections | Only where assigned_to = self | No |
| Upload / delete deliverables | All sections | All sections | Only assigned sections | No |
| Download / preview deliverables | Yes | Yes | Yes | Yes |
| Generate AI draft | Yes | Yes | Only assigned sections | No |
| Read prompt library (global + workspace) | Yes | Yes | Yes | Yes |
| Create / publish workspace prompt templates | Yes | Yes | No | No |
| Change report status (draft → in_review → final) | Yes (incl. reopen) | Yes (except reopen final) | No | No |
| Export master report (.docx / PDF) | Yes | Yes | Yes | Yes |
| View AI metrics dashboard | Yes | Yes | No | No |

Non-members of a workspace have no access to any of its rows or storage objects (`{workspace_id}/...`).

Reference values: `section_status` = not_started | in_progress | completed; `report_status` = draft | in_review | final; `parse_status` = pending | processing | parsed | failed. Completion % (view `report_progress`) = Σ(weight × s) / Σ weight with s = 1 / 0.5 / 0.

---

## EPIC 1: Project Foundation & PWA Infrastructure

**Issue ID:** `KRB-EPIC-1` · **Priority:** Highest · **Points:** 16 · **Labels:** `foundation pwa`

**Goal.** Stand up a production-grade Next.js 15 (App Router, TypeScript, Tailwind) PWA with French as the default locale and a Supabase Postgres schema secured by Row Level Security, so every later epic builds on a stable, multi-tenant base.

**Scope**

- Next.js 15 App Router + TypeScript strict + Tailwind + shadcn/ui primitives
- PWA: manifest.webmanifest, service worker (@ducanh2912/next-pwa), offline fallback route /fr/hors-ligne
- i18n with next-intl, `fr` default locale, French metadata and `<html lang="fr">`
- SQL migrations for the core domain tables, enums, RLS policies, storage bucket, report_progress view
- Supabase clients (browser, server, middleware, service role) using @supabase/ssr; pooled connections via Supavisor transaction mode (port 6543)
- Local dev tooling: Supabase CLI, generated DB types, test harness (unit, RLS, e2e)

**Definition of Done**

- [ ] `npm run lint`, `npm run typecheck` and `npm run build` pass on a clean clone
- [ ] `supabase db reset` applies all migrations from scratch without error
- [ ] RLS is enabled on every public table and covered by automated policy tests
- [ ] App installs as a PWA on Android/Chrome and iOS Safari and shows /fr/hors-ligne when offline
- [ ] README documents local setup end to end

### Story 1.1: Next.js & PWA Initialization

**Issue ID:** `KRB-1.1` · **Parent:** `KRB-EPIC-1` · **Priority:** Highest · **Story points:** 5 · **Dependencies:** None (first story). · **Labels:** `foundation pwa i18n frontend`

> As a developer on the KolabReport team, I want a Next.js 15 App Router project with TypeScript, Tailwind, an installable PWA shell and French as the default locale, so that every feature is built on a consistent, offline-capable, French-first foundation.

**Acceptance criteria**

1. **Given** a fresh clone with `.env.local` populated from `.env.example`, **when** I run `npm install && npm run dev`, **then** the app serves on http://localhost:3000 and `/` redirects to `/fr/...` (French default locale).
2. **Given** the production build, **when** Chrome DevTools > Application is opened, **then** `manifest.webmanifest` is valid (name, short_name, icons 192/512 + maskable, `lang: "fr"`, `start_url: "/fr/tableau-de-bord"`, `display: "standalone"`) and a service worker is registered.
3. **Given** the app has been visited once and the network goes offline, **when** the user navigates to an uncached page, **then** the offline fallback page `/fr/hors-ligne` is shown with French copy.
4. **Given** any page, **when** the HTML is inspected, **then** `<html lang="fr">` is set, title/description come from French metadata (messages/fr.json) and no hard-coded English UI strings exist.
5. **Given** an authenticated API route or Supabase request, **when** the service worker handles it, **then** it is NOT cached (NetworkOnly) so no private data is persisted in the SW cache.

**Sub-tasks**

- [ ] `KRB-1.1.1` Initialize Next.js 15 App Router + TypeScript strict mode + ESLint config (scaffolded in initial commit, verify): create-next-app equivalent setup, `tsconfig` strict, path alias `@/*`.
- [ ] `KRB-1.1.2` Configure Tailwind CSS + shadcn/ui (components.json) and base design tokens (scaffolded in initial commit, verify): Tailwind config, tailwindcss-animate, `cn()` helper, base Button/Input/Label/Toast primitives.
- [ ] `KRB-1.1.3` Set up next-intl with `fr` as default locale and `[locale]` route segment (scaffolded in initial commit, verify): `src/i18n` routing/request config, `messages/fr.json`, locale prefix `/fr`.
- [ ] `KRB-1.1.4` Add manifest.webmanifest and app icons (192, 512, maskable) (scaffolded in initial commit, verify): French name/short_name/description, theme colour, `start_url` `/fr/tableau-de-bord`.
- [ ] `KRB-1.1.5` Configure service worker via @ducanh2912/next-pwa with runtime caching strategy (scaffolded in initial commit, verify): Precache app shell; StaleWhileRevalidate for static assets; NetworkOnly for `/api/*` and Supabase; disabled in dev.
- [ ] `KRB-1.1.6` Create offline fallback page /fr/hors-ligne (scaffolded in initial commit, verify): Static French page used as document fallback by the SW.
- [ ] `KRB-1.1.7` French root layout and metadata (title template, description, viewport/themeColor) (scaffolded in initial commit, verify): `generateMetadata` reading from fr messages; `lang="fr"`.
- [ ] `KRB-1.1.8` Manual PWA install test on Android Chrome and iOS Safari: Document results and screenshots in the PR.

### Story 1.2: Supabase Client & Database Schema Migration

**Issue ID:** `KRB-1.2` · **Parent:** `KRB-EPIC-1` · **Priority:** Highest · **Story points:** 8 · **Dependencies:** 1.1 · **Labels:** `foundation database supabase rls security`

> As a developer, I want versioned SQL migrations that create the KolabReport schema with RLS keyed on workspace membership, plus typed Supabase clients using pooled connections, so that tenant data is isolated by construction and the schema can be promoted reliably across environments.

**Acceptance criteria**

1. **Given** an empty local Supabase instance, **when** `supabase db reset` runs, **then** tables organizations, workspaces, profiles, workspace_members, reports, report_sections, deliverables, prompt_library, the enums (workspace_role, section_status, report_status, parse_status) and the view report_progress are created with no errors.
2. **Given** any table in the `public` schema, **when** `select relname from pg_class where relrowsecurity = false` is run against public tables, **then** no table is returned (RLS enabled everywhere).
3. **Given** user A who is a member of workspace W1 only, **when** A selects from reports, report_sections or deliverables, **then** only rows with workspace_id = W1 are returned.
4. **Given** an expert E assigned to section S1 but not S2 in the same workspace, **when** E updates S1 and then S2, **then** the S1 update succeeds and the S2 update affects 0 rows; an owner/admin can update both.
5. **Given** a new auth.users row, **when** the signup trigger fires, **then** a matching profiles row is created.
6. **Given** the app's server-side DB access outside of supabase-js (e.g. scripts, future ORM), **when** it connects, **then** it uses the Supavisor transaction-mode pooled URL on port 6543 (prepared statements disabled), while migrations use the direct/session connection.

**Sub-tasks**

- [ ] `KRB-1.2.1` Migration: enums workspace_role, section_status, report_status, parse_status (scaffolded in initial commit, verify): owner|admin|expert|viewer; not_started|in_progress|completed; draft|in_review|final; pending|processing|parsed|failed.
- [ ] `KRB-1.2.2` Migration: core tables (organizations, workspaces, profiles, workspace_members, reports, report_sections, deliverables, prompt_library) (scaffolded in initial commit, verify): FKs, `created_at/updated_at` triggers, indexes on every workspace_id and assigned_to; report_sections has assigned_to, status, weight, content.
- [ ] `KRB-1.2.3` Helper SQL functions (SECURITY DEFINER, stable): is_workspace_member(ws), has_workspace_role(ws, roles[]) (scaffolded in initial commit, verify): Avoid recursive RLS on workspace_members; set `search_path = ''`.
- [ ] `KRB-1.2.4` RLS policies on every table keyed on workspace_id (scaffolded in initial commit, verify): Select for members; insert/update/delete per role; experts update only report_sections where assigned_to = auth.uid().
- [ ] `KRB-1.2.5` Trigger handle_new_user to create profiles on signup (scaffolded in initial commit, verify): Copy full_name from raw_user_meta_data.
- [ ] `KRB-1.2.6` View report_progress (weighted completion %) (scaffolded in initial commit, verify): completed = 1, in_progress = 0.5, not_started = 0, weighted by weight; `security_invoker = true` so RLS applies.
- [ ] `KRB-1.2.7` Storage bucket `deliverables` (private, 50 MB) + storage.objects policies on first path segment (scaffolded in initial commit, verify): Path `{workspace_id}/{section_id}/{uuid}-{filename}`; membership checked from the first path segment (`private.storage_workspace_id(name)`).
- [ ] `KRB-1.2.8` Supabase clients: browser, server (cookies), middleware, service-role (server-only) (scaffolded in initial commit, verify): @supabase/ssr; service-role key never imported in client bundles.
- [ ] `KRB-1.2.9` Document and configure pooled connection strings (Supavisor transaction mode :6543 vs direct :5432) (scaffolded in initial commit, verify): `.env.example` entries; note `prepareThreshold=0` / `pgbouncer=true` for ORMs.
- [ ] `KRB-1.2.10` Generate TypeScript DB types (`npm run db:types`) and commit database.types.ts: Wire generics into all Supabase clients.
- [ ] `KRB-1.2.11` Seed script with demo organization, workspace, report and sections (French content): `supabase/seed.sql` for local dev and e2e tests.

### Story 1.3: Developer Tooling & Test Harness

**Issue ID:** `KRB-1.3` · **Parent:** `KRB-EPIC-1` · **Priority:** High · **Story points:** 3 · **Dependencies:** 1.1, 1.2 · **Labels:** `foundation testing dx`

> As a developer, I want a ready-to-use test harness for unit, database (RLS) and end-to-end tests, so that security-critical behaviour (RLS, RBAC) and key user flows are regression-tested from day one.

**Acceptance criteria**

1. **Given** the repository, **when** I run `npm test`, **then** Vitest unit tests run and pass.
2. **Given** a local Supabase instance, **when** I run `supabase test db`, **then** pgTAP tests assert RLS for each role (owner, admin, expert, viewer, non-member).
3. **Given** the dev server and seed data, **when** I run `npm run test:e2e`, **then** a Playwright smoke test loads `/fr/connexion` and passes.

**Sub-tasks**

- [ ] `KRB-1.3.1` Add Vitest + Testing Library config and first unit test
- [ ] `KRB-1.3.2` Add pgTAP RLS test suite under supabase/tests: One file per table; non-member, viewer, expert, admin, owner cases.
- [ ] `KRB-1.3.3` Add Playwright with a French-locale smoke test
- [ ] `KRB-1.3.4` Add Prettier, lint-staged and husky pre-commit hook
- [ ] `KRB-1.3.5` Update README with local setup (Supabase CLI, env vars, scripts)

---

## EPIC 2: Authentication & Workspace RBAC

**Issue ID:** `KRB-EPIC-2` · **Priority:** Highest · **Points:** 18 · **Labels:** `auth rbac`

**Goal.** Let users securely sign up, sign in and recover their account in French, and enforce workspace-scoped role-based access so experts only ever see the workspaces and sections they are assigned to.

**Scope**

- Supabase Auth email/password: /fr/connexion, /fr/inscription, /fr/mot-de-passe-oublie, /fr/reinitialiser-mot-de-passe, /fr/auth/callback
- Next.js middleware session refresh + route guards
- Workspace creation wizard, member invitations, role management
- RBAC enforced in three layers: RLS (source of truth), server actions/route handlers, UI affordances

**Definition of Done**

- [ ] All auth flows work end to end in French with French Supabase email templates
- [ ] Unauthenticated access to any protected route redirects to /fr/connexion
- [ ] RBAC matrix (see top of document) is covered by pgTAP + e2e tests
- [ ] No privilege escalation possible by calling Supabase directly from the browser with the anon key

### Story 2.1: Supabase Auth Flow (French UI)

**Issue ID:** `KRB-2.1` · **Parent:** `KRB-EPIC-2` · **Priority:** Highest · **Story points:** 5 · **Dependencies:** 1.1, 1.2 · **Labels:** `auth frontend i18n security`

> As a consultant or expert, I want to register, log in and recover my password through a French interface, so that I can securely access my reports.

**Acceptance criteria**

1. **Given** an unauthenticated visitor, **when** they open `/fr/tableau-de-bord` or any protected route, **then** middleware redirects them to `/fr/connexion?next=/fr/tableau-de-bord`.
2. **Given** a visitor on `/fr/inscription`, **when** they submit a valid name, email and password (min 8 chars), **then** an account is created, a French confirmation email is sent and the page shows a French confirmation message.
3. **Given** a confirmed user on `/fr/connexion`, **when** they submit correct credentials, **then** a session cookie is set and they land on the `next` URL or `/fr/tableau-de-bord`.
4. **Given** a user on `/fr/connexion`, **when** they submit wrong credentials, **then** a generic French error ("Identifiants invalides") is shown without revealing whether the email exists.
5. **Given** a user on `/fr/mot-de-passe-oublie`, **when** they request a reset, **then** a reset email is sent; the link goes through `/fr/auth/callback` to `/fr/reinitialiser-mot-de-passe`, where a new password can be set.
6. **Given** an authenticated user, **when** they visit `/fr/connexion` or `/fr/inscription`, **then** they are redirected to `/fr/tableau-de-bord`.
7. **Given** an authenticated user, **when** they click "Se déconnecter", **then** the session is revoked server-side and they return to `/fr/connexion`.

**Sub-tasks**

- [ ] `KRB-2.1.1` Middleware: refresh Supabase session + redirect unauthenticated users to /fr/connexion (scaffolded in initial commit, verify): Combine next-intl middleware with @supabase/ssr `updateSession`; public route allowlist.
- [ ] `KRB-2.1.2` Route /fr/auth/callback (exchangeCodeForSession / verifyOtp) with safe `next` redirect (scaffolded in initial commit, verify): Reject absolute/external `next` values (open redirect).
- [ ] `KRB-2.1.3` Page /fr/connexion with server action signInWithPassword (scaffolded in initial commit, verify): zod validation, French error messages.
- [ ] `KRB-2.1.4` Page /fr/inscription with server action signUp: Collect full_name into user metadata.
- [ ] `KRB-2.1.5` Pages /fr/mot-de-passe-oublie and /fr/reinitialiser-mot-de-passe: resetPasswordForEmail + updateUser.
- [ ] `KRB-2.1.6` Sign-out server action and user menu
- [ ] `KRB-2.1.7` Translate Supabase email templates (confirmation, reset, invite, magic link) to French: Configure in supabase/config.toml and hosted projects.
- [ ] `KRB-2.1.8` Configure auth settings: site URL, redirect allowlist, password policy, rate limits, CAPTCHA (hCaptcha/Turnstile) on signup
- [ ] `KRB-2.1.9` Playwright e2e: signup → confirm (Inbucket) → login → logout → reset

### Story 2.2: Workspace Management & RBAC

**Issue ID:** `KRB-2.2` · **Parent:** `KRB-EPIC-2` · **Priority:** Highest · **Story points:** 8 · **Dependencies:** 2.1 · **Labels:** `rbac workspace security backend frontend`

> As a workspace owner or admin, I want to create workspaces, assign roles and assign report sections to experts, so that each expert only accesses the workspaces and sections they are responsible for.

**Acceptance criteria**

1. **Given** an authenticated user with no workspace, **when** they complete the creation wizard (organization name, workspace name, first report title), **then** an organization, workspace and report are created atomically and the creator is `owner` of the workspace.
2. **Given** an owner or admin, **when** they change a member's role or remove a member, **then** the change is persisted; the last owner of a workspace can never be demoted or removed.
3. **Given** an expert, **when** they list workspaces, **then** only workspaces where they are a member are returned.
4. **Given** an expert in workspace W, **when** they open the report, **then** they can read all sections but can edit content/status only on sections where `assigned_to` = them.
5. **Given** a viewer, **when** they try to update any section via the API with the anon key, **then** RLS rejects the write (0 rows / 403).
6. **Given** an admin, **when** they assign section S to an expert who is not a member of W, **then** the assignment is rejected (assigned_to must be a member of the same workspace).

**Sub-tasks**

- [ ] `KRB-2.2.1` RPC create_workspace_with_owner (transactional org + workspace + owner membership + report): SECURITY DEFINER, validates auth.uid().
- [ ] `KRB-2.2.2` Workspace creation wizard UI (3 steps) in French
- [ ] `KRB-2.2.3` Workspace switcher + workspace list on /fr/tableau-de-bord
- [ ] `KRB-2.2.4` Members & roles management page (owner/admin only): Role select, remove member, last-owner guard.
- [ ] `KRB-2.2.5` Section assignment UI (assign/unassign expert, set weight)
- [ ] `KRB-2.2.6` Server-side authorization helpers (requireWorkspaceRole) for server actions/route handlers: Defence in depth on top of RLS.
- [ ] `KRB-2.2.7` DB constraint/trigger: assigned_to must be a workspace member; last-owner protection
- [ ] `KRB-2.2.8` pgTAP + Playwright tests for the RBAC matrix

### Story 2.3: Member Invitations

**Issue ID:** `KRB-2.3` · **Parent:** `KRB-EPIC-2` · **Priority:** High · **Story points:** 5 · **Dependencies:** 2.2 · **Labels:** `rbac workspace auth email`

> As a workspace owner or admin, I want to invite experts by email with a predefined role, so that they can join the right workspace without manual database work.

**Acceptance criteria**

1. **Given** an owner/admin, **when** they invite `expert@example.com` as `expert`, **then** an invitation row (token hash, role, expiry 7 days) is created and a French invitation email is sent.
2. **Given** an invitee without an account, **when** they follow the link, **then** they register via `/fr/inscription` and are added to the workspace with the invited role on first login.
3. **Given** an expired or already-used invitation, **when** it is opened, **then** a French error is shown and no membership is created.
4. **Given** an admin, **when** they try to invite someone as `owner`, **then** it is rejected (only owners can grant owner).

**Sub-tasks**

- [ ] `KRB-2.3.1` Migration: workspace_invitations table + RLS
- [ ] `KRB-2.3.2` Server action to create invitation and send email (Supabase inviteUserByEmail or Resend)
- [ ] `KRB-2.3.3` Accept-invitation route and membership creation
- [ ] `KRB-2.3.4` Pending invitations list with revoke/resend

---

## EPIC 3: Expert Deliverables & File Ingestion Pipeline

**Issue ID:** `KRB-EPIC-3` · **Priority:** High · **Points:** 16 · **Labels:** `deliverables ingestion`

**Goal.** Let assigned experts upload their deliverables (.docx, .xlsx, images, diagrams) directly to Supabase Storage and turn them into parsed, previewable text that the AI engine can consume.

**Scope**

- Private `deliverables` bucket, strict MIME/extension/size validation, signed upload URLs
- deliverables metadata rows with parse_status lifecycle (pending → processing → parsed | failed)
- Server-side parsing: mammoth (.docx), exceljs (.xlsx); images/diagrams stored with metadata
- Expert section workspace UI: upload, list, preview, delete, retry parsing

**Definition of Done**

- [ ] Files never transit through the Next.js server body (direct-to-storage upload)
- [ ] Disallowed MIME types and files > 50 MB are rejected client- and server-side
- [ ] Storage policies verified: a non-member cannot read/write another workspace's objects
- [ ] Parsing is idempotent, retried on failure and visible to the user via parse_status

### Story 3.1: Multi-format Upload Pipeline

**Issue ID:** `KRB-3.1` · **Parent:** `KRB-EPIC-3` · **Priority:** High · **Story points:** 8 · **Dependencies:** 1.2, 2.2 · **Labels:** `deliverables storage security backend`

> As an assigned expert, I want to upload .docx, .xlsx, images and diagram files directly to secure cloud storage, so that my deliverables are stored safely and quickly regardless of file size.

**Acceptance criteria**

1. **Given** an expert assigned to section S in workspace W, **when** they request an upload for `rapport.docx` (≤ 50 MB, allowed MIME), **then** the server validates role, MIME and size, inserts a deliverables row (parse_status = pending) and returns a signed upload URL for `{W}/{S}/{uuid}-rapport.docx`.
2. **Given** the signed upload URL, **when** the browser uploads the file, **then** the object lands in the private `deliverables` bucket and the row is marked uploaded.
3. **Given** a file with a disallowed type (e.g. .exe, .js, .html) or a spoofed extension, **when** upload is requested or completed, **then** it is rejected; the server sniffs magic bytes after upload and deletes mismatching objects.
4. **Given** a file > 50 MB, **when** the user selects it, **then** the UI rejects it before upload and the bucket limit rejects it server-side.
5. **Given** a user who is not a member of W, **when** they try to read or write `{W}/...` with the anon key, **then** storage RLS denies it.
6. **Given** an expert not assigned to S (and not owner/admin), **when** they request an upload for S, **then** the server returns 403.

**Sub-tasks**

- [ ] `KRB-3.1.1` Define allow-list: .docx, .xlsx, .png, .jpg/.jpeg, .webp, .svg (sanitized), .drawio/.vsdx (diagrams), .pdf (optional): Shared zod schema + MIME map used by client and server.
- [ ] `KRB-3.1.2` Route handler POST /api/deliverables/upload-url: validate, insert row, createSignedUploadUrl: Filename sanitization (NFC normalize, strip path chars), uuid prefix.
- [ ] `KRB-3.1.3` Client upload component with progress, drag-and-drop, French errors: uploadToSignedUrl; resumable (TUS) for files > 6 MB.
- [ ] `KRB-3.1.4` Post-upload verification: magic-byte sniffing + size check, mark row or delete object
- [ ] `KRB-3.1.5` Bucket config: private, 50 MB, allowed_mime_types (verify migration) (scaffolded in initial commit, verify): bucket + policies from Story 1.2.
- [ ] `KRB-3.1.6` Signed download URLs (short TTL) for previews
- [ ] `KRB-3.1.7` Tests: storage policy pgTAP + upload e2e with fixtures

### Story 3.2: Expert Section Workspace

**Issue ID:** `KRB-3.2` · **Parent:** `KRB-EPIC-3` · **Priority:** High · **Story points:** 8 · **Dependencies:** 3.1 · **Labels:** `deliverables frontend parsing`

> As an assigned expert, I want a dedicated workspace for my section where I manage deliverables and preview their parsed content, so that I can check what the AI will use before generating a draft.

**Acceptance criteria**

1. **Given** an expert, **when** they open `/fr/espaces/{workspaceId}/sections/{sectionId}`, **then** they see section title, status, their deliverables with parse_status badges (En attente, En cours, Analysé, Échec).
2. **Given** an uploaded .docx, **when** parsing completes, **then** parsed_content contains the document text/HTML (mammoth) and the preview renders it sanitized.
3. **Given** an uploaded .xlsx, **when** parsing completes, **then** parsed_content contains each sheet as a table (exceljs) with sheet names, capped rows per sheet.
4. **Given** a parse failure, **when** the expert views the deliverable, **then** status shows "Échec" with an error message and a "Relancer l'analyse" button.
5. **Given** the expert, **when** they change section status (À faire / En cours / Terminé), **then** report_sections.status is updated (not_started / in_progress / completed).
6. **Given** a viewer or unassigned expert, **when** they open the section, **then** it is read-only (no upload, delete, status change).

**Sub-tasks**

- [ ] `KRB-3.2.1` Section workspace page and layout (French UI)
- [ ] `KRB-3.2.2` Deliverables list with parse_status badges, delete, download
- [ ] `KRB-3.2.3` Parsing worker: mammoth for .docx, exceljs for .xlsx, storing parsed_content (+ parse_error): Triggered after upload verification (route handler / background job via Vercel `after()` or Supabase Edge Function + queue). Set processing → parsed/failed. Idempotent by deliverable id. Images/diagrams: store dimensions and optional caption; OCR out of scope for v1.
- [ ] `KRB-3.2.4` Normalize parsed output to a common structure (markdown text + tables + metadata, token estimate): Feeds Story 4.2 context building.
- [ ] `KRB-3.2.5` Sanitized preview renderer (DOMPurify) for parsed HTML/markdown and tables
- [ ] `KRB-3.2.6` Section status control and optimistic UI
- [ ] `KRB-3.2.7` Retry parsing action and parse timeouts / max size safeguards
- [ ] `KRB-3.2.8` Fixture-based tests for parsers (French docs with accents, tables, merged cells)

---

## EPIC 4: AI Prompt Library & Synthesis Engine

**Issue ID:** `KRB-EPIC-4` · **Priority:** High · **Points:** 26 · **Labels:** `ai llm`

**Goal.** Generate high-quality, structured French section drafts from experts' parsed deliverables using versioned prompt templates, with measurable quality (offline evals), cost control and full observability.

**Scope**

- prompt_library: global (workspace_id NULL) and workspace-scoped templates, versioned and immutable once published
- Generation via Vercel AI SDK `streamObject`/`generateObject` with zod schemas; provider-agnostic (Anthropic / OpenAI)
- Context building with token budgeting and truncation; rate limiting and per-workspace quotas
- Golden-set evaluation harness, human review rubric, LLM-as-judge with calibration
- Tracing of every generation (prompt version, model, tokens, latency, cost, outcome)

**Definition of Done**

- [ ] Every generation is reproducible: stored prompt version id, model id, parameters, input hashes
- [ ] Offline eval suite runs in CI on prompt/model changes and blocks regressions beyond agreed thresholds
- [ ] Per-user and per-workspace rate limits and token budgets enforced server-side
- [ ] No API keys reach the client; no deliverable content is logged to third parties without the DPA in place
- [ ] Dashboard shows tokens, cost, latency p50/p95, failure rate and acceptance rate per prompt version

### Story 4.1: Prompt Library

**Issue ID:** `KRB-4.1` · **Parent:** `KRB-EPIC-4` · **Priority:** High · **Story points:** 5 · **Dependencies:** 1.2, 2.2 · **Labels:** `ai prompts frontend backend`

> As a workspace owner or admin, I want to browse global prompt templates and create workspace-specific templates with versions, so that drafts follow our report conventions and changes to prompts are traceable.

**Acceptance criteria**

1. **Given** any member, **when** they open the prompt library, **then** they see global templates (workspace_id NULL, read-only) and their workspace's templates.
2. **Given** an owner/admin, **when** they create or edit a workspace template, **then** a new immutable version is saved (version number, author, changelog); previous versions remain selectable.
3. **Given** an expert or viewer, **when** they try to create/edit a template, **then** the UI hides the action and RLS rejects the write.
4. **Given** a template, **when** it is saved, **then** it is validated: declared variables (e.g. {{section_title}}, {{deliverables}}, {{report_context}}) are known, and an output schema key is chosen.
5. **Given** only a service-role/admin process, **when** global templates are created or changed, **then** it happens via migration/seed, never from the app UI.

**Sub-tasks**

- [ ] `KRB-4.1.1` Migration: prompt_library versioning (template_key, version, status draft|published|archived, body, variables, output_schema, model defaults): Extend the scaffolded table; unique (workspace_id, template_key, version).
- [ ] `KRB-4.1.2` RLS for prompt_library: read global + own workspace; write own workspace for owner/admin (scaffolded in initial commit, verify): base policy from Story 1.2; extend for versions.
- [ ] `KRB-4.1.3` Seed 3–5 French global templates (synthèse de section, résumé exécutif, recommandations, analyse de données)
- [ ] `KRB-4.1.4` Prompt library UI: list, detail, version history, diff between versions
- [ ] `KRB-4.1.5` Template editor with variable validation and preview against sample context

### Story 4.2: AI Section Draft Generation

**Issue ID:** `KRB-4.2` · **Parent:** `KRB-EPIC-4` · **Priority:** High · **Story points:** 13 · **Dependencies:** 3.2, 4.1 · **Labels:** `ai llm generation backend evaluation`

> As an assigned expert, I want to generate a structured draft of my section from a selected template and my parsed deliverables, so that I start from a solid, consistent draft instead of a blank page.

**Acceptance criteria**

1. **Given** an expert assigned to section S with ≥ 1 parsed deliverable, **when** they choose a published template and click "Générer un brouillon", **then** a server route calls `streamObject` with the template, the parsed context and a zod schema; the draft streams into the editor progressively.
2. **Given** the zod section schema (e.g. title, summary, key_findings[], body_markdown, recommendations[], sources[] referencing deliverable ids), **when** the model returns output, **then** it is validated; on schema failure the request is retried once with repair, then fails with a French error and nothing is overwritten.
3. **Given** deliverables whose total tokens exceed the context budget, **when** the context is built, **then** it is truncated by a deterministic strategy (priority order, per-deliverable cap, table row cap, map-reduce summarization for overflow) and the UI indicates that content was truncated.
4. **Given** a user who exceeded their rate limit (AI_RATE_LIMIT_PER_HOUR, default 30 generations/hour) or a workspace that exceeded its monthly token budget, **when** they request a generation, **then** the server returns 429 with a French message and no LLM call is made.
5. **Given** a completed generation, **when** it is saved, **then** a generation record stores prompt version id, model id, parameters, input hashes, token usage, latency, cost estimate and the raw output; the draft is saved as a proposal, and the expert must accept/edit before it replaces report_sections.content.
6. **Given** a non-assigned expert or viewer, **when** they call the generation endpoint, **then** they get 403.
7. **Given** the golden set, **when** the eval suite runs, **then** results meet the agreed baseline thresholds (see Evaluation sub-task) before the feature is released.

**Sub-tasks**

- [ ] `KRB-4.2.1` Define zod output schemas per template output_schema key and shared types: Schemas versioned alongside prompts; French field descriptions to steer the model.
- [ ] `KRB-4.2.2` Migration: ai_generations table (+ RLS) for drafts, metadata, usage, feedback: Columns: section_id, prompt_version_id, model, params, input_hash, usage tokens, cost, latency_ms, status, output jsonb, accepted bool, user_rating, edit_distance.
- [ ] `KRB-4.2.3` Context builder: assemble template variables from report, section and parsed deliverables: Deterministic ordering; cite deliverable ids; strip PII fields where configured.
- [ ] `KRB-4.2.4` Token budgeting & context truncation: Count tokens per provider tokenizer (approximation acceptable with safety margin); budget = model context − max_output − system overhead; per-deliverable caps; map-reduce summarization of overflow chunks; log truncation decisions.
- [ ] `KRB-4.2.5` Route handler POST /api/ai/sections/[id]/draft using AI SDK streamObject (Node runtime, maxDuration): Provider from env (Anthropic/OpenAI), temperature/maxTokens from template; abort handling.
- [ ] `KRB-4.2.6` Rate limiting & quotas: Per-user sliding window (Upstash Redis or Postgres table) + per-workspace monthly token budget; 429 with Retry-After.
- [ ] `KRB-4.2.7` Draft review UI: streaming preview, accept / edit / discard, diff vs current content: Accepting writes report_sections.content and sets status in_progress if not_started.
- [ ] `KRB-4.2.8` Prompt-injection & safety guards: Delimit untrusted deliverable content, system prompt instructions to ignore embedded instructions, output never executed; red-team fixtures in golden set.
- [ ] `KRB-4.2.9` Evaluation: build golden set of sample deliverables (10–20 anonymized French cases) with reference sections: Covers docx-only, xlsx-heavy, mixed, very long (truncation), noisy/contradictory inputs, injection attempts. Stored in repo under evals/ with licence-cleared data.
- [ ] `KRB-4.2.10` Evaluation: human review rubric (1–5 scale): Criteria: factual faithfulness to deliverables (no hallucinations), coverage of key points, structure/schema adherence, French language quality & tone, actionability of recommendations, correct source citations. Two reviewers, inter-rater agreement tracked.
- [ ] `KRB-4.2.11` Evaluation: automated eval runner (script/CI job) with deterministic checks + LLM-as-judge: Schema validity rate, citation validity, length bounds, judge scores calibrated against human rubric; outputs a report per prompt version/model; thresholds gate release.
- [ ] `KRB-4.2.12` User feedback capture (thumbs up/down + comment) and acceptance/edit-distance metrics: Feeds online evaluation in Story 4.3.

### Story 4.3: LLM Observability, Prompt Versioning & Evaluation Pipeline

**Issue ID:** `KRB-4.3` · **Parent:** `KRB-EPIC-4` · **Priority:** Medium · **Story points:** 8 · **Dependencies:** 4.2, 6.1 · **Labels:** `ai observability evaluation mlops`

> As a product owner building AI engineering capability, I want every LLM call traced and every prompt or model change evaluated before release, so that I can measure quality, cost and latency over time and ship prompt changes with confidence.

**Acceptance criteria**

1. **Given** any generation, **when** it completes or fails, **then** a trace is recorded (OpenTelemetry via AI SDK `experimental_telemetry` to Langfuse/Helicone or equivalent) with prompt version, model, tokens, latency, cost and error; deliverable text is redacted or the vendor is covered by a DPA.
2. **Given** a PR that changes a prompt template, output schema or model id, **when** CI runs, **then** the eval suite runs on the golden set and posts a comparison (vs. production baseline) as a PR comment; the job fails on regression beyond thresholds.
3. **Given** a new prompt version, **when** it is published, **then** it can be rolled out to a percentage of generations or a single workspace and rolled back to the previous version in one action.
4. **Given** the AI metrics dashboard, **when** an admin opens it, **then** it shows per prompt version: generations, acceptance rate, mean rating, edit distance, tokens, cost, p50/p95 latency, failure rate.

**Sub-tasks**

- [ ] `KRB-4.3.1` Enable AI SDK telemetry and integrate a tracing backend (Langfuse self-host/cloud EU or Helicone)
- [ ] `KRB-4.3.2` Prompt version promotion workflow (draft → published → archived) with rollout percentage & rollback
- [ ] `KRB-4.3.3` CI job: run evals on prompt/schema/model changes; post results as PR comment; threshold gate: Budget-capped; uses a small subset on every PR and full set nightly.
- [ ] `KRB-4.3.4` AI metrics dashboard (SQL views over ai_generations + tracing links)
- [ ] `KRB-4.3.5` Cost alerts (daily spend threshold per environment) and provider fallback strategy
- [ ] `KRB-4.3.6` Write an AI evaluation playbook in docs/ (how to add a golden case, run evals, read reports)

---

## EPIC 5: Master Report Synthesis & Progress Tracking

**Issue ID:** `KRB-EPIC-5` · **Priority:** Medium · **Points:** 16 · **Labels:** `report dashboard`

**Goal.** Assemble all sections into a single master report that can be reviewed, finalized and exported, and give the team a real-time view of completion.

**Scope**

- Master report view with section ordering, table of contents and export to .docx and PDF
- Report lifecycle draft → in_review → final
- Completion % (weighted) from report_progress view, live updates via Supabase Realtime on report_sections

**Definition of Done**

- [ ] Master report renders all sections in order with French typography
- [ ] Exports open correctly in Word/LibreOffice and PDF viewers, with accents and tables intact
- [ ] Dashboard updates within 2 s of a section status change without page reload
- [ ] Realtime respects RLS (users only receive changes for workspaces they belong to)

### Story 5.1: Collaborative Master Document Builder

**Issue ID:** `KRB-5.1` · **Parent:** `KRB-EPIC-5` · **Priority:** Medium · **Story points:** 8 · **Dependencies:** 4.2 · **Labels:** `report frontend export`

> As a workspace owner or admin, I want to assemble all sections into a unified master report, reorder them and export it, so that I can deliver a coherent final report to the client.

**Acceptance criteria**

1. **Given** a report with sections, **when** an owner/admin opens `/fr/rapports/{reportId}`, **then** all sections render in `position` order with a generated table of contents, assignee and status per section.
2. **Given** an owner/admin, **when** they drag-and-drop to reorder sections, **then** positions are persisted atomically and other open sessions reflect the new order.
3. **Given** an expert, **when** they open the master report, **then** they can read all sections and jump to edit only their assigned ones.
4. **Given** a report, **when** an owner/admin clicks "Exporter en .docx" or "Exporter en PDF", **then** a file named `{report-title}-{date}.docx|pdf` is generated server-side with cover page, TOC, headings and tables, and downloaded.
5. **Given** two users editing different sections, **when** both save, **then** no section overwrites another; concurrent edits on the same section are detected via updated_at (optimistic concurrency) with a French conflict message.

**Sub-tasks**

- [ ] `KRB-5.1.1` Master report page with TOC and section rendering (markdown → sanitized HTML)
- [ ] `KRB-5.1.2` Section reordering (dnd-kit) with RPC reorder_sections (transactional)
- [ ] `KRB-5.1.3` Optimistic concurrency on report_sections (updated_at check) + conflict UI
- [ ] `KRB-5.1.4` Export to .docx (docx library) with cover page, TOC, headings, tables: Route handler, Node runtime; French date formatting.
- [ ] `KRB-5.1.5` Export to PDF (HTML print stylesheet + headless Chromium/@sparticuz/chromium or react-pdf): Validate Vercel function size/time limits.
- [ ] `KRB-5.1.6` Store exports in Storage (`exports/` prefix) with signed download links and audit row

### Story 5.2: Real-Time Completion Dashboard

**Issue ID:** `KRB-5.2` · **Parent:** `KRB-EPIC-5` · **Priority:** Medium · **Story points:** 5 · **Dependencies:** 1.2, 2.2 · **Labels:** `dashboard realtime frontend`

> As a workspace owner, admin or expert, I want a dashboard showing report completion and section states in real time, so that I know what is left to do without asking the team.

**Acceptance criteria**

1. **Given** a report with sections of weights w_i and statuses, **when** completion is computed, **then** completion % = round(100 × Σ(w_i × s_i) / Σ w_i) with s = 1 for completed, 0.5 for in_progress, 0 for not_started, read from the `report_progress` view; 0 sections → 0 %.
2. **Given** `/fr/tableau-de-bord`, **when** it loads, **then** each report shows a progress bar, % and counts per state (Non commencé / En cours / Terminé).
3. **Given** two browsers on the same dashboard, **when** an expert sets their section to completed, **then** the other browser updates the progress bar within 2 s via Supabase Realtime (postgres_changes on report_sections filtered by report_id).
4. **Given** a user not in the workspace, **when** they subscribe to the realtime channel, **then** they receive no events (RLS-filtered).
5. **Given** the realtime connection drops, **when** it reconnects, **then** the dashboard refetches report_progress to resync.

**Sub-tasks**

- [ ] `KRB-5.2.1` Verify report_progress view math with pgTAP (edge cases: zero weight, all completed, mixed) (scaffolded in initial commit, verify): view defined in Story 1.2 migrations.
- [ ] `KRB-5.2.2` Enable Realtime publication for report_sections (supabase_realtime) with RLS
- [ ] `KRB-5.2.3` Dashboard UI: report cards, progress bar, status counts, per-assignee breakdown
- [ ] `KRB-5.2.4` useReportProgress hook: initial fetch + realtime subscription + resync on reconnect
- [ ] `KRB-5.2.5` e2e test with two browser contexts

### Story 5.3: Report Review & Finalization Workflow

**Issue ID:** `KRB-5.3` · **Parent:** `KRB-EPIC-5` · **Priority:** Medium · **Story points:** 3 · **Dependencies:** 5.1 · **Labels:** `report workflow`

> As a workspace owner, I want to move a report through draft, in review and final states, so that the final version is frozen and clearly identified.

**Acceptance criteria**

1. **Given** a report in `draft`, **when** an owner/admin submits it for review, **then** status becomes `in_review` and assigned experts are notified.
2. **Given** a report in `in_review`, **when** the owner finalizes it, **then** status becomes `final`, sections become read-only for everyone except owners (who may reopen to draft), and an export snapshot is stored.
3. **Given** a report in `final`, **when** an expert tries to edit a section, **then** RLS rejects the write.

**Sub-tasks**

- [ ] `KRB-5.3.1` RPC/server action for status transitions with allowed-transition table
- [ ] `KRB-5.3.2` RLS update: block section writes when parent report is final
- [ ] `KRB-5.3.3` UI badges and actions for report status (Brouillon / En revue / Final)
- [ ] `KRB-5.3.4` Email/in-app notification on status change

---

## EPIC 6: CI/CD, Observability & Production Deployment

**Issue ID:** `KRB-EPIC-6` · **Priority:** High · **Points:** 24 · **Labels:** `devops production`

**Goal.** Take KolabReport from repository to a secure, monitored production deployment with automated quality gates and safe database migration promotion.

**Scope**

- GitHub Actions: lint, typecheck, unit tests, build, migration check, RLS tests, e2e
- Vercel preview (per PR) and production environments; Supabase staging and production projects
- Secrets management, error monitoring, logging, uptime, backups and restore drill
- RLS/security review, Lighthouse PWA/performance/accessibility audit, go-live checklist

**Definition of Done**

- [ ] Main branch is protected; merges require green CI and one review
- [ ] Migrations are applied to staging automatically and to production via a gated, audited job
- [ ] Sentry (or equivalent) captures client/server errors in production with source maps
- [ ] PITR/backups enabled and a restore drill has been performed
- [ ] Security review sign-off and go-live checklist completed

### Story 6.1: CI Pipeline (GitHub Actions)

**Issue ID:** `KRB-6.1` · **Parent:** `KRB-EPIC-6` · **Priority:** Highest · **Story points:** 3 · **Dependencies:** 1.1, 1.2, 1.3 · **Labels:** `devops ci`

> As a developer, I want every pull request automatically linted, type-checked, tested, built and migration-checked, so that regressions are caught before merge.

**Acceptance criteria**

1. **Given** a pull request, **when** CI runs, **then** jobs lint, typecheck, unit tests and `next build` pass, with npm cache, in < 10 min.
2. **Given** a PR touching supabase/migrations, **when** the migration-check job runs, **then** it starts Supabase via the CLI, runs `supabase db reset`, `supabase test db` (pgTAP), and fails on generated-types drift (`supabase gen types` diff).
3. **Given** the main branch, **when** branch protection is configured, **then** merging requires all required checks green and 1 approving review.

**Sub-tasks**

- [ ] `KRB-6.1.1` Workflow ci.yml: install, lint, typecheck, test, build
- [ ] `KRB-6.1.2` Workflow job: migration check (db reset + pgTAP + types drift)
- [ ] `KRB-6.1.3` Workflow job: Playwright e2e against preview deployment or local stack
- [ ] `KRB-6.1.4` Branch protection rules + CODEOWNERS + PR template
- [ ] `KRB-6.1.5` Dependabot/Renovate and `npm audit` / CodeQL scanning

### Story 6.2: Environments, Secrets & Migration Promotion

**Issue ID:** `KRB-6.2` · **Parent:** `KRB-EPIC-6` · **Priority:** High · **Story points:** 5 · **Dependencies:** 6.1 · **Labels:** `devops supabase vercel security`

> As a developer, I want separate staging and production environments with automated, gated migration promotion, so that we can release safely and roll back if needed.

**Acceptance criteria**

1. **Given** a PR, **when** it is opened, **then** Vercel creates a preview deployment wired to the staging Supabase project.
2. **Given** a merge to main, **when** the deploy workflow runs, **then** `supabase db push` applies pending migrations to staging, then Vercel deploys to staging/preview.
3. **Given** a release tag or manual approval (GitHub Environment `production` with required reviewers), **when** the production workflow runs, **then** migrations are applied to the production project first, then Vercel promotes the production deployment.
4. **Given** secrets (SUPABASE_SERVICE_ROLE_KEY, LLM API keys, DB passwords), **when** they are configured, **then** they live only in Vercel env vars / GitHub Environment secrets, scoped per environment, never in the repo; NEXT_PUBLIC_* contain only public values.
5. **Given** a bad deployment, **when** rollback is needed, **then** Vercel instant rollback is documented and migrations are written forward-compatible (expand/contract).

**Sub-tasks**

- [ ] `KRB-6.2.1` Create Supabase staging and production projects (EU region), configure auth URLs, SMTP, storage bucket
- [ ] `KRB-6.2.2` Create Vercel project; map Preview → staging and Production → prod env vars
- [ ] `KRB-6.2.3` GitHub Environments (staging, production) with secrets and required reviewers
- [ ] `KRB-6.2.4` Deploy workflow: supabase link + db push (staging on main, production on approval)
- [ ] `KRB-6.2.5` Custom domain, HTTPS, security headers (CSP, HSTS, X-Frame-Options, Referrer-Policy)
- [ ] `KRB-6.2.6` Document migration guidelines (expand/contract, no destructive changes without backfill) and rollback runbook

### Story 6.3: Observability, Error Monitoring & Backups

**Issue ID:** `KRB-6.3` · **Parent:** `KRB-EPIC-6` · **Priority:** High · **Story points:** 5 · **Dependencies:** 6.2 · **Labels:** `devops observability backup`

> As a product owner, I want production errors, performance and availability monitored and data backed up, so that incidents are detected quickly and data can be recovered.

**Acceptance criteria**

1. **Given** a runtime error in the browser, a server component or a route handler, **when** it occurs in production, **then** it is captured in Sentry with release, environment, user id (no email/PII) and source maps.
2. **Given** the production site, **when** it is unavailable for > 2 min, **then** an uptime monitor alerts the team.
3. **Given** the production database, **when** backups are configured, **then** daily backups + PITR are enabled and a restore to a scratch project has been tested and documented.
4. **Given** the Storage bucket, **when** a backup strategy is defined, **then** a scheduled export or replication of `deliverables` exists, with documented RPO/RTO.

**Sub-tasks**

- [ ] `KRB-6.3.1` Integrate Sentry for Next.js (client, server, edge) with source map upload in CI
- [ ] `KRB-6.3.2` Structured server logging with request ids; Vercel log drain
- [ ] `KRB-6.3.3` Uptime monitoring + alert routing (email/Slack)
- [ ] `KRB-6.3.4` Enable Supabase PITR / daily backups; perform and document a restore drill
- [ ] `KRB-6.3.5` Storage backup job for deliverables bucket
- [ ] `KRB-6.3.6` Supabase advisors (security & performance) check and DB metrics alerting

### Story 6.4: Security Review & RLS Audit

**Issue ID:** `KRB-6.4` · **Parent:** `KRB-EPIC-6` · **Priority:** Highest · **Story points:** 5 · **Dependencies:** 2.3, 3.2, 4.2, 5.3 · **Labels:** `security rls audit`

> As a product owner, I want an independent security review of RLS, storage policies, auth and AI endpoints before launch, so that client data is protected and we meet GDPR expectations.

**Acceptance criteria**

1. **Given** every table, view, function and storage policy, **when** the audit runs, **then** each policy is reviewed against the RBAC matrix, pgTAP covers every role × operation, and SECURITY DEFINER functions set search_path and check auth.uid().
2. **Given** the anon key and a valid low-privilege session, **when** a tester attempts cross-workspace reads/writes via the REST API, Realtime and Storage, **then** all attempts fail.
3. **Given** the Supabase security advisor, **when** it is run on production, **then** no errors remain.
4. **Given** GDPR requirements, **when** they are reviewed, **then** a record of processing, DPA with LLM provider, data retention policy and user data export/deletion procedure are documented.

**Sub-tasks**

- [ ] `KRB-6.4.1` RLS/policy review session with checklist and findings log
- [ ] `KRB-6.4.2` Penetration-style tests with anon key across REST, Realtime, Storage
- [ ] `KRB-6.4.3` Review service-role usage (server-only, minimal surface)
- [ ] `KRB-6.4.4` Review AI endpoints: authz, rate limits, prompt injection, data sent to providers
- [ ] `KRB-6.4.5` GDPR documentation: processing record, DPA, retention, account deletion flow
- [ ] `KRB-6.4.6` Fix findings and re-test

### Story 6.5: Lighthouse PWA, Performance & Accessibility Audit

**Issue ID:** `KRB-6.5` · **Parent:** `KRB-EPIC-6` · **Priority:** Medium · **Story points:** 3 · **Dependencies:** 5.2 · **Labels:** `pwa performance accessibility`

> As a user on a mobile connection, I want a fast, accessible, installable app, so that I can work comfortably from the field, even with poor connectivity.

**Acceptance criteria**

1. **Given** the production build of /fr/connexion and /fr/tableau-de-bord, **when** Lighthouse (mobile) runs, **then** Performance ≥ 85, Accessibility ≥ 95, Best Practices ≥ 95, and PWA installability checks pass.
2. **Given** CI, **when** Lighthouse CI runs on preview deployments, **then** it fails if scores drop below thresholds.
3. **Given** keyboard and screen-reader users, **when** they complete login, upload and generation flows, **then** all controls are reachable, labelled in French and announced correctly (WCAG 2.1 AA).

**Sub-tasks**

- [ ] `KRB-6.5.1` Add Lighthouse CI to GitHub Actions with budgets
- [ ] `KRB-6.5.2` Fix performance issues (bundle size, images, fonts, RSC boundaries)
- [ ] `KRB-6.5.3` Accessibility pass (axe + manual) and fixes
- [ ] `KRB-6.5.4` Verify SW update flow (new version prompt "Nouvelle version disponible")

### Story 6.6: Go-Live Checklist & Launch

**Issue ID:** `KRB-6.6` · **Parent:** `KRB-EPIC-6` · **Priority:** Highest · **Story points:** 3 · **Dependencies:** 6.2, 6.3, 6.4, 6.5 · **Labels:** `production launch`

> As a product owner, I want a verified go-live checklist and a controlled launch, so that the first client workspaces go live without surprises.

**Acceptance criteria**

1. **Given** the go-live checklist, **when** it is executed, **then** every item is checked and signed off (see sub-tasks).
2. **Given** production, **when** the smoke test suite runs post-deploy, **then** signup, login, workspace creation, upload, parse, AI draft, dashboard and export all pass.
3. **Given** the first week after launch, **when** hypercare is active, **then** errors, AI cost and latency are reviewed daily and issues are triaged.

**Sub-tasks**

- [ ] `KRB-6.6.1` Production env vars and secrets verified; staging keys absent from prod
- [ ] `KRB-6.6.2` Auth: production site URL, redirect allowlist, French email templates, custom SMTP sender domain (SPF/DKIM/DMARC)
- [ ] `KRB-6.6.3` Legal pages in French: mentions légales, politique de confidentialité, CGU
- [ ] `KRB-6.6.4` Seed production global prompt templates and run eval baseline on production model
- [ ] `KRB-6.6.5` Post-deploy smoke tests on production
- [ ] `KRB-6.6.6` Launch communication, support channel and hypercare rota
