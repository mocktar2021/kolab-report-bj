import type { Metadata } from "next";
import { getFormatter, getTranslations } from "next-intl/server";
import { PublicPageShell } from "@/components/landing/public-page-shell";
import type { Locale } from "@/i18n/routing";
import { LEGAL_DOCUMENTS } from "@/content/legal";
import type { LegalPageKey } from "@/content/legal/pages";
import { LegalBlocks } from "./legal-blocks";

/** Title and description of a legal page, in French. */
export async function legalMetadata(locale: Locale, page: LegalPageKey): Promise<Metadata> {
  const t = await getTranslations({ locale, namespace: "Legal.pages" });
  return { title: t(`${page}.title`), description: t(`${page}.description`) };
}

/**
 * A legal page (KRB-159): the public page frame around the text, a table of
 * contents and the date of the last change. Server only, so the text adds no
 * JavaScript to the page.
 */
export async function LegalPage({ locale, page }: { locale: Locale; page: LegalPageKey }) {
  const document = LEGAL_DOCUMENTS[page];
  const [t, format] = await Promise.all([
    getTranslations({ locale, namespace: "Legal" }),
    getFormatter({ locale }),
  ]);
  // Noon UTC, so the day stays the same in any time zone.
  const updatedAt = new Date(`${document.updatedAt}T12:00:00Z`);

  return (
    <PublicPageShell locale={locale}>
      <header className="max-w-3xl">
        <p className="text-sm font-medium text-muted-foreground">{t("eyebrow")}</p>
        <h1 className="mt-3 text-h1 text-foreground">{t(`pages.${page}.title`)}</h1>
        <p className="mt-4 text-small text-muted-foreground">
          {t.rich("updatedAt", {
            date: format.dateTime(updatedAt, "long"),
            time: (chunks) => <time dateTime={document.updatedAt}>{chunks}</time>,
          })}
        </p>
        <div className="mt-6 text-lead text-muted-foreground">
          <LegalBlocks blocks={document.intro} />
        </div>
      </header>

      {/* minmax(0, 1fr): a wide table scrolls in its own box instead of widening the page. */}
      <div className="mt-12 grid grid-cols-[minmax(0,1fr)] gap-10 lg:mt-16 lg:grid-cols-[15rem_minmax(0,1fr)] lg:gap-16">
        <nav
          aria-labelledby="sommaire-titre"
          className="lg:sticky lg:top-24 lg:max-h-[calc(100dvh-7rem)] lg:self-start lg:overflow-y-auto"
        >
          <h2 id="sommaire-titre" className="font-sans text-sm font-medium text-foreground">
            {t("toc")}
          </h2>
          <ol className="mt-3 space-y-0.5 border-l">
            {document.sections.map((section, index) => (
              <li key={section.id}>
                <a
                  href={`#${section.id}`}
                  className="-ml-px flex gap-2 rounded-r-md border-l border-transparent py-1.5 pl-4 pr-2 text-sm text-muted-foreground transition-colors hover:border-foreground/40 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                >
                  {/* The list already numbers the items for screen readers. */}
                  <span aria-hidden="true" className="min-w-[1.375rem] shrink-0 tabular-nums">
                    {index + 1}.
                  </span>
                  <span>{section.title}</span>
                </a>
              </li>
            ))}
          </ol>
        </nav>

        <article className="max-w-3xl space-y-12 text-body text-foreground">
          {document.sections.map((section, index) => (
            <section key={section.id} id={section.id} className="scroll-mt-24">
              <h2 className="text-h3 text-foreground sm:text-[1.375rem]">
                <span className="tabular-nums text-muted-foreground">{index + 1}.</span> {section.title}
              </h2>
              <div className="mt-4">
                <LegalBlocks blocks={section.body} />
              </div>
            </section>
          ))}
        </article>
      </div>
    </PublicPageShell>
  );
}
