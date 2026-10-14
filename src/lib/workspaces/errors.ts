// Messages are keys under Workspaces.errors in messages/fr.json.
export type WorkspaceErrorKey =
  | "lastOwner"
  | "assigneeNotMember"
  | "invitationInvalid"
  | "invitationUsed"
  | "invitationExpired"
  | "invitationOtherEmail"
  | "alreadyMember"
  | "invitationPending"
  | "reportFinal"
  | "forbidden"
  | "invalidInput"
  | "generic";

/**
 * Maps a Postgres error code from Supabase to a message key. KR001 and KR002
 * come from the RBAC migration, KR003 to KR007 from the invitations one,
 * KR020 from the report workflow one (a final report is frozen).
 */
export function workspaceErrorKey(error: { code?: string | null } | null | undefined): WorkspaceErrorKey {
  switch (error?.code) {
    case "KR001":
      return "lastOwner";
    case "KR002":
      return "assigneeNotMember";
    case "KR003":
      return "invitationInvalid";
    case "KR004":
      return "invitationUsed";
    case "KR005":
      return "invitationExpired";
    case "KR006":
      return "invitationOtherEmail";
    case "KR007":
      return "alreadyMember";
    case "KR020":
      return "reportFinal";
    case "23505":
      return "invitationPending";
    case "42501":
      return "forbidden";
    case "22023":
    case "23514":
      return "invalidInput";
    default:
      return "generic";
  }
}
