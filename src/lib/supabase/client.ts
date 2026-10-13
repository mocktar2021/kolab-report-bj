import { createBrowserClient } from "@supabase/ssr";
import { publicEnv } from "@/lib/env";

/** Supabase client for Client Components (runs in the browser, anon key + RLS). */
export function createClient() {
  return createBrowserClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY);
}
