"use client";

import { useActionState, useCallback, useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, PenLine } from "lucide-react";
import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { renameReport, type RenameReportState } from "./title-actions";

/**
 * Title of the report page. Owners and admins of an open report rename it
 * from here (KRB-202): "Renommer" opens a field under the title, and after a
 * save, "Annuler" or Escape the focus goes back to the button.
 */
export function ReportTitle({
  reportId,
  title,
  canRename,
}: {
  reportId: string;
  title: string;
  /** Owners and admins, report not final, workspace not read-only. */
  canRename: boolean;
}) {
  const t = useTranslations("Report.rename");
  const [editing, setEditing] = useState(false);
  const [saved, setSaved] = useState(false);
  const opener = useRef<HTMLButtonElement>(null);
  const refocus = useRef(false);

  // The button comes back with the form gone: put the focus on it.
  useEffect(() => {
    if (editing || !refocus.current) return;
    refocus.current = false;
    opener.current?.focus();
  }, [editing]);

  const close = useCallback((done: boolean) => {
    refocus.current = true;
    setSaved(done);
    setEditing(false);
  }, []);

  return (
    <div className="mt-1">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <h1 className="min-w-0 break-words text-h2 text-foreground">{title}</h1>
        {canRename && !editing ? (
          <Button
            ref={opener}
            type="button"
            variant="ghost"
            size="sm"
            className="text-muted-foreground"
            onClick={() => {
              setSaved(false);
              setEditing(true);
            }}
          >
            <PenLine aria-hidden="true" />
            {t.rich("button", { hidden: (chunks) => <span className="sr-only">{chunks}</span> })}
          </Button>
        ) : null}
      </div>
      {editing ? <RenameForm reportId={reportId} title={title} onClose={close} /> : null}
      {canRename ? (
        <p role="status" aria-live="polite" className="text-xs text-muted-foreground [&:not(:empty)]:mt-1">
          {saved ? (
            <span className="inline-flex items-center gap-1">
              <Check className="size-3.5" aria-hidden="true" />
              {t("saved")}
            </span>
          ) : null}
        </p>
      ) : null}
    </div>
  );
}

/** Mounted on "Renommer", so each opening starts from the current title. */
function RenameForm({
  reportId,
  title,
  onClose,
}: {
  reportId: string;
  title: string;
  onClose: (saved: boolean) => void;
}) {
  const t = useTranslations("Report.rename");
  const tWorkspaces = useTranslations("Workspaces");
  const [state, formAction, pending] = useActionState<RenameReportState, FormData>(renameReport, {
    status: "idle",
  });
  const [draft, setDraft] = useState(title);
  const inputRef = useRef<HTMLInputElement>(null);
  const id = useId();
  const fieldId = `${id}-title`;
  const errorId = `${id}-title-error`;
  const fieldError = state.status === "error" ? state.fieldErrors?.title : undefined;
  const formError = state.status === "error" && !state.fieldErrors ? state.error : undefined;

  // Opens on the field, its text selected to type over it.
  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, []);

  useEffect(() => {
    if (state.status === "success") onClose(true);
    // A title refused by the server: back to the field, which carries the message.
    else if (state.status === "error" && state.fieldErrors?.title) inputRef.current?.focus();
  }, [state, onClose]);

  // Once sent, the save goes through: closing now would hide its result.
  function cancel() {
    if (!pending) onClose(false);
  }

  return (
    <form
      action={formAction}
      noValidate
      className="mt-3 max-w-xl"
      onKeyDown={(event) => {
        if (event.key !== "Escape") return;
        event.preventDefault();
        cancel();
      }}
      onSubmit={(event) => {
        // The button stays focusable while the title is saved (aria-disabled).
        if (pending) {
          event.preventDefault();
          return;
        }
        // Nothing to save: close as "Annuler" does.
        if (draft.trim() === title) {
          event.preventDefault();
          onClose(false);
        }
      }}
    >
      <input type="hidden" name="reportId" value={reportId} />
      <div className="space-y-2">
        <Label htmlFor={fieldId}>{t("label")}</Label>
        <Input
          ref={inputRef}
          id={fieldId}
          name="title"
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          maxLength={200}
          autoComplete="off"
          required
          aria-invalid={Boolean(fieldError)}
          aria-describedby={fieldError ? errorId : undefined}
        />
        <FieldError id={errorId} message={fieldError && tWorkspaces(`fieldErrors.${fieldError}`)} />
      </div>
      {formError ? (
        <p role="alert" className="mt-3 text-sm text-destructive">
          {tWorkspaces(`errors.${formError}`)}
        </p>
      ) : null}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <Button
          type="submit"
          size="sm"
          aria-disabled={pending || undefined}
          className="aria-disabled:cursor-wait aria-disabled:opacity-60"
        >
          {pending ? t("saving") : t("save")}
        </Button>
        <Button type="button" size="sm" variant="ghost" onClick={cancel}>
          {t("cancel")}
        </Button>
      </div>
    </form>
  );
}
