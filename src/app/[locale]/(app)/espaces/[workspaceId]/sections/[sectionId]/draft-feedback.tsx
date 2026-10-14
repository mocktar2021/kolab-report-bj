"use client";

import { useId, useState, useTransition, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { ThumbsDown, ThumbsUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { rateDraft, type DraftRatingResult } from "./draft-actions";

const COMMENT_MAX = 1000;

type Rating = 1 | -1 | null;

type DraftFeedbackProps = {
  generationId: string;
  rating: Rating;
  comment: string | null;
};

const textareaClass =
  "flex w-full rounded-lg border border-input bg-card px-3 py-2 text-base shadow-sm transition-[border-color,box-shadow] duration-200 placeholder:text-muted-foreground focus-visible:border-ring focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-ring/15 disabled:cursor-not-allowed disabled:opacity-50 md:text-sm";

/** Thumbs up or down and a comment on a draft, for the person who asked for it. */
export function DraftFeedback({
  generationId,
  rating: savedRating,
  comment: savedComment,
}: DraftFeedbackProps) {
  const t = useTranslations("AiDraft.feedback");
  const id = useId();
  const [saved, setSaved] = useState({ rating: savedRating, comment: savedComment ?? "" });
  const [rating, setRating] = useState<Rating>(savedRating);
  const [comment, setComment] = useState(savedComment ?? "");
  const [error, setError] = useState<Extract<DraftRatingResult, { ok: false }>["error"] | null>(null);
  const [pending, startTransition] = useTransition();

  const changed = rating !== saved.rating || comment.trim() !== saved.comment;
  const hasSaved = saved.rating !== null || saved.comment !== "";
  const titleId = `${id}-title`;
  const commentId = `${id}-comment`;

  function toggle(value: 1 | -1) {
    setError(null);
    setRating((current) => (current === value ? null : value));
  }

  function send() {
    setError(null);
    const next = { rating, comment: comment.trim() };
    startTransition(async () => {
      try {
        const result = await rateDraft({ generationId, rating: next.rating, comment: next.comment });
        if (result.ok) setSaved(next);
        else setError(result.error);
      } catch {
        setError("generic");
      }
    });
  }

  return (
    <div className="space-y-3">
      <p id={titleId} className="text-sm font-medium">
        {t("title")}
      </p>
      <div role="group" aria-labelledby={titleId} className="flex flex-wrap gap-2">
        <ThumbButton pressed={rating === 1} disabled={pending} onClick={() => toggle(1)}>
          <ThumbsUp aria-hidden="true" />
          {t("useful")}
        </ThumbButton>
        <ThumbButton pressed={rating === -1} disabled={pending} onClick={() => toggle(-1)}>
          <ThumbsDown aria-hidden="true" />
          {t("notUseful")}
        </ThumbButton>
      </div>

      <div className="space-y-1.5">
        <label htmlFor={commentId} className="text-sm font-medium">
          {t("commentLabel")} <span className="font-normal text-muted-foreground">{t("optional")}</span>
        </label>
        <textarea
          id={commentId}
          value={comment}
          onChange={(event) => {
            setError(null);
            setComment(event.target.value);
          }}
          rows={2}
          maxLength={COMMENT_MAX}
          disabled={pending}
          className={textareaClass}
          aria-describedby={`${commentId}-help`}
        />
        <p id={`${commentId}-help`} className="flex justify-between gap-3 text-xs text-muted-foreground">
          <span>{t("commentHelp")}</span>
          <span className="shrink-0 tabular-nums">
            {t("commentCount", { count: comment.length, max: COMMENT_MAX })}
          </span>
        </p>
      </div>

      <div className="flex flex-wrap items-center gap-3">
        {/*
          aria-disabled rather than disabled: once the opinion is saved the
          button stays focusable, so the focus is not dropped to the page.
        */}
        <Button
          type="button"
          size="sm"
          variant="outline"
          aria-disabled={!changed || pending}
          className="aria-disabled:cursor-not-allowed aria-disabled:opacity-50"
          onClick={() => {
            if (changed && !pending) send();
          }}
        >
          {t("send")}
        </Button>
        <p role="status" className="text-xs text-muted-foreground">
          {!changed && hasSaved && !pending ? t("saved") : null}
        </p>
      </div>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${error}`)}
        </p>
      ) : null}
    </div>
  );
}

function ThumbButton({
  pressed,
  disabled,
  onClick,
  children,
}: {
  pressed: boolean;
  disabled: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <Button
      type="button"
      size="sm"
      variant="outline"
      aria-pressed={pressed}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        pressed &&
          "border-highlight/40 bg-highlight/10 text-highlight hover:bg-highlight/[0.12] hover:text-highlight",
      )}
    >
      {children}
    </Button>
  );
}
