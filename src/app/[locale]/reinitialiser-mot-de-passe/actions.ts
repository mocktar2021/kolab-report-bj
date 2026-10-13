"use server";

import { z } from "zod";
import { getLocale } from "next-intl/server";
import { redirect } from "@/i18n/navigation";
import { authErrorKey, type AuthErrorKey } from "@/lib/auth/errors";
import { fieldErrors, newPasswordSchema, type FieldErrorKey } from "@/lib/auth/schemas";
import { createClient } from "@/lib/supabase/server";

const resetSchema = z
  .object({ password: newPasswordSchema, confirmPassword: z.string() })
  .refine((v) => v.password === v.confirmPassword, {
    message: "passwordMismatch",
    path: ["confirmPassword"],
  });

type Field = "password" | "confirmPassword";

export type ResetState =
  | { status: "idle" }
  | { status: "error"; fieldErrors?: Partial<Record<Field, FieldErrorKey>>; formError?: AuthErrorKey };

export async function updatePassword(_prev: ResetState, formData: FormData): Promise<ResetState> {
  const parsed = resetSchema.safeParse({
    password: String(formData.get("password") ?? ""),
    confirmPassword: String(formData.get("confirmPassword") ?? ""),
  });
  if (!parsed.success) {
    return { status: "error", fieldErrors: fieldErrors<Field>(parsed.error) };
  }

  // The session comes from the recovery link handled by /fr/auth/callback.
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { status: "error", formError: "sessionExpired" };

  const { error } = await supabase.auth.updateUser({ password: parsed.data.password });
  if (error) return { status: "error", formError: authErrorKey(error) };

  const locale = await getLocale();
  redirect({ href: "/tableau-de-bord", locale });
  return { status: "idle" };
}
