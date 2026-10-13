"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { emailSchema } from "@/lib/auth/schemas";
import { INVITATION_TTL_MS, invitationLink, sendInvitationEmail } from "@/lib/invitations/server";
import { createInvitationToken } from "@/lib/invitations/token";
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

export type InvitationActionState =
  | { status: "idle" }
  | {
      status: "sent";
      email: string;
      /** Set when the e-mail could not go out: the inviter shares the link by hand. */
      link: string | null;
    }
  | { status: "error"; error: WorkspaceErrorKey };

/**
 * Invites someone by e-mail with a role. Admins cannot invite owners (RLS
 * checks it again). The e-mail goes out right away; when it cannot, the link
 * is shown to the inviter instead.
 */
export async function inviteMember(
  _prev: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  const parsed = z
    .object({ workspaceId: uuidSchema, email: emailSchema, role: workspaceRoleSchema })
    .safeParse({
      workspaceId: formData.get("workspaceId"),
      email: formData.get("email"),
      role: formData.get("role"),
    });
  if (!parsed.success) return { status: "error", error: "invalidInput" };
  const { workspaceId, email, role } = parsed.data;

  const access = await requireWorkspaceRole(workspaceId, MANAGER_ROLES);
  if (!access || !grantableRoles(access.role).includes(role)) return { status: "error", error: "forbidden" };

  const { token, tokenHash } = createInvitationToken();
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_invitations")
    .insert({ workspace_id: workspaceId, email, role, token_hash: tokenHash })
    .select("expires_at")
    .single();
  if (error || !data) return { status: "error", error: workspaceErrorKey(error) };

  const sent = await sendInvitationEmail({
    workspaceId,
    email,
    role,
    token,
    expiresAt: new Date(data.expires_at),
  });

  revalidatePath("/", "layout");
  return { status: "sent", email, link: sent ? null : invitationLink(token) };
}

/** Sends a pending or expired invitation again with a new link, valid 7 more days. */
export async function resendInvitation(
  _prev: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  const id = uuidSchema.safeParse(formData.get("invitationId"));
  if (!id.success) return { status: "error", error: "invalidInput" };

  const supabase = await createClient();
  const { data: invitation } = await supabase
    .from("workspace_invitations")
    .select("id, workspace_id, email, role")
    .eq("id", id.data)
    .maybeSingle();
  if (!invitation) return { status: "error", error: "forbidden" };
  const access = await requireWorkspaceRole(invitation.workspace_id, MANAGER_ROLES);
  if (!access || !grantableRoles(access.role).includes(invitation.role)) {
    return { status: "error", error: "forbidden" };
  }

  const { token, tokenHash } = createInvitationToken();
  const expiresAt = new Date(Date.now() + INVITATION_TTL_MS);
  const { data, error } = await supabase
    .from("workspace_invitations")
    .update({ token_hash: tokenHash, expires_at: expiresAt.toISOString() })
    .eq("id", invitation.id)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .select("id");
  if (error) return { status: "error", error: workspaceErrorKey(error) };
  if (!data || data.length === 0) return { status: "error", error: "forbidden" };

  const sent = await sendInvitationEmail({
    workspaceId: invitation.workspace_id,
    email: invitation.email,
    role: invitation.role,
    token,
    expiresAt,
  });

  revalidatePath("/", "layout");
  return { status: "sent", email: invitation.email, link: sent ? null : invitationLink(token) };
}

/** Cancels an invitation: its link stops working. */
export async function revokeInvitation(
  _prev: InvitationActionState,
  formData: FormData,
): Promise<InvitationActionState> {
  const id = uuidSchema.safeParse(formData.get("invitationId"));
  if (!id.success) return { status: "error", error: "invalidInput" };

  const supabase = await createClient();
  const { data: invitation } = await supabase
    .from("workspace_invitations")
    .select("id, workspace_id, role")
    .eq("id", id.data)
    .maybeSingle();
  if (!invitation) return { status: "error", error: "forbidden" };
  const access = await requireWorkspaceRole(invitation.workspace_id, MANAGER_ROLES);
  if (!access || !grantableRoles(access.role).includes(invitation.role)) {
    return { status: "error", error: "forbidden" };
  }

  const { data, error } = await supabase
    .from("workspace_invitations")
    .update({ revoked_at: new Date().toISOString() })
    .eq("id", invitation.id)
    .is("accepted_at", null)
    .select("id");
  if (error) return { status: "error", error: workspaceErrorKey(error) };
  if (!data || data.length === 0) return { status: "error", error: "forbidden" };

  revalidatePath("/", "layout");
  return { status: "idle" };
}
