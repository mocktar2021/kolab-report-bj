-- =============================================================================
-- KolabReport: report review and finalization (Story KRB-20)
--
-- * A report goes from draft to in_review to final through
--   transition_report_status only, following the transitions listed in
--   private.report_status_transitions and the roles each one needs:
--     draft     -> in_review  owners and admins (submit for review)
--     in_review -> draft      owners and admins (send back for changes)
--     in_review -> final      owners (finalize)
--     final     -> draft      owners (reopen)
-- * report_status_events keeps every change, and notifications tells the
--   people concerned: the owners and admins and the experts with a section in
--   the report, except the person who made the change.
-- * A final report is frozen: nobody writes its sections or its files, owners
--   included, until an owner reopens it. RLS hides its sections from writes,
--   and a trigger refuses the changes that come through functions that run
--   with the owner's rights (KR020).
-- * report_exports.kind tells the exports someone asked for from the PDF the
--   app stores when a report becomes final (status_event_id names the change).
-- =============================================================================

-- -----------------------------------------------------------------------------
-- Allowed transitions
-- -----------------------------------------------------------------------------
create table private.report_status_transitions (
  from_status public.report_status not null,
  to_status   public.report_status not null,
  roles       public.workspace_role[] not null check (cardinality(roles) > 0),
  primary key (from_status, to_status),
  check (from_status <> to_status)
);

comment on table private.report_status_transitions is
  'Status changes a report allows, and who may make each one. Mirrored in src/lib/reports/status.ts.';

insert into private.report_status_transitions (from_status, to_status, roles) values
  ('draft',     'in_review', '{owner,admin}'),
  ('in_review', 'draft',     '{owner,admin}'),
  ('in_review', 'final',     '{owner}'),
  ('final',     'draft',     '{owner}');

revoke all on private.report_status_transitions from public, anon, authenticated;

-- -----------------------------------------------------------------------------
-- History of the status changes
-- -----------------------------------------------------------------------------
create table public.report_status_events (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null,
  report_id     uuid not null,
  from_status   public.report_status not null,
  to_status     public.report_status not null,
  changed_by    uuid references public.profiles (id) on delete set null,
  changed_at    timestamptz not null default now(),
  foreign key (report_id, workspace_id)
    references public.reports (id, workspace_id) on delete cascade,
  unique (id, workspace_id)
);

comment on table public.report_status_events is
  'Every status change of a report (Story KRB-20). Written by transition_report_status only.';

create index report_status_events_report_idx on public.report_status_events (report_id, changed_at desc);
create index report_status_events_workspace_idx on public.report_status_events (workspace_id);

alter table public.report_status_events enable row level security;

create policy "report_status_events: members read"
  on public.report_status_events for select to authenticated
  using (private.is_workspace_member(workspace_id));

revoke all on public.report_status_events from anon, authenticated;
grant select on public.report_status_events to authenticated;

-- -----------------------------------------------------------------------------
-- In-app notifications
-- -----------------------------------------------------------------------------
create table public.notifications (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  user_id       uuid not null references public.profiles (id) on delete cascade,
  -- The status change it tells about. Only kind of notification for now.
  event_id      uuid not null,
  created_at    timestamptz not null default now(),
  read_at       timestamptz,
  foreign key (event_id, workspace_id)
    references public.report_status_events (id, workspace_id) on delete cascade,
  unique (user_id, event_id)
);

comment on table public.notifications is
  'What a member has to know about, for now the status changes of reports (Story KRB-20).';

create index notifications_user_idx on public.notifications (user_id, created_at desc);
create index notifications_unread_idx on public.notifications (user_id) where read_at is null;
create index notifications_event_idx on public.notifications (event_id);
create index notifications_workspace_idx on public.notifications (workspace_id);

alter table public.notifications enable row level security;

-- People see their own notifications while they belong to the workspace.
create policy "notifications: recipient reads"
  on public.notifications for select to authenticated
  using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id));

-- And mark them as read, which is the only column they can change.
create policy "notifications: recipient marks read"
  on public.notifications for update to authenticated
  using (user_id = (select auth.uid()) and private.is_workspace_member(workspace_id))
  with check (user_id = (select auth.uid()));

revoke all on public.notifications from anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;

-- -----------------------------------------------------------------------------
-- Reports: the status changes through transition_report_status only
-- -----------------------------------------------------------------------------
-- Users keep direct writes on the descriptive columns. A new report starts
-- as a draft (the column default).
revoke insert, update on public.reports from authenticated;
grant insert (id, workspace_id, title, description, due_date, created_by)
  on public.reports to authenticated;
grant update (title, description, due_date) on public.reports to authenticated;

-- A final report keeps its title and dates too.
drop policy "reports: managers update" on public.reports;
create policy "reports: managers update open reports"
  on public.reports for update to authenticated
  using (private.is_workspace_manager(workspace_id) and status <> 'final')
  with check (private.is_workspace_manager(workspace_id));

-- Only an owner deletes a final report.
drop policy "reports: managers delete" on public.reports;
create policy "reports: managers delete, owners when final"
  on public.reports for delete to authenticated
  using (
    private.is_workspace_manager(workspace_id)
    and (status <> 'final' or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  );

-- -----------------------------------------------------------------------------
-- Final reports are frozen
-- -----------------------------------------------------------------------------
-- True while the report of the section is not final.
create or replace function private.section_is_open(section uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
    from public.report_sections s
    join public.reports r on r.id = s.report_id
    where s.id = section and r.status <> 'final'
  );
$$;

create or replace function private.report_is_open(report uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (select 1 from public.reports r where r.id = report and r.status <> 'final');
$$;

revoke all on function private.section_is_open(uuid) from public, anon;
revoke all on function private.report_is_open(uuid) from public, anon;
grant execute on function private.section_is_open(uuid) to authenticated;
grant execute on function private.report_is_open(uuid) to authenticated;

-- Sections: no new section, no change and no deletion in a final report.
drop policy "report_sections: managers create" on public.report_sections;
create policy "report_sections: managers create in open reports"
  on public.report_sections for insert to authenticated
  with check (private.is_workspace_manager(workspace_id) and private.report_is_open(report_id));

drop policy "report_sections: managers or assigned expert update" on public.report_sections;
create policy "report_sections: section editors update open sections"
  on public.report_sections for update to authenticated
  using (private.can_edit_section(id) and private.section_is_open(id))
  with check (private.is_workspace_member(workspace_id));

drop policy "report_sections: managers delete" on public.report_sections;
create policy "report_sections: managers delete open sections"
  on public.report_sections for delete to authenticated
  using (private.is_workspace_manager(workspace_id) and private.report_is_open(report_id));

-- Files: no upload and no deletion in a final report.
drop policy "deliverables: section editors upload" on public.deliverables;
create policy "deliverables: section editors upload"
  on public.deliverables for insert to authenticated
  with check (
    uploaded_by = (select auth.uid())
    and private.can_edit_section(section_id)
    and private.section_is_open(section_id)
  );

drop policy "deliverables: section editors delete" on public.deliverables;
create policy "deliverables: section editors delete"
  on public.deliverables for delete to authenticated
  using (
    private.section_is_open(section_id)
    and (
      private.is_workspace_manager(workspace_id)
      or (uploaded_by = (select auth.uid()) and private.can_edit_section(section_id))
    )
  );

-- A file registered before the report became final cannot be sent after.
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
  );
$$;

-- AI drafts of a final report wait for it to be reopened.
create or replace function private.lock_proposal(generation uuid)
returns public.ai_generations
language plpgsql
security definer
set search_path = ''
as $$
declare
  proposal public.ai_generations;
begin
  select * into proposal from public.ai_generations g where g.id = generation for update;
  if not found then
    raise exception 'Brouillon introuvable' using errcode = 'P0002';
  end if;
  if not private.can_edit_section(proposal.section_id) then
    raise exception 'Seules les personnes qui rédigent la section décident de ses brouillons'
      using errcode = '42501';
  end if;
  if not private.section_is_open(proposal.section_id) then
    raise exception 'Ce rapport est final : un propriétaire doit le repasser en brouillon pour le modifier'
      using errcode = 'KR020';
  end if;
  if proposal.status <> 'succeeded' or proposal.accepted is not null then
    raise exception 'Ce brouillon n''attend plus de décision' using errcode = '55000';
  end if;
  return proposal;
end;
$$;

-- The last line of defense, for the functions that write sections with the
-- owner's rights (save_section_content, accept_ai_generation,
-- reorder_report_sections) and any added later. It runs for every role,
-- service role included. Only the expert can change: removing a member
-- unassigns their sections, final report or not.
create or replace function private.guard_final_report_sections()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'INSERT' then
    if not private.report_is_open(new.report_id) then
      raise exception 'Ce rapport est final : un propriétaire doit le repasser en brouillon pour le modifier'
        using errcode = 'KR020';
    end if;
    return new;
  end if;

  if (new.report_id, new.workspace_id, new.parent_id, new.title, new.instructions, new.position,
      new.status, new.weight, new.content, new.ai_draft, new.ai_generated_at)
     is distinct from
     (old.report_id, old.workspace_id, old.parent_id, old.title, old.instructions, old.position,
      old.status, old.weight, old.content, old.ai_draft, old.ai_generated_at)
     and (not private.report_is_open(old.report_id) or not private.report_is_open(new.report_id)) then
    raise exception 'Ce rapport est final : un propriétaire doit le repasser en brouillon pour le modifier'
      using errcode = 'KR020';
  end if;
  return new;
end;
$$;

revoke all on function private.guard_final_report_sections() from public, anon, authenticated;

create trigger guard_final_report
  before insert or update on public.report_sections
  for each row execute function private.guard_final_report_sections();

-- -----------------------------------------------------------------------------
-- Snapshot of a final report
-- -----------------------------------------------------------------------------
alter table public.report_exports
  add column kind text not null default 'manual' check (kind in ('manual', 'final')),
  -- Events go only with their report, which takes its exports along.
  add column status_event_id uuid references public.report_status_events (id) on delete cascade,
  add constraint report_exports_final_has_event check (kind <> 'final' or status_event_id is not null);

comment on column public.report_exports.kind is
  'manual: asked for with the export buttons. final: the PDF stored when the report became final.';

-- One snapshot per finalization: a second attempt waits for the first to fail.
create unique index report_exports_one_snapshot_idx
  on public.report_exports (status_event_id)
  where kind = 'final' and status <> 'failed';

-- -----------------------------------------------------------------------------
-- Changing the status
-- -----------------------------------------------------------------------------
-- Moves the report from p_from to p_to if that change is listed and the
-- caller has one of its roles. p_from is the status the page showed: any
-- other current status means someone changed it meanwhile (40001). Records
-- the change, notifies the people concerned, and returns the change and who
-- to notify, so the app can send the e-mails.
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

revoke all on function public.transition_report_status(uuid, public.report_status, public.report_status)
  from public, anon;
grant execute on function public.transition_report_status(uuid, public.report_status, public.report_status)
  to authenticated;
