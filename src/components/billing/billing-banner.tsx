import { getTranslations } from "next-intl/server";
import { CalendarClock, Lock, TriangleAlert } from "lucide-react";
import { Link } from "@/i18n/navigation";
import type { BillingBanner as BillingBannerData } from "@/lib/billing/banner";
import { PLANS } from "@/lib/billing/catalog";
import { formatBillingDate } from "@/lib/billing/dates";
import { cn } from "@/lib/utils";

const NAMES = new Intl.ListFormat("fr", { style: "long", type: "conjunction" });

type BillingBannerProps = {
  banner: BillingBannerData;
  /** Owners of the workspace, for members who cannot renew themselves. */
  renewers: string[];
};

/**
 * The plan of the current workspace, at the top of every signed-in page
 * (KRB-178): days left in the trial, a period ending soon, grace, read-only,
 * or no plan yet. People who can renew get the link to the billing page,
 * the others the names of who to ask.
 */
export async function BillingBanner({ banner, renewers }: BillingBannerProps) {
  const t = await getTranslations("Billing.banner");

  let text: string;
  switch (banner.kind) {
    case "trial":
      text = t("trial", { days: banner.days });
      break;
    case "ending":
      text = t("ending", { plan: PLANS[banner.plan].label, date: formatBillingDate(banner.endsAt) });
      break;
    case "grace":
      text =
        banner.plan === "trial"
          ? t("graceTrial", {
              date: formatBillingDate(banner.endsAt),
              graceEnd: formatBillingDate(banner.graceEndsAt),
            })
          : t("grace", {
              plan: PLANS[banner.plan].label,
              date: formatBillingDate(banner.endsAt),
              graceEnd: formatBillingDate(banner.graceEndsAt),
            });
      break;
    case "readOnly":
      text = t(banner.canManage ? "readOnly" : "readOnlyMember", {
        date: formatBillingDate(banner.graceEndsAt),
      });
      break;
    case "noPlan":
      text = t(banner.canManage ? "noPlan" : "noPlanMember");
      break;
  }

  const urgent = banner.kind === "grace" || banner.kind === "readOnly" || banner.kind === "noPlan";
  const Icon =
    banner.kind === "readOnly" || banner.kind === "noPlan" ? Lock : urgent ? TriangleAlert : CalendarClock;
  const action = banner.kind === "trial" || banner.kind === "noPlan" ? t("choose") : t("renew");

  return (
    <aside aria-label={t("label")} data-billing-banner={banner.kind} className="px-4 pt-4 sm:px-6 lg:px-8">
      <div
        className={cn(
          "mx-auto flex max-w-6xl flex-col gap-2 rounded-xl border px-4 py-3 text-sm text-foreground sm:flex-row sm:items-center sm:justify-between",
          urgent ? "border-destructive/30 bg-destructive/[0.06]" : "bg-muted/40",
        )}
      >
        <p className="flex items-start gap-2.5">
          <Icon
            className={cn("mt-0.5 size-4 shrink-0", urgent ? "text-destructive" : "text-muted-foreground")}
            aria-hidden="true"
          />
          <span>
            {text}
            {banner.canManage ? null : (
              <> {renewers.length > 0 ? t("askOwners", { names: NAMES.format(renewers) }) : t("askOwner")}</>
            )}
          </span>
        </p>
        {banner.canManage ? (
          <Link
            href={`/organisations/${banner.organizationId}/abonnement`}
            className="shrink-0 self-start rounded-md font-medium underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring sm:self-auto"
          >
            {action}
          </Link>
        ) : null}
      </div>
    </aside>
  );
}
