// Where a user goes after deleting a workspace or an organization (KRB-180).

type Remaining = { id: string; organizationId: string };

/**
 * The workspace to open next among the ones the user still belongs to: the
 * first one of `organizationId` when there is one, else the first one left.
 * Null when none is left, so the user goes to the wizard.
 */
export function workspaceAfterDeletion(
  remaining: readonly Remaining[],
  organizationId: string | null,
): string | null {
  const sameOrganization = organizationId
    ? remaining.find((workspace) => workspace.organizationId === organizationId)
    : undefined;
  return (sameOrganization ?? remaining[0])?.id ?? null;
}
