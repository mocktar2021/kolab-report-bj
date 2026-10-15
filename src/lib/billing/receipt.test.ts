import { describe, expect, it } from "vitest";
import { isTestReceipt, parseReceipt, paymentMethodKey, receiptFileName } from "./receipt";

const ROW = {
  number: "KR-2026-000007",
  kind: "receipt",
  environment: "sandbox",
  issued_at: "2026-10-15T09:30:00+00:00",
  seller: { name: "Mocktar Technologies", ifu: "1200900488800", rccm: "", email: "support@mocktar.com" },
  buyer: { name: "Cabinet A", legal_name: null, address: "  ", tax_id: null, billing_email: null },
  payment: {
    method: "fedapay",
    mode: "momo_test",
    fedapay_transaction_id: 12,
    paid_at: "2026-10-15T09:29:00Z",
  },
  total_ht_xof: 24000,
  total_tax_xof: 0,
  total_xof: 24000,
  external_invoice_number: null,
};

const LINE = {
  position: 1,
  label: "Pack IA, 100 brouillons IA",
  period_start: "2026-10-15",
  period_end: "2027-10-15",
  quantity: 2,
  unit_price_ht_xof: 12000,
  amount_ht_xof: 24000,
  tax_code: null,
  tax_rate: "0.00",
  tax_xof: 0,
};

describe("parseReceipt", () => {
  it("reads the stored rows, the organization's name standing for a missing legal name", () => {
    const receipt = parseReceipt(ROW, [LINE]);
    expect(receipt).toMatchObject({
      number: "KR-2026-000007",
      environment: "sandbox",
      seller: { name: "Mocktar Technologies", rccm: null, legalForm: null },
      buyer: { name: "Cabinet A", legalName: "Cabinet A", address: null },
      payment: { mode: "momo_test", fedapayTransactionId: 12, fedapayReference: null },
      totalXof: 24000,
      lines: [{ quantity: 2, unitPriceHtXof: 12000, taxRate: 0, periodEnd: "2027-10-15" }],
    });
  });

  it("orders the lines by position", () => {
    const receipt = parseReceipt(ROW, [
      { ...LINE, position: 2, label: "Deuxième" },
      { ...LINE, position: 1, label: "Première" },
    ]);
    expect(receipt?.lines.map((line) => line.label)).toEqual(["Première", "Deuxième"]);
  });

  it("refuses a receipt without line, without buyer name or with an odd number", () => {
    expect(parseReceipt(ROW, [])).toBeNull();
    expect(parseReceipt({ ...ROW, buyer: { legal_name: null, name: null } }, [LINE])).toBeNull();
    expect(parseReceipt({ ...ROW, number: "../../etc" }, [LINE])).toBeNull();
    expect(parseReceipt(null, [LINE])).toBeNull();
  });
});

describe("receipt helpers", () => {
  it("names the file after the number", () => {
    expect(receiptFileName("KR-2026-000007")).toBe("recu-KR-2026-000007.pdf");
    expect(receiptFileName('KR-2026-000007"; x')).toBe("recu-KR-2026-000007x.pdf");
  });

  it("treats the sandbox and the mock as test receipts", () => {
    expect(isTestReceipt("sandbox")).toBe(true);
    expect(isTestReceipt("mock")).toBe(true);
    expect(isTestReceipt("live")).toBe(false);
    expect(isTestReceipt("manual")).toBe(false);
  });

  it("names the payment method from FedaPay's mode", () => {
    expect(paymentMethodKey("fedapay", "mtn_open")).toBe("mtn");
    expect(paymentMethodKey("fedapay", "moov_tg")).toBe("moov");
    expect(paymentMethodKey("fedapay", "celtiis_bj")).toBe("celtiis");
    expect(paymentMethodKey("fedapay", "momo_test")).toBe("test");
    expect(paymentMethodKey("fedapay", "visa")).toBe("card");
    expect(paymentMethodKey("fedapay", "something_new")).toBe("fedapay");
    expect(paymentMethodKey("fedapay", null)).toBe("fedapay");
    expect(paymentMethodKey("bank_transfer", null)).toBe("bankTransfer");
    expect(paymentMethodKey("manual", null)).toBe("manual");
  });
});
