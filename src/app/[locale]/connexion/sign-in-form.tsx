"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { PasswordInput } from "@/components/auth/password-input";
import { useFocusOnError } from "@/components/auth/use-focus-on-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";
import { signIn, type SignInState } from "./actions";

const ERROR_ID = "sign-in-error";

// Rough shape check, only to point the error at the right field. The server
// action does the real check; zod stays out of this page's bundle.
const EMAIL_SHAPE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function SignInForm({ next }: { next?: string }) {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signIn, {});

  const message =
    state.error === "rateLimited" || state.error === "emailNotConfirmed"
      ? t(`errors.${state.error}`)
      : state.error
        ? t(state.error)
        : null;

  // Wrong credentials point at both fields: the message does not say which one
  // is wrong. A bad input points at the address when it is not one, else at the
  // missing password.
  const emailLooksValid = EMAIL_SHAPE.test((state.email ?? "").trim());
  const emailInvalid =
    state.error === "invalidCredentials" || (state.error === "invalidInput" && !emailLooksValid);
  const passwordInvalid =
    state.error === "invalidCredentials" || (state.error === "invalidInput" && emailLooksValid);
  // The address is kept and the password field is emptied: the password is what to type again.
  const formRef = useFocusOnError(state, Boolean(state.error), "password");

  return (
    <form ref={formRef} action={formAction} className="space-y-4" noValidate>
      {next ? <input type="hidden" name="next" value={next} /> : null}
      <div className="space-y-2">
        <Label htmlFor="email">{t("email")}</Label>
        <Input
          id="email"
          name="email"
          type="email"
          autoComplete="email"
          defaultValue={state.email}
          required
          aria-invalid={emailInvalid}
          aria-describedby={emailInvalid ? ERROR_ID : undefined}
        />
      </div>
      <div className="space-y-2">
        <div className="flex items-baseline justify-between gap-3">
          <Label htmlFor="password">{t("password")}</Label>
          <Link
            href="/mot-de-passe-oublie"
            className="rounded text-sm text-muted-foreground underline-offset-4 hover:text-foreground hover:underline"
          >
            {t("forgotPassword")}
          </Link>
        </div>
        <PasswordInput
          id="password"
          name="password"
          autoComplete="current-password"
          required
          aria-invalid={passwordInvalid}
          aria-describedby={passwordInvalid ? ERROR_ID : undefined}
        />
      </div>
      {message ? (
        <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <Button type="submit" shape="pill" className="h-10 w-full" disabled={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
