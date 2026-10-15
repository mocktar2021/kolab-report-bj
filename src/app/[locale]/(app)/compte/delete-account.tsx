"use client";

import { useActionState, useState } from "react";
import { useTranslations } from "next-intl";
import { PasswordInput } from "@/components/auth/password-input";
import { TurnstileField } from "@/components/auth/turnstile-field";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { turnstileSiteKey } from "@/lib/auth/captcha";
import { deleteAccount, type DeleteAccountState } from "./actions";

const ERROR_ID = "delete-account-error";

/**
 * "Supprimer mon compte", shown only when nothing blocks the deletion. The
 * dialog asks for the account's e-mail address and the current password; the
 * server checks both. A successful deletion signs out and leaves the app.
 */
export function DeleteAccount() {
  const t = useTranslations("Account.delete");
  const [open, setOpen] = useState(false);
  const [state, formAction, pending] = useActionState<DeleteAccountState, FormData>(deleteAccount, {
    status: "idle",
  });
  const siteKey = turnstileSiteKey();
  const error = state.status === "error" ? state.error : null;
  const emailInvalid = error === "invalidInput" || error === "emailMismatch";
  const passwordInvalid = error === "invalidInput" || error === "wrongPassword";

  return (
    <>
      <Button type="button" variant="destructive" shape="pill" className="mt-5" onClick={() => setOpen(true)}>
        {t("open")}
      </Button>
      {/* Stays open while the deletion runs, so the answer has somewhere to show. */}
      <Dialog open={open} onOpenChange={(next) => (pending ? undefined : setOpen(next))}>
        <DialogContent className="p-6">
          <DialogTitle>{t("dialogTitle")}</DialogTitle>
          <DialogDescription className="mt-2">{t("dialogDescription")}</DialogDescription>
          <form action={formAction} noValidate className="mt-5 space-y-4">
            <div className="space-y-2">
              <Label htmlFor="delete-email">{t("email")}</Label>
              <Input
                id="delete-email"
                name="email"
                type="email"
                autoComplete="off"
                defaultValue={state.status === "error" ? state.email : undefined}
                required
                aria-invalid={emailInvalid}
                aria-describedby={emailInvalid ? ERROR_ID : undefined}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="delete-password">{t("password")}</Label>
              <PasswordInput
                id="delete-password"
                name="password"
                autoComplete="current-password"
                required
                aria-invalid={passwordInvalid}
                aria-describedby={passwordInvalid ? ERROR_ID : undefined}
              />
            </div>
            {siteKey ? (
              <TurnstileField
                siteKey={siteKey}
                action="account-deletion"
                resetKey={state}
                error={error === "captchaRequired" ? t("errors.captchaRequired") : undefined}
              />
            ) : null}
            {error && error !== "captchaRequired" ? (
              <p id={ERROR_ID} role="alert" className="text-sm text-destructive">
                {t(`errors.${error}`)}
              </p>
            ) : null}
            <div className="flex flex-col-reverse gap-2 pt-2 sm:flex-row sm:justify-end">
              <DialogClose asChild>
                <Button type="button" variant="ghost" disabled={pending}>
                  {t("cancel")}
                </Button>
              </DialogClose>
              <Button type="submit" variant="destructive" disabled={pending}>
                {pending ? t("deleting") : t("confirm")}
              </Button>
            </div>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
