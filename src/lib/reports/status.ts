import { z } from "zod";
import type { WorkspaceRole } from "@/lib/workspaces/roles";

// Mirrors the public.report_status enum in supabase/migrations.
export const REPORT_STATUSES = ["draft", "in_review", "final"] as const;

export const reportStatusSchema = z.enum(REPORT_STATUSES);

export type ReportStatus = z.infer<typeof reportStatusSchema>;

export const REPORT_ACTIONS = ["submit", "sendBack", "finalize", "reopen"] as const;

export const reportActionSchema = z.enum(REPORT_ACTIONS);

export type ReportAction = z.infer<typeof reportActionSchema>;

type Transition = { from: ReportStatus; to: ReportStatus; roles: readonly WorkspaceRole[] };

/**
 * Same transitions and roles as private.report_status_transitions, which
 * transition_report_status checks. The pgTAP test report_workflow_test.sql
 * pins that table, and status.test.ts pins this one: change both together.
 */
export const REPORT_TRANSITIONS: Record<ReportAction, Transition> = {
  submit: { from: "draft", to: "in_review", roles: ["owner", "admin"] },
  sendBack: { from: "in_review", to: "draft", roles: ["owner", "admin"] },
  finalize: { from: "in_review", to: "final", roles: ["owner"] },
  reopen: { from: "final", to: "draft", roles: ["owner"] },
};

/** What `role` can do to a report in `status`, in the order the page shows them. */
export function allowedReportActions(status: ReportStatus, role: WorkspaceRole): ReportAction[] {
  return REPORT_ACTIONS.filter((action) => {
    const transition = REPORT_TRANSITIONS[action];
    return transition.from === status && transition.roles.includes(role);
  });
}

/** A final report is frozen: nobody writes its sections or files until an owner reopens it. */
export function isReportFrozen(status: ReportStatus): boolean {
  return status === "final";
}
