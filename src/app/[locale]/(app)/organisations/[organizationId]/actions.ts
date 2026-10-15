"use server";

import type { DeletionState } from "@/lib/deletions/errors";
import { getWorkspaceDeletionPreview } from "@/lib/deletions/preview";
import {
  deletionRefused,
  leaveDeletedWorkspaces,
  leaveWorkspaceDeletedFromOrganization,
} from "@/lib/deletions/server";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";

/**
 * "Supprimer l'organisation" (KRB-180). delete_organization checks that the
 * caller is organizations.owner_id and typed its name, then deletes every
 * workspace with it. Payments and receipts stay, detached from it. The user
 * moves to a workspace they still belong to, or to the wizard.
 */
export async function deleteOrganization(_prev: DeletionState, formData: FormData): Promise<DeletionState> {
  const organizationId = uuidSchema.safeParse(formData.get("id"));
  if (!organizationId.success) return deletionRefused(null, "invalidInput");
  const id = organizationId.data.toLowerCase();

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_organization", {
    p_organization_id: id,
    p_confirmation: String(formData.get("confirmation") ?? ""),
  });
  if (error) return deletionRefused(error);

  log.info("deletions: organization deleted", { organizationId: id });
  return leaveDeletedWorkspaces(null, "organisation");
}

/**
 * "Supprimer" next to a workspace on the organization page (KRB-180): the
 * organization owner deletes one workspace, even one they are not a member
 * of, with its name typed. delete_workspace checks it again. The user comes
 * back to the organization page.
 */
export async function deleteOrganizationWorkspace(
  _prev: DeletionState,
  formData: FormData,
): Promise<DeletionState> {
  const workspaceId = uuidSchema.safeParse(formData.get("id"));
  if (!workspaceId.success) return deletionRefused(null, "invalidInput");
  const id = workspaceId.data.toLowerCase();

  // The organization owner may not read the workspace row (RLS): the preview
  // says which organization it belongs to, and null when they may not delete it.
  const preview = await getWorkspaceDeletionPreview(id);
  if (!preview) return deletionRefused(null, "notFound");

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_workspace", {
    p_workspace_id: id,
    p_confirmation: String(formData.get("confirmation") ?? ""),
  });
  if (error) return deletionRefused(error);

  log.info("deletions: workspace deleted", { workspaceId: id, organizationId: preview.organizationId });
  return leaveWorkspaceDeletedFromOrganization(id, preview.organizationId);
}
