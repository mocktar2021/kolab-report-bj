import { escapeHtml } from "./invitation-email";
import type { Email } from "./send";

// The record of a deleted account (KRB-186), sent to ACCOUNT_DELETION_LOG_EMAIL.
// A backup restore brings deleted accounts back, and it rolls back any table
// too, so the list of ids to delete again lives in a mailbox. It holds the
// account id, the date and the environment: never the e-mail address or the
// name of the person.

export type AccountDeletionRecordInput = {
  to: string;
  userId: string;
  deletedAt: Date;
  /** APP_ENV, so staging and production records don't mix. */
  environment: string;
};

export function accountDeletionRecordEmail(input: AccountDeletionRecordInput): Email {
  const deletedAt = input.deletedAt.toISOString();
  const subject = `[KolabReport ${input.environment}] Compte supprimé ${input.userId}`;
  const lines = [
    "Un compte a été supprimé depuis la page Mon compte.",
    `Identifiant : ${input.userId}\nDate (UTC) : ${deletedAt}\nEnvironnement : ${input.environment}`,
    "Gardez cet e-mail. Après la restauration d'une sauvegarde prise avant cette date, supprimez de nouveau ce compte (docs/gdpr/data-subject-requests.md, étape 7).",
  ];
  const text = `${lines.join("\n\n")}\n`;
  const html = lines.map((line) => `<p>${escapeHtml(line).replaceAll("\n", "<br>")}</p>`).join("\n");
  return { to: input.to, subject, text, html };
}
