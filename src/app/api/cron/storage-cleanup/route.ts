import { NextResponse } from "next/server";
import { cronSecretIsUsable, isCronAuthorized } from "@/lib/cron";
import { log, withRequestId } from "@/lib/log";
import { runStorageCleanup } from "@/lib/storage/cleanup";
import { createAdminClient } from "@/lib/supabase/admin";

// Vercel Cron calls this once a day (vercel.json) with
// "Authorization: Bearer $CRON_SECRET" (KRB-166). It deletes the manual
// exports past their retention and the deletion log events older than 12
// months (KRB-180), and removes the stored files of deleted rows.
// The answer holds counts only, never a path. Anything that failed makes it
// a 500, so the run shows as failed in the Vercel cron logs.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

const NO_STORE = { "Cache-Control": "private, no-store" };

export const GET = withRequestId(async (request: Request) => {
  const secret = process.env.CRON_SECRET;
  if (!isCronAuthorized(request.headers.get("authorization"), secret)) {
    if (!cronSecretIsUsable(secret)) {
      log.error("storage-cleanup: CRON_SECRET is missing or too short, every call is refused");
    }
    return NextResponse.json({ error: "unauthorized" }, { status: 401, headers: NO_STORE });
  }

  const summary = await runStorageCleanup(createAdminClient());
  const status = summary.ok && summary.failed === 0 ? 200 : 500;
  return NextResponse.json(summary, { status, headers: NO_STORE });
});
