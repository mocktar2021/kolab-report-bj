import "server-only";
import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { getLocale, getTranslations } from "next-intl/server";
import { PUBLISHER } from "@/content/legal/publisher";
import { redirect } from "@/i18n/navigation";
import { log } from "@/lib/log";
import {
  CURRENT_WORKSPACE_COOKIE,
  clearCurrentWorkspaceCookie,
  getMyWorkspaces,
  setCurrentWorkspaceCookie,
} from "@/lib/workspaces/server";
import { deletionErrorKey, type DeletionErrorKey, type DeletionState } from "./errors";
import { workspaceAfterDeletion } from "./next-workspace";

// What the three deletion actions (KRB-180) share: the French message of a
// refusal, and where the user goes once the deletion is done.

/** What was deleted, as the dashboard notice reads it from ?suppression=. */
export const DELETED_KINDS = ["rapport", "espace", "organisation"] as const;

export type DeletedKind = (typeof DELETED_KINDS)[number];

/** The state a refused deletion answers, with its message in French. */
export async function deletionRefused(
  error: { code?: string | null; message?: string } | null,
  key: DeletionErrorKey = deletionErrorKey(error),
): Promise<DeletionState> {
  if (key === "generic") log.error("deletions: the deletion failed", { error: error?.message });
  const t = await getTranslations("Deletion.errors");
  return { status: "error", error: key, message: t(key, { support: PUBLISHER.email }) };
}

/** After a report is deleted: back to the dashboard, which says so. */
export async function leaveDeletedReport(): Promise<never> {
  revalidatePath("/", "layout");
  const locale = await getLocale();
  return redirect({ href: "/tableau-de-bord?suppression=rapport", locale });
}

/**
 * After a workspace or an organization is deleted: the switcher cookie moves
 * to a workspace the user still belongs to, one of `organizationId` first,
 * and the user lands on its dashboard. With none left, the cookie goes and
 * the user lands on the wizard.
 */
export async function leaveDeletedWorkspaces(
  organizationId: string | null,
  kind: DeletedKind,
): Promise<never> {
  const next = workspaceAfterDeletion(await getMyWorkspaces(), organizationId);
  if (next) await setCurrentWorkspaceCookie(next);
  else await clearCurrentWorkspaceCookie();
  revalidatePath("/", "layout");
  const locale = await getLocale();
  return redirect({ href: next ? `/tableau-de-bord?suppression=${kind}` : "/espaces/nouveau", locale });
}

/**
 * After the organization owner deleted one workspace from the organization
 * page: the switcher cookie moves only when it named that workspace, and the
 * user goes back to the organization page, which says so.
 */
export async function leaveWorkspaceDeletedFromOrganization(
  workspaceId: string,
  organizationId: string,
): Promise<never> {
  const cookieStore = await cookies();
  if (cookieStore.get(CURRENT_WORKSPACE_COOKIE)?.value === workspaceId) {
    const next = workspaceAfterDeletion(await getMyWorkspaces(), organizationId);
    if (next) await setCurrentWorkspaceCookie(next);
    else await clearCurrentWorkspaceCookie();
  }
  revalidatePath("/", "layout");
  const locale = await getLocale();
  return redirect({ href: `/organisations/${organizationId}?suppression=espace`, locale });
}
