// @vitest-environment node
import { describe, expect, it, vi } from "vitest";
import { bannerFor } from "./banner";
import type { WorkspaceBillingState } from "./state";

vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));

const ORG = "5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c";
const NOW = new Date("2026-10-14T08:00:00Z");

function state(overrides: Partial<WorkspaceBillingState> = {}): WorkspaceBillingState {
  return {
    organizationId: ORG,
    billingMode: "subscription",
    state: "active",
    plan: "cabinet",
    source: "purchase",
    endsAt: "2026-11-30T10:00:00Z",
    graceEndsAt: "2026-12-07T10:00:00Z",
    limits: {
      maxMembers: 10,
      maxReports: null,
      draftsPerMonth: 250,
      draftsTotal: null,
      customTemplates: true,
    },
    canReadBilling: true,
    canManageBilling: true,
    ...overrides,
  };
}

describe("bannerFor", () => {
  it("says nothing while billing is not enforced, or for a period far from its end", () => {
    expect(bannerFor(null, NOW)).toBeNull();
    expect(bannerFor(state({ plan: null, source: null, endsAt: null, graceEndsAt: null }), NOW)).toBeNull();
    expect(bannerFor(state(), NOW)).toBeNull();
  });

  it("counts the days left in the trial, for the people who can renew only", () => {
    const trial = state({
      state: "trialing",
      plan: "trial",
      source: "trial",
      endsAt: "2026-10-20T09:00:00Z",
    });
    expect(bannerFor(trial, NOW)).toEqual({ kind: "trial", days: 6, organizationId: ORG, canManage: true });
    expect(bannerFor({ ...trial, endsAt: "2026-10-14T20:00:00Z" }, NOW)).toMatchObject({ days: 0 });
    expect(bannerFor({ ...trial, canManageBilling: false }, NOW)).toBeNull();
  });

  it("warns 7 days before the end day", () => {
    expect(bannerFor(state({ endsAt: "2026-10-22T10:00:00Z" }), NOW)).toBeNull();
    expect(bannerFor(state({ endsAt: "2026-10-21T10:00:00Z" }), NOW)).toEqual({
      kind: "ending",
      plan: "cabinet",
      endsAt: "2026-10-21T10:00:00Z",
      organizationId: ORG,
      canManage: true,
    });
    expect(bannerFor(state({ endsAt: "2026-10-21T10:00:00Z", canManageBilling: false }), NOW)).toBeNull();
  });

  it("shows grace, read-only and no plan to every member", () => {
    const member = { canManageBilling: false };
    expect(
      bannerFor(
        state({
          ...member,
          state: "grace",
          endsAt: "2026-10-12T10:00:00Z",
          graceEndsAt: "2026-10-19T10:00:00Z",
        }),
        NOW,
      ),
    ).toEqual({
      kind: "grace",
      plan: "cabinet",
      endsAt: "2026-10-12T10:00:00Z",
      graceEndsAt: "2026-10-19T10:00:00Z",
      organizationId: ORG,
      canManage: false,
    });
    expect(
      bannerFor(state({ ...member, state: "read_only", graceEndsAt: "2026-10-10T10:00:00Z" }), NOW),
    ).toEqual({
      kind: "readOnly",
      plan: "cabinet",
      graceEndsAt: "2026-10-10T10:00:00Z",
      organizationId: ORG,
      canManage: false,
    });
    expect(
      bannerFor(
        state({ ...member, state: "read_only", plan: null, source: null, endsAt: null, graceEndsAt: null }),
        NOW,
      ),
    ).toEqual({ kind: "noPlan", organizationId: ORG, canManage: false });
  });
});
