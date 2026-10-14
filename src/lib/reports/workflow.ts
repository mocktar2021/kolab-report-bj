import "server-only";
import { reportStatusEmail } from "@/lib/email/report-status-email";
import { sendEmail, type Email } from "@/lib/email/send";
import { publicEnv } from "@/lib/env";
import { createClient } from "@/lib/supabase/server";
import { exportDownloadPath } from "./exports";
import { reportStatusSchema, type ReportAction, type ReportStatus } from "./status";

// Review and finalization of a report (KRB-20): what the report page shows
// about the status, and the e-mails sent after a change.

export type ReportStatusChange = {
  id: string;
  from: ReportStatus;
  to: ReportStatus;
  at: string;
  /** Null when the person left the workspace or deleted their account. */
  byName: string | null;
};

export type FinalSnapshot =
  | { state: "ready"; url: string; fileName: string }
  | { state: "pending" }
  | { state: "missing" };

export type ReportWorkflow = {
  lastChange: ReportStatusChange | null;
  /** For owners and admins of a final report: its snapshot. Null otherwise. */
  snapshot: FinalSnapshot | null;
};

/** A snapshot pending for longer died with its request (see snapshot.ts). */
const STALE_SNAPSHOT_MS = 2 * 60 * 1000;

/** The last status change of a report and, for managers of a final report, its snapshot. RLS applies. */
export async function getReportWorkflow(
  report: { id: string; status: ReportStatus },
  manager: boolean,
): Promise<ReportWorkflow> {
  const supabase = await createClient();
  const { data: event } = await supabase
    .from("report_status_events")
    .select(
      "id, from_status, to_status, changed_at, actor:profiles!report_status_events_changed_by_fkey(full_name, email)",
    )
    .eq("report_id", report.id)
    .order("changed_at", { ascending: false })
    .limit(1)
    .maybeSingle();

  const lastChange: ReportStatusChange | null = event
    ? {
        id: event.id,
        from: reportStatusSchema.parse(event.from_status),
        to: reportStatusSchema.parse(event.to_status),
        at: event.changed_at,
        byName: event.actor?.full_name?.trim() || event.actor?.email || null,
      }
    : null;

  if (!manager || report.status !== "final") return { lastChange, snapshot: null };
  // A report made final before KRB-20 has no change on record, so no snapshot either.
  if (!lastChange || lastChange.to !== "final") return { lastChange, snapshot: { state: "missing" } };

  const { data: exports } = await supabase
    .from("report_exports")
    .select("id, status, file_name, created_at")
    .eq("status_event_id", lastChange.id)
    .eq("kind", "final")
    .neq("status", "failed")
    .order("created_at", { ascending: false })
    .limit(1);
  const latest = exports?.[0];
  if (latest?.status === "ready") {
    return {
      lastChange,
      snapshot: { state: "ready", url: exportDownloadPath(latest.id), fileName: latest.file_name },
    };
  }
  const fresh = latest && Date.now() - new Date(latest.created_at).getTime() < STALE_SNAPSHOT_MS;
  return { lastChange, snapshot: { state: fresh ? "pending" : "missing" } };
}

/**
 * The e-mails for the people transition_report_status notified. Their
 * addresses come from profiles, which members read for one another (RLS).
 * Read during the request; sendStatusEmails sends them after the response.
 */
export async function statusChangeEmails(input: {
  action: ReportAction;
  report: { id: string; title: string; workspace_id: string };
  actorName: string;
  recipients: string[];
}): Promise<Email[]> {
  if (input.recipients.length === 0) return [];
  const supabase = await createClient();
  const [{ data: people }, { data: workspace }] = await Promise.all([
    supabase.from("profiles").select("id, email").in("id", input.recipients),
    supabase.from("workspaces").select("name").eq("id", input.report.workspace_id).maybeSingle(),
  ]);
  const link = `${publicEnv.NEXT_PUBLIC_APP_URL}/fr/rapports/${input.report.id}`;
  return (people ?? [])
    .filter((person) => person.email)
    .map((person) =>
      reportStatusEmail({
        to: person.email,
        action: input.action,
        reportTitle: input.report.title,
        workspaceName: workspace?.name ?? "",
        actorName: input.actorName,
        link,
      }),
    );
}

/** Never throws: the in-app notifications are there even when an e-mail fails. */
export async function sendStatusEmails(emails: Email[]) {
  const results = await Promise.allSettled(emails.map((email) => sendEmail(email)));
  const failed = results.filter((result) => result.status === "rejected" || !result.value).length;
  if (failed > 0) console.warn(`report-status: ${failed} of ${emails.length} e-mail(s) not sent`);
}
