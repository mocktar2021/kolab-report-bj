-- =============================================================================
-- KolabReport: read-only workspaces and renewal reminders (KRB-178)
--
-- ADR 001 (docs/adr/001-billing-and-fedapay.md), sections 6.1, 7.3 and 12,
-- and the answers of section 17: a fourth notice when a workspace turns
-- read-only (Q14), sent to the organization owner and the workspace owners
-- (Q15).
--
-- * Read-only means nothing runs on the workspace's line and the grace is
--   over, or the line never had an entitlement. PR 175-3 already refuses new
--   reports, invitations, viewers made experts, reopened reports, new
--   workspaces and templates there (KR043). This file refuses every other
--   insert and update of content made in a user's name, with one trigger
--   function, private.guard_billing_writable():
--     reports           before update (title, description, due date, status)
--     report_sections   before insert or update
--     deliverables      before insert or update
--     prompt_library    before insert or update (workspace templates)
--     prompt_rollouts   before insert or update (workspace rollouts)
--   transition_report_status checks first, since it also writes the history
--   and the notifications, and the upload policy of the deliverables bucket
--   refuses a file registered before the switch.
-- * Deletes are never refused, so an owner can always delete their data.
--   Reading, exports, notifications, rating or discarding an AI draft,
--   leaving, removing members and revoking invitations stay open too.
-- * Like 175-3, only writes in a user's name are checked (auth.uid() set),
--   the definer functions they call included (save_section_content,
--   accept_ai_generation, reorder_report_sections). Writes of the service
--   role are not, and neither are writes made by another trigger: removing
--   a member still unassigns their sections.
-- * Reminders: public.billing_due_notices(at) finds the entitlements that
--   end their line and owe a notice at `at` (d7, d1, ended, read_only),
--   claims each one in private.billing_notices, writes the in-app
--   notifications and the audit events in the same transaction, and returns
--   who to e-mail. A notice is claimed once ever, so running the job twice,
--   or twice at the same time, sends nothing twice. The daily cron
--   (/api/cron/billing) sends the e-mails, then records the result with
--   public.billing_finish_notice.
-- * Nothing changes while private.billing_settings.enforced is false: no
--   guard refuses anything and no notice is due.
--
-- No new error code: the guards raise KR043 like 175-3.
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Read-only: one rule
-- -----------------------------------------------------------------------------
-- False when the line covering the workspace is read-only. True for an
-- unknown workspace and while billing is not enforced.
create or replace function private.workspace_is_writable(p_workspace_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    select 1 from private.workspace_access(p_workspace_id) a where a.state = 'read_only'
  );
$$;

-- Same message and code as in 175-3, now on top of the boolean above.
create or replace function private.assert_workspace_writable(p_workspace_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = ''
as $$
begin
  if not private.workspace_is_writable(p_workspace_id) then
    raise exception 'Cet espace de travail est en lecture seule : renouvelez l''offre pour le modifier'
      using errcode = 'KR043';
  end if;
end;
$$;

-- -----------------------------------------------------------------------------
-- Guards on the content tables
-- -----------------------------------------------------------------------------
create or replace function private.guard_billing_writable()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  -- The service role, migrations, and writes made by another trigger (a
  -- member removed unassigns their sections) are not checked.
  if (select auth.uid()) is null or pg_trigger_depth() > 1 then
    return new;
  end if;
  -- Global templates and rollouts belong to no workspace.
  if new.workspace_id is null then
    return new;
  end if;
  -- An insert reaches this trigger before RLS: people from outside the
  -- workspace get the usual refusal, not ours. An update only reaches it
  -- for rows the policies let the user change.
  if tg_op = 'INSERT' and not private.is_workspace_member(new.workspace_id) then
    return new;
  end if;
  perform private.assert_workspace_writable(new.workspace_id);
  return new;
end;
$$;

-- Named to run before the other guards of these tables, so a read-only
-- workspace says so first.
drop trigger if exists billing_read_only on public.reports;
create trigger billing_read_only
  before update on public.reports
  for each row execute function private.guard_billing_writable();

drop trigger if exists billing_read_only on public.report_sections;
create trigger billing_read_only
  before insert or update on public.report_sections
  for each row execute function private.guard_billing_writable();

drop trigger if exists billing_read_only on public.deliverables;
create trigger billing_read_only
  before insert or update on public.deliverables
  for each row execute function private.guard_billing_writable();

drop trigger if exists billing_read_only on public.prompt_library;
create trigger billing_read_only
  before insert or update on public.prompt_library
  for each row execute function private.guard_billing_writable();

drop trigger if exists billing_read_only on public.prompt_rollouts;
create trigger billing_read_only
  before insert or update on public.prompt_rollouts
  for each row execute function private.guard_billing_writable();

-- -----------------------------------------------------------------------------
-- Status changes: the same as 20261014120000_report_workflow.sql, with the
-- read-only check once the caller is known to be allowed the change.
-- -----------------------------------------------------------------------------
create or replace function public.transition_report_status(
  p_report_id uuid,
  p_from      public.report_status,
  p_to        public.report_status
)
returns table (event_id uuid, recipients uuid[])
language plpgsql
security definer
set search_path = ''
as $$
declare
  actor   uuid := (select auth.uid());
  report  public.reports;
  allowed public.workspace_role[];
  new_id  uuid;
  notified uuid[];
begin
  select * into report from public.reports r where r.id = p_report_id for update;
  if not found or not private.is_workspace_member(report.workspace_id) then
    raise exception 'Rapport introuvable' using errcode = 'P0002';
  end if;

  select t.roles into allowed
  from private.report_status_transitions t
  where t.from_status = p_from and t.to_status = p_to;
  if not found then
    raise exception 'Ce changement de statut n''est pas prévu' using errcode = '22023';
  end if;
  if not private.has_workspace_role(report.workspace_id, allowed) then
    raise exception 'Vous ne pouvez pas faire ce changement de statut' using errcode = '42501';
  end if;
  -- Read-only (KR043): no status change, no history, no notification.
  perform private.assert_workspace_writable(report.workspace_id);
  if report.status <> p_from then
    raise exception 'Le statut du rapport a changé depuis l''ouverture de la page' using errcode = '40001';
  end if;

  update public.reports r set status = p_to where r.id = report.id;

  insert into public.report_status_events (workspace_id, report_id, from_status, to_status, changed_by)
  values (report.workspace_id, report.id, p_from, p_to, actor)
  returning id into new_id;

  with concerned as (
    select m.user_id
    from public.workspace_members m
    where m.workspace_id = report.workspace_id
      and m.user_id is distinct from actor
      and (
        m.role in ('owner', 'admin')
        or (
          m.role = 'expert'
          and exists (
            select 1 from public.report_sections s
            where s.report_id = report.id and s.assigned_to = m.user_id
          )
        )
      )
  ), added as (
    insert into public.notifications (workspace_id, user_id, event_id)
    select report.workspace_id, c.user_id, new_id from concerned c
    returning user_id
  )
  select coalesce(array_agg(a.user_id order by a.user_id), '{}') into notified from added a;

  return query select new_id, notified;
end;
$$;

-- -----------------------------------------------------------------------------
-- Uploads: the same as 20261014120000_report_workflow.sql. A file registered
-- before the workspace turned read-only cannot be sent after.
-- -----------------------------------------------------------------------------
create or replace function private.can_upload_deliverable(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.deliverables d
    where d.storage_path = object_name
      and d.uploaded_by = (select auth.uid())
      and d.uploaded_at is null
      and private.can_edit_section(d.section_id)
      and private.section_is_open(d.section_id)
      and private.workspace_is_writable(d.workspace_id)
  );
$$;

-- -----------------------------------------------------------------------------
-- In-app notifications: a second kind, for billing (KRB-20 table)
-- -----------------------------------------------------------------------------
-- A billing notification belongs to an organization and an entitlement, and
-- to a workspace only for a Pass Mission. Its recipients are the people who
-- can renew, and they see it while they still can.
alter table public.notifications
  add column if not exists kind text not null default 'report_status',
  add column if not exists organization_id uuid references public.organizations (id) on delete cascade,
  add column if not exists entitlement_id uuid references public.billing_entitlements (id) on delete cascade,
  add column if not exists billing_notice text;

alter table public.notifications
  alter column event_id drop not null,
  alter column workspace_id drop not null;

alter table public.notifications drop constraint if exists notifications_kind_check;
alter table public.notifications add constraint notifications_kind_check check (
  (kind = 'report_status'
    and event_id is not null and workspace_id is not null
    and organization_id is null and entitlement_id is null and billing_notice is null)
  or (kind = 'billing'
    and event_id is null and organization_id is not null and entitlement_id is not null
    and billing_notice is not null and billing_notice in ('d7', 'd1', 'ended', 'read_only'))
);

comment on column public.notifications.kind is
  'report_status: a status change of a report (event_id). billing: a renewal reminder (entitlement_id, billing_notice), KRB-178.';

-- One notification per person, entitlement and notice.
create unique index if not exists notifications_billing_notice_idx
  on public.notifications (user_id, entitlement_id, billing_notice)
  where kind = 'billing';
create index if not exists notifications_organization_idx
  on public.notifications (organization_id) where organization_id is not null;
create index if not exists notifications_entitlement_idx
  on public.notifications (entitlement_id) where entitlement_id is not null;

drop policy if exists "notifications: recipient reads" on public.notifications;
create policy "notifications: recipient reads"
  on public.notifications for select to authenticated
  using (
    user_id = (select auth.uid())
    and case
          when kind = 'billing' then private.can_manage_org_billing(organization_id)
          else private.is_workspace_member(workspace_id)
        end
  );

drop policy if exists "notifications: recipient marks read" on public.notifications;
create policy "notifications: recipient marks read"
  on public.notifications for update to authenticated
  using (
    user_id = (select auth.uid())
    and case
          when kind = 'billing' then private.can_manage_org_billing(organization_id)
          else private.is_workspace_member(workspace_id)
        end
  )
  with check (user_id = (select auth.uid()));

-- -----------------------------------------------------------------------------
-- Reminders
-- -----------------------------------------------------------------------------
-- One row per notice claimed. The cron claims before it sends, so a notice
-- goes out once, and records the result of the e-mails after.
create table if not exists private.billing_notices (
  entitlement_id  uuid not null references public.billing_entitlements (id) on delete cascade,
  kind            text not null check (kind in ('d7', 'd1', 'ended', 'read_only')),
  claimed_at      timestamptz not null default now(),
  -- Set by billing_finish_notice. Null when the run stopped before.
  emailed_at      timestamptz,
  emails_sent     integer check (emails_sent >= 0),
  emails_failed   integer check (emails_failed >= 0),
  primary key (entitlement_id, kind)
);

comment on table private.billing_notices is
  'Renewal reminders already claimed, one per entitlement and kind (ADR 001, KRB-178). Written by billing_due_notices only.';

alter table private.billing_notices enable row level security;
revoke all on private.billing_notices from public, anon, authenticated, service_role;

-- The cron reads the entitlements around their end.
create index if not exists billing_entitlements_ends_idx
  on public.billing_entitlements (ends_at) where revoked_at is null;

-- Days a notice can still go out after its moment, when it is the last one:
-- the read_only notice of a line that turned read-only longer ago is not
-- sent any more (the first run after this migration, or a long outage).
-- The other notices are due until the next one takes over.
create or replace function private.billing_notice_catch_up()
returns interval
language sql
immutable
set search_path = ''
as $$
  select interval '7 days';
$$;

-- The notice each entitlement owes at p_at. Only entitlements that end
-- their line count: one followed by a renewal stacked at its end, by a
-- period that started since, or by an upgrade, owes nothing. Of the
-- notices whose moment has passed, only the latest is due, so a missed day
-- sends the one that is still true rather than every one in a row:
--   d7         from 00:00 (Porto-Novo time) 7 days before the end day
--   d1         from 00:00 (Porto-Novo time) the day before the end day
--   ended      from the end, for the grace days
--   read_only  from the end of the grace, for the catch-up days
create or replace function private.billing_due(p_at timestamptz)
returns table (
  entitlement_id   uuid,
  kind             text,
  organization_id  uuid,
  workspace_id     uuid,
  plan             text,
  ends_at          timestamptz,
  grace_ends_at    timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  with candidates as (
    select
      e.id, e.organization_id, e.workspace_id, e.scope, e.plan, e.ends_at,
      e.ends_at + make_interval(days => e.grace_days) as grace_end,
      (e.ends_at at time zone 'Africa/Porto-Novo')::date as end_day
    from public.billing_entitlements e
    where e.revoked_at is null
      -- Through the index: from 8 days ahead back to the longest grace
      -- (60 days) plus the catch-up.
      and e.ends_at <= p_at + interval '8 days'
      and e.ends_at > p_at - interval '60 days' - private.billing_notice_catch_up()
  ), due as (
    select
      c.*,
      case
        when p_at >= c.grace_end then
          case when p_at < c.grace_end + private.billing_notice_catch_up() then 'read_only' end
        when p_at >= c.ends_at then 'ended'
        when p_at >= ((c.end_day - 1)::timestamp at time zone 'Africa/Porto-Novo') then 'd1'
        when p_at >= ((c.end_day - 7)::timestamp at time zone 'Africa/Porto-Novo') then 'd7'
      end as kind
    from candidates c
    where not exists (
        select 1
        from public.billing_entitlements n
        where n.id <> c.id
          and n.revoked_at is null
          and n.ends_at > c.ends_at
          and n.starts_at <= greatest(p_at, c.ends_at)
          and case
                when c.scope = 'subscription' then n.scope = 'subscription' and n.organization_id = c.organization_id
                else n.scope = 'mission' and n.workspace_id = c.workspace_id
              end
      )
      -- A pass only covers its workspace while that workspace is a mission one.
      and (c.scope = 'subscription' or exists (
        select 1 from public.workspaces w where w.id = c.workspace_id and w.billing_mode = 'mission'
      ))
  )
  select d.id, d.kind, d.organization_id, d.workspace_id, d.plan, d.ends_at, d.grace_end
  from due d
  where d.kind is not null;
$$;

-- The people who can renew a line: the organization owner and the owners of
-- the workspaces it covers (every subscription workspace, or the workspace
-- of a pass).
create or replace function private.billing_notice_recipients(p_organization_id uuid, p_workspace_id uuid)
returns table (user_id uuid, email text, name text)
language sql
stable
security definer
set search_path = ''
as $$
  select p.id, p.email, coalesce(nullif(btrim(p.full_name), ''), p.email)
  from public.profiles p
  where p.email is not null
    and p.id in (
      select o.owner_id from public.organizations o where o.id = p_organization_id
      union
      select m.user_id
      from public.workspace_members m
      join public.workspaces w on w.id = m.workspace_id
      where w.organization_id = p_organization_id
        and m.role = 'owner'
        and case
              when p_workspace_id is null then w.billing_mode = 'subscription'
              else w.id = p_workspace_id
            end
    )
  order by p.id;
$$;

-- Claims the notices due at p_at and returns them with their recipients, for
-- the cron to e-mail. Each notice comes back once ever: a second run, or one
-- running at the same time, gets nothing for it. Writes the in-app
-- notification of each recipient, and the entered_grace and
-- entered_read_only audit events. Nothing while billing is not enforced.
create or replace function public.billing_due_notices(p_at timestamptz default now())
returns table (
  entitlement_id     uuid,
  kind               text,
  organization_id    uuid,
  organization_name  text,
  workspace_id       uuid,
  workspace_name     text,
  plan               text,
  ends_at            timestamptz,
  grace_ends_at      timestamptz,
  recipients         jsonb
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  d             record;
  v_recipients  jsonb;
begin
  if not private.billing_enforced() then
    return;
  end if;
  -- One run at a time. A second run waits here, then finds the claims of
  -- the first. The primary key would stop a double claim anyway.
  perform pg_advisory_xact_lock(hashtextextended('billing/notices', 0));

  for d in
    select b.*, o.name as organization_name, w.name as workspace_name
    from private.billing_due(p_at) b
    join public.organizations o on o.id = b.organization_id
    left join public.workspaces w on w.id = b.workspace_id
    order by b.entitlement_id, b.kind
  loop
    insert into private.billing_notices (entitlement_id, kind)
    values (d.entitlement_id, d.kind)
    on conflict do nothing;
    if not found then
      continue;
    end if;

    select coalesce(jsonb_agg(jsonb_build_object('user_id', r.user_id, 'email', r.email, 'name', r.name)
                              order by r.user_id), '[]'::jsonb)
    into v_recipients
    from private.billing_notice_recipients(d.organization_id, d.workspace_id) r;

    insert into public.notifications (kind, user_id, organization_id, workspace_id, entitlement_id, billing_notice)
    select 'billing', (r ->> 'user_id')::uuid, d.organization_id, d.workspace_id, d.entitlement_id, d.kind
    from jsonb_array_elements(v_recipients) r
    on conflict do nothing;

    if d.kind in ('ended', 'read_only') then
      insert into private.billing_events (organization_id, kind, details)
      values (
        d.organization_id,
        case d.kind when 'ended' then 'entered_grace' else 'entered_read_only' end,
        jsonb_build_object(
          'entitlement_id', d.entitlement_id,
          'workspace_id', d.workspace_id,
          'plan', d.plan,
          'ends_at', d.ends_at,
          'grace_ends_at', d.grace_ends_at
        )
      );
    end if;

    return query select
      d.entitlement_id, d.kind, d.organization_id, d.organization_name, d.workspace_id, d.workspace_name,
      d.plan, d.ends_at, d.grace_ends_at, v_recipients;
  end loop;
end;
$$;

-- What the cron's e-mails gave for a claimed notice. False when the notice
-- was never claimed.
create or replace function public.billing_finish_notice(
  p_entitlement_id uuid,
  p_kind           text,
  p_sent           integer,
  p_failed         integer
)
returns boolean
language plpgsql
security definer
set search_path = ''
as $$
begin
  update private.billing_notices n
  set emailed_at = now(), emails_sent = greatest(p_sent, 0), emails_failed = greatest(p_failed, 0)
  where n.entitlement_id = p_entitlement_id and n.kind = p_kind;
  return found;
end;
$$;

-- -----------------------------------------------------------------------------
-- Function privileges
-- -----------------------------------------------------------------------------
revoke all on function private.workspace_is_writable(uuid) from public, anon, authenticated;
revoke all on function private.assert_workspace_writable(uuid) from public, anon, authenticated;
revoke all on function private.guard_billing_writable() from public, anon, authenticated;
revoke all on function private.billing_notice_catch_up() from public, anon, authenticated;
revoke all on function private.billing_due(timestamptz) from public, anon, authenticated;
revoke all on function private.billing_notice_recipients(uuid, uuid) from public, anon, authenticated;

revoke all on function public.transition_report_status(uuid, public.report_status, public.report_status)
  from public, anon;
grant execute on function public.transition_report_status(uuid, public.report_status, public.report_status)
  to authenticated;

-- The storage policy calls it with the caller's rights.
revoke all on function private.can_upload_deliverable(text) from public, anon;
grant execute on function private.can_upload_deliverable(text) to authenticated, service_role;

revoke all on function public.billing_due_notices(timestamptz) from public, anon, authenticated;
grant execute on function public.billing_due_notices(timestamptz) to service_role;
revoke all on function public.billing_finish_notice(uuid, text, integer, integer) from public, anon, authenticated;
grant execute on function public.billing_finish_notice(uuid, text, integer, integer) to service_role;
