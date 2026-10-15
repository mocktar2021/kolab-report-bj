// Ends an entitlement now (KRB-179), to correct a grant or after a refund.
// It refunds nothing: refunds go through FedaPay or the bank. The entitlement
// id is in the dry run of grant.mjs or record-payment.mjs, or in
// public.billing_entitlements.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/billing/revoke.mjs \
//     --entitlement <uuid> --actor "Mocktar Tairou" --reason "Erreur de saisie" [--apply]
//
// Runbook: docs/operations/billing.md.
import { revokeParams, run } from "./admin.mjs";

try {
  await run({
    argv: process.argv.slice(2),
    env: process.env,
    build: revokeParams,
    functionName: "billing_admin_revoke",
    describe: async (_project, params, log) => {
      log(`Revoke entitlement ${params.p_entitlement_id}`);
    },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
