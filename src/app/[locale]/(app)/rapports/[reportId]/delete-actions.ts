"use server";

import type { DeletionState } from "@/lib/deletions/errors";
import { deletionRefused, leaveDeletedReport } from "@/lib/deletions/server";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";

/**
 * "Supprimer le rapport" (KRB-180). delete_report checks the rights: owners
 * and admins delete a report that is not final, only owners a final one,
 * with its title typed in "confirmation". It queues the files and records
 * the deletion; the user goes back to the dashboard.
 */
export async function deleteReport(_prev: DeletionState, formData: FormData): Promise<DeletionState> {
  const reportId = uuidSchema.safeParse(formData.get("id"));
  if (!reportId.success) return deletionRefused(null, "invalidInput");

  const supabase = await createClient();
  const { error } = await supabase.rpc("delete_report", {
    p_report_id: reportId.data.toLowerCase(),
    p_confirmation: String(formData.get("confirmation") ?? ""),
  });
  if (error) return deletionRefused(error);

  log.info("deletions: report deleted", { reportId: reportId.data });
  return leaveDeletedReport();
}
