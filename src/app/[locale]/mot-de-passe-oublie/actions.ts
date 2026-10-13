"use server";

import { z } from "zod";
import { publicEnv } from "@/lib/env";
import { authErrorKey, type AuthErrorKey } from "@/lib/auth/errors";
import { emailSchema, fieldErrors, type FieldErrorKey } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";

const forgotSchema = z.object({ email: emailSchema });

export type ForgotState =
  | { status: "idle" }
  | { status: "error"; fieldErrors?: { email?: FieldErrorKey }; formError?: AuthErrorKey; email: string }
  | { status: "sent"; email: string };

export async function requestPasswordReset(_prev: ForgotState, formData: FormData): Promise<ForgotState> {
  const email = String(formData.get("email") ?? "");
  const parsed = forgotSchema.safeParse({ email });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors<"email">(parsed.error), email };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.resetPasswordForEmail(parsed.data.email, {
    redirectTo: `${publicEnv.NEXT_PUBLIC_APP_URL}/fr/auth/callback?next=/fr/reinitialiser-mot-de-passe`,
  });

  // Only rate limits are shown. Any other outcome gets the same message,
  // so the page never reveals whether an account exists.
  if (error && authErrorKey(error) === "rateLimited") {
    return { status: "error", formError: "rateLimited", email };
  }
  return { status: "sent", email: parsed.data.email };
}
