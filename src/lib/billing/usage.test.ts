import { describe, expect, it } from "vitest";
import type { WorkspaceUsage } from "./state";
import {
  draftsHint,
  meterPercent,
  membersHint,
  purchaseStatusKey,
  reportsHint,
  subscriptionRule,
  type SubscriptionPeriod,
} from "./usage";

const INDEPENDANT: WorkspaceUsage = {
  billingMode: "subscription",
  enforced: true,
  state: "active",
  plan: "independant",
  members: 2,
  invitations: 1,
  maxMembers: 3,
  reports: 2,
  maxReports: 3,
  drafts: { used: 48, allowance: 60, period: "month" },
  packDraftsLeft: 0,
};

describe("membersHint", () => {
  it("gives the plan, its members with open invitations and the limit", () => {
    expect(membersHint(INDEPENDANT)).toEqual({
      mission: false,
      plan: "Indépendant",
      members: 2,
      invitations: 1,
      max: 3,
    });
  });

  it("says nothing while billing is off, without a limit, or to someone who does not read billing", () => {
    expect(membersHint({ ...INDEPENDANT, enforced: false })).toBeNull();
    expect(membersHint({ ...INDEPENDANT, maxMembers: null })).toBeNull();
    expect(membersHint({ ...INDEPENDANT, members: null, invitations: null })).toBeNull();
    expect(membersHint({ ...INDEPENDANT, plan: null })).toBeNull();
    expect(membersHint(null)).toBeNull();
  });
});

describe("reportsHint", () => {
  it("counts the active reports of a plan", () => {
    expect(reportsHint(INDEPENDANT)).toEqual({ kind: "subscription", plan: "Indépendant", count: 2, max: 3 });
    expect(reportsHint({ ...INDEPENDANT, plan: "cabinet", maxReports: null })).toBeNull();
  });

  it("only speaks up in a mission workspace once its one report exists", () => {
    const mission = {
      ...INDEPENDANT,
      billingMode: "mission" as const,
      plan: "mission" as const,
      maxReports: 1,
    };
    expect(reportsHint({ ...mission, reports: 0 })).toBeNull();
    expect(reportsHint({ ...mission, reports: 1 })).toEqual({ kind: "mission" });
  });
});

describe("draftsHint", () => {
  it("gives what the month has left, and the packs", () => {
    expect(draftsHint(INDEPENDANT)).toEqual({ period: "month", left: 12, packs: 0 });
    expect(draftsHint({ ...INDEPENDANT, packDraftsLeft: 85 })).toEqual({
      period: "month",
      left: 12,
      packs: 85,
    });
  });

  it("names the trial and the pass, and never goes below zero", () => {
    expect(
      draftsHint({ ...INDEPENDANT, plan: "trial", drafts: { used: 21, allowance: 20, period: "total" } }),
    ).toEqual({ period: "trial", left: 0, packs: 0 });
    expect(
      draftsHint({
        ...INDEPENDANT,
        billingMode: "mission",
        plan: "mission",
        drafts: { used: 5, allowance: 80, period: "total" },
      }),
    ).toEqual({ period: "mission", left: 75, packs: 0 });
  });

  it("says nothing without an allowance, in read-only or while billing is off", () => {
    expect(draftsHint({ ...INDEPENDANT, drafts: { used: 3, allowance: null, period: "month" } })).toBeNull();
    expect(draftsHint({ ...INDEPENDANT, state: "read_only" })).toBeNull();
    expect(draftsHint({ ...INDEPENDANT, enforced: false })).toBeNull();
  });
});

describe("meterPercent and purchaseStatusKey", () => {
  it("fills the bar up to 100 %", () => {
    expect(meterPercent(1, 3)).toBe(33);
    expect(meterPercent(4, 3)).toBe(100);
    expect(meterPercent(4, null)).toBe(0);
  });

  it("shows a pending purchase FedaPay declined as not paid", () => {
    expect(purchaseStatusKey({ status: "pending", fedapayStatus: "declined" })).toBe("notPaid");
    expect(purchaseStatusKey({ status: "pending", fedapayStatus: "canceled" })).toBe("notPaid");
    expect(purchaseStatusKey({ status: "pending", fedapayStatus: "pending" })).toBe("pending");
    expect(purchaseStatusKey({ status: "paid", fedapayStatus: "approved" })).toBe("paid");
  });
});

describe("subscriptionRule (ADR 001, 6.3)", () => {
  const NOW = new Date("2026-11-11T10:00:00Z");
  const period = (overrides: Partial<SubscriptionPeriod>): SubscriptionPeriod => ({
    plan: "independant",
    source: "purchase",
    startsAt: "2026-11-01T10:00:00Z",
    endsAt: "2026-12-01T10:00:00Z",
    graceDays: 7,
    amountHtXof: 15_000,
    ...overrides,
  });

  it("adds the remaining trial days", () => {
    const trial = period({ plan: "trial", source: "trial", amountHtXof: null });
    expect(subscriptionRule("independant", [trial], NOW)).toBe("trial");
    expect(subscriptionRule("cabinet", [trial], NOW)).toBe("trial");
  });

  it("stacks a renewal and a downgrade, converts an upgrade", () => {
    expect(subscriptionRule("independant", [period({})], NOW)).toBe("renew");
    expect(subscriptionRule("cabinet", [period({})], NOW)).toBe("upgrade");
    expect(subscriptionRule("independant", [period({ plan: "cabinet", amountHtXof: 49_000 })], NOW)).toBe(
      "downgrade",
    );
  });

  it("converts nothing from a period worth nothing", () => {
    const launch = period({ plan: "cabinet", source: "launch", amountHtXof: 0 });
    expect(subscriptionRule("cabinet", [launch], NOW)).toBe("renew");
    expect(subscriptionRule("independant", [launch], NOW)).toBe("downgrade");
    const manual = period({ source: "manual", amountHtXof: null });
    expect(subscriptionRule("cabinet", [manual], NOW)).toBe("now");
  });

  it("starts at the old end in grace, and now after it", () => {
    const ended = period({ startsAt: "2026-10-05T10:00:00Z", endsAt: "2026-11-05T10:00:00Z" });
    expect(subscriptionRule("independant", [ended], NOW)).toBe("grace");
    const old = period({ startsAt: "2026-09-01T10:00:00Z", endsAt: "2026-10-01T10:00:00Z" });
    expect(subscriptionRule("cabinet", [old], NOW)).toBe("now");
    expect(subscriptionRule("cabinet", [], NOW)).toBe("now");
  });

  it("compares with the plan that applies now, not a later one", () => {
    const current = period({ plan: "cabinet", amountHtXof: 49_000 });
    const next = period({ startsAt: "2026-12-01T10:00:00Z", endsAt: "2027-01-01T10:00:00Z" });
    expect(subscriptionRule("cabinet", [next, current], NOW)).toBe("renew");
  });
});
