import "server-only";
import { createClient } from "@supabase/supabase-js";
import { authErrorKey } from "@/lib/auth/errors";
import { publicEnv } from "@/lib/env";

export type PasswordCheck = "ok" | "wrongPassword" | "rateLimited" | "captchaRequired";

/**
 * Checks the current password of the signed-in user before their account is
 * deleted, with Supabase Auth's own sign-in. The client keeps its session in
 * memory, so the browser's session cookie is left alone, and the session the
 * check opens is ended right away. The password is never logged or stored.
 */
export async function verifyPassword(
  user: { id: string; email: string },
  password: string,
  captchaToken: string | undefined,
): Promise<PasswordCheck> {
  const client = createClient(publicEnv.NEXT_PUBLIC_SUPABASE_URL, publicEnv.NEXT_PUBLIC_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: user.email,
    password,
    options: { captchaToken },
  });
  if (error) {
    const key = authErrorKey(error);
    if (key === "rateLimited" || key === "captchaRequired") return key;
    return "wrongPassword";
  }
  // "local" ends this session only. The default would end every session of
  // the account, the browser's included.
  await client.auth.signOut({ scope: "local" }).catch(() => undefined);
  return data.user?.id === user.id ? "ok" : "wrongPassword";
}
