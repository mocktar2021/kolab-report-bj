"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";
import { workspaceErrorKey, type WorkspaceErrorKey } from "@/lib/workspaces/errors";
import {
  createWorkspaceSchema,
  workspaceFieldErrors,
  type WorkspaceFieldErrorKey,
} from "@/lib/workspaces/schemas";
import { setCurrentWorkspaceCookie } from "@/lib/workspaces/server";

export type WizardField = "organizationName" | "workspaceName" | "reportTitle";

export type CreateWorkspaceState =
  | { status: "idle" }
  | {
      status: "error";
      fieldErrors?: Partial<Record<WizardField, WorkspaceFieldErrorKey>>;
      formError?: WorkspaceErrorKey;
    };

/**
 * Creates the organization, the workspace (with the user as owner) and the
 * first report in one transaction, then opens the report.
 */
export async function createWorkspace(
  _prev: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  const parsed = createWorkspaceSchema.safeParse({
    organizationName: String(formData.get("organizationName") ?? ""),
    workspaceName: String(formData.get("workspaceName") ?? ""),
    reportTitle: String(formData.get("reportTitle") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: workspaceFieldErrors<WizardField>(parsed.error) };
  }

  const supabase = await createClient();
  const { data, error } = await supabase
    .rpc("create_workspace_with_owner", {
      organization_name: parsed.data.organizationName,
      workspace_name: parsed.data.workspaceName,
      report_title: parsed.data.reportTitle,
    })
    .single();
  if (error || !data) {
    return { status: "error", formError: workspaceErrorKey(error) };
  }

  await setCurrentWorkspaceCookie(data.workspace_id);
  const locale = await getLocale();
  return redirect({ href: `/rapports/${data.report_id}`, locale });
}
