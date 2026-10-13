import { useTranslations } from "next-intl";
import { CountUp } from "@/components/motion/count-up";
import { FadeIn } from "@/components/motion/fade-in";

// Product facts only, each one backed by the code: the workspace_role enum,
// the 50 MB bucket limit, the single fr locale and the offline fallback.
const ROLE_COUNT = 4;
const MAX_UPLOAD_MB = 50;
const FRENCH_UI_PERCENT = 100;

// One row per fact on phones (value left, label right), stacked cards from sm up.
const itemClass =
  "flex flex-row-reverse items-center justify-between gap-4 bg-card px-6 py-5 sm:flex-col-reverse sm:items-start sm:justify-end sm:gap-1.5 sm:p-7";
const valueClass =
  "whitespace-nowrap text-[clamp(2rem,1rem+1.9vw,2.5rem)] font-semibold leading-tight tracking-[-0.02em] text-foreground";
const labelClass = "max-w-[11rem] text-right text-small text-muted-foreground sm:max-w-none sm:text-left";
const unitClass = "ml-1.5 text-[0.6em] text-muted-foreground";

export function Facts() {
  const t = useTranslations("Landing.facts");

  return (
    <section aria-labelledby="facts-title" className="mx-auto max-w-6xl px-4 sm:px-6">
      <h2 id="facts-title" className="sr-only">
        {t("title")}
      </h2>
      <FadeIn>
        <dl className="grid gap-px overflow-hidden rounded-3xl border bg-border shadow-sm sm:grid-cols-2 lg:grid-cols-4">
          <div className={itemClass}>
            <dt className={labelClass}>{t("roles")}</dt>
            <dd className={valueClass}>
              <CountUp value={ROLE_COUNT} duration={0.9} />
            </dd>
          </div>
          <div className={itemClass}>
            <dt className={labelClass}>{t("size")}</dt>
            <dd className={valueClass}>
              <CountUp value={MAX_UPLOAD_MB} />
              <span className={unitClass}>{t("sizeUnit")}</span>
            </dd>
          </div>
          <div className={itemClass}>
            <dt className={labelClass}>{t("french")}</dt>
            <dd className={valueClass}>
              <CountUp value={FRENCH_UI_PERCENT} />
              <span className={unitClass}>{t("frenchUnit")}</span>
            </dd>
          </div>
          <div className={itemClass}>
            <dt className={labelClass}>{t("offline")}</dt>
            <dd className={valueClass}>{t("offlineValue")}</dd>
          </div>
        </dl>
      </FadeIn>
    </section>
  );
}
