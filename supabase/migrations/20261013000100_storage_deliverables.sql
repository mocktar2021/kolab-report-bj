-- =============================================================================
-- KolabReport: storage bucket for expert deliverables (Story KRB-3.1)
--
-- Object path convention: {workspace_id}/{section_id}/{uuid}-{filename}
-- The bucket is private: files are read through signed URLs only.
-- =============================================================================

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
  'deliverables',
  'deliverables',
  false,
  52428800, -- 50 MB, kept in sync with MAX_UPLOAD_SIZE_BYTES and deliverables.size_bytes
  array[
    -- Word
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/msword',
    -- Excel / CSV
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.ms-excel',
    'text/csv',
    -- PowerPoint
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    -- PDF / text
    'application/pdf',
    'text/plain',
    'text/markdown',
    -- Images and diagrams
    'image/png',
    'image/jpeg',
    'image/webp',
    'image/svg+xml',
    'application/vnd.jgraph.mxfile' -- draw.io
  ]
)
on conflict (id) do update
set public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- First path segment as uuid, or NULL when it is not a valid uuid.
create or replace function private.storage_workspace_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  segment text := split_part(object_name, '/', 1);
begin
  if segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return segment::uuid;
  end if;
  return null;
end;
$$;

create or replace function private.storage_section_id(object_name text)
returns uuid
language plpgsql
immutable
set search_path = ''
as $$
declare
  segment text := split_part(object_name, '/', 2);
begin
  if segment ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$' then
    return segment::uuid;
  end if;
  return null;
end;
$$;

-- The section in the path must belong to the workspace in the path.
create or replace function private.can_upload_to_path(object_name text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.report_sections s
    where s.id = private.storage_section_id(object_name)
      and s.workspace_id = private.storage_workspace_id(object_name)
      and private.can_edit_section(s.id)
  );
$$;

revoke all on function private.storage_workspace_id(text) from public;
revoke all on function private.storage_section_id(text) from public;
revoke all on function private.can_upload_to_path(text) from public;
grant execute on function private.storage_workspace_id(text) to authenticated, service_role;
grant execute on function private.storage_section_id(text) to authenticated, service_role;
grant execute on function private.can_upload_to_path(text) to authenticated, service_role;

create policy "deliverables bucket: members read"
  on storage.objects for select to authenticated
  using (
    bucket_id = 'deliverables'
    and private.is_workspace_member(private.storage_workspace_id(name))
  );

create policy "deliverables bucket: section editors upload"
  on storage.objects for insert to authenticated
  with check (
    bucket_id = 'deliverables'
    and private.can_upload_to_path(name)
  );

create policy "deliverables bucket: section editors replace"
  on storage.objects for update to authenticated
  using (bucket_id = 'deliverables' and private.can_upload_to_path(name))
  with check (bucket_id = 'deliverables' and private.can_upload_to_path(name));

create policy "deliverables bucket: uploader or manager deletes"
  on storage.objects for delete to authenticated
  using (
    bucket_id = 'deliverables'
    and (
      owner_id = (select auth.uid())::text
      or private.is_workspace_manager(private.storage_workspace_id(name))
    )
  );
