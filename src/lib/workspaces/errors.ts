// Messages are keys under Workspaces.errors in messages/fr.json.
export type WorkspaceErrorKey = "lastOwner" | "assigneeNotMember" | "forbidden" | "invalidInput" | "generic";

/**
 * Maps a Postgres error code from Supabase to a message key. KR001 and KR002
 * are raised by the triggers in the RBAC migration.
 */
export function workspaceErrorKey(error: { code?: string | null } | null | undefined): WorkspaceErrorKey {
  switch (error?.code) {
    case "KR001":
      return "lastOwner";
    case "KR002":
      return "assigneeNotMember";
    case "42501":
      return "forbidden";
    case "22023":
    case "23514":
      return "invalidInput";
    default:
      return "generic";
  }
}
