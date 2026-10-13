import { useTranslations } from "next-intl";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { EdgeLines } from "./edge-lines";
import { HeroCards } from "./hero-cards";

// The hero copy animates with CSS so it starts on first paint, before
// hydration, and never holds back the largest contentful paint. It is the
// only entrance on the page that runs without scrolling.
const enter =
  "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:duration-1000 motion-safe:ease-out-expo";

export function Hero() {
  const t = useTranslations("Landing.hero");

  return (
    <section aria-labelledby="hero-title" className="relative pt-14 sm:pt-20 lg:pt-24">
      <EdgeLines side="left" className="top-40 hidden lg:block" />
      <EdgeLines side="right" className="top-40 hidden lg:block" />

      <div className="relative mx-auto max-w-5xl px-4 text-center sm:px-6">
        <h1 id="hero-title" className={cn(enter, "text-display text-foreground")}>
          {t.rich("title", {
            line: (chunks) => <span className="block">{chunks}</span>,
          })}
        </h1>
        <p
          className={cn(
            enter,
            "mx-auto mt-6 max-w-[36rem] text-lead text-muted-foreground motion-safe:delay-100",
          )}
        >
          {t("subtitle")}
        </p>
        <div
          className={cn(
            enter,
            "mx-auto mt-9 flex max-w-xs flex-col gap-3 sm:max-w-none sm:flex-row sm:justify-center motion-safe:delay-200",
          )}
        >
          <Button asChild size="lg" shape="pill" className="h-12 px-7">
            <Link href="/connexion">{t("primaryCta")}</Link>
          </Button>
          <Button asChild variant="soft" size="lg" shape="pill" className="h-12 px-7">
            <a href="#fonctionnalites">{t("secondaryCta")}</a>
          </Button>
        </div>
      </div>

      <HeroCards />
    </section>
  );
}
