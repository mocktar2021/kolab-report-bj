import "server-only";
import { createClient } from "@/lib/supabase/server";
import type { MyWorkspace } from "@/lib/workspaces/types";
import { groupOrganizationReports, type OrganizationReports } from "./organization";

/**
 * Reports of the given workspaces with their completion (KRB-208). Uses the
 * signed-in user's client, so RLS applies. Returns null when a query fails.
 */
export async function getOrganizationReports(workspaces: MyWorkspace[]): Promise<OrganizationReports | null> {
  const ids = workspaces.map((workspace) => workspace.id);
  const supabase = await createClient();
  const [reports, progress] = await Promise.all([
    supabase.from("reports").select("id, title, status, workspace_id, created_at").in("workspace_id", ids),
    supabase
      .from("report_progress")
      .select("report_id, total_sections, completion_percent")
      .in("workspace_id", ids),
  ]);
  if (reports.error || progress.error) return null;

  return groupOrganizationReports({ workspaces, reports: reports.data, progress: progress.data });
}
