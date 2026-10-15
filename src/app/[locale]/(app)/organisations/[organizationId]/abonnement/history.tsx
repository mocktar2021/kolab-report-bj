import { getTranslations } from "next-intl/server";
import { Download } from "lucide-react";
import { formatBillingDate, formatXof } from "@/lib/billing/format";
import { RECEIPTS_ANCHOR } from "@/lib/billing/navigation";
import type { BillingOverview } from "@/lib/billing/state";
import { purchaseStatusKey } from "@/lib/billing/usage";
import { cn } from "@/lib/utils";
import { ReceiptDownload } from "./receipt-download";

const STATUS_STYLES = {
  paid: "bg-emerald-50 text-emerald-800 ring-emerald-200 dark:bg-emerald-500/10 dark:text-emerald-300 dark:ring-emerald-500/20",
  pending: "bg-sky-50 text-sky-800 ring-sky-200 dark:bg-sky-500/10 dark:text-sky-300 dark:ring-sky-500/20",
  review:
    "bg-amber-50 text-amber-900 ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/20",
  notPaid: "bg-muted text-muted-foreground ring-border",
  expired: "bg-muted text-muted-foreground ring-border",
  refunded: "bg-muted text-muted-foreground ring-border",
} as const;

const th = "px-3 py-2.5 text-left font-medium";
const td = "px-3 py-3 align-top";

/** Every payment of the organization with its status, and the receipt of the paid ones. */
export async function PurchaseHistory({ overview }: { overview: BillingOverview }) {
  const t = await getTranslations("Billing.page");
  const { purchases } = overview;

  return (
    <section
      aria-labelledby="history-title"
      className="surface-card mt-8 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2 id="history-title" className="font-medium text-foreground">
          {t("historyTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("historyDescription")}</p>
      </div>
      {purchases.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("historyEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">{t("historyCaption")}</caption>
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className={cn(th, "pl-5")}>
                  {t("columns.date")}
                </th>
                <th scope="col" className={th}>
                  {t("columns.offer")}
                </th>
                <th scope="col" className={cn(th, "text-right")}>
                  {t("columns.amount")}
                </th>
                <th scope="col" className={th}>
                  {t("columns.status")}
                </th>
                <th scope="col" className={cn(th, "pr-5")}>
                  {t("columns.receipt")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {purchases.map((purchase) => {
                const status = purchaseStatusKey(purchase);
                return (
                  <tr key={purchase.id}>
                    <td className={cn(td, "whitespace-nowrap pl-5 tabular-nums")}>
                      {formatBillingDate(purchase.paidAt ?? purchase.createdAt)}
                    </td>
                    <th scope="row" className={cn(td, "text-left font-normal")}>
                      <span className="text-foreground">
                        {t("purchaseOffer", { offer: purchase.offerLabel, quantity: purchase.quantity })}
                      </span>
                      {/* Named for the organization owner and the workspace's members only. */}
                      {purchase.workspaceId ? (
                        <span className="block text-xs text-muted-foreground">
                          {purchase.workspaceName
                            ? t("purchaseWorkspace", { workspace: purchase.workspaceName })
                            : t("hiddenWorkspace")}
                        </span>
                      ) : null}
                    </th>
                    <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>
                      {t("amount", { amount: formatXof(purchase.amountXof) })}
                    </td>
                    <td className={td}>
                      <span
                        className={cn(
                          "inline-flex whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset",
                          STATUS_STYLES[status],
                        )}
                      >
                        {t(`status.${status}`)}
                      </span>
                    </td>
                    <td className={cn(td, "whitespace-nowrap pr-5")}>
                      {purchase.receiptId && purchase.receiptNumber ? (
                        <ReceiptDownload
                          receiptId={purchase.receiptId}
                          label={t("downloadLabel", { number: purchase.receiptNumber })}
                          failedText={t("downloadFailed")}
                          className="rounded-sm font-medium tabular-nums text-foreground underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring aria-busy:cursor-wait aria-busy:opacity-60"
                        >
                          {purchase.receiptNumber}
                        </ReceiptDownload>
                      ) : (
                        <span className="text-muted-foreground">{t("noReceipt")}</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {overview.purchasesTotal > purchases.length ? (
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          {t("historyMore", { count: purchases.length, total: overview.purchasesTotal })}
        </p>
      ) : null}
    </section>
  );
}

/** The receipts of the organization, each with its PDF. */
export async function ReceiptList({ overview }: { overview: BillingOverview }) {
  const t = await getTranslations("Billing.page");
  const { receipts } = overview;

  // The payment e-mail links here (#recus); scroll-mt keeps the title clear of the sticky top bar.
  return (
    <section
      id={RECEIPTS_ANCHOR}
      aria-labelledby="receipts-title"
      className="surface-card mt-8 scroll-mt-20 overflow-hidden rounded-2xl border shadow-sm"
    >
      <div className="border-b px-5 py-4">
        <h2 id="receipts-title" className="font-medium text-foreground">
          {t("receiptsTitle")}
        </h2>
        <p className="mt-1 text-sm text-muted-foreground">{t("receiptsDescription")}</p>
      </div>
      {receipts.length === 0 ? (
        <p className="px-5 py-8 text-center text-sm text-muted-foreground">{t("receiptsEmpty")}</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-sm">
            <caption className="sr-only">{t("receiptsCaption")}</caption>
            <thead className="border-b bg-muted/40 text-xs text-muted-foreground">
              <tr>
                <th scope="col" className={cn(th, "pl-5")}>
                  {t("columns.number")}
                </th>
                <th scope="col" className={th}>
                  {t("columns.date")}
                </th>
                <th scope="col" className={th}>
                  {t("columns.label")}
                </th>
                <th scope="col" className={cn(th, "text-right")}>
                  {t("columns.amount")}
                </th>
                <th scope="col" className={cn(th, "pr-5 text-right")}>
                  {t("columns.download")}
                </th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {receipts.map((receipt) => {
                const test = receipt.environment === "sandbox" || receipt.environment === "mock";
                return (
                  <tr key={receipt.id}>
                    <th
                      scope="row"
                      className={cn(td, "whitespace-nowrap pl-5 text-left font-medium tabular-nums")}
                    >
                      {receipt.number}
                      {test ? (
                        <span
                          title={t("testReceiptTitle")}
                          className="ml-2 inline-flex rounded-full bg-amber-50 px-2 py-0.5 text-[11px] font-medium text-amber-900 ring-1 ring-inset ring-amber-200 dark:bg-amber-500/10 dark:text-amber-200 dark:ring-amber-500/20"
                        >
                          <span aria-hidden="true">{t("testReceipt")}</span>
                          <span className="sr-only">{t("testReceiptTitle")}</span>
                        </span>
                      ) : null}
                    </th>
                    <td className={cn(td, "whitespace-nowrap tabular-nums")}>
                      {formatBillingDate(receipt.issuedAt)}
                    </td>
                    <td className={td}>{receipt.label}</td>
                    <td className={cn(td, "whitespace-nowrap text-right tabular-nums")}>
                      {t("amount", { amount: formatXof(receipt.totalXof) })}
                    </td>
                    <td className={cn(td, "pr-5 text-right")}>
                      <ReceiptDownload
                        receiptId={receipt.id}
                        label={t("downloadLabel", { number: receipt.number })}
                        failedText={t("downloadFailed")}
                        className="inline-flex items-center gap-1.5 rounded-full px-2 py-1 text-sm font-medium text-foreground outline-none transition-colors hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring aria-busy:cursor-wait aria-busy:opacity-60"
                      >
                        <Download className="size-4" aria-hidden="true" />
                        {t("download")}
                      </ReceiptDownload>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
      {overview.receiptsTotal > receipts.length ? (
        <p className="border-t px-5 py-3 text-xs text-muted-foreground">
          {t("receiptsMore", { count: receipts.length, total: overview.receiptsTotal })}
        </p>
      ) : null}
    </section>
  );
}
