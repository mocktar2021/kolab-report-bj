import type { FileRejection } from "./file-types";

// Messages are keys under Deliverables.errors in messages/fr.json.
export type DeliverableErrorKey =
  | FileRejection
  | "unauthenticated"
  | "invalidInput"
  | "sectionNotFound"
  | "forbidden"
  | "reportFinal"
  // The workspace is read-only: its plan ended (KRB-178).
  | "readOnly"
  | "notReceived"
  | "sizeMismatch"
  | "typeMismatch"
  | "contentMismatch"
  | "activeContent"
  | "uploadFailed"
  | "generic";

/** Body of every error answer from /api/deliverables. */
export type DeliverableErrorBody = { error: DeliverableErrorKey };
