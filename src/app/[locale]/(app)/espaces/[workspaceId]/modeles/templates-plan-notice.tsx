import { useTranslations } from "next-intl";
import { Info } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { PLANS } from "@/lib/billing/catalog";
import { billingPagePath } from "@/lib/billing/navigation";
import type { TemplatePlan } from "@/lib/prompts/plan";
import { cn } from "@/lib/utils";

/** Id of the notice, for the disabled buttons that point to it with aria-describedby. */
export const TEMPLATES_PLAN_NOTICE_ID = "modeles-offre";

/**
 * Says the organization's plan has no custom templates (KRB-198), on the
 * pages that would otherwise fail on save. People who buy for the
 * organization get its billing page, the others the public offers.
 */
export function TemplatesPlanNotice({ plan, className }: { plan: TemplatePlan; className?: string }) {
  const t = useTranslations("Prompts.plan");
  const text = plan.plan ? t("notice", { plan: PLANS[plan.plan].label }) : t("noticeNoPlan");
  const href =
    plan.canManageBilling && plan.organizationId ? billingPagePath(plan.organizationId) : "/tarifs";

  return (
    <div
      id={TEMPLATES_PLAN_NOTICE_ID}
      className={cn(
        "flex flex-col gap-2 rounded-xl border bg-muted/40 px-4 py-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between sm:gap-4",
        className,
      )}
    >
      <p className="flex items-start gap-2.5">
        <Info className="mt-0.5 size-4 shrink-0 text-muted-foreground" aria-hidden="true" />
        <span>{text}</span>
      </p>
      <Link
        href={href}
        className="shrink-0 self-start rounded-md font-medium underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
      >
        {t("offersLink")}
      </Link>
    </div>
  );
}
