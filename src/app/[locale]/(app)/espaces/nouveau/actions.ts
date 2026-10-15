"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { describeWorkspaceError } from "@/lib/billing/errors";
import { createClient } from "@/lib/supabase/server";
import type { WorkspaceErrorKey, WorkspaceErrorValues } from "@/lib/workspaces/errors";
import {
  createWorkspaceInOrganizationSchema,
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
      /** Numbers of the billing messages (member or report limit, read-only). */
      formErrorValues?: WorkspaceErrorValues;
    };

type Created = { workspace_id: string; report_id: string };

/**
 * Creates the workspace (with the user as owner) and its first report in one
 * transaction, then opens the report. With an `organizationId`, the workspace
 * goes into that organization, which the user must manage. Without one, a new
 * organization is created with the name typed in the wizard.
 */
export async function createWorkspace(
  _prev: CreateWorkspaceState,
  formData: FormData,
): Promise<CreateWorkspaceState> {
  const organizationId = String(formData.get("organizationId") ?? "");
  const workspaceName = String(formData.get("workspaceName") ?? "");
  const reportTitle = String(formData.get("reportTitle") ?? "");
  const supabase = await createClient();
  let created: { data: Created | null; error: { code?: string | null } | null };

  if (organizationId) {
    const parsed = createWorkspaceInOrganizationSchema.safeParse({
      organizationId,
      workspaceName,
      reportTitle,
    });
    if (!parsed.success) {
      // The id comes from the list of organizations: a bad one is a forged form.
      if (parsed.error.issues.some((issue) => issue.path[0] === "organizationId")) {
        return { status: "error", formError: "invalidInput" };
      }
      return { status: "error", fieldErrors: workspaceFieldErrors<WizardField>(parsed.error) };
    }
    // The function checks that the user may add a workspace to this organization (42501).
    created = await supabase
      .rpc("create_workspace_in_organization", {
        p_organization_id: parsed.data.organizationId,
        p_workspace_name: parsed.data.workspaceName,
        p_report_title: parsed.data.reportTitle,
      })
      .single();
  } else {
    const parsed = createWorkspaceSchema.safeParse({
      organizationName: String(formData.get("organizationName") ?? ""),
      workspaceName,
      reportTitle,
    });
    if (!parsed.success) {
      return { status: "error", fieldErrors: workspaceFieldErrors<WizardField>(parsed.error) };
    }
    created = await supabase
      .rpc("create_workspace_with_owner", {
        organization_name: parsed.data.organizationName,
        workspace_name: parsed.data.workspaceName,
        report_title: parsed.data.reportTitle,
      })
      .single();
  }

  const { data, error } = created;
  if (error || !data) {
    // In an existing organization, its plan may refuse: the creator takes a
    // seat (KR040), the first report a slot (KR042), or it is read-only (KR043).
    const described = await describeWorkspaceError(error, organizationId ? { organizationId } : {});
    return { status: "error", formError: described.error, formErrorValues: described.values };
  }

  await setCurrentWorkspaceCookie(data.workspace_id);
  const locale = await getLocale();
  return redirect({ href: `/rapports/${data.report_id}`, locale });
}
