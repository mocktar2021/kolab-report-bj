"use client";

import { useId, useState, type ReactNode } from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/components/markdown";
import { PreviewToggle } from "@/components/preview-toggle";
import { cn } from "@/lib/utils";

type SectionContentProps = {
  content: string | null;
  /** For editors who can ask for a draft: the empty state says it can start the section. */
  draftHint: boolean;
  /** Next to the title, for example the edit button. */
  actions?: ReactNode;
  /** Shown instead of the text when given, for example the editor. */
  children?: ReactNode;
};

/**
 * The section's text, as Markdown, for every member who can see the section.
 * The text shows with "Aperçu" (KRB-201), and on its own when the title takes
 * the focus, after a save or an accepted draft. An empty section shows its
 * message right away.
 */
export function SectionContent({ content, draftHint, actions, children }: SectionContentProps) {
  const t = useTranslations("AiDraft");
  const [open, setOpen] = useState(false);
  const bodyId = useId();
  const text = content?.trim() ? content : null;
  // The editor takes the place of the text, with nothing to show or hide.
  const toggle = text !== null && !children;
  const body = Boolean(children) || text === null || open;

  return (
    <section
      aria-labelledby="section-content-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-4",
          body && "border-b",
        )}
      >
        {/* Takes the focus once a draft is accepted or the text is saved. */}
        <h2
          id="section-content-title"
          tabIndex={-1}
          onFocus={() => setOpen(true)}
          className="rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("contentTitle")}
        </h2>
        {toggle || actions ? (
          <div className="flex flex-wrap items-center gap-3">
            {actions}
            {toggle ? (
              <PreviewToggle
                open={open}
                onOpenChange={setOpen}
                controls={bodyId}
                labels={{
                  show: t("contentPreview"),
                  hide: t("contentHide"),
                  showName: t("contentPreviewLabel"),
                  hideName: t("contentHideLabel"),
                }}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {children ? (
        children
      ) : text ? (
        <div id={bodyId} hidden={!open} className="break-words px-5 py-4 text-sm leading-relaxed">
          {open ? (
            <Markdown
              headingLevel={3}
              headings="flatten"
              links="text"
              images="deliverables"
              fallback={<p className="text-destructive">{t("contentError")}</p>}
            >
              {text}
            </Markdown>
          ) : null}
        </div>
      ) : (
        <div className="px-5 py-10 text-center text-sm text-muted-foreground">
          <p>{t("contentEmpty")}</p>
          {draftHint ? <p className="mt-1">{t("contentEmptyEditor")}</p> : null}
        </div>
      )}
    </section>
  );
}
