"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { redirect } from "@/i18n/navigation";
import type { DeletionState } from "@/lib/deletions/errors";
import { deletionRefused } from "@/lib/deletions/server";
import { log } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { workspaceErrorKey, type WorkspaceErrorKey } from "@/lib/workspaces/errors";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import {
  sectionInstructionsSchema,
  sectionTitleSchema,
  uuidSchema,
  workspaceFieldErrors,
  type WorkspaceFieldErrorKey,
} from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

export type SectionDetailsState =
  | { status: "idle" }
  | { status: "success" }
  | {
      status: "error";
      error?: WorkspaceErrorKey;
      fieldErrors?: Partial<Record<"title" | "instructions", WorkspaceFieldErrorKey>>;
    };

const detailsSchema = z.object({
  title: sectionTitleSchema,
  instructions: sectionInstructionsSchema,
});

/**
 * Title and instructions for the AI of a section or subsection (KRB-195).
 * Owners and admins only: RLS lets the assigned expert update the row, and the
 * guard_expert_update trigger refuses them these two columns.
 */
export async function updateSectionDetails(
  _prev: SectionDetailsState,
  formData: FormData,
): Promise<SectionDetailsState> {
  const sectionId = uuidSchema.safeParse(formData.get("sectionId"));
  if (!sectionId.success) return { status: "error", error: "invalidInput" };
  const parsed = detailsSchema.safeParse({
    title: formData.get("title") ?? "",
    instructions: formData.get("instructions") ?? "",
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: workspaceFieldErrors<"title" | "instructions">(parsed.error) };
  }

  const supabase = await createClient();
  const { data: section } = await supabase
    .from("report_sections")
    .select("id, workspace_id, report:reports(status)")
    .eq("id", sectionId.data)
    .maybeSingle();
  if (!section || !(await requireWorkspaceRole(section.workspace_id, MANAGER_ROLES))) {
    return { status: "error", error: "forbidden" };
  }
  if (section.report?.status === "final") return { status: "error", error: "reportFinal" };

  const { data, error } = await supabase
    .from("report_sections")
    .update({
      title: parsed.data.title,
      // Stored without the NUL character Postgres refuses; empty means none.
      instructions: parsed.data.instructions.replaceAll("\u0000", "") || null,
    })
    .eq("id", section.id)
    .select("id");
  if (error) return { status: "error", error: workspaceErrorKey(error) };
  if (!data || data.length === 0) return { status: "error", error: "forbidden" };

  revalidatePath("/", "layout");
  return { status: "success" };
}

/**
 * "Supprimer la section" (KRB-195). delete_report_section checks the rights
 * (owners and admins, report not final), queues the files of the section and
 * its subsections, and records the deletion. The user goes back to the report.
 */
export async function deleteSection(_prev: DeletionState, formData: FormData): Promise<DeletionState> {
  const sectionId = uuidSchema.safeParse(formData.get("id"));
  if (!sectionId.success) return deletionRefused(null, "invalidInput");

  const supabase = await createClient();
  // Where to go afterwards. A section the user can't see answers "not found" below.
  const { data: section } = await supabase
    .from("report_sections")
    .select("report_id")
    .eq("id", sectionId.data)
    .maybeSingle();
  const { error } = await supabase.rpc("delete_report_section", {
    p_section_id: sectionId.data.toLowerCase(),
  });
  if (error || !section) return deletionRefused(error ?? { code: "P0002" });

  log.info("deletions: section deleted", { sectionId: sectionId.data });
  revalidatePath("/", "layout");
  const locale = await getLocale();
  return redirect({ href: `/rapports/${section.report_id}`, locale });
}
