# 001. Billing implementation plan

The work of [ADR 001](001-billing-and-fedapay.md), split along the Jira stories of epic KRB-173. Each numbered PR below can merge on its own: enforcement stays off (`private.billing_settings.enforced = false`) until the launch migration in KRB-179, so nothing changes for users before that.

Every PR follows the project rules: migrations expand only, new tables come with RLS and policies in the same file, `npm run db:types` ships with the migration, French copy goes in `messages/fr.json`, prose goes through `check_prose.py`, and `npm run lint`, `npm run typecheck`, `npm run build` pass. PRs that touch auth, routing or limits also run `npm run test:e2e` against `npx supabase start`.

## Order and dependencies

```
KRB-175 plans, trial, limits
  175-1 workspaces and reports in an existing organization
  175-2 entitlements, trial, catalogue          (needs 175-1 only for the wizard copy)
  175-3 limits: members, reports, drafts, templates  (needs 175-2)
KRB-176 FedaPay checkout and webhooks           (needs 175-2)
  176-1 FedaPay client, settings, signature, mock server
  176-2 purchases, grant, receipts numbering, checkout, return page, webhook
KRB-177 billing page, usage meter, receipts     (meter needs 175-3, the rest needs 176-2)
KRB-178 reminders, expiry, read-only            (guards need 175-2, e-mail links need 177)
KRB-179 pricing page, Institution by hand, launch  (needs everything above)
```

KRB-177, KRB-178 and the pricing page of KRB-179 can be worked on in parallel once KRB-176 is merged.

## KRB-175: plans, trial and limits

Goal: the database knows what each organization is entitled to, starts trials, and refuses what goes past a limit. Users see no change while enforcement is off, except the new wizard step and the "Nouveau rapport" action.

### PR 175-1: workspaces and reports inside an existing organization

Prerequisite of organization billing (ADR 3.2). Can become its own story if the product owner prefers (Q1).

- Migration `<ts>_workspaces_in_organization.sql`:
  - `public.create_workspace_in_organization(p_organization_id, p_workspace_name, p_report_title)`, SECURITY DEFINER, same rights as the `workspaces` insert policy (organization owner, or owner or admin of one of its workspaces), same name checks as `create_workspace_with_owner`. Granted to `authenticated`.
  - `public.my_manageable_organizations()` for the wizard: id and name of the organizations the user can add a workspace to.
- Server: `createWorkspace` in `src/app/[locale]/(app)/espaces/nouveau/actions.ts` takes an optional `organizationId`. New action `createReport(workspaceId, title)` with the user's client, owners and admins only.
- UI: the wizard's first step offers the user's organizations (current one selected) or "Nouvelle organisation". A "Nouveau rapport" button on the dashboard for owners and admins, a small dialog with the title.
- Copy: `WorkspaceWizard.steps.organization.*` updated, `Dashboard.reports.create*` added.
- Tests: pgTAP `workspaces_test.sql` (rights of the new function, outsider refused), unit tests of the schemas, e2e `workspaces.spec.ts` (new workspace in the same organization, new report).
- Docs: the README, where it describes the wizard.

### PR 175-2: entitlements, trial and catalogue

- Migration `<ts>_billing_entitlements.sql`:
  - `create extension if not exists btree_gist with schema extensions`.
  - `private.billing_settings` (one row, `enforced = false`, `seller` jsonb filled with Mocktar Technologies' details).
  - `workspaces.billing_mode` (`subscription` default, `mission`), no new user grant.
  - `public.organization_billing`, `public.billing_entitlements`, `public.billing_ai_packs`, `private.billing_trial_claims`, `private.billing_events`, with RLS, policies, grants and the exclusion constraints.
  - Helpers: `private.can_read_org_billing`, `private.can_manage_org_billing`, `private.billing_lock_org`, `private.billing_trial_terms`, `private.workspace_access`.
  - Trigger after insert on `organizations`: creates the `organization_billing` row, and the trial entitlement plus the trial claim when the owner has no claim (by user id and by e-mail hash).
  - `public.workspace_billing_state(ws)` and `public.billing_overview(org)` (counts only, no names).
  - Backfill: an `organization_billing` row for every existing organization. No entitlement yet: the launch migration (179-3) gives them their launch period.
- Server: `src/lib/billing/catalog.ts` (offers, plans, limits, prices, French labels, `CATALOG_VERSION`), `src/lib/billing/state.ts` (typed wrappers of the two functions).
- Seed: `supabase/seed.sql` gives the demo organization a manual Cabinet entitlement until 2100 and sets `enforced = true` (local and CI only), so later PRs test with enforcement on.
- `CLAUDE.md`: the tenant rule becomes "`workspace_id` or `organization_id`" (ADR 5.1), if the product owner agrees.
- Tests: pgTAP `billing_rls_test.sql`, `billing_trial_test.sql`; unit test that `billing_trial_terms()` in the migration matches the catalogue.

### PR 175-3: limits on members, reports, AI drafts and templates

- Migration `<ts>_billing_limits.sql`:
  - `private.billing_check_seat`, `private.billing_check_report_slot`, `private.billing_reserve_draft`.
  - Triggers: `workspace_invitations` (before insert; before update of `expires_at`, `token_hash`), `workspace_members` (before update of `role`), `reports` (before insert; before update of `status` from `final`), `prompt_library` (before insert or update for workspace templates).
  - New versions of `private.join_from_invitation` (seat check, `KR041`), `public.accept_my_pending_invitations` (skips invitations that fail), `public.create_workspace_in_organization` (seat and report checks), `public.start_prompt_rollout` (templates).
  - `public.billing_draft_usage` with RLS and policy; `start_ai_generation` dropped and created again with the same arguments plus the access check, the reservation and the refusals `readOnly`, `quotaExceeded`, `templateNotIncluded`; trigger after update of `status` on `ai_generations` to count or release.
  - Error codes `KR040` to `KR044` in the header comment, like the earlier migrations.
- Server: `src/lib/workspaces/errors.ts` maps the new codes; `src/lib/ai/generation-store.ts` and the draft route map the new refusals (402 for `quotaExceeded`, 403 for the other two); `inviteMember`, `updateMemberRole`, `transitionReportStatus` and the invitation page show the messages with the numbers from `workspace_billing_state`.
- Copy: the `Workspaces.errors` and `AiDraft.errors` keys of ADR 7.4.
- Tests: pgTAP `billing_limits_test.sql`, `billing_drafts_test.sql`; e2e: invite past the limit, report past the limit, draft quota with `AI_PROVIDER=mock`, two invitations at once (one passes); check that the existing specs still pass with enforcement on (they use the demo organization on Cabinet, or new users with a trial).
- Risk: `start_ai_generation` is long and central. Keep the existing checks in the same order and add the billing part just before the insert.

## KRB-176: FedaPay checkout and webhooks

Goal: an owner can pay for an offer, and the payment turns into an entitlement exactly once.

### PR 176-1: FedaPay client, settings, signature and mock server

- No migration.
- Server:
  - `src/lib/billing/settings.ts`: reads `FEDAPAY_ENVIRONMENT`, `FEDAPAY_SECRET_KEY`, `FEDAPAY_WEBHOOK_SECRET`, `FEDAPAY_API_BASE_URL`, `BILLING_ALERT_EMAIL`; applies the fail-closed rules of ADR 8.9.
  - `src/lib/billing/fedapay.ts`: `createTransaction`, `createToken`, `getTransaction`, `getTransactionByMerchantReference` with `fetch`, a 10-second timeout, wrapped or unwrapped answers.
  - `src/lib/billing/webhook-signature.ts`: parse and verify `X-FEDAPAY-SIGNATURE`.
- Tests: `tests/fedapay-mock/server.mjs` (endpoints, payment page, signed webhooks, switches to skip or repeat the webhook and change the amount), added as a second `webServer` in `playwright.config.ts`; `scripts/ci-env-local.sh` writes the mock settings; unit tests for the three modules.
- Docs: `.env.example` gets the FedaPay block (in French, like the rest of the file).

### PR 176-2: purchases, grant, checkout, return page and webhook

- Migration `<ts>_billing_purchases.sql`:
  - `public.billing_purchases`, `public.billing_receipts`, `public.billing_receipt_lines` (RLS, policies, the immutability trigger), `private.billing_payment_events`, `private.billing_receipt_counters`.
  - `public.billing_create_purchase`, `public.billing_set_transaction`, `public.billing_apply_transaction` (dates of ADR 6.3, conversion on upgrade, pass flips the workspace to `mission`, receipt numbering), `private.billing_issue_receipt`, `public.billing_pending_purchases`. Service role only.
- Server:
  - `src/lib/billing/checkout.ts` and the server action `startCheckout` under `src/app/[locale]/(app)/organisations/[organizationId]/abonnement/actions.ts`.
  - `src/lib/billing/apply.ts` (re-read and apply) and `src/lib/billing/reconcile.ts`.
  - `src/app/api/billing/fedapay/webhook/route.ts`.
  - Return page `src/app/[locale]/(app)/organisations/[organizationId]/abonnement/retour/[purchaseId]/page.tsx`, network only in the service worker.
  - Confirmation e-mail `src/lib/email/billing-email.ts` (paid), alert e-mails (review, refund).
- UI: a minimal offer picker on the organization's billing route (the full page comes in KRB-177), the return page states of ADR 7.4.
- Tests: pgTAP `billing_grant_test.sql`; e2e checkout specs of ADR 13 against the mock; unit tests of `apply.ts` and `reconcile.ts` with a mocked client.
- Docs: `docs/deployment.md` (variables table, FedaPay dashboard setup, Vercel protection bypass for the staging webhook), `docs/gdpr/processors.md` (FedaPay), `docs/security/` note on the webhook.
- Manual: the sandbox checklist of ADR 13, items 1 to 9, on staging.

## KRB-177: billing page, usage meter and receipts

Goal: owners and admins see their plan, usage, history and receipts, and buy from one page.

- Migration `<ts>_billing_page.sql`, small: `billing_overview` returns purchases and receipts summaries if not already, and the update policy and column grant on `organization_billing` if 175-2 left them out.
- Server: `src/lib/billing/receipt-pdf.tsx` (one A4 page, `@react-pdf/renderer`, `toWinAnsi`), `src/app/api/billing/receipts/[id]/route.ts` (user's client, RLS, `Content-Disposition` with the receipt number), server action to save billing details.
- UI:
  - `/fr/organisations/[organizationId]/abonnement`: current plan and state, period end, the usage meter (members with pending invitations, active reports, drafts this month, packs left), offers with the period rules of ADR 6.3 in one line each, passes per workspace, purchase history, receipts with download links, billing details form.
  - Link "Abonnement" in the sidebar for billing readers.
  - Usage hints where limits bite: members page ("3 membres sur 3"), "Nouveau rapport" dialog, AI draft panel ("12 brouillons IA restants ce mois-ci").
- Copy: `Billing.page.*`, `Billing.meter.*`, `Billing.receipt.*`.
- Tests: unit test of the PDF text; e2e of the page for owner (sees and buys), admin (sees), expert (no link, 404 on the URL); receipt download.
- Docs: `docs/gdpr/retention.md` and `record-of-processing.md` (purchases, receipts, payment events, 10 years to confirm).

## KRB-178: reminders, expiry and read-only

Goal: periods end on time, people are warned, and an organization that does not renew becomes read-only.

- Migration `<ts>_billing_read_only.sql`:
  - `private.assert_workspace_writable`, the trigger function `private.guard_billing_writable()` on `reports`, `report_sections`, `deliverables`, `workspace_invitations`, `prompt_library`, `prompt_rollouts`; checks added to `transition_report_status` and `private.can_upload_deliverable`.
  - `private.billing_notices`, `public.billing_due_notices(at)` (which entitlements need `d7`, `d1`, `ended`, optional `read_only`, with catch-up when a day was missed), audit events `entered_grace` and `entered_read_only`.
- Server: `src/app/api/cron/billing/route.ts` (same `CRON_SECRET` check as the storage cleanup, counts only in the answer, 500 on any failure): notices and e-mails, then `reconcilePendingPurchases`, then expiry of old pending purchases. `vercel.json` gets the cron, for example `17 5 * * *` (06:17 in Cotonou, before the working day).
- UI: banner in the app shell from `workspace_billing_state` (trial, ending soon, grace, read-only, no plan); disabled edit buttons with the reason in read-only; reminder e-mails with a link to the billing page.
- Copy: `Billing.banner.*`, `Billing.email.*`, `Workspaces.errors.readOnly*`.
- Tests: pgTAP `billing_read_only_test.sql` and notice selection; unit tests of the cron route (auth, counts, 500); e2e: dates moved back with the service role, banner, blocked edit, export still works, cron run by hand sends each e-mail once (Mailpit).
- Docs: `docs/deployment.md` scheduled jobs table, `docs/operations/monitoring.md` billing section, a new runbook `docs/operations/billing.md` (stuck purchase, review, refund, manual grant, moving dates on staging).

## KRB-179: pricing page, Institution by hand, launch

Goal: prospects see the offers, the operator can sell Institution deals, and billing goes live.

### PR 179-1: public pricing page

- `src/app/[locale]/tarifs/page.tsx`, static, built from the catalogue: the six offers, "prix hors taxes", what a member is, that readers are free, grace and read-only in two sentences, FAQ, "Demander un devis" for Institution (mailto or a contact form if one exists then).
- `/tarifs` added to `PUBLIC_PATHS` in `src/middleware.ts`; links from the landing header and footer; metadata for search engines.
- Copy: `Pricing.*`.
- Tests: e2e signed out (page renders, prices match the catalogue), accessibility check like the other public pages, Lighthouse URL list if wanted.

### PR 179-2: Institution and manual changes

- Migration `<ts>_billing_admin.sql`: `public.billing_admin_grant`, `public.billing_admin_revoke`, `public.billing_admin_record_payment` (service role only, actor and reason required, before and after state in `private.billing_events`, receipt for recorded payments).
- `scripts/billing/record-payment.mjs` and `scripts/billing/grant.mjs`: dry run by default, `--apply` to write, read the service role key from the environment, print what changed.
- Tests: pgTAP for the admin functions (refused to `authenticated`, audit rows written, receipt issued for a bank transfer).
- Docs: `docs/operations/billing.md` gets the Institution procedure (quote, transfer received, script, receipt sent).

### PR 179-3: launch

- Migration `<ts>_billing_launch.sql`: the steps of ADR 10 (`enforced = true`, launch periods, trial claims, audit events). It runs on staging when merged and on production with the release tag, which is the launch moment.
- Before tagging: FedaPay live account verified, live keys and webhook secret on Vercel Production, live webhook created with auto-disable unticked, Vercel plan checked (Q16), terms of sale online (Q10), the launch e-mail to existing owners written by the product owner, sandbox checklist passed on staging.
- After the release: grant the owner's own organizations Institution with `scripts/billing/grant.mjs`; one live payment of the smallest offer, refunded through the FedaPay dashboard, to check the whole path in production.

## Rough sizes

| PR | Size | Main risk |
| --- | --- | --- |
| 175-1 | M | wizard UX change for existing users |
| 175-2 | M | exclusion constraints and RLS on six tables |
| 175-3 | L | `start_ai_generation` rewrite, triggers on hot tables |
| 176-1 | S | none, isolated modules |
| 176-2 | L | grant function and period math |
| 177 | M | page size; split meter and receipts if it grows |
| 178 | M | read-only guards on every content table |
| 179-1 | S | |
| 179-2 | S | |
| 179-3 | S | timing and communication, not code |
