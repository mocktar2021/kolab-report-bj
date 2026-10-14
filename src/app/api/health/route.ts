import { createClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";
import { log, withRequestId } from "@/lib/log";
import type { Database } from "@/lib/supabase/database.types";

// GET /api/health, for the uptime monitor (KRB-139). Public and never
// cached. It calls public.health_check() with the anon key, so the check
// needs no secret, and answers 503 when the database fails or takes more
// than 3 seconds. The body never holds an error message, a stack or a
// setting: only the short commit of the deployment.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const DATABASE_TIMEOUT_MS = 3000;

type Check = "ok" | "error";

async function checkDatabase(): Promise<Check> {
  try {
    const supabase = createClient<Database>(
      publicEnv.NEXT_PUBLIC_SUPABASE_URL,
      publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
      { auth: { persistSession: false, autoRefreshToken: false } },
    );
    const { data, error } = await supabase
      .rpc("health_check")
      .abortSignal(AbortSignal.timeout(DATABASE_TIMEOUT_MS));
    if (error || data !== true) {
      log.error("health: the database check failed", { error: error?.message });
      return "error";
    }
    return "ok";
  } catch (error) {
    log.error("health: the database check failed", { error });
    return "error";
  }
}

/** The short commit Vercel built, or null (locally). */
function release(): string | null {
  const sha = process.env.VERCEL_GIT_COMMIT_SHA;
  return sha && /^[0-9a-f]{7,40}$/i.test(sha) ? sha.slice(0, 7).toLowerCase() : null;
}

export const GET = withRequestId(async () => {
  const database = await checkDatabase();
  const ok = database === "ok";
  return NextResponse.json(
    { status: ok ? "ok" : "error", checks: { database }, release: release(), time: new Date().toISOString() },
    { status: ok ? 200 : 503, headers: { "Cache-Control": "no-store" } },
  );
});
