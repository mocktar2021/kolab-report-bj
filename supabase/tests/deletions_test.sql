begin;
\ir fixtures.psql
select plan(91);

-- KRB-180: deleting a report, a workspace or an organization goes through
-- delete_report, delete_workspace and delete_organization only. Each checks
-- the caller's rights, queues the stored files, deletes the row with what it
-- holds and writes an audit event. Every deletion below runs while billing is
-- enforced and the workspace is read-only, except where a plan is bought to
-- show the billing time lost: read-only never blocks a deletion. Payments
-- and receipts (KRB-176) are accounting records: they stay, without their
-- link to what was deleted.

create temp table kept (name text primary key, id uuid);
grant all on kept to authenticated;
create function pg_temp.kept_id(name text) returns uuid
language sql as $$ select id from kept where kept.name = $1 $$;

-- A purchase paid through FedaPay (the mock), as the checkout and the
-- webhook make it: purchase, entitlement, receipt and its lines, payment
-- events. Terms and prices of src/lib/billing/catalog.ts, as in
-- billing_grant_test.sql. Returns the purchase id.
create temp sequence krb180_transactions start 970000001;
create function pg_temp.buy_and_pay(p_org uuid, p_offer text, p_buyer text, p_ws uuid default null)
returns uuid
language plpgsql as $$
declare
  v_terms jsonb := (case p_offer
    when 'cabinet_1m' then '{"kind": "subscription", "plan": "cabinet", "months": 1, "monthly_price_ht_xof": 49000,
      "limits": {"max_members": 10, "max_reports": null, "drafts_per_month": 250, "drafts_total": null, "custom_templates": true}}'
    when 'mission_pass' then '{"kind": "mission", "plan": "mission", "days": 90,
      "limits": {"max_members": 10, "max_reports": 1, "drafts_per_month": null, "drafts_total": 80, "custom_templates": false}}'
  end)::jsonb;
  v_price bigint := case p_offer when 'cabinet_1m' then 49000 when 'mission_pass' then 39000 end;
  v_purchase uuid;
  v_transaction bigint := nextval('krb180_transactions');
  v_outcome text;
begin
  select c.purchase_id into v_purchase
  from public.billing_create_purchase(p_org, p_offer, p_offer || ' (test)', 1, 1, v_terms, v_price, 0, 'mock',
    pg_temp.id(p_buyer), p_ws, false) c;
  perform public.billing_set_transaction(v_purchase, v_transaction, 'pending');
  select a.outcome into v_outcome
  from public.billing_apply_transaction(v_purchase, 'webhook', v_transaction, 'approved', v_price, 'mock', 'XOF',
    'KR-' || v_purchase::text, null, 'transaction.approved', 'trx_test', 'momo_test', 270, now()) a;
  if v_outcome is distinct from 'granted' then
    raise exception 'purchase % not granted: %', v_purchase, v_outcome;
  end if;
  return v_purchase;
end;
$$;

-- The lines of the receipts of some purchases, to compare before and after.
create function pg_temp.receipt_lines(p_purchases uuid[]) returns setof text
language sql as $$
  select to_jsonb(l)::text
  from public.billing_receipt_lines l
  join public.billing_receipts r on r.id = l.receipt_id
  where r.purchase_id = any (p_purchases)
  order by r.number, l.position
$$;

-- Paths queued under a workspace.
create function pg_temp.queued(ws uuid) returns table (bucket text, path text)
language sql as $$
  select q.bucket, q.path from private.storage_cleanup_queue q
  where q.path like ws::text || '/%' order by q.bucket, q.path
$$;

-- Paths of the fixture workspaces queued by other work on this database do
-- not count here. Rolled back with the rest.
delete from private.storage_cleanup_queue
where path like pg_temp.id('w1')::text || '/%' or path like pg_temp.id('w2')::text || '/%';

grant execute on all functions in schema pg_temp to authenticated, anon;

select pg_temp.act_as_server();
create temp table before as
select
  (select count(*) from private.billing_events where organization_id = pg_temp.id('org_a')) as org_a_events,
  (select count(*) from private.audit_events) as audit_events;

-- Billing enforced, and no entitlement left: both organizations are read-only.
update private.billing_settings set enforced = true;
update public.billing_entitlements set revoked_at = now(), revoked_reason = 'pgTAP'
where organization_id in (pg_temp.id('org_a'), pg_temp.id('org_b')) and revoked_at is null;

select pg_temp.act_as('owner');
select throws_ok($$insert into public.reports (workspace_id, title) values (pg_temp.id('w1'), 'Rapport bloque')$$,
  'KR043', null, 'w1 is read-only for the rest of the file, until a plan is set');

-- Privileges -------------------------------------------------------------------------
select is(
  (select coalesce(array_agg(t order by t), '{}')
   from unnest(array['public.reports', 'public.workspaces', 'public.organizations']) t
   where has_table_privilege('authenticated', t, 'delete')),
  '{}'::text[], 'signed-in users have no DELETE on reports, workspaces and organizations');
select throws_ok($$delete from public.reports where id = pg_temp.id('r1')$$,
  '42501', null, 'an owner cannot delete a report directly');
select throws_ok($$delete from public.workspaces where id = pg_temp.id('w1')$$,
  '42501', null, 'nor a workspace');
select throws_ok($$delete from public.organizations where id = pg_temp.id('org_a')$$,
  '42501', null, 'nor an organization');
select is(
  (select coalesce(array_agg(f || ' ' || r order by f, r), '{}')
   from unnest(array[
     'public.delete_report(uuid, text)', 'public.delete_workspace(uuid, text)',
     'public.delete_organization(uuid, text)', 'public.report_deletion_preview(uuid)',
     'public.workspace_deletion_preview(uuid)', 'public.organization_deletion_preview(uuid)']) f,
        unnest(array['anon', 'authenticated']) r
   where has_function_privilege(r, f, 'execute')),
  array[
    'public.delete_organization(uuid, text) authenticated', 'public.delete_report(uuid, text) authenticated',
    'public.delete_workspace(uuid, text) authenticated', 'public.organization_deletion_preview(uuid) authenticated',
    'public.report_deletion_preview(uuid) authenticated', 'public.workspace_deletion_preview(uuid) authenticated'],
  'signed-in users call the functions, visitors do not');
select is(
  (select count(*)::integer
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'private'
     and p.proname in ('report_contents', 'workspace_contents', 'billing_time_left', 'queue_scope_files',
                       'lock_workspace_drafts', 'confirmation_matches')
     and (has_function_privilege('authenticated', p.oid, 'execute') or has_function_privilege('anon', p.oid, 'execute'))),
  0, 'the private helpers are not callable by users');
select is(
  (select coalesce(array_agg(p.proname::text order by p.proname), '{}')
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in ('delete_report', 'delete_workspace', 'delete_organization', 'report_deletion_preview',
                       'workspace_deletion_preview', 'organization_deletion_preview')
     and not (p.prosecdef and p.proconfig @> array['search_path=""'])),
  '{}'::text[], 'every function is security definer with an empty search_path');
select is(
  (select coalesce(array_agg(r || ' ' || p order by r, p), '{}')
   from unnest(array['anon', 'authenticated', 'service_role']) r,
        unnest(array['select', 'insert', 'update', 'delete']) p
   where has_table_privilege(r, 'private.audit_events', p)),
  '{}'::text[], 'nobody but the functions touches the audit log');

-- Deleting a report ------------------------------------------------------------------------
-- r1 gets a sent file, a stored export, an export file that no row records
-- (its request died), and a finished AI draft of s1 counted in the ledger.
select pg_temp.act_as_server();
insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, uploaded_at, created_at)
values (pg_temp.id('w1'), pg_temp.id('s2'), pg_temp.id('expert2'),
        pg_temp.id('w1') || '/' || pg_temp.id('s2') || '/a-mesures.csv', 'mesures.csv', 'text/csv', 10,
        now() - interval '3 days', now() - interval '3 days');
insert into public.report_exports (workspace_id, report_id, format, file_name, status, storage_path, size_bytes, section_count, finished_at, created_by)
values (pg_temp.id('w1'), pg_temp.id('r1'), 'pdf', 'rapport-a.pdf', 'ready',
        pg_temp.id('w1') || '/' || pg_temp.id('r1') || '/export-a.pdf', 100, 3, now(), pg_temp.id('admin'));
insert into storage.objects (bucket_id, name)
values ('exports', pg_temp.id('w1') || '/' || pg_temp.id('r1') || '/perdu.pdf');
with g as (
  insert into public.ai_generations (workspace_id, section_id, requested_by, output_schema, schema_version,
    provider, model, estimated_tokens, status, output, completed_at)
  values (pg_temp.id('w1'), pg_temp.id('s1'), pg_temp.id('expert'), 'section_draft', 1, 'mock', 'mock', 100,
    'succeeded', '{"title": "Brouillon"}', now())
  returning id
)
insert into kept select 'generation', id from g;
insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, usage_month, status, settled_at)
values (pg_temp.kept_id('generation'), pg_temp.id('org_a'), pg_temp.id('w1'), 'trial',
        date_trunc('month', now() at time zone 'utc')::date, 'counted', now());

select pg_temp.act_as_anon();
select throws_ok($$select public.delete_report(pg_temp.id('r1'))$$, '42501', null, 'a visitor cannot delete a report');

select pg_temp.act_as('stranger');
select throws_ok($$select public.delete_report(pg_temp.id('r1'))$$, 'P0002', null,
  'someone outside the workspace gets "not found"');
select pg_temp.act_as('outsider');
select throws_ok($$select public.delete_report(pg_temp.id('r1'))$$, 'P0002', null,
  'the owner of another workspace cannot delete it either');
select is(public.report_deletion_preview(pg_temp.id('r1')), null, 'nor see what it holds');
select pg_temp.act_as('viewer');
select throws_ok($$select public.delete_report(pg_temp.id('r1'))$$, '42501', null, 'a viewer cannot delete a report');
select pg_temp.act_as('expert');
select throws_ok($$select public.delete_report(pg_temp.id('r1'))$$, '42501', null, 'an expert cannot delete a report');
select is(public.report_deletion_preview(pg_temp.id('r1')), null, 'nor see the preview');
select pg_temp.act_as('owner');
select throws_ok($$select public.delete_report(pg_temp.id('r2'))$$, 'P0002', null,
  'an owner of w1 cannot delete a report of w2');

select pg_temp.act_as('admin');
select is(
  public.report_deletion_preview(pg_temp.id('r1')) - 'report_id' - 'workspace_id',
  '{"title": "Rapport A", "status": "draft", "sections": 3, "files": 1, "exports": 1}'::jsonb,
  'an admin sees what the report holds: sent files and stored exports');
select is(
  public.delete_report(pg_temp.id('r1')),
  '{"status": "draft", "actor_role": "admin", "sections": 3, "files": 1, "exports": 1, "files_queued": 4}'::jsonb,
  'an admin deletes a report that is not final, without typing its title');

select pg_temp.act_as_server();
select is((select count(*)::integer from public.reports where id = pg_temp.id('r1')), 0, 'the report is gone');
select is((select count(*)::integer from public.report_sections where report_id = pg_temp.id('r1')), 0,
  'with its sections');
select is((select count(*)::integer from public.deliverables where workspace_id = pg_temp.id('w1')), 0,
  'its files');
select is((select count(*)::integer from public.report_exports where report_id = pg_temp.id('r1')), 0,
  'and its exports');
select results_eq($$select * from pg_temp.queued(pg_temp.id('w1'))$$,
  $$values ('deliverables', pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/d1-plan.docx'),
           ('deliverables', pg_temp.id('w1') || '/' || pg_temp.id('s2') || '/a-mesures.csv'),
           ('exports', pg_temp.id('w1') || '/' || pg_temp.id('r1') || '/export-a.pdf'),
           ('exports', pg_temp.id('w1') || '/' || pg_temp.id('r1') || '/perdu.pdf')$$,
  'every stored file is queued for the cleanup job, the one no row recorded included');
select ok(
  (select q.not_before >= now() + interval '2 hours'
   from private.storage_cleanup_queue q where q.path = pg_temp.id('w1') || '/' || pg_temp.id('s1') || '/d1-plan.docx'),
  'a file registered just now waits for its upload window');
select results_eq(
  $$select section_id, workspace_id from public.ai_generations where id = pg_temp.kept_id('generation')$$,
  $$values (null::uuid, pg_temp.id('w1'))$$,
  'the AI draft stays without its section, so its tokens still count');
select is((select status from public.billing_draft_usage where generation_id = pg_temp.kept_id('generation')),
  'counted', 'and so does the draft in the ledger');
select results_eq(
  $$select action, actor_id, organization_id, workspace_id, report_id, details ->> 'status', details ->> 'actor_role'
    from private.audit_events where report_id = pg_temp.id('r1')$$,
  $$values ('report_deleted', pg_temp.id('admin'), pg_temp.id('org_a'), pg_temp.id('w1'), pg_temp.id('r1'),
            'draft', 'admin')$$,
  'the deletion is in the audit log, with who did it');

-- A final report: owners only, after typing its title.
insert into public.reports (id, workspace_id, title, created_by)
values ('00000000-0000-4000-d000-000000000003', pg_temp.id('w1'), 'Rapport final 2026', pg_temp.id('owner'));
insert into public.report_sections (workspace_id, report_id, title)
values (pg_temp.id('w1'), '00000000-0000-4000-d000-000000000003', 'Conclusion');
update public.reports set status = 'final' where id = '00000000-0000-4000-d000-000000000003';

select pg_temp.act_as('admin');
select is(public.report_deletion_preview('00000000-0000-4000-d000-000000000003') ->> 'status', 'final',
  'the preview tells the report is final');
select throws_ok($$select public.delete_report('00000000-0000-4000-d000-000000000003', 'Rapport final 2026')$$,
  '42501', null, 'an admin cannot delete a final report, even with its title');
select pg_temp.act_as('owner');
select throws_ok($$select public.delete_report('00000000-0000-4000-d000-000000000003')$$,
  'KR070', null, 'an owner must type the title of a final report');
select throws_ok($$select public.delete_report('00000000-0000-4000-d000-000000000003', 'rapport final 2026')$$,
  'KR070', null, 'case counts');
select throws_ok($$select public.delete_report('00000000-0000-4000-d000-000000000003', 'Rapport final')$$,
  'KR070', null, 'part of the title is not enough');
select is(
  public.delete_report('00000000-0000-4000-d000-000000000003', '  Rapport final 2026 ') ->> 'status', 'final',
  'the exact title, spaces around it aside, deletes it');
select pg_temp.act_as_server();
select is((select count(*)::integer from public.reports where id = '00000000-0000-4000-d000-000000000003'), 0,
  'the final report is gone');
select is((select details ->> 'actor_role' from private.audit_events
           where report_id = '00000000-0000-4000-d000-000000000003'), 'owner', 'and the log says an owner did it');

-- Deleting a workspace ----------------------------------------------------------------------
-- w2 (org_b, read-only) gets a file, an export, an invitation, a template, a
-- counted draft, and a second member. Mission B, a workspace of org_b, gets
-- a Pass Mission bought and paid, which makes it a mission workspace.
insert into public.workspace_members (workspace_id, user_id, role)
values (pg_temp.id('w2'), pg_temp.id('expert'), 'admin');
insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, uploaded_at, created_at)
values (pg_temp.id('w2'), pg_temp.id('s4'), pg_temp.id('outsider'),
        pg_temp.id('w2') || '/' || pg_temp.id('s4') || '/c-synthese.docx', 'synthese.docx',
        'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 10,
        now() - interval '1 day', now() - interval '1 day');
insert into public.report_exports (workspace_id, report_id, format, file_name, status, storage_path, size_bytes, section_count, finished_at)
values (pg_temp.id('w2'), pg_temp.id('r2'), 'docx', 'rapport-b.docx', 'ready',
        pg_temp.id('w2') || '/' || pg_temp.id('r2') || '/export-b.docx', 100, 1, now());
insert into public.workspace_invitations (workspace_id, email, role, token_hash, invited_by)
values (pg_temp.id('w2'), 'invite@kolabreport.test', 'expert', repeat('a', 64), pg_temp.id('outsider'));
insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, usage_month, status, settled_at)
values (gen_random_uuid(), pg_temp.id('org_b'), pg_temp.id('w2'), 'trial',
        date_trunc('month', now() at time zone 'utc')::date, 'counted', now());
insert into public.workspaces (id, organization_id, name, created_by)
values ('00000000-0000-4000-c000-000000000009', pg_temp.id('org_b'), 'Mission B', pg_temp.id('outsider'));
insert into kept
select 'pass_purchase',
  pg_temp.buy_and_pay(pg_temp.id('org_b'), 'mission_pass', 'outsider', '00000000-0000-4000-c000-000000000009');
insert into kept select 'pass', e.id from public.billing_entitlements e where e.purchase_id = pg_temp.kept_id('pass_purchase');

select pg_temp.act_as('admin');
select throws_ok($$select public.delete_workspace(pg_temp.id('w2'), 'Etude B')$$, 'P0002', null,
  'a member of w1 cannot delete w2');
select pg_temp.act_as('expert');
select throws_ok($$select public.delete_workspace(pg_temp.id('w2'), 'Etude B')$$, '42501', null,
  'an admin of w2 cannot delete it');
select is(public.workspace_deletion_preview(pg_temp.id('w2')), null, 'nor see its preview');
select throws_ok($$select public.delete_workspace(pg_temp.id('w1'), 'Etude A')$$, '42501', null,
  'an expert of w1 cannot delete w1');
select pg_temp.act_as('outsider');
select throws_ok($$select public.delete_workspace(pg_temp.id('w2'), 'Etude')$$, 'KR070', null,
  'its owner must type its exact name');
select is(
  public.workspace_deletion_preview(pg_temp.id('w2')) - 'workspace_id' - 'organization_id',
  '{"name": "Etude B", "organization_name": "Cabinet B", "billing_mode": "subscription", "passes": [],
    "reports": 1, "final_reports": 0, "sections": 1, "files": 1, "exports": 1, "members": 2,
    "invitations": 1, "templates": 1}'::jsonb,
  'the owner sees what the workspace holds');
select is(
  public.delete_workspace(pg_temp.id('w2'), 'Etude B') - 'passes' - 'billing_mode',
  '{"actor_role": "owner", "reports": 1, "final_reports": 0, "sections": 1, "files": 1, "exports": 1,
    "members": 2, "invitations": 1, "templates": 1, "files_queued": 2}'::jsonb,
  'the owner deletes the read-only workspace');

select pg_temp.act_as_server();
select is((select count(*)::integer from public.workspaces where id = pg_temp.id('w2')), 0, 'w2 is gone');
select is(
  (select count(*)::integer from public.workspace_members where workspace_id = pg_temp.id('w2'))
  + (select count(*)::integer from public.reports where workspace_id = pg_temp.id('w2'))
  + (select count(*)::integer from public.workspace_invitations where workspace_id = pg_temp.id('w2'))
  + (select count(*)::integer from public.prompt_library where workspace_id = pg_temp.id('w2'))
  + (select count(*)::integer from public.report_exports where workspace_id = pg_temp.id('w2')),
  0, 'with its members, reports, invitations, templates and exports');
select results_eq($$select * from pg_temp.queued(pg_temp.id('w2'))$$,
  $$values ('deliverables', pg_temp.id('w2') || '/' || pg_temp.id('s4') || '/c-synthese.docx'),
           ('exports', pg_temp.id('w2') || '/' || pg_temp.id('r2') || '/export-b.docx')$$,
  'its stored files are queued');
select results_eq(
  $$select workspace_id, status from public.billing_draft_usage where organization_id = pg_temp.id('org_b')$$,
  $$values (null::uuid, 'counted')$$,
  'its drafts stay in the organization''s ledger, so deleting a workspace gives none back');
select is((select count(*)::integer from public.organizations where id = pg_temp.id('org_b')), 1,
  'the organization stays');
select is((select count(*)::integer from public.organization_billing where organization_id = pg_temp.id('org_b')), 1,
  'with its buyer row');
select results_eq(
  $$select action, actor_id, organization_id, workspace_id, report_id from private.audit_events
    where workspace_id = pg_temp.id('w2')$$,
  $$values ('workspace_deleted', pg_temp.id('outsider'), pg_temp.id('org_b'), pg_temp.id('w2'), null::uuid)$$,
  'the audit log has the workspace deletion');

-- A mission workspace loses its pass.
select pg_temp.act_as('outsider');
select is(
  jsonb_array_length(public.workspace_deletion_preview('00000000-0000-4000-c000-000000000009') -> 'passes'), 1,
  'the preview of a mission workspace shows its running pass');
select is(
  public.delete_workspace('00000000-0000-4000-c000-000000000009', 'Mission B') -> 'passes' -> 0 ->> 'entitlement_id',
  pg_temp.kept_id('pass')::text, 'deleting it records the pass it loses');
select pg_temp.act_as_server();
select is((select count(*)::integer from public.billing_entitlements where id = pg_temp.kept_id('pass')),
  0, 'the pass goes with its workspace');
select results_eq(
  $$select organization_id, workspace_id, status from public.billing_purchases where id = pg_temp.kept_id('pass_purchase')$$,
  $$values (pg_temp.id('org_b'), null::uuid, 'paid')$$,
  'its purchase stays, without the workspace');
select is(
  (select count(*)::integer from public.billing_receipts
   where purchase_id = pg_temp.kept_id('pass_purchase') and organization_id = pg_temp.id('org_b')),
  1, 'and so does its receipt, still read by the organization''s billing readers');

-- Deleting an organization ----------------------------------------------------------------
-- org_a: w1, and w3 made by the admin, where the organization owner is not a
-- member. A Cabinet month bought and paid, and a Pack IA with drafts left.
insert into public.workspaces (id, organization_id, name, created_by)
values ('00000000-0000-4000-c000-000000000003', pg_temp.id('org_a'), 'Etude C', pg_temp.id('admin')),
       ('00000000-0000-4000-c000-000000000004', pg_temp.id('org_a'), 'Etude D', pg_temp.id('admin'));
insert into public.reports (id, workspace_id, title, created_by)
values ('00000000-0000-4000-d000-000000000004', pg_temp.id('w1'), 'Rapport D', pg_temp.id('owner'));
insert into public.report_sections (id, workspace_id, report_id, title)
values ('00000000-0000-4000-e000-000000000005', pg_temp.id('w1'), '00000000-0000-4000-d000-000000000004', 'Annexe');
insert into public.deliverables (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes, uploaded_at)
values (pg_temp.id('w1'), '00000000-0000-4000-e000-000000000005', pg_temp.id('owner'),
        pg_temp.id('w1') || '/00000000-0000-4000-e000-000000000005/e-annexe.pdf',
        'annexe.pdf', 'application/pdf', 10, now());
insert into kept select 'cabinet_purchase', pg_temp.buy_and_pay(pg_temp.id('org_a'), 'cabinet_1m', 'owner');
insert into kept select 'cabinet', e.id from public.billing_entitlements e where e.purchase_id = pg_temp.kept_id('cabinet_purchase');
insert into public.billing_ai_packs (id, organization_id, drafts, expires_at)
values ('00000000-0000-4000-8000-000000000041', pg_temp.id('org_a'), 100, now() + interval '11 months');
insert into public.billing_draft_usage (generation_id, organization_id, workspace_id, pool, pack_id, usage_month, status, settled_at)
select gen_random_uuid(), pg_temp.id('org_a'), pg_temp.id('w1'), 'pack', '00000000-0000-4000-8000-000000000041',
  date_trunc('month', now() at time zone 'utc')::date, 'counted', now()
from generate_series(1, 30);

-- The organization owner deletes one workspace they are not a member of.
select pg_temp.act_as('outsider');
select throws_ok($$select public.delete_workspace('00000000-0000-4000-c000-000000000004', 'Etude D')$$, 'P0002', null,
  'the owner of another organization cannot delete a workspace of org_a');
select pg_temp.act_as('owner');
select is(public.workspace_deletion_preview('00000000-0000-4000-c000-000000000004') ->> 'name', 'Etude D',
  'the organization owner sees what a workspace they are not in holds');
select throws_ok($$select public.delete_workspace('00000000-0000-4000-c000-000000000004', 'Etude')$$, 'KR070', null,
  'and types its exact name to delete it');
select is(public.delete_workspace('00000000-0000-4000-c000-000000000004', 'Etude D') ->> 'actor_role',
  'organization_owner', 'the organization owner deletes it, and the log says how they could');
select pg_temp.act_as_server();
select is((select count(*)::integer from public.workspaces where id = '00000000-0000-4000-c000-000000000004'), 0,
  'that workspace is gone, the organization stays');

select pg_temp.act_as('admin');
select is(public.organization_deletion_preview(pg_temp.id('org_a')), null,
  'an owner of a workspace of the organization does not see the preview');
select throws_ok($$select public.delete_organization(pg_temp.id('org_a'), 'Cabinet A')$$, '42501', null,
  'nor deletes the organization');
select pg_temp.act_as('outsider');
select throws_ok($$select public.delete_organization(pg_temp.id('org_a'), 'Cabinet A')$$, 'P0002', null,
  'the owner of another organization gets "not found"');
select pg_temp.act_as('owner');
select throws_ok($$select public.delete_organization(pg_temp.id('org_b'), 'Cabinet B')$$, 'P0002', null,
  'and so does the owner of org_a for org_b');
select is(
  (select array_agg(w ->> 'name' order by w ->> 'name')
   from jsonb_array_elements(public.organization_deletion_preview(pg_temp.id('org_a')) -> 'workspaces') w),
  array['Etude A', 'Etude C'], 'the owner sees every workspace that goes, the ones they are not in included');
select results_eq(
  $$select p -> 'billing' -> 'subscription' -> 0 ->> 'plan', p -> 'billing' -> 'packs' -> 0 ->> 'drafts_left',
      p ->> 'reports', p ->> 'members', p ->> 'receipts'
    from public.organization_deletion_preview(pg_temp.id('org_a')) p$$,
  $$values ('cabinet', '70', '1', '5', '1')$$,
  'and the billing time it loses (the Cabinet period, 70 drafts of the pack), and its receipt');
select throws_ok($$select public.delete_organization(pg_temp.id('org_a'), 'Cabinet')$$, 'KR070', null,
  'the owner must type its exact name');
reset role;
create temp table org_a_before as
select
  (select count(*) from private.billing_events where organization_id = pg_temp.id('org_a')) as billing_events,
  (select count(*) from private.billing_payment_events where purchase_id = pg_temp.kept_id('cabinet_purchase'))
    as payment_events,
  array(select pg_temp.receipt_lines(array[pg_temp.kept_id('cabinet_purchase')])) as lines;
select pg_temp.act_as('owner');
select results_eq(
  $$select d ->> 'workspaces', d ->> 'reports', d -> 'billing_lost' -> 'subscription' -> 0 ->> 'entitlement_id',
      d ->> 'files_queued'
    from public.delete_organization(pg_temp.id('org_a'), 'Cabinet A') d$$,
  $$values ('2', '1', pg_temp.kept_id('cabinet')::text, '2')$$,
  'the owner deletes the organization, and its stored files are queued, the old orphan of r1 included');

select pg_temp.act_as_server();
select is((select count(*)::integer from public.organizations where id = pg_temp.id('org_a')), 0,
  'the organization is gone');
select is((select count(*)::integer from public.workspaces where id in (pg_temp.id('w1'), '00000000-0000-4000-c000-000000000003')),
  0, 'with every workspace, w3 included');
select is((select count(*)::integer from public.workspace_members where workspace_id = pg_temp.id('w1')), 0,
  'and their members');
select is(
  (select count(*)::integer from public.organization_billing where organization_id = pg_temp.id('org_a'))
  + (select count(*)::integer from public.billing_entitlements where organization_id = pg_temp.id('org_a'))
  + (select count(*)::integer from public.billing_ai_packs where organization_id = pg_temp.id('org_a'))
  + (select count(*)::integer from public.billing_draft_usage where organization_id = pg_temp.id('org_a')),
  0, 'its buyer row, entitlements, packs and draft ledger go with it');
select is((select count(*)::integer from private.billing_events where organization_id = pg_temp.id('org_a')),
  (select billing_events::integer from org_a_before), 'the billing audit log keeps its history');
select results_eq(
  $$select organization_id, workspace_id, status from public.billing_purchases where id = pg_temp.kept_id('cabinet_purchase')$$,
  $$values (null::uuid, null::uuid, 'paid')$$,
  'its purchase stays, without the organization');
select results_eq(
  $$select count(*)::integer, count(organization_id)::integer, min(buyer ->> 'name') from public.billing_receipts
    where purchase_id = pg_temp.kept_id('cabinet_purchase')$$,
  $$values (1, 0, 'Cabinet A')$$,
  'so does its receipt, without the link, with its copy of the buyer');
select is(array(select pg_temp.receipt_lines(array[pg_temp.kept_id('cabinet_purchase')])),
  (select lines from org_a_before), 'the receipt lines do not change');
select is((select count(*) from private.billing_payment_events where purchase_id = pg_temp.kept_id('cabinet_purchase')),
  (select payment_events from org_a_before), 'nor do the payment events');
select is((select organization_id from private.billing_trial_claims where user_id = pg_temp.id('owner')),
  pg_temp.id('org_a'), 'and the trial claim stays, so a new organization of the owner gets no trial');
select ok(
  exists (select 1 from pg_temp.queued(pg_temp.id('w1')) q where q.path like '%/e-annexe.pdf'),
  'the files of its workspaces are queued');
select results_eq(
  $$select action, actor_id, organization_id, workspace_id,
      (select array_agg(x order by x) from jsonb_array_elements_text(details -> 'workspace_ids') x)
    from private.audit_events where action = 'organization_deleted' and organization_id = pg_temp.id('org_a')$$,
  $$values ('organization_deleted', pg_temp.id('owner'), pg_temp.id('org_a'), null::uuid,
            array[pg_temp.id('w1')::text, '00000000-0000-4000-c000-000000000003'])$$,
  'the audit log has the deletion and the workspaces that went');
select results_eq(
  $$select details -> 'purchase_ids', details ->> 'receipts_kept' from private.audit_events
    where action = 'organization_deleted' and organization_id = pg_temp.id('org_a')$$,
  $$values (jsonb_build_array(pg_temp.kept_id('cabinet_purchase')), '1')$$,
  'and the purchases that lost their link to it');
select is((select count(*)::integer from private.audit_events), (select audit_events::integer from before) + 6,
  'one audit event per deletion so far');
select lives_ok($$delete from auth.users where id = pg_temp.id('owner')$$,
  'the account of the former owner is no longer held by its organization');

-- An organization left with no workspace, read-only, goes too.
select pg_temp.act_as('outsider');
select is(jsonb_array_length(public.organization_deletion_preview(pg_temp.id('org_b')) -> 'workspaces'), 0,
  'org_b has no workspace left');
reset role;
create temp table org_b_lines as
select array(select pg_temp.receipt_lines(array[pg_temp.kept_id('pass_purchase')])) as lines;
select pg_temp.act_as('outsider');
select is(public.delete_organization(pg_temp.id('org_b'), 'Cabinet B') ->> 'workspaces', '0',
  'its owner deletes it');
select pg_temp.act_as_server();
select is((select count(*)::integer from public.organizations where id = pg_temp.id('org_b')), 0, 'org_b is gone');
select results_eq(
  $$select p.organization_id, p.workspace_id, (select count(r.organization_id)::integer from public.billing_receipts r
      where r.purchase_id = p.id)
    from public.billing_purchases p where p.id = pg_temp.kept_id('pass_purchase')$$,
  $$values (null::uuid, null::uuid, 0)$$,
  'the pass purchase and its receipt stay, linked to nothing');
select is(array(select pg_temp.receipt_lines(array[pg_temp.kept_id('pass_purchase')])),
  (select lines from org_b_lines), 'with the same receipt lines');

-- A deletion leaves nothing to undo: the same call again finds nothing.
select pg_temp.act_as('outsider');
select throws_ok($$select public.delete_organization(pg_temp.id('org_b'), 'Cabinet B')$$, 'P0002', null,
  'deleting it again finds nothing');
select throws_ok($$select public.delete_workspace(pg_temp.id('w2'), 'Etude B')$$, 'P0002', null,
  'nor does deleting w2 again');

-- Signed out --------------------------------------------------------------------------------
select pg_temp.act_as_server();
select throws_ok($$select public.delete_report(pg_temp.id('r2'))$$, '42501', null,
  'without a signed-in user, the functions refuse');

select * from finish();
rollback;
