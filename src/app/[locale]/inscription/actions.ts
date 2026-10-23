"use server";

import { z } from "zod";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { publicEnv } from "@/lib/env";
import { readCaptchaToken } from "@/lib/auth/captcha";
import { authErrorKey, type AuthErrorKey } from "@/lib/auth/errors";
import { emailSchema, fieldErrors, newPasswordSchema, type FieldErrorKey } from "@/lib/auth/schemas";
import { isPrelaunch } from "@/lib/launch";
import { createClient } from "@/lib/supabase/server";

const signUpSchema = z.object({
  fullName: z.string().trim().min(1, "nameRequired").max(120, "nameRequired"),
  email: emailSchema,
  password: newPasswordSchema,
});

type Field = keyof z.infer<typeof signUpSchema> | "captcha";

export type SignUpState =
  | { status: "idle" }
  | {
      status: "error";
      fieldErrors?: Partial<Record<Field, FieldErrorKey>>;
      formError?: AuthErrorKey;
      values: { fullName: string; email: string };
    }
  | { status: "checkEmail"; email: string };

export async function signUp(_prev: SignUpState, formData: FormData): Promise<SignUpState> {
  const raw = {
    fullName: String(formData.get("fullName") ?? ""),
    email: String(formData.get("email") ?? ""),
    password: String(formData.get("password") ?? ""),
  };
  const values = { fullName: raw.fullName, email: raw.email };

  // Sign-up opens at the launch (KRB-239). The page hides the form until then;
  // this covers a form left open or a direct post.
  if (isPrelaunch()) return { status: "error", formError: "signUpClosed", values };

  // Field errors and a missing captcha come back together, so one more try is enough.
  const parsed = signUpSchema.safeParse(raw);
  const captcha = readCaptchaToken(formData);
  if (!parsed.success || !captcha.ok) {
    return {
      status: "error",
      fieldErrors: {
        ...(parsed.success ? {} : fieldErrors<Field>(parsed.error)),
        ...(captcha.ok ? {} : { captcha: "captchaRequired" }),
      },
      values,
    };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/fr/auth/callback?next=/fr/tableau-de-bord`,
      captchaToken: captcha.token,
    },
  });

  if (error) {
    // Same answer as a new sign-up, so the form never reveals which e-mails have an account.
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      return { status: "checkEmail", email: parsed.data.email };
    }
    const key = authErrorKey(error);
    if (key === "captchaRequired") {
      return { status: "error", fieldErrors: { captcha: key }, values };
    }
    return { status: "error", formError: key, values };
  }

  // E-mail confirmation turned off: the user is signed in right away.
  if (data.session) {
    const locale = await getLocale();
    redirect({ href: "/tableau-de-bord", locale });
  }

  return { status: "checkEmail", email: parsed.data.email };
}
