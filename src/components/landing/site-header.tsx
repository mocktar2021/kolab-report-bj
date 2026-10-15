"use client";

import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Logo } from "@/components/brand/logo";
import { ThemeToggle } from "@/components/theme/theme-toggle";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";

const navLinkClass =
  "rounded-full px-3.5 py-2 text-sm font-medium text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring";

/** True once the page has scrolled past the top few pixels. */
function useScrolled(threshold = 8) {
  const [scrolled, setScrolled] = useState(false);

  useEffect(() => {
    const update = () => setScrolled(window.scrollY > threshold);
    update();
    window.addEventListener("scroll", update, { passive: true });
    return () => window.removeEventListener("scroll", update);
  }, [threshold]);

  return scrolled;
}

/**
 * Transparent over the hero glow, then a blurred bar with a bottom border
 * once the page scrolls. Other pages, like the legal pages, pass the landing
 * path as sectionBase so the section links lead back to it.
 */
export function SiteHeader({ sectionBase = "" }: { sectionBase?: string }) {
  const t = useTranslations("Landing.nav");
  const scrolled = useScrolled();

  return (
    <header
      data-scrolled={scrolled ? "" : undefined}
      className="sticky top-0 z-50 border-b border-transparent transition-[background-color,border-color] duration-300 data-[scrolled]:border-border/70 data-[scrolled]:bg-background/75 data-[scrolled]:backdrop-blur-md"
    >
      <nav
        aria-label={t("label")}
        className="relative mx-auto flex h-16 max-w-6xl items-center justify-between gap-4 px-4 sm:h-[4.5rem] sm:px-6"
      >
        <Link href="/" aria-label={t("home")} className="rounded-lg">
          <Logo />
        </Link>
        <div className="absolute left-1/2 hidden -translate-x-1/2 items-center gap-1 md:flex">
          <a href={`${sectionBase}#fonctionnalites`} className={navLinkClass}>
            {t("features")}
          </a>
          <a href={`${sectionBase}#faq`} className={navLinkClass}>
            {t("faq")}
          </a>
          <Link href="/tarifs" className={navLinkClass}>
            {t("pricing")}
          </Link>
        </div>
        <div className="flex items-center gap-1.5 sm:gap-2">
          <ThemeToggle className="size-11 sm:size-10" />
          <Button asChild shape="pill" className="h-11 px-5 sm:h-10">
            <Link href="/connexion">{t("signIn")}</Link>
          </Button>
        </div>
      </nav>
    </header>
  );
}
