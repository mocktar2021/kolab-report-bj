import { useTranslations } from "next-intl";
import { Markdown } from "@/components/markdown";

type SectionContentProps = {
  content: string | null;
  /** For editors who can ask for a draft: the empty state says it can start the section. */
  draftHint: boolean;
};

/** The section's text, as Markdown, for every member who can see the section. */
export function SectionContent({ content, draftHint }: SectionContentProps) {
  const t = useTranslations("AiDraft");
  const text = content?.trim() ? content : null;

  return (
    <section
      aria-labelledby="section-content-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        {/* Takes the focus once a draft is accepted. */}
        <h2
          id="section-content-title"
          tabIndex={-1}
          className="rounded-sm font-medium outline-none focus-visible:ring-2 focus-visible:ring-ring"
        >
          {t("contentTitle")}
        </h2>
      </div>
      {text ? (
        <div className="break-words px-5 py-4 text-sm leading-relaxed">
          <Markdown
            headingLevel={3}
            headings="flatten"
            links="text"
            fallback={<p className="text-destructive">{t("contentError")}</p>}
          >
            {text}
          </Markdown>
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
