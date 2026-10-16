import "server-only";
import { z } from "zod";
import { completionPercent } from "@/lib/progress";
import { reportStatusSchema, type ReportStatus } from "@/lib/reports/status";
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

const profileSchema = z.object({ full_name: z.string().nullable(), email: z.string() });

/** Full name of a profile, or its e-mail address when the name is empty. */
function displayName(profile: z.infer<typeof profileSchema>): string {
  return profile.full_name?.trim() || profile.email;
}

const sectionRowSchema = z.object({
  id: z.string(),
  title: z.string(),
  status: sectionStatusSchema,
  updated_at: z.string(),
  report: embedded(z.object({ title: z.string() })),
  parent: embedded(z.object({ title: z.string() })),
  assignee: embedded(profileSchema),
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
  /** The section a subsection belongs to (KRB-195), null for a section. */
  parentTitle: string | null;
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
      "id, title, status, updated_at, report:reports(title), parent:parent_id(title), assignee:profiles!report_sections_assigned_to_fkey(full_name, email)",
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
      parentTitle: row.parent?.title ?? null,
      assignee: row.assignee ? { name: displayName(row.assignee), email: row.assignee.email } : null,
    })),
  };
}

export type StatusCounts = Record<SectionStatus, number>;

/** Sections of one report assigned to one expert, or left unassigned. */
export type AssigneeProgress = {
  /** Profile id, or null for the sections nobody is assigned to. */
  userId: string | null;
  /** Full name, else e-mail. Null when unassigned, or when RLS hides the profile. */
  name: string | null;
  counts: StatusCounts;
  total: number;
  /** Weighted like report_progress, 0 to 100 with one decimal. */
  completionPercent: number;
};

export type WorkspaceReport = {
  id: string;
  title: string;
  /** Brouillon, En revue or Final (KRB-20). */
  status: ReportStatus;
  totalSections: number;
  counts: StatusCounts;
  /** report_progress.completion_percent, 0 to 100 with one decimal. */
  completionPercent: number;
  /** Experts by name, then members whose profile is hidden, then unassigned sections. */
  assignees: AssigneeProgress[];
};

const reportRowSchema = z.object({ id: z.string(), title: z.string(), status: reportStatusSchema });

const reportProgressRowSchema = z.object({
  report_id: z.string(),
  total_sections: z.coerce.number(),
  not_started_sections: z.coerce.number(),
  in_progress_sections: z.coerce.number(),
  completed_sections: z.coerce.number(),
  completion_percent: z.coerce.number(),
});

const assignedSectionRowSchema = z.object({
  report_id: z.string(),
  status: sectionStatusSchema,
  weight: z.coerce.number(),
  assigned_to: z.string().nullable(),
  assignee: embedded(profileSchema),
});

type AssignedSectionRow = z.infer<typeof assignedSectionRowSchema>;

const nameCollator = new Intl.Collator("fr", { sensitivity: "base" });

// Named experts first, then members whose profile RLS hides, then the
// unassigned sections.
function assigneeRank(row: AssigneeProgress): number {
  if (row.userId === null) return 2;
  return row.name === null ? 1 : 0;
}

function compareAssignees(a: AssigneeProgress, b: AssigneeProgress): number {
  return (
    assigneeRank(a) - assigneeRank(b) ||
    nameCollator.compare(a.name ?? "", b.name ?? "") ||
    (a.userId ?? "").localeCompare(b.userId ?? "")
  );
}

function countByStatus(sections: readonly { status: SectionStatus }[]): StatusCounts {
  const counts: StatusCounts = { not_started: 0, in_progress: 0, completed: 0 };
  for (const section of sections) counts[section.status] += 1;
  return counts;
}

function assigneeBreakdown(sections: readonly AssignedSectionRow[]): AssigneeProgress[] {
  const groups = new Map<string | null, { name: string | null; sections: AssignedSectionRow[] }>();
  for (const section of sections) {
    const group = groups.get(section.assigned_to) ?? { name: null, sections: [] };
    group.name ??= section.assignee ? displayName(section.assignee) : null;
    group.sections.push(section);
    groups.set(section.assigned_to, group);
  }

  return Array.from(groups, ([userId, group]) => ({
    userId,
    name: userId === null ? null : group.name,
    counts: countByStatus(group.sections),
    total: group.sections.length,
    completionPercent: completionPercent(group.sections),
  })).sort(compareAssignees);
}

/**
 * Builds the report cards from the rows of getWorkspaceReports. The report
 * percent and counts come from report_progress; only the breakdown by expert
 * is computed here. Keeps the order of `reports`. Returns null when a row does
 * not have the expected shape.
 */
export function buildWorkspaceReports(rows: {
  reports: unknown;
  progress: unknown;
  sections: unknown;
}): WorkspaceReport[] | null {
  const reports = z.array(reportRowSchema).safeParse(rows.reports);
  const progress = z.array(reportProgressRowSchema).safeParse(rows.progress);
  const sections = z.array(assignedSectionRowSchema).safeParse(rows.sections);
  if (!reports.success || !progress.success || !sections.success) return null;

  const progressByReport = new Map(progress.data.map((row) => [row.report_id, row]));
  const sectionsByReport = new Map<string, AssignedSectionRow[]>();
  for (const section of sections.data) {
    const list = sectionsByReport.get(section.report_id) ?? [];
    list.push(section);
    sectionsByReport.set(section.report_id, list);
  }

  return reports.data.map((report) => {
    const row = progressByReport.get(report.id);
    return {
      id: report.id,
      title: report.title,
      status: report.status,
      totalSections: row?.total_sections ?? 0,
      counts: {
        not_started: row?.not_started_sections ?? 0,
        in_progress: row?.in_progress_sections ?? 0,
        completed: row?.completed_sections ?? 0,
      },
      completionPercent: row?.completion_percent ?? 0,
      assignees: assigneeBreakdown(sectionsByReport.get(report.id) ?? []),
    };
  });
}

/**
 * Reports of a workspace, oldest first, with their status, their weighted
 * completion, the count of sections in each status and the breakdown by
 * expert. Uses the signed-in user's client, so RLS applies. Returns null when
 * a query fails.
 */
export async function getWorkspaceReports(workspaceId: string): Promise<WorkspaceReport[] | null> {
  const supabase = await createClient();
  const [reports, progress, sections] = await Promise.all([
    supabase
      .from("reports")
      .select("id, title, status")
      .eq("workspace_id", workspaceId)
      .order("created_at", { ascending: true }),
    supabase
      .from("report_progress")
      .select(
        "report_id, total_sections, not_started_sections, in_progress_sections, completed_sections, completion_percent",
      )
      .eq("workspace_id", workspaceId),
    // PostgREST returns at most max_rows (1000) rows. Past that many sections
    // in one workspace the breakdown misses some; the view figures stay right.
    supabase
      .from("report_sections")
      .select(
        "report_id, status, weight, assigned_to, assignee:profiles!report_sections_assigned_to_fkey(full_name, email)",
      )
      .eq("workspace_id", workspaceId),
  ]);
  if (reports.error || progress.error || sections.error) return null;

  return buildWorkspaceReports({ reports: reports.data, progress: progress.data, sections: sections.data });
}
