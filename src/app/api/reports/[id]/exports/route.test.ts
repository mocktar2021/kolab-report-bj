// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildExport } from "@/lib/export";
import { loadExportDocument, storeExportFile } from "@/lib/reports/export-file";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { requireWorkspaceRole } from "@/lib/workspaces/server";
import { POST } from "./route";

// The annexes option of the export route (KRB-215). The rest of the route
// runs end to end in tests/e2e/master-report.spec.ts.

vi.mock("@/lib/log", () => ({
  log: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
  withRequestId: (handler: (...args: unknown[]) => Promise<Response>) => handler,
}));
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/admin", () => ({ createAdminClient: vi.fn() }));
vi.mock("@/lib/workspaces/server", () => ({ requireWorkspaceRole: vi.fn() }));
vi.mock("@/lib/reports/export-file", () => ({
  loadExportDocument: vi.fn(),
  markExportFailed: vi.fn(),
  storeExportFile: vi.fn(),
}));
vi.mock("@/lib/export", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/lib/export")>()),
  buildExport: vi.fn(),
}));

const REPORT = { id: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a", title: "Audit du siège", workspace_id: "w1" };
const EXPORT_ID = "9e8d7c6b-5a49-4382-9716-a5b4c3d2e1f0";
const DOC = { title: REPORT.title, workspaceName: "Cabinet", generatedAt: new Date(), sections: [] };

const userClient = {
  from: vi.fn(() => {
    const query = { select: () => query, eq: () => query, maybeSingle: async () => ({ data: REPORT }) };
    return query;
  }),
};
const rpc = vi.fn(() => ({
  maybeSingle: async () => ({ data: { export_id: EXPORT_ID, refusal: null }, error: null }),
}));

function post(body: unknown) {
  return POST(
    new Request(`http://localhost:3000/api/reports/${REPORT.id}/exports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    }),
    { params: Promise.resolve({ id: REPORT.id }) },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(createClient).mockResolvedValue(
    userClient as unknown as Awaited<ReturnType<typeof createClient>>,
  );
  vi.mocked(createAdminClient).mockReturnValue({ rpc } as unknown as ReturnType<typeof createAdminClient>);
  vi.mocked(requireWorkspaceRole).mockResolvedValue({ userId: "u1", role: "owner" });
  vi.mocked(loadExportDocument).mockResolvedValue(DOC);
  vi.mocked(buildExport).mockResolvedValue(Buffer.from("%PDF-1.3"));
  vi.mocked(storeExportFile).mockResolvedValue(true);
});

describe("POST /api/reports/[id]/exports with annexes (KRB-215)", () => {
  it("adds the annexes when the request leaves the option out, like the ticked box", async () => {
    const response = await post({ format: "pdf" });

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith(
      "claim_report_export",
      expect.objectContaining({ p_report_id: REPORT.id, p_format: "pdf", p_with_annexes: true }),
    );
    // The files are read with the user's client (RLS), never the service role.
    expect(loadExportDocument).toHaveBeenCalledWith(userClient, REPORT, expect.any(Date), {
      withAnnexes: true,
    });
    expect((await response.json()).fileName).toMatch(/^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.pdf$/);
  });

  it("records and builds the export without them when the box is unticked", async () => {
    const response = await post({ format: "docx", withAnnexes: false });

    expect(response.status).toBe(201);
    expect(rpc).toHaveBeenCalledWith(
      "claim_report_export",
      expect.objectContaining({ p_format: "docx", p_with_annexes: false }),
    );
    expect(loadExportDocument).toHaveBeenCalledWith(userClient, REPORT, expect.any(Date), {
      withAnnexes: false,
    });
    // Same file name either way.
    expect((await response.json()).fileName).toMatch(/^[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.docx$/);
  });

  it("refuses an option that is not true or false, before claiming anything", async () => {
    const response = await post({ format: "pdf", withAnnexes: "oui" });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalidInput" });
    expect(rpc).not.toHaveBeenCalled();
  });
});
