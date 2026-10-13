import { z } from "zod";

// Mirrors the public.workspace_role enum, from most to least rights.
export const WORKSPACE_ROLES = ["owner", "admin", "expert", "viewer"] as const;

export const workspaceRoleSchema = z.enum(WORKSPACE_ROLES);

export type WorkspaceRole = z.infer<typeof workspaceRoleSchema>;

/** Roles that manage members, reports and sections. */
export const MANAGER_ROLES = ["owner", "admin"] as const satisfies readonly WorkspaceRole[];

/** Roles a section can be assigned to (check_section_assignee in the RBAC migration). */
export const ASSIGNABLE_ROLES = ["owner", "admin", "expert"] as const satisfies readonly WorkspaceRole[];

export function isManager(role: WorkspaceRole): boolean {
  return (MANAGER_ROLES as readonly WorkspaceRole[]).includes(role);
}

export function isAssignable(role: WorkspaceRole): boolean {
  return (ASSIGNABLE_ROLES as readonly WorkspaceRole[]).includes(role);
}

/**
 * Whether `actor` may change the role of, or remove, a member who has
 * `target`. Same rule as the workspace_members policies: managers only, and
 * only owners touch owners.
 */
export function canManageMember(actor: WorkspaceRole, target: WorkspaceRole): boolean {
  if (!isManager(actor)) return false;
  return target !== "owner" || actor === "owner";
}

/** Roles `actor` may hand out. Only owners grant the owner role. */
export function grantableRoles(actor: WorkspaceRole): WorkspaceRole[] {
  if (actor === "owner") return [...WORKSPACE_ROLES];
  if (actor === "admin") return ["admin", "expert", "viewer"];
  return [];
}
