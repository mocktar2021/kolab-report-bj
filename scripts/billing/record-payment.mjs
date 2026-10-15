// Records a bank transfer for an Institution quote (KRB-179): a paid purchase,
// its period by the same rules as an online payment, and a numbered receipt.
// Renewal is the same command with the next transfer.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/billing/record-payment.mjs \
//     --organization <uuid> --amount 1800000 --months 12 --reference VIR-2026-0147 \
//     --paid-on 2026-10-13 --actor "Mocktar Tairou" --reason "Devis D-2026-001 signé" [--apply]
//
// Optional: --label "Institution, 12 mois" (printed on the receipt),
// --members N|none, --reports N|none, --drafts-per-month N, --templates yes|no
// (Institution defaults otherwise), --test (staging: a test receipt).
// Runbook: docs/operations/billing.md.
import { formatPeriods, organizationSummary, recordPaymentParams, run } from "./admin.mjs";

try {
  await run({
    argv: process.argv.slice(2),
    env: process.env,
    build: recordPaymentParams,
    functionName: "billing_admin_record_payment",
    describe: async (project, params, log) => {
      const { name, periods } = await organizationSummary(project, params.p_organization_id);
      log(`Organization: ${name}`);
      log("Periods now:");
      for (const line of formatPeriods(periods)) log(line);
      log(
        `Transfer ${params.p_transfer_reference}: ${params.p_amount_ht_xof} FCFA HT for ${params.p_months} months` +
          (params.p_test ? " (test receipt)" : ""),
      );
    },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
