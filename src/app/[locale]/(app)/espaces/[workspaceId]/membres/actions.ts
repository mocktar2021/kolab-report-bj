"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { workspaceErrorKey, type WorkspaceErrorKey } from "@/lib/workspaces/errors";
import {
  MANAGER_ROLES,
  canManageMember,
  grantableRoles,
  workspaceRoleSchema,
  type WorkspaceRole,
} from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole, type WorkspaceAccess } from "@/lib/workspaces/server";

export type MemberActionState =
  | { status: "idle" }
  | { status: "success" }
  | { status: "error"; error: WorkspaceErrorKey };

const FORBIDDEN: MemberActionState = { status: "error", error: "forbidden" };

const memberSchema = z.object({ workspaceId: uuidSchema, userId: uuidSchema });

/**
 * Checks the caller manages the workspace and may act on the target member.
 * Same rules as RLS (which still has the final say): managers only, and only
 * owners act on owners. Members may always act on themselves.
 */
async function authorize(
  workspaceId: string,
  userId: string,
): Promise<{ access: WorkspaceAccess; targetRole: WorkspaceRole } | null> {
  const access = await requireWorkspaceRole(workspaceId, MANAGER_ROLES);
  if (!access) return null;

  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .maybeSingle();
  if (!data) return null;
  if (userId !== access.userId && !canManageMember(access.role, data.role)) return null;

  return { access, targetRole: data.role };
}

/** Changes a member's role. The last-owner trigger rejects removing the last owner. */
export async function updateMemberRole(
  _prev: MemberActionState,
  formData: FormData,
): Promise<MemberActionState> {
  const parsed = memberSchema.extend({ role: workspaceRoleSchema }).safeParse({
    workspaceId: formData.get("workspaceId"),
    userId: formData.get("userId"),
    role: formData.get("role"),
  });
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const { workspaceId, userId, role } = parsed.data;

  const auth = await authorize(workspaceId, userId);
  if (!auth || !grantableRoles(auth.access.role).includes(role)) return FORBIDDEN;
  if (auth.targetRole === role) return { status: "success" };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .update({ role })
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return { status: "error", error: workspaceErrorKey(error) };
  // No row back: RLS hid it.
  if (!data || data.length === 0) return FORBIDDEN;

  revalidatePath("/", "layout");
  return { status: "success" };
}

/** Removes a member. Removing yourself means leaving: you go back to the dashboard. */
export async function removeMember(_prev: MemberActionState, formData: FormData): Promise<MemberActionState> {
  const parsed = memberSchema.safeParse({
    workspaceId: formData.get("workspaceId"),
    userId: formData.get("userId"),
  });
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const { workspaceId, userId } = parsed.data;

  const auth = await authorize(workspaceId, userId);
  if (!auth) return FORBIDDEN;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .delete()
    .eq("workspace_id", workspaceId)
    .eq("user_id", userId)
    .select("user_id");
  if (error) return { status: "error", error: workspaceErrorKey(error) };
  if (!data || data.length === 0) return FORBIDDEN;

  revalidatePath("/", "layout");
  if (userId === auth.access.userId) {
    const locale = await getLocale();
    return redirect({ href: "/tableau-de-bord", locale });
  }
  return { status: "success" };
}
