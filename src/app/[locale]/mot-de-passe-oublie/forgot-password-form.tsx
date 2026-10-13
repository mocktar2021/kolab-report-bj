"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { requestPasswordReset, type ForgotState } from "./actions";

export function ForgotPasswordForm() {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState<ForgotState, FormData>(requestPasswordReset, {
    status: "idle",
  });

  if (state.status === "sent") {
    return (
      <div role="status" className="space-y-3">
        <MailCheck aria-hidden="true" className="size-6 text-primary" />
        <p className="text-sm text-muted-foreground">{t("forgotSent", { email: state.email })}</p>
        <p className="text-sm text-muted-foreground">{t("checkEmailSpam")}</p>
      </div>
    );
  }

  const emailError = state.status === "error" ? state.fieldErrors?.email : undefined;

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.status === "error" ? state.email : ""}
          required
          aria-invalid={Boolean(emailError)}
          aria-describedby={emailError ? "email-error" : undefined}
        />
        <FieldError id="email-error" message={emailError && t(`errors.${emailError}`)} />
      </div>
      {state.status === "error" && state.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${state.formError}`)}
        </p>
      ) : null}
      <Button type="submit" shape="pill" className="h-10 w-full" disabled={pending}>
        {t("forgotSubmit")}
      </Button>
    </form>
  );
}
