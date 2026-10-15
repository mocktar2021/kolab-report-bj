import { PLANS, type PlanCode } from "./catalog";
import type { DraftUsage, EntitlementSource, PurchaseSummary, WorkspaceUsage } from "./state";

// What the billing page and the hints say about usage and periods, as pure
// functions: the pages read the rows, these decide which message applies
// and with which numbers. No server-only import, no zod.

/** Members of the line covering a workspace, for the members page. Null when no limit bites. */
export type MembersHint = {
  mission: boolean;
  plan: string;
  members: number;
  invitations: number;
  max: number;
};

/** Active reports, for the "Nouveau rapport" dialog. */
export type ReportsHint =
  | { kind: "subscription"; plan: string; count: number; max: number }
  | { kind: "mission" };

/** AI drafts left, for the draft panel. */
export type DraftsHint = { period: "month" | "trial" | "mission"; left: number; packs: number };

function limited(usage: WorkspaceUsage | null): usage is WorkspaceUsage & { plan: PlanCode } {
  return Boolean(usage?.enforced && usage.plan);
}

/** "Offre Indépendant : 3 membres sur 3", while billing is enforced and the plan has a member limit. */
export function membersHint(usage: WorkspaceUsage | null): MembersHint | null {
  if (!limited(usage) || usage.maxMembers === null || usage.members === null) return null;
  return {
    mission: usage.billingMode === "mission",
    plan: PLANS[usage.plan].label,
    members: usage.members,
    invitations: usage.invitations ?? 0,
    max: usage.maxMembers,
  };
}

/**
 * The active reports against the plan's limit. A Pass Mission holds one
 * report whatever its status, so its workspace only gets a hint once that
 * report exists.
 */
export function reportsHint(usage: WorkspaceUsage | null): ReportsHint | null {
  if (!limited(usage) || usage.maxReports === null || usage.reports === null) return null;
  if (usage.billingMode === "mission") return usage.reports >= usage.maxReports ? { kind: "mission" } : null;
  return { kind: "subscription", plan: PLANS[usage.plan].label, count: usage.reports, max: usage.maxReports };
}

/** Drafts left in the allowance, and in the packs, while there is an allowance and the workspace can write. */
export function draftsHint(usage: WorkspaceUsage | null): DraftsHint | null {
  if (!limited(usage) || usage.state === "read_only" || usage.drafts.allowance === null) return null;
  return {
    period: usage.drafts.period === "month" ? "month" : usage.billingMode === "mission" ? "mission" : "trial",
    left: draftsLeft(usage.drafts),
    packs: usage.packDraftsLeft,
  };
}

/** What the allowance has left, never below 0. */
export function draftsLeft(drafts: DraftUsage): number {
  return drafts.allowance === null ? 0 : Math.max(drafts.allowance - drafts.used, 0);
}

/** Width of a meter bar, from 0 to 100 %. */
export function meterPercent(used: number, max: number | null): number {
  if (max === null || max <= 0) return 0;
  return Math.min(100, Math.round((used / max) * 100));
}

/** How a purchase reads in the history: a pending one FedaPay declined or canceled did not go through. */
export function purchaseStatusKey(
  purchase: Pick<PurchaseSummary, "status" | "fedapayStatus">,
): "pending" | "notPaid" | "paid" | "expired" | "refunded" | "review" {
  if (
    purchase.status === "pending" &&
    (purchase.fedapayStatus === "declined" || purchase.fedapayStatus === "canceled")
  ) {
    return "notPaid";
  }
  return purchase.status;
}

// -----------------------------------------------------------------------------
// Period rules (ADR 001, 6.3)
// -----------------------------------------------------------------------------

/** A subscription entitlement of the organization, not revoked. */
export type SubscriptionPeriod = {
  plan: PlanCode;
  source: EntitlementSource;
  startsAt: string;
  endsAt: string;
  graceDays: number;
  /** What the period cost, for the conversion on an upgrade. */
  amountHtXof: number | null;
};

export const PERIOD_RULES = ["trial", "renew", "upgrade", "downgrade", "grace", "now"] as const;

export type PeriodRule = (typeof PERIOD_RULES)[number];

const PLAN_RANK: Record<PlanCode, number> = {
  trial: 0,
  independant: 1,
  cabinet: 2,
  institution: 3,
  mission: 0,
};

const DAY_MS = 86_400_000;

/**
 * The rule of ADR 001, 6.3 that a payment for `plan` would follow now, the
 * way billing_apply_transaction grants it: the trial's days are added, a
 * renewal or a downgrade stacks after the last period, an upgrade converts
 * the unused paid days, a payment in grace starts at the old end, and after
 * that it starts at payment.
 */
export function subscriptionRule(
  plan: "independant" | "cabinet",
  periods: readonly SubscriptionPeriod[],
  now: Date = new Date(),
): PeriodRule {
  const at = now.getTime();
  const time = (value: string) => new Date(value).getTime();
  const current = periods.find((period) => time(period.startsAt) <= at && time(period.endsAt) > at);
  if (current?.plan === "trial") return "trial";

  const running = periods.filter((period) => time(period.endsAt) > at);
  if (running.length === 0) {
    const previous = periods
      .filter((period) => time(period.endsAt) <= at)
      .sort((a, b) => time(b.endsAt) - time(a.endsAt))[0];
    return previous && at < time(previous.endsAt) + previous.graceDays * DAY_MS ? "grace" : "now";
  }

  // The plan that applies now, else the next one.
  const reference = [...running].sort((a, b) => time(a.startsAt) - time(b.startsAt))[0]!;
  const rank = PLAN_RANK[plan];
  const referenceRank = PLAN_RANK[reference.plan];
  if (rank > referenceRank) {
    // Only paid days convert: a launch or manual period worth nothing gives none.
    return running.some((period) => (period.amountHtXof ?? 0) > 0) ? "upgrade" : "now";
  }
  return rank === referenceRank ? "renew" : "downgrade";
}
