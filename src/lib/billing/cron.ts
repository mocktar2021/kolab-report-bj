import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { log } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";
import { sendBillingNotices } from "./notices";

// The daily billing job, called by /api/cron/billing (vercel.json). It runs
// a list of steps in order. A step that fails or throws does not stop the
// next ones, and makes the whole run fail, so the route answers 500 and the
// run shows as failed in the Vercel cron logs. Each step reports counts
// only, never a name, an address or an amount.

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
  // Slot 1 of PR 176-2, wired at integration: { name: "reconcile", run } with
  // reconcilePendingPurchases(deps, options) from src/lib/billing/reconcile.ts.
  // It takes ApplyDeps (this admin client as `db`, plus the FedaPay client)
  // and returns { checked, granted, expired, failed }: ok is failed === 0.
  //
  // Slot 2 of PR 176-2, wired at integration: { name: "expirePending", run },
  // pending purchases older than 48 hours become expired (ADR 001, 8.7). If
  // the reconciliation already expires them, this slot stays empty.
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
