"use server";

import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { workspaceErrorKey, type WorkspaceErrorKey } from "@/lib/workspaces/errors";
import { setCurrentWorkspaceCookie } from "@/lib/workspaces/server";

export type AcceptState = { error?: WorkspaceErrorKey };

// Tokens are 32 bytes in base64url (43 characters).
const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{20,100}$/);

/** Joins the workspace from the invitation link, then opens its dashboard. */
export async function acceptInvitation(_prev: AcceptState, formData: FormData): Promise<AcceptState> {
  const token = tokenSchema.safeParse(formData.get("token"));
  if (!token.success) return { error: "invitationInvalid" };

  const supabase = await createClient();
  const { data: workspaceId, error } = await supabase.rpc("accept_workspace_invitation", {
    token: token.data,
  });
  // The organization's plan may refuse: member limit (KR041) or read-only
  // (KR043). The invitee is not a member, so the messages have no numbers.
  if (error?.code === "KR043") return { error: "readOnlyInvitee" };
  if (error || !workspaceId) return { error: workspaceErrorKey(error) };

  await setCurrentWorkspaceCookie(workspaceId);
  const locale = await getLocale();
  return redirect({ href: "/tableau-de-bord", locale });
}
