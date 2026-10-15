import type { PlanCode } from "@/lib/billing/catalog";

// Billing time an organization or a workspace loses when it is deleted
// (KRB-180, criterion 3), from private.billing_time_left: entitlements not
// revoked that have not ended, and Pack IA credits with drafts left.

export type SubscriptionLeft = { entitlementId: string; plan: PlanCode; startsAt: string; endsAt: string };
export type PassLeft = { entitlementId: string; workspaceId: string; startsAt: string; endsAt: string };
export type PackLeft = { packId: string; draftsLeft: number; expiresAt: string };

export type BillingTimeLeft = {
  subscription: SubscriptionLeft[];
  passes: PassLeft[];
  packs: PackLeft[];
};

/** What the confirmation dialog warns about. */
export type BillingLosses = {
  /** End of the free trial, when it still runs. */
  trialEndsAt: string | null;
  /** The plan that runs now (or starts first), and the end of the last period paid or granted. */
  plan: { plan: Exclude<PlanCode, "trial">; endsAt: string } | null;
  /** One per workspace with a pass, with the end of its last pass. */
  passes: { workspaceId: string; endsAt: string }[];
  /** Pack IA drafts not used yet, and when the last of those packs expires. */
  packDrafts: number;
  packsExpireAt: string | null;
  /** True when a plan, a pass or Pack IA credits are lost, the trial aside. */
  any: boolean;
};

const time = (date: string) => Date.parse(date);

/** The latest of `dates`, as given. Null for none. */
function latest(dates: string[]): string | null {
  return dates.reduce<string | null>(
    (max, date) => (max === null || time(date) > time(max) ? date : max),
    null,
  );
}

/** Sums up what is lost. `now` decides which period runs now. */
export function billingLosses(left: BillingTimeLeft, now: Date = new Date()): BillingLosses {
  const trial = left.subscription.filter((period) => period.plan === "trial");
  const plans = left.subscription.filter(
    (period): period is SubscriptionLeft & { plan: Exclude<PlanCode, "trial"> } => period.plan !== "trial",
  );
  const current = plans.find((period) => time(period.startsAt) <= now.getTime()) ?? plans[0];
  const lastEnd = latest(plans.map((period) => period.endsAt));

  const passEnds = new Map<string, string>();
  for (const pass of left.passes) {
    const known = passEnds.get(pass.workspaceId);
    if (!known || time(pass.endsAt) > time(known)) passEnds.set(pass.workspaceId, pass.endsAt);
  }

  const packs = left.packs.filter((pack) => pack.draftsLeft > 0);
  const packDrafts = packs.reduce((total, pack) => total + pack.draftsLeft, 0);
  const plan = current && lastEnd ? { plan: current.plan, endsAt: lastEnd } : null;
  const passes = [...passEnds].map(([workspaceId, endsAt]) => ({ workspaceId, endsAt }));

  return {
    trialEndsAt: latest(trial.map((period) => period.endsAt)),
    plan,
    passes,
    packDrafts,
    packsExpireAt: latest(packs.map((pack) => pack.expiresAt)),
    any: plan !== null || passes.length > 0 || packDrafts > 0,
  };
}
