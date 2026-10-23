// @vitest-environment node
import { describe, expect, it } from "vitest";
import { pdfPageCount, pdfText, squash } from "@/lib/export/test-pdf-text";
import { parseReceipt, type Receipt } from "./receipt";
import { buildReceiptPdf } from "./receipt-pdf";

// The receipt as billing_issue_receipt stores it: the seller of
// private.billing_settings, the buyer of organization_billing, the payment
// read back from FedaPay, and one line (ADR 001, section 9).
const ROW = {
  id: "5f0c3a2e-7b1d-4c9e-8a6f-2d4b1e3c5a70",
  number: "KR-2026-000042",
  kind: "receipt",
  environment: "live",
  issued_at: "2026-10-15T09:30:00+00:00",
  seller: {
    name: "Mocktar Technologies",
    legal_form: "Établissement",
    address: "C 1357 Houeyiho, 07BP91 Cotonou, République du Bénin",
    rccm: "COTONOU N° RB/COT/26 A 119654",
    ifu: "1200900488800",
    email: "support@mocktar.com",
  },
  buyer: {
    organization_id: "3c2b1a09-8f7e-4d6c-9b5a-4f3e2d1c0b9a",
    name: "Cabinet Dossou",
    legal_name: "Cabinet Dossou & Associés SARL",
    address: "Rue 12.048, Cadjèhoun, Cotonou",
    tax_id: "3201912345678",
    billing_email: "compta@dossou.bj",
  },
  payment: {
    method: "fedapay",
    mode: "mtn_open",
    fedapay_transaction_id: 104523,
    fedapay_reference: "trx_8Kp2a",
    merchant_reference: "KR-6e1d2c3b-4a59-4f6e-8d7c-1b2a3c4d5e6f",
    paid_at: "2026-10-15T09:29:12+00:00",
  },
  total_ht_xof: 45000,
  total_tax_xof: 0,
  total_xof: 45000,
  external_invoice_number: null,
};

const LINES = [
  {
    position: 1,
    label: "Indépendant, 3 mois",
    period_start: "2026-10-15",
    period_end: "2027-01-15",
    quantity: 1,
    unit_price_ht_xof: 45000,
    amount_ht_xof: 45000,
    tax_code: null,
    tax_rate: null,
    tax_xof: 0,
  },
];

function receipt(row: Record<string, unknown> = {}, lines: unknown[] = LINES): Receipt {
  const parsed = parseReceipt({ ...ROW, ...row }, lines);
  if (!parsed) throw new Error("The sample receipt does not parse");
  return parsed;
}

async function textOf(value: Receipt): Promise<string> {
  return squash(pdfText(await buildReceiptPdf(value)));
}

function expectParts(text: string, ...parts: string[]) {
  for (const part of parts) expect(text).toContain(squash(part));
}

describe("buildReceiptPdf", () => {
  it("draws one A4 page", async () => {
    const pdf = await buildReceiptPdf(receipt());
    expect(pdf.subarray(0, 5).toString("latin1")).toBe("%PDF-");
    expect(pdfPageCount(pdf)).toBe(1);
    expect(pdf.toString("latin1")).toMatch(/\/MediaBox\s*\[0 0 595\.\d+ 841\.\d+\]/);
  });

  it("prints the number, the seller and the buyer as stored", async () => {
    const text = await textOf(receipt());
    expectParts(
      text,
      "Reçu de paiement",
      "N° KR-2026-000042",
      "Émis le 15 octobre 2026",
      "Mocktar Technologies",
      "Établissement",
      "C 1357 Houeyiho, 07BP91 Cotonou, République du Bénin",
      "IFU : 1200900488800",
      "RCCM : COTONOU N° RB/COT/26 A 119654",
      "support@mocktar.com",
      "Client",
      "Cabinet Dossou & Associés SARL",
      "Organisation : Cabinet Dossou",
      "Rue 12.048, Cadjèhoun, Cotonou",
      "IFU : 3201912345678",
      "compta@dossou.bj",
    );
  });

  it("prints the lines and the totals in FCFA, with a tax line at zero", async () => {
    const text = await textOf(receipt());
    expectParts(
      text,
      "Désignation",
      "Période",
      "Prix unitaire",
      "Montant",
      "Taxe",
      "Indépendant, 3 mois",
      "du 15 octobre 2026 au 15 janvier 2027",
      "Sous-total45 000 FCFA",
      "Taxes0 FCFA",
      "Total payé45 000 FCFA",
      "TVA non applicable : le vendeur relève du régime de la taxe professionnelle synthétique (TPS).",
    );
  });

  it("prints the payment and the empty slot of the normalized invoice", async () => {
    const text = await textOf(receipt());
    expectParts(
      text,
      "Paiement",
      "Moyen de paiement : MTN Mobile Money",
      "Payé le 15 octobre 2026",
      "Transaction FedaPay n° 104523",
      "Référence FedaPay : trx_8Kp2a",
      "Référence KolabReport : KR-6e1d2c3b-4a59-4f6e-8d7c-1b2a3c4d5e6f",
      "Facture normalisée (e-MECeF) : non émise",
    );
    expect(text).not.toContain(squash("Reçu de test"));
  });

  it("writes dates in Benin time and amounts the French way", async () => {
    // 23:30 UTC on 31 December is already 1 January in Cotonou.
    const text = await textOf(
      receipt(
        {
          issued_at: "2026-12-31T23:30:00+00:00",
          payment: { ...ROW.payment, paid_at: "2026-12-31T23:30:00+00:00" },
          total_ht_xof: 1_470_000,
          total_xof: 1_470_000,
        },
        [
          {
            ...LINES[0],
            label: "Cabinet, 12 mois",
            quantity: 3,
            unit_price_ht_xof: 490_000,
            amount_ht_xof: 1_470_000,
          },
        ],
      ),
    );
    expectParts(text, "Émis le 1 janvier 2027", "Payé le 1 janvier 2027", "490 000", "1 470 000 FCFA");
    // The amounts are grouped with a no-break space, never a comma or a dot.
    const raw = pdfText(await buildReceiptPdf(receipt()));
    expect(raw).toMatch(/45 000/);
    expect(raw).not.toMatch(/45[,.]000/);
  });

  it("marks receipts of the sandbox and of the mock as test receipts", async () => {
    expectParts(await textOf(receipt({ environment: "sandbox" })), "Reçu de test, sans valeur comptable");
    expectParts(await textOf(receipt({ environment: "mock" })), "Reçu de test, sans valeur comptable");
  });

  it("prints the normalized invoice number once there is one", async () => {
    expectParts(
      await textOf(receipt({ external_invoice_number: "MECEF-2027-0012" })),
      "Facture normalisée (e-MECeF) : MECEF-2027-0012",
    );
  });

  it("leaves out what the buyer did not give, and names a bank transfer", async () => {
    const text = await textOf(
      receipt({
        buyer: {
          name: "Cabinet Dossou",
          legal_name: "Cabinet Dossou",
          address: null,
          tax_id: null,
          billing_email: null,
        },
        payment: { method: "bank_transfer", mode: null, paid_at: "2026-10-15T09:29:12+00:00" },
      }),
    );
    expectParts(text, "Cabinet Dossou", "Moyen de paiement : Virement bancaire");
    expect(text).not.toContain(squash("Organisation :"));
    expect(text).not.toContain(squash("Transaction FedaPay"));
    expect(text).not.toContain(squash("Référence du virement"));
    expect(text.match(/IFU:/g)).toHaveLength(1);
  });

  it("prints the reference of a transfer recorded by the operator (KRB-179)", async () => {
    const text = await textOf(
      receipt({
        environment: "manual",
        payment: {
          method: "bank_transfer",
          mode: null,
          transfer_reference: "VIR-2026-0147",
          merchant_reference: "KR-6e1d2c3b-4a59-4f6e-8d7c-1b2a3c4d5e6f",
          paid_at: "2026-10-13T10:00:00+00:00",
        },
      }),
    );
    expectParts(text, "Moyen de paiement : Virement bancaire", "Référence du virement : VIR-2026-0147");
    expect(text).not.toContain(squash("Reçu de test"));
  });
});
