"use server";

import type { DeletionState } from "@/lib/deletions/errors";
import { deletionRefused, leaveDeletedWorkspaces } from "@/lib/deletions/server";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";

/**
 * "Supprimer l'espace de travail" (KRB-180). delete_workspace checks that the
 * caller owns the workspace and typed its name. Then the user moves to
 * another of their workspaces, of the same organization first, or to the
 * wizard when none is left.
 */
export async function deleteWorkspace(_prev: DeletionState, formData: FormData): Promise<DeletionState> {
  const workspaceId = uuidSchema.safeParse(formData.get("id"));
  if (!workspaceId.success) return deletionRefused(null, "invalidInput");
  const id = workspaceId.data.toLowerCase();

  const supabase = await createClient();
  // Read before it goes, to stay in its organization.
  const { data: workspace } = await supabase
    .from("workspaces")
    .select("organization_id")
    .eq("id", id)
    .maybeSingle();
  const { error } = await supabase.rpc("delete_workspace", {
    p_workspace_id: id,
    p_confirmation: String(formData.get("confirmation") ?? ""),
  });
  if (error) return deletionRefused(error);

  log.info("deletions: workspace deleted", { workspaceId: id });
  return leaveDeletedWorkspaces(workspace?.organization_id ?? null, "espace");
}
