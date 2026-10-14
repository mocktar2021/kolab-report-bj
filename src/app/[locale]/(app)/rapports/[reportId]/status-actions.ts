"use server";

import { revalidatePath } from "next/cache";
import { after } from "next/server";
import { log } from "@/lib/log";
import { createFinalSnapshot, type SnapshotResult } from "@/lib/reports/snapshot";
import { REPORT_TRANSITIONS, reportActionSchema, type ReportStatus } from "@/lib/reports/status";
import { sendStatusEmails, statusChangeEmails } from "@/lib/reports/workflow";
import { createClient } from "@/lib/supabase/server";
import { getCurrentProfile } from "@/lib/supabase/user";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { requireWorkspaceRole } from "@/lib/workspaces/server";

// Review and finalization of a report (KRB-20). transition_report_status
// checks the transition and the role; these actions add the snapshot of a
// final report, built during the request like an export (the page sets
// maxDuration), and the e-mails.

/** Messages are keys under ReportStatus.errors in messages/fr.json. */
export type ReportStatusErrorKey = "forbidden" | "stale" | "notFound" | "invalidInput" | "generic";

export type ReportStatusState =
  | { status: "idle" }
  | { status: "success"; to: ReportStatus; snapshot: SnapshotResult | null }
  | { status: "error"; error: ReportStatusErrorKey };

function statusErrorKey(error: { code?: string | null } | null): ReportStatusErrorKey {
  switch (error?.code) {
    case "42501":
      return "forbidden";
    case "40001":
      return "stale";
    case "P0002":
      return "notFound";
    case "22023":
      return "invalidInput";
    default:
      return "generic";
  }
}

async function loadReport(id: string) {
  const supabase = await createClient();
  const { data } = await supabase
    .from("reports")
    .select("id, title, workspace_id")
    .eq("id", id)
    .maybeSingle();
  return data;
}

/** Submits, sends back, finalizes or reopens a report, from the status the page showed. */
export async function changeReportStatus(
  _prev: ReportStatusState,
  formData: FormData,
): Promise<ReportStatusState> {
  const reportId = uuidSchema.safeParse(formData.get("reportId"));
  const action = reportActionSchema.safeParse(formData.get("action"));
  if (!reportId.success || !action.success) return { status: "error", error: "invalidInput" };
  const { from, to } = REPORT_TRANSITIONS[action.data];

  const report = await loadReport(reportId.data);
  if (!report) return { status: "error", error: "notFound" };
  const access = await requireWorkspaceRole(report.workspace_id, MANAGER_ROLES);
  if (!access) return { status: "error", error: "forbidden" };

  const supabase = await createClient();
  const { data: change, error } = await supabase
    .rpc("transition_report_status", { p_report_id: report.id, p_from: from, p_to: to })
    .single();
  if (error || !change) {
    if (!error) log.error("report-status: the change returned nothing");
    return { status: "error", error: statusErrorKey(error) };
  }

  const snapshot =
    to === "final"
      ? await createFinalSnapshot({ supabase, report, eventId: change.event_id, userId: access.userId })
      : null;

  const actor = await getCurrentProfile();
  const emails = await statusChangeEmails({
    action: action.data,
    report,
    actorName: actor?.name ?? "",
    recipients: change.recipients,
  }).catch((reason: unknown) => {
    log.error("report-status: could not prepare the e-mails", { error: reason });
    return [];
  });
  after(() => sendStatusEmails(emails));

  revalidatePath("/", "layout");
  return { status: "success", to, snapshot };
}

export type SnapshotState =
  | { status: "idle" }
  | { status: "done"; snapshot: SnapshotResult }
  | { status: "error"; error: ReportStatusErrorKey };

/** Stores the snapshot of a final report again, after a failed attempt. Owners and admins. */
export async function retryFinalSnapshot(_prev: SnapshotState, formData: FormData): Promise<SnapshotState> {
  const reportId = uuidSchema.safeParse(formData.get("reportId"));
  if (!reportId.success) return { status: "error", error: "invalidInput" };

  const report = await loadReport(reportId.data);
  if (!report) return { status: "error", error: "notFound" };
  const access = await requireWorkspaceRole(report.workspace_id, MANAGER_ROLES);
  if (!access) return { status: "error", error: "forbidden" };

  // The change that made the report final, if it still is.
  const supabase = await createClient();
  const [{ data: current }, { data: event }] = await Promise.all([
    supabase.from("reports").select("status").eq("id", report.id).maybeSingle(),
    supabase
      .from("report_status_events")
      .select("id, to_status")
      .eq("report_id", report.id)
      .order("changed_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  if (current?.status !== "final" || event?.to_status !== "final") return { status: "error", error: "stale" };

  const snapshot = await createFinalSnapshot({ supabase, report, eventId: event.id, userId: access.userId });
  revalidatePath("/", "layout");
  return { status: "done", snapshot };
}
