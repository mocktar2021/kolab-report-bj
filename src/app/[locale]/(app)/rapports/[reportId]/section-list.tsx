"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { useFormatter, useTranslations } from "next-intl";
import { Check, Plus } from "lucide-react";
import { FieldError } from "@/components/auth/field-error";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Link } from "@/i18n/navigation";
import type { SectionStatus } from "@/lib/sections";
import type { WorkspaceRole } from "@/lib/workspaces/roles";
import { addSection, updateSectionAssignment, type SectionActionState } from "./actions";

export type SectionRowData = {
  id: string;
  title: string;
  status: SectionStatus;
  weight: number;
  assignedTo: string | null;
  assigneeName: string | null;
  /** Assigned to the signed-in user. */
  mine: boolean;
};

type Assignee = { userId: string; name: string; role: WorkspaceRole };

type SectionListProps = {
  workspaceId: string;
  sections: SectionRowData[];
  assignees: Assignee[];
  canManage: boolean;
};

export function SectionList({ workspaceId, sections, assignees, canManage }: SectionListProps) {
  const t = useTranslations("Report");

  return (
    <section
      aria-labelledby="sections-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="flex items-center justify-between gap-3 border-b px-5 py-4">
        <h2 id="sections-title" className="font-medium">
          {t("sectionsTitle")}
        </h2>
        <span className="text-sm text-muted-foreground">{t("count", { count: sections.length })}</span>
      </div>
      {sections.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          {canManage ? t("emptyManager") : t("emptyMember")}
        </p>
      ) : (
        <ol className="divide-y">
          {sections.map((section, index) => (
            <SectionRow
              key={section.id}
              workspaceId={workspaceId}
              index={index}
              section={section}
              assignees={assignees}
              canManage={canManage}
            />
          ))}
        </ol>
      )}
    </section>
  );
}

function SectionRow({
  workspaceId,
  index,
  section,
  assignees,
  canManage,
}: {
  workspaceId: string;
  index: number;
  section: SectionRowData;
  assignees: Assignee[];
  canManage: boolean;
}) {
  const t = useTranslations("Report");
  const format = useFormatter();

  return (
    <li className="flex flex-col gap-3 px-5 py-4 lg:flex-row lg:items-center">
      <div className="flex min-w-0 flex-1 items-start gap-3">
        <span className="mt-0.5 w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground">
          {index + 1}.
        </span>
        <div className="min-w-0">
          <p className="flex flex-wrap items-center gap-2 font-medium leading-snug">
            <Link
              href={`/espaces/${workspaceId}/sections/${section.id}`}
              className="min-w-0 break-words rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
            >
              {section.title}
            </Link>
            {section.mine ? (
              <span className="rounded-full bg-highlight/10 px-2 py-0.5 text-[11px] font-medium text-highlight">
                {t("yourSection")}
              </span>
            ) : null}
          </p>
          <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
            <StatusBadge status={section.status} />
            {canManage ? null : (
              <>
                <span>{section.assigneeName ?? t("unassigned")}</span>
                <span>{t("weightValue", { weight: format.number(section.weight) })}</span>
              </>
            )}
          </div>
        </div>
      </div>
      {canManage ? <AssignmentForm section={section} assignees={assignees} /> : null}
    </li>
  );
}

function AssignmentForm({ section, assignees }: { section: SectionRowData; assignees: Assignee[] }) {
  const t = useTranslations("Report");
  const tWorkspaces = useTranslations("Workspaces");
  const [state, formAction, pending] = useActionState<SectionActionState, FormData>(updateSectionAssignment, {
    status: "idle",
  });
  const [assignedTo, setAssignedTo] = useState(section.assignedTo ?? "");
  const [weight, setWeight] = useState(String(section.weight).replace(".", ","));
  const dirty =
    assignedTo !== (section.assignedTo ?? "") || weight !== String(section.weight).replace(".", ",");

  // A rejected change puts the saved values back.
  useEffect(() => {
    if (state.status === "error" && !state.fieldErrors) {
      setAssignedTo(section.assignedTo ?? "");
    }
  }, [state, section.assignedTo]);

  const assigneeId = `assignee-${section.id}`;
  const weightId = `weight-${section.id}`;
  const statusId = `section-status-${section.id}`;
  const weightError = state.status === "error" ? state.fieldErrors?.weight : undefined;
  // Someone assigned before but no longer assignable still shows as the current value.
  const current = section.assignedTo && !assignees.some((a) => a.userId === section.assignedTo);

  return (
    <form action={formAction} className="flex flex-wrap items-start gap-2 lg:justify-end">
      <input type="hidden" name="sectionId" value={section.id} />
      <div className="w-full sm:w-56">
        <label htmlFor={assigneeId} className="sr-only">
          {t("assigneeLabel", { title: section.title })}
        </label>
        <NativeSelect
          id={assigneeId}
          name="assignedTo"
          value={assignedTo}
          onChange={(event) => setAssignedTo(event.target.value)}
          aria-describedby={statusId}
        >
          <option value="">{t("unassigned")}</option>
          {current ? (
            <option value={section.assignedTo ?? ""}>{section.assigneeName ?? t("unknown")}</option>
          ) : null}
          {assignees.map((assignee) => (
            <option key={assignee.userId} value={assignee.userId}>
              {assignee.name}
            </option>
          ))}
        </NativeSelect>
      </div>
      <div className="flex items-center gap-2">
        {/* "Poids" is visible; the section title is only for screen readers. */}
        <label htmlFor={weightId} className="text-xs text-muted-foreground">
          {t.rich("weightLabel", {
            title: section.title,
            hidden: (chunks) => <span className="sr-only">{chunks}</span>,
          })}
        </label>
        <Input
          id={weightId}
          name="weight"
          inputMode="decimal"
          value={weight}
          onChange={(event) => setWeight(event.target.value)}
          className="h-9 w-16"
          aria-invalid={Boolean(weightError)}
          aria-describedby={statusId}
          title={t("weightHelp")}
        />
      </div>
      <Button type="submit" size="sm" variant="outline" className="h-9" disabled={pending || !dirty}>
        {t("save")}
      </Button>
      <p id={statusId} role="status" aria-live="polite" className="w-full text-xs lg:text-right">
        {state.status === "error" ? (
          <span className="text-destructive">
            {weightError
              ? tWorkspaces(`fieldErrors.${weightError}`)
              : tWorkspaces(`errors.${state.error ?? "generic"}`)}
          </span>
        ) : state.status === "success" && !dirty ? (
          <span className="inline-flex items-center gap-1 text-muted-foreground">
            <Check className="size-3.5" aria-hidden="true" />
            {t("saved")}
          </span>
        ) : null}
      </p>
    </form>
  );
}

/** Adds a section at the end of the report. */
export function AddSectionForm({ reportId }: { reportId: string }) {
  const t = useTranslations("Report");
  const tWorkspaces = useTranslations("Workspaces");
  const [state, formAction, pending] = useActionState<SectionActionState, FormData>(addSection, {
    status: "idle",
  });
  const formRef = useRef<HTMLFormElement>(null);
  const titleError = state.status === "error" ? state.fieldErrors?.title : undefined;
  const formError = state.status === "error" && !state.fieldErrors ? state.error : undefined;

  // Clear the field after each section so the next one can be typed right away.
  useEffect(() => {
    if (state.status === "success") formRef.current?.reset();
  }, [state]);

  return (
    <form
      ref={formRef}
      action={formAction}
      noValidate
      className="surface-card mt-4 rounded-2xl border p-5 shadow-sm"
    >
      <input type="hidden" name="reportId" value={reportId} />
      <Label htmlFor="new-section-title">{t("addField")}</Label>
      <div className="mt-2 flex flex-col gap-2 sm:flex-row">
        <Input
          id="new-section-title"
          name="title"
          placeholder={t("addPlaceholder")}
          maxLength={200}
          required
          aria-invalid={Boolean(titleError)}
          aria-describedby={titleError ? "new-section-error" : undefined}
        />
        <Button type="submit" shape="pill" className="h-10 shrink-0" disabled={pending}>
          <Plus aria-hidden="true" />
          {t("addSubmit")}
        </Button>
      </div>
      <FieldError id="new-section-error" message={titleError && tWorkspaces(`fieldErrors.${titleError}`)} />
      {formError ? (
        <p role="alert" className="mt-2 text-sm text-destructive">
          {tWorkspaces(`errors.${formError}`)}
        </p>
      ) : null}
    </form>
  );
}
