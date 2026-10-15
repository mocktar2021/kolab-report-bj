"use server";

import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { readCaptchaToken } from "@/lib/auth/captcha";
import { authErrorKey, type AuthErrorKey } from "@/lib/auth/errors";
import { emailSchema, fieldErrors, type FieldErrorKey } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";

const forgotSchema = z.object({ email: emailSchema });

type Field = "email" | "captcha";

export type ForgotState =
  | { status: "idle" }
  | {
      status: "error";
      fieldErrors?: Partial<Record<Field, FieldErrorKey>>;
      formError?: AuthErrorKey;
      email: string;
    }
  | { status: "sent"; email: string };

export async function requestPasswordReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "");
  const parsed = forgotSchema.safeParse({ email });
  const captcha = readCaptchaToken(formData);
  if (!parsed.success || !captcha.ok) {
    return {
      status: "error",
      fieldErrors: {
        ...(parsed.success ? {} : fieldErrors<Field>(parsed.error)),
        ...(captcha.ok ? {} : { captcha: "captchaRequired" }),
      },
      email,
    };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/fr/auth/callback?next=/fr/reinitialiser-mot-de-passe`,
    captchaToken: captcha.token,
  });

  // Only rate limits and a refused captcha are shown, neither depends on the
  // address. Any other outcome gets the same message, so the page never
  // reveals whether an account exists.
  const key = error ? authErrorKey(error) : null;
  if (key === "rateLimited") return { status: "error", formError: key, email };
  if (key === "captchaRequired") return { status: "error", fieldErrors: { captcha: key }, email };
  return { status: "sent", email: parsed.data.email };
}
