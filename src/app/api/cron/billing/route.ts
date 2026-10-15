import { NextResponse } from "next/server";
import { runCronSteps } from "@/lib/billing/cron";
import { cronSecretIsUsable, isCronAuthorized } from "@/lib/cron";
import { log, withRequestId } from "@/lib/log";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron calls this once a day (vercel.json, 06:17 in Cotonou) with
// "Authorization: Bearer $CRON_SECRET", like the storage cleanup (KRB-166).
// It runs the billing steps of src/lib/billing/cron.ts: the renewal
// reminders for now (KRB-178). The answer holds counts only. Anything that
// failed makes it a 500, so the run shows as failed in the Vercel cron logs.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store" };

export const GET = withRequestId(async (request: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    if (!cronSecretIsUsable(secret)) {
      log.error("billing: CRON_SECRET is missing or too short, every call is refused");
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  try {
    const summary = await runCronSteps(createAdminClient());
    const steps = Object.fromEntries(
      Object.entries(summary.steps).map(([name, result]) => [name, { ok: result.ok, ...result.counts }]),
    );
    return NextResponse.json(
      { ok: summary.ok, steps },
      { status: summary.ok ? 200 : 500, headers: NO_STORE },
    );
  } catch (error) {
    // createAdminClient throws when the service role key is missing.
    log.error("billing: cron failed", { error });
    return NextResponse.json({ ok: false }, { status: 500, headers: NO_STORE });
  }
});
