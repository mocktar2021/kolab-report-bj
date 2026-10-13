import "server-only";
import { invitationEmail } from "@/lib/email/invitation-email";
import { sendEmail } from "@/lib/email/send";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/user";
import type { WorkspaceRole } from "@/lib/workspaces/roles";

/** Invitations stay valid 7 days, the same default as the table. */
export const INVITATION_TTL_MS = 7 * 24 * 60 * 60 * 1000;

export type PendingInvitation = {
  id: string;
  email: string;
  role: WorkspaceRole;
  expiresAt: string;
  expired: boolean;
};

/** Open invitations of a workspace, newest first. RLS limits this to its owners and admins. */
export async function getPendingInvitations(workspaceId: string): Promise<PendingInvitation[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("workspace_invitations")
    .select("id, email, role, expires_at")
    .eq("workspace_id", workspaceId)
    .is("accepted_at", null)
    .is("revoked_at", null)
    .order("created_at", { ascending: false });

  const now = Date.now();
  return (data ?? []).map((row) => ({
    id: row.id,
    email: row.email,
    role: row.role,
    expiresAt: row.expires_at,
    expired: new Date(row.expires_at).getTime() <= now,
  }));
}

export function invitationLink(token: string) {
  return `${publicEnv.NEXT_PUBLIC_APP_URL}/fr/invitations/${token}`;
}

/** Sends the invitation e-mail. Returns false when it could not go out. */
export async function sendInvitationEmail(input: {
  workspaceId: string;
  email: string;
  role: WorkspaceRole;
  token: string;
  expiresAt: Date;
}) {
  const supabase = await createClient();
  const [{ data: workspace }, inviter] = await Promise.all([
    supabase
      .from("workspaces")
      .select("name, organization:organizations(name)")
      .eq("id", input.workspaceId)
      .maybeSingle(),
    getCurrentProfile(),
  ]);
  if (!workspace) return false;

  return sendEmail(
    invitationEmail({
      to: input.email,
      link: invitationLink(input.token),
      workspaceName: workspace.name,
      organizationName: workspace.organization?.name ?? null,
      inviterName: inviter?.name ?? "Un membre de KolabReport",
      role: input.role,
      expiresAt: input.expiresAt,
    }),
  );
}
