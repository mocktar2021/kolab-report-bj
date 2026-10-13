"use server";

import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

/**
 * Ends the Supabase session and goes to the sign-in page. scope "local" only
 * revokes this browser's session, so other devices stay signed in.
 */
export async function signOut() {
  const supabase = await createClient();
  await supabase.auth.signOut({ scope: "local" });

  const locale = await getLocale();
  redirect({ href: "/connexion", locale });
}
