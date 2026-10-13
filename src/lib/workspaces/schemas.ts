import { z } from "zod";

// Messages are keys under Workspaces.fieldErrors in messages/fr.json. Lengths
// match the checks on the organizations, workspaces, reports and
// report_sections tables.
export const organizationNameSchema = z.string().trim().min(2, "nameLength").max(120, "nameLength");
export const workspaceNameSchema = z.string().trim().min(2, "nameLength").max(120, "nameLength");
export const reportTitleSchema = z.string().trim().min(2, "titleLength").max(200, "titleLength");
export const sectionTitleSchema = z
  .string()
  .trim()
  .min(1, "sectionTitleLength")
  .max(200, "sectionTitleLength");

export const createWorkspaceSchema = z.object({
  organizationName: organizationNameSchema,
  workspaceName: workspaceNameSchema,
  reportTitle: reportTitleSchema,
});

// report_sections.weight is numeric(6, 2) and must be above 0. A comma is
// accepted as the decimal separator, as French users type it.
export const sectionWeightSchema = z
  .string()
  .trim()
  .transform((value) => Number(value.replace(",", ".")))
  .pipe(z.number({ invalid_type_error: "weightRange" }).min(0.01, "weightRange").max(9999.99, "weightRange"));

export const uuidSchema = z.string().uuid();

export type WorkspaceFieldErrorKey = "nameLength" | "titleLength" | "sectionTitleLength" | "weightRange";

/** First error key per field, from a zod error whose messages are WorkspaceFieldErrorKey values. */
export function workspaceFieldErrors<T extends string>(
  error: z.ZodError,
): Partial<Record<T, WorkspaceFieldErrorKey>> {
  const out: Partial<Record<T, WorkspaceFieldErrorKey>> = {};
  for (const issue of error.issues) {
    const field = issue.path[0] as T | undefined;
    if (field && !out[field]) out[field] = issue.message as WorkspaceFieldErrorKey;
  }
  return out;
}
