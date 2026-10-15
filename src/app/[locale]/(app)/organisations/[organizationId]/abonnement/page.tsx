import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, ShieldAlert } from "lucide-react";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { Link } from "@/i18n/navigation";
import { OFFERS, PLANS, type OfferCode } from "@/lib/billing/catalog";
import { formatBillingDate, formatXof } from "@/lib/billing/format";
import { reconcilePendingPurchases } from "@/lib/billing/reconcile";
import { applyDeps, stuckAlert } from "@/lib/billing/server";
import { getBillingSettings } from "@/lib/billing/settings";
import { getBillingOverview } from "@/lib/billing/state";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { CheckoutForm } from "./checkout-form";

// The organization's billing route (ADR 001, 3.5). This is the minimal
// offer picker of KRB-176: the current period, and one "Payer" button per
// offer for the people who can buy. The full page (usage, history,
// receipts, billing details) comes with KRB-177. Billing readers only:
// anyone else gets a 404, like an organization that does not exist.

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Billing.page");
  return { title: t("metaTitle") };
}

const PLAN_OFFERS = {
  independant: ["independant_1m", "independant_3m", "independant_12m"],
  cabinet: ["cabinet_1m", "cabinet_3m", "cabinet_12m"],
} as const satisfies Record<"independant" | "cabinet", readonly OfferCode[]>;

const PACK_QUANTITIES = Array.from({ length: OFFERS.ai_pack_100.maxQuantity }, (_, index) => index + 1);

export default async function SubscriptionPage({
  params,
}: {
  params: Promise<{ locale: "fr"; organizationId: string }>;
}) {
  const { locale, organizationId: rawId } = await params;
  setRequestLocale(locale);
  if (!uuidSchema.safeParse(rawId).success) notFound();
  const organizationId = rawId.toLowerCase();

  const overview = await getBillingOverview(organizationId);
  if (!overview) notFound();

  // Payments whose webhook was lost are granted here, at most once a minute
  // per purchase (ADR 001, 8.7).
  const settings = getBillingSettings();
  if (settings.api) {
    const deps = applyDeps(settings, settings.api);
    await reconcilePendingPurchases(deps, {
      organizationId,
      limit: 5,
      recheckAfter: "1 minute",
      onStuck: stuckAlert(settings, deps),
    });
  }

  const t = await getTranslations("Billing");
  const supabase = await createClient();
  const now = new Date().toISOString();
  const [{ data: organization }, { data: periods }, { data: workspaces }] = await Promise.all([
    supabase.from("organizations").select("name").eq("id", organizationId).maybeSingle(),
    supabase
      .from("billing_entitlements")
      .select("plan, starts_at, ends_at")
      .eq("organization_id", organizationId)
      .eq("scope", "subscription")
      .is("revoked_at", null)
      .gt("ends_at", now)
      .order("starts_at"),
    supabase.from("workspaces").select("id, name").eq("organization_id", organizationId).order("created_at"),
  ]);
  if (!organization) notFound();

  const time = (value: string) => new Date(value).getTime();
  const current = periods?.find((period) => time(period.starts_at) <= time(now)) ?? null;
  const lastEnd = periods?.reduce<string | null>(
    (last, period) => (last === null || time(period.ends_at) > time(last) ? period.ends_at : last),
    null,
  );
  const canBuy = overview.canManage;
  const price = (amount: number) => formatXof(amount);

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
        <p className="text-sm text-foreground">
          {current
            ? current.plan === "trial"
              ? t("page.currentTrial", { date: formatBillingDate(current.ends_at) })
              : t("page.current", {
                  plan: PLANS[current.plan as keyof typeof PLANS]?.label ?? current.plan,
                  date: formatBillingDate(current.ends_at),
                })
            : t("page.none")}
          {current && lastEnd && time(lastEnd) > time(current.ends_at)
            ? ` ${t("page.next", { date: formatBillingDate(lastEnd) })}`
            : null}
        </p>
      </header>

      {canBuy ? null : (
        <p className="surface-card mt-6 flex items-start gap-2 rounded-2xl border p-4 text-sm text-muted-foreground">
          <ShieldAlert className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
          {t("page.managersOnly")}
        </p>
      )}

      <section aria-labelledby="offers-subscription" className="mt-8">
        <h2 id="offers-subscription" className="text-h3 text-foreground">
          {t("offers.subscriptionTitle")}
        </h2>
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {(Object.keys(PLAN_OFFERS) as (keyof typeof PLAN_OFFERS)[]).map((plan) => (
            <section
              key={plan}
              aria-labelledby={`plan-${plan}`}
              className="surface-card rounded-2xl border p-5 shadow-sm"
            >
              <h3 id={`plan-${plan}`} className="text-base font-semibold text-foreground">
                {PLANS[plan].label}
              </h3>
              <p className="mt-1 text-sm text-muted-foreground">{t(`offers.${plan}`)}</p>
              <ul className="mt-4 space-y-3">
                {PLAN_OFFERS[plan].map((code) => {
                  const offer = OFFERS[code];
                  const duration = t("offers.duration", { months: offer.months });
                  return (
                    <li
                      key={code}
                      className="flex flex-wrap items-center justify-between gap-3 border-t pt-3 first:border-t-0 first:pt-0"
                    >
                      <span className="text-sm">
                        <span className="font-medium text-foreground">{duration}</span>
                        <span className="block text-muted-foreground">
                          {t("offers.price", { price: price(offer.priceHtXof) })}
                        </span>
                      </span>
                      {canBuy ? (
                        <CheckoutForm
                          organizationId={organizationId}
                          offer={code}
                          quantity={1}
                          label={t("offers.pay")}
                          accessibleLabel={t("offers.payLabel", {
                            offer: offer.label,
                            price: price(offer.priceHtXof),
                          })}
                          className="w-40"
                        />
                      ) : null}
                    </li>
                  );
                })}
              </ul>
            </section>
          ))}
        </div>
      </section>

      <div className="mt-8 grid gap-4 md:grid-cols-2">
        <section aria-labelledby="offers-mission" className="surface-card rounded-2xl border p-5 shadow-sm">
          <h2 id="offers-mission" className="text-base font-semibold text-foreground">
            {t("offers.missionTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("offers.missionDescription")}</p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {t("offers.price", { price: price(OFFERS.mission_pass.priceHtXof) })}
          </p>
          {canBuy ? (
            workspaces && workspaces.length > 0 ? (
              <CheckoutForm
                organizationId={organizationId}
                offer="mission_pass"
                quantity={1}
                label={t("offers.pay")}
                accessibleLabel={t("offers.payLabel", {
                  offer: OFFERS.mission_pass.label,
                  price: price(OFFERS.mission_pass.priceHtXof),
                })}
                className="mt-4"
              >
                <div className="space-y-2">
                  <Label htmlFor="mission-workspace">{t("offers.missionWorkspace")}</Label>
                  <NativeSelect id="mission-workspace" name="workspaceId" defaultValue={workspaces[0]?.id}>
                    {workspaces.map((workspace) => (
                      <option key={workspace.id} value={workspace.id}>
                        {workspace.name}
                      </option>
                    ))}
                  </NativeSelect>
                </div>
              </CheckoutForm>
            ) : (
              <p className="mt-4 text-sm text-muted-foreground">{t("offers.missionNone")}</p>
            )
          ) : null}
        </section>

        <section aria-labelledby="offers-pack" className="surface-card rounded-2xl border p-5 shadow-sm">
          <h2 id="offers-pack" className="text-base font-semibold text-foreground">
            {t("offers.packTitle")}
          </h2>
          <p className="mt-1 text-sm text-muted-foreground">{t("offers.packDescription")}</p>
          <p className="mt-2 text-sm font-medium text-foreground">
            {t("offers.price", { price: price(OFFERS.ai_pack_100.priceHtXof) })}
          </p>
          {canBuy ? (
            <CheckoutForm
              organizationId={organizationId}
              offer="ai_pack_100"
              label={t("offers.pay")}
              accessibleLabel={t("offers.payLabel", {
                offer: OFFERS.ai_pack_100.label,
                price: price(OFFERS.ai_pack_100.priceHtXof),
              })}
              className="mt-4"
            >
              <div className="space-y-2">
                <Label htmlFor="pack-quantity">{t("offers.packQuantity")}</Label>
                <NativeSelect id="pack-quantity" name="quantity" defaultValue="1">
                  {PACK_QUANTITIES.map((quantity) => (
                    <option key={quantity} value={quantity}>
                      {quantity}
                    </option>
                  ))}
                </NativeSelect>
              </div>
            </CheckoutForm>
          ) : null}
        </section>
      </div>

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
