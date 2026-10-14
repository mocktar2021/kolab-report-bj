begin;
\ir fixtures.psql
select plan(7);

-- KRB-139: GET /api/health calls public.health_check() with the anon key.

select isnt_definer('public', 'health_check', array[]::text[],
  'health_check runs with the caller''s rights');
select volatility_is('public', 'health_check', array[]::text[], 'stable', 'health_check is stable');
select ok((select proconfig from pg_proc where oid = 'public.health_check()'::regprocedure)
  @> array['search_path=""'], 'health_check pins an empty search_path');
select function_privs_are('public', 'health_check', array[]::text[], 'anon', array['EXECUTE'],
  'visitors without a session may call health_check');
select ok(not exists (
    select 1 from pg_proc p, aclexplode(p.proacl) acl
    where p.oid = 'public.health_check()'::regprocedure and acl.grantee = 0
  ), 'PUBLIC has no privilege on health_check');

select pg_temp.act_as_anon();
select is(public.health_check(), true, 'anon calls health_check and gets true');

select pg_temp.act_as('stranger');
select is(public.health_check(), true, 'a signed-in user gets true as well');

select * from finish();
rollback;
