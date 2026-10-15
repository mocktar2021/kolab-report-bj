"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { LoaderCircle, Plus } from "lucide-react";
import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { WorkspaceFieldErrorKey } from "@/lib/workspaces/schemas";
import { createReport, type CreateReportState } from "./actions";

const TITLE_ID = "new-report-title";
const TITLE_ERROR_ID = "new-report-title-error";

/**
 * Same limits as reportTitleSchema, without pulling zod into the dashboard
 * (docs/performance.md). The server checks the title again.
 */
function titleError(title: string): WorkspaceFieldErrorKey | null {
  const length = title.trim().length;
  return length >= 2 && length <= 200 ? null : "titleLength";
}

/**
 * "Nouveau rapport" on the dashboard, for owners and admins: a dialog with
 * the title, then the new report opens, ready for its sections. Closing the
 * dialog gives the focus back to the button.
 */
export function NewReportDialog({
  workspaceId,
  workspaceName,
}: {
  workspaceId: string;
  workspaceName: string;
}) {
  const t = useTranslations("Dashboard.reports.create");

  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="sm" variant="outline" shape="pill">
          <Plus aria-hidden="true" />
          {t("button")}
        </Button>
      </DialogTrigger>
      <DialogContent className="p-6">
        <DialogTitle>{t("title")}</DialogTitle>
        <DialogDescription className="mt-2">
          {t("description", { workspace: workspaceName })}
        </DialogDescription>
        {/* Mounted with the dialog, so each opening starts empty. */}
        <NewReportForm workspaceId={workspaceId} />
      </DialogContent>
    </Dialog>
  );
}

function NewReportForm({ workspaceId }: { workspaceId: string }) {
  const t = useTranslations("Dashboard.reports.create");
  const tWorkspaces = useTranslations("Workspaces");
  const [state, formAction, pending] = useActionState<CreateReportState, FormData>(
    (_prev, formData) => createReport(workspaceId, String(formData.get("title") ?? "")),
    { status: "idle" },
  );
  // Controlled, so the title stays in the field when the server refuses it.
  const [title, setTitle] = useState("");
  const [localError, setLocalError] = useState<WorkspaceFieldErrorKey | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const serverError = state.status === "error" ? state.fieldErrors?.title : undefined;
  const fieldError = localError ?? serverError;
  const formError = state.status === "error" ? state.formError : undefined;
  // The plan's numbers when billing refused the report (limit reached, read-only).
  const formErrorValues = state.status === "error" ? state.formErrorValues : undefined;

  // A title refused by the server: back to the field, which carries the message.
  useEffect(() => {
    if (state.status === "error" && state.fieldErrors?.title) inputRef.current?.focus();
  }, [state]);

  return (
    <form
      action={formAction}
      noValidate
      className="mt-6"
      onSubmit={(event) => {
        // The button stays focusable while the report is created (aria-disabled).
        if (pending) {
          event.preventDefault();
          return;
        }
        const error = titleError(title);
        if (error) {
          event.preventDefault();
          setLocalError(error);
          inputRef.current?.focus();
        }
      }}
    >
      <div className="space-y-2">
        <Label htmlFor={TITLE_ID}>{t("field")}</Label>
        <Input
          ref={inputRef}
          id={TITLE_ID}
          name="title"
          value={title}
          onChange={(event) => {
            setTitle(event.target.value);
            if (localError) setLocalError(null);
          }}
          placeholder={t("placeholder")}
          maxLength={200}
          autoComplete="off"
          required
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? TITLE_ERROR_ID : undefined}
        />
        <FieldError id={TITLE_ERROR_ID} message={fieldError && tWorkspaces(`fieldErrors.${fieldError}`)} />
      </div>

      {formError ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {tWorkspaces(`errors.${formError}`, formErrorValues)}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            {t("cancel")}
          </Button>
        </DialogClose>
        <Button
          type="submit"
          aria-disabled={pending || undefined}
          className="aria-disabled:cursor-wait aria-disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : null}
          {pending ? t("submitting") : t("submit")}
        </Button>
      </div>
    </form>
  );
}
