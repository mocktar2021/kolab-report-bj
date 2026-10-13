import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Link } from "@/i18n/navigation";
import { cn } from "@/lib/utils";
import { HeroMockup } from "./hero-mockup";

// The hero copy animates with CSS so it starts on first paint, before
// hydration, and never holds back the largest contentful paint.
const enter =
  "motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-bottom-4 motion-safe:fill-mode-both motion-safe:duration-1000 motion-safe:ease-out-expo";

export function Hero() {
  const t = useTranslations("Landing.hero");

  return (
    <section aria-labelledby="hero-title" className="relative isolate pt-14 sm:pt-20 lg:pt-24">
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[56rem] bg-glow" />
      <div aria-hidden="true" className="pointer-events-none absolute inset-x-0 -top-24 -z-10 h-[56rem] bg-grid" />

      <div className="mx-auto max-w-5xl px-4 text-center sm:px-6">
        <p
          className={cn(
            enter,
            "glass inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-[0.8125rem] font-medium text-muted-foreground shadow-sm",
          )}
        >
          <span aria-hidden="true" className="size-1.5 rounded-full bg-foreground/70" />
          {t("eyebrow")}
        </p>
        <h1
          id="hero-title"
          className={cn(enter, "mt-6 text-display text-foreground motion-safe:delay-100")}
        >
          {t.rich("title", {
            muted: (chunks) => <span className="block text-muted-foreground">{chunks}</span>,
          })}
        </h1>
        <p
          className={cn(
            enter,
            "mx-auto mt-6 max-w-2xl text-lead text-muted-foreground motion-safe:delay-200",
          )}
        >
          {t("subtitle")}
        </p>
        <div
          className={cn(
            enter,
            "mt-10 flex flex-col items-stretch justify-center gap-3 sm:flex-row sm:items-center motion-safe:delay-300",
          )}
        >
          <Button asChild size="lg" shape="pill" className="group shadow-md">
            <Link href="/connexion">
              {t("primaryCta")}
              <ArrowRight
                aria-hidden="true"
                className="transition-transform duration-300 ease-out-expo motion-safe:group-hover:translate-x-0.5"
              />
            </Link>
          </Button>
          <Button asChild variant="glass" size="lg" shape="pill">
            <a href="#fonctionnalites">{t("secondaryCta")}</a>
          </Button>
        </div>
        <p className={cn(enter, "mt-5 text-sm text-muted-foreground motion-safe:delay-500")}>
          {t("note")}
        </p>
      </div>

      <HeroMockup />
    </section>
  );
}
