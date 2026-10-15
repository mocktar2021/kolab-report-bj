"use client";

import { useActionState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle } from "lucide-react";
import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BillingDetailsField } from "@/lib/billing/details";
import { saveBillingDetails, type BillingDetailsState } from "./actions";

export type BillingDetailsValues = Record<BillingDetailsField, string | null>;

const FIELDS: {
  name: BillingDetailsField;
  autoComplete: string;
  type: "text" | "email";
  maxLength: number;
  help?: "legalNameHelp" | "taxIdHelp" | "billingEmailHelp";
}[] = [
  { name: "legalName", autoComplete: "organization", type: "text", maxLength: 200, help: "legalNameHelp" },
  { name: "address", autoComplete: "street-address", type: "text", maxLength: 500 },
  { name: "taxId", autoComplete: "off", type: "text", maxLength: 40, help: "taxIdHelp" },
  { name: "billingEmail", autoComplete: "email", type: "email", maxLength: 254, help: "billingEmailHelp" },
];

/**
 * The buyer details printed on the next receipts. People who can buy edit
 * them; the other billing readers see them read-only.
 */
export function BillingDetailsForm({
  organizationId,
  values,
  canEdit,
}: {
  organizationId: string;
  values: BillingDetailsValues;
  canEdit: boolean;
}) {
  const t = useTranslations("Billing.page.details");
  const [state, formAction, pending] = useActionState<BillingDetailsState, FormData>(saveBillingDetails, {
    status: "idle",
  });
  const fieldErrors = state.status === "error" ? (state.fieldErrors ?? {}) : {};
  const formError = state.status === "error" ? state.formError : undefined;

  if (!canEdit) {
    return (
      <>
        <dl className="mt-4 grid gap-x-6 gap-y-3 text-sm sm:grid-cols-2">
          {FIELDS.map((field) => (
            <div key={field.name}>
              <dt className="text-muted-foreground">{t(field.name)}</dt>
              <dd className="mt-0.5 break-words text-foreground">{values[field.name] ?? t("empty")}</dd>
            </div>
          ))}
        </dl>
        <p className="mt-4 text-xs text-muted-foreground">{t("readOnly")}</p>
      </>
    );
  }

  return (
    <form
      action={formAction}
      noValidate
      className="mt-4"
      onSubmit={(event) => {
        // The button stays focusable while the details are saved (aria-disabled).
        if (pending) event.preventDefault();
      }}
    >
      <input type="hidden" name="organizationId" value={organizationId} />
      <div className="grid gap-4 sm:grid-cols-2">
        {FIELDS.map((field) => {
          const id = `billing-${field.name}`;
          const error = fieldErrors[field.name];
          const describedBy = [error ? `${id}-error` : null, field.help ? `${id}-help` : null]
            .filter(Boolean)
            .join(" ");
          return (
            <div key={field.name} className="space-y-2">
              <Label htmlFor={id}>{t(field.name)}</Label>
              <Input
                id={id}
                name={field.name}
                type={field.type}
                defaultValue={values[field.name] ?? ""}
                maxLength={field.maxLength}
                autoComplete={field.autoComplete}
                aria-invalid={Boolean(error)}
                aria-describedby={describedBy || undefined}
              />
              {field.help ? (
                <p id={`${id}-help`} className="text-xs text-muted-foreground">
                  {t(field.help)}
                </p>
              ) : null}
              <FieldError id={`${id}-error`} message={error && t(`errors.${error}`)} />
            </div>
          );
        })}
      </div>
      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Button
          type="submit"
          shape="pill"
          aria-disabled={pending || undefined}
          className="aria-disabled:cursor-wait aria-disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : null}
          {pending ? t("saving") : t("save")}
        </Button>
        {/* Always in the page, so screen readers announce the result. */}
        <p role="status" className={state.status === "saved" ? "text-sm text-foreground" : "sr-only"}>
          {state.status === "saved" ? t("saved") : null}
        </p>
      </div>
      {formError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {t(`errors.${formError}`)}
        </p>
      ) : null}
    </form>
  );
}
