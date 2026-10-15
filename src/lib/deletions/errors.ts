// Errors of delete_report, delete_workspace and delete_organization (KRB-180).
// No server-only import: the dialog imports the state type.

/** Messages are keys under Deletion.errors in messages/fr.json. */
export type DeletionErrorKey =
  | "forbidden"
  | "notFound"
  | "confirmation"
  | "stale"
  | "invalidInput"
  | "generic";

/** What a deletion action answers when it does not redirect. */
export type DeletionState =
  | { status: "idle" }
  | { status: "error"; error: DeletionErrorKey; message: string };

/**
 * Maps a Postgres error code from the delete functions to a message key:
 * 42501 not allowed, P0002 not found (or not visible), KR070 the typed title
 * or name does not match, 40001 a workspace was added to the organization
 * meanwhile.
 */
export function deletionErrorKey(error: { code?: string | null } | null | undefined): DeletionErrorKey {
  switch (error?.code) {
    case "42501":
      return "forbidden";
    case "P0002":
      return "notFound";
    case "KR070":
      return "confirmation";
    case "40001":
      return "stale";
    case "22023":
    case "22P02":
      return "invalidInput";
    default:
      return "generic";
  }
}
