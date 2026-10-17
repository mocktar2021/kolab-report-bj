import { memo, useId } from "react";
import { useTranslations } from "next-intl";
import { Markdown } from "@/components/markdown";
import { PreviewToggle } from "@/components/preview-toggle";
import { StatusBadge } from "@/components/status-badge";
import { cn } from "@/lib/utils";
import { EditLink, sectionAnchor, type SectionRowData } from "./section-list";

export type ReportSection = SectionRowData & {
  /** The section text, as Markdown. */
  content: string | null;
};

type ReportDocumentProps = {
  workspaceId: string;
  sections: ReportSection[];
  /** The text shows with "Aperçu" (KRB-201). The table of contents opens it too. */
  open: boolean;
  onOpenChange: (open: boolean) => void;
};

/**
 * The full text of the report, section after section, for every member.
 * Section titles are h3 under the "Texte du rapport" h2, subsection titles h4
 * (KRB-195). In the text of a section, #, ## and ### become h4 (drafts use
 * ###), deeper headings h5 and h6, as on the section page; in a subsection,
 * one level lower.
 */
export function ReportDocument({ workspaceId, sections, open, onOpenChange }: ReportDocumentProps) {
  const t = useTranslations("Report");
  const bodyId = useId();
  if (sections.length === 0) return null;

  return (
    <section
      aria-labelledby="document-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div
        className={cn(
          "flex flex-wrap items-center justify-between gap-x-3 gap-y-2 px-5 py-4",
          open && "border-b",
        )}
      >
        <h2 id="document-title" className="font-medium">
          {t("documentTitle")}
        </h2>
        <PreviewToggle
          open={open}
          onOpenChange={onOpenChange}
          controls={bodyId}
          labels={{
            show: t("documentPreview"),
            hide: t("documentHide"),
            showName: t("documentPreviewLabel"),
            hideName: t("documentHideLabel"),
          }}
        />
      </div>
      <div id={bodyId} hidden={!open} className="divide-y">
        {open
          ? sections.map((section) => (
              <SectionArticle
                key={section.id}
                workspaceId={workspaceId}
                label={section.label}
                level={section.level}
                id={section.id}
                title={section.title}
                content={section.content}
                status={section.status}
                assigneeName={section.assigneeName}
                mine={section.mine}
                canEdit={section.canEdit}
              />
            ))
          : null}
      </div>
    </section>
  );
}

type SectionArticleProps = Pick<
  ReportSection,
  "id" | "title" | "label" | "level" | "content" | "status" | "assigneeName" | "mine" | "canEdit"
> & {
  workspaceId: string;
};

/**
 * One section of the text. The props are plain values, so a refresh that
 * brings new section objects only draws again the sections that changed.
 */
const SectionArticle = memo(function SectionArticle({
  workspaceId,
  label,
  level,
  id,
  title,
  content,
  status,
  assigneeName,
  mine,
  canEdit,
}: SectionArticleProps) {
  const t = useTranslations("Report");
  const anchor = sectionAnchor(id);
  const text = content?.trim() ? content : null;
  const sub = level === 2;
  const Title = sub ? "h4" : "h3";

  return (
    <article
      id={anchor}
      aria-labelledby={`${anchor}-title`}
      className={cn("py-6 pr-5 sm:pr-8", sub ? "pl-9 sm:pl-14" : "pl-5 sm:pl-8")}
    >
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <Title
          id={`${anchor}-title`}
          className={cn("min-w-0 break-words text-foreground", sub ? "text-lg font-semibold" : "text-h3")}
        >
          <span className="mr-1 tabular-nums text-muted-foreground">{label}</span> {title}
        </Title>
        {canEdit ? (
          <EditLink
            workspaceId={workspaceId}
            section={{ id, title }}
            className="shrink-0 self-start text-sm sm:mt-1"
          />
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <StatusBadge status={status} />
        <span>{assigneeName ?? t("unassigned")}</span>
        {mine ? (
          <span className="rounded-full bg-highlight/10 px-2 py-0.5 text-[11px] font-medium text-highlight">
            {t("yourSection")}
          </span>
        ) : null}
      </div>
      {text ? (
        <div className="mt-4 max-w-3xl break-words text-sm leading-relaxed">
          <Markdown
            headingLevel={sub ? 5 : 4}
            headings="flatten"
            links="text"
            fallback={<p className="text-destructive">{t("contentError")}</p>}
          >
            {text}
          </Markdown>
        </div>
      ) : (
        <p className="mt-4 text-sm text-muted-foreground">{t("emptySection")}</p>
      )}
    </article>
  );
});
