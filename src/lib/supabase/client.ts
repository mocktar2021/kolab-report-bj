import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./database.types";

/** Supabase client for Client Components (runs in the browser, anon key + RLS). */
export function createClient() {
  // Read here, not through src/lib/env.ts: its zod schema put zod (13 kB
  // compressed) in the browser next to supabase-js (KRB-154). The build
  // inlines both values, and the server checks them in src/lib/env.ts.
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  if (!url || !anonKey) {
    throw new Error("NEXT_PUBLIC_SUPABASE_URL and NEXT_PUBLIC_SUPABASE_ANON_KEY must be set.");
  }
  return createBrowserClient<Database>(url, anonKey);
}
