"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { ArrowLeft, ArrowRight, Check } from "lucide-react";
import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import {
  organizationNameSchema,
  reportTitleSchema,
  workspaceNameSchema,
  type WorkspaceFieldErrorKey,
} from "@/lib/workspaces/schemas";
import { createWorkspace, type CreateWorkspaceState, type WizardField } from "./actions";

const STEPS = [
  { key: "organization", field: "organizationName", schema: organizationNameSchema, maxLength: 120 },
  { key: "workspace", field: "workspaceName", schema: workspaceNameSchema, maxLength: 120 },
  { key: "report", field: "reportTitle", schema: reportTitleSchema, maxLength: 200 },
] as const;

type Values = Record<WizardField, string>;

/**
 * Three steps (organization, workspace, first report). Each step is checked
 * in the browser before moving on; the server checks everything again.
 */
export function WorkspaceWizard() {
  const t = useTranslations("WorkspaceWizard");
  const tWorkspaces = useTranslations("Workspaces");
  const [state, formAction, pending] = useActionState<CreateWorkspaceState, FormData>(createWorkspace, {
    status: "idle",
  });
  const [stepIndex, setStepIndex] = useState(0);
  const [values, setValues] = useState<Values>({ organizationName: "", workspaceName: "", reportTitle: "" });
  const [localError, setLocalError] = useState<WorkspaceFieldErrorKey | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const firstRender = useRef(true);

  const step = STEPS[stepIndex] ?? STEPS[0];
  const serverErrors = state.status === "error" ? (state.fieldErrors ?? {}) : {};

  // A field rejected by the server sends the user back to its step.
  useEffect(() => {
    if (state.status !== "error" || !state.fieldErrors) return;
    const index = STEPS.findIndex((item) => state.fieldErrors?.[item.field]);
    if (index >= 0) setStepIndex(index);
  }, [state]);

  // Move focus to the field of the new step, but not on the first render.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    inputRef.current?.focus();
  }, [stepIndex]);

  function goNext() {
    const result = step.schema.safeParse(values[step.field]);
    if (!result.success) {
      setLocalError(result.error.issues[0]?.message as WorkspaceFieldErrorKey);
      inputRef.current?.focus();
      return;
    }
    setLocalError(null);
    setStepIndex((index) => Math.min(index + 1, STEPS.length - 1));
  }

  function goBack() {
    setLocalError(null);
    setStepIndex((index) => Math.max(index - 1, 0));
  }

  const isLast = stepIndex === STEPS.length - 1;
  const fieldError = localError ?? serverErrors[step.field];
  const errorId = `${step.field}-error`;

  return (
    <div className="mt-8">
      <ol aria-label={t("stepsLabel")} className="grid grid-cols-3 gap-2">
        {STEPS.map((item, index) => {
          const done = index < stepIndex;
          const active = index === stepIndex;
          return (
            <li key={item.key} aria-current={active ? "step" : undefined} className="min-w-0">
              <span
                aria-hidden="true"
                className={cn(
                  "block h-1 rounded-full transition-colors duration-300",
                  done || active ? "bg-highlight" : "bg-border",
                )}
              />
              <span
                className={cn(
                  "mt-2 flex items-center gap-1.5 truncate text-xs font-medium",
                  active ? "text-foreground" : "text-muted-foreground",
                )}
              >
                {done ? <Check className="size-3.5 text-highlight" aria-hidden="true" /> : null}
                {t(`steps.${item.key}.label`)}
              </span>
            </li>
          );
        })}
      </ol>

      <form
        action={formAction}
        noValidate
        className="surface-card mt-6 rounded-2xl border p-5 shadow-sm sm:p-6"
        onSubmit={(event) => {
          // Enter on steps 1 and 2 moves to the next step instead of submitting.
          if (!isLast) {
            event.preventDefault();
            goNext();
            return;
          }
          const result = step.schema.safeParse(values[step.field]);
          if (!result.success) {
            event.preventDefault();
            setLocalError(result.error.issues[0]?.message as WorkspaceFieldErrorKey);
            inputRef.current?.focus();
          }
        }}
      >
        <p className="text-xs font-medium text-muted-foreground">
          {t("stepCounter", { current: stepIndex + 1, total: STEPS.length })}
        </p>
        <h2 className="mt-1 text-h3 text-foreground">{t(`steps.${step.key}.title`)}</h2>
        <p className="mt-1 text-sm text-muted-foreground">{t(`steps.${step.key}.description`)}</p>

        <div className="mt-6 space-y-2">
          <Label htmlFor={step.field}>{t(`steps.${step.key}.field`)}</Label>
          <Input
            key={step.field}
            ref={inputRef}
            id={step.field}
            value={values[step.field]}
            onChange={(event) => {
              const value = event.target.value;
              setValues((previous) => ({ ...previous, [step.field]: value }));
              if (localError) setLocalError(null);
            }}
            placeholder={t(`steps.${step.key}.placeholder`)}
            maxLength={step.maxLength}
            autoComplete="off"
            required
            aria-invalid={Boolean(fieldError)}
            aria-describedby={fieldError ? errorId : undefined}
          />
          <FieldError id={errorId} message={fieldError && tWorkspaces(`fieldErrors.${fieldError}`)} />
        </div>

        {isLast ? (
          <dl className="mt-6 grid gap-3 rounded-xl bg-muted/50 p-4 text-sm sm:grid-cols-2">
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("steps.organization.field")}</dt>
              <dd className="truncate font-medium">{values.organizationName.trim()}</dd>
            </div>
            <div className="min-w-0">
              <dt className="text-xs text-muted-foreground">{t("steps.workspace.field")}</dt>
              <dd className="truncate font-medium">{values.workspaceName.trim()}</dd>
            </div>
            <p className="text-xs text-muted-foreground sm:col-span-2">{t("ownerNote")}</p>
          </dl>
        ) : null}

        {/* The visible input has no name: every value is posted from here. */}
        {STEPS.map((item) => (
          <input key={item.field} type="hidden" name={item.field} value={values[item.field]} />
        ))}

        {state.status === "error" && state.formError ? (
          <p role="alert" className="mt-4 text-sm text-destructive">
            {tWorkspaces(`errors.${state.formError}`)}
          </p>
        ) : null}

        <div className="mt-6 flex items-center justify-between gap-3">
          {stepIndex > 0 ? (
            <Button type="button" variant="ghost" onClick={goBack} disabled={pending}>
              <ArrowLeft aria-hidden="true" />
              {t("back")}
            </Button>
          ) : (
            <span />
          )}
          <Button type="submit" shape="pill" disabled={pending}>
            {isLast ? (pending ? t("submitting") : t("submit")) : t("next")}
            {isLast ? null : <ArrowRight aria-hidden="true" />}
          </Button>
        </div>
      </form>
    </div>
  );
}
