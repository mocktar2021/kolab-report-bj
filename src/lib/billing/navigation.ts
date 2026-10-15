import type { MyWorkspace } from "@/lib/workspaces/types";

// The "Abonnement" link of the app navigation (KRB-177). No server-only
// import: the sidebar, a Client Component, uses it.

/**
 * The organization of the current workspace when the user reads its billing
 * page: `billingOrganizationIds` comes from public.my_billing_organizations,
 * which follows private.can_read_org_billing (the organization owner,
 * whatever their roles, and the owners and admins of its workspaces) and is
 * empty while billing is not enforced. Null when there is no link to show.
 */
export function billingOrganizationOf(
  workspaces: readonly MyWorkspace[],
  currentWorkspaceId: string | null,
  billingOrganizationIds: readonly string[],
): string | null {
  const current = workspaces.find((workspace) => workspace.id === currentWorkspaceId);
  return current && billingOrganizationIds.includes(current.organizationId) ? current.organizationId : null;
}
