import { PLANS, isPlanCode } from "@/lib/billing/catalog";
import { formatBillingDate, formatXof } from "@/lib/billing/format";
import { escapeHtml } from "./invitation-email";
import type { Email } from "./send";

export type PaymentReceivedEmailInput = {
  to: string;
  organizationName: string;
  /** The label frozen in the purchase, for example "Cabinet, 1 mois". */
  offerLabel: string;
  quantity: number;
  amountXof: number;
  /** Plan of the entitlement granted, null for a Pack IA. */
  plan: string | null;
  /** End of the period granted, or expiry of the pack. */
  endsAt: string | null;
  /** AI drafts of a Pack IA, null otherwise. */
  drafts: number | null;
  receiptNumber: string | null;
  /** The organization's billing page, at its receipts when there is a receipt. */
  link: string;
};

function paragraphs(lines: string[]): string {
  return lines
    .map(
      (line) =>
        `<tr><td style="font-size:15px;line-height:1.6;color:#3F3F46;padding-bottom:16px;">${escapeHtml(line)}</td></tr>`,
    )
    .join("\n            ");
}

function layout(heading: string, lines: string[], button: { label: string; link: string } | null): string {
  const action = button
    ? `<tr>
              <td style="padding:8px 0 8px;">
                <a href="${escapeHtml(button.link)}" style="display:inline-block;background:#09090B;color:#FFFFFF;text-decoration:none;font-size:15px;font-weight:bold;padding:12px 24px;border-radius:999px;">${escapeHtml(button.label)}</a>
              </td>
            </tr>`
    : "";
  return `<!doctype html>
<html lang="fr">
  <body style="margin:0;padding:0;background:#FAFAFA;font-family:Arial,Helvetica,sans-serif;color:#09090B;">
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#FAFAFA;padding:32px 16px;">
      <tr>
        <td align="center">
          <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="max-width:480px;background:#FFFFFF;border:1px solid #E4E4E7;border-radius:16px;padding:32px;">
            <tr><td style="font-size:15px;font-weight:bold;padding-bottom:24px;">KolabReport</td></tr>
            <tr><td style="font-size:22px;font-weight:bold;line-height:1.3;padding-bottom:12px;">${escapeHtml(heading)}</td></tr>
            ${paragraphs(lines)}
            ${action}
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>`;
}

/** French confirmation sent to the buyer once a payment is granted (ADR 001, 8.5 and 9). */
export function paymentReceivedEmail(input: PaymentReceivedEmailInput): Email {
  const offer = input.quantity > 1 ? `${input.offerLabel} (x${input.quantity})` : input.offerLabel;
  const lines = [
    `Nous avons reçu votre paiement de ${formatXof(input.amountXof)} FCFA pour l'offre ${offer} de l'organisation ${input.organizationName}.`,
  ];
  if (input.endsAt && input.drafts !== null) {
    lines.push(
      `Les ${input.drafts} brouillons IA du pack sont disponibles jusqu'au ${formatBillingDate(input.endsAt)}.`,
    );
  } else if (input.endsAt && input.plan) {
    const plan = isPlanCode(input.plan) ? PLANS[input.plan].label : input.plan;
    lines.push(`Votre offre ${plan} est active jusqu'au ${formatBillingDate(input.endsAt)}.`);
  }
  if (input.receiptNumber) {
    lines.push(
      `Votre reçu porte le numéro ${input.receiptNumber}. Téléchargez-le en PDF depuis la liste des reçus de la page Abonnement.`,
    );
  }
  const subject = input.receiptNumber ? `Paiement reçu, reçu ${input.receiptNumber}` : "Paiement reçu";
  const label = input.receiptNumber ? "Voir les reçus" : "Voir l'abonnement";
  const text = `${lines.join("\n\n")}\n\n${label} : ${input.link}\n`;
  return {
    to: input.to,
    subject,
    html: layout("Paiement reçu", lines, { label, link: input.link }),
    text,
  };
}

export const BILLING_ALERT_KINDS = [
  "review",
  "refund",
  "stuck",
  "paid_after_expiry",
  "possible_duplicate",
] as const;

export type BillingAlertKind = (typeof BILLING_ALERT_KINDS)[number];

export type BillingAlertEmailInput = {
  to: string;
  kind: BillingAlertKind;
  /** APP_ENV or VERCEL_ENV, so a staging alert never reads as a production one. */
  environment: string;
  purchaseId: string;
  organizationId: string | null;
  fedapayTransactionId: number | null;
  /** For review: what did not match (amount, currency, merchant_reference, environment). */
  reason?: string | null;
};

const ALERTS: Record<BillingAlertKind, { subject: string; body: string }> = {
  review: {
    subject: "paiement à vérifier",
    body: "FedaPay indique ce paiement comme payé, mais sa réponse ne correspond pas à l'achat. Rien n'a été accordé. Vérifiez la transaction dans le tableau de bord FedaPay, puis accordez l'offre à la main ou remboursez.",
  },
  refund: {
    subject: "remboursement constaté",
    body: "FedaPay indique ce paiement comme remboursé. L'achat est passé à refunded, rien n'a été retiré. Raccourcissez ou retirez l'offre si besoin.",
  },
  stuck: {
    subject: "paiement approuvé non accordé",
    body: "FedaPay a approuvé ce paiement il y a plus de 15 minutes et l'application n'arrive pas à l'accorder. Vérifiez les journaux de la fonction et la base de données.",
  },
  paid_after_expiry: {
    subject: "paiement reçu après expiration",
    body: "Ce paiement est arrivé après l'expiration de l'achat. L'offre a été accordée quand même, car un paiement reçu accorde toujours.",
  },
  possible_duplicate: {
    subject: "deux paiements pour la même offre",
    body: "Cette organisation a payé deux fois la même offre en moins de 24 heures. Les deux périodes se suivent. Proposez le remboursement du second paiement si c'est une erreur.",
  },
};

/** French alert for the operator (BILLING_ALERT_EMAIL, ADR 001, section 12). Ids only, no name or e-mail. */
export function billingAlertEmail(input: BillingAlertEmailInput): Email {
  const alert = ALERTS[input.kind];
  const facts = [
    `Achat : ${input.purchaseId}`,
    `Organisation : ${input.organizationId ?? "supprimée"}`,
    `Transaction FedaPay : ${input.fedapayTransactionId ?? "inconnue"}`,
    ...(input.reason ? [`Écart : ${input.reason}`] : []),
  ];
  const lines = [alert.body, ...facts];
  return {
    to: input.to,
    subject: `[KolabReport ${input.environment}] Facturation : ${alert.subject}`,
    html: layout("Alerte de facturation", lines, null),
    text: `${lines.join("\n\n")}\n`,
  };
}
