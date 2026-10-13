-- =============================================================================
-- KolabReport: parsing deliverables and managing them from the section page
-- (Story KRB-14)
--
-- The app reads Word, Excel, CSV and text files with the service role and
-- writes Markdown to parsed_content. parse_meta holds what describes it: the
-- kind of file, sheet names and how many rows were kept, a word count and a
-- token estimate for the AI draft. Users still write none of these columns.
-- =============================================================================

alter table public.deliverables add column parse_meta jsonb;

comment on column public.deliverables.parse_meta is
  'Written by the app when it reads the file: kind, sheets, rows kept, words, token estimate.';

-- Only people who can still edit the section delete its files: the uploader
-- while the section is theirs, or a manager. The app then removes the stored
-- object with the service role.
drop policy "deliverables: uploader or manager deletes" on public.deliverables;

create policy "deliverables: section editors delete"
  on public.deliverables for delete to authenticated
  using (
    private.is_workspace_manager(workspace_id)
    or (uploaded_by = (select auth.uid()) and private.can_edit_section(section_id))
  );

-- Users have had no update privilege on deliverables since the uploads
-- migration, so this policy no longer allowed anything.
drop policy "deliverables: uploader or manager updates" on public.deliverables;
