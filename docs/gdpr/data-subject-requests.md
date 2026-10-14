# Data subject requests

Operator runbook for a request to access, export, correct or delete personal data. **The app has no self-service export or account deletion yet**: an operator answers each request by hand with the steps below. A proposal for the self-service version is at the [end of this page](#follow-up-self-service-export-and-deletion).

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

This query returns one JSON document with the account and everything that links to the person: profile, sessions, memberships, invitations, and the records they created or that point at them. It leaves out the text of sections and AI drafts, which is the firm's content: add it only with the firm's agreement, or let the firm export its reports from the app.

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
  'report_exports', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', e.id, 'report_id', e.report_id, 'kind', e.kind, 'format', e.format,
      'file_name', e.file_name, 'created_at', e.created_at)), '[]')
    from public.report_exports e join target t on t.id = e.created_by),
  'status_changes', (select coalesce(jsonb_agg(jsonb_build_object(
      'report_id', ev.report_id, 'from', ev.from_status, 'to', ev.to_status, 'changed_at', ev.changed_at)), '[]')
    from public.report_status_events ev join target t on t.id = ev.changed_by),
  'notifications', (select coalesce(jsonb_agg(jsonb_build_object(
      'event_id', n.event_id, 'created_at', n.created_at, 'read_at', n.read_at)), '[]')
    from public.notifications n join target t on t.id = n.user_id),
  'prompt_versions_written', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', pl.id, 'workspace_id', pl.workspace_id, 'template_key', pl.template_key,
      'version', pl.version, 'title', pl.title, 'created_at', pl.created_at)), '[]')
    from public.prompt_library pl join target t on t.id = pl.created_by),
  'prompt_rollouts_started', (select coalesce(jsonb_agg(jsonb_build_object(
      'id', ro.id, 'template_key', ro.template_key, 'created_at', ro.created_at)), '[]')
    from public.prompt_rollouts ro join target t on t.id = ro.created_by)
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

The app has no screen to edit a profile yet.

- **Name**: the app shows `profiles.full_name`. Change it there and in the Auth metadata, which still holds the name typed at sign-up:

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

Deleting the Auth user deletes the profile, and the foreign keys then decide what happens to everything that points at it. Some rows block the delete until they are handed over. Others survive it and have to be cleared first.

### What deleting the account does

| Data | On delete of the account |
| --- | --- |
| `auth.users`, Supabase Auth's identities, sessions, MFA factors and one-time tokens | Deleted |
| `profiles` | Deleted (cascade from `auth.users`) |
| `workspace_members` of the person | Deleted. Their sections become unassigned (trigger `unassign_former_member`). |
| `workspace_members.invited_by` | Set to null |
| `workspace_invitations` they sent (open, used or revoked) | Deleted |
| `workspace_invitations.accepted_by` | Set to null |
| `workspace_invitations` sent **to** their e-mail | Kept: linked by e-mail, not by id. Delete them in step 3. |
| `notifications` they received | Deleted |
| `report_sections.assigned_to` | Set to null |
| `ai_generations.requested_by` | Set to null. Drafts, ratings and `feedback_comment` stay: clear the comment in step 3. |
| `prompt_library.created_by`, `prompt_rollouts.created_by`, `report_exports.created_by`, `report_status_events.changed_by` | Set to null, rows kept (they are the firm's records) |
| `organizations.owner_id` | **Blocks the delete** (`on delete restrict`) |
| `workspaces.created_by`, `reports.created_by`, `deliverables.uploaded_by` | **Block the delete** (no `on delete` action, columns not nullable) |
| Storage objects they own (`storage.objects.owner_id`) | **Block the delete**: Supabase refuses to delete an Auth user who owns Storage objects |
| `auth.audit_log_entries` (user id, name, e-mail, IP) | Kept: no foreign key. See step 6. |

One more case doesn't block anything but has to be handled first: the last-owner guard (`guard_last_owner` in `20261013150000_workspace_rbac.sql`) stops the app from removing a workspace's last owner, but it lets the cascade from a deleted profile through on purpose. Deleting the account of a workspace's only owner would leave a workspace that nobody can manage.

### Step 1: check what needs handling

```sql
with target as (select '<user-id>'::uuid as id)
select 'organizations owned (blocks the delete)' as item, count(*)
from public.organizations o join target t on t.id = o.owner_id
union all
select 'workspaces created (blocks the delete)', count(*)
from public.workspaces w join target t on t.id = w.created_by
union all
select 'reports created (blocks the delete)', count(*)
from public.reports r join target t on t.id = r.created_by
union all
select 'deliverables uploaded (blocks the delete)', count(*)
from public.deliverables d join target t on t.id = d.uploaded_by
union all
select 'storage objects owned (blocks the delete)', count(*)
from storage.objects so join target t on so.owner_id = t.id::text
union all
select 'workspaces where they are the only owner', count(*)
from public.workspace_members m join target t on t.id = m.user_id
where m.role = 'owner'
  and not exists (
    select 1 from public.workspace_members o
    where o.workspace_id = m.workspace_id and o.role = 'owner' and o.user_id <> m.user_id
  );
```

If every count is 0, go to step 3.

### Step 2: hand over each workspace

For each workspace in the list from [Find the person](#find-the-person), ask the firm who takes over (`<successor-id>`, a member of that workspace). If the firm wants the workspace gone instead, follow [Deleting a workspace](#deleting-a-workspace) and skip this step for it.

1. Make the successor an owner. In the app, an owner does it on the workspace's members page. If the leaving person is the only owner and can't do it, run:

   ```sql
   update public.workspace_members set role = 'owner'
   where workspace_id = '<workspace-id>' and user_id = '<successor-id>';
   ```

2. Move the records that block the delete to the successor, workspace by workspace. The app will then show the successor as the creator of these reports and the uploader of these files. A migration that lets these columns be null would remove this step (see the follow-up below).

   ```sql
   update public.workspaces set created_by = '<successor-id>'
   where id = '<workspace-id>' and created_by = '<user-id>';

   update public.reports set created_by = '<successor-id>'
   where workspace_id = '<workspace-id>' and created_by = '<user-id>';

   update public.deliverables set uploaded_by = '<successor-id>'
   where workspace_id = '<workspace-id>' and uploaded_by = '<user-id>';

   -- The stored files of that workspace. This changes ownership metadata only.
   update storage.objects set owner = '<successor-id>', owner_id = '<successor-id>'
   where owner_id = '<user-id>' and name like '<workspace-id>' || '/%';
   ```

3. If they own the organization, move it too. Don't delete an organization to get rid of it: deleting an organization deletes all its workspaces.

   ```sql
   update public.organizations set owner_id = '<successor-id>'
   where id = '<organization-id>' and owner_id = '<user-id>';
   ```

Run the step 1 query again. Every count must be 0.

### Step 3: clear what would survive the delete

```sql
-- Free text they wrote about AI drafts. Ratings stay, without a name.
update public.ai_generations set feedback_comment = null
where requested_by = '<user-id>' and feedback_comment is not null;

-- Invitations sent to their address, in any workspace.
delete from public.workspace_invitations where email = lower('person@example.com');
```

### Step 4: delete the account

In the Supabase dashboard, open **Authentication > Users**, find the person and choose **Delete user**. From a script, `supabase.auth.admin.deleteUser('<user-id>')` with the service role key does the same.

If the delete fails on a foreign key, a row from step 1 was missed: run step 1 again.

Supabase's documentation notes that deleting a user does not sign them out: their access token stays valid until it expires (`jwt_expiry`, 3,600 s in `supabase/config.toml`). They can't read workspace data in the meantime, because RLS checks memberships and those are gone.

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

- **Auth audit log**: `auth.audit_log_entries` keeps sign-in events with the user id, name and e-mail. How long to keep it is **to decide** ([`retention.md`](retention.md)). If the decision is to remove it on erasure:

  ```sql
  delete from auth.audit_log_entries where payload->>'actor_id' = '<user-id>';
  ```

- **E-mail provider**: look for their address in the provider's logs or contacts and delete it where the provider allows.
- **LLM provider and traces**: the app sends no user id, name or e-mail to the LLM provider or to the traces, so there is nothing to look up there.
- **Backups**: they expire on their own schedule. Keep the request in the log so the erasure can be applied again after a restore.
- Answer the person, at the address they used, once it is done.

## Deleting a workspace

When a firm leaves, or asks for its data to go, the customer DPA should say whether KolabReport deletes or returns the data (**to confirm**). The app has no screen for this.

1. Get the request in writing from an owner of the workspace. Offer the export first: owners and admins can export each report as `.docx` or PDF from the app, and download the files from each section.
2. List the stored files before deleting anything. Both buckets start their paths with the workspace id:

   ```sql
   select bucket_id, name, created_at
   from storage.objects
   where bucket_id in ('deliverables', 'exports')
     and name like '<workspace-id>' || '/%';
   ```

3. Delete the workspace. The cascade removes its members, invitations, reports, sections, deliverable rows, AI generations, exports rows, status history, notifications, prompt templates and rollouts.

   ```sql
   delete from public.workspaces where id = '<workspace-id>';
   ```

4. Delete the files from step 2: in the Supabase dashboard, open **Storage**, then each bucket, select the folder named after the workspace id and delete it. The Storage API with the service role works too. Don't delete rows from `storage.objects` with SQL: that removes the record and leaves the file in the underlying store. Deleting the workspace also queued these files, and the daily cleanup job (KRB-166) removes them on its next run, so this step only makes it immediate.
5. Delete the organization if it has no workspace left:

   ```sql
   delete from public.organizations o
   where o.id = '<organization-id>'
     and not exists (select 1 from public.workspaces w where w.organization_id = o.id);
   ```

6. Member accounts stay. Each person decides about their own account: tell them they can ask for its deletion.

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

Files that are not read (PDF, PowerPoint, images, diagrams) have no extracted text, so this search can't see inside them. The firm edits or deletes the content in the app. AI generations of a section keep their draft text after the section changes or goes ([`retention.md`](retention.md)): if the firm asks, clear `output` and `raw_output` on the generations of that section.

## Follow-up: self-service export and deletion

Proposed as a new story, not built:

- A "Mes données" page in the account area, in French, with three actions:
  - download my data: a server route that builds the JSON above with the service role, scoped to the signed-in user;
  - change my name;
  - delete my account: refused while the person is the only owner of a workspace, with a link to the members page to name another owner first. It then clears `feedback_comment` and the invitations sent to their address, and calls `auth.admin.deleteUser`.
- A migration that makes `workspaces.created_by`, `reports.created_by` and `deliverables.uploaded_by` nullable with `on delete set null`, so a deletion needs no handover of these rows. `organizations.owner_id` still needs a handover, since it decides who can create workspaces.
- Storage objects owned by the person block the delete. The deletion route sets `owner` and `owner_id` to null on those objects first.
- An e2e test of the deletion, with a pgTAP test of the cascades.
