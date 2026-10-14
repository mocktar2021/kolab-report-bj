-- =============================================================================
-- KolabReport: fixes from the KRB-24 security review (KRB-152)
--
-- See docs/security/audit-2026-10.md for each finding.
-- * F-06: users change their name, avatar, job title and language, not the
--   e-mail of their profile, which the app shows as their identity and
--   sends report e-mails to.
-- * F-07: experts write the text and status of their section, not its
--   instructions, which managers set and which go into the AI prompt.
-- * F-09: an invitation stays valid 30 days at most, whatever the client asks.
-- * F-10: report_progress is a view: signed-in users only read it.
-- * F-15: a report's created_by is the person creating it (column default).
-- =============================================================================

-- F-06 ------------------------------------------------------------------------
-- Profiles are created by on_auth_user_created and removed with the account.
revoke insert, update, delete on public.profiles from authenticated;
grant update (full_name, avatar_url, job_title, locale) on public.profiles to authenticated;

-- F-07 ------------------------------------------------------------------------
create or replace function private.guard_expert_section_update()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if pg_trigger_depth() = 1
     and (select auth.uid()) is not null
     and not private.is_workspace_manager(old.workspace_id) then
    if new.assigned_to   is distinct from old.assigned_to
       or new.weight       is distinct from old.weight
       or new.position     is distinct from old.position
       or new.parent_id    is distinct from old.parent_id
       or new.report_id    is distinct from old.report_id
       or new.workspace_id is distinct from old.workspace_id
       or new.title        is distinct from old.title
       or new.instructions is distinct from old.instructions then
      raise exception 'Seuls les propriétaires et administrateurs peuvent modifier la structure d''une section'
        using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

-- F-09 ------------------------------------------------------------------------
create or replace function private.cap_invitation_expiry()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
  if new.expires_at > now() + interval '30 days' then
    raise exception 'Une invitation reste valable 30 jours au plus' using errcode = '22023';
  end if;
  return new;
end;
$$;

revoke all on function private.cap_invitation_expiry() from public, anon, authenticated;

create trigger cap_expiry
  before insert or update of expires_at on public.workspace_invitations
  for each row execute function private.cap_invitation_expiry();

-- F-10 ------------------------------------------------------------------------
revoke insert, update, delete on public.report_progress from authenticated;

-- F-15 ------------------------------------------------------------------------
revoke insert on public.reports from authenticated;
grant insert (id, workspace_id, title, description, due_date) on public.reports to authenticated;
