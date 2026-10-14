"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { FieldError } from "@/components/auth/field-error";
import { PasswordInput } from "@/components/auth/password-input";
import { useFocusOnError } from "@/components/auth/use-focus-on-error";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { updatePassword, type ResetState } from "./actions";

export function ResetPasswordForm({ email }: { email: string }) {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState<ResetState, FormData>(updatePassword, {
    status: "idle",
  });
  const formRef = useFocusOnError(state, state.status === "error");
  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  return (
    <form ref={formRef} action={formAction} className="space-y-4" noValidate>
      {/* Lets password managers save the new password against the right account. */}
      <input type="email" name="username" autoComplete="username" value={email} readOnly hidden />
      <div className="space-y-2">
        <Label htmlFor="password">{t("newPassword")}</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={8}
          required
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? "password-error" : "password-hint"}
        />
        {errors.password ? (
          <FieldError id="password-error" message={t(`errors.${errors.password}`)} />
        ) : (
          <p id="password-hint" className="text-sm text-muted-foreground">
            {t("passwordHint")}
          </p>
        )}
      </div>
      <div className="space-y-2">
        <Label htmlFor="confirmPassword">{t("confirmPassword")}</Label>
        <PasswordInput
          id="confirmPassword"
          name="confirmPassword"
          autoComplete="new-password"
          required
          aria-invalid={Boolean(errors.confirmPassword)}
          aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
        />
        <FieldError
          id="confirmPassword-error"
          message={errors.confirmPassword && t(`errors.${errors.confirmPassword}`)}
        />
      </div>
      {state.status === "error" && state.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${state.formError}`)}
        </p>
      ) : null}
      <Button type="submit" shape="pill" className="h-10 w-full" disabled={pending}>
        {t("resetSubmit")}
      </Button>
    </form>
  );
}
