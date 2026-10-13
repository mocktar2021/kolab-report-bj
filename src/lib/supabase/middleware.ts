import { createServerClient, type CookieOptions } from "@supabase/ssr";
import type { NextRequest, NextResponse } from "next/server";
import { publicEnv } from "@/lib/env";

/**
 * Refreshes the Supabase session cookie on `response` (the response produced
 * by the i18n middleware) and returns the authenticated user, if any.
 */
export async function updateSession(request: NextRequest, response: NextResponse) {
  const supabase = createServerClient(
    publicEnv.NEXT_PUBLIC_SUPABASE_URL,
    publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
          cookiesToSet.forEach(({ name, value, options }) => response.cookies.set(name, value, options));
        },
      },
    },
  );

  // getUser() revalidates the JWT with Supabase Auth; do not use getSession()
  // for authorization decisions on the server.
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return user;
}
