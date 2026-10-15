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
  | "generic"
  // Billing refusals (KR040 to KR044). The keys with numbers or a date come
  // from describeWorkspaceError (src/lib/billing/errors.ts), which reads them
  // from the workspace's plan.
  | "seatLimit"
  | "seatLimitRole"
  | "seatLimitInvitee"
  | "reportLimit"
  | "reportLimitReopen"
  | "missionReport"
  | "readOnly"
  | "readOnlyMember"
  | "readOnlyNoPlan"
  | "readOnlyInvitee"
  | "templatesNotIncluded"
  | "billingLimit"
  | "billingReadOnly";

/** What the billing messages show: {plan}, {max} and {date}. */
export type WorkspaceErrorValues = { plan?: string; max?: number; date?: string };

/** KR040 to KR044: the organization's plan refused the change. */
export const BILLING_ERROR_CODES = ["KR040", "KR041", "KR042", "KR043", "KR044"] as const;

export function isBillingError(error: { code?: string | null } | null | undefined): boolean {
  return (BILLING_ERROR_CODES as readonly string[]).includes(error?.code ?? "");
}

/**
 * Maps a Postgres error code from Supabase to a message key. KR001 and KR002
 * come from the RBAC migration, KR003 to KR007 from the invitations one,
 * KR020 from the report workflow one (a final report is frozen), KR040 to
 * KR044 from the billing limits one. A billing refusal maps to a message
 * without numbers here; describeWorkspaceError gives the precise one.
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
    case "KR040":
    case "KR042":
      return "billingLimit";
    case "KR041":
      return "seatLimitInvitee";
    case "KR043":
      return "billingReadOnly";
    case "KR044":
      return "templatesNotIncluded";
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
