import { useTranslations } from "next-intl";
import { Markdown } from "@/components/markdown";
import { StatusBadge } from "@/components/status-badge";
import { EditLink, sectionAnchor, type SectionRowData } from "./section-list";

export type ReportSection = SectionRowData & {
  /** The section text, as Markdown. */
  content: string | null;
};

type ReportDocumentProps = {
  workspaceId: string;
  sections: ReportSection[];
};

/**
 * The full text of the report, section after section, for every member.
 * Section titles are h3 under the "Texte du rapport" h2. In the text, #, ##
 * and ### become h4 (drafts use ###), deeper headings h5 and h6, as on the
 * section page.
 */
export function ReportDocument({ workspaceId, sections }: ReportDocumentProps) {
  const t = useTranslations("Report");
  if (sections.length === 0) return null;

  return (
    <section
      aria-labelledby="document-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2 id="document-title" className="font-medium">
          {t("documentTitle")}
        </h2>
      </div>
      <div className="divide-y">
        {sections.map((section, index) => (
          <SectionArticle key={section.id} workspaceId={workspaceId} index={index} section={section} />
        ))}
      </div>
    </section>
  );
}

function SectionArticle({
  workspaceId,
  index,
  section,
}: {
  workspaceId: string;
  index: number;
  section: ReportSection;
}) {
  const t = useTranslations("Report");
  const anchor = sectionAnchor(section.id);
  const text = section.content?.trim() ? section.content : null;

  return (
    <article id={anchor} aria-labelledby={`${anchor}-title`} className="px-5 py-6 sm:px-8">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
        <h3 id={`${anchor}-title`} className="min-w-0 break-words text-h3 text-foreground">
          <span className="mr-1 tabular-nums text-muted-foreground">{index + 1}.</span> {section.title}
        </h3>
        {section.canEdit ? (
          <EditLink
            workspaceId={workspaceId}
            section={section}
            className="shrink-0 self-start text-sm sm:mt-1"
          />
        ) : null}
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <StatusBadge status={section.status} />
        <span>{section.assigneeName ?? t("unassigned")}</span>
        {section.mine ? (
          <span className="rounded-full bg-highlight/10 px-2 py-0.5 text-[11px] font-medium text-highlight">
            {t("yourSection")}
          </span>
        ) : null}
      </div>
      {text ? (
        <div className="mt-4 max-w-3xl break-words text-sm leading-relaxed">
          <Markdown
            headingLevel={4}
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
}
