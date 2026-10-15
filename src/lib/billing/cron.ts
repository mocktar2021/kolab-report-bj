import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";
import { sendBillingNotices } from "./notices";
import { reconcilePendingPurchases } from "./reconcile";
import { applyDeps, stuckAlert } from "./server";
import { getBillingSettings } from "./settings";

// The daily billing job, called by /api/cron/billing (vercel.json). It runs
// a list of steps in order. A step that fails or throws does not stop the
// next ones, and makes the whole run fail, so the route answers 500 and the
// run shows as failed in the Vercel cron logs. Each step reports counts
// only, never a name, an address or an amount.

/**
 * Pending purchases the daily run reads again from FedaPay, oldest check
 * first, so it stays well under the route's 60 seconds. The billing page and
 * the return page check their own purchases too.
 */
export const RECONCILE_LIMIT = 25;

export type AdminClient = SupabaseClient<Database>;

export type CronStepResult = { ok: boolean; counts: Record<string, number> };

export type CronStep = { name: string; run: (admin: AdminClient) => Promise<CronStepResult> };

export type CronRunSummary = { ok: boolean; steps: Record<string, CronStepResult> };

export const BILLING_CRON_STEPS: readonly CronStep[] = [
  {
    // Renewal reminders: e-mails and in-app notifications (KRB-178).
    name: "notices",
    run: async (admin) => {
      const { ok, ...counts } = await sendBillingNotices(admin);
      return { ok, counts };
    },
  },
  {
    // Payments whose webhook was lost and whose buyer never came back
    // (ADR 001, 8.7): each pending purchase is read again from FedaPay and
    // applied. A purchase still pending 48 hours after it was created
    // expires in the same pass (billing_check_pending), so no other step
    // expires them.
    name: "reconcile",
    run: async () => {
      const settings = getBillingSettings();
      if (!settings.api) {
        // No FEDAPAY_ENVIRONMENT: payments are off on purpose. Any other
        // problem is a misconfiguration, logged by getBillingSettings, and
        // fails the run.
        const off = settings.problems.length === 1 && settings.problems[0] === "environment_missing";
        return { ok: off, counts: { skipped: 1 } };
      }
      const deps = applyDeps(settings, settings.api);
      const summary = await reconcilePendingPurchases(deps, {
        limit: RECONCILE_LIMIT,
        onStuck: stuckAlert(settings, deps),
      });
      return { ok: summary.failed === 0, counts: summary };
    },
  },
];

/** Runs every step, even after one failed. */
export async function runCronSteps(
  admin: AdminClient,
  steps: readonly CronStep[] = BILLING_CRON_STEPS,
): Promise<CronRunSummary> {
  const summary: CronRunSummary = { ok: true, steps: {} };
  for (const step of steps) {
    let result: CronStepResult;
    try {
      result = await step.run(admin);
    } catch (error) {
      log.error("billing: cron step failed", { step: step.name, error });
      result = { ok: false, counts: {} };
    }
    summary.steps[step.name] = result;
    if (!result.ok) summary.ok = false;
  }
  log.info("billing: cron finished", {
    ok: summary.ok,
    ...Object.fromEntries(Object.entries(summary.steps).map(([name, result]) => [name, result.ok])),
  });
  return summary;
}
