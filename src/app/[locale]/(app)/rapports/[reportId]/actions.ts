"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { workspaceErrorKey, type WorkspaceErrorKey } from "@/lib/workspaces/errors";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import {
  sectionTitleSchema,
  sectionWeightSchema,
  uuidSchema,
  workspaceFieldErrors,
  type WorkspaceFieldErrorKey,
} from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

export type SectionActionState =
  | { status: "idle" }
  | { status: "success" }
  | {
      status: "error";
      error?: WorkspaceErrorKey;
      fieldErrors?: Partial<Record<"title" | "weight", WorkspaceFieldErrorKey>>;
    };

const FORBIDDEN: SectionActionState = { status: "error", error: "forbidden" };

/** Adds a section at the end of the report. Owners and admins only. */
export async function addSection(_prev: SectionActionState, formData: FormData): Promise<SectionActionState> {
  const reportId = uuidSchema.safeParse(formData.get("reportId"));
  if (!reportId.success) return { status: "error", error: "invalidInput" };
  const parsed = z.object({ title: sectionTitleSchema }).safeParse({ title: formData.get("title") ?? "" });
  if (!parsed.success) {
    return { status: "error", fieldErrors: workspaceFieldErrors<"title">(parsed.error) };
  }

  const supabase = await createClient();
  const { data: report } = await supabase
    .from("reports")
    .select("id, workspace_id")
    .eq("id", reportId.data)
    .maybeSingle();
  if (!report || !(await requireWorkspaceRole(report.workspace_id, MANAGER_ROLES))) return FORBIDDEN;

  const { data: last } = await supabase
    .from("report_sections")
    .select("position")
    .eq("report_id", report.id)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();

  const { error } = await supabase.from("report_sections").insert({
    workspace_id: report.workspace_id,
    report_id: report.id,
    title: parsed.data.title,
    position: (last?.position ?? -1) + 1,
  });
  if (error) return { status: "error", error: workspaceErrorKey(error) };

  revalidatePath("/", "layout");
  return { status: "success" };
}

/**
 * Sets the expert and the weight of a section. Owners and admins only; the
 * check_assignee trigger rejects anyone who is not an owner, admin or expert
 * of the workspace.
 */
export async function updateSectionAssignment(
  _prev: SectionActionState,
  formData: FormData,
): Promise<SectionActionState> {
  const sectionId = uuidSchema.safeParse(formData.get("sectionId"));
  const assignee = String(formData.get("assignedTo") ?? "");
  const assignedTo = assignee === "" ? null : uuidSchema.safeParse(assignee);
  if (!sectionId.success || (assignedTo && !assignedTo.success)) {
    return { status: "error", error: "invalidInput" };
  }
  const weight = sectionWeightSchema.safeParse(String(formData.get("weight") ?? ""));
  if (!weight.success) {
    return { status: "error", fieldErrors: { weight: "weightRange" } };
  }

  const supabase = await createClient();
  const { data: section } = await supabase
    .from("report_sections")
    .select("id, workspace_id")
    .eq("id", sectionId.data)
    .maybeSingle();
  if (!section || !(await requireWorkspaceRole(section.workspace_id, MANAGER_ROLES))) return FORBIDDEN;

  const { data, error } = await supabase
    .from("report_sections")
    .update({ assigned_to: assignedTo ? assignedTo.data : null, weight: weight.data })
    .eq("id", section.id)
    .select("id");
  if (error) return { status: "error", error: workspaceErrorKey(error) };
  if (!data || data.length === 0) return FORBIDDEN;

  revalidatePath("/", "layout");
  return { status: "success" };
}

export type ReorderResult =
  | { ok: true }
  | { ok: false; error: "forbidden" | "stale" | "invalidInput" | "generic" };

const reorderSchema = z.object({
  reportId: uuidSchema,
  sectionIds: z.array(uuidSchema).max(500),
});

/**
 * New order of a report's sections, owners and admins only. sectionIds lists
 * every section once; the database rejects any other list as stale, which
 * means another session added, removed or moved a section first.
 */
export async function reorderSections(reportId: string, sectionIds: string[]): Promise<ReorderResult> {
  const parsed = reorderSchema.safeParse({ reportId, sectionIds });
  if (!parsed.success) return { ok: false, error: "invalidInput" };
  const supabase = await createClient();
  const { error } = await supabase.rpc("reorder_report_sections", {
    p_report_id: parsed.data.reportId.toLowerCase(),
    p_section_ids: parsed.data.sectionIds.map((id) => id.toLowerCase()),
  });
  if (error) {
    switch (error.code) {
      case "42501":
      case "P0002":
        return { ok: false, error: "forbidden" };
      case "40001":
        return { ok: false, error: "stale" };
      default:
        console.error("reports: could not reorder sections", error.message);
        return { ok: false, error: "generic" };
    }
  }
  revalidatePath("/", "layout");
  return { ok: true };
}
