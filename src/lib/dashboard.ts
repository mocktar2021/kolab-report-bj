import "server-only";
import { z } from "zod";
import { SECTION_STATUSES, sectionStatusSchema, type SectionStatus } from "@/lib/sections";
import { createClient } from "@/lib/supabase/server";

// The table shows the most recently updated sections first. Pagination
// comes with the report pages; until then the page says when it truncates.
export const SECTION_LIMIT = 50;

// A many-to-one embed comes back as an object. Accept an array too and keep
// the first row, so the parsing does not depend on how PostgREST reads the
// relationship.
function embedded<T extends z.ZodTypeAny>(schema: T) {
  return z
    .union([schema, z.array(schema)])
    .nullable()
    .transform((value) => (Array.isArray(value) ? (value[0] ?? null) : value));
}

const sectionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: sectionStatusSchema,
  updated_at: z.string(),
  report: embedded(z.object({ title: z.string() })),
  assignee: embedded(z.object({ full_name: z.string().nullable(), email: z.string() })),
});

const progressRowSchema = z.object({
  total_sections: z.coerce.number(),
  completion_percent: z.coerce.number(),
});

export type DashboardSection = {
  id: string;
  title: string;
  status: SectionStatus;
  updatedAt: string;
  reportTitle: string | null;
  assignee: { name: string; email: string } | null;
};

export type DashboardData = {
  counts: Record<SectionStatus, number>;
  totalSections: number;
  /** Mean of report_progress.completion_percent over reports that have sections, 0 to 100. */
  completionPercent: number;
  reportsWithSections: number;
  sections: DashboardSection[];
  /** Number of sections matching the current filter, before SECTION_LIMIT. */
  matchingSections: number;
};

/**
 * Loads the dashboard of one workspace with the signed-in user's client, so
 * RLS still limits every query to the workspaces they belong to. Returns null
 * when a query fails.
 */
export async function getDashboardData(
  workspaceId: string,
  status: SectionStatus | null,
): Promise<DashboardData | null> {
  const supabase = await createClient();

  const countByStatus = (value: SectionStatus) =>
    supabase
      .from("report_sections")
      .select("id", { count: "exact", head: true })
      .eq("workspace_id", workspaceId)
      .eq("status", value);

  let sectionsQuery = supabase
    .from("report_sections")
    .select(
      "id, title, status, updated_at, report:reports(title), assignee:profiles!report_sections_assigned_to_fkey(full_name, email)",
      { count: "exact" },
    )
    .eq("workspace_id", workspaceId)
    .order("updated_at", { ascending: false })
    .limit(SECTION_LIMIT);
  if (status) {
    sectionsQuery = sectionsQuery.eq("status", status);
  }

  const [notStarted, inProgress, completed, progress, sections] = await Promise.all([
    countByStatus("not_started"),
    countByStatus("in_progress"),
    countByStatus("completed"),
    supabase
      .from("report_progress")
      .select("total_sections, completion_percent")
      .eq("workspace_id", workspaceId),
    sectionsQuery,
  ]);

  if (notStarted.error || inProgress.error || completed.error || progress.error || sections.error) {
    return null;
  }

  const parsedSections = z.array(sectionRowSchema).safeParse(sections.data);
  const parsedProgress = z.array(progressRowSchema).safeParse(progress.data);
  if (!parsedSections.success || !parsedProgress.success) {
    return null;
  }

  const counts = {
    not_started: notStarted.count ?? 0,
    in_progress: inProgress.count ?? 0,
    completed: completed.count ?? 0,
  } satisfies Record<SectionStatus, number>;

  // Average per report rather than per section: a 3-section report counts as
  // much as a 30-section one. Reports without sections are left out.
  const reports = parsedProgress.data.filter((row) => row.total_sections > 0);
  const completionPercent =
    reports.length > 0 ? reports.reduce((sum, row) => sum + row.completion_percent, 0) / reports.length : 0;

  return {
    counts,
    totalSections: SECTION_STATUSES.reduce((sum, value) => sum + counts[value], 0),
    completionPercent,
    reportsWithSections: reports.length,
    matchingSections: sections.count ?? parsedSections.data.length,
    sections: parsedSections.data.map((row) => ({
      id: row.id,
      title: row.title,
      status: row.status,
      updatedAt: row.updated_at,
      reportTitle: row.report?.title ?? null,
      assignee: row.assignee
        ? { name: row.assignee.full_name?.trim() || row.assignee.email, email: row.assignee.email }
        : null,
    })),
  };
}

export type WorkspaceReport = {
  id: string;
  title: string;
  totalSections: number;
  completionPercent: number;
};

/** Reports of a workspace with their weighted completion, oldest first. */
export async function getWorkspaceReports(workspaceId: string): Promise<WorkspaceReport[] | null> {
  const supabase = await createClient();
  const [reports, progress] = await Promise.all([
    supabase
      .from("reports")
      .select("id, title")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("report_progress")
      .select("report_id, total_sections, completion_percent")
      .eq("workspace_id", workspaceId),
  ]);
  if (reports.error || progress.error) return null;

  const byReport = new Map(progress.data.map((row) => [row.report_id, row]));
  return reports.data.map((report) => {
    const row = byReport.get(report.id);
    return {
      id: report.id,
      title: report.title,
      totalSections: Number(row?.total_sections ?? 0),
      completionPercent: Number(row?.completion_percent ?? 0),
    };
  });
}
