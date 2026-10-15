-- =============================================================================
-- KolabReport: delete a report, a workspace or an organization (KRB-180)
--
-- * delete_report, delete_workspace and delete_organization are the only way
--   a signed-in user deletes these rows. The DELETE privilege on reports,
--   workspaces and organizations is revoked from authenticated, and the
--   delete policies of reports and workspaces go, so every deletion is
--   checked, locked and recorded the same way.
-- * Each function checks the caller's rights itself, takes its locks, queues
--   the stored files of what goes in private.storage_cleanup_queue
--   (KRB-166), deletes the row (the foreign keys take the rest), and writes
--   an event to private.audit_events. All in one transaction.
-- * Rights:
--     report, not final  owners and admins of its workspace
--     report, final      owners of its workspace, who type its title
--     workspace          owners of the workspace, who type its name
--     organization       its owner (organizations.owner_id), who types its
--                        name. Every workspace of the organization goes,
--                        including the ones the owner is not a member of.
-- * Locks: the draft lock of each workspace concerned, the one
--   start_ai_generation takes, then for a workspace or an organization the
--   billing lock of the organization (always the last advisory lock), then
--   the rows. A draft that starts in what is being deleted waits for the
--   deletion and then fails, or finishes first and goes with it. Uploads and
--   exports are covered by the foreign keys and by the upload window of the
--   cleanup queue.
-- * Billing: an organization is deleted for good, not archived. Its buyer
--   row, entitlements, Pack IA credits and draft ledger go with it.
--   Payments and receipts (KRB-176) are kept by their own foreign keys
--   (organization_id set to null, the receipt keeps a copy of the buyer),
--   and so are private.billing_events and the trial claims, which have no
--   foreign key: a new organization of the same person gets no new trial.
--   Deleting a workspace keeps the draft ledger of its organization
--   (workspace_id set to null) and takes the Pass Mission entitlements of a
--   mission workspace.
-- * Read-only does not block a deletion: nothing here reads the billing
--   state, except the previews, which show what time is lost.
-- * The previews list what a deletion takes, for the confirmation dialogs.
--
-- Error codes:
--   42501  signed out, or not allowed to delete it
--   P0002  not found, or not visible to the caller
--   KR070  the typed title or name does not match
--   40001  a workspace was added to the organization meanwhile: try again
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Audit log of deletions
-- -----------------------------------------------------------------------------
-- No foreign keys: the log outlives what it is about, and the account of the
-- person who deleted it. Ids, counts and dates only, never a title, a name
-- or an e-mail. Read by operators with SQL; nobody signed in reads it.
create table if not exists private.audit_events (
  id               bigint generated always as identity primary key,
  action           text not null check (action in ('report_deleted', 'workspace_deleted', 'organization_deleted')),
  actor_id         uuid,
  organization_id  uuid,
  workspace_id     uuid,
  report_id        uuid,
  details          jsonb not null default '{}' check (jsonb_typeof(details) = 'object'),
  created_at       timestamptz not null default now()
);

comment on table private.audit_events is
  'Deletions of reports, workspaces and organizations, with who and what (KRB-180). Written by the delete functions only.';

create index if not exists audit_events_org_idx on private.audit_events (organization_id, created_at desc);
create index if not exists audit_events_workspace_idx on private.audit_events (workspace_id, created_at desc);
create index if not exists audit_events_actor_idx on private.audit_events (actor_id, created_at desc);

alter table private.audit_events enable row level security;
revoke all on private.audit_events from public, anon, authenticated, service_role;

-- -----------------------------------------------------------------------------
-- Deletes go through the functions below only
-- -----------------------------------------------------------------------------
drop policy if exists "reports: managers delete, owners when final" on public.reports;
drop policy if exists "workspaces: owner deletes" on public.workspaces;
revoke delete on public.reports, public.workspaces, public.organizations from authenticated;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
-- The typed title or name matches: same text once the spaces around it are
-- trimmed, accents compared in one Unicode form. Case counts.
create or replace function private.confirmation_matches(p_typed text, p_expected text)
returns boolean
language sql
immutable
set search_path = ''
as $$
  select nullif(regexp_replace(coalesce(p_typed, ''), '^\s+|\s+$', '', 'g'), '') is not null
    and normalize(regexp_replace(coalesce(p_typed, ''), '^\s+|\s+$', '', 'g'), nfc)
      = normalize(regexp_replace(coalesce(p_expected, ''), '^\s+|\s+$', '', 'g'), nfc);
$$;

-- What a report holds. Files are the deliverables sent; exports the ones
-- stored, final snapshots included.
create or replace function private.report_contents(p_report_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'sections', (select count(*) from public.report_sections s where s.report_id = p_report_id),
    'files', (
      select count(*)
      from public.deliverables d
      join public.report_sections s on s.id = d.section_id
      where s.report_id = p_report_id and d.uploaded_at is not null
    ),
    'exports', (
      select count(*) from public.report_exports e
      where e.report_id = p_report_id and e.storage_path is not null
    )
  );
$$;

-- What a workspace holds.
create or replace function private.workspace_contents(p_workspace_id uuid)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'reports', (select count(*) from public.reports r where r.workspace_id = p_workspace_id),
    'final_reports', (
      select count(*) from public.reports r where r.workspace_id = p_workspace_id and r.status = 'final'
    ),
    'sections', (select count(*) from public.report_sections s where s.workspace_id = p_workspace_id),
    'files', (
      select count(*) from public.deliverables d
      where d.workspace_id = p_workspace_id and d.uploaded_at is not null
    ),
    'exports', (
      select count(*) from public.report_exports e
      where e.workspace_id = p_workspace_id and e.storage_path is not null
    ),
    'members', (select count(*) from public.workspace_members m where m.workspace_id = p_workspace_id),
    'invitations', (
      select count(*) from public.workspace_invitations i
      where i.workspace_id = p_workspace_id
        and i.accepted_at is null and i.revoked_at is null and i.expires_at > now()
    ),
    'templates', (
      select count(distinct p.template_key) from public.prompt_library p where p.workspace_id = p_workspace_id
    )
  );
$$;

-- Billing time an organization loses when it goes: subscription periods and
-- passes not revoked that have not ended (a period paid in advance starts
-- later), and Pack IA credits with drafts left. Read from the rows, not
-- through private.billing_access, which shows every line as active with no
-- plan while billing is not enforced. p_workspace_id limits it to the passes
-- of one workspace.
create or replace function private.billing_time_left(p_organization_id uuid, p_workspace_id uuid default null)
returns jsonb
language sql
stable
security definer
set search_path = ''
as $$
  select jsonb_build_object(
    'subscription', case when p_workspace_id is null then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'entitlement_id', e.id,
        'plan', e.plan,
        'source', e.source,
        'starts_at', e.starts_at,
        'ends_at', e.ends_at
      ) order by e.starts_at, e.id), '[]'::jsonb)
      from public.billing_entitlements e
      where e.organization_id = p_organization_id
        and e.scope = 'subscription'
        and e.revoked_at is null
        and e.ends_at > now()
    ) else '[]'::jsonb end,
    'passes', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'entitlement_id', e.id,
        'workspace_id', e.workspace_id,
        'starts_at', e.starts_at,
        'ends_at', e.ends_at
      ) order by e.starts_at, e.id), '[]'::jsonb)
      from public.billing_entitlements e
      where e.organization_id = p_organization_id
        and e.scope = 'mission'
        and (p_workspace_id is null or e.workspace_id = p_workspace_id)
        and e.revoked_at is null
        and e.ends_at > now()
    ),
    'packs', case when p_workspace_id is null then (
      select coalesce(jsonb_agg(jsonb_build_object(
        'pack_id', p.pack_id,
        'drafts_left', p.drafts_left,
        'expires_at', p.expires_at
      ) order by p.expires_at, p.pack_id), '[]'::jsonb)
      from (
        select k.id as pack_id, k.expires_at,
          k.drafts - (
            -- Same count as private.billing_reserve_draft.
            select count(*)::integer
            from public.billing_draft_usage d
            where d.pack_id = k.id
              and (d.status = 'counted' or (d.status = 'reserved' and d.created_at > now() - interval '10 minutes'))
          ) as drafts_left
        from public.billing_ai_packs k
        where k.organization_id = p_organization_id
          and k.revoked_at is null
          and k.expires_at > now()
      ) p
      where p.drafts_left > 0
    ) else '[]'::jsonb end
  );
$$;

-- Queues the stored files of a workspace, or of one report of it, before
-- their rows go: the deliverables and exports the rows point at, and every
-- object under their folders, such as an export stored by a request that
-- died before recording it. The delete triggers of the cleanup migration
-- queue the files of the rows again during the delete, which changes
-- nothing. Same path shape and upload window as private.queue_storage_cleanup.
-- Returns how many paths are queued.
create or replace function private.queue_scope_files(p_workspace_id uuid, p_report_id uuid default null)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_queued integer;
begin
  with sections as (
    select s.id
    from public.report_sections s
    where s.workspace_id = p_workspace_id
      and (p_report_id is null or s.report_id = p_report_id)
  ), files as (
    -- A signed upload link works 2 hours after its row was made.
    select 'deliverables'::text as bucket, d.storage_path as path,
      greatest(now(), d.created_at + interval '2 hours 15 minutes') as not_before
    from public.deliverables d
    where d.workspace_id = p_workspace_id
      and (p_report_id is null or d.section_id in (select s.id from sections s))
    union all
    select 'exports', e.storage_path, now()
    from public.report_exports e
    where e.workspace_id = p_workspace_id
      and (p_report_id is null or e.report_id = p_report_id)
      and e.storage_path is not null
    union all
    select o.bucket_id, o.name, now()
    from storage.objects o
    where o.bucket_id = 'deliverables'
      and o.name like p_workspace_id::text || '/%'
      and (p_report_id is null or split_part(o.name, '/', 2) in (select s.id::text from sections s))
    union all
    select o.bucket_id, o.name, now()
    from storage.objects o
    where o.bucket_id = 'exports'
      and o.name like p_workspace_id::text || '/' || coalesce(p_report_id::text || '/', '') || '%'
  )
  insert into private.storage_cleanup_queue as q (bucket, path, not_before)
  select f.bucket, f.path, max(f.not_before)
  from files f
  where f.path ~ '^[0-9a-f-]{36}/[0-9a-f-]{36}/[^/.][^/]*$'
  group by f.bucket, f.path
  on conflict (bucket, path) do update
    set not_before = greatest(q.not_before, excluded.not_before);
  get diagnostics v_queued = row_count;
  return v_queued;
end;
$$;

-- The draft lock of start_ai_generation for one workspace.
create or replace function private.lock_workspace_drafts(p_workspace_id uuid)
returns void
language sql
security definer
set search_path = ''
as $$
  select pg_advisory_xact_lock(hashtextextended('ai_generations/workspace/' || p_workspace_id::text, 0));
$$;

-- -----------------------------------------------------------------------------
-- Previews for the confirmation dialogs
-- -----------------------------------------------------------------------------
-- What deleting a report takes, for the owners and admins of its workspace.
-- Null for anyone else.
create or replace function public.report_deletion_preview(p_report_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_report public.reports;
begin
  select r.* into v_report from public.reports r where r.id = p_report_id;
  if not found
     or not private.has_workspace_role(v_report.workspace_id, array['owner', 'admin']::public.workspace_role[]) then
    return null;
  end if;
  return jsonb_build_object(
    'report_id', v_report.id,
    'workspace_id', v_report.workspace_id,
    'title', v_report.title,
    'status', v_report.status
  ) || private.report_contents(v_report.id);
end;
$$;

-- What deleting a workspace takes, and the passes it loses, for its owners.
-- Null for anyone else.
create or replace function public.workspace_deletion_preview(p_workspace_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_workspace public.workspaces;
  v_org public.organizations;
begin
  select w.* into v_workspace from public.workspaces w where w.id = p_workspace_id;
  if not found or not private.has_workspace_role(v_workspace.id, array['owner']::public.workspace_role[]) then
    return null;
  end if;
  select o.* into v_org from public.organizations o where o.id = v_workspace.organization_id;
  return jsonb_build_object(
    'workspace_id', v_workspace.id,
    'name', v_workspace.name,
    'organization_id', v_org.id,
    'organization_name', v_org.name,
    'billing_mode', v_workspace.billing_mode,
    'passes', private.billing_time_left(v_org.id, v_workspace.id) -> 'passes'
  ) || private.workspace_contents(v_workspace.id);
end;
$$;

-- What deleting an organization takes, for its owner: every workspace, by
-- name, including the ones the owner is not a member of, the billing time it
-- loses, and how many receipts stay without it (nobody signed in reads them
-- after the deletion). Null for anyone else.
create or replace function public.organization_deletion_preview(p_organization_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = ''
as $$
declare
  v_org public.organizations;
  v_workspaces jsonb;
  v_totals jsonb;
begin
  select o.* into v_org from public.organizations o where o.id = p_organization_id;
  if not found or v_org.owner_id is distinct from (select auth.uid()) then
    return null;
  end if;

  select coalesce(jsonb_agg(jsonb_build_object(
    'workspace_id', w.id,
    'name', w.name,
    'billing_mode', w.billing_mode,
    'reports', (select count(*) from public.reports r where r.workspace_id = w.id),
    'members', (select count(*) from public.workspace_members m where m.workspace_id = w.id)
  ) order by w.name, w.id), '[]'::jsonb)
  into v_workspaces
  from public.workspaces w
  where w.organization_id = v_org.id;

  select jsonb_build_object(
    'reports', (
      select count(*) from public.reports r
      join public.workspaces w on w.id = r.workspace_id
      where w.organization_id = v_org.id
    ),
    'files', (
      select count(*) from public.deliverables d
      join public.workspaces w on w.id = d.workspace_id
      where w.organization_id = v_org.id and d.uploaded_at is not null
    ),
    'members', (
      select count(distinct m.user_id) from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
      where w.organization_id = v_org.id
    ),
    'receipts', (select count(*) from public.billing_receipts r where r.organization_id = v_org.id)
  ) into v_totals;

  return jsonb_build_object(
    'organization_id', v_org.id,
    'name', v_org.name,
    'workspaces', v_workspaces,
    'billing', private.billing_time_left(v_org.id)
  ) || v_totals;
end;
$$;

-- -----------------------------------------------------------------------------
-- Deleting a report
-- -----------------------------------------------------------------------------
-- Owners and admins delete a report that is not final. A final report needs
-- an owner, and p_confirmation must be its title. Returns what went.
create or replace function public.delete_report(p_report_id uuid, p_confirmation text default null)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor    uuid := (select auth.uid());
  v_report   public.reports;
  v_org      uuid;
  v_role     public.workspace_role;
  v_details  jsonb;
begin
  if v_actor is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  -- A report the caller cannot see answers like a missing one.
  select r.* into v_report from public.reports r where r.id = p_report_id;
  if not found or not private.is_workspace_member(v_report.workspace_id) then
    raise exception 'Rapport introuvable' using errcode = 'P0002';
  end if;

  -- A draft starting in this workspace finishes first, or waits. Then the
  -- report row, read again under its lock. Deleting a report only frees a
  -- report slot, so it does not take the billing lock: a reopening holds the
  -- report row while it waits for that lock.
  perform private.lock_workspace_drafts(v_report.workspace_id);
  select r.* into v_report from public.reports r where r.id = p_report_id for update;
  if not found then
    raise exception 'Rapport introuvable' using errcode = 'P0002';
  end if;

  select m.role into v_role
  from public.workspace_members m
  where m.workspace_id = v_report.workspace_id and m.user_id = v_actor;
  if v_role is null or v_role not in ('owner', 'admin') then
    raise exception 'Seuls les propriétaires et administrateurs de l''espace suppriment un rapport'
      using errcode = '42501';
  end if;
  if v_report.status = 'final' then
    if v_role <> 'owner' then
      raise exception 'Seul un propriétaire de l''espace supprime un rapport final' using errcode = '42501';
    end if;
    if not private.confirmation_matches(p_confirmation, v_report.title) then
      raise exception 'Saisissez le titre exact du rapport pour confirmer' using errcode = 'KR070';
    end if;
  end if;

  select w.organization_id into v_org from public.workspaces w where w.id = v_report.workspace_id;
  v_details := jsonb_build_object('status', v_report.status, 'actor_role', v_role)
    || private.report_contents(v_report.id);
  v_details := v_details
    || jsonb_build_object('files_queued', private.queue_scope_files(v_report.workspace_id, v_report.id));

  -- Sections, files, exports, status history and notifications go with it.
  -- AI generations stay with section_id set to null, so their usage counts.
  delete from public.reports r where r.id = v_report.id;

  insert into private.audit_events (action, actor_id, organization_id, workspace_id, report_id, details)
  values ('report_deleted', v_actor, v_org, v_report.workspace_id, v_report.id, v_details);
  return v_details;
end;
$$;

-- -----------------------------------------------------------------------------
-- Deleting a workspace
-- -----------------------------------------------------------------------------
-- Owners of the workspace, with its name in p_confirmation. Returns what went.
create or replace function public.delete_workspace(p_workspace_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor      uuid := (select auth.uid());
  v_workspace  public.workspaces;
  v_details    jsonb;
begin
  if v_actor is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  select w.* into v_workspace from public.workspaces w where w.id = p_workspace_id;
  if not found or not private.is_workspace_member(v_workspace.id) then
    raise exception 'Espace de travail introuvable' using errcode = 'P0002';
  end if;

  -- Same order as start_ai_generation and the billing checks: the draft
  -- lock, the organization's billing lock, then the rows.
  perform private.lock_workspace_drafts(v_workspace.id);
  perform private.billing_lock_org(v_workspace.organization_id);
  select w.* into v_workspace from public.workspaces w where w.id = p_workspace_id for update;
  if not found then
    raise exception 'Espace de travail introuvable' using errcode = 'P0002';
  end if;

  if not private.has_workspace_role(v_workspace.id, array['owner']::public.workspace_role[]) then
    raise exception 'Seuls les propriétaires de l''espace de travail peuvent le supprimer' using errcode = '42501';
  end if;
  if not private.confirmation_matches(p_confirmation, v_workspace.name) then
    raise exception 'Saisissez le nom exact de l''espace de travail pour confirmer' using errcode = 'KR070';
  end if;

  v_details := jsonb_build_object(
    'billing_mode', v_workspace.billing_mode,
    'passes', private.billing_time_left(v_workspace.organization_id, v_workspace.id) -> 'passes'
  ) || private.workspace_contents(v_workspace.id);
  v_details := v_details || jsonb_build_object('files_queued', private.queue_scope_files(v_workspace.id));

  -- Members, invitations, reports and all they hold, templates, rollouts, AI
  -- generations and notifications go with it, and the passes of a mission
  -- workspace. The organization's draft ledger stays (workspace_id set to
  -- null), so deleting a workspace never gives drafts back.
  delete from public.workspaces w where w.id = v_workspace.id;

  insert into private.audit_events (action, actor_id, organization_id, workspace_id, details)
  values ('workspace_deleted', v_actor, v_workspace.organization_id, v_workspace.id, v_details);
  return v_details;
end;
$$;

-- -----------------------------------------------------------------------------
-- Deleting an organization
-- -----------------------------------------------------------------------------
-- Its owner, with its name in p_confirmation. Every workspace goes, with all
-- it holds, and the organization's billing rows except payments and
-- receipts. Returns what went.
create or replace function public.delete_organization(p_organization_id uuid, p_confirmation text)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_actor       uuid := (select auth.uid());
  v_org         public.organizations;
  v_workspaces  uuid[];
  v_now         uuid[];
  v_workspace   uuid;
  v_files       integer := 0;
  v_details     jsonb;
begin
  if v_actor is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  select o.* into v_org from public.organizations o where o.id = p_organization_id;
  if not found or not private.is_organization_member(v_org.id) then
    raise exception 'Organisation introuvable' using errcode = 'P0002';
  end if;
  if v_org.owner_id <> v_actor then
    raise exception 'Seul le propriétaire de l''organisation peut la supprimer' using errcode = '42501';
  end if;

  -- The draft lock of every workspace, in id order so two deletions never
  -- wait on each other, then the billing lock, then the rows.
  select coalesce(array_agg(w.id order by w.id), '{}') into v_workspaces
  from public.workspaces w where w.organization_id = v_org.id;
  foreach v_workspace in array v_workspaces loop
    perform private.lock_workspace_drafts(v_workspace);
  end loop;
  perform private.billing_lock_org(v_org.id);

  select o.* into v_org from public.organizations o where o.id = p_organization_id for update;
  if not found then
    raise exception 'Organisation introuvable' using errcode = 'P0002';
  end if;
  if v_org.owner_id <> v_actor then
    raise exception 'Seul le propriétaire de l''organisation peut la supprimer' using errcode = '42501';
  end if;
  -- With the organization locked no workspace can be added. One added before
  -- the lock has no draft lock held: the caller tries again.
  select coalesce(array_agg(w.id order by w.id), '{}') into v_now
  from (
    select w.id from public.workspaces w where w.organization_id = v_org.id order by w.id for update
  ) w;
  if v_now is distinct from v_workspaces then
    raise exception 'L''organisation a changé pendant la suppression, réessayez' using errcode = '40001';
  end if;

  if not private.confirmation_matches(p_confirmation, v_org.name) then
    raise exception 'Saisissez le nom exact de l''organisation pour confirmer' using errcode = 'KR070';
  end if;

  foreach v_workspace in array v_workspaces loop
    v_files := v_files + private.queue_scope_files(v_workspace);
  end loop;
  v_details := jsonb_build_object(
    'workspace_ids', to_jsonb(v_workspaces),
    'workspaces', cardinality(v_workspaces),
    'reports', (
      select count(*) from public.reports r where r.workspace_id = any (v_workspaces)
    ),
    'members', (
      select count(distinct m.user_id) from public.workspace_members m where m.workspace_id = any (v_workspaces)
    ),
    'billing_lost', private.billing_time_left(v_org.id),
    -- The foreign keys drop their link to the organization: the log keeps it.
    'purchase_ids', (
      select coalesce(jsonb_agg(p.id order by p.created_at, p.id), '[]'::jsonb)
      from public.billing_purchases p where p.organization_id = v_org.id
    ),
    'receipts_kept', (select count(*) from public.billing_receipts r where r.organization_id = v_org.id),
    'files_queued', v_files
  );

  -- Workspaces and all they hold, the buyer row, entitlements, packs and the
  -- draft ledger go with it. Payments and receipts stay with organization_id
  -- set to null; the billing audit log and the trial claims have no foreign
  -- key and stay too.
  delete from public.organizations o where o.id = v_org.id;

  insert into private.audit_events (action, actor_id, organization_id, details)
  values ('organization_deleted', v_actor, v_org.id, v_details);
  return v_details;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.confirmation_matches(text, text) from public, anon, authenticated;
revoke all on function private.report_contents(uuid) from public, anon, authenticated;
revoke all on function private.workspace_contents(uuid) from public, anon, authenticated;
revoke all on function private.billing_time_left(uuid, uuid) from public, anon, authenticated;
revoke all on function private.queue_scope_files(uuid, uuid) from public, anon, authenticated;
revoke all on function private.lock_workspace_drafts(uuid) from public, anon, authenticated;

revoke all on function public.report_deletion_preview(uuid) from public, anon;
revoke all on function public.workspace_deletion_preview(uuid) from public, anon;
revoke all on function public.organization_deletion_preview(uuid) from public, anon;
revoke all on function public.delete_report(uuid, text) from public, anon;
revoke all on function public.delete_workspace(uuid, text) from public, anon;
revoke all on function public.delete_organization(uuid, text) from public, anon;
grant execute on function public.report_deletion_preview(uuid) to authenticated;
grant execute on function public.workspace_deletion_preview(uuid) to authenticated;
grant execute on function public.organization_deletion_preview(uuid) to authenticated;
grant execute on function public.delete_report(uuid, text) to authenticated;
grant execute on function public.delete_workspace(uuid, text) to authenticated;
grant execute on function public.delete_organization(uuid, text) to authenticated;
