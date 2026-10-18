// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { getWorkspaceMembers } from "@/lib/workspaces/members";
import { loadExportDocument } from "./export-file";

vi.mock("@/lib/log", () => ({ log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() } }));
vi.mock("@/lib/workspaces/members", () => ({ getWorkspaceMembers: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
// The images of the sections (KRB-216) have their own tests.
vi.mock("./export-images", () => ({ loadExportImages: vi.fn(async () => new Map()) }));

const REPORT = { id: "r1", title: "Audit du siège", workspace_id: "w1" };
const GENERATED_AT = new Date("2026-10-14T09:30:00Z");

const SECTIONS = [
  { id: "s2", parent_id: null, position: 1, created_at: "2026-10-01T00:00:00Z", title: "Diagnostic" },
  { id: "s1", parent_id: null, position: 0, created_at: "2026-10-01T00:00:00Z", title: "Contexte" },
  { id: "s1a", parent_id: "s1", position: 0, created_at: "2026-10-01T00:00:00Z", title: "Objectifs" },
].map((section) => ({ ...section, status: "in_progress", assigned_to: null, content: null }));

type Call = [method: string, ...args: unknown[]];
type Result = { data: unknown; error: { message: string } | null };

/**
 * A user client whose tables answer `answer(table, calls)`. Each query
 * records its calls; `queries` keeps them per table.
 */
function userClient(answer: (table: string, calls: Call[]) => Result) {
  const queries: { table: string; calls: Call[] }[] = [];
  const from = vi.fn((table: string) => {
    const calls: Call[] = [];
    queries.push({ table, calls });
    const query: Record<string, unknown> = {};
    for (const method of ["select", "eq", "not", "order", "range"]) {
      query[method] = (...args: unknown[]) => {
        calls.push([method, ...args]);
        return query;
      };
    }
    query.maybeSingle = () => Promise.resolve(answer(table, calls));
    query.then = (resolve: (value: Result) => unknown, reject: (reason: unknown) => unknown) =>
      Promise.resolve(answer(table, calls)).then(resolve, reject);
    return query;
  });
  return { client: { from } as unknown as Parameters<typeof loadExportDocument>[0], queries };
}

const file = (sectionId: string, name: string, by: string | null, at: string) => ({
  section_id: sectionId,
  file_name: name,
  uploaded_by: by,
  uploaded_at: at,
  report_sections: { report_id: "r1" },
});

/** Sections, the workspace name, and `deliverables` for the files, page by page. */
function report(deliverables: (from: number) => Result) {
  return userClient((table, calls) => {
    if (table === "report_sections") return { data: SECTIONS, error: null };
    if (table === "workspaces") return { data: { name: "Cabinet Dossou" }, error: null };
    if (table === "deliverables") {
      const range = calls.find(([method]) => method === "range");
      return deliverables(Number(range?.[1] ?? 0));
    }
    throw new Error(`unexpected table ${table}`);
  });
}

beforeEach(() => {
  vi.mocked(getWorkspaceMembers).mockResolvedValue([
    { userId: "u1", name: "Fatou Dossou" },
    { userId: "u2", name: "Koffi Agbo" },
  ] as Awaited<ReturnType<typeof getWorkspaceMembers>>);
});

describe("loadExportDocument with annexes (KRB-215)", () => {
  it("reads the uploaded files of the report with the user's client and gives each section its own", async () => {
    const { client, queries } = report(() => ({
      data: [
        file("s1a", "objectifs.docx", "u2", "2026-10-01T10:00:00+00:00"),
        file("s1", "plan.pdf", "u1", "2026-10-12T23:30:00+00:00"),
        file("s1", "ancien.pdf", "gone", "2026-10-13T08:00:00+00:00"),
        file("s1", "orphelin.pdf", null, "2026-10-13T09:00:00+00:00"),
      ],
      error: null,
    }));

    const doc = await loadExportDocument(client, REPORT, GENERATED_AT, { withAnnexes: true });

    expect(doc?.withAnnexes).toBe(true);
    expect(doc?.sections.map((section) => [section.title, section.deliverables])).toEqual([
      [
        "Contexte",
        [
          { fileName: "plan.pdf", addedBy: "Fatou Dossou", addedAt: new Date("2026-10-12T23:30:00Z") },
          // Someone who left the workspace, or whose account is deleted.
          { fileName: "ancien.pdf", addedBy: null, addedAt: new Date("2026-10-13T08:00:00Z") },
          { fileName: "orphelin.pdf", addedBy: null, addedAt: new Date("2026-10-13T09:00:00Z") },
        ],
      ],
      [
        "Objectifs",
        [{ fileName: "objectifs.docx", addedBy: "Koffi Agbo", addedAt: new Date("2026-10-01T10:00:00Z") }],
      ],
      ["Diagnostic", []],
    ]);

    // The files of this report only, uploads that finished, oldest first.
    const files = queries.find((query) => query.table === "deliverables")?.calls ?? [];
    expect(files).toContainEqual(["select", expect.stringContaining("report_sections!inner(report_id)")]);
    expect(files).toContainEqual(["eq", "report_sections.report_id", "r1"]);
    expect(files).toContainEqual(["not", "uploaded_at", "is", null]);
    expect(files.filter(([method]) => method === "order")).toEqual([
      ["order", "uploaded_at"],
      ["order", "id"],
    ]);
  });

  it("reads past the 1000 rows PostgREST returns per request", async () => {
    const page = (count: number, offset: number) =>
      Array.from({ length: count }, (_, index) =>
        file("s2", `releve-${offset + index}.csv`, "u1", "2026-10-12T10:00:00+00:00"),
      );
    const { client, queries } = report((from) => ({
      data: from === 0 ? page(1000, 0) : from === 1000 ? page(2, 1000) : [],
      error: null,
    }));

    const doc = await loadExportDocument(client, REPORT, GENERATED_AT, { withAnnexes: true });

    const diagnosis = doc?.sections.find((section) => section.title === "Diagnostic");
    expect(diagnosis?.deliverables).toHaveLength(1002);
    expect(diagnosis?.deliverables?.at(-1)?.fileName).toBe("releve-1001.csv");
    expect(
      queries
        .filter((query) => query.table === "deliverables")
        .map((query) => query.calls.find(([method]) => method === "range")),
    ).toEqual([
      ["range", 0, 999],
      ["range", 1000, 1999],
    ]);
  });

  it("does not read the files when the box is unticked", async () => {
    const { client, queries } = report(() => {
      throw new Error("the files should not be read");
    });

    const doc = await loadExportDocument(client, REPORT, GENERATED_AT, { withAnnexes: false });

    expect(doc?.withAnnexes).toBe(false);
    expect(doc?.sections.every((section) => section.deliverables?.length === 0)).toBe(true);
    expect(queries.map((query) => query.table)).not.toContain("deliverables");
  });

  it("gives up when the files cannot be read", async () => {
    const { client } = report(() => ({ data: null, error: { message: "boom" } }));
    expect(await loadExportDocument(client, REPORT, GENERATED_AT, { withAnnexes: true })).toBeNull();
  });
});
