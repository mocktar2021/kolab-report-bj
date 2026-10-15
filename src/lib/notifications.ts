import "server-only";
import { PLAN_CODES, type PlanCode } from "@/lib/billing/catalog";
import { BILLING_NOTICE_KINDS, type BillingNoticeKind } from "@/lib/billing/notice-kinds";
import { reportStatusSchema, type ReportStatus } from "@/lib/reports/status";
import { createClient } from "@/lib/supabase/server";

// In-app notifications. transition_report_status writes the status changes
// of reports (KRB-20), billing_due_notices the renewal reminders (KRB-178).
// RLS shows people their own: a status change while they belong to the
// workspace, a reminder while they can still renew.

type NotificationBase = { id: string; createdAt: string; read: boolean };

export type ReportStatusNotification = NotificationBase & {
  kind: "report_status";
  workspaceId: string;
  reportId: string;
  reportTitle: string;
  from: ReportStatus;
  to: ReportStatus;
  /** Null when the person left the workspace or deleted their account. */
  actorName: string | null;
};

export type BillingNotification = NotificationBase & {
  kind: "billing";
  notice: BillingNoticeKind;
  organizationId: string;
  /** Null when the organization is no longer readable. */
  organizationName: string | null;
  /** Set for a Pass Mission. */
  workspaceId: string | null;
  /** Null for the subscription, or when the person is not a member of the pass's workspace. */
  workspaceName: string | null;
  plan: PlanCode | null;
  endsAt: string | null;
  graceEndsAt: string | null;
};

export type NotificationItem = ReportStatusNotification | BillingNotification;

const DAY_MS = 24 * 60 * 60 * 1000;

function isNoticeKind(value: string | null): value is BillingNoticeKind {
  return (BILLING_NOTICE_KINDS as readonly (string | null)[]).includes(value);
}

function isPlan(value: string | undefined): value is PlanCode {
  return (PLAN_CODES as readonly (string | undefined)[]).includes(value);
}

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
      `id, created_at, read_at, kind, workspace_id, organization_id, billing_notice,
       event:report_status_events(
         from_status, to_status,
         report:reports(id, title),
         actor:profiles!report_status_events_changed_by_fkey(full_name, email)
       ),
       entitlement:billing_entitlements(plan, ends_at, grace_days),
       organization:organizations(name),
       workspace:workspaces(name)`,
    )
    .order("created_at", { ascending: false })
    .limit(Math.min(Math.max(limit, 1), 100));
  if (error || !data) return null;

  return data.flatMap((row): NotificationItem[] => {
    const base = { id: row.id, createdAt: row.created_at, read: row.read_at !== null };
    if (row.kind === "billing") {
      if (!row.organization_id || !isNoticeKind(row.billing_notice)) return [];
      const entitlement = row.entitlement;
      return [
        {
          ...base,
          kind: "billing",
          notice: row.billing_notice,
          organizationId: row.organization_id,
          organizationName: row.organization?.name ?? null,
          workspaceId: row.workspace_id,
          workspaceName: row.workspace?.name ?? null,
          plan: isPlan(entitlement?.plan) ? entitlement.plan : null,
          endsAt: entitlement?.ends_at ?? null,
          graceEndsAt: entitlement
            ? new Date(
                new Date(entitlement.ends_at).getTime() + entitlement.grace_days * DAY_MS,
              ).toISOString()
            : null,
        },
      ];
    }
    const event = row.event;
    if (!row.workspace_id || !event?.report) return [];
    return [
      {
        ...base,
        kind: "report_status",
        workspaceId: row.workspace_id,
        reportId: event.report.id,
        reportTitle: event.report.title,
        from: reportStatusSchema.parse(event.from_status),
        to: reportStatusSchema.parse(event.to_status),
        actorName: event.actor?.full_name?.trim() || event.actor?.email || null,
      },
    ];
  });
}
