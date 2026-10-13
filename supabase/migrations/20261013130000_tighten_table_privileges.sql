-- =============================================================================
-- KolabReport: tighten table privileges (Story KRB-47)
--
-- Supabase grants every privilege on public tables to anon and authenticated
-- by default. RLS already hides rows, but TRUNCATE ignores RLS, and a table
-- added later without a policy would be readable by signed-out visitors.
-- Signed-out visitors now get no table access at all, and signed-in users
-- keep only the four privileges the API uses. The RLS tests in
-- supabase/tests check both.
-- =============================================================================

revoke all on all tables in schema public from anon;
revoke truncate, references, trigger on all tables in schema public from authenticated;

-- Same rules for tables and views created by later migrations.
alter default privileges for role postgres in schema public revoke all on tables from anon;
alter default privileges for role postgres in schema public
  revoke truncate, references, trigger on tables from authenticated;
