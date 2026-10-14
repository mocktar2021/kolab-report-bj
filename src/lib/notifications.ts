import "server-only";
import { reportStatusSchema, type ReportStatus } from "@/lib/reports/status";
import { createClient } from "@/lib/supabase/server";

// In-app notifications (KRB-20). transition_report_status writes them; RLS
// shows people their own, in the workspaces they still belong to.

export type NotificationItem = {
  id: string;
  createdAt: string;
  read: boolean;
  workspaceId: string;
  reportId: string;
  reportTitle: string;
  from: ReportStatus;
  to: ReportStatus;
  /** Null when the person left the workspace or deleted their account. */
  actorName: string | null;
};

/** Notifications not read yet, for the badge in the header. */
export async function countUnreadNotifications(): Promise<number> {
  const supabase = await createClient();
  const { count } = await supabase
    .from("notifications")
    .select("id", { count: "exact", head: true })
    .is("read_at", null);
  return count ?? 0;
}

/** The latest notifications, newest first. */
export async function listNotifications(limit = 50): Promise<NotificationItem[] | null> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from("notifications")
    .select(
      `id, created_at, read_at, workspace_id,
       event:report_status_events!inner(
         from_status, to_status,
         report:reports!inner(id, title),
         actor:profiles!report_status_events_changed_by_fkey(full_name, email)
       )`,
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error || !data) return null;

  return data.map((row) => ({
    id: row.id,
    createdAt: row.created_at,
    read: row.read_at !== null,
    workspaceId: row.workspace_id,
    reportId: row.event.report.id,
    reportTitle: row.event.report.title,
    from: reportStatusSchema.parse(row.event.from_status),
    to: reportStatusSchema.parse(row.event.to_status),
    actorName: row.event.actor?.full_name?.trim() || row.event.actor?.email || null,
  }));
}
