"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { isReportFrozen } from "@/lib/reports/status";
import { createClient } from "@/lib/supabase/server";
import { workspaceErrorKey, type WorkspaceErrorKey } from "@/lib/workspaces/errors";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import {
  reportTitleSchema,
  uuidSchema,
  workspaceFieldErrors,
  type WorkspaceFieldErrorKey,
} from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

export type RenameReportState =
  | { status: "idle" }
  | { status: "success" }
  | {
      status: "error";
      error?: WorkspaceErrorKey;
      fieldErrors?: Partial<Record<"title", WorkspaceFieldErrorKey>>;
    };

/**
 * "Renommer" on the report page (KRB-202). Owners and admins, while the
 * report is not final. It writes with the user's client, so the "reports:
 * managers update open reports" policy and the billing_read_only trigger
 * (KR043) still have the last word.
 */
export async function renameReport(_prev: RenameReportState, formData: FormData): Promise<RenameReportState> {
  const reportId = uuidSchema.safeParse(formData.get("reportId"));
  if (!reportId.success) return { status: "error", error: "invalidInput" };
  const parsed = z.object({ title: reportTitleSchema }).safeParse({ title: formData.get("title") ?? "" });
  if (!parsed.success) {
    return { status: "error", fieldErrors: workspaceFieldErrors<"title">(parsed.error) };
  }

  const supabase = await createClient();
  const { data: report } = await supabase
    .from("reports")
    .select("id, workspace_id, status")
    .eq("id", reportId.data)
    .maybeSingle();
  if (!report || !(await requireWorkspaceRole(report.workspace_id, MANAGER_ROLES))) {
    return { status: "error", error: "forbidden" };
  }
  if (isReportFrozen(report.status)) return { status: "error", error: "reportFinal" };

  // RLS skips a row it refuses without an error: no row back means refused.
  const { data, error } = await supabase
    .from("reports")
    .update({ title: parsed.data.title })
    .eq("id", report.id)
    .select("id");
  if (error) return { status: "error", error: workspaceErrorKey(error) };
  if (!data || data.length === 0) return { status: "error", error: "forbidden" };

  revalidatePath("/", "layout");
  return { status: "success" };
}
