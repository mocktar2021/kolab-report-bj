"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { PasswordInput } from "@/components/auth/password-input";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Link } from "@/i18n/navigation";
import { signIn, type SignInState } from "./actions";

export function SignInForm({ next }: { next?: string }) {
  const t = useTranslations("Auth");
  const [state, formAction, pending] = useActionState<SignInState, FormData>(signIn, {});

  const message =
    state.error === "rateLimited" || state.error === "emailNotConfirmed"
      ? t(`errors.${state.error}`)
      : state.error
        ? t(state.error)
        : null;

  return (
    <form action={formAction} className="space-y-4" noValidate>
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
        <PasswordInput id="password" name="password" autoComplete="current-password" required />
      </div>
      {message ? (
        <p role="alert" className="text-sm text-destructive">
          {message}
        </p>
      ) : null}
      <Button type="submit" shape="pill" className="h-10 w-full" disabled={pending}>
        {t("submit")}
      </Button>
    </form>
  );
}
