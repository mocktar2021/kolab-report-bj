import "server-only";
import { cache } from "react";
import { cookies } from "next/headers";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";
import type { WorkspaceRole } from "./roles";
import type { MyWorkspace } from "./types";

/** Cookie holding the workspace picked in the switcher. */
export const CURRENT_WORKSPACE_COOKIE = "kr-espace";

const ONE_YEAR = 60 * 60 * 24 * 365;

/**
 * Workspaces the signed-in user belongs to, oldest membership first. RLS lets
 * a member read the whole roster of their workspaces, so the user_id filter
 * keeps only their own memberships.
 */
export const getMyWorkspaces = cache(async (): Promise<MyWorkspace[]> => {
  const user = await getCurrentUser();
  if (!user) return [];

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role, workspace:workspaces(id, name, organization:organizations(name))")
    .eq("user_id", user.id)
    .order("created_at", { ascending: true });
  if (error || !data) return [];

  return data.flatMap((row) =>
    row.workspace
      ? [
          {
            id: row.workspace.id,
            name: row.workspace.name,
            organizationName: row.workspace.organization?.name ?? null,
            role: row.role,
          },
        ]
      : [],
  );
});

/** The workspace from the switcher cookie, or the first one when the cookie is missing or stale. */
export const getCurrentWorkspace = cache(async (): Promise<MyWorkspace | null> => {
  const workspaces = await getMyWorkspaces();
  if (workspaces.length === 0) return null;

  const cookieStore = await cookies();
  const selected = cookieStore.get(CURRENT_WORKSPACE_COOKIE)?.value;
  return workspaces.find((workspace) => workspace.id === selected) ?? workspaces[0] ?? null;
});

export type WorkspaceAccess = { userId: string; role: WorkspaceRole };

/**
 * Server-side role check for pages, server actions and route handlers, on top
 * of RLS. Returns null when the user is signed out, is not a member, or has
 * none of `roles` (all roles when omitted). Callers answer with notFound() or
 * an error state, so a workspace the user cannot see looks like one that does
 * not exist.
 */
export async function requireWorkspaceRole(
  workspaceId: string,
  roles?: readonly WorkspaceRole[],
): Promise<WorkspaceAccess | null> {
  const user = await getCurrentUser();
  if (!user) return null;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("workspace_members")
    .select("role")
    .eq("workspace_id", workspaceId)
    .eq("user_id", user.id)
    .maybeSingle();
  if (error || !data) return null;
  if (roles && !roles.includes(data.role)) return null;

  return { userId: user.id, role: data.role };
}

/**
 * Remembers the current workspace. Server-only on purpose: callers check the
 * membership first (a "use server" export would be callable from any client).
 */
export async function setCurrentWorkspaceCookie(workspaceId: string) {
  const cookieStore = await cookies();
  cookieStore.set(CURRENT_WORKSPACE_COOKIE, workspaceId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: ONE_YEAR,
  });
}
