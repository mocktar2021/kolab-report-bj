"use server";

import { z } from "zod";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { publicEnv } from "@/lib/env";
import { authErrorKey, type AuthErrorKey } from "@/lib/auth/errors";
import { emailSchema, fieldErrors, newPasswordSchema, type FieldErrorKey } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";

const signUpSchema = z.object({
  fullName: z.string().trim().min(1, "nameRequired").max(120, "nameRequired"),
  email: emailSchema,
  password: newPasswordSchema,
});

type Field = keyof z.infer<typeof signUpSchema>;

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

  const parsed = signUpSchema.safeParse(raw);
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors<Field>(parsed.error), values };
  }

  const supabase = await createClient();
  const { data, error } = await supabase.auth.signUp({
    email: parsed.data.email,
    password: parsed.data.password,
    options: {
      data: { full_name: parsed.data.fullName },
      emailRedirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/fr/auth/callback?next=/fr/tableau-de-bord`,
    },
  });

  if (error) {
    // Same answer as a new sign-up, so the form never reveals which e-mails have an account.
    if (error.code === "user_already_exists" || error.code === "email_exists") {
      return { status: "checkEmail", email: parsed.data.email };
    }
    return { status: "error", formError: authErrorKey(error), values };
  }

  // E-mail confirmation turned off: the user is signed in right away.
  if (data.session) {
    const locale = await getLocale();
    redirect({ href: "/tableau-de-bord", locale });
  }

  return { status: "checkEmail", email: parsed.data.email };
}
