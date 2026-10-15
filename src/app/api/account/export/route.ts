import { NextResponse } from "next/server";
import { accountExportFileName } from "@/lib/account/export";
import { loadAccountExport } from "@/lib/account/export-server";
import { log, withRequestId } from "@/lib/log";
import { getCurrentUser } from "@/lib/supabase/user";

// "Télécharger mes données" on /fr/compte (KRB-186): the signed-in user's
// data as a JSON file. The user is the one of the session; nothing in the
// request picks whose data comes back.

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const NO_STORE = { "Cache-Control": "private, no-store" };

export const GET = withRequestId(async () => {
  const user = await getCurrentUser();
  if (!user) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  }

  const exportedAt = new Date();
  let body: string;
  try {
    body = JSON.stringify(await loadAccountExport(user, exportedAt), null, 2);
  } catch (error) {
    log.error("account: data export failed", { userId: user.id, error });
    return NextResponse.json({ error: "generic" }, { status: 500, headers: NO_STORE });
  }

  log.info("account: data exported", { userId: user.id });
  return new NextResponse(body, {
    status: 200,
    headers: {
      ...NO_STORE,
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${accountExportFileName(exportedAt)}"`,
      "X-Content-Type-Options": "nosniff",
    },
  });
});
