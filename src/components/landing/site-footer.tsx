import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { LEGAL_PAGES, LEGAL_PAGE_KEYS } from "@/content/legal/pages";
import { Link } from "@/i18n/navigation";

// py-1 gives each link a 30px tall target without changing the rhythm.
const footerLinkClass =
  "inline-block rounded py-1 text-small text-muted-foreground transition-colors hover:text-foreground";

/**
 * Footer of the public pages. Pages other than the landing pass its path as
 * sectionBase, so the section links lead back to it.
 */
export function SiteFooter({ sectionBase = "" }: { sectionBase?: string }) {
  const t = useTranslations("Landing.footer");
  const tLegal = useTranslations("Legal.nav");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:grid-cols-2 sm:px-6 md:grid-cols-[1.5fr_auto_auto] md:gap-16 lg:py-16">
        <div className="sm:col-span-2 md:col-span-1">
          <Logo />
          <p className="mt-4 max-w-xs text-small text-muted-foreground">{t("tagline")}</p>
        </div>
        <nav aria-labelledby="footer-product">
          <h2 id="footer-product" className="font-sans text-sm font-medium text-foreground">
            {t("product")}
          </h2>
          <ul className="mt-3 space-y-1">
            <li>
              <a href={`${sectionBase}#fonctionnalites`} className={footerLinkClass}>
                {t("features")}
              </a>
            </li>
            <li>
              <a href={`${sectionBase}#faq`} className={footerLinkClass}>
                {t("faq")}
              </a>
            </li>
            <li>
              <Link href="/tarifs" className={footerLinkClass}>
                {t("pricing")}
              </Link>
            </li>
            <li>
              <Link href="/connexion" className={footerLinkClass}>
                {t("signIn")}
              </Link>
            </li>
          </ul>
        </nav>
        <nav aria-labelledby="footer-legal">
          <h2 id="footer-legal" className="font-sans text-sm font-medium text-foreground">
            {tLegal("label")}
          </h2>
          <ul className="mt-3 space-y-1">
            {LEGAL_PAGE_KEYS.map((key) => (
              <li key={key}>
                {/* No prefetch: five legal pages on every public page would load for nothing. */}
                <Link href={LEGAL_PAGES[key]} prefetch={false} className={footerLinkClass}>
                  {tLegal(key)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </div>
      <div className="border-t">
        <div className="mx-auto flex max-w-6xl flex-col gap-2 px-4 py-6 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between sm:px-6">
          <p>{t("rights", { year })}</p>
          <p>
            {t.rich("madeBy", {
              link: (chunks) => (
                <a
                  href="https://mocktar.com"
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex items-center gap-0.5 rounded font-medium text-foreground underline-offset-4 hover:underline"
                >
                  {chunks}
                  <ArrowUpRight aria-hidden="true" className="size-3.5" />
                  <span className="sr-only">{t("newTab")}</span>
                </a>
              ),
            })}
          </p>
        </div>
      </div>
    </footer>
  );
}
