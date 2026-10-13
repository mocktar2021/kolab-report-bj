-- =============================================================================
-- KolabReport: AI generations outlive their section (Story KRB-16, review)
--
-- Deleting a section or its report used to delete its generations with it,
-- which took their requests and tokens out of the hourly limit and the
-- monthly budget. A manager could reset both that way. Generations now stay,
-- with no section, and still count. Deleting the workspace removes them.
-- Without a section, only managers read them (RLS on section editors).
-- =============================================================================

alter table public.ai_generations alter column section_id drop not null;

alter table public.ai_generations drop constraint ai_generations_section_id_workspace_id_fkey;
alter table public.ai_generations
  add constraint ai_generations_section_id_workspace_id_fkey
  foreign key (section_id, workspace_id)
  references public.report_sections (id, workspace_id) on delete set null (section_id);

alter table public.ai_generations
  add constraint ai_generations_workspace_id_fkey
  foreign key (workspace_id) references public.workspaces (id) on delete cascade;

comment on column public.ai_generations.section_id is 'Null once the section is deleted: usage still counts.';
