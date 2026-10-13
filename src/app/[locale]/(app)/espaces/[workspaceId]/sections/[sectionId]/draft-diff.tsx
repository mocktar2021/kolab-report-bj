"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { diffTemplates, foldUnchanged, type DiffLine } from "@/lib/prompts/diff";
import { cn } from "@/lib/utils";

/** Line by line changes from the section's current content to the proposal, as Markdown source. */
export function DraftDiff({ current, proposal }: { current: string; proposal: string }) {
  const t = useTranslations("AiDraft");
  const lines = useMemo(() => diffTemplates(current, proposal), [current, proposal]);
  const blocks = useMemo(() => (lines ? foldUnchanged(lines) : null), [lines]);

  if (!lines || !blocks) {
    return <p className="px-5 py-6 text-sm text-muted-foreground">{t("diffTooLarge")}</p>;
  }
  if (!lines.some((line) => line.kind !== "same")) {
    return <p className="px-5 py-6 text-sm text-muted-foreground">{t("diffSame")}</p>;
  }

  return (
    <>
      {current.trim() === "" ? (
        <p className="border-b px-5 py-3 text-sm text-muted-foreground">{t("diffNoContent")}</p>
      ) : null}
      <div
        role="group"
        aria-label={t("diffLabel")}
        // Scrolls on its own, so it takes the keyboard focus too.
        tabIndex={0}
        className="max-h-[36rem] overflow-auto py-2 font-mono text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {blocks.map((block) =>
          block.kind === "skip" ? (
            <p
              key={`skip-${block.index}`}
              className="my-1 bg-muted/50 px-5 py-1 font-sans text-xs text-muted-foreground"
            >
              {t("diffSkipped", { count: block.count })}
            </p>
          ) : (
            <DiffRow key={block.index} line={block.line} />
          ),
        )}
      </div>
    </>
  );
}

/** One line. The sign and a hidden word say what changed, so color is never the only cue. */
function DiffRow({ line }: { line: DiffLine }) {
  const t = useTranslations("AiDraft");
  const text = line.text === "" ? " " : line.text;

  if (line.kind === "same") {
    return (
      <div className="flex gap-3 px-5 text-muted-foreground">
        <span aria-hidden="true" className="w-3 shrink-0 select-none" />
        <span className="min-w-0 whitespace-pre-wrap break-words">{text}</span>
      </div>
    );
  }

  const added = line.kind === "added";
  const Tag = added ? "ins" : "del";
  return (
    <Tag
      className={cn(
        "flex gap-3 px-5 no-underline",
        added
          ? "bg-emerald-500/10 text-emerald-900 dark:text-emerald-200"
          : "bg-red-500/10 text-red-900 dark:text-red-200",
      )}
    >
      <span aria-hidden="true" className="w-3 shrink-0 select-none font-semibold">
        {added ? "+" : "-"}
      </span>
      <span className="sr-only">{added ? t("diffAdded") : t("diffRemoved")} </span>
      <span className="min-w-0 whitespace-pre-wrap break-words">{text}</span>
    </Tag>
  );
}
