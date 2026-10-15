import type { MyWorkspace } from "@/lib/workspaces/types";

// The "Abonnement" link of the app navigation and the links to the billing
// page (KRB-177). No server-only import: the sidebar, a Client Component,
// uses it.

/** Id of the receipts section of the billing page, linked from the payment e-mail. */
export const RECEIPTS_ANCHOR = "recus";

/** The billing page of an organization, without the locale prefix. */
export function billingPagePath(organizationId: string): string {
  return `/organisations/${organizationId}/abonnement`;
}

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
