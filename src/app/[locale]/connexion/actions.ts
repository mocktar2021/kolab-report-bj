"use server";

import { z } from "zod";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.string().trim().email(),
  password: z.string().min(1),
  redirectTo: z.string().optional(),
});

export type SignInState = { error?: "invalidInput" | "invalidCredentials" };

// Only allow same-site relative paths to prevent open redirects.
function safeRedirectPath(value: string | undefined) {
  if (!value || !value.startsWith("/") || value.startsWith("//")) return "/tableau-de-bord";
  return value.replace(/^\/fr(?=\/|$)/, "") || "/tableau-de-bord";
}

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const parsed = signInSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    redirectTo: formData.get("redirectTo") ?? undefined,
  });
  if (!parsed.success) return { error: "invalidInput" };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
  });
  if (error) return { error: "invalidCredentials" };

  const locale = await getLocale();
  redirect({ href: safeRedirectPath(parsed.data.redirectTo), locale });
  return {};
}
