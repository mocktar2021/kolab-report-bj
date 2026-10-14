// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { buildWorkspaceReports, getWorkspaceReports } from "./dashboard";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const WORKSPACE_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const AUDIT = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";
const EMPTY = "4d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a";
const FATOU = "aaaaaaaa-1111-4111-8111-111111111111";
const ELI = "bbbbbbbb-2222-4222-8222-222222222222";
const GONE = "cccccccc-3333-4333-8333-333333333333";

const REPORTS = [
  { id: AUDIT, title: "Audit énergétique du siège" },
  { id: EMPTY, title: "Rapport vide" },
];

// What report_progress returns for the sections below. The report percent
// must come from here even when the sections would give another value.
const PROGRESS = [
  {
    report_id: AUDIT,
    total_sections: 6,
    not_started_sections: 2,
    in_progress_sections: 2,
    completed_sections: 2,
    completion_percent: 62.5,
  },
  {
    report_id: EMPTY,
    total_sections: 0,
    not_started_sections: 0,
    in_progress_sections: 0,
    completed_sections: 0,
    completion_percent: 0,
  },
];

function section(
  status: "not_started" | "in_progress" | "completed",
  assignedTo: string | null,
  assignee:
    | { full_name: string | null; email: string }
    | { full_name: string | null; email: string }[]
    | null,
  weight = 1,
) {
  return { report_id: AUDIT, status, weight, assigned_to: assignedTo, assignee };
}

const fatou = { full_name: "  Fatou Dossou ", email: "fatou@kolabreport.test" };
const eli = { full_name: null, email: "eli@kolabreport.test" };

const SECTIONS = [
  section("not_started", null, null),
  section("completed", FATOU, fatou, 2),
  section("in_progress", ELI, [eli]),
  section("not_started", FATOU, fatou),
  section("completed", GONE, null),
  section("in_progress", null, null),
];

describe("buildWorkspaceReports", () => {
  it("keeps the view figures and adds the breakdown by expert", () => {
    const reports = buildWorkspaceReports({ reports: REPORTS, progress: PROGRESS, sections: SECTIONS });

    expect(reports).toEqual([
      {
        id: AUDIT,
        title: "Audit énergétique du siège",
        totalSections: 6,
        counts: { not_started: 2, in_progress: 2, completed: 2 },
        completionPercent: 62.5,
        assignees: [
          // Named experts by name (Eli has no full name, so the e-mail), then
          // the member RLS hides, then the unassigned sections.
          {
            userId: ELI,
            name: "eli@kolabreport.test",
            counts: { not_started: 0, in_progress: 1, completed: 0 },
            total: 1,
            completionPercent: 50,
          },
          {
            userId: FATOU,
            name: "Fatou Dossou",
            counts: { not_started: 1, in_progress: 0, completed: 1 },
            total: 2,
            // Weight 2 completed, weight 1 not started.
            completionPercent: 66.7,
          },
          {
            userId: GONE,
            name: null,
            counts: { not_started: 0, in_progress: 0, completed: 1 },
            total: 1,
            completionPercent: 100,
          },
          {
            userId: null,
            name: null,
            counts: { not_started: 1, in_progress: 1, completed: 0 },
            total: 2,
            completionPercent: 25,
          },
        ],
      },
      {
        id: EMPTY,
        title: "Rapport vide",
        totalSections: 0,
        counts: { not_started: 0, in_progress: 0, completed: 0 },
        completionPercent: 0,
        assignees: [],
      },
    ]);
  });

  it("sorts names the French way, accents included", () => {
    const reports = buildWorkspaceReports({
      reports: [REPORTS[0]],
      progress: [PROGRESS[0]],
      sections: [
        section("completed", null, null),
        section("completed", "u-zoe", { full_name: "Zoé Hounsou", email: "zoe@kolabreport.test" }),
        section("completed", "u-elodie", { full_name: "Élodie Agossa", email: "elodie@kolabreport.test" }),
        section("completed", "u-awa", { full_name: "awa Kpadé", email: "awa@kolabreport.test" }),
      ],
    });

    expect(reports?.[0]?.assignees.map((row) => row.name ?? "unassigned")).toEqual([
      "awa Kpadé",
      "Élodie Agossa",
      "Zoé Hounsou",
      "unassigned",
    ]);
  });

  it("gives a report missing from the view zero figures", () => {
    const reports = buildWorkspaceReports({ reports: [REPORTS[1]], progress: [], sections: [] });

    expect(reports).toEqual([
      {
        id: EMPTY,
        title: "Rapport vide",
        totalSections: 0,
        counts: { not_started: 0, in_progress: 0, completed: 0 },
        completionPercent: 0,
        assignees: [],
      },
    ]);
  });

  it("reads numbers sent as strings", () => {
    const reports = buildWorkspaceReports({
      reports: [REPORTS[0]],
      progress: [{ ...PROGRESS[0], total_sections: "1", completion_percent: "37.5" }],
      sections: [{ ...section("in_progress", FATOU, fatou), weight: "1.50" }],
    });

    expect(reports?.[0]?.totalSections).toBe(1);
    expect(reports?.[0]?.completionPercent).toBe(37.5);
    expect(reports?.[0]?.assignees[0]?.completionPercent).toBe(50);
  });

  it("returns null when a row has an unexpected shape", () => {
    expect(
      buildWorkspaceReports({
        reports: REPORTS,
        progress: PROGRESS,
        sections: [{ ...SECTIONS[0], status: "archived" }],
      }),
    ).toBeNull();
    expect(buildWorkspaceReports({ reports: null, progress: PROGRESS, sections: SECTIONS })).toBeNull();
  });
});

type Result = { data: unknown; error: unknown };
type Call = { table: string; columns: string; filters: [string, unknown][] };

/** A fake Supabase client: records each query and answers with the result set for its table. */
function fakeClient(results: Record<string, Result>) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const call: Call = { table, columns: "", filters: [] };
      calls.push(call);
      const query = {
        select(columns: string) {
          call.columns = columns;
          return query;
        },
        eq(column: string, value: unknown) {
          call.filters.push([column, value]);
          return query;
        },
        order() {
          return query;
        },
        then<T>(resolve: (value: Result) => T, reject?: (reason: unknown) => T) {
          return Promise.resolve(results[table] ?? { data: null, error: new Error(table) }).then(
            resolve,
            reject,
          );
        },
      };
      return query;
    },
  };
  vi.mocked(createClient).mockResolvedValue(client as unknown as Awaited<ReturnType<typeof createClient>>);
  return calls;
}

const OK: Record<string, Result> = {
  reports: { data: REPORTS, error: null },
  report_progress: { data: PROGRESS, error: null },
  report_sections: { data: SECTIONS, error: null },
};

describe("getWorkspaceReports", () => {
  beforeEach(() => {
    vi.mocked(createClient).mockReset();
  });

  it("scopes every query to the workspace", async () => {
    const calls = fakeClient(OK);

    const reports = await getWorkspaceReports(WORKSPACE_ID);

    expect(reports?.map((report) => report.id)).toEqual([AUDIT, EMPTY]);
    expect(calls.map((call) => call.table).sort()).toEqual(["report_progress", "report_sections", "reports"]);
    for (const call of calls) {
      expect(call.filters).toContainEqual(["workspace_id", WORKSPACE_ID]);
    }
    expect(calls.find((call) => call.table === "report_sections")?.columns).toContain(
      "assignee:profiles!report_sections_assigned_to_fkey(full_name, email)",
    );
  });

  it.each(["reports", "report_progress", "report_sections"])("returns null when %s fails", async (table) => {
    fakeClient({ ...OK, [table]: { data: null, error: { message: "boom" } } });

    expect(await getWorkspaceReports(WORKSPACE_ID)).toBeNull();
  });
});
