import { describe, expect, it } from "vitest";
import { billingReminderEmail, type BillingReminderInput } from "./billing-reminder-email";

const LINK =
  "https://kolabreport.mocktar.com/fr/organisations/5e4d3c2b-1a09-4f8e-9d7c-6b5a4f3e2d1c/abonnement";

// Ends on 21 October 2026 at 14:00 in Porto-Novo; read-only from 28 October.
const base: BillingReminderInput = {
  to: "awa@cabinet-dossou.test",
  kind: "d7",
  plan: "cabinet",
  organizationName: "Cabinet Dossou",
  workspaceName: null,
  endsAt: "2026-10-21T13:00:00+00:00",
  graceEndsAt: "2026-10-28T13:00:00+00:00",
  link: LINK,
  now: new Date("2026-10-14T04:17:00Z"),
};

describe("billingReminderEmail", () => {
  it("warns 7 days before, with the date and the link to renew", () => {
    const email = billingReminderEmail(base);

    expect(email.to).toBe(base.to);
    expect(email.subject).toBe("Votre offre KolabReport se termine dans 7 jours");
    expect(email.text).toContain(
      "L'offre Cabinet de Cabinet Dossou se termine le 21 octobre 2026. Renouvelez avant cette date",
    );
    expect(email.text).toContain(`Renouveler l'offre : ${LINK}`);
    expect(email.html).toContain(`href="${LINK}"`);
    expect(email.html).toContain("Votre offre se termine le 21 octobre 2026");
    expect(email.text).toContain(
      "Vous recevez cet e-mail car vous êtes propriétaire de l'organisation Cabinet Dossou",
    );
  });

  it("counts the days left when a run was missed", () => {
    expect(billingReminderEmail({ ...base, now: new Date("2026-10-16T04:17:00Z") }).subject).toBe(
      "Votre offre KolabReport se termine dans 5 jours",
    );
  });

  it("says tomorrow the day before, and today on the end day", () => {
    expect(billingReminderEmail({ ...base, kind: "d1", now: new Date("2026-10-20T04:17:00Z") }).subject).toBe(
      "Votre offre KolabReport se termine demain",
    );
    expect(billingReminderEmail({ ...base, kind: "d1", now: new Date("2026-10-21T04:17:00Z") }).subject).toBe(
      "Votre offre KolabReport se termine aujourd'hui",
    );
  });

  it("gives the end of the grace once the period has ended", () => {
    const email = billingReminderEmail({ ...base, kind: "ended", now: new Date("2026-10-22T04:17:00Z") });

    expect(email.subject).toBe("Votre offre KolabReport est terminée");
    expect(email.text).toContain(
      "L'offre Cabinet de Cabinet Dossou a pris fin le 21 octobre 2026. Tout reste accessible jusqu'au 28 octobre 2026",
    );
  });

  it("says what still works once the workspace is read-only", () => {
    const email = billingReminderEmail({ ...base, kind: "read_only", now: new Date("2026-10-29T04:17:00Z") });

    expect(email.subject).toBe("Votre espace KolabReport est en lecture seule");
    expect(email.html).toContain("Lecture seule depuis le 28 octobre 2026");
    expect(email.text).toContain("peut consulter et exporter les rapports, mais plus les modifier");
  });

  it("names the workspace of a Pass Mission", () => {
    const email = billingReminderEmail({ ...base, plan: "mission", workspaceName: "Audit Parakou" });

    expect(email.text).toContain(
      "Le Pass Mission de l'espace de travail Audit Parakou (Cabinet Dossou) se termine le 21 octobre 2026.",
    );
  });

  it("words the trial as such", () => {
    const email = billingReminderEmail({ ...base, plan: "trial" });

    expect(email.text).toContain("L'essai gratuit de Cabinet Dossou se termine le 21 octobre 2026.");
  });

  it("escapes names in the HTML", () => {
    const email = billingReminderEmail({ ...base, organizationName: '<img src=x onerror="alert(1)">' });

    expect(email.html).not.toContain("<img");
    expect(email.html).toContain("&lt;img src=x onerror=&quot;alert(1)&quot;&gt;");
  });
});
