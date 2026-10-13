-- =============================================================================
-- KolabReport: files kept before the app read anything (Story KRB-14)
--
-- Files uploaded before the app read anything: the types it doesn't read are
-- marked as kept as they are, with the meta the app writes for them. Readable
-- ones stay pending, and the section page offers to read them.
-- =============================================================================

update public.deliverables
set
  parse_status = 'skipped',
  parse_meta = '{"version": 1, "kind": "stored", "words": 0, "characters": 0, "tokenEstimate": 0, "truncated": false}',
  parsed_at = now()
where parse_status = 'pending'
  and uploaded_at is not null
  and lower(substring(file_name from '\.([A-Za-z0-9]+)$')) not in ('docx', 'xlsx', 'csv', 'txt', 'md');
