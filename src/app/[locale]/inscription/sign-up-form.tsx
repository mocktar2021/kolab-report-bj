"use client";

import { useActionState } from "react";
import { MailCheck } from "lucide-react";
import { useTranslations } from "next-intl";
import { FieldError } from "@/components/auth/field-error";
import { PasswordInput } from "@/components/auth/password-input";
import { TurnstileField } from "@/components/auth/turnstile-field";
import { useFocusOnError, useFocusWhenShown } from "@/components/auth/use-focus-on-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";
import { turnstileSiteKey } from "@/lib/auth/captcha";
import { PASSWORD_MIN_LENGTH } from "@/lib/auth/password-policy";
import { signUp, type SignUpState } from "./actions";

export function SignUpForm({ defaultEmail = "" }: { defaultEmail?: string }) {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState<SignUpState, FormData>(signUp, { status: "idle" });
  const formRef = useFocusOnError(state, state.status === "error");
  const doneRef = useFocusWhenShown<HTMLDivElement>(state.status === "checkEmail");
  const siteKey = turnstileSiteKey();

  if (state.status === "checkEmail") {
    return (
      <div ref={doneRef} tabIndex={-1} role="status" className="space-y-3 outline-none">
        <MailCheck aria-hidden="true" className="size-6 text-primary" />
        <p className="font-medium">{t("checkEmailTitle")}</p>
        <p className="text-sm text-muted-foreground">{t("checkEmailBody", { email: state.email })}</p>
        <p className="text-sm text-muted-foreground">{t("checkEmailSpam")}</p>
      </div>
    );
  }

  const errors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const values = state.status === "error" ? state.values : { fullName: "", email: defaultEmail };

  return (
    <form ref={formRef} action={formAction} className="space-y-4" noValidate>
      <div className="space-y-2">
        <Label htmlFor="fullName">{t("fullName")}</Label>
        <Input
          id="fullName"
          name="fullName"
          autoComplete="name"
          defaultValue={values.fullName}
          required
          aria-invalid={Boolean(errors.fullName)}
          aria-describedby={errors.fullName ? "fullName-error" : undefined}
        />
        <FieldError id="fullName-error" message={errors.fullName && t(`errors.${errors.fullName}`)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={values.email}
          required
          aria-invalid={Boolean(errors.email)}
          aria-describedby={errors.email ? "email-error" : undefined}
        />
        <FieldError id="email-error" message={errors.email && t(`errors.${errors.email}`)} />
      </div>
      <div className="space-y-2">
        <Label htmlFor="password">{t("password")}</Label>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="new-password"
          minLength={PASSWORD_MIN_LENGTH}
          required
          aria-invalid={Boolean(errors.password)}
          aria-describedby={errors.password ? "password-error" : "password-hint"}
        />
        {errors.password ? (
          <FieldError
            id="password-error"
            message={t(`errors.${errors.password}`, { min: PASSWORD_MIN_LENGTH })}
          />
        ) : (
          <p id="password-hint" className="text-sm text-muted-foreground">
            {t("passwordHint", { min: PASSWORD_MIN_LENGTH })}
          </p>
        )}
      </div>
      {siteKey ? (
        <TurnstileField
          siteKey={siteKey}
          action="sign-up"
          resetKey={state}
          error={errors.captcha && t(`errors.${errors.captcha}`)}
        />
      ) : null}
      {state.status === "error" && state.formError ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${state.formError}`)}
        </p>
      ) : null}
      <Button type="submit" shape="pill" className="h-10 w-full" disabled={pending}>
        {t("signUpSubmit")}
      </Button>
      <p className="text-xs text-muted-foreground">
        {t.rich("legalConsent", {
          cgu: (chunks) => (
            <Link href="/cgu" prefetch={false} className="underline underline-offset-4">
              {chunks}
            </Link>
          ),
          cgv: (chunks) => (
            <Link href="/cgv" prefetch={false} className="underline underline-offset-4">
              {chunks}
            </Link>
          ),
          privacy: (chunks) => (
            <Link href="/confidentialite" prefetch={false} className="underline underline-offset-4">
              {chunks}
            </Link>
          ),
        })}
      </p>
    </form>
  );
}
