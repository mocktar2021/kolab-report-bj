"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateName, type NameState } from "./actions";

const STATUS_ID = "account-name-status";

/** The name other members see, from profiles.full_name. */
export function NameForm({ fullName }: { fullName: string }) {
  const t = useTranslations("Account.profile");
  const [state, formAction, pending] = useActionState<NameState, FormData>(updateName, { status: "idle" });
  const failed = state.status === "error";

  return (
    <>
      <form action={formAction} noValidate className="mt-5 flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1 space-y-2">
          <Label htmlFor="account-name">{t("name")}</Label>
          <Input
            id="account-name"
            name="fullName"
            defaultValue={fullName}
            autoComplete="name"
            maxLength={120}
            required
            aria-invalid={failed}
            aria-describedby={STATUS_ID}
          />
        </div>
        <Button type="submit" shape="pill" className="h-10 shrink-0" disabled={pending}>
          {t("save")}
        </Button>
      </form>
      <p id={STATUS_ID} role="status" aria-live="polite" className="mt-2 text-sm">
        {failed ? (
          <span className="text-destructive">{t(`errors.${state.error}`)}</span>
        ) : state.status === "saved" ? (
          <span className="inline-flex items-center gap-1.5 text-muted-foreground">
            <Check className="size-4" aria-hidden="true" />
            {t("saved")}
          </span>
        ) : (
          <span className="text-muted-foreground">{t("nameHint")}</span>
        )}
      </p>
    </>
  );
}
