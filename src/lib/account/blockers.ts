// What stops a person from deleting their account (KRB-186), as
// public.my_account_deletion_blockers() returns it, and where each one is
// fixed. The rules live in the database (migration "account deletion"):
// owning an organization, and being the only owner of a workspace, with or
// without other members.

/** The organization page and the workspace settings page come with KRB-180. */
export function organizationSettingsPath(organizationId: string) {
  return `/organisations/${organizationId}`;
}

export function workspaceSettingsPath(workspaceId: string) {
  return `/espaces/${workspaceId}/parametres`;
}

export function workspaceMembersPath(workspaceId: string) {
  return `/espaces/${workspaceId}/membres`;
}

/** The transfer form on the account page. */
export const TRANSFER_ANCHOR = "transfert";

/** /fr/compte?transfert=effectue shows that a transfer went through. */
export const TRANSFER_DONE_PARAM = "transfert";
export const TRANSFER_DONE = "effectue";

export type DeletionBlocker =
  | {
      kind: "organization_owner";
      organizationId: string;
      organizationName: string;
      /** Owners of its workspaces who can take it over. */
      successors: number;
    }
  | {
      kind: "only_owner";
      workspaceId: string;
      workspaceName: string;
      /** Members who would stay without an owner. */
      otherMembers: number;
    }
  | { kind: "only_member"; workspaceId: string; workspaceName: string };

/** A row of my_account_deletion_blockers(). */
export type BlockerRow = {
  kind: string;
  organization_id: string | null;
  organization_name: string | null;
  workspace_id: string | null;
  workspace_name: string | null;
  other_members: number | null;
  successors: number | null;
};

/** Rows of an unknown kind or with a missing id are dropped. */
export function toBlockers(rows: BlockerRow[]): DeletionBlocker[] {
  return rows.flatMap((row): DeletionBlocker[] => {
    if (row.kind === "organization_owner" && row.organization_id) {
      return [
        {
          kind: "organization_owner",
          organizationId: row.organization_id,
          organizationName: row.organization_name ?? "",
          successors: row.successors ?? 0,
        },
      ];
    }
    if (row.kind === "only_owner" && row.workspace_id) {
      return [
        {
          kind: "only_owner",
          workspaceId: row.workspace_id,
          workspaceName: row.workspace_name ?? "",
          otherMembers: row.other_members ?? 0,
        },
      ];
    }
    if (row.kind === "only_member" && row.workspace_id) {
      return [
        { kind: "only_member", workspaceId: row.workspace_id, workspaceName: row.workspace_name ?? "" },
      ];
    }
    return [];
  });
}

/** Keys under Account.delete.links in messages/fr.json. */
export type BlockerLinkKey = "transfer" | "deleteOrganization" | "members" | "deleteWorkspace";

/** The ways out of a blocker, in the order the page shows them. */
export function blockerLinks(blocker: DeletionBlocker): Array<{ key: BlockerLinkKey; href: string }> {
  switch (blocker.kind) {
    case "organization_owner":
      return [
        ...(blocker.successors > 0 ? [{ key: "transfer" as const, href: `/compte#${TRANSFER_ANCHOR}` }] : []),
        { key: "deleteOrganization", href: organizationSettingsPath(blocker.organizationId) },
      ];
    case "only_owner":
      return [
        { key: "members", href: workspaceMembersPath(blocker.workspaceId) },
        { key: "deleteWorkspace", href: workspaceSettingsPath(blocker.workspaceId) },
      ];
    case "only_member":
      return [{ key: "deleteWorkspace", href: workspaceSettingsPath(blocker.workspaceId) }];
  }
}
