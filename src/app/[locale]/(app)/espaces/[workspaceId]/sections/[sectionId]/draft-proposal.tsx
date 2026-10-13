"use client";

import { useEffect, useId, useRef, useState, useTransition, type KeyboardEvent, type ReactNode } from "react";
import { useRouter } from "next/navigation";
import { useFormatter, useTranslations } from "next-intl";
import { Check, PencilLine, RefreshCw, X } from "lucide-react";
import { Markdown } from "@/components/markdown";
import { Button } from "@/components/ui/button";
import type { DraftProposal } from "@/lib/ai/server";
import { cn } from "@/lib/utils";
import {
  acceptDraft,
  discardDraft,
  type DraftDecisionError,
  type DraftDecisionResult,
} from "./draft-actions";
import { DraftDiff } from "./draft-diff";
import { DraftFeedback } from "./draft-feedback";
import { SourcesList, TruncationNotice } from "./draft-usage";

/** Same bound as acceptDraft and accept_ai_generation. */
const CONTENT_MAX = 100_000;

/** How a decision ended, when the proposal goes away. */
export type DecisionOutcome = "accepted" | "discarded" | "decided" | "gone";

type ShownError = Exclude<DraftDecisionError, "decided" | "notFound">;

type View = "preview" | "diff";

const VIEWS: readonly View[] = ["preview", "diff"];

const DATE_FORMAT = {
  day: "numeric",
  month: "long",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
} as const;

const textareaClass =
  "flex w-full rounded-lg border border-input bg-card px-3 py-2 text-base shadow-sm transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

type DraftProposalViewProps = {
  proposal: DraftProposal;
  /** The section's content now, compared with the proposal. */
  current: string | null;
  /** From the page data, so a section changed meanwhile isn't overwritten. */
  sectionUpdatedAt: string;
  /** Moves the focus to the title when it shows up, after a draft streamed in. */
  focusOnMount: boolean;
  onDecided: (outcome: DecisionOutcome) => void;
};

/** A draft waiting for a decision: preview, diff with the content, accept, edit or discard. */
export function DraftProposalView({
  proposal,
  current,
  sectionUpdatedAt,
  focusOnMount,
  onDecided,
}: DraftProposalViewProps) {
  const t = useTranslations("AiDraft");
  const format = useFormatter();
  const router = useRouter();
  const id = useId();
  const [view, setView] = useState<View>("preview");
  const [mode, setMode] = useState<"review" | "edit" | "confirmDiscard">("review");
  const [text, setText] = useState(proposal.markdown);
  const [error, setError] = useState<ShownError | null>(null);
  const [pending, startTransition] = useTransition();

  const headingRef = useRef<HTMLHeadingElement>(null);
  const tabRefs = useRef<Record<View, HTMLButtonElement | null>>({ preview: null, diff: null });
  const editRef = useRef<HTMLButtonElement>(null);
  const discardRef = useRef<HTMLButtonElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const cancelDiscardRef = useRef<HTMLButtonElement>(null);
  const focusNext = useRef<(() => HTMLElement | null) | null>(null);

  useEffect(() => {
    if (focusOnMount) headingRef.current?.focus();
    // Only when the proposal first shows up.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Focus moves once the new mode is on screen.
  useEffect(() => {
    const target = focusNext.current;
    focusNext.current = null;
    target?.()?.focus();
  }, [mode]);

  function switchMode(next: typeof mode, focus: () => HTMLElement | null) {
    setError(null);
    focusNext.current = focus;
    setMode(next);
  }

  function decide(action: () => Promise<DraftDecisionResult>, outcome: "accepted" | "discarded") {
    setError(null);
    startTransition(async () => {
      try {
        const result = await action();
        if (result.ok || result.error === "decided" || result.error === "notFound") {
          onDecided(result.ok ? outcome : result.error === "decided" ? "decided" : "gone");
          router.refresh();
          return;
        }
        setError(result.error);
      } catch {
        // The action did not answer, for example after a network error.
        setError("generic");
      }
    });
  }

  function accept(content: string) {
    decide(() => acceptDraft({ generationId: proposal.generationId, content, sectionUpdatedAt }), "accepted");
  }

  function onTabKey(event: KeyboardEvent<HTMLButtonElement>) {
    const index = VIEWS.indexOf(view);
    const next =
      event.key === "ArrowRight"
        ? VIEWS[(index + 1) % VIEWS.length]
        : event.key === "ArrowLeft"
          ? VIEWS[(index - 1 + VIEWS.length) % VIEWS.length]
          : event.key === "Home"
            ? VIEWS[0]
            : event.key === "End"
              ? VIEWS[VIEWS.length - 1]
              : undefined;
    if (!next) return;
    event.preventDefault();
    setView(next);
    tabRefs.current[next]?.focus();
  }

  const titleId = `${id}-title`;
  const sourcesId = `${id}-sources`;
  const editId = `${id}-edit`;
  const createdAt = new Date(proposal.createdAt);
  const meta = {
    date: format.dateTime(createdAt, DATE_FORMAT),
    time: (chunks: ReactNode) => <time dateTime={proposal.createdAt}>{chunks}</time>,
  };
  const textEmpty = text.trim() === "";

  return (
    <section aria-labelledby={titleId} className="space-y-4 border-t px-5 py-4">
      <div>
        <h3
          id={titleId}
          ref={headingRef}
          tabIndex={-1}
          className="rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("proposalTitle")}
        </h3>
        <p className="mt-1 break-words text-sm text-muted-foreground">
          {proposal.templateTitle
            ? t.rich("proposalMeta", { ...meta, template: proposal.templateTitle })
            : t.rich("proposalMetaNoTemplate", meta)}
        </p>
        <p className="mt-1 text-sm text-muted-foreground">{t("proposalNote")}</p>
      </div>

      {proposal.truncated ? <TruncationNotice deliverables={proposal.deliverables} list={false} /> : null}

      {mode === "edit" ? (
        <div className="space-y-1.5">
          <label htmlFor={editId} className="text-sm font-medium">
            {t("editLabel")}
          </label>
          <textarea
            id={editId}
            ref={textareaRef}
            value={text}
            onChange={(event) => setText(event.target.value)}
            rows={16}
            maxLength={CONTENT_MAX}
            disabled={pending}
            spellCheck
            className={cn(
              textareaClass,
              "min-h-[20rem] font-mono text-[13px] leading-relaxed md:text-[13px]",
            )}
            aria-invalid={textEmpty}
            aria-describedby={`${editId}-help`}
          />
          <p
            id={`${editId}-help`}
            className="flex flex-wrap justify-between gap-x-3 text-xs text-muted-foreground"
          >
            <span className={textEmpty ? "text-destructive" : undefined}>
              {textEmpty ? t("editEmpty") : t("editHelp")}
            </span>
            <span className="tabular-nums">{t("editCount", { count: text.length, max: CONTENT_MAX })}</span>
          </p>
        </div>
      ) : (
        <div>
          <div
            role="tablist"
            aria-label={t("viewsLabel")}
            className="inline-flex rounded-lg border bg-muted/40 p-0.5"
          >
            {VIEWS.map((value) => (
              <button
                key={value}
                ref={(element) => {
                  tabRefs.current[value] = element;
                }}
                type="button"
                role="tab"
                id={`${id}-tab-${value}`}
                aria-selected={view === value}
                aria-controls={`${id}-panel-${value}`}
                tabIndex={view === value ? 0 : -1}
                onClick={() => setView(value)}
                onKeyDown={onTabKey}
                className={cn(
                  "rounded-md px-3 py-1 text-xs font-medium outline-none transition-colors focus-visible:ring-2 focus-visible:ring-ring",
                  view === value
                    ? "bg-card text-foreground shadow-sm"
                    : "text-muted-foreground hover:text-foreground",
                )}
              >
                {value === "preview" ? t("viewPreview") : t("viewDiff")}
              </button>
            ))}
          </div>
          <div
            role="tabpanel"
            id={`${id}-panel-${view}`}
            aria-labelledby={`${id}-tab-${view}`}
            tabIndex={view === "preview" ? 0 : -1}
            className="mt-3 overflow-hidden rounded-xl border bg-card outline-none focus-visible:ring-2 focus-visible:ring-ring"
          >
            {view === "preview" ? (
              <div className="break-words px-4 py-3 text-sm leading-relaxed">
                <Markdown
                  headingLevel={4}
                  headings="flatten"
                  links="text"
                  fallback={<p className="text-destructive">{t("previewError")}</p>}
                >
                  {proposal.markdown}
                </Markdown>
              </div>
            ) : (
              <DraftDiff current={current ?? ""} proposal={proposal.markdown} />
            )}
          </div>
        </div>
      )}

      <SourcesList deliverables={proposal.deliverables} headingId={sourcesId} />

      {error ? (
        <div
          role="alert"
          className="rounded-xl border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm"
        >
          <p>{t(`decisionErrors.${error}`)}</p>
          {error === "conflict" ? (
            <Button
              type="button"
              size="sm"
              variant="outline"
              className="mt-3"
              onClick={() => {
                setError(null);
                router.refresh();
              }}
            >
              <RefreshCw aria-hidden="true" />
              {t("reload")}
            </Button>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-2">
        {mode === "edit" ? (
          <>
            <Button type="button" shape="pill" disabled={pending || textEmpty} onClick={() => accept(text)}>
              <Check aria-hidden="true" />
              {t("acceptEdited")}
            </Button>
            <Button
              type="button"
              variant="ghost"
              shape="pill"
              disabled={pending}
              onClick={() => switchMode("review", () => editRef.current)}
            >
              {t("cancel")}
            </Button>
          </>
        ) : mode === "confirmDiscard" ? (
          <div className="flex w-full flex-col gap-2 rounded-xl border bg-muted/40 px-4 py-3 sm:flex-row sm:items-center">
            <p className="text-sm sm:mr-auto">{t("discardQuestion")}</p>
            <div className="flex flex-wrap gap-2">
              <Button
                type="button"
                size="sm"
                variant="destructive"
                disabled={pending}
                onClick={() => decide(() => discardDraft(proposal.generationId), "discarded")}
              >
                {t("confirmDiscard")}
              </Button>
              <Button
                ref={cancelDiscardRef}
                type="button"
                size="sm"
                variant="ghost"
                disabled={pending}
                onClick={() => switchMode("review", () => discardRef.current)}
              >
                {t("cancel")}
              </Button>
            </div>
          </div>
        ) : (
          <>
            <Button type="button" shape="pill" disabled={pending} onClick={() => accept(proposal.markdown)}>
              <Check aria-hidden="true" />
              {t("accept")}
            </Button>
            <Button
              ref={editRef}
              type="button"
              variant="outline"
              shape="pill"
              disabled={pending}
              onClick={() => {
                setText(proposal.markdown);
                switchMode("edit", () => textareaRef.current);
              }}
            >
              <PencilLine aria-hidden="true" />
              {t("edit")}
            </Button>
            <Button
              ref={discardRef}
              type="button"
              variant="ghost"
              shape="pill"
              disabled={pending}
              onClick={() => switchMode("confirmDiscard", () => cancelDiscardRef.current)}
            >
              <X aria-hidden="true" />
              {t("discard")}
            </Button>
          </>
        )}
        <p role="status" className="text-sm text-muted-foreground">
          {pending ? t("saving") : null}
        </p>
      </div>

      {proposal.mine ? (
        <div className="border-t pt-4">
          <DraftFeedback
            generationId={proposal.generationId}
            rating={proposal.rating}
            comment={proposal.comment}
          />
        </div>
      ) : null}
    </section>
  );
}
