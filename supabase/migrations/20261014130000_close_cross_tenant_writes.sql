-- =============================================================================
-- KolabReport: close two cross-workspace writes found in the KRB-24 review
--
-- * A manager could move their workspace into another organization
--   (UPDATE of workspaces.organization_id), then read that organization as
--   one of its members. Users now change only the descriptive columns of a
--   workspace, and only the name and slug of an organization they own.
-- * A manager could add any user to their workspace without an invitation,
--   then read that person's e-mail and name through the shared workspace.
--   People now join only through an invitation (accept_workspace_invitation,
--   accept_my_pending_invitations) or by creating the workspace.
-- =============================================================================

revoke update on public.workspaces from authenticated;
grant update (name, description, archived_at) on public.workspaces to authenticated;

revoke update on public.organizations from authenticated;
grant update (name, slug) on public.organizations to authenticated;

drop policy "workspace_members: managers add" on public.workspace_members;
revoke insert on public.workspace_members from authenticated;
