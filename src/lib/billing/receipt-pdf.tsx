import "server-only";
import { Document, Page, StyleSheet, Text, View, renderToBuffer, type Styles } from "@react-pdf/renderer";
import { createTranslator } from "next-intl";
import messages from "../../../messages/fr.json";
import { toWinAnsi } from "@/lib/export/winansi";
import { formatBillingDate, formatBillingDay, formatXof } from "./format";
import { isTestReceipt, paymentMethodKey, type Receipt, type ReceiptLine } from "./receipt";

// The receipt PDF (ADR 001, section 9): one A4 page in French, drawn on
// demand from the stored receipt and its lines. Same stack as the report
// export (KRB-18): @react-pdf/renderer, the standard Helvetica font, and
// every string through toWinAnsi. The text comes from Billing.receipt in
// messages/fr.json.

const t = createTranslator({ locale: "fr", messages, namespace: "Billing.receipt" });

const COLORS = { text: "#1a1a1a", muted: "#595959", border: "#bfbfbf", shade: "#f2f2f2", accent: "#1f3864" };

const styles = StyleSheet.create({
  page: {
    paddingTop: 50,
    paddingBottom: 60,
    paddingHorizontal: 50,
    fontFamily: "Helvetica",
    fontSize: 9.5,
    color: COLORS.text,
  },
  header: { flexDirection: "row", justifyContent: "space-between" },
  seller: { width: 260 },
  sellerName: { fontSize: 13, fontWeight: 700, marginBottom: 4 },
  line: { marginBottom: 2, lineHeight: 1.3 },
  muted: { color: COLORS.muted },
  titleBlock: { width: 220, alignItems: "flex-end" },
  title: { fontSize: 18, fontWeight: 700, color: COLORS.accent, marginBottom: 6 },
  number: { fontSize: 11, fontWeight: 700, marginBottom: 2 },
  testNotice: {
    marginTop: 18,
    paddingVertical: 6,
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "#b45309",
    color: "#b45309",
    fontWeight: 700,
    textAlign: "center",
  },
  section: { marginTop: 22 },
  sectionTitle: { fontSize: 9, fontWeight: 700, color: COLORS.muted, marginBottom: 5 },
  buyerName: { fontSize: 11, fontWeight: 700, marginBottom: 3 },
  table: { marginTop: 22, borderTopWidth: 0.75, borderColor: COLORS.border },
  row: { flexDirection: "row", borderBottomWidth: 0.75, borderColor: COLORS.border },
  headerRow: { backgroundColor: COLORS.shade },
  cell: { paddingVertical: 5, paddingHorizontal: 4 },
  headerCell: { fontWeight: 700, fontSize: 8.5 },
  colLabel: { flex: 1 },
  colPeriod: { width: 120 },
  colQuantity: { width: 32, textAlign: "right" },
  colUnit: { width: 70, textAlign: "right" },
  colAmount: { width: 70, textAlign: "right" },
  colTax: { width: 50, textAlign: "right" },
  totals: { marginTop: 12, marginLeft: "auto", width: 230 },
  totalRow: { flexDirection: "row", justifyContent: "space-between", paddingVertical: 3 },
  grandTotal: {
    borderTopWidth: 0.75,
    borderColor: COLORS.text,
    marginTop: 3,
    paddingTop: 5,
    fontWeight: 700,
  },
  note: { marginTop: 8, color: COLORS.muted, textAlign: "right" },
  footer: {
    position: "absolute",
    bottom: 28,
    left: 50,
    right: 50,
    fontSize: 7.5,
    color: COLORS.muted,
    textAlign: "center",
    lineHeight: 1.3,
  },
});

type Style = Styles[string];

/** Text the standard fonts can draw. Long references break anywhere rather than overflow. */
function W({ children, style, fixed }: { children: string; style?: Style | Style[]; fixed?: boolean }) {
  return (
    <Text style={style} fixed={fixed} hyphenationCallback={breakWords}>
      {toWinAnsi(children)}
    </Text>
  );
}

/** Words stay whole; only words longer than 24 characters (references, e-mails) are cut. */
function breakWords(word: string): string[] {
  if (word.length <= 24) return [word];
  const parts: string[] = [];
  for (let index = 0; index < word.length; index += 24) parts.push(word.slice(index, index + 24));
  return parts;
}

function amount(value: number): string {
  return t("amount", { amount: formatXof(value) });
}

function period(line: ReceiptLine): string {
  if (line.periodStart && line.periodEnd) {
    return t("periodRange", {
      start: formatBillingDay(line.periodStart),
      end: formatBillingDay(line.periodEnd),
    });
  }
  if (line.periodStart) return t("periodFrom", { start: formatBillingDay(line.periodStart) });
  return "";
}

function taxCell(line: ReceiptLine): string {
  if (line.taxRate !== null && line.taxRate > 0) {
    return t("taxRate", { rate: line.taxRate, amount: formatXof(line.taxXof) });
  }
  return formatXof(line.taxXof);
}

function ReceiptDocument({ receipt }: { receipt: Receipt }) {
  const { seller, buyer, payment } = receipt;
  const title = receipt.kind === "credit_note" ? t("titleCreditNote") : t("title");
  const paymentLines = [
    t("paymentMethod", { method: t(`method.${paymentMethodKey(payment.method, payment.mode)}`) }),
    payment.paidAt ? t("paymentDate", { date: formatBillingDate(payment.paidAt) }) : null,
    payment.fedapayTransactionId !== null
      ? t("fedapayTransaction", { id: String(payment.fedapayTransactionId) })
      : null,
    payment.fedapayReference ? t("fedapayReference", { reference: payment.fedapayReference }) : null,
    payment.transferReference ? t("transferReference", { reference: payment.transferReference }) : null,
    payment.merchantReference ? t("merchantReference", { reference: payment.merchantReference }) : null,
  ].filter((value): value is string => value !== null);

  return (
    <Document
      title={toWinAnsi(t("fileTitle", { number: receipt.number }))}
      author={toWinAnsi(seller.name)}
      creator="KolabReport"
      producer="KolabReport"
      language="fr-FR"
    >
      <Page size="A4" style={styles.page}>
        <View style={styles.header}>
          <View style={styles.seller}>
            <W style={styles.sellerName}>{seller.name}</W>
            {seller.legalForm ? <W style={styles.line}>{seller.legalForm}</W> : null}
            {seller.address ? <W style={styles.line}>{seller.address}</W> : null}
            {seller.ifu ? <W style={styles.line}>{t("ifu", { value: seller.ifu })}</W> : null}
            {seller.rccm ? <W style={styles.line}>{t("rccm", { value: seller.rccm })}</W> : null}
            {seller.email ? <W style={styles.line}>{seller.email}</W> : null}
          </View>
          <View style={styles.titleBlock}>
            <W style={styles.title}>{title}</W>
            <W style={styles.number}>{t("number", { number: receipt.number })}</W>
            <W style={[styles.line, styles.muted]}>
              {t("issuedOn", { date: formatBillingDate(receipt.issuedAt) })}
            </W>
          </View>
        </View>

        {isTestReceipt(receipt.environment) ? <W style={styles.testNotice}>{t("testNotice")}</W> : null}

        <View style={styles.section}>
          <W style={styles.sectionTitle}>{t("buyer")}</W>
          <W style={styles.buyerName}>{buyer.legalName}</W>
          {buyer.name && buyer.name !== buyer.legalName ? (
            <W style={styles.line}>{t("organization", { name: buyer.name })}</W>
          ) : null}
          {buyer.address ? <W style={styles.line}>{buyer.address}</W> : null}
          {buyer.taxId ? <W style={styles.line}>{t("ifu", { value: buyer.taxId })}</W> : null}
          {buyer.billingEmail ? <W style={styles.line}>{buyer.billingEmail}</W> : null}
        </View>

        <View style={styles.table}>
          <View style={[styles.row, styles.headerRow]}>
            <W style={[styles.cell, styles.headerCell, styles.colLabel]}>{t("columns.label")}</W>
            <W style={[styles.cell, styles.headerCell, styles.colPeriod]}>{t("columns.period")}</W>
            <W style={[styles.cell, styles.headerCell, styles.colQuantity]}>{t("columns.quantity")}</W>
            <W style={[styles.cell, styles.headerCell, styles.colUnit]}>{t("columns.unitPrice")}</W>
            <W style={[styles.cell, styles.headerCell, styles.colAmount]}>{t("columns.amount")}</W>
            <W style={[styles.cell, styles.headerCell, styles.colTax]}>{t("columns.tax")}</W>
          </View>
          {receipt.lines.map((line) => (
            <View key={line.position} style={styles.row} wrap={false}>
              <W style={[styles.cell, styles.colLabel]}>{line.label}</W>
              <W style={[styles.cell, styles.colPeriod]}>{period(line)}</W>
              <W style={[styles.cell, styles.colQuantity]}>{String(line.quantity)}</W>
              <W style={[styles.cell, styles.colUnit]}>{formatXof(line.unitPriceHtXof)}</W>
              <W style={[styles.cell, styles.colAmount]}>{formatXof(line.amountHtXof)}</W>
              <W style={[styles.cell, styles.colTax]}>{taxCell(line)}</W>
            </View>
          ))}
        </View>

        <View style={styles.totals}>
          <View style={styles.totalRow}>
            <W>{t("totalHt")}</W>
            <W>{amount(receipt.totalHtXof)}</W>
          </View>
          <View style={styles.totalRow}>
            <W>{t("totalTax")}</W>
            <W>{amount(receipt.totalTaxXof)}</W>
          </View>
          <View style={[styles.totalRow, styles.grandTotal]}>
            <W>{t("total")}</W>
            <W>{amount(receipt.totalXof)}</W>
          </View>
        </View>
        {receipt.totalTaxXof === 0 ? <W style={styles.note}>{t("noTax")}</W> : null}

        <View style={styles.section}>
          <W style={styles.sectionTitle}>{t("payment")}</W>
          {paymentLines.map((value) => (
            <W key={value} style={styles.line}>
              {value}
            </W>
          ))}
          <W style={styles.line}>
            {receipt.externalInvoiceNumber
              ? t("externalInvoice", { number: receipt.externalInvoiceNumber })
              : t("externalInvoiceNone")}
          </W>
        </View>

        <W style={styles.footer} fixed>
          {t("footer", { seller: seller.name })}
        </W>
      </Page>
    </Document>
  );
}

/** The receipt as a one-page PDF. */
export async function buildReceiptPdf(receipt: Receipt): Promise<Buffer> {
  return renderToBuffer(<ReceiptDocument receipt={receipt} />);
}
