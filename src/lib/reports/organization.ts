import { compareByName } from "@/lib/workspaces/group";
import type { MyWorkspace } from "@/lib/workspaces/types";
import type { ReportStatus } from "./status";

/** A report on the reports page of an organization (KRB-208). */
export type OrganizationReport = {
  id: string;
  title: string;
  status: ReportStatus;
  totalSections: number;
  completionPercent: number;
  createdAt: string;
};

/** One of the user's workspaces in the organization, with its reports. */
export type OrganizationWorkspaceReports = {
  workspace: MyWorkspace;
  reports: OrganizationReport[];
};

export type OrganizationReports = {
  workspaces: OrganizationWorkspaceReports[];
  total: number;
  /** Draft and in review: what the plan limits count. */
  active: number;
};

type ReportRow = {
  id: string;
  title: string;
  status: ReportStatus;
  workspace_id: string;
  created_at: string;
};

// report_progress is a view: Supabase types every column of it as nullable.
type ProgressRow = {
  report_id: string | null;
  total_sections: number | null;
  completion_percent: number | null;
};

/** Active reports first, then final ones, the newest first in each. */
function compareReports(a: OrganizationReport, b: OrganizationReport) {
  const finalA = a.status === "final" ? 1 : 0;
  const finalB = b.status === "final" ? 1 : 0;
  return finalA - finalB || b.createdAt.localeCompare(a.createdAt) || a.id.localeCompare(b.id);
}

/**
 * The reports of an organization, one block per workspace of the user in it,
 * workspaces sorted by name like the switcher. `workspaces` are the user's
 * workspaces in that organization; a report of any other workspace is left out.
 */
export function groupOrganizationReports({
  workspaces,
  reports,
  progress,
}: {
  workspaces: MyWorkspace[];
  reports: ReportRow[];
  progress: ProgressRow[];
}): OrganizationReports {
  const progressByReport = new Map(progress.map((row) => [row.report_id, row]));
  const byWorkspace = new Map<string, OrganizationReport[]>(
    workspaces.map((workspace) => [workspace.id, []]),
  );

  for (const report of reports) {
    const row = progressByReport.get(report.id);
    byWorkspace.get(report.workspace_id)?.push({
      id: report.id,
      title: report.title,
      status: report.status,
      totalSections: row?.total_sections ?? 0,
      completionPercent: row?.completion_percent ?? 0,
      createdAt: report.created_at,
    });
  }

  const blocks = [...workspaces].sort(compareByName).map((workspace) => ({
    workspace,
    reports: (byWorkspace.get(workspace.id) ?? []).sort(compareReports),
  }));
  const all = blocks.flatMap((block) => block.reports);

  return {
    workspaces: blocks,
    total: all.length,
    active: all.filter((report) => report.status !== "final").length,
  };
}
