// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import {
  getOrganizationDeletionPreview,
  getReportDeletionPreview,
  getWorkspaceDeletionPreview,
} from "./preview";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const REPORT_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const WORKSPACE_ID = "1c7cab58-1d5f-4b6a-8b54-7f1b3e2d4f22";
const ORGANIZATION_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";

const rpc = vi.fn();

function answer(data: unknown, error: { message: string } | null = null) {
  rpc.mockResolvedValue({ data, error });
}

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(createClient).mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createClient>>);
});

describe("getReportDeletionPreview", () => {
  it("maps what the report holds", async () => {
    answer({
      report_id: REPORT_ID,
      workspace_id: WORKSPACE_ID,
      title: "Audit du siège",
      status: "final",
      sections: 4,
      files: 7,
      exports: 2,
    });
    expect(await getReportDeletionPreview(REPORT_ID.toUpperCase())).toEqual({
      reportId: REPORT_ID,
      workspaceId: WORKSPACE_ID,
      title: "Audit du siège",
      status: "final",
      sections: 4,
      files: 7,
      exports: 2,
    });
    expect(rpc).toHaveBeenCalledWith("report_deletion_preview", { p_report_id: REPORT_ID });
  });

  it("answers null to people who may not delete it, on errors and on bad ids", async () => {
    answer(null);
    expect(await getReportDeletionPreview(REPORT_ID)).toBeNull();
    answer(null, { message: "boom" });
    expect(await getReportDeletionPreview(REPORT_ID)).toBeNull();
    answer({ report_id: REPORT_ID });
    expect(await getReportDeletionPreview(REPORT_ID)).toBeNull();
    rpc.mockClear();
    expect(await getReportDeletionPreview("not-an-id")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("getWorkspaceDeletionPreview", () => {
  it("maps the counts and the passes the workspace loses", async () => {
    answer({
      workspace_id: WORKSPACE_ID,
      name: "Mission Cotonou",
      organization_id: ORGANIZATION_ID,
      organization_name: "Cabinet Koffi",
      billing_mode: "mission",
      passes: [
        {
          entitlement_id: "e1",
          workspace_id: WORKSPACE_ID,
          starts_at: "2026-10-01T00:00:00+00:00",
          ends_at: "2026-12-30T00:00:00+00:00",
        },
      ],
      reports: 1,
      final_reports: 0,
      sections: 3,
      files: 2,
      exports: 1,
      members: 4,
      invitations: 1,
      templates: 0,
    });
    const preview = await getWorkspaceDeletionPreview(WORKSPACE_ID);
    expect(rpc).toHaveBeenCalledWith("workspace_deletion_preview", { p_workspace_id: WORKSPACE_ID });
    expect(preview).toMatchObject({
      workspaceId: WORKSPACE_ID,
      name: "Mission Cotonou",
      organizationName: "Cabinet Koffi",
      billingMode: "mission",
      finalReports: 0,
      members: 4,
      passes: [{ entitlementId: "e1", workspaceId: WORKSPACE_ID, endsAt: "2026-12-30T00:00:00+00:00" }],
    });
  });
});

describe("getOrganizationDeletionPreview", () => {
  it("maps every workspace and the billing time left", async () => {
    answer({
      organization_id: ORGANIZATION_ID,
      name: "Cabinet Koffi",
      workspaces: [
        {
          workspace_id: WORKSPACE_ID,
          name: "Audit Koffi",
          billing_mode: "subscription",
          reports: 2,
          members: 3,
        },
      ],
      billing: {
        subscription: [
          {
            entitlement_id: "e2",
            plan: "cabinet",
            source: "purchase",
            starts_at: "2026-10-01T00:00:00+00:00",
            ends_at: "2026-11-01T00:00:00+00:00",
          },
        ],
        passes: [],
        packs: [{ pack_id: "k1", drafts_left: 70, expires_at: "2027-10-01T00:00:00+00:00" }],
      },
      reports: 2,
      files: 5,
      members: 3,
    });
    const preview = await getOrganizationDeletionPreview(ORGANIZATION_ID);
    expect(rpc).toHaveBeenCalledWith("organization_deletion_preview", { p_organization_id: ORGANIZATION_ID });
    expect(preview).toEqual({
      organizationId: ORGANIZATION_ID,
      name: "Cabinet Koffi",
      workspaces: [
        { id: WORKSPACE_ID, name: "Audit Koffi", billingMode: "subscription", reports: 2, members: 3 },
      ],
      billing: {
        subscription: [
          {
            entitlementId: "e2",
            plan: "cabinet",
            startsAt: "2026-10-01T00:00:00+00:00",
            endsAt: "2026-11-01T00:00:00+00:00",
          },
        ],
        passes: [],
        packs: [{ packId: "k1", draftsLeft: 70, expiresAt: "2027-10-01T00:00:00+00:00" }],
      },
      reports: 2,
      files: 5,
      members: 3,
    });
  });

  it("answers null to anyone but the owner", async () => {
    answer(null);
    expect(await getOrganizationDeletionPreview(ORGANIZATION_ID)).toBeNull();
  });
});
