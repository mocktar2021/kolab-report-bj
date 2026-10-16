begin;
\ir fixtures.psql
select plan(51);

-- "Rédiger avec l'IA" on the new template page (KRB-198): the ledger of the
-- calls, the daily limit per user, the plan rules, who reads the rows, the
-- dashboard figures and the daily cost alert.

update private.billing_settings set enforced = true;

create temp table call (name text primary key, id uuid);
grant all on call to authenticated;

create or replace function pg_temp.call_id(name text) returns uuid
language sql as $$ select id from call where call.name = $1 $$;

-- Starts a call as the app does (service role).
create or replace function pg_temp.start(requester text, workspace text, daily_limit integer default 50)
returns table (call_id uuid, refusal text, retry_after integer)
language sql as $$
  select * from public.start_prompt_assist(
    pg_temp.id(workspace), pg_temp.id(requester), 'mock', 'mock-writer', 420, daily_limit
  );
$$;

create or replace function pg_temp.keep(name text, requester text, workspace text) returns void
language sql as $$
  insert into call select name, s.call_id from pg_temp.start(requester, workspace) s;
$$;

grant execute on all functions in schema pg_temp to authenticated, anon;

-- The admin of w1 is also an admin of w2, to check the limit across workspaces.
insert into public.workspace_members (workspace_id, user_id, role)
values (pg_temp.id('w2'), pg_temp.id('admin'), 'admin');

-- Table, RLS and privileges -----------------------------------------------------
select has_table('public', 'prompt_assist_calls', 'the ledger of the template writer exists');
select ok((select relrowsecurity from pg_class where oid = 'public.prompt_assist_calls'::regclass),
  'RLS is on for prompt_assist_calls');
select policies_are('public', 'prompt_assist_calls', array['prompt_assist_calls: own calls and managers read'],
  'one read policy, no write policy');
select ok(
  has_table_privilege('authenticated', 'public.prompt_assist_calls', 'select')
  and not has_table_privilege('authenticated', 'public.prompt_assist_calls', 'insert')
  and not has_table_privilege('authenticated', 'public.prompt_assist_calls', 'update')
  and not has_table_privilege('authenticated', 'public.prompt_assist_calls', 'delete')
  and not has_table_privilege('authenticated', 'public.prompt_assist_calls', 'truncate'),
  'signed-in users only read the ledger');
select ok(
  not has_function_privilege('authenticated', 'public.start_prompt_assist(uuid, uuid, text, text, integer, integer)', 'execute')
  and not has_function_privilege('anon', 'public.start_prompt_assist(uuid, uuid, text, text, integer, integer)', 'execute')
  and has_function_privilege('service_role', 'public.start_prompt_assist(uuid, uuid, text, text, integer, integer)', 'execute'),
  'only the server starts a call');
select ok(
  not has_function_privilege('authenticated', 'public.finish_prompt_assist(uuid, uuid, text, text, integer, integer, numeric, integer, text)', 'execute')
  and not has_function_privilege('anon', 'public.finish_prompt_assist(uuid, uuid, text, text, integer, integer, numeric, integer, text)', 'execute')
  and has_function_privilege('service_role', 'public.finish_prompt_assist(uuid, uuid, text, text, integer, integer, numeric, integer, text)', 'execute'),
  'only the server records how a call ended');
select ok(
  not has_function_privilege('authenticated', 'public.claim_ai_daily_cost_alert(numeric)', 'execute')
  and not has_function_privilege('anon', 'public.claim_ai_daily_cost_alert(numeric)', 'execute')
  and has_function_privilege('service_role', 'public.claim_ai_daily_cost_alert(numeric)', 'execute'),
  'only the server claims the daily cost alert');
select ok(
  has_function_privilege('authenticated', 'public.prompt_assist_metrics(uuid, timestamptz)', 'execute')
  and not has_function_privilege('anon', 'public.prompt_assist_metrics(uuid, timestamptz)', 'execute'),
  'signed-in users read the dashboard figures, visitors do not');

-- Who may start a call --------------------------------------------------------------
select pg_temp.act_as_server();
select results_eq($$select refusal from pg_temp.start('expert', 'w1')$$, $$values ('forbidden')$$,
  'an expert cannot ask the AI to write a template');
select results_eq($$select refusal from pg_temp.start('viewer', 'w1')$$, $$values ('forbidden')$$,
  'nor can a viewer');
select results_eq($$select refusal from pg_temp.start('outsider', 'w1')$$, $$values ('forbidden')$$,
  'nor someone from another workspace');
select throws_ok($$select * from pg_temp.start('owner', 'w1', 0)$$, '22023', null,
  'a daily limit under 1 is refused');

select pg_temp.keep('owner1', 'owner', 'w1');
select isnt(pg_temp.call_id('owner1'), null, 'the owner starts a call');
select results_eq(
  $$select workspace_id, user_id, provider, model, status, input_chars, total_tokens, completed_at
    from public.prompt_assist_calls where id = pg_temp.call_id('owner1')$$,
  $$values (pg_temp.id('w1'), pg_temp.id('owner'), 'mock', 'mock-writer', 'running', 420, 0, null::timestamptz)$$,
  'the call runs, with its workspace, author, model and the length of the description');

-- A call still running after 10 minutes died with its request.
update public.prompt_assist_calls set created_at = now() - interval '9 minutes' where id = pg_temp.call_id('owner1');
select pg_temp.keep('owner2', 'owner', 'w1');
select is((select status from public.prompt_assist_calls where id = pg_temp.call_id('owner1')), 'running',
  'a call stays running for 10 minutes');
update public.prompt_assist_calls set created_at = now() - interval '11 minutes' where id = pg_temp.call_id('owner1');
select pg_temp.keep('owner3', 'owner', 'w1');
select results_eq(
  $$select status, error_code, completed_at is not null from public.prompt_assist_calls where id = pg_temp.call_id('owner1')$$,
  $$values ('failed', 'stale', true)$$,
  'then the next call marks it as failed');

-- The daily limit -------------------------------------------------------------------
select pg_temp.keep('admin1', 'admin', 'w1');
select pg_temp.keep('admin2', 'admin', 'w2');
select pg_temp.keep('admin3', 'admin', 'w1');
select ok(pg_temp.call_id('admin3') is not null, 'the admin starts three calls in two workspaces');
select results_eq($$select refusal from pg_temp.start('admin', 'w1', 3)$$, $$values ('rateLimited')$$,
  'with a limit of 3, the fourth call of the day is refused');
select results_eq($$select refusal from pg_temp.start('admin', 'w2', 3)$$, $$values ('rateLimited')$$,
  'in every workspace: the limit is per person');
select ok(
  (select retry_after between 1 and 86400 from pg_temp.start('admin', 'w1', 3)),
  'the refusal says how long until the next UTC day');
select is((select count(*)::int from public.prompt_assist_calls where user_id = pg_temp.id('admin')), 3,
  'a refused call leaves no row');
select results_eq($$select refusal from pg_temp.start('owner', 'w1', 4)$$, $$values (null::text)$$,
  'another person keeps their own calls');

-- The plan --------------------------------------------------------------------------
do $$ begin perform pg_temp.set_plan(pg_temp.id('org_a'), 'independant'); end $$;
select results_eq($$select refusal from pg_temp.start('owner', 'w1')$$, $$values ('templatesNotIncluded')$$,
  'a plan without custom templates is refused, as when saving one');
update public.billing_entitlements set revoked_at = now(), revoked_reason = 'pgTAP'
where organization_id = pg_temp.id('org_a') and revoked_at is null;
select results_eq($$select refusal from pg_temp.start('owner', 'w1')$$, $$values ('readOnly')$$,
  'a read-only workspace is refused first');
update private.billing_settings set enforced = false;
select results_eq($$select refusal from pg_temp.start('owner', 'w1')$$, $$values (null::text)$$,
  'nothing is checked while billing is not enforced');
update private.billing_settings set enforced = true;
do $$ begin perform pg_temp.set_plan(pg_temp.id('org_a'), 'cabinet'); end $$;
select results_eq($$select refusal from pg_temp.start('owner', 'w1')$$, $$values (null::text)$$,
  'Cabinet includes custom templates');

-- Finishing a call --------------------------------------------------------------------
select is(
  public.finish_prompt_assist(pg_temp.call_id('owner3'), pg_temp.id('w1'), 'succeeded', null, 1200, 800, 0.0123, 4200,
    '0123456789abcdef0123456789abcdef'),
  true, 'the server records a call that succeeded');
select results_eq(
  $$select status, error_code, input_tokens, output_tokens, total_tokens, cost_estimate, latency_ms, completed_at is not null
    from public.prompt_assist_calls where id = pg_temp.call_id('owner3')$$,
  $$values ('succeeded', null::text, 1200, 800, 2000, 0.012300::numeric, 4200, true)$$,
  'with its tokens, cost and latency');
select is(
  public.finish_prompt_assist(pg_temp.call_id('owner3'), pg_temp.id('w1'), 'failed', 'late', 1, 1, null, 1),
  false, 'a call that ended cannot end again');
select is(
  public.finish_prompt_assist(pg_temp.call_id('admin2'), pg_temp.id('w1'), 'failed', 'x', 1, 1, null, 1),
  false, 'nor end through another workspace');
select is(
  public.finish_prompt_assist(pg_temp.call_id('admin2'), pg_temp.id('w2'), 'failed', null, 900, 0, 0.0009, 300),
  true, 'a failed call keeps its usage');
select is((select error_code from public.prompt_assist_calls where id = pg_temp.call_id('admin2')), 'failed',
  'and gets an error code even without one');
select throws_ok(
  $$select public.finish_prompt_assist(pg_temp.call_id('admin3'), pg_temp.id('w1'), 'running', null, 0, 0, null, 0)$$,
  '22023', null, 'a call ends as succeeded or failed');

-- Calls of the day before no longer count (and their running ones are stale).
update public.prompt_assist_calls set created_at = created_at - interval '1 day' where user_id = pg_temp.id('admin');
select results_eq($$select refusal from pg_temp.start('admin', 'w1', 3)$$, $$values (null::text)$$,
  'yesterday''s calls no longer count');

-- Reading -----------------------------------------------------------------------------
create temp table seen as
select workspace_id, count(*)::int as calls from public.prompt_assist_calls group by workspace_id;
grant select on seen to authenticated;

select pg_temp.act_as('owner');
select is((select count(*)::int from public.prompt_assist_calls where workspace_id = pg_temp.id('w1')),
  (select calls from seen where workspace_id = pg_temp.id('w1')),
  'an owner reads every call of the workspace');
select ok((select count(*) from public.prompt_assist_calls where user_id = pg_temp.id('admin')) > 0,
  'the admin''s included');
select pg_temp.act_as('outsider');
select is((select count(*)::int from public.prompt_assist_calls where workspace_id = pg_temp.id('w1')), 0,
  'another workspace reads none of them');
select is((select count(*)::int from public.prompt_assist_calls where workspace_id = pg_temp.id('w2')),
  (select calls from seen where workspace_id = pg_temp.id('w2')),
  'its owner reads the calls of their own workspace');
select pg_temp.act_as('expert');
select is((select count(*)::int from public.prompt_assist_calls), 0, 'an expert reads nothing');
select throws_ok(
  $$insert into public.prompt_assist_calls (workspace_id, user_id, provider, model, input_chars)
    values (pg_temp.id('w1'), pg_temp.id('expert'), 'mock', 'mock', 1)$$,
  '42501', null, 'users cannot add a call');
select pg_temp.act_as('owner');
select throws_ok($$update public.prompt_assist_calls set cost_estimate = 0$$, '42501', null,
  'an owner cannot change the cost of a call');
select throws_ok($$delete from public.prompt_assist_calls$$, '42501', null, 'nor delete calls to reset the limit');
select throws_ok(
  $$select public.finish_prompt_assist(pg_temp.call_id('admin3'), pg_temp.id('w1'), 'succeeded', null, 0, 0, 0, 0)$$,
  '42501', null, 'nor record usage through the function');
select pg_temp.act_as_anon();
select throws_ok($$select * from public.prompt_assist_calls$$, '42501', null, 'visitors read nothing');

-- Dashboard figures ---------------------------------------------------------------------
select pg_temp.act_as('owner');
select results_eq(
  $$select model, calls::int, succeeded::int, input_tokens::int, output_tokens::int, cost
    from public.prompt_assist_metrics(pg_temp.id('w1'), now() - interval '7 days')$$,
  $$values ('mock-writer', (select calls from seen where workspace_id = pg_temp.id('w1')), 1, 1200, 800, 0.012300::numeric)$$,
  'the dashboard sums the calls of the workspace per model');
select pg_temp.act_as('expert');
select is((select count(*)::int from public.prompt_assist_metrics(pg_temp.id('w1'), null)), 0,
  'an expert gets no figures');

-- Daily cost alert ------------------------------------------------------------------------
select pg_temp.act_as_server();
delete from public.ai_cost_alerts where day = (now() at time zone 'utc')::date;
create temp table spend as
select
  coalesce((select sum(g.cost_estimate) from public.ai_generations g
            where g.created_at >= (now() at time zone 'utc')::date::timestamp at time zone 'utc'), 0) as drafts,
  coalesce((select sum(c.cost_estimate) from public.prompt_assist_calls c
            where c.created_at >= (now() at time zone 'utc')::date::timestamp at time zone 'utc'), 0) as writer;
select ok((select writer >= 0.0123 from spend), 'the template writer spent something today');
select is(public.claim_ai_daily_cost_alert((select drafts + writer + 1 from spend)), null,
  'below the threshold, no alert');
select is(public.claim_ai_daily_cost_alert((select drafts + 0.001 from spend)), (select drafts + writer from spend),
  'the template writer''s calls count in the day''s spend');
select is(public.claim_ai_daily_cost_alert(0), null, 'only once a day');
select has_index('public', 'prompt_assist_calls', 'prompt_assist_calls_created_idx', 'the daily sum reads an index');

select * from finish();
rollback;
