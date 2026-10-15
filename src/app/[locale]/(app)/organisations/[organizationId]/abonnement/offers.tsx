import { getTranslations } from "next-intl/server";
import { CalendarClock } from "lucide-react";
import { Label } from "@/components/ui/label";
import { NativeSelect } from "@/components/ui/native-select";
import { OFFERS, PLANS, type OfferCode } from "@/lib/billing/catalog";
import { formatXof } from "@/lib/billing/format";
import type { PeriodRule } from "@/lib/billing/usage";
import { CheckoutForm } from "./checkout-form";

const PLAN_OFFERS = {
  independant: ["independant_1m", "independant_3m", "independant_12m"],
  cabinet: ["cabinet_1m", "cabinet_3m", "cabinet_12m"],
} as const satisfies Record<"independant" | "cabinet", readonly OfferCode[]>;

const PACK_QUANTITIES = Array.from({ length: OFFERS.ai_pack_100.maxQuantity }, (_, index) => index + 1);

/** When a new period would start, in one line (ADR 001, 6.3). */
function Rule({ children }: { children: string }) {
  return (
    <p className="mt-2 flex items-start gap-1.5 text-xs text-muted-foreground">
      <CalendarClock className="mt-px size-3.5 shrink-0" aria-hidden="true" />
      <span>{children}</span>
    </p>
  );
}

/**
 * The offers sold online, with one "Payer" button each for the people who
 * can buy (the checkout of KRB-176), and the period rule that a payment
 * would follow now.
 */
export async function Offers({
  organizationId,
  canBuy,
  rules,
  workspaces,
  packNeedsPlan,
}: {
  organizationId: string;
  canBuy: boolean;
  rules: Record<keyof typeof PLAN_OFFERS, PeriodRule>;
  /** Workspaces of the organization the buyer belongs to, for a Pass Mission. */
  workspaces: { id: string; name: string }[];
  /** No paid plan or pass running or in grace: a pack would be refused. */
  packNeedsPlan: boolean;
}) {
  const t = await getTranslations("Billing");
  const price = (amount: number) => formatXof(amount);

  return (
    <section aria-labelledby="offers-title" className="mt-10">
      <h2 id="offers-title" className="text-h3 text-foreground">
        {t("page.offersTitle")}
      </h2>
      <section aria-labelledby="offers-subscription" className="mt-4">
        <h3 id="offers-subscription" className="text-base font-semibold text-foreground">
          {t("offers.subscriptionTitle")}
        </h3>
        <div className="mt-3 grid gap-4 md:grid-cols-2">
          {(Object.keys(PLAN_OFFERS) as (keyof typeof PLAN_OFFERS)[]).map((plan) => (
            <section
              key={plan}
              aria-labelledby={`plan-${plan}`}
              className="surface-card rounded-2xl border p-5 shadow-sm"
            >
              <h4 id={`plan-${plan}`} className="text-base font-semibold text-foreground">
                {PLANS[plan].label}
              </h4>
              <p className="mt-1 text-sm text-muted-foreground">{t(`offers.${plan}`)}</p>
              <Rule>{t(`page.rules.${rules[plan]}`)}</Rule>
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

      <div className="mt-6 grid gap-4 md:grid-cols-2">
        <section aria-labelledby="offers-mission" className="surface-card rounded-2xl border p-5 shadow-sm">
          <h3 id="offers-mission" className="text-base font-semibold text-foreground">
            {t("offers.missionTitle")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("offers.missionDescription")}</p>
          <Rule>{t("page.rules.mission")}</Rule>
          <p className="mt-2 text-sm font-medium text-foreground">
            {t("offers.price", { price: price(OFFERS.mission_pass.priceHtXof) })}
          </p>
          {canBuy ? (
            workspaces.length > 0 ? (
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
          <h3 id="offers-pack" className="text-base font-semibold text-foreground">
            {t("offers.packTitle")}
          </h3>
          <p className="mt-1 text-sm text-muted-foreground">{t("offers.packDescription")}</p>
          <Rule>{packNeedsPlan ? t("page.rules.packNeedsPlan") : t("page.rules.pack")}</Rule>
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
    </section>
  );
}
