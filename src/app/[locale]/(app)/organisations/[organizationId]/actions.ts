"use server";

import { after } from "next/server";
import type { DeletionState } from "@/lib/deletions/errors";
import {
  readOrganizationDeletionNotice,
  sendOrganizationDeletionEmails,
} from "@/lib/deletions/organization-emails";
import { getWorkspaceDeletionPreview } from "@/lib/deletions/preview";
import {
  deletionRefused,
  leaveDeletedWorkspaces,
  leaveWorkspaceDeletedFromOrganization,
} from "@/lib/deletions/server";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import { uuidSchema } from "@/lib/workspaces/schemas";

/**
 * "Supprimer l'organisation" (KRB-180). delete_organization checks that the
 * caller is organizations.owner_id and typed its name, then deletes every
 * workspace with it. Payments and receipts stay, detached from it. The user
 * moves to a workspace they still belong to, or to the wizard. The owners and
 * admins of those workspaces, but not the user, get an e-mail once the
 * deletion is committed.
 */
export async function deleteOrganization(_prev: DeletionState, formData: FormData): Promise<DeletionState> {
  const organizationId = uuidSchema.safeParse(formData.get("id"));
  if (!organizationId.success) return deletionRefused(null, "invalidInput");
  const id = organizationId.data.toLowerCase();

  const supabase = await createClient();
  // Who to tell, read while the rows exist. Only for the owner: the
  // function refuses anyone else anyway.
  const user = await getCurrentUser();
  const { data: organization } = await supabase
    .from("organizations")
    .select("owner_id")
    .eq("id", id)
    .maybeSingle();
  const notice =
    user && organization?.owner_id === user.id ? await readOrganizationDeletionNotice(id, user.id) : null;

  const { error } = await supabase.rpc("delete_organization", {
    p_organization_id: id,
    p_confirmation: String(formData.get("confirmation") ?? ""),
  });
  if (error) return deletionRefused(error);

  log.info("deletions: organization deleted", {
    organizationId: id,
    recipients: notice?.recipients.length ?? 0,
  });
  // After the response: the action's transaction is committed by then, and a
  // failed e-mail never undoes the deletion.
  if (notice && notice.recipients.length > 0) {
    const deletedAt = new Date();
    after(() => sendOrganizationDeletionEmails(notice, deletedAt));
  }
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
