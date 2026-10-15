-- KRB-179, PR 179-3: billing goes live (ADR 001, section 10).
--
-- Runs on staging when merged and on production with the release tag, which
-- is the launch moment. From then on the limits apply, trials end, and
-- unpaid periods turn to grace and read-only.
--
-- Every organization that exists at that moment, and has no paid or manual
-- period running, gets a 30-day launch period with Cabinet limits: they were
-- created when everything was free, and some are above the trial limits. A
-- running trial ends where the launch period starts. Their owners count as
-- having had their trial. One launch_period event per organization keeps the
-- line before and after in the audit log.
--
-- The owner's own organizations go on Institution by hand after the launch,
-- with scripts/billing/grant.mjs, since their ids differ between
-- environments. Production has no organization yet: there, this only turns
-- the switch on.

-- Launch terms. Mirrored in src/lib/billing/catalog.ts (the Cabinet plan):
-- catalog.test.ts reads this function from this file and
-- billing_launch_test.sql reads it from the database, so keep one value per
-- line, written "<value> as <name>".
create or replace function private.billing_launch_terms()
returns table (
  plan              text,
  days              integer,
  max_members       integer,
  max_reports       integer,
  drafts_per_month  integer,
  drafts_total      integer,
  custom_templates  boolean
)
language sql
immutable
set search_path = ''
as $$
  select
    'cabinet' as plan,
    30 as days,
    10 as max_members,
    null::integer as max_reports,
    250 as drafts_per_month,
    null::integer as drafts_total,
    true as custom_templates;
$$;

comment on function private.billing_launch_terms() is
  'Plan, length and limits of the launch period (ADR 001, section 10).';

-- Turns billing on, once. Kept after the launch for billing_launch_test.sql;
-- it refuses to run a second time.
create or replace function private.billing_launch()
returns table (organizations integer, trials_ended integer, launch_periods integer, trial_claims integer)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_now      timestamptz := now();
  v_terms    record;
  v_org      record;
  v_next     timestamptz;
  v_end      timestamptz;
  v_before   jsonb;
  v_trial    uuid;
  v_id       uuid;
  v_orgs     integer := 0;
  v_trials   integer := 0;
  v_periods  integer := 0;
  v_claims   integer := 0;
begin
  if (select s.launched_at from private.billing_settings s) is not null then
    raise exception 'Billing was launched on %', (select s.launched_at from private.billing_settings s)
      using errcode = '55000';
  end if;

  -- No grant, payment or trial of another transaction in between: they all
  -- write billing_entitlements.
  lock table public.billing_entitlements in share row exclusive mode;

  update private.billing_settings set enforced = true, launched_at = v_now;

  select * into v_terms from private.billing_launch_terms();

  for v_org in
    select o.id from public.organizations o order by o.created_at, o.id
  loop
    v_orgs := v_orgs + 1;

    -- The first paid, manual or launch period that has not ended. When it
    -- runs now, the organization keeps it and gets nothing. When it starts
    -- later, the launch period stops where it starts.
    select min(b.starts_at) into v_next
    from public.billing_entitlements b
    where b.organization_id = v_org.id and b.scope = 'subscription'
      and b.plan <> 'trial' and b.revoked_at is null and b.ends_at > v_now;
    if v_next is not null and v_next <= v_now then
      continue;
    end if;

    v_before := private.billing_line_snapshot(v_org.id);
    v_end := least(v_now + make_interval(days => v_terms.days), v_next);

    -- The trial gives way, as it does at a first payment.
    update public.billing_entitlements b set ends_at = v_now
    where b.organization_id = v_org.id and b.scope = 'subscription' and b.plan = 'trial'
      and b.revoked_at is null and b.starts_at < v_now and b.ends_at > v_now
    returning b.id into v_trial;
    update public.billing_entitlements b
    set revoked_at = v_now, revoked_reason = 'Essai remplacé par la période de lancement'
    where b.organization_id = v_org.id and b.scope = 'subscription' and b.plan = 'trial'
      and b.revoked_at is null and b.starts_at >= v_now;
    if v_trial is not null then
      v_trials := v_trials + 1;
    end if;

    insert into public.billing_entitlements (
      organization_id, scope, plan, source, starts_at, ends_at,
      max_members, max_reports, drafts_per_month, drafts_total, custom_templates, amount_ht_xof, note
    ) values (
      v_org.id, 'subscription', v_terms.plan, 'launch', v_now, v_end,
      v_terms.max_members, v_terms.max_reports, v_terms.drafts_per_month, v_terms.drafts_total,
      v_terms.custom_templates, 0, 'Période de lancement'
    )
    returning id into v_id;
    v_periods := v_periods + 1;

    insert into private.billing_events (organization_id, kind, details)
    values (v_org.id, 'launch_period', jsonb_build_object(
      'entitlement_id', v_id,
      'plan', v_terms.plan,
      'starts_at', v_now,
      'ends_at', v_end,
      'trial_ended', v_trial,
      'before', v_before,
      'after', private.billing_line_snapshot(v_org.id)
    ));
  end loop;

  -- Every owner counts as having had a trial, for the organization they
  -- created first. An owner who already has a claim, or whose e-mail has one,
  -- keeps it.
  with claims as (
    insert into private.billing_trial_claims (user_id, email_hash, organization_id)
    select distinct on (o.owner_id)
      o.owner_id,
      (select encode(sha256(convert_to(lower(btrim(u.email)), 'UTF8')), 'hex')
       from auth.users u
       where u.id = o.owner_id and nullif(btrim(u.email), '') is not null),
      o.id
    from public.organizations o
    order by o.owner_id, o.created_at, o.id
    on conflict do nothing
    returning 1
  )
  select count(*)::integer into v_claims from claims;

  return query select v_orgs, v_trials, v_periods, v_claims;
end;
$$;

comment on function private.billing_launch() is
  'Turns billing on and gives existing organizations their launch period (ADR 001, section 10). Runs once.';

revoke all on function private.billing_launch_terms() from public, anon, authenticated;
revoke all on function private.billing_launch() from public, anon, authenticated, service_role;

select * from private.billing_launch();
