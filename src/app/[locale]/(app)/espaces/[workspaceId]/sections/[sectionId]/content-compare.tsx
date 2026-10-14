"use client";

import { useId, useMemo } from "react";
import { useTranslations } from "next-intl";
import { diffTemplates, type DiffLine } from "@/lib/prompts/diff";

/**
 * The editor's text and the saved one side by side, as Markdown source. The
 * lines found in only one of them are marked.
 */
export function ContentCompare({ mine, saved }: { mine: string; saved: string }) {
  const t = useTranslations("SectionEditor.conflict");
  const lines = useMemo(() => diffTemplates(saved, mine), [saved, mine]);

  if (lines && !lines.some((line) => line.kind !== "same")) {
    return <p className="text-sm text-muted-foreground">{t("same")}</p>;
  }

  return (
    <div className="space-y-2">
      {lines ? null : <p className="text-xs text-muted-foreground">{t("tooLarge")}</p>}
      <div role="group" aria-label={t("compareLabel")} className="grid gap-3 md:grid-cols-2">
        <VersionPanel
          title={t("mine")}
          text={mine}
          lines={lines ? lines.filter((line) => line.kind !== "removed") : null}
        />
        <VersionPanel
          title={t("saved")}
          text={saved}
          lines={lines ? lines.filter((line) => line.kind !== "added") : null}
        />
      </div>
    </div>
  );
}

/** One version. Without lines, the versions were too far apart to mark them. */
function VersionPanel({ title, text, lines }: { title: string; text: string; lines: DiffLine[] | null }) {
  const t = useTranslations("SectionEditor.conflict");
  const titleId = useId();

  return (
    <div className="min-w-0 overflow-hidden rounded-xl border bg-card">
      <h4 id={titleId} className="border-b px-4 py-2 text-xs font-medium">
        {title}
      </h4>
      <div
        role="region"
        aria-labelledby={titleId}
        // Scrolls on its own, so it takes the keyboard focus too.
        tabIndex={0}
        className="max-h-80 overflow-auto py-2 font-mono text-[13px] leading-relaxed outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
      >
        {text.trim() === "" ? (
          <p className="px-4 font-sans text-sm italic text-muted-foreground">{t("empty")}</p>
        ) : lines ? (
          lines.map((line, index) => <VersionLine key={index} line={line} />)
        ) : (
          <p className="whitespace-pre-wrap break-words px-4">{text}</p>
        )}
      </div>
    </div>
  );
}

/** A marked line has a bar and a hidden word, so color is never the only cue. */
function VersionLine({ line }: { line: DiffLine }) {
  const t = useTranslations("SectionEditor.conflict");
  const text = line.text === "" ? " " : line.text;

  if (line.kind === "same") {
    return <div className="whitespace-pre-wrap break-words px-4 text-muted-foreground">{text}</div>;
  }
  return (
    <div className="whitespace-pre-wrap break-words border-l-2 border-highlight bg-highlight/10 pl-[calc(1rem-2px)] pr-4">
      <span className="sr-only">{t("differs")} </span>
      {text}
    </div>
  );
}
