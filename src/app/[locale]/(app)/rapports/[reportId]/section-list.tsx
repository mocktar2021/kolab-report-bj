"use client";

import {
  useActionState,
  useEffect,
  useId,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ReactNode,
  type Ref,
} from "react";
import {
  closestCenter,
  DndContext,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  type Announcements,
  type DragEndEvent,
  type Modifier,
  type UniqueIdentifier,
} from "@dnd-kit/core";
import {
  arrayMove,
  SortableContext,
  sortableKeyboardCoordinates,
  useSortable,
  verticalListSortingStrategy,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { useFormatter, useTranslations } from "next-intl";
import { Check, GripVertical, PenLine, Plus } from "lucide-react";
import { FieldError } from "@/components/auth/field-error";
import { StatusBadge } from "@/components/status-badge";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Link } from "@/i18n/navigation";
import type { SectionStatus } from "@/lib/sections";
import { cn } from "@/lib/utils";
import type { WorkspaceRole } from "@/lib/workspaces/roles";
import { addSection, updateSectionAssignment, type SectionActionState } from "./actions";

export type SectionRowData = {
  id: string;
  title: string;
  /** "1." for a section, "1.2" for a subsection (src/lib/section-outline.ts). */
  label: string;
  /** 1 for a section, 2 for a subsection (KRB-195). */
  level: 1 | 2;
  /** The section a subsection belongs to; null for a section. */
  parentId: string | null;
  status: SectionStatus;
  weight: number;
  assignedTo: string | null;
  assigneeName: string | null;
  /** Assigned to the signed-in user. */
  mine: boolean;
  /** The signed-in user can edit the section (canEditSection). */
  canEdit: boolean;
};

export type Assignee = { userId: string; name: string; role: WorkspaceRole };

/** Anchor of a section in the text of the report. */
export function sectionAnchor(sectionId: string): string {
  return `section-${sectionId}`;
}

type SectionListProps = {
  workspaceId: string;
  sections: SectionRowData[];
  assignees: Assignee[];
  canManage: boolean;
  /** Managers: drag handles call this with every section id, in the new order. */
  onReorder?: (sectionIds: string[]) => void;
  /** A new order is being saved: handles wait until it ends. */
  reorderBusy?: boolean;
  /** What happened to the last new order, under the title. */
  reorderStatus?: ReactNode;
};

/**
 * The table of contents: every section in report order, each followed by its
 * subsections (KRB-195). Managers sort the sections, which take their
 * subsections along, and the subsections within their section.
 */
export function SectionList({
  workspaceId,
  sections,
  assignees,
  canManage,
  onReorder,
  reorderBusy = false,
  reorderStatus,
}: SectionListProps) {
  const t = useTranslations("Report");
  const tops = sections.filter((section) => section.level === 1);
  const children = new Map<string, SectionRowData[]>();
  for (const section of sections) {
    if (section.level === 2 && section.parentId) {
      children.set(section.parentId, [...(children.get(section.parentId) ?? []), section]);
    }
  }
  const childIds = (id: string) => (children.get(id) ?? []).map((child) => child.id);
  const sortable = canManage && onReorder !== undefined;
  const sortableTops = sortable && tops.length > 1;

  // Every id, in document order, as reorder_report_sections takes them.
  const moveSections = (topIds: string[]) => onReorder?.(topIds.flatMap((id) => [id, ...childIds(id)]));
  const moveSubsections = (parentId: string, ids: string[]) =>
    onReorder?.(tops.flatMap((top) => [top.id, ...(top.id === parentId ? ids : childIds(top.id))]));

  const rowProps = { workspaceId, assignees, canManage };
  const subsectionList = (parent: SectionRowData) => {
    const list = children.get(parent.id) ?? [];
    if (list.length === 0) return null;
    const sortableChildren = sortable && list.length > 1;
    const rows = list.map((child) =>
      sortableChildren ? (
        <SortableSectionRow key={child.id} {...rowProps} section={child} disabled={reorderBusy} />
      ) : (
        <SectionRow key={child.id} {...rowProps} section={child} />
      ),
    );
    const nested = (
      <ol aria-label={t("subsectionsLabel", { title: parent.title })} className="divide-y border-t">
        {rows}
      </ol>
    );
    return sortableChildren ? (
      <SortableGroup items={list} onMove={(ids) => moveSubsections(parent.id, ids)}>
        {nested}
      </SortableGroup>
    ) : (
      nested
    );
  };

  const rows = tops.map((section) =>
    sortableTops ? (
      <SortableSectionRow key={section.id} {...rowProps} section={section} disabled={reorderBusy}>
        {subsectionList(section)}
      </SortableSectionRow>
    ) : (
      <SectionRow key={section.id} {...rowProps} section={section}>
        {subsectionList(section)}
      </SectionRow>
    ),
  );

  return (
    <section
      aria-labelledby="toc-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1 border-b px-5 py-4">
        <h2 id="toc-title" className="font-medium">
          {t("tocTitle")}
        </h2>
        <span className="text-sm text-muted-foreground">{t("count", { count: sections.length })}</span>
        {sortable && sections.length > 1 ? (
          <p className="w-full text-xs text-muted-foreground">{t("reorderHint")}</p>
        ) : null}
        {reorderStatus}
      </div>
      {sections.length === 0 ? (
        <p className="px-5 py-10 text-center text-sm text-muted-foreground">
          {canManage ? t("emptyManager") : t("emptyMember")}
        </p>
      ) : sortableTops ? (
        <SortableGroup items={tops} onMove={moveSections}>
          <ol className="divide-y">{rows}</ol>
        </SortableGroup>
      ) : (
        <ol className="divide-y">{rows}</ol>
      )}
    </section>
  );
}

const REDUCED_MOTION = "(prefers-reduced-motion: reduce)";

function subscribeReducedMotion(onChange: () => void) {
  const query = window.matchMedia?.(REDUCED_MOTION);
  query?.addEventListener("change", onChange);
  return () => query?.removeEventListener("change", onChange);
}

/** The system setting, read here rather than through motion to keep this page light. */
function useReducedMotion(): boolean {
  return useSyncExternalStore(
    subscribeReducedMotion,
    () => window.matchMedia?.(REDUCED_MOTION).matches ?? false,
    () => false,
  );
}

/** Rows move up and down only. */
const verticalOnly: Modifier = ({ transform }) => ({ ...transform, x: 0 });

/**
 * Drag and drop of one list, the sections or the subsections of a section,
 * with the pointer or the keyboard (Space to take the handle, arrows to move,
 * Space to drop, Escape to cancel), announced in French. A subsection list is
 * a group of its own inside its section's row, so nothing leaves its level.
 */
function SortableGroup({
  items,
  onMove,
  children,
}: {
  items: Pick<SectionRowData, "id" | "title">[];
  /** The ids of this list, in the new order. */
  onMove: (ids: string[]) => void;
  children: ReactNode;
}) {
  const t = useTranslations("Report.reorder");
  // A fixed id keeps the server and browser markup the same (aria-describedby).
  const id = useId();
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }),
  );
  const ids = items.map((item) => item.id);

  const title = (sectionId: UniqueIdentifier) => items.find((item) => item.id === sectionId)?.title ?? "";
  const place = (sectionId: UniqueIdentifier) => ({
    position: ids.indexOf(String(sectionId)) + 1,
    count: ids.length,
  });

  const announcements: Announcements = {
    onDragStart: ({ active }) => t("picked", { title: title(active.id), ...place(active.id) }),
    onDragOver: ({ active, over }) =>
      over
        ? t("moved", { title: title(active.id), ...place(over.id) })
        : t("outside", { title: title(active.id) }),
    onDragEnd: ({ active, over }) =>
      over
        ? t("dropped", { title: title(active.id), ...place(over.id) })
        : t("cancelled", { title: title(active.id), ...place(active.id) }),
    onDragCancel: ({ active }) => t("cancelled", { title: title(active.id), ...place(active.id) }),
  };

  function handleDragEnd({ active, over }: DragEndEvent) {
    if (!over || active.id === over.id) return;
    const from = ids.indexOf(String(active.id));
    const to = ids.indexOf(String(over.id));
    if (from < 0 || to < 0) return;
    onMove(arrayMove(ids, from, to));
  }

  return (
    <DndContext
      id={id}
      sensors={sensors}
      collisionDetection={closestCenter}
      modifiers={[verticalOnly]}
      accessibility={{ announcements, screenReaderInstructions: { draggable: t("instructions") } }}
      onDragEnd={handleDragEnd}
    >
      <SortableContext items={ids} strategy={verticalListSortingStrategy}>
        {children}
      </SortableContext>
    </DndContext>
  );
}

type SectionRowProps = {
  workspaceId: string;
  section: SectionRowData;
  assignees: Assignee[];
  canManage: boolean;
  /** The subsections of a section, under its row. */
  children?: ReactNode;
};

function SortableSectionRow({ disabled, ...props }: SectionRowProps & { disabled: boolean }) {
  const t = useTranslations("Report.reorder");
  const reduceMotion = useReducedMotion();
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, transform, transition, isDragging } =
    useSortable({
      id: props.section.id,
      disabled,
      transition: reduceMotion ? null : undefined,
      attributes: { roleDescription: t("roleDescription") },
    });

  return (
    <SectionRow
      {...props}
      rowRef={setNodeRef}
      rowStyle={{ transform: CSS.Translate.toString(transform), transition }}
      dragging={isDragging}
      handle={
        <button
          type="button"
          ref={setActivatorNodeRef}
          {...attributes}
          {...listeners}
          aria-label={t("handle", { title: props.section.title })}
          className="-my-1 -ml-2 flex size-8 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground outline-none transition-colors hover:bg-muted hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring active:cursor-grabbing aria-disabled:cursor-wait aria-disabled:opacity-50 aria-pressed:bg-muted aria-pressed:text-foreground"
        >
          <GripVertical className="size-4" aria-hidden="true" />
        </button>
      }
    />
  );
}

function SectionRow({
  workspaceId,
  section,
  assignees,
  canManage,
  children,
  handle,
  rowRef,
  rowStyle,
  dragging = false,
}: SectionRowProps & {
  handle?: ReactNode;
  rowRef?: Ref<HTMLLIElement>;
  rowStyle?: CSSProperties;
  dragging?: boolean;
}) {
  const t = useTranslations("Report");
  const format = useFormatter();

  const sub = section.level === 2;

  return (
    <li
      ref={rowRef}
      style={rowStyle}
      className={cn(dragging && "relative z-10 bg-card shadow-lg ring-1 ring-border")}
    >
      <div
        className={cn(
          "flex flex-col gap-3 py-4 pr-5 lg:flex-row lg:items-center",
          sub ? "pl-10 sm:pl-14" : "pl-5",
        )}
      >
        <div className="flex min-w-0 flex-1 items-start gap-3">
          {handle}
          <span
            className={cn(
              "mt-0.5 shrink-0 text-right text-sm tabular-nums text-muted-foreground",
              sub ? "w-8" : "w-6",
            )}
          >
            {section.label}
          </span>
          <div className="min-w-0">
            <p className="flex flex-wrap items-center gap-2 font-medium leading-snug">
              <a
                href={`#${sectionAnchor(section.id)}`}
                className="min-w-0 break-words rounded-sm underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
              >
                {section.title}
              </a>
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
              {section.canEdit ? <EditLink workspaceId={workspaceId} section={section} /> : null}
            </div>
          </div>
        </div>
        {canManage ? <AssignmentForm section={section} assignees={assignees} /> : null}
      </div>
      {children}
    </li>
  );
}

/** "Modifier", to the section page. Screen readers also hear the section title. */
export function EditLink({
  workspaceId,
  section,
  className,
}: {
  workspaceId: string;
  section: Pick<SectionRowData, "id" | "title">;
  className?: string;
}) {
  const t = useTranslations("Report");

  return (
    <Link
      href={`/espaces/${workspaceId}/sections/${section.id}`}
      className={cn(
        "inline-flex items-center gap-1 rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring",
        className,
      )}
    >
      <PenLine className="size-3.5 shrink-0" aria-hidden="true" />
      {t.rich("edit", {
        title: section.title,
        hidden: (chunks) => <span className="sr-only">{chunks}</span>,
      })}
    </Link>
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
      {/* aria-disabled: once saved, the button keeps the focus instead of dropping it to the page. */}
      <Button
        type="submit"
        size="sm"
        variant="outline"
        className="h-9 aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
        aria-disabled={pending || !dirty}
        onClick={(event) => {
          if (pending || !dirty) event.preventDefault();
        }}
      >
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

export type ParentOption = Pick<SectionRowData, "id" | "label" | "title">;

/**
 * Adds a section at the end of the report, or a subsection at the end of a
 * section (KRB-195). The place stays selected, so several subsections of the
 * same section can be typed one after the other.
 */
export function AddSectionForm({ reportId, parents }: { reportId: string; parents: ParentOption[] }) {
  const t = useTranslations("Report");
  const tWorkspaces = useTranslations("Workspaces");
  const [state, formAction, pending] = useActionState<SectionActionState, FormData>(addSection, {
    status: "idle",
  });
  const inputRef = useRef<HTMLInputElement>(null);
  const sent = useRef<{ title: string; parentId: string }>({ title: "", parentId: "" });
  const [added, setAdded] = useState<{ title: string; parentId: string } | null>(null);
  const [parentId, setParentId] = useState("");
  const titleError = state.status === "error" ? state.fieldErrors?.title : undefined;
  const formError = state.status === "error" && !state.fieldErrors ? state.error : undefined;
  // A section deleted meanwhile: back to the end of the report.
  const place = parents.some((parent) => parent.id === parentId) ? parentId : "";

  // Clear the field after each section so the next one can be typed right away.
  // The button is disabled while the section is added, so the focus goes back
  // to the field, and screen readers hear that the section is in the report.
  // Runs once per answer: the page refreshes after other changes too.
  useEffect(() => {
    if (state.status === "idle") return;
    if (state.status === "success") {
      if (inputRef.current) inputRef.current.value = "";
      setAdded(sent.current);
    } else setAdded(null);
    inputRef.current?.focus();
  }, [state]);

  const addedParent = added?.parentId ? parents.find((parent) => parent.id === added.parentId) : undefined;

  return (
    <form
      action={(formData) => {
        sent.current = {
          title: String(formData.get("title") ?? "").trim(),
          parentId: String(formData.get("parentId") ?? ""),
        };
        formAction(formData);
      }}
      noValidate
      className="surface-card mt-4 rounded-2xl border p-5 shadow-sm"
    >
      <input type="hidden" name="reportId" value={reportId} />
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <div className="min-w-0 flex-1">
          <Label htmlFor="new-section-title">{t("addField")}</Label>
          <Input
            ref={inputRef}
            id="new-section-title"
            name="title"
            placeholder={t("addPlaceholder")}
            maxLength={200}
            required
            className="mt-2"
            aria-invalid={Boolean(titleError)}
            aria-describedby={titleError ? "new-section-error" : undefined}
          />
        </div>
        {parents.length > 0 ? (
          <div className="sm:w-64">
            <Label htmlFor="new-section-place">{t("addPlace")}</Label>
            <NativeSelect
              id="new-section-place"
              name="parentId"
              value={place}
              onChange={(event) => setParentId(event.target.value)}
              className="mt-2"
            >
              <option value="">{t("addPlaceTop")}</option>
              {parents.map((parent) => (
                <option key={parent.id} value={parent.id}>
                  {t("addPlaceUnder", { label: parent.label, title: parent.title })}
                </option>
              ))}
            </NativeSelect>
          </div>
        ) : null}
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
      <p role="status" className="sr-only">
        {added === null
          ? null
          : addedParent
            ? t("addedSub", { title: added.title, parent: addedParent.title })
            : t("added", { title: added.title })}
      </p>
    </form>
  );
}
