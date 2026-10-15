// @vitest-environment node
import { beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@/lib/supabase/server";
import { getBillingOverview, getWorkspaceBillingState, getWorkspaceUsage } from "./state";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const WORKSPACE_ID = "0b6b9a47-0c4f-4a59-9a43-6f0a2d1c3e11";
const MISSION_ID = "1c7cab58-1d5f-4b6a-8b54-7f1b3e2d4f22";
const ORGANIZATION_ID = "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a";
const PACK_ID = "4d3c2b1a-9f8e-4d7c-8b6a-5f4e3d2c1b0a";
const PURCHASE_ID = "6e1d2c3b-4a59-4f6e-8d7c-1b2a3c4d5e6f";
const RECEIPT_ID = "5f0c3a2e-7b1d-4c9e-8a6f-2d4b1e3c5a70";

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
    drafts: { used: 12, allowance: 250, period: "month" },
  },
  passes: [
    {
      workspace_id: MISSION_ID,
      workspace_name: "Mission Dassa",
      state: "read_only",
      plan: null,
      source: null,
      starts_at: null,
      ends_at: null,
      grace_ends_at: null,
      limits: { ...limits, max_members: null, drafts_per_month: null, custom_templates: false },
      usage: { members: 1, invitations: 0, reports: 1 },
      drafts: { used: 0, allowance: null, period: "month" },
    },
  ],
  packs: [{ id: PACK_ID, drafts: 100, used: 15, expires_at: "2027-10-01T00:00:00+00:00" }],
  purchases: [
    {
      id: PURCHASE_ID,
      offer: "cabinet_1m",
      offer_label: "Cabinet, 1 mois",
      quantity: 1,
      workspace_id: null,
      workspace_name: null,
      amount_xof: 49000,
      status: "paid",
      fedapay_status: "approved",
      created_at: "2026-10-01T00:00:00+00:00",
      paid_at: "2026-10-01T00:01:00+00:00",
      receipt_id: RECEIPT_ID,
      receipt_number: "KR-2026-000001",
    },
  ],
  purchases_total: 1,
  receipts: [
    {
      id: RECEIPT_ID,
      number: "KR-2026-000001",
      kind: "receipt",
      issued_at: "2026-10-01T00:01:00+00:00",
      total_xof: 49000,
      environment: "live",
      label: "Cabinet, 1 mois",
    },
  ],
  receipts_total: 1,
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
        drafts: { used: 12, allowance: 250, period: "month" },
      },
      passes: [
        {
          workspaceId: MISSION_ID,
          workspaceName: "Mission Dassa",
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
          drafts: { used: 0, allowance: null, period: "month" },
        },
      ],
      packs: [{ id: PACK_ID, drafts: 100, used: 15, expiresAt: "2027-10-01T00:00:00+00:00" }],
      purchases: [
        {
          id: PURCHASE_ID,
          offer: "cabinet_1m",
          offerLabel: "Cabinet, 1 mois",
          quantity: 1,
          workspaceId: null,
          workspaceName: null,
          amountXof: 49000,
          status: "paid",
          fedapayStatus: "approved",
          createdAt: "2026-10-01T00:00:00+00:00",
          paidAt: "2026-10-01T00:01:00+00:00",
          receiptId: RECEIPT_ID,
          receiptNumber: "KR-2026-000001",
        },
      ],
      purchasesTotal: 1,
      receipts: [
        {
          id: RECEIPT_ID,
          number: "KR-2026-000001",
          kind: "receipt",
          issuedAt: "2026-10-01T00:01:00+00:00",
          totalXof: 49000,
          environment: "live",
          label: "Cabinet, 1 mois",
        },
      ],
      receiptsTotal: 1,
    });
  });

  it("still reads an overview without the KRB-177 keys", async () => {
    const { purchases, purchases_total, receipts, receipts_total, ...older } = OVERVIEW;
    void [purchases, purchases_total, receipts, receipts_total];
    answer({
      ...older,
      subscription: { ...OVERVIEW.subscription, drafts: undefined },
      packs: [{ id: PACK_ID, drafts: 100, expires_at: "2027-10-01T00:00:00+00:00" }],
    });
    const overview = await getBillingOverview(ORGANIZATION_ID);
    expect(overview?.subscription.drafts).toBeNull();
    expect(overview?.packs[0]?.used).toBe(0);
    expect(overview?.purchases).toEqual([]);
    expect(overview?.receiptsTotal).toBe(0);
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

describe("getWorkspaceUsage", () => {
  const ROW = {
    billing_mode: "subscription",
    enforced: true,
    state: "active",
    plan: "independant",
    members: 3,
    invitations: 0,
    max_members: 3,
    reports: 1,
    max_reports: 3,
    drafts_used: 48,
    drafts_allowance: 60,
    drafts_period: "month",
    pack_drafts_left: 85,
  };

  it("maps the row of workspace_billing_usage", async () => {
    answer(ROW);
    expect(await getWorkspaceUsage(WORKSPACE_ID.toUpperCase())).toEqual({
      billingMode: "subscription",
      enforced: true,
      state: "active",
      plan: "independant",
      members: 3,
      invitations: 0,
      maxMembers: 3,
      reports: 1,
      maxReports: 3,
      drafts: { used: 48, allowance: 60, period: "month" },
      packDraftsLeft: 85,
    });
    expect(rpc).toHaveBeenCalledWith("workspace_billing_usage", { p_workspace_id: WORKSPACE_ID });
  });

  it("keeps the counts an expert does not get as null", async () => {
    answer({ ...ROW, members: null, invitations: null, reports: null });
    const usage = await getWorkspaceUsage(WORKSPACE_ID);
    expect(usage?.members).toBeNull();
    expect(usage?.drafts.used).toBe(48);
  });

  it("returns null for a viewer, an error, an odd row or a bad id", async () => {
    answer(null);
    expect(await getWorkspaceUsage(WORKSPACE_ID)).toBeNull();
    answer(null, { message: "boom" });
    expect(await getWorkspaceUsage(WORKSPACE_ID)).toBeNull();
    answer({ ...ROW, drafts_period: "week" });
    expect(await getWorkspaceUsage(WORKSPACE_ID)).toBeNull();
    rpc.mockReset();
    expect(await getWorkspaceUsage("abc")).toBeNull();
    expect(rpc).not.toHaveBeenCalled();
  });
});
