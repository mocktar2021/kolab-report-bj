"use server";

import type { DeletionState } from "@/lib/deletions/errors";
import { deletionRefused, leaveDeletedWorkspaces } from "@/lib/deletions/server";
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
