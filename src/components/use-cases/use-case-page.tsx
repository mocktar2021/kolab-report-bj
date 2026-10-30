import Image from "next/image";
import { useLocale, useTranslations } from "next-intl";
import { ArrowRight, Check } from "lucide-react";
import { SiteFooter } from "@/components/landing/site-footer";
import { SiteHeader } from "@/components/landing/site-header";
import { WebAnalytics } from "@/components/monitoring/web-analytics";
import { Button } from "@/components/ui/button";
import { figureSrc, GUIDE_FIGURES } from "@/content/guide/figures";
import { USE_CASES, solutionPath, type PlanItem, type UseCaseEntry } from "@/content/use-cases/pages";
import { getPathname, Link } from "@/i18n/navigation";
import { TRIAL } from "@/lib/billing/catalog";

// A use-case page (KRB-262): who it is for, an example plan, what the AI does
// with the deliverables, a screenshot of the guide and the trial button. The
// text is in src/content/use-cases/pages.ts. Server only, like the pricing page.

function PlanRow({ item, number }: { item: PlanItem; number: string }) {
  const t = useTranslations("UseCases");
  return (
    <li className="grid grid-cols-[2.25rem_minmax(0,1fr)] border-t py-4 first:border-t-0">
      <span className="tabular-nums text-muted-foreground">{number}</span>
      <div>
        <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
          <span className="font-medium text-foreground">{item.title}</span>
          {item.who ? (
            <span className="shrink-0 rounded-full border bg-card px-2.5 py-0.5 text-sm text-muted-foreground">
              <span className="sr-only">{t("whoLabel")} </span>
              {item.who}
            </span>
          ) : null}
        </div>
        {item.note ? <p className="mt-1 text-sm text-muted-foreground">{item.note}</p> : null}
        {item.children ? (
          <ol className="mt-3 border-l pl-4">
            {item.children.map((child, index) => (
              <PlanRow key={child.title} item={child} number={`${number}.${index + 1}`} />
            ))}
          </ol>
        ) : null}
      </div>
    </li>
  );
}

function Bullets({ items }: { items: readonly string[] }) {
  return (
    <ul className="mt-6 space-y-3">
      {items.map((item) => (
        <li key={item} className="flex gap-3 text-foreground">
          <Check aria-hidden="true" className="mt-1 size-4 shrink-0 text-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

export function UseCasePage({ useCase }: { useCase: UseCaseEntry }) {
  const t = useTranslations("UseCases");
  const tLanding = useTranslations("Landing");
  // The header and footer link to sections of the landing page.
  const landing = getPathname({ href: "/", locale: useLocale() });
  const figure = GUIDE_FIGURES[useCase.figure];
  const others = USE_CASES.filter((other) => other.slug !== useCase.slug);

  return (
    <div className="relative isolate">
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 -z-10 h-[36rem] bg-glow [mask-image:linear-gradient(to_bottom,#000_45%,transparent)]"
      />
      <a
        href="#contenu"
        className="sr-only focus:not-sr-only focus:fixed focus:left-4 focus:top-4 focus:z-[60] focus:rounded-full focus:bg-foreground focus:px-4 focus:py-2 focus:text-sm focus:text-background"
      >
        {tLanding("skipToContent")}
      </a>
      <SiteHeader sectionBase={landing} />
      <main id="contenu" className="mx-auto max-w-6xl px-4 pb-24 pt-10 sm:px-6 sm:pt-16">
        <header className="max-w-3xl">
          <p className="text-sm font-medium text-muted-foreground">{useCase.eyebrow}</p>
          <h1 className="mt-3 text-h1 text-foreground">{useCase.title}</h1>
          <p className="mt-4 text-lead text-muted-foreground">{useCase.lead}</p>
          <div className="mt-8 flex flex-col gap-3 sm:flex-row">
            <Button asChild size="lg" shape="pill" className="h-12 px-7">
              <Link href="/inscription">{t("cta.trial")}</Link>
            </Button>
            <Button asChild variant="soft" size="lg" shape="pill" className="h-12 px-7">
              <Link href="/tarifs">{t("cta.pricing")}</Link>
            </Button>
          </div>
        </header>

        <section aria-labelledby="pour-qui" className="mt-20 max-w-3xl sm:mt-24">
          <h2 id="pour-qui" className="text-h2 text-foreground">
            {t("audienceTitle")}
          </h2>
          <Bullets items={useCase.audience} />
          <p className="mt-6 text-muted-foreground">{useCase.audienceNote}</p>
        </section>

        <section aria-labelledby="plan-type" className="mt-20 max-w-3xl sm:mt-24">
          <h2 id="plan-type" className="text-h2 text-foreground">
            {useCase.planTitle}
          </h2>
          <p className="mt-3 text-muted-foreground">{useCase.planIntro}</p>
          <ol className="surface-card mt-8 rounded-2xl border px-5 py-1 shadow-sm">
            {useCase.plan.map((item, index) => (
              <PlanRow key={item.title} item={item} number={`${index + 1}`} />
            ))}
          </ol>
        </section>

        <section
          aria-labelledby="ia"
          className="mt-20 grid items-start gap-10 sm:mt-24 lg:grid-cols-2 lg:gap-14"
        >
          <div>
            <h2 id="ia" className="text-h2 text-foreground">
              {t("aiTitle")}
            </h2>
            <Bullets items={useCase.ai} />
          </div>
          <figure className="overflow-hidden rounded-xl border bg-card shadow-sm">
            <Image
              src={figureSrc(useCase.figure)}
              alt={figure.alt}
              width={figure.width}
              height={figure.height}
              sizes="(min-width: 1024px) 36rem, 100vw"
              className="h-auto w-full"
            />
            <figcaption className="border-t px-4 py-2.5 text-sm text-muted-foreground">
              {useCase.figureCaption}
            </figcaption>
          </figure>
        </section>

        <section
          aria-labelledby="essai-title"
          className="surface-feature relative mt-24 overflow-hidden rounded-[28px] border px-6 py-14 text-center sm:mt-28 sm:px-10"
        >
          <h2 id="essai-title" className="text-h2 text-foreground">
            {t("cta.title")}
          </h2>
          <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
            {t("cta.subtitle", { days: TRIAL.days })}
          </p>
          <Button asChild size="lg" shape="pill" className="mt-8 h-12 px-7">
            <Link href="/inscription">{t("cta.trial")}</Link>
          </Button>
        </section>

        <nav aria-labelledby="autres-rapports" className="mt-20">
          <h2 id="autres-rapports" className="text-h3 text-foreground">
            {t("othersTitle")}
          </h2>
          <ul className="mt-4 grid gap-3 sm:grid-cols-2">
            {others.map((other) => (
              <li key={other.slug}>
                <Link
                  href={solutionPath(other.slug)}
                  className="surface-card group flex h-full items-start justify-between gap-4 rounded-2xl border p-5 transition-colors hover:border-foreground/30"
                >
                  <span>
                    <span className="block font-medium text-foreground">{other.label}</span>
                    <span className="mt-1 block text-sm text-muted-foreground">{other.summary}</span>
                  </span>
                  <ArrowRight
                    aria-hidden="true"
                    className="mt-1 size-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                  />
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      </main>
      <SiteFooter sectionBase={landing} />
      <WebAnalytics />
    </div>
  );
}
