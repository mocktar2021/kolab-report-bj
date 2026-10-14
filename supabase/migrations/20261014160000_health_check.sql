-- =============================================================================
-- KolabReport: database check for GET /api/health (KRB-139)
--
-- The uptime monitor calls /api/health, which calls this function through
-- PostgREST with the anon key: an answer means the API and the database are
-- up, without the service role key on that path. It reads no table, runs
-- with the caller's rights and returns nothing about the data.
-- =============================================================================

create or replace function public.health_check()
returns boolean
language sql
stable
security invoker
set search_path = ''
as $$
  select true
$$;

comment on function public.health_check() is
  'Answers true while the database is up. Called by GET /api/health (KRB-139).';

revoke all on function public.health_check() from public;
grant execute on function public.health_check() to anon, authenticated;
