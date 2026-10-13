-- =============================================================================
-- KolabReport: workspace invitations (Story KRB-12)
--
-- Owners and admins invite someone by e-mail with a role. The e-mail carries
-- a random token; only its SHA-256 is stored. An invitation is valid 7 days
-- and can be used once.
--
-- The invitee joins either with the link (accept_workspace_invitation) or
-- when they sign in with that e-mail address confirmed
-- (accept_my_pending_invitations). Both only work for the address the
-- invitation was sent to.
--
-- Custom error codes, mapped to French messages in the app:
--   KR003  unknown or revoked invitation link
--   KR004  invitation already used
--   KR005  invitation expired
--   KR006  invitation sent to another e-mail address
--   KR007  that person is already a member of the workspace
-- =============================================================================

create table public.workspace_invitations (
  id            uuid primary key default gen_random_uuid(),
  workspace_id  uuid not null references public.workspaces (id) on delete cascade,
  email         text not null check (email = lower(btrim(email)) and email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  role          public.workspace_role not null default 'expert',
  -- SHA-256 (hex) of the token in the e-mail link. The token is never stored.
  token_hash    text not null unique check (token_hash ~ '^[0-9a-f]{64}$'),
  invited_by    uuid not null default auth.uid() references public.profiles (id) on delete cascade,
  expires_at    timestamptz not null default now() + interval '7 days',
  accepted_at   timestamptz,
  accepted_by   uuid references public.profiles (id) on delete set null,
  revoked_at    timestamptz,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index workspace_invitations_workspace_id_idx on public.workspace_invitations (workspace_id);
create index workspace_invitations_email_idx on public.workspace_invitations (email);
-- One open invitation per person and workspace.
create unique index workspace_invitations_one_open_idx
  on public.workspace_invitations (workspace_id, email)
  where accepted_at is null and revoked_at is null;

create trigger set_updated_at before update on public.workspace_invitations
  for each row execute function private.set_updated_at();

-- Memberships now record who invited them. Deleting that person's account
-- must not be blocked by it.
alter table public.workspace_members
  drop constraint workspace_members_invited_by_fkey,
  add constraint workspace_members_invited_by_fkey
    foreign key (invited_by) references public.profiles (id) on delete set null;

-- -----------------------------------------------------------------------------
-- Helpers
-- -----------------------------------------------------------------------------
create or replace function private.invitation_token_hash(token text)
returns text
language sql
immutable
set search_path = ''
as $$
  select encode(sha256(convert_to(coalesce(token, ''), 'UTF8')), 'hex');
$$;

-- Confirmed e-mail of the signed-in user, lower case. Null when signed out or
-- not confirmed yet.
create or replace function private.my_confirmed_email()
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select lower(u.email) from auth.users u
  where u.id = (select auth.uid()) and u.email_confirmed_at is not null;
$$;

-- Adds the member (keeping the role of someone who joined in the meantime)
-- and marks the invitation as used.
create or replace function private.join_from_invitation(invitation_id uuid, member uuid)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_workspace uuid;
begin
  insert into public.workspace_members (workspace_id, user_id, role, invited_by)
  select i.workspace_id, member, i.role, i.invited_by
  from public.workspace_invitations i
  where i.id = invitation_id
  on conflict (workspace_id, user_id) do nothing;

  update public.workspace_invitations
  set accepted_at = now(), accepted_by = member
  where id = invitation_id
  returning workspace_id into v_workspace;

  return v_workspace;
end;
$$;

-- Nobody is invited to a workspace they already belong to. Only checked for
-- the workspace's owners and admins: this trigger runs before RLS, and
-- answering anyone else would let them test who is a member.
create or replace function private.check_invitation_target()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if not private.is_workspace_manager(new.workspace_id) then
    return new;
  end if;
  if exists (
    select 1
    from public.workspace_members m
    join auth.users u on u.id = m.user_id
    where m.workspace_id = new.workspace_id and lower(u.email) = new.email
  ) then
    raise exception 'Cette personne est déjà membre de l''espace de travail' using errcode = 'KR007';
  end if;
  return new;
end;
$$;

create trigger check_invitation_target
  before insert on public.workspace_invitations
  for each row execute function private.check_invitation_target();

-- -----------------------------------------------------------------------------
-- Row-Level Security: owners and admins manage invitations; only owners
-- invite owners. Invitees never read the table, they go through the
-- functions below.
-- -----------------------------------------------------------------------------
alter table public.workspace_invitations enable row level security;

create policy "workspace_invitations: managers read"
  on public.workspace_invitations for select to authenticated
  using (private.is_workspace_manager(workspace_id));

create policy "workspace_invitations: managers invite"
  on public.workspace_invitations for insert to authenticated
  with check (
    private.is_workspace_manager(workspace_id)
    and invited_by = (select auth.uid())
    and accepted_at is null
    and accepted_by is null
    and revoked_at is null
    and (role <> 'owner' or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  );

-- Resend (new token and expiry) and revoke, on open invitations only. A
-- revoked invitation stays revoked.
create policy "workspace_invitations: managers resend or revoke"
  on public.workspace_invitations for update to authenticated
  using (
    private.is_workspace_manager(workspace_id)
    and accepted_at is null
    and revoked_at is null
    and (role <> 'owner' or private.has_workspace_role(workspace_id, array['owner']::public.workspace_role[]))
  )
  with check (private.is_workspace_manager(workspace_id));

revoke update, delete on public.workspace_invitations from authenticated;
grant update (token_hash, expires_at, revoked_at) on public.workspace_invitations to authenticated;

-- -----------------------------------------------------------------------------
-- Functions for the invitee
-- -----------------------------------------------------------------------------

-- What the invitation page shows. Callable without a session: the token is
-- the proof. Unknown tokens return no row.
create or replace function public.invitation_preview(token text)
returns table (
  status text,
  email text,
  role public.workspace_role,
  workspace_name text,
  organization_name text,
  invited_by_name text,
  expires_at timestamptz
)
language sql
stable
security definer
set search_path = ''
as $$
  select
    case
      when i.revoked_at is not null then 'revoked'
      when i.accepted_at is not null then 'accepted'
      when i.expires_at <= now() then 'expired'
      else 'pending'
    end,
    i.email,
    i.role,
    w.name,
    o.name,
    coalesce(nullif(btrim(p.full_name), ''), p.email),
    i.expires_at
  from public.workspace_invitations i
  join public.workspaces w on w.id = i.workspace_id
  join public.organizations o on o.id = w.organization_id
  left join public.profiles p on p.id = i.invited_by
  where i.token_hash = private.invitation_token_hash(token);
$$;

-- Accepts one invitation from its link. Returns the workspace id. Opening the
-- link again after accepting it just returns the workspace.
create or replace function public.accept_workspace_invitation(token text)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_email text := private.my_confirmed_email();
  v_inv   public.workspace_invitations%rowtype;
begin
  if v_user is null then
    raise exception 'Connexion requise' using errcode = '42501';
  end if;

  select * into v_inv
  from public.workspace_invitations i
  where i.token_hash = private.invitation_token_hash(token)
  for update;

  if not found or v_inv.revoked_at is not null then
    raise exception 'Ce lien d''invitation n''est pas valide' using errcode = 'KR003';
  end if;
  if v_inv.accepted_at is not null then
    if v_inv.accepted_by = v_user then
      return v_inv.workspace_id;
    end if;
    raise exception 'Cette invitation a déjà été utilisée' using errcode = 'KR004';
  end if;
  if v_inv.expires_at <= now() then
    raise exception 'Cette invitation a expiré' using errcode = 'KR005';
  end if;
  if v_email is null or v_email <> v_inv.email then
    raise exception 'Cette invitation est destinée à une autre adresse e-mail' using errcode = 'KR006';
  end if;

  return private.join_from_invitation(v_inv.id, v_user);
end;
$$;

-- Accepts every open invitation sent to the signed-in user's confirmed
-- e-mail. Called right after sign-in and e-mail confirmation, so someone
-- invited before having an account joins on first login. Returns how many.
create or replace function public.accept_my_pending_invitations()
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_user  uuid := (select auth.uid());
  v_email text := private.my_confirmed_email();
  v_id    uuid;
  v_count integer := 0;
begin
  if v_user is null or v_email is null then
    return 0;
  end if;

  for v_id in
    select i.id
    from public.workspace_invitations i
    where i.email = v_email
      and i.accepted_at is null
      and i.revoked_at is null
      and i.expires_at > now()
    order by i.created_at
    for update skip locked
  loop
    perform private.join_from_invitation(v_id, v_user);
    v_count := v_count + 1;
  end loop;

  return v_count;
end;
$$;

revoke all on function private.invitation_token_hash(text) from public;
revoke all on function private.my_confirmed_email() from public;
revoke all on function private.join_from_invitation(uuid, uuid) from public;
revoke all on function private.check_invitation_target() from public;

revoke all on function public.invitation_preview(text) from public;
grant execute on function public.invitation_preview(text) to anon, authenticated;
revoke all on function public.accept_workspace_invitation(text) from public, anon;
grant execute on function public.accept_workspace_invitation(text) to authenticated;
revoke all on function public.accept_my_pending_invitations() from public, anon;
grant execute on function public.accept_my_pending_invitations() to authenticated;
