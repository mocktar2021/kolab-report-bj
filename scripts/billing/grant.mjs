// Gives an organization a period without a payment (KRB-179): a goodwill
// extension, a fix after an incident, or the owner's own organizations. It
// starts on --start, or after the periods already planned, or now; a running
// trial ends where it starts. No purchase and no receipt.
//
//   SUPABASE_URL=... SUPABASE_SERVICE_ROLE_KEY=... node scripts/billing/grant.mjs \
//     --organization <uuid> --plan institution --months 12 \
//     --actor "Mocktar Tairou" --reason "Organisation du propriétaire" [--apply]
//
// --days N instead of --months N. Optional: --start 2026-11-01, --members
// N|none, --reports N|none, --drafts-per-month N, --templates yes|no (the
// plan's limits otherwise). Runbook: docs/operations/billing.md.
import { formatPeriods, grantParams, organizationSummary, run } from "./admin.mjs";

try {
  await run({
    argv: process.argv.slice(2),
    env: process.env,
    build: grantParams,
    functionName: "billing_admin_grant",
    describe: async (project, params, log) => {
      const { name, periods } = await organizationSummary(project, params.p_organization_id);
      log(`Organization: ${name}`);
      log("Periods now:");
      for (const line of formatPeriods(periods)) log(line);
      log(
        `Grant: ${params.p_plan} for ${params.p_length}, from ${params.p_starts_at ?? "the next free day"}`,
      );
    },
  });
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
}
