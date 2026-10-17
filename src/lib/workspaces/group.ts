import type { MyWorkspace } from "./types";

/** The workspaces of one organization, for the switcher and the command palette. */
export type OrganizationGroup = {
  organizationId: string;
  /** Null when the organization's name could not be read. */
  organizationName: string | null;
  workspaces: MyWorkspace[];
};

const collator = new Intl.Collator("fr", { sensitivity: "base", numeric: true });

/**
 * Groups the user's workspaces by organization (KRB-206): organizations by
 * name, workspaces by name inside each one. Groups go by id, since two
 * organizations can share a name. An organization without a name sorts as
 * `unnamed`.
 */
export function groupByOrganization(workspaces: MyWorkspace[], unnamed: string): OrganizationGroup[] {
  const groups = new Map<string, OrganizationGroup>();
  for (const workspace of workspaces) {
    const group = groups.get(workspace.organizationId);
    if (group) {
      group.organizationName ??= workspace.organizationName;
      group.workspaces.push(workspace);
    } else {
      groups.set(workspace.organizationId, {
        organizationId: workspace.organizationId,
        organizationName: workspace.organizationName,
        workspaces: [workspace],
      });
    }
  }

  const nameOf = (group: OrganizationGroup) => group.organizationName ?? unnamed;
  return [...groups.values()]
    .map((group) => ({
      ...group,
      workspaces: [...group.workspaces].sort(
        (a, b) => collator.compare(a.name, b.name) || a.id.localeCompare(b.id),
      ),
    }))
    .sort(
      (a, b) => collator.compare(nameOf(a), nameOf(b)) || a.organizationId.localeCompare(b.organizationId),
    );
}
