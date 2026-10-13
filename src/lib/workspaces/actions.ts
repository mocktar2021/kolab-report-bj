"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { uuidSchema } from "./schemas";
import { requireWorkspaceRole, setCurrentWorkspaceCookie } from "./server";

/** Switcher action: only workspaces the user belongs to can be selected. */
export async function selectWorkspace(workspaceId: string) {
  const id = uuidSchema.safeParse(workspaceId);
  if (id.success && (await requireWorkspaceRole(id.data))) {
    await setCurrentWorkspaceCookie(id.data);
  }
  const locale = await getLocale();
  redirect({ href: "/tableau-de-bord", locale });
}
