-- =============================================================================
-- KolabReport: delete my own account and download my data (KRB-186)
--
-- A signed-in person downloads their data and deletes their account from
-- /fr/compte. docs/gdpr/data-subject-requests.md describes what goes and
-- what stays; this file puts those rules in the database.
--
-- 1. Rows a person created stay with the workspace when the account goes.
--    workspaces.created_by, reports.created_by and deliverables.uploaded_by
--    become nullable and are set to null. Before, they blocked the delete.
-- 2. What blocks a deletion: owning an organization (the foreign key already
--    refuses it), and being the only owner of a workspace, whether it has
--    other members or none. private.account_deletion_blockers() lists them
--    for the account page, and a trigger on profiles refuses the delete on
--    every path, the Supabase dashboard included.
-- 3. prepare_account_deletion() clears what would survive the delete: the
--    owner of the person's Storage objects, their feedback comments on AI
--    drafts, the invitations sent to their address and their notifications.
--    The server calls it with the service role just before
--    auth.admin.deleteUser.
-- 4. transfer_organization() hands an organization to an owner of one of its
--    workspaces. The billing functions read organizations.owner_id each time
--    they run, so they follow the new owner. The change is written to
--    private.billing_events.
-- 5. One deletion at a time per person, and at most 5 tries in 15 minutes:
--    a double click runs it once, and the password check cannot be used to
--    guess a password.
--
-- Kept on purpose: the trial claim (private.billing_trial_claims has no
-- foreign key to the account, so a new account with the same e-mail gets no
-- trial), and every billing row, which belongs to the organization.
--
-- Error codes:
--   KR060  the account still owns an organization or is the only owner of a
--          workspace
--   KR061  the new owner is not an owner of a workspace of the organization
-- =============================================================================

-- -----------------------------------------------------------------------------
-- 1. Rows that stay with the workspace
-- -----------------------------------------------------------------------------
alter table public.workspaces alter column created_by drop not null;
alter table public.workspaces
  drop constraint if exists workspaces_created_by_fkey,
  add constraint workspaces_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.reports alter column created_by drop not null;
alter table public.reports
  drop constraint if exists reports_created_by_fkey,
  add constraint reports_created_by_fkey
    foreign key (created_by) references public.profiles (id) on delete set null;

alter table public.deliverables alter column uploaded_by drop not null;
alter table public.deliverables
  drop constraint if exists deliverables_uploaded_by_fkey,
  add constraint deliverables_uploaded_by_fkey
    foreign key (uploaded_by) references public.profiles (id) on delete set null;

-- The set null of a deleted profile finds its rows through these.
create index if not exists workspaces_created_by_idx on public.workspaces (created_by);
create index if not exists reports_created_by_idx on public.reports (created_by);
create index if not exists deliverables_uploaded_by_idx on public.deliverables (uploaded_by);

-- -----------------------------------------------------------------------------
-- 2. What blocks a deletion
-- -----------------------------------------------------------------------------
-- One row per blocker of p_user_id:
--   organization_owner  they own the organization. successors counts the
--                       owners of its workspaces who can take it over.
--   only_owner          they are the only owner of a workspace that has
--                       other members (other_members of them).
--   only_member         they are the only member of a workspace.
-- Organizations first, then workspaces, by name.
create or replace function private.account_deletion_blockers(p_user_id uuid)
returns table (
  kind               text,
  organization_id    uuid,
  organization_name  text,
  workspace_id       uuid,
  workspace_name     text,
  other_members      integer,
  successors         integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select b.kind, b.organization_id, b.organization_name, b.workspace_id, b.workspace_name,
    b.other_members, b.successors
  from (
    select 'organization_owner'::text as kind, o.id as organization_id, o.name as organization_name,
      null::uuid as workspace_id, null::text as workspace_name, null::integer as other_members,
      (select count(distinct m.user_id)::integer
       from public.workspaces w
       join public.workspace_members m on m.workspace_id = w.id
       where w.organization_id = o.id and m.role = 'owner' and m.user_id <> p_user_id) as successors
    from public.organizations o
    where o.owner_id = p_user_id
    union all
    select case when others.n = 0 then 'only_member' else 'only_owner' end,
      w.organization_id, o.name, w.id, w.name, others.n, null::integer
    from public.workspace_members m
    join public.workspaces w on w.id = m.workspace_id
    join public.organizations o on o.id = w.organization_id
    cross join lateral (
      select count(*)::integer as n
      from public.workspace_members x
      where x.workspace_id = m.workspace_id and x.user_id <> p_user_id
    ) others
    where m.user_id = p_user_id
      and m.role = 'owner'
      and not exists (
        select 1 from public.workspace_members x
        where x.workspace_id = m.workspace_id and x.role = 'owner' and x.user_id <> p_user_id
      )
  ) b
  order by b.kind = 'organization_owner' desc, b.organization_name, b.workspace_name nulls first;
$$;

-- The account page: the caller's own blockers. Empty when nothing blocks.
create or replace function public.my_account_deletion_blockers()
returns table (
  kind               text,
  organization_id    uuid,
  organization_name  text,
  workspace_id       uuid,
  workspace_name     text,
  other_members      integer,
  successors         integer
)
language sql
stable
security definer
set search_path = ''
as $$
  select * from private.account_deletion_blockers((select auth.uid()));
$$;

-- A profile goes only with its account. Refused while the account has a
-- blocker, so no workspace is left without an owner, whoever deletes it.
create or replace function private.guard_account_deletion()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if exists (select 1 from private.account_deletion_blockers(old.id)) then
    raise exception 'Ce compte possède une organisation ou est le seul propriétaire d''un espace de travail : transférez-les ou supprimez-les d''abord'
      using errcode = 'KR060';
  end if;
  return old;
end;
$$;

drop trigger if exists guard_account_deletion on public.profiles;
create trigger guard_account_deletion
  before delete on public.profiles
  for each row execute function private.guard_account_deletion();

-- -----------------------------------------------------------------------------
-- 3. What goes before the account
-- -----------------------------------------------------------------------------
-- Service role only. The server passes the id of the signed-in user, after
-- checking their password. Refuses with KR060 while something blocks, and
-- changes nothing then. Returns how many rows each step touched, for the log.
create or replace function public.prepare_account_deletion(p_user_id uuid)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_email          text;
  v_storage        integer;
  v_feedback       integer;
  v_invitations    integer := 0;
  v_notifications  integer;
begin
  select lower(btrim(u.email)) into v_email from auth.users u where u.id = p_user_id;
  if not found then
    raise exception 'Compte introuvable' using errcode = 'P0002';
  end if;
  if exists (select 1 from private.account_deletion_blockers(p_user_id)) then
    raise exception 'Ce compte possède une organisation ou est le seul propriétaire d''un espace de travail : transférez-les ou supprimez-les d''abord'
      using errcode = 'KR060';
  end if;

  -- The files stay with their workspace, with no owner. This changes the
  -- metadata only, never the stored file.
  update storage.objects o
  set owner = null, owner_id = null
  where o.owner_id = p_user_id::text or o.owner = p_user_id;
  get diagnostics v_storage = row_count;

  -- Free text they wrote about AI drafts. The rating stays, without a name.
  update public.ai_generations g
  set feedback_comment = null
  where g.requested_by = p_user_id and g.feedback_comment is not null;
  get diagnostics v_feedback = row_count;

  -- Linked by e-mail, not by id, so the foreign keys leave them behind.
  if nullif(v_email, '') is not null then
    delete from public.workspace_invitations i where i.email = v_email;
    get diagnostics v_invitations = row_count;
  end if;

  -- The cascade from the profile would remove them too.
  delete from public.notifications n where n.user_id = p_user_id;
  get diagnostics v_notifications = row_count;

  return jsonb_build_object(
    'storage_objects', v_storage,
    'feedback_comments', v_feedback,
    'invitations', v_invitations,
    'notifications', v_notifications
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- 4. Organization transfer
-- -----------------------------------------------------------------------------
-- The billing records of a transfer. Keep the kinds of
-- 20261015100000_billing_entitlements.sql and add this one.
alter table private.billing_events drop constraint if exists billing_events_kind_check;
alter table private.billing_events
  add constraint billing_events_kind_check check (kind in (
    'trial_started', 'granted', 'converted', 'manual_grant', 'manual_revoke',
    'refund_seen', 'review', 'launch_period', 'entered_grace', 'entered_read_only',
    'owner_transferred'));

-- Who can take over an organization: the owners of its workspaces, other
-- than the current owner. Only the current owner gets rows.
create or replace function public.organization_transfer_candidates(p_organization_id uuid)
returns table (user_id uuid, full_name text, email text)
language sql
stable
security definer
set search_path = ''
as $$
  select distinct p.id, p.full_name, p.email
  from public.organizations o
  join public.workspaces w on w.organization_id = o.id
  join public.workspace_members m on m.workspace_id = w.id and m.role = 'owner'
  join public.profiles p on p.id = m.user_id
  where o.id = p_organization_id
    and o.owner_id = (select auth.uid())
    and m.user_id <> o.owner_id
  order by p.full_name, p.email;
$$;

-- The current owner hands the organization to an owner of one of its
-- workspaces. can_read_org_billing, can_manage_org_billing,
-- can_add_workspace and the organizations policies read owner_id when they
-- run: the new owner has the organization's rights at once, and the
-- previous one keeps only what their workspace roles give. The trial claim
-- stays with the person who started the trial.
create or replace function public.transfer_organization(p_organization_id uuid, p_new_owner_id uuid)
returns void
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user      uuid := (select auth.uid());
  v_previous  uuid;
begin
  if v_user is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  -- "No key update" does not wait for writes that only check that the
  -- organization exists (billing rows referencing it), so it cannot
  -- deadlock with them. Two transfers of the same organization run one
  -- after the other, and the second one sees the new owner.
  select o.owner_id into v_previous
  from public.organizations o
  where o.id = p_organization_id
  for no key update;

  -- An organization the caller does not own answers like one that does not exist.
  if v_previous is distinct from v_user then
    raise exception 'Seul le propriétaire de l''organisation peut la transférer' using errcode = '42501';
  end if;
  if p_new_owner_id is null or p_new_owner_id = v_user or not exists (
    select 1
    from public.workspaces w
    join public.workspace_members m on m.workspace_id = w.id
    where w.organization_id = p_organization_id
      and m.user_id = p_new_owner_id
      and m.role = 'owner'
  ) then
    raise exception 'La personne choisie doit être propriétaire d''un espace de travail de l''organisation'
      using errcode = 'KR061';
  end if;

  update public.organizations set owner_id = p_new_owner_id where id = p_organization_id;

  insert into private.billing_events (organization_id, kind, details)
  values (
    p_organization_id, 'owner_transferred',
    jsonb_build_object('previous_owner_id', v_previous, 'new_owner_id', p_new_owner_id)
  );
end;
$$;

-- -----------------------------------------------------------------------------
-- Data export: the caller's sessions
-- -----------------------------------------------------------------------------
-- The auth schema is not reachable through the API. The export reads the
-- caller's own sessions here, with their dates, browser and IP address.
create or replace function public.my_account_sessions()
returns table (created_at timestamptz, refreshed_at timestamptz, user_agent text, ip text)
language sql
stable
security definer
set search_path = ''
as $$
  select s.created_at, s.refreshed_at at time zone 'utc', s.user_agent, host(s.ip)
  from auth.sessions s
  where s.user_id = (select auth.uid())
  order by s.created_at;
$$;

-- -----------------------------------------------------------------------------
-- 5. One deletion at a time, 5 tries in 15 minutes
-- -----------------------------------------------------------------------------
-- Not tenant data: a lock per person. Its rows go with the account. RLS
-- stays on and nobody has a grant: only the functions below use it.
create table if not exists private.account_deletion_attempts (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  started_at  timestamptz not null default now(),
  ended_at    timestamptz
);

comment on table private.account_deletion_attempts is
  'Account deletions started from /fr/compte: one at a time per person, 5 in 15 minutes (KRB-186).';

create index if not exists account_deletion_attempts_user_idx
  on private.account_deletion_attempts (user_id, started_at desc);

alter table private.account_deletion_attempts enable row level security;
revoke all on private.account_deletion_attempts from public, anon, authenticated, service_role;

-- Starts a deletion for the caller: ok, busy (another one runs, or ran less
-- than 2 minutes ago without ending) or rate_limited (5 tries in 15 minutes,
-- whatever their outcome).
create or replace function public.claim_account_deletion()
returns text
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user uuid := (select auth.uid());
begin
  if v_user is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;
  -- Two clicks at the same time: the second one waits here, then sees the first.
  perform pg_advisory_xact_lock(hashtextextended('account-deletion/' || v_user::text, 0));

  delete from private.account_deletion_attempts a
  where a.user_id = v_user and a.started_at < now() - interval '1 day';

  if exists (
    select 1 from private.account_deletion_attempts a
    where a.user_id = v_user and a.ended_at is null and a.started_at > now() - interval '2 minutes'
  ) then
    return 'busy';
  end if;
  if (
    select count(*) from private.account_deletion_attempts a
    where a.user_id = v_user and a.started_at > now() - interval '15 minutes'
  ) >= 5 then
    return 'rate_limited';
  end if;

  insert into private.account_deletion_attempts (user_id) values (v_user);
  return 'ok';
end;
$$;

-- Ends the caller's running deletion when it stops before the account goes
-- (wrong password, a blocker). The try still counts for the limit.
create or replace function public.release_account_deletion()
returns void
language sql
security definer
set search_path = ''
as $$
  update private.account_deletion_attempts a
  set ended_at = now()
  where a.user_id = (select auth.uid()) and a.ended_at is null;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.account_deletion_blockers(uuid) from public, anon, authenticated;
revoke all on function private.guard_account_deletion() from public, anon, authenticated;

revoke all on function public.my_account_deletion_blockers() from public, anon;
grant execute on function public.my_account_deletion_blockers() to authenticated;

revoke all on function public.prepare_account_deletion(uuid) from public, anon, authenticated;
grant execute on function public.prepare_account_deletion(uuid) to service_role;

revoke all on function public.organization_transfer_candidates(uuid) from public, anon;
grant execute on function public.organization_transfer_candidates(uuid) to authenticated;

revoke all on function public.transfer_organization(uuid, uuid) from public, anon;
grant execute on function public.transfer_organization(uuid, uuid) to authenticated;

revoke all on function public.my_account_sessions() from public, anon;
grant execute on function public.my_account_sessions() to authenticated;

revoke all on function public.claim_account_deletion() from public, anon;
grant execute on function public.claim_account_deletion() to authenticated;

revoke all on function public.release_account_deletion() from public, anon;
grant execute on function public.release_account_deletion() to authenticated;
