import type { WorkspaceRole } from "./roles";

/** A workspace the signed-in user belongs to, with their role in it. */
export type MyWorkspace = {
  id: string;
  name: string;
  organizationName: string | null;
  role: WorkspaceRole;
};
