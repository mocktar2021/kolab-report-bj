import { useTranslations } from "next-intl";
import { Check } from "lucide-react";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { PUBLISHER } from "@/content/legal/publisher";
import { Link } from "@/i18n/navigation";
import { aiTokensFor, INSTITUTION, OFFERS, PLANS, tokenVolumeLabel, TRIAL } from "@/lib/billing/catalog";
import { formatXof } from "@/lib/billing/format";
import { PRICING_PLANS, planFeatures, planPrices, type PlanFeature } from "@/lib/billing/pricing";
import { cn } from "@/lib/utils";

// The offers of the pricing page (KRB-179), built from the catalogue. Server
// only: the cards add no JavaScript to the page.

function FeatureList({ items }: { items: ReactNode[] }) {
  const t = useTranslations("Pricing.features");
  return (
    <ul aria-label={t("label")} className="mt-6 space-y-2.5 text-sm text-foreground">
      {items.map((item, index) => (
        <li key={index} className="flex gap-2.5">
          <Check aria-hidden="true" className="mt-0.5 size-4 shrink-0 text-primary" />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function useFeatureText() {
  const t = useTranslations("Pricing.features");
  return (feature: PlanFeature) =>
    "count" in feature
      ? t(feature.key, { count: feature.count })
      : "volume" in feature
        ? t(feature.key, { volume: feature.volume })
        : t(feature.key);
}

function Card({
  id,
  title,
  className,
  children,
}: {
  id: string;
  title: string;
  className?: string;
  children: ReactNode;
}) {
  return (
    <article
      aria-labelledby={id}
      className={cn("surface-card flex flex-col rounded-2xl border p-6 shadow-sm", className)}
    >
      <h3 id={id} className="text-lg font-semibold text-foreground">
        {title}
      </h3>
      {children}
    </article>
  );
}

function Price({ amount, unit }: { amount: string; unit: string }) {
  return (
    <p className="mt-5 flex flex-wrap items-baseline gap-x-2">
      <span className="text-3xl font-semibold tabular-nums tracking-tight text-foreground">{amount}</span>{" "}
      <span className="text-sm text-muted-foreground">{unit}</span>
    </p>
  );
}

/** The trial, Indépendant, Cabinet and Institution, side by side. */
export function PlanGrid() {
  const t = useTranslations("Pricing");
  const feature = useFeatureText();
  const quoteHref = `mailto:${PUBLISHER.email}?subject=${encodeURIComponent(t("quoteSubject"))}`;

  return (
    <div className="mt-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {PRICING_PLANS.map(({ code, features }) => {
        const id = `offre-${code}`;
        const items: ReactNode[] = features.map(feature);

        if (code === "trial") {
          return (
            <Card key={code} id={id} title={PLANS.trial.label}>
              <p className="mt-1 text-sm text-muted-foreground">{t("plans.trial.description")}</p>
              <Price amount={t("plans.trial.price")} unit={t("plans.trial.period", { days: TRIAL.days })} />
              <FeatureList items={items} />
              <div className="mt-auto pt-8">
                <Button asChild shape="pill" className="h-11 w-full">
                  <Link href="/inscription">{t("startTrial")}</Link>
                </Button>
              </div>
            </Card>
          );
        }

        if (code === "institution") {
          // The default quota is a starting point: the contract sets the real one.
          const institutionItems = features.flatMap((item) =>
            item.key === "draftsPerMonth"
              ? [feature(item), t("plans.institution.contractDrafts")]
              : [feature(item)],
          );
          institutionItems.splice(
            -1,
            0,
            t("plans.institution.onboarding", { hours: INSTITUTION.onboardingHours }),
          );
          return (
            <Card key={code} id={id} title={PLANS.institution.label}>
              <p className="mt-1 text-sm text-muted-foreground">{t("plans.institution.description")}</p>
              <Price
                amount={t("plans.institution.price")}
                unit={t("plans.institution.period", { price: formatXof(INSTITUTION.fromMonthlyPriceHtXof) })}
              />
              <p className="mt-2 text-sm text-muted-foreground">
                {t("plans.institution.terms", { months: INSTITUTION.minMonths })}
              </p>
              <FeatureList items={institutionItems} />
              <div className="mt-auto pt-8">
                <Button asChild variant="soft" shape="pill" className="h-11 w-full">
                  <a href={quoteHref} aria-label={t("quoteLabel", { email: PUBLISHER.email })}>
                    {t("quote")}
                  </a>
                </Button>
              </div>
            </Card>
          );
        }

        const prices = planPrices(code);
        return (
          <Card key={code} id={id} title={PLANS[code].label}>
            <p className="mt-1 text-sm text-muted-foreground">{t(`plans.${code}.description`)}</p>
            <Price amount={formatXof(prices.month)} unit={t("perMonth")} />
            <ul aria-label={t("lengths.label")} className="mt-2 space-y-0.5 text-sm text-muted-foreground">
              <li>{t("lengths.quarter", { price: formatXof(prices.quarter) })}</li>
              <li className="flex flex-wrap items-center gap-x-2 gap-y-1">
                {t("lengths.year", { price: formatXof(prices.year) })}
                <span className="sr-only">, </span>
                {/* The yearly discount stands out. Dark text keeps the contrast in both themes. */}
                <span className="rounded-full bg-highlight/10 px-2 py-0.5 text-xs font-medium text-foreground ring-1 ring-inset ring-highlight/30 dark:bg-highlight/15">
                  {t("lengths.yearSaving", { freeMonths: prices.freeMonths })}
                </span>
              </li>
            </ul>
            <FeatureList items={items} />
            <div className="mt-auto pt-8">
              <Button asChild variant="soft" shape="pill" className="h-11 w-full">
                <Link href="/inscription">{t("tryFree")}</Link>
              </Button>
            </div>
          </Card>
        );
      })}
    </div>
  );
}

/** Pass Mission and Pack IA, bought on their own or on top of a plan. */
export function Extras() {
  const t = useTranslations("Pricing");
  const feature = useFeatureText();
  const pass = OFFERS.mission_pass;
  const pack = OFFERS.ai_pack_100;
  const passFeatures = planFeatures(PLANS.mission.limits, { activeReports: false }).filter(
    // The description already says one report.
    (item) => item.key !== "reports",
  );

  return (
    <div className="mt-8 grid gap-4 md:grid-cols-2">
      <Card id="offre-mission" title={PLANS.mission.label}>
        <p className="mt-1 text-sm text-muted-foreground">{t("mission.description", { days: pass.days })}</p>
        <Price amount={formatXof(pass.priceHtXof)} unit={t("mission.unit")} />
        <FeatureList items={passFeatures.map(feature)} />
      </Card>
      <Card id="offre-pack-ia" title={t("pack.title")}>
        <p className="mt-1 text-sm text-muted-foreground">
          {t("pack.description", {
            drafts: pack.drafts,
            volume: tokenVolumeLabel(aiTokensFor(pack.drafts) ?? 0),
            months: pack.validMonths,
          })}
        </p>
        <Price amount={formatXof(pack.priceHtXof)} unit={t("pack.unit")} />
        <FeatureList items={[t("pack.max", { max: pack.maxQuantity }), t("pack.paidOnly")]} />
      </Card>
    </div>
  );
}
