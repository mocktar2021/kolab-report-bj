import { RealtimeClient } from "@supabase/realtime-js";

/** The token is fetched again when it has less than this left. */
const TOKEN_MARGIN_MS = 60 * 1000;

type AccessToken = { token: string; expiresAt: number };

/**
 * Realtime client for the browser, without supabase-js (KRB-172): 58 kB of
 * JavaScript instead of 240. supabase-js read the access token from the
 * session cookie with its Auth client. Here /api/realtime/token reads it on
 * the server, refreshed when needed. Realtime asks for the token before the
 * first join and at each heartbeat (25 s): it comes from memory until about
 * a minute before it expires. Signed out, there is no token and Realtime
 * refuses the subscription, as before.
 */
export function createRealtimeClient() {
  // Inlined by the build. The server checks both in src/lib/env.ts, whose zod
  // schema stays out of the browser (KRB-154).
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.");
  }

  let current: AccessToken | null = null;
  async function accessToken() {
    if (current && current.expiresAt - Date.now() > TOKEN_MARGIN_MS) return current.token;
    const response = await fetch("/api/realtime/token", { cache: "no-store" });
    current = response.ok ? ((await response.json()) as AccessToken) : null;
    return current?.token ?? null;
  }

  // The address supabase-js builds: the project URL, /realtime/v1, over WebSocket.
  const endpoint = new URL("realtime/v1", url.endsWith("/") ? url : `${url}/`);
  endpoint.protocol = endpoint.protocol.replace("http", "ws");
  return new RealtimeClient(endpoint.href, { params: { apikey: anonKey }, accessToken });
}
