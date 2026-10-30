import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { PublicPageShell } from "@/components/landing/public-page-shell";
import { Button } from "@/components/ui/button";
import { GUIDE } from "@/content/guide";
import { GUIDE_PATH, GUIDE_PDF_PATH } from "@/content/guide/pages";
import type { Locale } from "@/i18n/routing";
import { publicPageMetadata } from "@/lib/seo/metadata";
import { cn } from "@/lib/utils";
import { GuideBlocks } from "./guide-blocks";

/** Title and description of the guide, in French. */
export async function guideMetadata(locale: Locale): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "Guide" });
  return publicPageMetadata({
    locale,
    path: GUIDE_PATH,
    title: t("metaTitle"),
    description: t("metaDescription"),
  });
}

const tocLinkClass =
  "-ml-px flex gap-2 rounded-r-md border-l border-transparent py-1.5 pl-4 pr-2 text-sm print:py-0.5 text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

/**
 * The user guide (KRB-199), laid out like the legal pages: the public page
 * frame, a table of contents, one numbered part per role and the questions.
 * Server only, so the text adds no JavaScript to the page. The same page,
 * printed by scripts/guide-pdf.mjs, gives the PDF.
 */
export async function GuidePage({ locale }: { locale: Locale }) {
  const [t, format] = await Promise.all([
    getTranslations({ locale, namespace: "Guide" }),
    getFormatter({ locale }),
  ]);
  // Noon UTC, so the day stays the same in any time zone.
  const updatedAt = new Date(`${GUIDE.updatedAt}T12:00:00Z`);

  return (
    <PublicPageShell locale={locale}>
      <header className="max-w-3xl">
        <p className="text-sm font-medium text-muted-foreground">{t("eyebrow")}</p>
        <h1 className="mt-3 text-h1 text-foreground">{t("title")}</h1>
        <p className="mt-4 text-small text-muted-foreground">
          {t.rich("updatedAt", {
            date: format.dateTime(updatedAt, "long"),
            time: (chunks) => <time dateTime={GUIDE.updatedAt}>{chunks}</time>,
          })}
        </p>
        <div className="mt-6 text-lead text-muted-foreground">
          <GuideBlocks blocks={GUIDE.intro} />
        </div>
        {/* The PDF is this page printed: no link to itself inside. */}
        <div className="mt-8 flex flex-wrap items-center gap-x-4 gap-y-2 print:hidden">
          <Button asChild variant="outline" shape="pill" className="h-11 px-5">
            <a href={GUIDE_PDF_PATH} download>
              <Download aria-hidden="true" />
              {t("pdf")}
            </a>
          </Button>
          <p className="text-sm text-muted-foreground">{t("pdfHint")}</p>
        </div>
      </header>

      {/* minmax(0, 1fr): a wide table scrolls in its own box instead of widening the page. */}
      <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-10 lg:mt-16 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16 print:block">
        <nav
          aria-labelledby="sommaire-titre"
          className="lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto print:mb-10 print:break-after-page"
        >
          <h2 id="sommaire-titre" className="font-sans text-sm font-medium text-foreground">
            {t("toc")}
          </h2>
          <ol className="mt-3 space-y-0.5 border-l">
            {GUIDE.parts.map((part, partIndex) => (
              <li key={part.id}>
                <a href={`#${part.id}`} className={cn(tocLinkClass, "font-medium text-foreground")}>
                  {/* The list already numbers the items for screen readers. */}
                  <span aria-hidden="true" className="min-w-[1.375rem] shrink-0 tabular-nums">
                    {partIndex + 1}.
                  </span>
                  <span>{part.title}</span>
                </a>
                <ol className="mb-2">
                  {part.sections.map((section, sectionIndex) => (
                    <li key={section.id}>
                      <a href={`#${section.id}`} className={cn(tocLinkClass, "pl-6")}>
                        <span aria-hidden="true" className="min-w-[1.75rem] shrink-0 tabular-nums">
                          {partIndex + 1}.{sectionIndex + 1}
                        </span>
                        <span>{section.title}</span>
                      </a>
                    </li>
                  ))}
                </ol>
              </li>
            ))}
          </ol>
        </nav>

        <article className="max-w-3xl space-y-20 text-body text-foreground print:max-w-none print:space-y-12">
          {GUIDE.parts.map((part, partIndex) => (
            <section
              key={part.id}
              id={part.id}
              aria-labelledby={`${part.id}-titre`}
              className="scroll-mt-24 print:break-before-page"
            >
              <h2 id={`${part.id}-titre`} className="text-h2 text-foreground">
                <span className="tabular-nums text-muted-foreground">{partIndex + 1}.</span> {part.title}
              </h2>
              {part.intro.length > 0 ? (
                <div className="mt-4 text-lead text-muted-foreground">
                  <GuideBlocks blocks={part.intro} />
                </div>
              ) : null}
              <div className="mt-10 space-y-12">
                {part.sections.map((section, sectionIndex) => (
                  <section key={section.id} id={section.id} className="scroll-mt-24">
                    <h3 className="text-h3 text-foreground sm:text-[1.375rem]">
                      <span className="tabular-nums text-muted-foreground">
                        {partIndex + 1}.{sectionIndex + 1}
                      </span>{" "}
                      {section.title}
                    </h3>
                    <div className="mt-4">
                      <GuideBlocks blocks={section.body} />
                    </div>
                  </section>
                ))}
              </div>
            </section>
          ))}
        </article>
      </div>
    </PublicPageShell>
  );
}
