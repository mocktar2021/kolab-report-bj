-- =============================================================================
-- KolabReport: deliverable uploads (Story KRB-13)
--
-- An upload goes through the app in three steps:
--   1. POST /api/deliverables/upload-url registers the file (a deliverables
--      row with uploaded_at null) and returns a signed upload URL for its
--      exact path.
--   2. The browser sends the file straight to storage.
--   3. POST /api/deliverables/{id}/complete checks the stored object (size,
--      type, first bytes). If it passes, the service role sets uploaded_at.
--      If not, it deletes the object and the row.
--
-- Users can no longer write anything that check relies on:
--   * deliverables: users insert the file description and can rename a file.
--     uploaded_at and the parse results are written by the service role only.
--   * storage: users create an object only for an unchecked file they
--     registered, never replace or delete one, and read only checked files.
--     The app deletes objects with the service role once their row is gone.
--     So while a row exists, its object is the one the app checked.
--
-- Signed upload URLs are checked against these policies when they are
-- signed, then upload with storage's own rights for 2 hours. With no update
-- or delete for users, such a URL can only ever create an object at a path
-- that is free, which nobody can read until the app checks it.
-- =============================================================================

alter table public.deliverables add column uploaded_at timestamptz;

comment on column public.deliverables.uploaded_at is
  'Set by the app once the stored file passed the checks. Null while the upload is not finished.';

revoke insert, update on public.deliverables from authenticated;
grant insert (workspace_id, section_id, uploaded_by, storage_path, file_name, mime_type, size_bytes)
  on public.deliverables to authenticated;
grant update (file_name) on public.deliverables to authenticated;

-- -----------------------------------------------------------------------------
-- Storage policies
-- -----------------------------------------------------------------------------

-- An unchecked file the caller registered, in a section they can still edit.
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
  );
$$;

-- A checked file of a workspace the caller belongs to.
create or replace function private.can_read_deliverable(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.deliverables d
    where d.storage_path = object_name
      and d.uploaded_at is not null
      and private.is_workspace_member(d.workspace_id)
  );
$$;

revoke all on function private.can_upload_deliverable(text) from public;
revoke all on function private.can_read_deliverable(text) from public;
grant execute on function private.can_upload_deliverable(text) to authenticated, service_role;
grant execute on function private.can_read_deliverable(text) to authenticated, service_role;

drop policy "deliverables bucket: members read" on storage.objects;
drop policy "deliverables bucket: section editors upload" on storage.objects;
drop policy "deliverables bucket: section editors replace" on storage.objects;
drop policy "deliverables bucket: uploader or manager deletes" on storage.objects;

create policy "deliverables bucket: members read checked files"
  on storage.objects for select to authenticated
  using (bucket_id = 'deliverables' and private.can_read_deliverable(name));

create policy "deliverables bucket: upload a registered file"
  on storage.objects for insert to authenticated
  with check (bucket_id = 'deliverables' and private.can_upload_deliverable(name));

-- No update or delete policy: users never replace or remove a stored file.

-- Only used by the policies dropped above.
drop function private.can_upload_to_path(text);
drop function private.storage_section_id(text);
drop function private.storage_workspace_id(text);

-- -----------------------------------------------------------------------------
-- Accepted types, kept in sync with src/lib/deliverables/file-types.ts.
-- Adds Visio (.vsdx) for diagrams.
-- -----------------------------------------------------------------------------
update storage.buckets
set allowed_mime_types = array[
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-excel',
  'text/csv',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/pdf',
  'text/plain',
  'text/markdown',
  'image/png',
  'image/jpeg',
  'image/webp',
  'image/svg+xml',
  'application/vnd.jgraph.mxfile',
  'application/vnd.ms-visio.drawing.main+xml'
]
where id = 'deliverables';
