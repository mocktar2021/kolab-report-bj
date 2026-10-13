import "server-only";
import { createClient } from "@/lib/supabase/server";
import { WORKSPACE_ROLES, type WorkspaceRole } from "./roles";

export type WorkspaceMember = {
  userId: string;
  name: string;
  email: string;
  role: WorkspaceRole;
};

/** Members of a workspace, owners first, then by name. RLS limits this to members of that workspace. */
export async function getWorkspaceMembers(workspaceId: string): Promise<WorkspaceMember[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("user_id, role, profile:profiles!workspace_members_user_id_fkey(full_name, email)")
    .eq("workspace_id", workspaceId);
  if (error || !data) return null;

  return data
    .map((row) => {
      const email = row.profile?.email ?? "";
      return {
        userId: row.user_id,
        name: row.profile?.full_name?.trim() || email,
        email,
        role: row.role,
      };
    })
    .sort(
      (a, b) =>
        WORKSPACE_ROLES.indexOf(a.role) - WORKSPACE_ROLES.indexOf(b.role) ||
        a.name.localeCompare(b.name, "fr"),
    );
}
