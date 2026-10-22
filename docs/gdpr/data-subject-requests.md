# Data subject requests

Runbook for a request to access, export, correct or delete personal data. Since KRB-186 a signed-in person does most of it on `/fr/compte`: they download their data, change their name, transfer an organization they own and delete their account. The [last section](#self-service-in-the-app) says what the app does. An operator answers by hand, with the steps below, only what the app can't do: a person who can no longer sign in, a change of e-mail address, and the copies outside the database (backups, the e-mail provider, the Auth audit log).

You run the SQL in the SQL editor of the production Supabase project. The editor connects as `postgres`, which bypasses RLS like the service role, so every query below is scoped to one person or one workspace: keep it that way. Try any step that writes on staging first.

Placeholders to replace: `person@example.com`, `<user-id>`, `<workspace-id>`, `<organization-id>`, `<successor-id>` (the person who takes over a workspace).

## Before you start

1. **Check who is asking.** Answer only at the e-mail address of the account. If the request comes from another address, ask the person to write from the account's address.
2. **Decide who answers.** KolabReport answers for account data (activity 1 in [`record-of-processing.md`](record-of-processing.md)). Report content belongs to the firm, which is the controller: a request about a report, a file or an AI draft, or from someone who is not a user (a person named in a report), goes to the owners of the workspace concerned. KolabReport then helps on the firm's instructions ([below](#requests-about-report-content)).
3. **Log it** outside the repository: date received, type, user id, what was done, date answered. The GDPR gives one month to answer, which can be extended by two more months for complex requests if the person is told within the first month. The log is also what lets you apply erasures again after a backup restore.

## Find the person

```sql
select u.id, u.email, u.created_at, u.email_confirmed_at, u.last_sign_in_at, p.full_name
from auth.users u
left join public.profiles p on p.id = u.id
where lower(u.email) = lower('person@example.com');
```

Their workspaces, with their role and how many owners each one has:

```sql
select m.workspace_id, w.name as workspace, w.organization_id, o.name as organization, m.role,
  (select count(*) from public.workspace_members x
   where x.workspace_id = m.workspace_id and x.role = 'owner') as owners
from public.workspace_members m
join public.workspaces w on w.id = m.workspace_id
join public.organizations o on o.id = w.organization_id
where m.user_id = '<user-id>';
```

The owners of a workspace, to forward a request about its content:

```sql
select p.full_name, p.email
from public.workspace_members m
join public.profiles p on p.id = m.user_id
where m.workspace_id = '<workspace-id>' and m.role = 'owner';
```

## Access and export

A person who can sign in gets this file themselves: "Télécharger mes données" on `/fr/compte` returns the same JSON, built by `src/lib/account/export.ts`. Use the query when they can't.

This query returns one JSON document with the account and everything that links to the person: profile, sessions, memberships, invitations, and the records they created or that point at them. It also lists the purchases the person made, with their receipt numbers and without the FedaPay details. It leaves out the text of sections and AI drafts, which is the firm's content: add it only with the firm's agreement, or let the firm export its reports from the app.

```sql
with target as (
  select id, email from auth.users where lower(email) = lower('person@example.com')
)
select jsonb_pretty(jsonb_build_object(
  'exported_at', now(),
  'account', (
    select jsonb_build_object(
      'id', u.id, 'email', u.email, 'created_at', u.created_at,
      'email_confirmed_at', u.email_confirmed_at, 'last_sign_in_at', u.last_sign_in_at,
      'user_metadata', u.raw_user_meta_data)
    from auth.users u join target t on t.id = u.id),
  'profile', (select to_jsonb(p) from public.profiles p join target t on t.id = p.id),
  'sessions', (select coalesce(jsonb_agg(jsonb_build_object(
      'created_at', s.created_at, 'refreshed_at', s.refreshed_at, 'user_agent', s.user_agent, 'ip', s.ip)), '[]')
    from auth.sessions s join target t on t.id = s.user_id),
  'organizations_owned', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', o.id, 'name', o.name, 'created_at', o.created_at)), '[]')
    from public.organizations o join target t on t.id = o.owner_id),
  'memberships', (select coalesce(jsonb_agg(jsonb_build_object(
      'workspace_id', m.workspace_id, 'workspace', w.name, 'role', m.role, 'joined_at', m.created_at)), '[]')
    from public.workspace_members m join public.workspaces w on w.id = m.workspace_id
    join target t on t.id = m.user_id),
  'invitations_received', (select coalesce(jsonb_agg(jsonb_build_object(
      'workspace_id', i.workspace_id, 'role', i.role, 'created_at', i.created_at,
      'accepted_at', i.accepted_at, 'revoked_at', i.revoked_at, 'expires_at', i.expires_at)), '[]')
    from public.workspace_invitations i join target t on i.email = lower(t.email)),
  'invitations_sent', (select coalesce(jsonb_agg(jsonb_build_object(
      'workspace_id', i.workspace_id, 'email', i.email, 'role', i.role, 'created_at', i.created_at)), '[]')
    from public.workspace_invitations i join target t on t.id = i.invited_by),
  'reports_created', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', r.id, 'workspace_id', r.workspace_id, 'title', r.title, 'created_at', r.created_at)), '[]')
    from public.reports r join target t on t.id = r.created_by),
  'sections_assigned', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', s.id, 'report_id', s.report_id, 'title', s.title, 'status', s.status)), '[]')
    from public.report_sections s join target t on t.id = s.assigned_to),
  'deliverables_uploaded', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', d.id, 'section_id', d.section_id, 'file_name', d.file_name, 'storage_path', d.storage_path,
      'size_bytes', d.size_bytes, 'created_at', d.created_at)), '[]')
    from public.deliverables d join target t on t.id = d.uploaded_by),
  'ai_generations', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', g.id, 'section_id', g.section_id, 'created_at', g.created_at, 'model', g.model,
      'status', g.status, 'accepted', g.accepted, 'user_rating', g.user_rating,
      'feedback_comment', g.feedback_comment)), '[]')
    from public.ai_generations g join target t on t.id = g.requested_by),
  'template_writer_calls', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'workspace_id', c.workspace_id, 'created_at', c.created_at, 'model', c.model,
      'status', c.status)), '[]')
    from public.prompt_assist_calls c join target t on t.id = c.user_id),
  'report_exports', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'report_id', e.report_id, 'kind', e.kind, 'format', e.format,
      'file_name', e.file_name, 'created_at', e.created_at)), '[]')
    from public.report_exports e join target t on t.id = e.created_by),
  'plan_import_calls', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', c.id, 'workspace_id', c.workspace_id, 'report_id', c.report_id, 'created_at', c.created_at,
      'model', c.model, 'status', c.status)), '[]')
    from public.plan_import_calls c join target t on t.id = c.user_id),
  'status_changes', (select coalesce(jsonb_agg(jsonb_build_object(
      'report_id', ev.report_id, 'from', ev.from_status, 'to', ev.to_status, 'changed_at', ev.changed_at)), '[]')
    from public.report_status_events ev join target t on t.id = ev.changed_by),
  'notifications', (select coalesce(jsonb_agg(jsonb_build_object(
      'kind', n.kind, 'event_id', n.event_id, 'organization_id', n.organization_id,
      'entitlement_id', n.entitlement_id, 'billing_notice', n.billing_notice,
      'created_at', n.created_at, 'read_at', n.read_at)), '[]')
    from public.notifications n join target t on t.id = n.user_id),
  'prompt_versions_written', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', pl.id, 'workspace_id', pl.workspace_id, 'template_key', pl.template_key,
      'version', pl.version, 'title', pl.title, 'created_at', pl.created_at)), '[]')
    from public.prompt_library pl join target t on t.id = pl.created_by),
  'prompt_rollouts_started', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', ro.id, 'template_key', ro.template_key, 'created_at', ro.created_at)), '[]')
    from public.prompt_rollouts ro join target t on t.id = ro.created_by),
  'billing_purchases', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', bp.id, 'organization_id', bp.organization_id, 'workspace_id', bp.workspace_id,
      'offer', bp.offer, 'offer_label', bp.offer_label, 'quantity', bp.quantity,
      'amount_ht_xof', bp.amount_ht_xof, 'tax_xof', bp.tax_xof, 'amount_xof', bp.amount_xof,
      'currency', bp.currency, 'method', bp.method, 'status', bp.status,
      'merchant_reference', bp.merchant_reference, 'created_at', bp.created_at, 'paid_at', bp.paid_at,
      'receipt_numbers', (select coalesce(jsonb_agg(br.number order by br.number), '[]')
        from public.billing_receipts br where br.purchase_id = bp.id))), '[]')
    from public.billing_purchases bp join target t on t.id = bp.created_by)
)) as export;
```

To get a file instead of copying the result, save the query as `export-user.sql` and run it with psql and the `DIRECT_URL` of the environment (`.env.example` shows the format):

```bash
psql "$DIRECT_URL" -At -f export-user.sql > kolabreport-export.json
```

For CSV, one table at a time:

```bash
psql "$DIRECT_URL" -c "\copy (select * from public.profiles where id = '<user-id>') to 'profile.csv' with csv header"
```

The files they uploaded are listed under `deliverables_uploaded`. They are part of the firm's reports: send copies only with the firm's agreement. You download them from the `deliverables` bucket in the Supabase dashboard (Storage).

Send the export to the account's e-mail address, in an encrypted archive or through a link that expires. Delete your local copy once it is sent.

## Rectification

A person changes their name on `/fr/compte`: the app writes `profiles.full_name` and the Auth metadata. The app has no screen to change the e-mail address.

- **Name**, when they can't sign in: the app shows `profiles.full_name`. Change it there and in the Auth metadata, which still holds the name typed at sign-up:

  ```sql
  update public.profiles set full_name = 'Nouveau Nom' where id = '<user-id>';
  update auth.users
  set raw_user_meta_data = raw_user_meta_data || jsonb_build_object('full_name', 'Nouveau Nom')
  where id = '<user-id>';
  ```

- **E-mail**: change it with the Auth admin API from a trusted script with the service role key, for example `supabase.auth.admin.updateUserById('<user-id>', { email: 'new@example.com', email_confirm: true })`. Then update `profiles.email` yourself: the trigger that fills `profiles` only runs when the account is created.

  ```sql
  update public.profiles set email = lower('new@example.com') where id = '<user-id>';
  ```

- **Report content**: the firm corrects it in the app. If its members can't (a final report, for example), an owner reopens the report first.

## Erasure: deleting an account

A person deletes their own account on `/fr/compte` ([Self-service in the app](#self-service-in-the-app)). Follow these steps only when they can't sign in. The database applies the same rules on both paths (migration "account deletion", KRB-186).

### What deleting the account does

| Data | On delete of the account |
| --- | --- |
| `auth.users`, Supabase Auth's identities, sessions, MFA factors and one-time tokens | Deleted |
| `profiles` | Deleted (cascade from `auth.users`) |
| `workspace_members` of the person | Deleted. Their sections become unassigned (trigger `unassign_former_member`). |
| `workspace_members.invited_by` | Set to null |
| `workspace_invitations` they sent (open, used or revoked) | Kept with the workspace, `invited_by` set to null. An open one keeps working: the invitation page and e-mail name the workspace only. |
| `workspace_invitations.accepted_by` | Set to null |
| `workspace_invitations` sent **to** their e-mail | Deleted by `prepare_account_deletion` (step 3): they are linked by e-mail, not by id |
| `notifications` they received | Deleted |
| `report_sections.assigned_to` | Set to null |
| `ai_generations.requested_by` | Set to null. Drafts and ratings stay. `prepare_account_deletion` clears `feedback_comment`. |
| `prompt_assist_calls.user_id` | Set to null. The usage and cost of the calls stay with the workspace. |
| `workspaces.created_by`, `reports.created_by`, `deliverables.uploaded_by` | Set to null, rows kept with the workspace |
| `plan_import_calls.user_id` | Set to null. The usage and cost of the PDF plan readings stay with the workspace (KRB-196). |
| `prompt_library.created_by`, `prompt_rollouts.created_by`, `report_exports.created_by`, `report_status_events.changed_by` | Set to null, rows kept (they are the firm's records) |
| Storage objects they own (`storage.objects.owner`, `owner_id`) | Kept with the workspace. `prepare_account_deletion` sets the owner to null first. |
| `organizations.owner_id` | **Blocks the delete** (`on delete restrict`): transfer or delete the organization first |
| Being the only owner of a workspace, with or without other members | **Blocks the delete**: the trigger `guard_account_deletion` on `profiles` refuses it with `KR060`, from the app, the dashboard or SQL |
| `private.billing_trial_claims` (user id, SHA-256 of the e-mail) | Kept: no foreign key, so a new account with the same address gets no second trial (ADR 001) |
| Billing rows of the organization (entitlements, packs, draft usage, billing details, `private.billing_events`, purchases and receipts) | Kept: they belong to the organization. `billing_purchases.created_by` is set to null. |
| `private.account_deletion_attempts` | Deleted (cascade). The app's lock and limit on deletion tries. |
| `auth.audit_log_entries` (user id, name, e-mail, IP) | Kept: no foreign key. See step 6. |

### Step 1: check what blocks the delete

```sql
select * from private.account_deletion_blockers('<user-id>');
```

No row: go to step 3. Otherwise each row says what to do:

| `kind` | Meaning | Way out |
| --- | --- | --- |
| `organization_owner` | They own the organization. `successors` counts the owners of its workspaces who can take it over. | Transfer it (step 2), or its owner deletes it in the app ([Deleting a workspace or an organization](#deleting-a-workspace-or-an-organization)) |
| `only_owner` | They are the only owner of a workspace that has `other_members` other members | Name another owner (step 2), or an owner of the workspace or of its organization deletes the workspace |
| `only_member` | They are the only member of a workspace | They delete the workspace, or the organization owner does |

### Step 2: hand over each workspace and organization

For each workspace in step 1, ask the firm who takes over (`<successor-id>`, a member of that workspace). If the firm wants the workspace gone instead, an owner deletes it in the app ([Deleting a workspace or an organization](#deleting-a-workspace-or-an-organization)); skip this step for it.

1. Make the successor an owner. In the app, an owner does it on the workspace's members page. If the leaving person is the only owner and can't do it, run:

   ```sql
   update public.workspace_members set role = 'owner'
   where workspace_id = '<workspace-id>' and user_id = '<successor-id>';
   ```

2. If they own the organization, hand it to an owner of one of its workspaces. In the app, the owner does it on `/fr/compte`, which also writes the billing log and the audit log. By hand, write all three. If the firm wants the organization and all its workspaces gone, its owner deletes it in the app instead, from `/fr/organisations/<organization-id>`. Never delete an organization only to free the account: it deletes all its workspaces.

   ```sql
   update public.organizations set owner_id = '<successor-id>'
   where id = '<organization-id>' and owner_id = '<user-id>';

   insert into private.billing_events (organization_id, kind, actor, details)
   values ('<organization-id>', 'owner_transferred', '<your name>',
     jsonb_build_object('previous_owner_id', '<user-id>', 'new_owner_id', '<successor-id>'));

   insert into private.audit_events (action, organization_id, details)
   values ('organization_transferred', '<organization-id>',
     jsonb_build_object('previous_owner_id', '<user-id>', 'new_owner_id', '<successor-id>', 'by', 'operator'));
   ```

Run the step 1 query again. It must return no row.

### Step 3: clear what would survive the delete

```sql
select public.prepare_account_deletion('<user-id>');
```

It sets the owner of their Storage objects to null, clears their `feedback_comment` on AI drafts, deletes the invitations sent to their address and their notifications, and returns how many rows each step touched. While step 1 still returns a row, it refuses with `KR060` and changes nothing.

### Step 4: delete the account

In the Supabase dashboard, open **Authentication > Users**, find the person and choose **Delete user**. From a script, `supabase.auth.admin.deleteUser('<user-id>')` with the service role key does the same.

If the delete fails ("Database error deleting user"), something blocks it again, for example another owner left a workspace in the meantime: run step 1 again.

Supabase's documentation notes that deleting a user does not sign them out: their access token stays valid until it expires (`jwt_expiry`, 3,600 s in `supabase/config.toml`). The app checks every request with `getUser()`, which fails once the user is gone, and RLS checks memberships, which are gone too.

### Step 5: check

```sql
select
  (select count(*) from auth.users where id = '<user-id>') as account,
  (select count(*) from public.profiles where id = '<user-id>') as profile,
  (select count(*) from public.workspace_members where user_id = '<user-id>') as memberships,
  (select count(*) from public.notifications where user_id = '<user-id>') as notifications,
  (select count(*) from public.workspace_invitations where email = lower('person@example.com')) as invitations,
  (select count(*) from storage.objects where owner_id = '<user-id>') as storage_objects;
```

Every column must be 0.

### Step 6: outside the tables

The app's deletion stops at the database as well: an operator does these steps in both cases.

- **Auth audit log**: `auth.audit_log_entries` keeps sign-in events with the user id, name and e-mail. How long to keep it is **to decide** ([`retention.md`](retention.md)). If the decision is to remove it on erasure:

  ```sql
  delete from auth.audit_log_entries where payload->>'actor_id' = '<user-id>';
  ```

- **E-mail provider**: look for their address in the provider's logs or contacts and delete it where the provider allows.
- **LLM provider and traces**: the app sends no user id, name or e-mail to the LLM provider or to the traces, so there is nothing to look up there.
- **Backups**: they expire on their own schedule. Keep the request in the log so the erasure can be applied again after a restore ([step 7](#step-7-after-a-backup-restore)).
- **Trial claim**: kept on purpose and with no time limit, see the table above.
- Answer the person, at the address they used, once it is done.

### Step 7: after a backup restore

A restore brings back every account deleted after the backup was taken, and it rolls back every table too, so the list of those accounts is kept outside the database:

- each deletion made in the app sends an e-mail to `ACCOUNT_DELETION_LOG_EMAIL` with the account id, the date and the environment, never the e-mail address or the name (`src/lib/account/deletion-record.ts`);
- each deletion made by hand is in the request log ([Before you start](#before-you-start)).

The mailbox keeps these e-mails 35 days ([`retention.md`](retention.md)), longer than any backup.

After restoring a backup taken at time T, on the restored environment:

1. List the ids e-mailed to `ACCOUNT_DELETION_LOG_EMAIL` after T, subject `[KolabReport <environment>] Compte supprimé <id>`, and the deletions of the request log after T.
2. For each id, run [step 1](#step-1-check-what-blocks-the-delete) to [step 5](#step-5-check). The person may have transferred an organization or named an owner before deleting: that is in the backup only if it happened before T, so step 2 may be needed again.
3. Write in the request log that the erasures were applied again, with the date of the restore.

If the setting was empty, the app logged `ACCOUNT_DELETION_LOG_EMAIL is not set` once per server instance and sent nothing: look for `account: deleted` lines in the server logs instead, while Vercel still keeps them.

## Deleting a workspace or an organization

Since KRB-180 the firm does it in the app; who can delete what is in [`docs/security/deletions.md`](../security/deletions.md).

- A workspace: an owner opens **Paramètres de l'espace** in the workspace menu (`/fr/espaces/<workspace-id>/parametres`), then **Supprimer l'espace de travail**, and types its name. The organization owner can also delete it from the organization page, with **Supprimer** next to it, even without being a member.
- An organization with all its workspaces: its owner (`organizations.owner_id`) opens **Gérer l'organisation** in the workspace menu (`/fr/organisations/<organization-id>`), then **Supprimer l'organisation**, and types its name. The dialog lists every workspace that goes and the plan, passes and Pack IA credits that are lost.
- A report: an owner or admin opens it, then **Supprimer le rapport** at the bottom. A final report needs an owner and its title.

Each deletion queues the stored files of what goes in the cleanup queue, and the daily job (KRB-166) removes them. It is recorded in `private.audit_events`. Payments and receipts stay, detached from the organization ([`retention.md`](retention.md)). Member accounts stay too: each person decides about their own account, and can delete it on `/fr/compte`.

When the firm asks KolabReport instead (the customer DPA says whether KolabReport deletes or returns the data, **to confirm**), first ask an owner to do it in the app, after exporting what they want to keep. Owners and admins export each report as `.docx` or PDF, and download the files from each section.

### When no owner can do it

Only when the workspace has no owner who can sign in, or the organization owner's account is gone, an operator deletes on the firm's written request:

1. List the stored files before deleting anything. Both buckets start their paths with the workspace id:

   ```sql
   select bucket_id, name, created_at
   from storage.objects
   where bucket_id in ('deliverables', 'exports')
     and name like '<workspace-id>' || '/%';
   ```

2. Delete the workspace as `postgres`, which still may. The cascade removes its members, invitations, reports, sections, deliverable rows, AI generations, exports rows, status history, notifications, prompt templates and rollouts, and queues the files of the deliverable and export rows. The draft ledger of the organization stays.

   ```sql
   delete from public.workspaces where id = '<workspace-id>';
   ```

3. Delete the files from step 1 that no row recorded: in the Supabase dashboard, open **Storage**, then each bucket, select the folder named after the workspace id and delete it. The Storage API with the service role works too. Don't delete rows from `storage.objects` with SQL: that removes the record and leaves the file in the underlying store.
4. Delete the organization if it has no workspace left. Payments and receipts keep their rows with `organization_id` set to null.

   ```sql
   delete from public.organizations o
   where o.id = '<organization-id>'
     and not exists (select 1 from public.workspaces w where w.organization_id = o.id);
   ```

5. Log it in the request log: these SQL deletions write no event to `private.audit_events`.

## Requests about report content

A person named in a firm's report or files asks the firm, not KolabReport. When a firm asks KolabReport for help with such a request, act only on its written instructions and only inside its workspace. To find where a name appears:

```sql
select r.workspace_id, r.id as report_id, r.title as report, s.id as section_id, s.title as section
from public.report_sections s
join public.reports r on r.id = s.report_id
where r.workspace_id = '<workspace-id>'
  and (s.content ilike '%' || 'Name' || '%'
    or s.instructions ilike '%' || 'Name' || '%'
    or r.description ilike '%' || 'Name' || '%');

select d.section_id, d.id as deliverable_id, d.file_name
from public.deliverables d
where d.workspace_id = '<workspace-id>'
  and (d.parsed_content ilike '%' || 'Name' || '%' or d.file_name ilike '%' || 'Name' || '%');
```

Files that are not read (PowerPoint, images, diagrams, PDFs without text or locked by a password, and PDFs uploaded before KRB-214 that nobody clicked "Analyser" on) have no extracted text, so this search can't see inside them. The firm edits or deletes the content in the app. AI generations of a section keep their draft text after the section changes, and lose it when the section goes ([`retention.md`](retention.md)). If the firm asks about a section that still exists, clear `output` and `raw_output` on its generations.

## Self-service in the app

`/fr/compte` (KRB-186), linked as "Mon compte" in the account menu, at the top right of the app. Every action works on the user of the session (`getUser()`), never on an id from the form or the URL.

- **Change my name**: writes `profiles.full_name` with the user's client, then the `full_name` of the Auth metadata.
- **Download my data**: `GET /api/account/export` answers with the JSON of [Access and export](#access-and-export), as an attachment that is never cached (`Cache-Control: private, no-store`). The user's client reads what RLS lets them read: profile, sessions (through `my_account_sessions()`), owned organizations, memberships, assigned sections and notifications. The service role reads the rows that name the person but that RLS may hide, such as a report they created in a workspace they left, an invitation sent to their address, or a purchase they made (`billing_purchases.created_by`, with the numbers of its receipts and none of the FedaPay details). Each of those queries is filtered on the session's user id or e-mail. The file never holds the text of reports, sections, files or drafts.
- **Transfer an organization**: shown for each organization the user owns. `transfer_organization(org, new_owner)` accepts only the current owner as caller and an owner of one of the organization's workspaces as the new owner (`KR061` otherwise). It writes `owner_transferred` to `private.billing_events` and `organization_transferred` to the audit log of KRB-180, `private.audit_events`. The new owner can then delete the organization or any of its workspaces (KRB-180), and the dialog says so before the transfer. The billing functions read `owner_id` when they run, so the new owner gets the organization's billing rights at once. The billing details (`organization_billing`) and the trial claim don't change.
- **Delete my account**: the invitations the person sent stay with their workspace, with no inviter. `my_account_deletion_blockers()` lists what blocks it, with links to the transfer above, to the members page of the workspace, and to the deletion of a workspace or an organization (KRB-180). When nothing blocks, the person types the account's e-mail address and their current password. The server checks the password with a sign-in of its own, then runs step 3 (`prepare_account_deletion`) and step 4 (`auth.admin.deleteUser`) with the service role, signs the browser out and shows `/fr/compte-supprime`.
- **One deletion at a time**: `claim_account_deletion()` refuses a second deletion while one runs (2 minutes at most), and more than 5 tries in 15 minutes. A double click runs the deletion once, and the password check can't be used to guess passwords. A try that stops (wrong password, a blocker) releases the lock but still counts.
- **Logs**: `account: deleted`, `account: deletion refused, ...`, `account: organization transferred` and `account: data exported`, with the user id and counts. Never the e-mail address or the password.
- **Record for a restore**: each deletion e-mails the account id and the date to `ACCOUNT_DELETION_LOG_EMAIL` ([step 7](#step-7-after-a-backup-restore)). A failed or missing e-mail is logged and never stops the deletion.

What still needs an operator: [step 6](#step-6-outside-the-tables), [step 7](#step-7-after-a-backup-restore) after a restore, a change of e-mail address, and anyone who can't sign in.
