import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { ArrowLeft, CircleAlert, CircleCheck, Clock } from "lucide-react";
import { Link } from "@/i18n/navigation";
import { applyPurchase, loadPurchase } from "@/lib/billing/apply";
import { isOfferCode, PLANS } from "@/lib/billing/catalog";
import { formatBillingDate, formatXof } from "@/lib/billing/format";
import { applyDeps } from "@/lib/billing/server";
import { getBillingSettings } from "@/lib/billing/settings";
import { getBillingOverview } from "@/lib/billing/state";
import { createClient } from "@/lib/supabase/server";
import { uuidSchema } from "@/lib/workspaces/schemas";
import { CheckoutForm } from "../../checkout-form";
import { PendingRefresh } from "./pending-refresh";

// Where FedaPay sends the buyer back (ADR 001, 8.3), with ?id=&status=. The
// purchase is read with the user's rights, and its transaction id comes from
// the purchase row: the query parameters only pick the first message, so a
// URL with another transaction id pays for nothing. A purchase still pending
// is checked with FedaPay, at most every 10 seconds, and granted here when
// the webhook has not done it. The service worker never caches this page.

export const dynamic = "force-dynamic";

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations("Billing.return");
  return { title: t("metaTitle") };
}

const RECHECK_AFTER_MS = 10_000;

const PURCHASE_COLUMNS =
  "id, organization_id, workspace_id, offer, offer_label, quantity, amount_xof, status, fedapay_status, last_checked_at";

export default async function PaymentReturnPage({
  params,
  searchParams,
}: {
  params: Promise<{ locale: "fr"; organizationId: string; purchaseId: string }>;
  searchParams: Promise<{ status?: string | string[] }>;
}) {
  const { locale, organizationId: rawOrganization, purchaseId: rawPurchase } = await params;
  setRequestLocale(locale);
  if (!uuidSchema.safeParse(rawOrganization).success || !uuidSchema.safeParse(rawPurchase).success)
    notFound();
  const organizationId = rawOrganization.toLowerCase();
  const purchaseId = rawPurchase.toLowerCase();
  const { status: statusParam } = await searchParams;
  const urlStatus = typeof statusParam === "string" ? statusParam : null;

  const supabase = await createClient();
  // React memoizes identical GET requests within a render: a read with its
  // own signal after the grant gets the new row, not the first answer.
  const read = (signal?: AbortSignal) => {
    const query = supabase.from("billing_purchases").select(PURCHASE_COLUMNS).eq("id", purchaseId);
    return (signal ? query.abortSignal(signal) : query).maybeSingle();
  };
  let { data: purchase } = await read();
  if (!purchase || purchase.organization_id !== organizationId) notFound();

  const lastChecked = purchase.last_checked_at ? new Date(purchase.last_checked_at).getTime() : 0;
  if (purchase.status === "pending" && Date.now() - lastChecked > RECHECK_AFTER_MS) {
    const settings = getBillingSettings();
    if (settings.api) {
      const deps = applyDeps(settings, settings.api);
      const ref = await loadPurchase(deps.db, purchaseId);
      if (ref) await applyPurchase(deps, ref, { source: "return" });
      ({ data: purchase } = await read(new AbortController().signal));
      if (!purchase) notFound();
    }
  }

  const t = await getTranslations("Billing.return");
  const summary = t("summary", { offer: purchase.offer_label, amount: formatXof(purchase.amount_xof) });

  let tone: "success" | "waiting" | "problem" = "problem";
  let message: string;
  let retry = false;
  let refresh = false;

  if (purchase.status === "paid") {
    tone = "success";
    const [{ data: entitlement }, { data: pack }, { data: receipt }] = await Promise.all([
      supabase
        .from("billing_entitlements")
        .select("plan, ends_at")
        .eq("purchase_id", purchaseId)
        .maybeSingle(),
      supabase
        .from("billing_ai_packs")
        .select("drafts, expires_at")
        .eq("purchase_id", purchaseId)
        .maybeSingle(),
      supabase
        .from("billing_receipts")
        .select("number")
        .eq("purchase_id", purchaseId)
        .eq("kind", "receipt")
        .maybeSingle(),
    ]);
    const number = receipt?.number ?? "";
    message = pack
      ? t("paidPack", { drafts: pack.drafts, date: formatBillingDate(pack.expires_at), number })
      : t("paid", {
          plan: entitlement ? (PLANS[entitlement.plan as keyof typeof PLANS]?.label ?? entitlement.plan) : "",
          date: entitlement ? formatBillingDate(entitlement.ends_at) : "",
          number,
        });
  } else if (purchase.status === "review") {
    message = t("review");
  } else if (purchase.status === "refunded") {
    message = t("refunded");
  } else if (purchase.status === "expired") {
    message = t("expired");
  } else {
    // Pending. FedaPay's status read by the server comes first; the URL's
    // only counts while FedaPay has said nothing yet.
    const fedapayStatus =
      purchase.fedapay_status ?? (urlStatus === "declined" || urlStatus === "canceled" ? urlStatus : null);
    if (fedapayStatus === "declined" || fedapayStatus === "canceled") {
      message = t("notPaid");
      const overview = await getBillingOverview(organizationId);
      retry = Boolean(overview?.canManage) && isOfferCode(purchase.offer);
    } else {
      tone = "waiting";
      message = t("pending");
      refresh = true;
    }
  }

  const Icon = tone === "success" ? CircleCheck : tone === "waiting" ? Clock : CircleAlert;

  return (
    <div className="mx-auto w-full max-w-xl px-4 py-8 sm:px-6 lg:py-12 motion-safe:animate-in motion-safe:fade-in-50 motion-safe:duration-500">
      <Link
        href={`/organisations/${organizationId}/abonnement`}
        className="inline-flex items-center gap-1.5 rounded-md text-sm text-muted-foreground outline-none transition-colors hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
      >
        <ArrowLeft className="size-4" aria-hidden="true" />
        {t("back")}
      </Link>
      <div className="surface-card mt-4 rounded-2xl border p-6 shadow-sm">
        <h1 className="text-h3 text-foreground">{t("title")}</h1>
        <p className="mt-1 text-sm text-muted-foreground">{summary}</p>
        <div role="status" className="mt-4 flex items-start gap-2 text-sm text-foreground">
          <Icon
            className={
              tone === "success"
                ? "mt-0.5 size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
                : tone === "waiting"
                  ? "mt-0.5 size-4 shrink-0 text-muted-foreground"
                  : "mt-0.5 size-4 shrink-0 text-destructive"
            }
            aria-hidden="true"
          />
          <p>{message}</p>
        </div>
        {refresh ? <PendingRefresh /> : null}
        {retry && isOfferCode(purchase.offer) ? (
          <CheckoutForm
            organizationId={organizationId}
            offer={purchase.offer}
            quantity={purchase.quantity}
            workspaceId={purchase.workspace_id}
            label={t("retry")}
            className="mt-5"
          />
        ) : null}
      </div>
    </div>
  );
}
