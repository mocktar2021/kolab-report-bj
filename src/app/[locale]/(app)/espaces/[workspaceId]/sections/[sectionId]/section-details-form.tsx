"use client";

import { useActionState, useId, useState } from "react";
import { useTranslations } from "next-intl";
import { Check, PenLine } from "lucide-react";
import { FieldError } from "@/components/auth/field-error";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { updateSectionDetails, type SectionDetailsState } from "./manage-actions";

const INSTRUCTIONS_MAX = 4000;

/**
 * "Modifier le titre et les consignes", for owners and admins (KRB-195). A
 * native disclosure, closed by default, so the page reads the same for
 * everyone until a manager opens it.
 */
export function SectionDetailsForm({
  sectionId,
  title,
  instructions,
}: {
  sectionId: string;
  title: string;
  instructions: string | null;
}) {
  const t = useTranslations("SectionManage");
  const tFields = useTranslations("Workspaces.fieldErrors");
  const tErrors = useTranslations("Workspaces.errors");
  const [state, formAction, pending] = useActionState<SectionDetailsState, FormData>(updateSectionDetails, {
    status: "idle",
  });
  const [draftTitle, setDraftTitle] = useState(title);
  const [draftInstructions, setDraftInstructions] = useState(instructions ?? "");
  const id = useId();
  const titleId = `${id}-title`;
  const instructionsId = `${id}-instructions`;
  const helpId = `${id}-help`;
  const titleError = state.status === "error" ? state.fieldErrors?.title : undefined;
  const instructionsError = state.status === "error" ? state.fieldErrors?.instructions : undefined;
  const formError = state.status === "error" && !state.fieldErrors ? state.error : undefined;
  const dirty = draftTitle !== title || draftInstructions !== (instructions ?? "");

  // After a save, the page brings the new values: start from them. Done while
  // rendering, rather than in an effect.
  const [saved, setSaved] = useState({ title, instructions });
  if (saved.title !== title || saved.instructions !== instructions) {
    setSaved({ title, instructions });
    setDraftTitle(title);
    setDraftInstructions(instructions ?? "");
  }

  return (
    <details className="group mt-4 rounded-xl border px-4 py-3">
      <summary className="inline-flex cursor-pointer items-center gap-1.5 rounded-sm text-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring">
        <PenLine className="size-3.5" aria-hidden="true" />
        {t("edit")}
      </summary>
      <form action={formAction} noValidate className="mt-4 space-y-4">
        <input type="hidden" name="sectionId" value={sectionId} />
        <div>
          <Label htmlFor={titleId}>{t("titleLabel")}</Label>
          <Input
            id={titleId}
            name="title"
            value={draftTitle}
            onChange={(event) => setDraftTitle(event.target.value)}
            maxLength={200}
            required
            className="mt-2"
            aria-invalid={Boolean(titleError)}
            aria-describedby={titleError ? `${titleId}-error` : undefined}
          />
          <FieldError id={`${titleId}-error`} message={titleError && tFields(titleError)} />
        </div>
        <div>
          <Label htmlFor={instructionsId}>{t("instructionsLabel")}</Label>
          <textarea
            id={instructionsId}
            name="instructions"
            value={draftInstructions}
            onChange={(event) => setDraftInstructions(event.target.value)}
            maxLength={INSTRUCTIONS_MAX}
            rows={5}
            className="mt-2 flex w-full rounded-lg border border-input bg-card px-3 py-2 text-base shadow-sm transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 md:text-sm"
            aria-invalid={Boolean(instructionsError)}
            aria-describedby={instructionsError ? `${instructionsId}-error ${helpId}` : helpId}
          />
          <p id={helpId} className="mt-1.5 text-xs text-muted-foreground">
            {t("instructionsHelp")}
          </p>
          <FieldError
            id={`${instructionsId}-error`}
            message={instructionsError && tFields(instructionsError)}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3">
          {/* aria-disabled: once saved, the button keeps the focus instead of dropping it to the page. */}
          <Button
            type="submit"
            size="sm"
            className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
            aria-disabled={pending || !dirty}
            onClick={(event) => {
              if (pending || !dirty) event.preventDefault();
            }}
          >
            {pending ? t("saving") : t("save")}
          </Button>
          <p role="status" aria-live="polite" className="text-xs">
            {formError ? (
              <span className="text-destructive">{tErrors(formError)}</span>
            ) : state.status === "success" && !dirty ? (
              <span className="inline-flex items-center gap-1 text-muted-foreground">
                <Check className="size-3.5" aria-hidden="true" />
                {t("saved")}
              </span>
            ) : null}
          </p>
        </div>
      </form>
    </details>
  );
}
