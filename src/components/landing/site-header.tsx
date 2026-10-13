import { useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

const navLinkClass =
  "hidden rounded-full px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground sm:inline-flex";

export function SiteHeader() {
  const t = useTranslations("Landing.nav");

  return (
    <header className="sticky top-0 z-50 px-4 pt-3 sm:pt-4">
      <nav
        aria-label={t("label")}
        className="glass mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 rounded-full pl-4 pr-2 shadow-sm sm:pl-5"
      >
        <Link href="/" aria-label={t("home")} className="rounded-full">
          <Logo />
        </Link>
        <div className="flex items-center gap-1">
          <a href="#fonctionnalites" className={navLinkClass}>
            {t("features")}
          </a>
          <a href="#faq" className={navLinkClass}>
            {t("faq")}
          </a>
          <ThemeToggle />
          <Button asChild size="sm" shape="pill" className="ml-1 h-9 px-4 text-sm">
            <Link href="/connexion">{t("signIn")}</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
