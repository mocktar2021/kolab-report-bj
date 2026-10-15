// @vitest-environment node
import { describe, expect, it } from "vitest";
import { billingAlertEmail, paymentReceivedEmail } from "./billing-email";

const base = {
  to: "awa@cabinet.test",
  organizationName: "Cabinet <Dossou>",
  offerLabel: "Cabinet, 1 mois",
  quantity: 1,
  amountXof: 49_000,
  plan: "cabinet",
  endsAt: "2026-11-15T23:30:00Z",
  drafts: null,
  receiptNumber: "KR-2026-000012",
  link: "https://kolabreport.test/fr/organisations/o1/abonnement#recus",
};

describe("paymentReceivedEmail", () => {
  it("names the receipt, the plan and its end in Benin time", () => {
    const email = paymentReceivedEmail(base);
    expect(email.to).toBe("awa@cabinet.test");
    expect(email.subject).toBe("Paiement reçu, reçu KR-2026-000012");
    expect(email.text).toContain("Votre offre Cabinet est active jusqu'au 16 novembre 2026.");
    expect(email.text).toContain("pour l'offre Cabinet, 1 mois de l'organisation Cabinet <Dossou>");
    expect(email.text).toContain("Votre reçu porte le numéro KR-2026-000012.");
    expect(email.text).toContain(`Voir les reçus : ${base.link}`);
    expect(email.html).toContain(">Voir les reçus</a>");
    expect(email.html).toContain("Cabinet &lt;Dossou&gt;");
    expect(email.html).not.toContain("<Dossou>");
  });

  it("describes a Pack IA by its drafts and quantity", () => {
    const email = paymentReceivedEmail({
      ...base,
      offerLabel: "Pack IA, 100 brouillons IA",
      quantity: 3,
      amountXof: 36_000,
      plan: null,
      drafts: 300,
    });
    expect(email.text).toContain("Pack IA, 100 brouillons IA (x3)");
    expect(email.text).toContain("Les 300 brouillons IA du pack sont disponibles jusqu'au 16 novembre 2026.");
  });

  it("uses no dash as punctuation", () => {
    const { subject, text } = paymentReceivedEmail(base);
    expect(`${subject}${text}`).not.toMatch(new RegExp("[\\u2013\\u2014]"));
  });
});

describe("billingAlertEmail", () => {
  it("carries the environment and ids only", () => {
    const email = billingAlertEmail({
      to: "ops@mocktar.test",
      kind: "review",
      environment: "staging",
      purchaseId: "p1",
      organizationId: "o1",
      fedapayTransactionId: 104,
      reason: "amount",
    });
    expect(email.subject).toBe("[KolabReport staging] Facturation : paiement à vérifier");
    expect(email.text).toContain("Achat : p1");
    expect(email.text).toContain("Transaction FedaPay : 104");
    expect(email.text).toContain("Écart : amount");
    expect(email.text).not.toMatch(/@/);
  });

  it("says when the organization is gone", () => {
    const email = billingAlertEmail({
      to: "ops@mocktar.test",
      kind: "refund",
      environment: "production",
      purchaseId: "p1",
      organizationId: null,
      fedapayTransactionId: null,
    });
    expect(email.text).toContain("Organisation : supprimée");
    expect(email.text).toContain("Transaction FedaPay : inconnue");
  });
});
