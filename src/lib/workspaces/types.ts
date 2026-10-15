import type { WorkspaceRole } from "./roles";

/** A workspace the signed-in user belongs to, with their role in it. */
export type MyWorkspace = {
  id: string;
  name: string;
  organizationId: string;
  organizationName: string | null;
  role: WorkspaceRole;
};

/** An organization the signed-in user can add a workspace to (my_manageable_organizations). */
export type ManageableOrganization = {
  id: string;
  name: string;
};
