// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { getBillingOverview, getWorkspaceBillingState } from "./state";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const WORKSPACE_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const MISSION_ID = "1c7cab58-1d5f-4b6a-8b54-7f1b3e2d4f22";
const ORGANIZATION_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";
const PACK_ID = "4d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a";

const rpc = vi.fn();

// supabase.rpc() is awaited directly or through .maybeSingle().
function answer(data: unknown, error: { message: string } | null = null) {
  const result = { data, error };
  rpc.mockImplementation(() =>
    Object.assign(Promise.resolve(result), { maybeSingle: () => Promise.resolve(result) }),
  );
}

const TRIAL_ROW = {
  organization_id: ORGANIZATION_ID,
  billing_mode: "subscription",
  state: "trialing",
  plan: "trial",
  source: "trial",
  ends_at: "2026-10-28T10:00:00+00:00",
  grace_ends_at: "2026-11-04T10:00:00+00:00",
  max_members: 5,
  max_reports: 1,
  drafts_per_month: null,
  drafts_total: 20,
  custom_templates: true,
  can_read_billing: true,
  can_manage_billing: false,
};

const limits = {
  max_members: 10,
  max_reports: null,
  drafts_per_month: 250,
  drafts_total: null,
  custom_templates: true,
};

const OVERVIEW = {
  organization_id: ORGANIZATION_ID,
  enforced: true,
  can_manage: true,
  subscription: {
    state: "active",
    plan: "cabinet",
    source: "purchase",
    starts_at: "2026-10-01T00:00:00+00:00",
    ends_at: "2026-11-01T00:00:00+00:00",
    grace_ends_at: "2026-11-08T00:00:00+00:00",
    limits,
    usage: { members: 4, invitations: 1, active_reports: 2, workspaces: 3 },
  },
  passes: [
    {
      workspace_id: MISSION_ID,
      state: "read_only",
      plan: null,
      source: null,
      starts_at: null,
      ends_at: null,
      grace_ends_at: null,
      limits: { ...limits, max_members: null, drafts_per_month: null, custom_templates: false },
      usage: { members: 1, invitations: 0, reports: 1 },
    },
  ],
  packs: [{ id: PACK_ID, drafts: 100, expires_at: "2027-10-01T00:00:00+00:00" }],
};

beforeEach(() => {
  rpc.mockReset();
  vi.mocked(createClient).mockResolvedValue({ rpc } as unknown as Awaited<ReturnType<typeof createClient>>);
});

describe("getWorkspaceBillingState", () => {
  it("maps the row of workspace_billing_state", async () => {
    answer(TRIAL_ROW);
    const state = await getWorkspaceBillingState(WORKSPACE_ID.toUpperCase());
    expect(rpc).toHaveBeenCalledWith("workspace_billing_state", { p_workspace_id: WORKSPACE_ID });
    expect(state).toEqual({
      organizationId: ORGANIZATION_ID,
      billingMode: "subscription",
      state: "trialing",
      plan: "trial",
      source: "trial",
      endsAt: "2026-10-28T10:00:00+00:00",
      graceEndsAt: "2026-11-04T10:00:00+00:00",
      limits: { maxMembers: 5, maxReports: 1, draftsPerMonth: null, draftsTotal: 20, customTemplates: true },
      canReadBilling: true,
      canManageBilling: false,
    });
  });

  it("reads an active line with no limit while billing is not enforced", async () => {
    answer({
      ...TRIAL_ROW,
      state: "active",
      plan: null,
      source: null,
      ends_at: null,
      grace_ends_at: null,
      max_members: null,
      max_reports: null,
      drafts_total: null,
    });
    const state = await getWorkspaceBillingState(WORKSPACE_ID);
    expect(state?.state).toBe("active");
    expect(state?.plan).toBeNull();
    expect(state?.limits.maxMembers).toBeNull();
  });

  it("returns null for someone outside the workspace, an error or an odd row", async () => {
    answer(null);
    expect(await getWorkspaceBillingState(WORKSPACE_ID)).toBeNull();
    answer(null, { message: "boom" });
    expect(await getWorkspaceBillingState(WORKSPACE_ID)).toBeNull();
    answer({ ...TRIAL_ROW, state: "frozen" });
    expect(await getWorkspaceBillingState(WORKSPACE_ID)).toBeNull();
  });

  it("does not call the database with an id that is not a uuid", async () => {
    expect(await getWorkspaceBillingState("abc")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});

describe("getBillingOverview", () => {
  it("maps the overview", async () => {
    answer(OVERVIEW);
    const overview = await getBillingOverview(ORGANIZATION_ID);
    expect(rpc).toHaveBeenCalledWith("billing_overview", { p_organization_id: ORGANIZATION_ID });
    expect(overview).toEqual({
      organizationId: ORGANIZATION_ID,
      enforced: true,
      canManage: true,
      subscription: {
        state: "active",
        plan: "cabinet",
        source: "purchase",
        startsAt: "2026-10-01T00:00:00+00:00",
        endsAt: "2026-11-01T00:00:00+00:00",
        graceEndsAt: "2026-11-08T00:00:00+00:00",
        limits: {
          maxMembers: 10,
          maxReports: null,
          draftsPerMonth: 250,
          draftsTotal: null,
          customTemplates: true,
        },
        usage: { members: 4, invitations: 1, activeReports: 2, workspaces: 3 },
      },
      passes: [
        {
          workspaceId: MISSION_ID,
          state: "read_only",
          plan: null,
          source: null,
          startsAt: null,
          endsAt: null,
          graceEndsAt: null,
          limits: {
            maxMembers: null,
            maxReports: null,
            draftsPerMonth: null,
            draftsTotal: null,
            customTemplates: false,
          },
          usage: { members: 1, invitations: 0, reports: 1 },
        },
      ],
      packs: [{ id: PACK_ID, drafts: 100, expiresAt: "2027-10-01T00:00:00+00:00" }],
    });
  });

  it("returns null for someone who cannot read the billing, an error or an odd answer", async () => {
    answer(null);
    expect(await getBillingOverview(ORGANIZATION_ID)).toBeNull();
    answer(null, { message: "boom" });
    expect(await getBillingOverview(ORGANIZATION_ID)).toBeNull();
    answer({ ...OVERVIEW, packs: "none" });
    expect(await getBillingOverview(ORGANIZATION_ID)).toBeNull();
    expect(await getBillingOverview("not-an-id")).toBeNull();
  });
});
