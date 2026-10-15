import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, Info, ShieldAlert } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { isPlanCode, PLANS, type PlanCode } from "@/lib/billing/catalog";
import { formatBillingDate } from "@/lib/billing/format";
import { reconcilePendingPurchases } from "@/lib/billing/reconcile";
import { applyDeps, stuckAlert } from "@/lib/billing/server";
import { getBillingSettings } from "@/lib/billing/settings";
import { getBillingOverview, type EntitlementSource } from "@/lib/billing/state";
import { subscriptionRule, type SubscriptionPeriod } from "@/lib/billing/usage";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { BillingDetailsForm } from "./billing-details-form";
import { PurchaseHistory, ReceiptList } from "./history";
import { Offers } from "./offers";
import { PassList, UsageMeter } from "./usage-meter";

// The organization's billing page (ADR 001, 3.5; KRB-177): the current
// plan and its state, the usage meter, the offers with the period rule a
// payment would follow, the passes of mission workspaces, the purchase
// history, the receipts and the billing details. Billing readers only (the
// organization owner, the owners and admins of its workspaces): anyone
// else gets a 404, like an organization that does not exist. Only the
// owners buy and edit the details; admins read.

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Billing.page");
  return { title: t("metaTitle") };
}

const DAY_MS = 86_400_000;

/** Grace lasts 7 days: periods that ended before this change no rule. */
const PERIODS_SINCE_DAYS = 60;

const SOURCES: readonly EntitlementSource[] = ["trial", "purchase", "manual", "launch"];

function planLabel(plan: string | null): string {
  return plan && isPlanCode(plan) ? PLANS[plan].label : (plan ?? "");
}

export default async function SubscriptionPage({
  params,
}: {
  params: Promise<{ locale: "fr"; organizationId: string }>;
}) {
  const { locale, organizationId: rawId } = await params;
  setRequestLocale(locale);
  if (!uuidSchema.safeParse(rawId).success) notFound();
  const organizationId = rawId.toLowerCase();

  let overview = await getBillingOverview(organizationId);
  if (!overview) notFound();

  // Payments whose webhook was lost are granted here, at most once a minute
  // per purchase (ADR 001, 8.7). The history is read again when one moved.
  const settings = getBillingSettings();
  if (settings.api) {
    const deps = applyDeps(settings, settings.api);
    const summary = await reconcilePendingPurchases(deps, {
      organizationId,
      limit: 5,
      recheckAfter: "1 minute",
      onStuck: stuckAlert(settings, deps),
    });
    if (summary.checked > 0 || summary.expired > 0) {
      overview = (await getBillingOverview(organizationId)) ?? overview;
    }
  }

  const t = await getTranslations("Billing");
  const supabase = await createClient();
  const now = new Date();
  const since = new Date(now.getTime() - PERIODS_SINCE_DAYS * DAY_MS).toISOString();
  // The workspaces a pass can be bought for come with the overview, under
  // the rule of its names: all of them for the organization owner.
  const [{ data: organization }, { data: periodRows }, { data: details }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    supabase
      .from("billing_entitlements")
      .select("scope, plan, source, starts_at, ends_at, grace_days, amount_ht_xof")
      .eq("organization_id", organizationId)
      .is("revoked_at", null)
      .gt("ends_at", since)
      .order("starts_at"),
    supabase
      .from("organization_billing")
      .select("legal_name, address, tax_id, billing_email")
      .eq("organization_id", organizationId)
      .maybeSingle(),
  ]);
  if (!organization) notFound();

  const time = (value: string) => new Date(value).getTime();
  const at = now.getTime();
  // A pack goes on top of a paid or manual period, or a pass, running or in
  // grace: the check of billing_create_purchase (ADR 001, Q6).
  const packNeedsPlan = !(periodRows ?? []).some(
    (row) =>
      row.plan !== "trial" && time(row.starts_at) <= at && at < time(row.ends_at) + row.grace_days * DAY_MS,
  );
  const periods: SubscriptionPeriod[] = (periodRows ?? []).flatMap((row) =>
    row.scope === "subscription" &&
    isPlanCode(row.plan) &&
    (SOURCES as readonly string[]).includes(row.source)
      ? [
          {
            plan: row.plan as PlanCode,
            source: row.source as EntitlementSource,
            startsAt: row.starts_at,
            endsAt: row.ends_at,
            graceDays: row.grace_days,
            amountHtXof: row.amount_ht_xof,
          },
        ]
      : [],
  );
  const running = periods.filter((period) => time(period.endsAt) > at);
  const current = running.find((period) => time(period.startsAt) <= at) ?? null;
  const lastEnd = running.reduce<string | null>(
    (last, period) => (last === null || time(period.endsAt) > time(last) ? period.endsAt : last),
    null,
  );

  const { subscription } = overview;
  const enforced = overview.enforced;
  const canBuy = overview.canManage;
  const rules = {
    independant: subscriptionRule("independant", periods, now),
    cabinet: subscriptionRule("cabinet", periods, now),
  };

  let status: string;
  if (current) {
    status =
      current.plan === "trial"
        ? t("page.currentTrial", { date: formatBillingDate(current.endsAt) })
        : t("page.current", { plan: planLabel(current.plan), date: formatBillingDate(current.endsAt) });
  } else if (enforced && subscription.state === "grace" && subscription.endsAt && subscription.graceEndsAt) {
    status = t("page.grace", {
      plan: planLabel(subscription.plan),
      date: formatBillingDate(subscription.endsAt),
      graceEnd: formatBillingDate(subscription.graceEndsAt),
    });
  } else if (enforced && subscription.state === "read_only" && subscription.graceEndsAt) {
    status = t("page.readOnly", { date: formatBillingDate(subscription.graceEndsAt) });
  } else {
    status = t("page.none");
  }

  return (
    <div className="mx-auto w-full max-w-5xl px-4 py-8 sm:px-6 lg:px-8 lg:py-10 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-500">
      <Link
        href="/tableau-de-bord"
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("page.back")}
      </Link>
      <header className="mt-4 space-y-2">
        <h1 className="text-h2 text-foreground">{t("page.title", { organization: organization.name })}</h1>
        <p className="text-small text-muted-foreground">{t("page.subtitle")}</p>
      </header>

      <section
        aria-label={t("page.metaTitle")}
        className="surface-card mt-6 rounded-2xl border p-5 shadow-sm"
      >
        {enforced ? (
          <p className="text-xs font-medium text-muted-foreground">
            {t("page.stateLabel", { state: t(`page.states.${subscription.state}`) })}
          </p>
        ) : null}
        <p className="mt-1 text-base font-medium text-foreground">{status}</p>
        {current && lastEnd && time(lastEnd) > time(current.endsAt) ? (
          <p className="mt-1 text-sm text-muted-foreground">
            {t("page.next", { date: formatBillingDate(lastEnd) })}
          </p>
        ) : null}
        {enforced ? null : (
          <p className="mt-3 flex items-start gap-2 text-sm text-muted-foreground">
            <Info className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            {t("page.notEnforced")}
          </p>
        )}
      </section>

      {canBuy ? null : (
        <p className="surface-card mt-4 flex items-start gap-2 rounded-2xl border p-4 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("page.managersOnly")}
        </p>
      )}

      <UsageMeter overview={overview} />
      <PassList overview={overview} />

      <Offers
        organizationId={organizationId}
        canBuy={canBuy}
        rules={rules}
        workspaces={overview.workspaces}
        packNeedsPlan={packNeedsPlan}
      />

      <PurchaseHistory overview={overview} />
      <ReceiptList overview={overview} />

      <section
        aria-labelledby="details-title"
        className="surface-card mt-8 rounded-2xl border p-5 shadow-sm sm:p-6"
      >
        <h2 id="details-title" className="font-medium text-foreground">
          {t("page.details.title")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("page.details.description")}</p>
        <BillingDetailsForm
          organizationId={organizationId}
          canEdit={canBuy}
          values={{
            legalName: details?.legal_name ?? null,
            address: details?.address ?? null,
            taxId: details?.tax_id ?? null,
            billingEmail: details?.billing_email ?? null,
          }}
        />
      </section>

      <footer className="mt-8 space-y-1 text-xs text-muted-foreground">
        <p>{t("page.redirect")}</p>
        <p>
          {t.rich("page.terms", {
            link: (chunks) => (
              <Link href="/cgv#remboursement" className="underline underline-offset-2 hover:text-foreground">
                {chunks}
              </Link>
            ),
          })}
        </p>
      </footer>
    </div>
  );
}
