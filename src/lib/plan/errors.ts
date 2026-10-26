import type { ExtractedPlan } from "./types";

// What POST /api/reports/[id]/plan answers (KRB-196), shared by the route and
// the import page. Messages for PlanImportErrorKey are under
// PlanImport.errors in messages/fr.json.

export type PlanImportErrorKey =
  | "unauthenticated"
  | "notFound"
  | "forbidden"
  | "reportFinal"
  | "readOnly"
  | "invalidRequest"
  | "fileType"
  | "fileEmpty"
  | "fileTooLarge"
  | "contentMismatch"
  | "textEmpty"
  | "textTooLong"
  // The file could not be read (src/lib/plan/types.ts).
  | "unreadable"
  | "tooLarge"
  | "timeout"
  | "pdfNoText"
  | "pdfLocked"
  | "nothingFound"
  // The AI reading of a PDF.
  | "aiUnavailable"
  | "rateLimited"
  | "quotaExceeded"
  | "quotaExceededTrial"
  | "quotaExceededMission"
  | "quotaUsed"
  // The token volume of the plan is used up (KRB-252).
  | "tokensUsed"
  | "aiFailed"
  | "aiTimeout"
  | "generic";

/** {max} drafts and the {date} the month's allowance comes back, for the quota messages. */
export type PlanImportErrorValues = { max?: number; date?: string };

export type PlanImportErrorBody = {
  error: PlanImportErrorKey;
  /** Seconds before trying again, for rateLimited and a monthly quota. */
  retryAfter?: number;
  values?: PlanImportErrorValues;
};

/** The plan found, for the preview. */
export type PlanReadBody = ExtractedPlan;

/** The header that carries the file name, encoded with encodeURIComponent. */
export const FILE_NAME_HEADER = "x-file-name";
