"use client";

import { useActionState, useEffect, useId, useRef, useState } from "react";
import { LoaderCircle, Trash2 } from "lucide-react";
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
import { confirmationMatches } from "@/lib/deletions/confirmation";
import type { DeletionState } from "@/lib/deletions/errors";

/** Text of the dialog, translated by the page, so this component needs no message scope. */
export type DeleteDialogLabels = {
  trigger: string;
  /** Accessible name of the trigger when its text alone does not say what goes. */
  triggerLabel?: string;
  title: string;
  description: string;
  confirm: string;
  pending: string;
  cancel: string;
  /** Closes the dialog when the deletion is blocked. Defaults to `cancel`. */
  close?: string;
  /** Label of the field where the title or name is typed. */
  typed?: string;
  /** Under the field when the typed text does not match. */
  mismatch?: string;
};

export type DeleteDialogProps = {
  /** Server action that deletes, then redirects. It reads "id" and "confirmation". */
  action: (state: DeletionState, formData: FormData) => Promise<DeletionState>;
  /** Id of what goes. */
  id: string;
  /** Title or name to type before the deletion, for the ones that ask for it. */
  expected?: string;
  labels: DeleteDialogLabels;
  /** "sm" for a button in a list. */
  size?: "default" | "sm";
  /**
   * Why the deletion cannot happen now, such as a payment in progress. The
   * dialog shows it in place of the form.
   */
  blocked?: string;
  /** What goes with it and what is lost, rendered by the page. */
  children?: React.ReactNode;
};

/**
 * "Supprimer …" for a report, a workspace or an organization (KRB-180): a
 * confirmation dialog that names what goes, asks for the exact title or name
 * when `expected` is set, and calls the deletion. The database checks the
 * rights and the typed text again. With `blocked`, it says why the deletion
 * waits and offers no way to confirm.
 */
export function DeleteDialog({
  action,
  id,
  expected,
  labels,
  size = "default",
  blocked,
  children,
}: DeleteDialogProps) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" variant="destructive" shape="pill" size={size} aria-label={labels.triggerLabel}>
          <Trash2 aria-hidden="true" />
          {labels.trigger}
        </Button>
      </DialogTrigger>
      <DialogContent className="max-h-[80vh] overflow-y-auto p-6">
        <DialogTitle>{labels.title}</DialogTitle>
        <DialogDescription className="mt-2">{labels.description}</DialogDescription>
        {children ? <div className="mt-4 space-y-3 text-sm">{children}</div> : null}
        {blocked ? (
          <>
            <p role="note" className="mt-4 rounded-lg border border-destructive/40 px-3 py-2 text-sm">
              {blocked}
            </p>
            <div className="mt-6 flex justify-end">
              <DialogClose asChild>
                <Button type="button" variant="outline">
                  {labels.close ?? labels.cancel}
                </Button>
              </DialogClose>
            </div>
          </>
        ) : (
          // Mounted with the dialog, so each opening starts empty.
          <DeleteForm action={action} id={id} expected={expected} labels={labels} />
        )}
      </DialogContent>
    </Dialog>
  );
}

function DeleteForm({
  action,
  id,
  expected,
  labels,
}: Omit<DeleteDialogProps, "children" | "size" | "blocked">) {
  const [state, formAction, pending] = useActionState<DeletionState, FormData>(action, { status: "idle" });
  const [typed, setTyped] = useState("");
  const [mismatch, setMismatch] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const fieldId = useId();
  const errorId = useId();
  const asksForText = expected !== undefined;

  // The database refused the typed text: back to the field.
  useEffect(() => {
    if (state.status === "error" && state.error === "confirmation") inputRef.current?.focus();
  }, [state]);

  return (
    <form
      action={formAction}
      noValidate
      className="mt-6"
      onSubmit={(event) => {
        // The button stays focusable while the deletion runs (aria-disabled).
        if (pending) {
          event.preventDefault();
          return;
        }
        if (expected !== undefined && !confirmationMatches(typed, expected)) {
          event.preventDefault();
          setMismatch(true);
          inputRef.current?.focus();
        }
      }}
    >
      <input type="hidden" name="id" value={id} />
      {asksForText ? (
        <div className="space-y-2">
          <Label htmlFor={fieldId}>{labels.typed}</Label>
          <Input
            ref={inputRef}
            id={fieldId}
            name="confirmation"
            value={typed}
            onChange={(event) => {
              setTyped(event.target.value);
              if (mismatch) setMismatch(false);
            }}
            autoComplete="off"
            spellCheck={false}
            required
            aria-invalid={mismatch}
            aria-describedby={mismatch ? errorId : undefined}
          />
          <FieldError id={errorId} message={mismatch ? labels.mismatch : undefined} />
        </div>
      ) : null}

      {state.status === "error" && !pending ? (
        <p role="alert" className="mt-4 text-sm text-destructive">
          {state.message}
        </p>
      ) : null}

      <div className="mt-6 flex flex-wrap justify-end gap-2">
        <DialogClose asChild>
          <Button type="button" variant="ghost">
            {labels.cancel}
          </Button>
        </DialogClose>
        <Button
          type="submit"
          variant="destructive"
          aria-disabled={pending || undefined}
          className="aria-disabled:cursor-wait aria-disabled:opacity-60"
        >
          {pending ? <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" /> : null}
          {pending ? labels.pending : labels.confirm}
        </Button>
      </div>
    </form>
  );
}
