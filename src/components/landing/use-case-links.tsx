import { useTranslations } from "next-intl";
import { ArrowRight } from "lucide-react";
import { FadeIn } from "@/components/motion/fade-in";
import { USE_CASES, solutionPath } from "@/content/use-cases/pages";
import { Link } from "@/i18n/navigation";

/** Links to the use-case pages (KRB-262), between the features and the FAQ. */
export function UseCaseLinks() {
  const t = useTranslations("UseCases.landing");

  return (
    <section
      id="cas-usage"
      aria-labelledby="cas-usage-title"
      className="mx-auto max-w-6xl scroll-mt-20 px-4 pt-28 sm:px-6 sm:pt-36"
    >
      <FadeIn className="mx-auto max-w-2xl text-center">
        <h2 id="cas-usage-title" className="text-h1 text-foreground">
          {t("title")}
        </h2>
        <p className="mt-4 text-lead text-muted-foreground">{t("subtitle")}</p>
      </FadeIn>
      <FadeIn delay={0.1}>
        <ul className="mt-12 grid gap-4 sm:mt-16 md:grid-cols-3">
          {USE_CASES.map((useCase) => (
            <li key={useCase.slug}>
              <Link
                href={solutionPath(useCase.slug)}
                className="surface-feature group flex h-full flex-col justify-between gap-6 rounded-[28px] border p-6 transition-colors hover:border-foreground/30"
              >
                <span>
                  <span className="block text-h3 text-foreground">{useCase.label}</span>
                  <span className="mt-2 block text-muted-foreground">{useCase.summary}</span>
                </span>
                <ArrowRight
                  aria-hidden="true"
                  className="size-5 text-muted-foreground transition-transform group-hover:translate-x-0.5"
                />
              </Link>
            </li>
          ))}
        </ul>
      </FadeIn>
    </section>
  );
}
