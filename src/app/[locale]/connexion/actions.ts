"use server";

import { z } from "zod";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { readCaptchaToken } from "@/lib/auth/captcha";
import { authErrorKey } from "@/lib/auth/errors";
import { acceptPendingInvitations } from "@/lib/invitations/accept";
import { safeNextPath, withoutLocale } from "@/lib/auth/redirect";
import { createClient } from "@/lib/supabase/server";

const signInSchema = z.object({
  email: z.string().trim().toLowerCase().email(),
  password: z.string().min(1),
  next: z.string().optional(),
});

export type SignInState = {
  error?: "invalidInput" | "invalidCredentials" | "rateLimited" | "emailNotConfirmed" | "captchaRequired";
  email?: string;
};

export async function signIn(_prev: SignInState, formData: FormData): Promise<SignInState> {
  const email = String(formData.get("email") ?? "");
  const parsed = signInSchema.safeParse({
    email,
    password: formData.get("password"),
    next: formData.get("next") ?? undefined,
  });
  if (!parsed.success) return { error: "invalidInput", email };
  // Supabase asks for a captcha on password sign-in too, once it is on.
  const captcha = readCaptchaToken(formData);
  if (!captcha.ok) return { error: "captchaRequired", email };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: parsed.data.email,
    password: parsed.data.password,
    options: { captchaToken: captcha.token },
  });
  if (error) {
    const key = authErrorKey(error);
    // One generic message for wrong e-mail or wrong password.
    if (key === "rateLimited" || key === "emailNotConfirmed" || key === "captchaRequired") {
      return { error: key, email };
    }
    return { error: "invalidCredentials", email };
  }

  await acceptPendingInvitations(supabase);

  const next = safeNextPath(parsed.data.next);
  const locale = await getLocale();
  redirect({ href: next ? withoutLocale(next) : "/tableau-de-bord", locale });
  return {};
}
