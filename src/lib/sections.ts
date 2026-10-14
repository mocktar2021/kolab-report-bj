import { z } from "zod";
import { isManager, type WorkspaceRole } from "@/lib/workspaces/roles";

// Mirrors the public.section_status enum in supabase/migrations.
export const SECTION_STATUSES = ["not_started", "in_progress", "completed"] as const;

export const sectionStatusSchema = z.enum(SECTION_STATUSES);

export type SectionStatus = z.infer<typeof sectionStatusSchema>;

/** Longest text of a section, in characters (save_section_content checks it too). */
export const MAX_SECTION_CONTENT = 100_000;

/**
 * Same rule as private.can_edit_section: managers edit every section,
 * experts only the ones assigned to them.
 */
export function canEditSection(
  access: { userId: string; role: WorkspaceRole },
  assignedTo: string | null,
): boolean {
  return isManager(access.role) || (access.role === "expert" && assignedTo === access.userId);
}
