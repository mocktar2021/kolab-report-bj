// Who hears that an organization was deleted (KRB-180). No server-only
// import, so it is tested on its own.

/** An owner or admin of a workspace of the organization, with the e-mail of their profile. */
export type ManagerRow = { user_id: string; workspace_id: string; email: string | null };

export type DeletionRecipient = { email: string; workspaceNames: string[] };

/**
 * One e-mail per person: every owner and admin of the workspaces that go,
 * except the person deleting, with the names of their own workspaces.
 * Rows without an e-mail or a known workspace are left out.
 */
export function organizationDeletionRecipients(
  managers: ManagerRow[],
  workspaceNames: Map<string, string>,
  actorId: string,
): DeletionRecipient[] {
  const byUser = new Map<string, { email: string; names: Set<string> }>();
  for (const row of managers) {
    const name = workspaceNames.get(row.workspace_id);
    const email = row.email?.trim();
    if (row.user_id === actorId || !name || !email) continue;
    const entry = byUser.get(row.user_id) ?? { email, names: new Set<string>() };
    entry.names.add(name);
    byUser.set(row.user_id, entry);
  }
  return [...byUser.values()]
    .map((entry) => ({
      email: entry.email,
      workspaceNames: [...entry.names].sort((a, b) => a.localeCompare(b, "fr")),
    }))
    .sort((a, b) => a.email.localeCompare(b.email));
}
