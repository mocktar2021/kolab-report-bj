// @vitest-environment node
import { revalidatePath } from "next/cache";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { MANAGER_ROLES } from "@/lib/workspaces/roles";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { renameReport } from "./title-actions";

vi.mock("next/cache", () => ({ revalidatePath: vi.fn() }));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/workspaces/server", () => ({ requireWorkspaceRole: vi.fn() }));

const REPORT_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const WORKSPACE_ID = "1c7cab58-1d5f-4b6a-8b54-7f1b3e2d4f22";
const IDLE = { status: "idle" } as const;

// The report the page sees, and what the update answers.
let report: { id: string; workspace_id: string; status: string } | null;
let updated: { data: { id: string }[] | null; error: { code: string; message: string } | null };
const update = vi.fn();
const updateEq = vi.fn();

function fakeClient() {
  return {
    from: (table: string) => {
      if (table !== "reports") throw new Error(`Unexpected table ${table}`);
      return {
        select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: report, error: null }) }) }),
        update: (values: unknown) => {
          update(values);
          return {
            eq: (column: string, value: string) => {
              updateEq(column, value);
              return { select: async () => updated };
            },
          };
        },
      };
    },
  };
}

function form(fields: Record<string, string>) {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

beforeEach(() => {
  report = { id: REPORT_ID, workspace_id: WORKSPACE_ID, status: "draft" };
  updated = { data: [{ id: REPORT_ID }], error: null };
  update.mockReset();
  updateEq.mockReset();
  vi.mocked(revalidatePath).mockReset();
  vi.mocked(createClient)
    .mockReset()
    .mockResolvedValue(fakeClient() as never);
  vi.mocked(requireWorkspaceRole).mockReset().mockResolvedValue({ userId: "u1", role: "owner" });
});

describe("renameReport", () => {
  it.each([
    ["too short once trimmed", " a "],
    ["empty", ""],
    ["too long", "x".repeat(201)],
  ])("refuses a title %s before calling Supabase", async (_, title) => {
    expect(await renameReport(IDLE, form({ reportId: REPORT_ID, title }))).toEqual({
      status: "error",
      fieldErrors: { title: "titleLength" },
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("refuses a forged report id", async () => {
    expect(await renameReport(IDLE, form({ reportId: "not-an-id", title: "Bilan" }))).toEqual({
      status: "error",
      error: "invalidInput",
    });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("saves the trimmed title with the user's client and reloads the pages", async () => {
    expect(
      await renameReport(IDLE, form({ reportId: REPORT_ID, title: "  Bilan de mission 2026  " })),
    ).toEqual({ status: "success" });
    expect(requireWorkspaceRole).toHaveBeenCalledWith(WORKSPACE_ID, MANAGER_ROLES);
    expect(update).toHaveBeenCalledWith({ title: "Bilan de mission 2026" });
    expect(updateEq).toHaveBeenCalledWith("id", REPORT_ID);
    expect(revalidatePath).toHaveBeenCalledWith("/", "layout");
  });

  it("refuses experts and readers, and reports the user cannot see, before writing", async () => {
    vi.mocked(requireWorkspaceRole).mockResolvedValue(null);
    expect(await renameReport(IDLE, form({ reportId: REPORT_ID, title: "Bilan" }))).toEqual({
      status: "error",
      error: "forbidden",
    });
    report = null;
    expect(await renameReport(IDLE, form({ reportId: REPORT_ID, title: "Bilan" }))).toEqual({
      status: "error",
      error: "forbidden",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("refuses a final report before writing", async () => {
    report = { id: REPORT_ID, workspace_id: WORKSPACE_ID, status: "final" };
    expect(await renameReport(IDLE, form({ reportId: REPORT_ID, title: "Bilan" }))).toEqual({
      status: "error",
      error: "reportFinal",
    });
    expect(update).not.toHaveBeenCalled();
  });

  it("answers forbidden when RLS lets no row through", async () => {
    updated = { data: [], error: null };
    expect(await renameReport(IDLE, form({ reportId: REPORT_ID, title: "Bilan" }))).toEqual({
      status: "error",
      error: "forbidden",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });

  it("says the workspace is read-only when the billing trigger refuses (KR043)", async () => {
    updated = { data: null, error: { code: "KR043", message: "Cet espace de travail est en lecture seule" } };
    expect(await renameReport(IDLE, form({ reportId: REPORT_ID, title: "Bilan" }))).toEqual({
      status: "error",
      error: "billingReadOnly",
    });
    expect(revalidatePath).not.toHaveBeenCalled();
  });
});
