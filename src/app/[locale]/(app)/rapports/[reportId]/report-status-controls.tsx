"use client";

import { useActionState, useEffect, useRef, useState, type FormEvent, type RefObject } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import {
  Check,
  Download,
  Lock,
  LockOpen,
  LoaderCircle,
  RotateCw,
  Send,
  Undo2,
  type LucideIcon,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog";
import type { ReportAction, ReportStatus } from "@/lib/reports/status";
import type { FinalSnapshot } from "@/lib/reports/workflow";
import { cn } from "@/lib/utils";
import {
  changeReportStatus,
  retryFinalSnapshot,
  type ReportStatusState,
  type SnapshotState,
} from "./status-actions";

/** Changes that others feel right away go through a confirmation first. */
type ConfirmedAction = Exclude<ReportAction, "submit">;

function needsConfirmation(action: ReportAction): action is ConfirmedAction {
  return action !== "submit";
}

const ACTION_ICONS: Record<ReportAction, LucideIcon> = {
  submit: Send,
  sendBack: Undo2,
  finalize: Lock,
  reopen: LockOpen,
};

/** The step forward is the ink button, the step back an outline one. */
const ACTION_VARIANTS: Record<ReportAction, "default" | "outline"> = {
  submit: "default",
  sendBack: "outline",
  finalize: "default",
  reopen: "outline",
};

/**
 * A button that answered goes away when the status changes, which drops the
 * focus on the page body. Puts it on the result instead.
 */
function focusIfLost(target: RefObject<HTMLElement | null>) {
  const active = document.activeElement;
  if (!active || active === document.body) target.current?.focus();
}

type ReportStatusControlsProps = {
  reportId: string;
  status: ReportStatus;
  /** What the signed-in owner or admin can do now (allowedReportActions). */
  actions: ReportAction[];
  /** The final version of a final report (getReportWorkflow), null otherwise. */
  snapshot: FinalSnapshot | null;
};

/**
 * Review and finalization of a report, for owners and admins (KRB-20): the
 * status changes they can make, what happened to the last one, and the final
 * version of a final report.
 */
export function ReportStatusControls({ reportId, status, actions, snapshot }: ReportStatusControlsProps) {
  const t = useTranslations("ReportStatus");
  const router = useRouter();
  const [state, dispatch, pending] = useActionState<ReportStatusState, FormData>(changeReportStatus, {
    status: "idle",
  });
  // The action behind `state`, for its messages.
  const [submitted, setSubmitted] = useState<ReportAction | null>(null);
  // The dialog keeps its last action while it closes, so its text does not vanish.
  const [confirm, setConfirm] = useState<{ action: ConfirmedAction; open: boolean }>({
    action: "finalize",
    open: false,
  });
  const opener = useRef<HTMLButtonElement | null>(null);
  const feedback = useRef<HTMLParagraphElement>(null);

  // Someone else changed the status first: show the current one.
  useEffect(() => {
    if (state.status === "error" && state.error === "stale") router.refresh();
  }, [state, router]);

  // Runs again when the new status arrives, which can come after the answer.
  useEffect(() => {
    if (state.status !== "idle" && !pending) focusIfLost(feedback);
  }, [state, pending, status]);

  // Runs before the form action. State set inside the action would wait for
  // its answer: the dialog would stay open and the message would lag.
  function onSubmit(event: FormEvent<HTMLFormElement>, action: ReportAction) {
    if (pending) {
      event.preventDefault();
      return;
    }
    setSubmitted(action);
    setConfirm((current) => ({ ...current, open: false }));
  }

  const ownerOnly =
    (status === "in_review" && !actions.includes("finalize")) ||
    (status === "final" && !actions.includes("reopen"));

  return (
    <section
      aria-labelledby="report-status-title"
      className="surface-card mt-6 rounded-2xl border p-5 shadow-sm"
    >
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <div className="min-w-0">
          <h2 id="report-status-title" className="font-medium">
            {t("panelTitle")}
          </h2>
          {ownerOnly ? <p className="mt-1 text-xs text-muted-foreground">{t("ownerOnly")}</p> : null}
          {/* Always rendered, so screen readers hear each change of the live region. */}
          <p
            ref={feedback}
            tabIndex={-1}
            role="status"
            aria-live="polite"
            className="rounded-sm text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring [&:not(:empty)]:mt-2"
          >
            <StatusFeedback pending={pending} submitted={submitted} state={state} />
          </p>
        </div>

        {actions.length > 0 ? (
          <div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
            {actions.map((action) => {
              const Icon = ACTION_ICONS[action];
              const busy = pending && submitted === action;
              const content = (
                <>
                  {busy ? (
                    <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
                  ) : (
                    <Icon aria-hidden="true" />
                  )}
                  {t(`actions.${action}`)}
                </>
              );
              const className = "aria-disabled:cursor-wait aria-disabled:opacity-60";

              if (needsConfirmation(action)) {
                return (
                  <Button
                    key={action}
                    type="button"
                    shape="pill"
                    variant={ACTION_VARIANTS[action]}
                    aria-haspopup="dialog"
                    aria-disabled={pending || undefined}
                    className={className}
                    onClick={(event) => {
                      if (pending) return;
                      opener.current = event.currentTarget;
                      setConfirm({ action, open: true });
                    }}
                  >
                    {content}
                  </Button>
                );
              }
              return (
                <form key={action} action={dispatch} onSubmit={(event) => onSubmit(event, action)}>
                  <input type="hidden" name="reportId" value={reportId} />
                  <input type="hidden" name="action" value={action} />
                  <Button
                    type="submit"
                    shape="pill"
                    variant={ACTION_VARIANTS[action]}
                    aria-disabled={pending || undefined}
                    className={className}
                  >
                    {content}
                  </Button>
                </form>
              );
            })}
          </div>
        ) : null}
      </div>

      {snapshot ? <FinalSnapshotBlock reportId={reportId} snapshot={snapshot} /> : null}

      <Dialog open={confirm.open} onOpenChange={(open) => setConfirm((current) => ({ ...current, open }))}>
        <DialogContent
          className="p-6"
          onCloseAutoFocus={(event) => {
            // No DialogTrigger here: give the focus back to the button that opened it.
            event.preventDefault();
            (opener.current?.isConnected ? opener.current : feedback.current)?.focus();
          }}
        >
          <DialogTitle>{t(`confirm.${confirm.action}.title`)}</DialogTitle>
          <DialogDescription className="mt-2">{t(`confirm.${confirm.action}.description`)}</DialogDescription>
          <form
            action={dispatch}
            onSubmit={(event) => onSubmit(event, confirm.action)}
            className="mt-6 flex flex-wrap justify-end gap-2"
          >
            <input type="hidden" name="reportId" value={reportId} />
            <input type="hidden" name="action" value={confirm.action} />
            <DialogClose asChild>
              <Button type="button" variant="ghost">
                {t("confirm.cancel")}
              </Button>
            </DialogClose>
            <Button type="submit" variant={ACTION_VARIANTS[confirm.action]}>
              {t(`confirm.${confirm.action}.confirm`)}
            </Button>
          </form>
        </DialogContent>
      </Dialog>
    </section>
  );
}

function StatusFeedback({
  pending,
  submitted,
  state,
}: {
  pending: boolean;
  submitted: ReportAction | null;
  state: ReportStatusState;
}) {
  const t = useTranslations("ReportStatus");

  if (pending) {
    return (
      <span className="inline-flex items-start gap-1.5 text-muted-foreground">
        <LoaderCircle className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin" aria-hidden="true" />
        {submitted === "finalize" ? t("pendingFinalize") : t("pending")}
      </span>
    );
  }
  if (state.status === "error") {
    return <span className="text-destructive">{t(`errors.${state.error}`)}</span>;
  }
  if (state.status === "success" && submitted) {
    return (
      <>
        <span className="flex items-start gap-1.5 text-muted-foreground">
          <Check className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t(`success.${submitted}`)}
        </span>
        {/* After finalizing: what happened to the final version. */}
        {state.snapshot ? (
          <span
            className={cn(
              "mt-1 block",
              state.snapshot === "failed" ? "text-destructive" : "text-muted-foreground",
            )}
          >
            {t(`snapshot.result.${state.snapshot}`)}
          </span>
        ) : null}
      </>
    );
  }
  return null;
}

function snapshotFormat(fileName: string): "pdf" | "docx" {
  return fileName.toLowerCase().endsWith(".docx") ? "docx" : "pdf";
}

/** The file stored when the report became final, or a way to store it again. */
function FinalSnapshotBlock({ reportId, snapshot }: { reportId: string; snapshot: FinalSnapshot }) {
  const t = useTranslations("ReportStatus");
  const router = useRouter();
  const [state, dispatch, pending] = useActionState<SnapshotState, FormData>(retryFinalSnapshot, {
    status: "idle",
  });
  const result = useRef<HTMLParagraphElement>(null);

  useEffect(() => {
    if (state.status === "error" && state.error === "stale") router.refresh();
  }, [state, router]);

  useEffect(() => {
    if (state.status !== "idle" && !pending) focusIfLost(result);
  }, [state, pending, snapshot.state]);

  return (
    <div className="mt-4 border-t pt-4">
      <h3 className="text-sm font-medium">{t("snapshot.title")}</h3>
      {snapshot.state === "ready" ? (
        <p className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
          {/* A plain link: the route redirects to a signed download link. */}
          <a
            href={snapshot.url}
            className="inline-flex items-center gap-2 rounded-sm font-medium text-foreground underline-offset-4 outline-none hover:underline focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Download className="size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
            {t("snapshot.ready", { format: snapshotFormat(snapshot.fileName) })}
          </a>
          <span className="break-all text-xs text-muted-foreground">{snapshot.fileName}</span>
        </p>
      ) : snapshot.state === "pending" ? (
        <p className="mt-2 text-sm text-muted-foreground">{t("snapshot.pending")}</p>
      ) : (
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-2">
          <p className="text-sm text-muted-foreground">{t("snapshot.missing")}</p>
          <form
            action={(formData) => {
              if (!pending) dispatch(formData);
            }}
          >
            <input type="hidden" name="reportId" value={reportId} />
            <Button
              type="submit"
              size="sm"
              variant="outline"
              shape="pill"
              aria-disabled={pending || undefined}
              className="aria-disabled:cursor-wait aria-disabled:opacity-60"
            >
              {pending ? (
                <LoaderCircle className="motion-safe:animate-spin" aria-hidden="true" />
              ) : (
                <RotateCw aria-hidden="true" />
              )}
              {t("snapshot.create")}
            </Button>
          </form>
        </div>
      )}
      <p
        ref={result}
        tabIndex={-1}
        role="status"
        aria-live="polite"
        className="rounded-sm text-xs outline-none focus-visible:ring-2 focus-visible:ring-ring [&:not(:empty)]:mt-2"
      >
        {pending ? (
          <span className="text-muted-foreground">{t("snapshot.creating")}</span>
        ) : state.status === "done" ? (
          <span className={state.snapshot === "failed" ? "text-destructive" : "text-muted-foreground"}>
            {t(`snapshot.result.${state.snapshot}`)}
          </span>
        ) : state.status === "error" ? (
          <span className="text-destructive">{t(`errors.${state.error}`)}</span>
        ) : null}
      </p>
    </div>
  );
}
