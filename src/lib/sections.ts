import { z } from "zod";
import { SECTION_STATUSES } from "@/lib/section-statuses";
import { isManager, type WorkspaceRole } from "@/lib/workspaces/roles";

export { SECTION_STATUSES, isSectionStatus, type SectionStatus } from "@/lib/section-statuses";

export const sectionStatusSchema = z.enum(SECTION_STATUSES);

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
