import { NextResponse } from "next/server";
import { withRequestId } from "@/lib/log";
import { createClient } from "@/lib/supabase/server";
import { getCurrentUser } from "@/lib/supabase/user";

const NO_STORE = { "Cache-Control": "private, no-store" };

/**
 * The signed-in user's access token, for Realtime in the browser
 * (src/lib/realtime/client.ts). The browser used to read it from the session
 * cookie with supabase-js and its Auth client, 240 kB of JavaScript on the
 * dashboard (KRB-172). The token is the one in that cookie, which the page
 * could already read: this route gives nothing new to the browser.
 *
 * getCurrentUser() checks the session with Supabase Auth and refreshes it
 * first when it has expired; the new cookies go back with this response, so
 * the token handed out is always current. The proxy skips /api routes.
 */
export const GET = withRequestId(async () => {
  const user = await getCurrentUser();
  if (!user) return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });

  const supabase = await createClient();
  const {
    data: { session },
  } = await supabase.auth.getSession();
  if (!session?.expires_at) {
    return NextResponse.json({ error: "unauthenticated" }, { status: 401, headers: NO_STORE });
  }
  return NextResponse.json(
    { token: session.access_token, expiresAt: session.expires_at * 1000 },
    { headers: NO_STORE },
  );
});
