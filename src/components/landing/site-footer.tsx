import { useTranslations } from "next-intl";
import { ArrowUpRight } from "lucide-react";
import { Logo } from "@/components/brand/logo";
import { Link } from "@/i18n/navigation";

// py-1 gives each link a 30px tall target without changing the rhythm.
const footerLinkClass =
  "inline-block rounded py-1 text-small text-muted-foreground transition-colors hover:text-foreground";

export function SiteFooter() {
  const t = useTranslations("Landing.footer");
  const year = new Date().getFullYear();

  return (
    <footer className="border-t">
      <div className="mx-auto grid max-w-6xl gap-10 px-4 py-14 sm:px-6 md:grid-cols-[1.5fr_1fr] lg:py-16">
        <div>
          <Logo />
          <p className="mt-4 max-w-xs text-small text-muted-foreground">{t("tagline")}</p>
        </div>
        <nav aria-labelledby="footer-product" className="md:justify-self-end">
          <h2 id="footer-product" className="font-sans text-sm font-medium text-foreground">
            {t("product")}
          </h2>
          <ul className="mt-3 space-y-1">
            <li>
              <a href="#fonctionnalites" className={footerLinkClass}>
                {t("features")}
              </a>
            </li>
            <li>
              <a href="#faq" className={footerLinkClass}>
                {t("faq")}
              </a>
            </li>
            <li>
              <Link href="/connexion" className={footerLinkClass}>
                {t("signIn")}
              </Link>
            </li>
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
