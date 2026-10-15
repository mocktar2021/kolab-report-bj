"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { describeWorkspaceError } from "@/lib/billing/errors";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceErrorKey, WorkspaceErrorValues } from "@/lib/workspaces/errors";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import {
  createReportSchema,
  workspaceFieldErrors,
  type WorkspaceFieldErrorKey,
} from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

export type CreateReportState =
  | { status: "idle" }
  | {
      status: "error";
      fieldErrors?: Partial<Record<"title", WorkspaceFieldErrorKey>>;
      formError?: WorkspaceErrorKey;
      /** Numbers of the billing messages (report limit, read-only). */
      formErrorValues?: WorkspaceErrorValues;
    };

/**
 * "Nouveau rapport" on the dashboard: adds a report to the workspace, then
 * opens it so its sections can be added. Owners and admins only. The insert
 * uses the user's client, so the "reports: managers create" policy applies
 * on top of the role check.
 */
export async function createReport(workspaceId: string, title: string): Promise<CreateReportState> {
  const parsed = createReportSchema.safeParse({ workspaceId, title });
  if (!parsed.success) {
    // The workspace id comes from the page, never from typing.
    if (parsed.error.issues.some((issue) => issue.path[0] === "workspaceId")) {
      return { status: "error", formError: "invalidInput" };
    }
    return { status: "error", fieldErrors: workspaceFieldErrors<"title">(parsed.error) };
  }
  if (!(await requireWorkspaceRole(parsed.data.workspaceId, MANAGER_ROLES))) {
    return { status: "error", formError: "forbidden" };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("reports")
    .insert({ workspace_id: parsed.data.workspaceId, title: parsed.data.title })
    .select("id")
    .single();
  if (error || !data) {
    // The plan may refuse it: report limit (KR042) or read-only (KR043).
    const described = await describeWorkspaceError(error, { workspaceId: parsed.data.workspaceId });
    return { status: "error", formError: described.error, formErrorValues: described.values };
  }

  revalidatePath("/", "layout");
  const locale = await getLocale();
  return redirect({ href: `/rapports/${data.id}`, locale });
}
