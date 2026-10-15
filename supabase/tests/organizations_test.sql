begin;
\ir fixtures.psql
select plan(9);

select pg_temp.act_as('owner');
select results_eq('select id from public.organizations order by id', array[pg_temp.id('org_a')], 'owner sees only org_a');
select is(pg_temp.affected($$update public.organizations set name = 'Cabinet A2' where id = pg_temp.id('org_a')$$), 1, 'owner can rename org_a');
select throws_ok($$delete from public.organizations where id = pg_temp.id('org_a')$$, '42501', null,
  'nobody deletes an organization directly: delete_organization does it (KRB-180)');

select pg_temp.act_as('admin');
select results_eq('select id from public.organizations', array[pg_temp.id('org_a')], 'admin sees org_a through its workspace');
select is(pg_temp.affected($$update public.organizations set name = 'X' where id = pg_temp.id('org_a')$$), 0, 'admin cannot rename the organization');

select pg_temp.act_as('viewer');
select results_eq('select id from public.organizations', array[pg_temp.id('org_a')], 'viewer sees org_a');

select pg_temp.act_as('outsider');
select results_eq('select id from public.organizations', array[pg_temp.id('org_b')], 'outsider only sees org_b');

select pg_temp.act_as('stranger');
select lives_ok($$insert into public.organizations (name, slug, owner_id) values ('Nouveau', 'nouveau', pg_temp.id('stranger'))$$,
  'a user can create an organization they own');
select throws_ok($$insert into public.organizations (name, slug, owner_id) values ('Vol', 'vol', pg_temp.id('owner'))$$,
  '42501', null, 'a user cannot create an organization for someone else');

select * from finish();
rollback;
